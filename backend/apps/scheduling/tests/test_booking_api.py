"""The booking API end to end: validation, authorization and scoping.

Requests go through HTTP so that serializers, permission classes and queryset
scoping are all exercised together -- the places a unit test of the service
layer would miss.

Times are built from the provider's ProviderSpec rather than written as ISO
literals, so the tests still describe the same slot if a fixture's opening hour
or slot length changes.
"""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.utils.dateparse import parse_datetime

from apps.scheduling.models import Appointment, AppointmentStatus, Weekday
from apps.scheduling.views import MAX_SLOT_RANGE_DAYS

pytestmark = pytest.mark.django_db

# The slots endpoint returns this many days when given no explicit range.
DEFAULT_RANGE_DAYS = 14


@pytest.fixture
def provider_tz(provider_spec):
    return ZoneInfo(provider_spec.timezone)


@pytest.fixture
def first_slot(monday, provider_spec, provider_tz):
    """The provider's opening slot: 09:00 New York on the frozen Monday."""
    return datetime.combine(monday, provider_spec.opens, tzinfo=provider_tz)


@pytest.fixture
def outside_hours(monday, provider_spec, provider_tz):
    """An hour after the provider closes."""
    closes = provider_spec.closes
    return datetime.combine(monday, time(closes.hour + 1, 0), tzinfo=provider_tz)


def iso(moment: datetime) -> str:
    return moment.isoformat()


class TestSlotsEndpoint:
    def test_defaults_to_a_fortnight(
        self, patient_client, provider, provider_spec, first_slot, frozen_clock
    ):
        """With no dates the endpoint returns two weeks. The provider works
        Mondays only, so that is two working days."""
        response = patient_client.get(f"/api/providers/{provider.pk}/slots/")

        assert response.status_code == 200
        mondays_in_range = DEFAULT_RANGE_DAYS // 7
        assert len(response.data) == provider_spec.slot_count * mondays_in_range
        # The API renders UTC while first_slot is New York-aware. Compare the
        # instants, not their spellings.
        assert parse_datetime(response.data[0]["start_at"]) == first_slot

    def test_honours_an_explicit_single_day(
        self, patient_client, provider, provider_spec, monday, frozen_clock
    ):
        response = patient_client.get(
            f"/api/providers/{provider.pk}/slots/",
            {"date_from": monday.isoformat(), "date_to": monday.isoformat()},
        )

        assert len(response.data) == provider_spec.slot_count

    def test_rejects_an_unparseable_date(self, patient_client, provider, frozen_clock):
        response = patient_client.get(
            f"/api/providers/{provider.pk}/slots/", {"date_from": "tomorrow"}
        )

        assert response.status_code == 400
        assert "date_from" in response.data

    def test_rejects_an_inverted_range(
        self, patient_client, provider, monday, frozen_clock
    ):
        response = patient_client.get(
            f"/api/providers/{provider.pk}/slots/",
            {
                "date_from": monday.isoformat(),
                "date_to": (monday - timedelta(days=1)).isoformat(),
            },
        )

        assert response.status_code == 400

    def test_rejects_a_range_past_the_cap(
        self, patient_client, provider, monday, frozen_clock
    ):
        """Unbounded ranges are a cheap denial of service against the generator."""
        too_far = monday + timedelta(days=MAX_SLOT_RANGE_DAYS + 1)

        response = patient_client.get(
            f"/api/providers/{provider.pk}/slots/",
            {"date_from": monday.isoformat(), "date_to": too_far.isoformat()},
        )

        assert response.status_code == 400

    def test_requires_authentication(self, api_client, provider, frozen_clock):
        response = api_client.get(f"/api/providers/{provider.pk}/slots/")

        assert response.status_code == 401


class TestBooking:
    def test_patient_books_an_open_slot(
        self, patient_client, patient, provider, first_slot, frozen_clock
    ):
        response = patient_client.post(
            "/api/appointments/",
            {
                "provider": provider.pk,
                "start_at": iso(first_slot),
                "reason": "Sore throat",
            },
            format="json",
        )

        assert response.status_code == 201
        appointment = Appointment.objects.get()
        assert appointment.patient == patient
        assert appointment.booked_by == patient
        assert appointment.status == AppointmentStatus.SCHEDULED
        assert appointment.start_at == first_slot

    def test_end_time_is_derived_from_the_provider(
        self, patient_client, provider, provider_spec, first_slot, frozen_clock
    ):
        """The client never supplies end_at, or it could book a whole afternoon
        in a thirty minute slot."""
        patient_client.post(
            "/api/appointments/",
            {
                "provider": provider.pk,
                "start_at": iso(first_slot),
                "end_at": iso(first_slot + timedelta(hours=4)),  # ignored
            },
            format="json",
        )

        appointment = Appointment.objects.get()
        booked_minutes = (appointment.end_at - appointment.start_at).total_seconds() / 60
        assert booked_minutes == provider_spec.slot_minutes

    def test_identity_comes_from_the_token_not_the_body(
        self, patient_client, patient, other_patient, provider, first_slot, frozen_clock
    ):
        patient_client.post(
            "/api/appointments/",
            {
                "provider": provider.pk,
                "start_at": iso(first_slot),
                "patient_id": other_patient.pk,  # must not be honoured
            },
            format="json",
        )

        assert Appointment.objects.get().patient == patient

    def test_a_taken_slot_is_refused(
        self, other_patient_client, provider, booked_appointment, frozen_clock
    ):
        response = other_patient_client.post(
            "/api/appointments/",
            {
                "provider": provider.pk,
                "start_at": iso(booked_appointment.start_at),
            },
            format="json",
        )

        assert response.status_code == 400
        assert "start_at" in response.data

    def test_a_time_outside_availability_is_refused(
        self, patient_client, provider, outside_hours, frozen_clock
    ):
        response = patient_client.post(
            "/api/appointments/",
            {"provider": provider.pk, "start_at": iso(outside_hours)},
            format="json",
        )

        assert response.status_code == 400

    def test_a_time_off_the_slot_grid_is_refused(
        self, patient_client, provider, first_slot, frozen_clock
    ):
        """Ten minutes past opening is inside working hours but is not a slot
        boundary, so it is not on offer."""
        off_grid = first_slot + timedelta(minutes=10)

        response = patient_client.post(
            "/api/appointments/",
            {"provider": provider.pk, "start_at": iso(off_grid)},
            format="json",
        )

        assert response.status_code == 400

    def test_a_provider_not_accepting_patients_is_refused(
        self, patient_client, provider, first_slot, frozen_clock
    ):
        provider.accepting_new_patients = False
        provider.save()

        response = patient_client.post(
            "/api/appointments/",
            {"provider": provider.pk, "start_at": iso(first_slot)},
            format="json",
        )

        assert response.status_code == 400
        assert "provider" in response.data

    def test_providers_cannot_book_appointments(
        self, provider_client, provider, first_slot, frozen_clock
    ):
        response = provider_client.post(
            "/api/appointments/",
            {"provider": provider.pk, "start_at": iso(first_slot)},
            format="json",
        )

        assert response.status_code == 403
        assert not Appointment.objects.exists()


class TestStaffBooking:
    def test_staff_book_on_behalf_of_a_patient(
        self, staff_client, staff, patient, provider, first_slot, frozen_clock
    ):
        response = staff_client.post(
            "/api/appointments/",
            {
                "provider": provider.pk,
                "start_at": iso(first_slot),
                "patient_id": patient.pk,
            },
            format="json",
        )

        assert response.status_code == 201
        appointment = Appointment.objects.get()
        assert appointment.patient == patient
        # The audit trail records who actually made the booking.
        assert appointment.booked_by == staff

    def test_staff_must_name_a_patient(
        self, staff_client, provider, first_slot, frozen_clock
    ):
        response = staff_client.post(
            "/api/appointments/",
            {"provider": provider.pk, "start_at": iso(first_slot)},
            format="json",
        )

        assert response.status_code == 400
        assert "patient_id" in response.data


class TestCancellation:
    def test_patient_cancels_their_own_appointment(
        self, patient_client, booked_appointment, frozen_clock
    ):
        response = patient_client.post(
            f"/api/appointments/{booked_appointment.pk}/cancel/",
            {"cancellation_reason": "Feeling better"},
            format="json",
        )

        assert response.status_code == 200
        booked_appointment.refresh_from_db()
        assert booked_appointment.status == AppointmentStatus.CANCELLED
        assert booked_appointment.cancelled_at is not None
        assert booked_appointment.cancellation_reason == "Feeling better"

    def test_cancelling_twice_is_refused(
        self, patient_client, booked_appointment, frozen_clock
    ):
        url = f"/api/appointments/{booked_appointment.pk}/cancel/"
        patient_client.post(url, {}, format="json")

        response = patient_client.post(url, {}, format="json")

        assert response.status_code == 400

    def test_the_provider_may_cancel(
        self, provider_client, booked_appointment, frozen_clock
    ):
        response = provider_client.post(
            f"/api/appointments/{booked_appointment.pk}/cancel/", {}, format="json"
        )

        assert response.status_code == 200

    def test_a_cancelled_slot_becomes_bookable_again(
        self, patient_client, other_patient_client, provider, first_slot, frozen_clock
    ):
        """End to end: book, cancel, then rebook the same time as someone else."""
        booked = patient_client.post(
            "/api/appointments/",
            {"provider": provider.pk, "start_at": iso(first_slot)},
            format="json",
        )
        patient_client.post(
            f"/api/appointments/{booked.data['id']}/cancel/", {}, format="json"
        )

        rebooked = other_patient_client.post(
            "/api/appointments/",
            {"provider": provider.pk, "start_at": iso(first_slot)},
            format="json",
        )

        assert rebooked.status_code == 201

    def test_appointments_cannot_be_deleted(
        self, patient_client, booked_appointment, frozen_clock
    ):
        """No destroy route exists: history is cancelled, never removed."""
        response = patient_client.delete(f"/api/appointments/{booked_appointment.pk}/")

        assert response.status_code == 405
        assert Appointment.objects.filter(pk=booked_appointment.pk).exists()


class TestAppointmentIsolation:
    def test_a_patient_sees_only_their_own(
        self, patient_client, booked_appointment, other_appointment, frozen_clock
    ):
        response = patient_client.get("/api/appointments/")

        ids = [row["id"] for row in response.data["results"]]
        assert ids == [booked_appointment.pk]

    def test_a_patient_cannot_retrieve_another_patients(
        self, other_patient_client, booked_appointment, frozen_clock
    ):
        """404, not 403: a 403 would confirm the record exists."""
        response = other_patient_client.get(f"/api/appointments/{booked_appointment.pk}/")

        assert response.status_code == 404

    def test_a_patient_cannot_cancel_another_patients(
        self, other_patient_client, booked_appointment, frozen_clock
    ):
        response = other_patient_client.post(
            f"/api/appointments/{booked_appointment.pk}/cancel/", {}, format="json"
        )

        assert response.status_code == 404
        booked_appointment.refresh_from_db()
        assert booked_appointment.status == AppointmentStatus.SCHEDULED

    def test_a_provider_sees_only_their_own_calendar(
        self, provider_client, booked_appointment, other_appointment, frozen_clock
    ):
        response = provider_client.get("/api/appointments/")

        ids = [row["id"] for row in response.data["results"]]
        assert ids == [booked_appointment.pk]

    def test_staff_see_every_appointment(
        self, staff_client, booked_appointment, other_appointment, frozen_clock
    ):
        response = staff_client.get("/api/appointments/")

        ids = {row["id"] for row in response.data["results"]}
        assert ids == {booked_appointment.pk, other_appointment.pk}


class TestScheduleIsolation:
    """A provider's own availability and time off."""

    def test_a_provider_sees_only_their_own_rules(
        self, provider_client, provider, other_provider, frozen_clock
    ):
        response = provider_client.get("/api/availability/")

        ids = {row["id"] for row in response.data["results"]}
        assert ids == {provider.availability_rules.get().pk}

    def test_a_provider_cannot_edit_another_providers_rule(
        self, provider_client, other_provider, other_provider_spec, frozen_clock
    ):
        victim = other_provider.availability_rules.get()

        response = provider_client.patch(
            f"/api/availability/{victim.pk}/", {"start_time": "06:00"}, format="json"
        )

        assert response.status_code == 404
        victim.refresh_from_db()
        assert victim.start_time == other_provider_spec.opens

    def test_a_new_rule_is_attached_to_the_caller(
        self, provider_client, provider, other_provider, frozen_clock
    ):
        """provider is taken from the token, so the body cannot forge it."""
        rules_before = provider.availability_rules.count()

        response = provider_client.post(
            "/api/availability/",
            {
                "weekday": Weekday.WEDNESDAY,
                "start_time": "09:00",
                "end_time": "12:00",
                "valid_from": "2026-01-01",
                "provider": other_provider.pk,  # ignored
            },
            format="json",
        )

        assert response.status_code == 201
        assert provider.availability_rules.count() == rules_before + 1
        assert other_provider.availability_rules.count() == 1

    def test_patients_cannot_touch_availability(self, patient_client, frozen_clock):
        assert patient_client.get("/api/availability/").status_code == 403
        assert patient_client.get("/api/time-off/").status_code == 403
