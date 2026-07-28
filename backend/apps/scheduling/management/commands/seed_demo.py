"""Populate a local database with something worth looking at.

Run with:  python manage.py seed_demo

Idempotent: every object is fetched-or-created, so running it twice changes
nothing. Appointments are booked out of generate_slots rather than invented,
which means the seed data cannot contradict a provider's availability and the
slot service gets exercised on every run.
"""

from datetime import date, time, timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import PatientProfile, ProviderProfile, Role, User
from apps.scheduling.models import Appointment, AvailabilityRule, TimeOff, Weekday
from apps.scheduling.services.slots import generate_slots

DEMO_PASSWORD = "demo-password-1234"

WEEKDAYS = [
    Weekday.MONDAY,
    Weekday.TUESDAY,
    Weekday.WEDNESDAY,
    Weekday.THURSDAY,
    Weekday.FRIDAY,
]

PROVIDERS = [
    {
        "email": "dana.okafor@clinic.test",
        "first_name": "Dana",
        "last_name": "Okafor",
        "specialty": "Family medicine",
        "timezone": "America/New_York",
        "slot_duration_minutes": 30,
        "buffer_minutes": 5,
        "min_notice_minutes": 120,
        "windows": [(day, time(9, 0), time(17, 0)) for day in WEEKDAYS],
    },
    {
        "email": "priya.raman@clinic.test",
        "first_name": "Priya",
        "last_name": "Raman",
        "specialty": "Dermatology",
        "timezone": "America/Los_Angeles",
        "slot_duration_minutes": 60,
        "buffer_minutes": 0,
        "min_notice_minutes": 24 * 60,
        "windows": [
            (Weekday.TUESDAY, time(10, 0), time(16, 0)),
            (Weekday.THURSDAY, time(10, 0), time(16, 0)),
        ],
    },
    {
        # Split days, to show a lunch break falling out of the slot generator.
        "email": "sam.nakamura@clinic.test",
        "first_name": "Sam",
        "last_name": "Nakamura",
        "specialty": "Paediatrics",
        "timezone": "America/Chicago",
        "slot_duration_minutes": 20,
        "buffer_minutes": 10,
        "min_notice_minutes": 60,
        "windows": [
            (day, start, end)
            for day in (Weekday.MONDAY, Weekday.WEDNESDAY, Weekday.FRIDAY)
            for start, end in ((time(8, 0), time(12, 0)), (time(13, 0), time(17, 0)))
        ],
    },
]

PATIENTS = [
    (
        "alex.rivera@example.test",
        "Alex",
        "Rivera",
        "America/New_York",
        date(1988, 4, 12),
    ),
    (
        "jordan.blake@example.test",
        "Jordan",
        "Blake",
        "America/Chicago",
        date(1975, 9, 30),
    ),
    ("sam.chen@example.test", "Sam", "Chen", "America/Los_Angeles", date(1996, 1, 8)),
    ("robin.patel@example.test", "Robin", "Patel", "Europe/London", date(2001, 6, 21)),
]


class Command(BaseCommand):
    help = "Create demo providers, patients and appointments for local development."

    def add_arguments(self, parser):
        parser.add_argument(
            "--appointments",
            type=int,
            default=8,
            help="How many appointments to book across the demo providers.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        admin = self._create_admin()
        providers = [self._create_provider(spec) for spec in PROVIDERS]
        patients = [self._create_patient(*row) for row in PATIENTS]
        self._add_time_off(providers[0])
        booked = self._book(providers, patients, options["appointments"])

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Demo data ready."))
        self.stdout.write(f"  providers    {len(providers)}")
        self.stdout.write(f"  patients     {len(patients)}")
        self.stdout.write(f"  appointments {booked} booked")
        self.stdout.write("")
        self.stdout.write("Sign in with any of these:")
        self.stdout.write(f"  admin     {admin.email}")
        for provider in providers:
            self.stdout.write(f"  provider  {provider.user.email}")
        for patient in patients:
            self.stdout.write(f"  patient   {patient.email}")
        self.stdout.write(f"  password  {DEMO_PASSWORD}")
        self.stdout.write("")
        self.stdout.write("Admin: http://localhost:8000/admin/")
        self.stdout.write("API docs: http://localhost:8000/api/docs/")

    def _create_admin(self) -> User:
        admin = User.objects.filter(email="admin@clinic.test").first()
        if admin:
            return admin
        return User.objects.create_superuser(
            email="admin@clinic.test",
            password=DEMO_PASSWORD,
            first_name="Ada",
            last_name="Ministrator",
        )

    def _create_provider(self, spec: dict) -> ProviderProfile:
        user, created = User.objects.get_or_create(
            email=spec["email"],
            defaults={
                "first_name": spec["first_name"],
                "last_name": spec["last_name"],
                "role": Role.PROVIDER,
                "timezone": spec["timezone"],
            },
        )
        if created:
            user.set_password(DEMO_PASSWORD)
            user.save(update_fields=["password"])

        profile, _ = ProviderProfile.objects.get_or_create(
            user=user,
            defaults={
                "specialty": spec["specialty"],
                "slot_duration_minutes": spec["slot_duration_minutes"],
                "buffer_minutes": spec["buffer_minutes"],
                "min_notice_minutes": spec["min_notice_minutes"],
                "booking_horizon_days": 60,
            },
        )

        # Valid from well in the past so the rules apply to today's calendar.
        valid_from = timezone.now().date() - timedelta(days=365)
        for weekday, start, end in spec["windows"]:
            AvailabilityRule.objects.get_or_create(
                provider=profile,
                weekday=weekday,
                start_time=start,
                valid_from=valid_from,
                defaults={"end_time": end},
            )
        return profile

    def _create_patient(self, email, first, last, tz, dob) -> User:
        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                "first_name": first,
                "last_name": last,
                "role": Role.PATIENT,
                "timezone": tz,
            },
        )
        if created:
            user.set_password(DEMO_PASSWORD)
            user.save(update_fields=["password"])
        PatientProfile.objects.get_or_create(user=user, defaults={"date_of_birth": dob})
        return user

    def _add_time_off(self, provider: ProviderProfile) -> None:
        """One afternoon away, so the calendar has a visible hole in it."""
        start = timezone.now() + timedelta(days=3)
        start = start.replace(hour=17, minute=0, second=0, microsecond=0)
        TimeOff.objects.get_or_create(
            provider=provider,
            start_at=start,
            defaults={"end_at": start + timedelta(hours=4), "reason": "Conference"},
        )

    def _book(self, providers, patients, wanted: int) -> int:
        """Book real slots, topping each provider up to a target count.

        Booking a fixed number every run would not be idempotent: the previous
        run's appointments are no longer offered as slots, so a second run
        would happily book a different set. Counting what already exists and
        filling only the shortfall makes repeated runs converge.
        """
        now = timezone.now()
        today = now.date()
        per_provider = max(1, wanted // len(providers))
        booked = 0
        patient_cycle = 0

        for provider in providers:
            existing = Appointment.objects.filter(
                provider=provider, start_at__gte=now
            ).count()

            for _ in range(max(0, per_provider - existing)):
                # Ask again each time: the previous booking removed its slot.
                slots = generate_slots(provider, today, today + timedelta(days=14))
                if not slots:
                    break
                # Space them out rather than filling one morning solid.
                slot = slots[min(booked * 3, len(slots) - 1)]
                patient = patients[patient_cycle % len(patients)]
                patient_cycle += 1

                Appointment.objects.create(
                    provider=provider,
                    patient=patient,
                    booked_by=patient,
                    start_at=slot.start_at,
                    end_at=slot.end_at,
                    reason="Routine visit",
                )
                booked += 1
        return booked
