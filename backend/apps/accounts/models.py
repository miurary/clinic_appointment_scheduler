from zoneinfo import available_timezones

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.core.exceptions import ValidationError
from django.db import models
# Aliased: this model has a `timezone` field, and a class-body assignment does
# shadow the module-level name for statements later in the same class body.
from django.utils import timezone as django_timezone

from .managers import UserManager


def validate_timezone(value: str) -> None:
    if value not in available_timezones():
        raise ValidationError(f"{value!r} is not a valid IANA timezone name.")


class Role(models.TextChoices):
    """What a person does at the clinic. Unrelated to Django admin access."""

    PATIENT = "patient", "Patient"
    PROVIDER = "provider", "Provider"
    CLINIC_STAFF = "clinic_staff", "Clinic staff"


class User(AbstractBaseUser, PermissionsMixin):
    """Email-authenticated user.

    A single user table with a role discriminator, rather than separate patient
    and provider tables, so that auth, permissions and admin work uniformly.
    Role-specific data lives on the profile models below.
    """

    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.PATIENT)

    # The timezone this user sees times in. Storage is always UTC.
    timezone = models.CharField(
        max_length=64,
        default="America/New_York",
        validators=[validate_timezone],
    )

    is_active = models.BooleanField(default=True)
    # Django's own flag: grants access to /admin/. Named by contrib.admin, which
    # checks it directly -- it is not the same thing as Role.CLINIC_STAFF.
    is_staff = models.BooleanField(
        default=False, verbose_name="can access Django admin"
    )
    date_joined = models.DateTimeField(default=django_timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        ordering = ["email"]

    def __str__(self) -> str:
        return self.email

    def get_full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.email

    def get_short_name(self) -> str:
        return self.first_name or self.email

    @property
    def is_provider(self) -> bool:
        return self.role == Role.PROVIDER

    @property
    def is_patient(self) -> bool:
        return self.role == Role.PATIENT

    @property
    def is_clinic_staff(self) -> bool:
        return self.role == Role.CLINIC_STAFF


class ProviderProfile(models.Model):
    """Clinician-specific settings that hold for every day they work.

    Which hours they actually work is per-weekday and lives in
    apps.scheduling.models.AvailabilityRule.
    """

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="provider_profile"
    )
    specialty = models.CharField(max_length=120, blank=True)
    bio = models.TextField(blank=True)

    # Length of a bookable slot; availability windows are divided into these.
    slot_duration_minutes = models.PositiveIntegerField(default=30)
    # Gap enforced after each appointment (notes, room turnover).
    buffer_minutes = models.PositiveIntegerField(default=0)
    # How far ahead patients may book.
    booking_horizon_days = models.PositiveIntegerField(default=60)
    # Minimum notice before a slot can be booked.
    min_notice_minutes = models.PositiveIntegerField(default=120)

    accepting_new_patients = models.BooleanField(default=True)

    class Meta:
        ordering = ["user__last_name", "user__first_name"]

    def __str__(self) -> str:
        return f"{self.user.get_full_name()} ({self.specialty or 'general'})"

    @property
    def timezone(self) -> str:
        """Providers schedule in their own local time."""
        return self.user.timezone


class PatientProfile(models.Model):
    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="patient_profile"
    )
    date_of_birth = models.DateField(null=True, blank=True)
    # Free-text on purpose: a real system would model this properly, and would
    # need to treat it as PHI.
    notes = models.TextField(blank=True)

    def __str__(self) -> str:
        return self.user.get_full_name()
