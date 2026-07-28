"""The booking API end to end: validation, authorization and scoping.

Requests go through HTTP so that serializers, permission classes and queryset
scoping are all exercised together -- the places a unit test of the service
layer would miss.

Times are built from the provider's ProviderSpec rather than written as ISO
literals, so the tests still describe the same slot if a fixture's opening hour
or slot length changes.
"""

from datetime import datetime, time, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.db import IntegrityError, OperationalError
from django.utils.dateparse import parse_datetime
from rest_framework.serializers import ModelSerializer

from apps.scheduling.models import Appointment, AppointmentStatus, Weekday
from apps.scheduling.views import MAX_SLOT_RANGE_DAYS
from testkit import slot_at

pytestmark = pytest.mark.django_db

# The slots endpoint returns this many days when given no explicit range.
DEFAULT_RANGE_DAYS = 14


@pytest.fixture
def first_slot(monday, provider_spec):
    """The provider's opening slot: 09:00 New York on the frozen Monday."""
    return slot_at(monday, provider_spec, index=0)


@pytest.fixture
def outside_hours(monday, provider_spec):
    """An hour after the provider closes."""
    closes = provider_spec.closes
    return datetime.combine(
        monday, time(closes.hour + 1, 0), tzinfo=ZoneInfo(provider_spec.timezone)
    )


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


class TestAuthenticationRequired:
    """Every endpoint, not just the ones that happened to get a test.

    A permission_classes list on a viewset REPLACES the IsAuthenticated
    default from settings. A class implementing only has_object_permission
    therefore lets anonymous requests through to the queryset, where
    AnonymousUser has none of the role properties and the view raises a 500
    instead of a 401. That is what these cover.
    """

    def test_appointment_list(self, api_client, frozen_clock):
        assert api_client.get("/api/appointments/").status_code == 401

    def test_appointment_detail(self, api_client, booked_appointment, frozen_clock):
        response = api_client.get(f"/api/appointments/{booked_appointment.pk}/")
        assert response.status_code == 401

    def test_appointment_create(self, api_client, provider, first_slot, frozen_clock):
        response = api_client.post(
            "/api/appointments/",
            {"provider": provider.pk, "start_at": iso(first_slot)},
            format="json",
        )
        assert response.status_code == 401
        assert not Appointment.objects.exists()

    def test_appointment_cancel(self, api_client, booked_appointment, frozen_clock):
        response = api_client.post(
            f"/api/appointments/{booked_appointment.pk}/cancel/", {}, format="json"
        )
        assert response.status_code == 401
        booked_appointment.refresh_from_db()
        assert booked_appointment.status == AppointmentStatus.SCHEDULED

    def test_provider_list_and_detail(self, api_client, provider, frozen_clock):
        assert api_client.get("/api/providers/").status_code == 401
        assert api_client.get(f"/api/providers/{provider.pk}/").status_code == 401

    def test_availability(self, api_client, frozen_clock):
        assert api_client.get("/api/availability/").status_code == 401

    def test_time_off(self, api_client, frozen_clock):
        assert api_client.get("/api/time-off/").status_code == 401


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
        booked_minutes = (
            appointment.end_at - appointment.start_at
        ).total_seconds() / 60
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


class TestLostRaceHandling:
    """The branch that runs when validation passed but the write lost a race.

    Ordinary tests can never reach it: validation rejects a taken slot long
    before the insert. The failure is injected here so the handler is covered,
    while TestConcurrentBooking proves the races themselves are real.
    """

    class DriverError(Exception):
        """Stands in for the psycopg error Django wraps, which carries the
        SQLSTATE the handler keys off."""

        def __init__(self, sqlstate):
            super().__init__(sqlstate)
            self.sqlstate = sqlstate

    def _raising(self, exc_class, sqlstate):
        error = exc_class("simulated")
        error.__cause__ = self.DriverError(sqlstate)
        return error

    def _book(self, client, provider, start):
        return client.post(
            "/api/appointments/",
            {"provider": provider.pk, "start_at": iso(start)},
            format="json",
        )

    @pytest.mark.parametrize(
        "exc_class,sqlstate,label",
        [
            (IntegrityError, "23P01", "exclusion constraint"),
            (OperationalError, "40P01", "deadlock"),
            (OperationalError, "40001", "serialization failure"),
        ],
    )
    def test_a_lost_race_becomes_a_readable_error(
        self,
        patient_client,
        provider,
        first_slot,
        frozen_clock,
        exc_class,
        sqlstate,
        label,
    ):
        with patch.object(
            ModelSerializer, "create", side_effect=self._raising(exc_class, sqlstate)
        ):
            response = self._book(patient_client, provider, first_slot)

        assert response.status_code == 400, label
        assert "start_at" in response.data
        assert not Appointment.objects.exists()

    def test_an_unrelated_database_error_is_not_swallowed(
        self, patient_client, provider, first_slot, frozen_clock
    ):
        """A dropped connection must not be reported as a taken slot."""
        connection_failure = self._raising(OperationalError, "08006")

        with patch.object(ModelSerializer, "create", side_effect=connection_failure):
            with pytest.raises(OperationalError):
                self._book(patient_client, provider, first_slot)


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


class TestProviderDirectory:
    """ProviderViewSet's own routes, which nothing covered before."""

    def test_lists_every_provider(
        self, patient_client, provider, other_provider, frozen_clock
    ):
        response = patient_client.get("/api/providers/")

        assert response.status_code == 200
        ids = {row["id"] for row in response.data["results"]}
        assert ids == {provider.pk, other_provider.pk}

    def test_retrieves_one_provider(self, patient_client, provider, frozen_clock):
        response = patient_client.get(f"/api/providers/{provider.pk}/")

        assert response.status_code == 200
        assert response.data["full_name"] == provider.user.get_full_name()
        assert response.data["timezone"] == provider.user.timezone

    def test_filters_by_specialty(
        self,
        patient_client,
        provider,
        other_provider,
        other_provider_spec,
        frozen_clock,
    ):
        response = patient_client.get(
            "/api/providers/", {"specialty": other_provider_spec.specialty}
        )

        ids = [row["id"] for row in response.data["results"]]
        assert ids == [other_provider.pk]

    def test_filters_by_whether_they_are_accepting_patients(
        self, patient_client, provider, other_provider, frozen_clock
    ):
        other_provider.accepting_new_patients = False
        other_provider.save()

        response = patient_client.get(
            "/api/providers/", {"accepting_new_patients": "true"}
        )

        ids = [row["id"] for row in response.data["results"]]
        assert ids == [provider.pk]

    def test_does_not_expose_internal_scheduling_settings(
        self, patient_client, provider, frozen_clock
    ):
        """Patients get ProviderPublicSerializer, not the full profile."""
        response = patient_client.get(f"/api/providers/{provider.pk}/")

        for internal in (
            "booking_horizon_days",
            "min_notice_minutes",
            "buffer_minutes",
        ):
            assert internal not in response.data


class TestAppointmentFiltering:
    def test_filters_by_status(
        self, patient_client, provider, provider_spec, patient, monday, frozen_clock
    ):
        cancelled_start = slot_at(monday, provider_spec, index=4)
        cancelled = Appointment.objects.create(
            provider=provider,
            patient=patient,
            start_at=cancelled_start,
            end_at=cancelled_start + timedelta(minutes=provider_spec.slot_minutes),
            status=AppointmentStatus.CANCELLED,
        )
        scheduled_start = slot_at(monday, provider_spec, index=6)
        scheduled = Appointment.objects.create(
            provider=provider,
            patient=patient,
            start_at=scheduled_start,
            end_at=scheduled_start + timedelta(minutes=provider_spec.slot_minutes),
        )

        response = patient_client.get(
            "/api/appointments/", {"status": AppointmentStatus.SCHEDULED}
        )

        ids = [row["id"] for row in response.data["results"]]
        assert ids == [scheduled.pk]
        assert cancelled.pk not in ids

    def test_filtering_does_not_widen_the_scope(
        self, other_patient_client, booked_appointment, frozen_clock
    ):
        """A filter must never reach past the caller's own queryset."""
        response = other_patient_client.get(
            "/api/appointments/", {"status": AppointmentStatus.SCHEDULED}
        )

        assert response.data["results"] == []


class TestPagination:
    """List endpoints are paginated, but nothing tested past the first page."""

    @pytest.fixture
    def page_size(self):
        return settings.REST_FRAMEWORK["PAGE_SIZE"]

    @pytest.fixture
    def a_full_diary(self, provider, provider_spec, patient, monday):
        """Two Mondays of back-to-back appointments: more than one page."""
        appointments = []
        for week in (0, 1):
            day = monday + timedelta(days=7 * week)
            for index in range(provider_spec.slot_count):
                start = slot_at(day, provider_spec, index)
                appointments.append(
                    Appointment(
                        provider=provider,
                        patient=patient,
                        start_at=start,
                        end_at=start + timedelta(minutes=provider_spec.slot_minutes),
                    )
                )
        Appointment.objects.bulk_create(appointments)
        return len(appointments)

    def test_first_page_is_capped_and_reports_the_total(
        self, patient_client, a_full_diary, page_size, frozen_clock
    ):
        response = patient_client.get("/api/appointments/")

        assert response.data["count"] == a_full_diary
        assert len(response.data["results"]) == page_size
        assert response.data["next"] is not None

    def test_the_remainder_is_on_the_following_page(
        self, patient_client, a_full_diary, page_size, frozen_clock
    ):
        response = patient_client.get("/api/appointments/", {"page": 2})

        assert len(response.data["results"]) == a_full_diary - page_size
        assert response.data["next"] is None

    def test_pages_do_not_overlap(self, patient_client, a_full_diary, frozen_clock):
        """Ordering is stable, so no appointment appears on both pages."""
        first = patient_client.get("/api/appointments/").data["results"]
        second = patient_client.get("/api/appointments/", {"page": 2}).data["results"]

        first_ids = {row["id"] for row in first}
        second_ids = {row["id"] for row in second}
        assert not (first_ids & second_ids)
        assert len(first_ids | second_ids) == a_full_diary


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
        response = other_patient_client.get(
            f"/api/appointments/{booked_appointment.pk}/"
        )

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
