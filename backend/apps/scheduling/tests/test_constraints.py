"""Database-level integrity.

These assert on Postgres, not on Python: the point of the exclusion constraint
is that double-booking is impossible even when application validation is
bypassed or loses a race.

Every failing write is wrapped in transaction.atomic(). An IntegrityError
aborts the surrounding transaction, and pytest-django runs each test inside
one, so without an inner savepoint the following line fails with
TransactionManagementError instead of the assertion under test.
"""
import threading
from datetime import date, time, timedelta

import pytest
from django.db import IntegrityError, OperationalError, connection, transaction
from django.db.models import ProtectedError

from apps.scheduling.models import (
    Appointment,
    AppointmentStatus,
    AvailabilityRule,
    TimeOff,
    Weekday,
)
from testkit import slot_at, utc

pytestmark = pytest.mark.django_db


class TestNoDoubleBooking:
    """booked_appointment occupies 15:00-15:30 UTC (10:00-10:30 New York).

    Some tests request that fixture without referencing it: they need the row
    to exist so the write under test collides with it, which is the fixture's
    whole contribution.
    """

    def test_overlapping_active_appointment_is_rejected(
        self, provider, other_patient, booked_appointment
    ):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Appointment.objects.create(
                    provider=provider,
                    patient=other_patient,
                    start_at=utc(2026, 3, 2, 15, 15),  # straddles the booking
                    end_at=utc(2026, 3, 2, 15, 45),
                )

    def test_identical_times_are_rejected(
        self, provider, other_patient, booked_appointment
    ):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Appointment.objects.create(
                    provider=provider,
                    patient=other_patient,
                    start_at=booked_appointment.start_at,
                    end_at=booked_appointment.end_at,
                )

    def test_fully_contained_appointment_is_rejected(
        self, provider, other_patient, booked_appointment
    ):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Appointment.objects.create(
                    provider=provider,
                    patient=other_patient,
                    start_at=utc(2026, 3, 2, 15, 10),
                    end_at=utc(2026, 3, 2, 15, 20),
                )

    def test_back_to_back_appointments_are_allowed(
        self, provider, provider_spec, other_patient, booked_appointment
    ):
        """The constraint uses '[)' bounds, so touching is not overlapping.

        If this ever fails, consecutive slots have become unbookable.
        """
        immediately_after = Appointment.objects.create(
            provider=provider,
            patient=other_patient,
            start_at=booked_appointment.end_at,
            end_at=booked_appointment.end_at
            + timedelta(minutes=provider_spec.slot_minutes),
        )

        assert immediately_after.pk is not None

    def test_a_different_provider_may_use_the_same_time(
        self, other_provider, other_patient, booked_appointment
    ):
        """The constraint is scoped per provider, not global."""
        concurrent = Appointment.objects.create(
            provider=other_provider,
            patient=other_patient,
            start_at=booked_appointment.start_at,
            end_at=booked_appointment.end_at,
        )

        assert concurrent.pk is not None


class TestCancelledAppointmentsDoNotBlock:
    """The constraint is partial: condition=Q(status__in=ACTIVE_STATUSES)."""

    def test_a_cancelled_appointment_may_overlap_an_active_one(
        self, provider, other_patient, booked_appointment
    ):
        cancelled = Appointment.objects.create(
            provider=provider,
            patient=other_patient,
            start_at=booked_appointment.start_at,
            end_at=booked_appointment.end_at,
            status=AppointmentStatus.CANCELLED,
            cancelled_at=utc(2026, 3, 1, 12, 0),
        )

        assert cancelled.pk is not None

    def test_cancelling_frees_the_slot_for_rebooking(
        self, provider, other_patient, booked_appointment
    ):
        """Without the partial condition, a patient could never rebook a slot
        they had just cancelled."""
        booked_appointment.status = AppointmentStatus.CANCELLED
        booked_appointment.save()

        rebooked = Appointment.objects.create(
            provider=provider,
            patient=other_patient,
            start_at=booked_appointment.start_at,
            end_at=booked_appointment.end_at,
        )

        assert rebooked.pk is not None

    def test_a_completed_appointment_still_blocks(
        self, provider, other_patient, booked_appointment
    ):
        """Completed time is history that happened; it stays occupied."""
        booked_appointment.status = AppointmentStatus.COMPLETED
        booked_appointment.save()

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Appointment.objects.create(
                    provider=provider,
                    patient=other_patient,
                    start_at=booked_appointment.start_at,
                    end_at=booked_appointment.end_at,
                )


class TestOverlapOnUpdate:
    """Exclusion constraints police UPDATE as well as INSERT.

    Only inserts were covered before, which is the weaker half: a reschedule
    feature moves an existing row rather than creating one.
    """

    def test_moving_an_appointment_onto_another_is_rejected(
        self, provider, provider_spec, other_patient, monday, booked_appointment
    ):
        later_start = slot_at(monday, provider_spec, index=6)
        later = Appointment.objects.create(
            provider=provider,
            patient=other_patient,
            start_at=later_start,
            end_at=later_start + timedelta(minutes=provider_spec.slot_minutes),
        )

        later.start_at = booked_appointment.start_at
        later.end_at = booked_appointment.end_at

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                later.save()

    def test_reinstating_a_cancelled_appointment_into_a_conflict_is_rejected(
        self, provider, other_patient, booked_appointment
    ):
        """Un-cancelling is an update that re-enters the constraint's condition.

        The slot was freed and taken by someone else in the meantime, so the
        original cannot simply be switched back to scheduled.
        """
        cancelled = Appointment.objects.create(
            provider=provider,
            patient=other_patient,
            start_at=booked_appointment.start_at,
            end_at=booked_appointment.end_at,
            status=AppointmentStatus.CANCELLED,
        )

        cancelled.status = AppointmentStatus.SCHEDULED

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                cancelled.save()

    def test_moving_an_appointment_to_a_free_slot_is_allowed(
        self, provider, provider_spec, monday, booked_appointment
    ):
        """The constraint must not block an ordinary reschedule."""
        target = slot_at(monday, provider_spec, index=8)

        booked_appointment.start_at = target
        booked_appointment.end_at = target + timedelta(
            minutes=provider_spec.slot_minutes
        )
        booked_appointment.save()

        booked_appointment.refresh_from_db()
        assert booked_appointment.start_at == target


class TestBypassAttempts:
    """The constraint holds regardless of how the write is issued.

    Every other test here goes through Model.objects.create(). These use the
    paths that skip model save() and any application validation entirely --
    which is the whole reason for pushing the rule into the database.
    """

    def test_bulk_create_cannot_smuggle_in_an_overlap(
        self, provider, other_patient, booked_appointment
    ):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Appointment.objects.bulk_create(
                    [
                        Appointment(
                            provider=provider,
                            patient=other_patient,
                            start_at=booked_appointment.start_at,
                            end_at=booked_appointment.end_at,
                        )
                    ]
                )

    def test_two_overlapping_rows_in_one_bulk_create_are_rejected(
        self, provider, provider_spec, patient, other_patient, monday
    ):
        """Both rows arrive in a single statement, so nothing in Python sees
        the conflict -- only the database does."""
        start = slot_at(monday, provider_spec, index=2)
        end = start + timedelta(minutes=provider_spec.slot_minutes)

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Appointment.objects.bulk_create(
                    [
                        Appointment(
                            provider=provider, patient=patient,
                            start_at=start, end_at=end,
                        ),
                        Appointment(
                            provider=provider, patient=other_patient,
                            start_at=start, end_at=end,
                        ),
                    ]
                )

        assert not Appointment.objects.exists()

    def test_queryset_update_cannot_create_an_overlap(
        self, provider, provider_spec, other_patient, monday, booked_appointment
    ):
        """queryset.update() issues raw SQL and never calls save()."""
        later_start = slot_at(monday, provider_spec, index=6)
        later = Appointment.objects.create(
            provider=provider,
            patient=other_patient,
            start_at=later_start,
            end_at=later_start + timedelta(minutes=provider_spec.slot_minutes),
        )

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Appointment.objects.filter(pk=later.pk).update(
                    start_at=booked_appointment.start_at,
                    end_at=booked_appointment.end_at,
                )

    def test_queryset_update_cannot_reactivate_into_a_conflict(
        self, provider, other_patient, booked_appointment
    ):
        cancelled = Appointment.objects.create(
            provider=provider,
            patient=other_patient,
            start_at=booked_appointment.start_at,
            end_at=booked_appointment.end_at,
            status=AppointmentStatus.CANCELLED,
        )

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Appointment.objects.filter(pk=cancelled.pk).update(
                    status=AppointmentStatus.SCHEDULED
                )


class TestConcurrentBooking:
    """The race the exclusion constraint actually exists for.

    Application validation reads the database and then writes to it. Two
    patients requesting the last slot can both pass validation before either
    commits, so only a database-level rule can decide the winner.

    transaction=True is required: the other tests here run inside a single
    transaction that never commits, so a second connection could not observe
    anything. This uses real commits, and Django opens one connection per
    thread.
    """

    @pytest.mark.django_db(transaction=True)
    def test_only_one_of_two_simultaneous_bookings_survives(
        self, provider, provider_spec, patient, other_patient, monday
    ):
        start = slot_at(monday, provider_spec, index=2)
        end = start + timedelta(minutes=provider_spec.slot_minutes)

        # Both threads reach the barrier before either inserts, so neither can
        # quietly finish first and turn this into a sequential test.
        ready = threading.Barrier(2, timeout=10)
        outcomes = []

        def book(user):
            try:
                with transaction.atomic():
                    ready.wait()
                    Appointment.objects.create(
                        provider=provider, patient=user, start_at=start, end_at=end
                    )
                outcomes.append("booked")
            except (IntegrityError, OperationalError):
                # Losing takes one of two shapes depending on how tightly the
                # two inserts interleave: the loser blocks and then trips the
                # exclusion constraint (IntegrityError), or both insert first
                # and each ends up waiting on the other's uncommitted row, so
                # Postgres breaks the deadlock (OperationalError). The API
                # treats both as "that slot was just taken".
                outcomes.append("rejected")
            finally:
                connection.close()

        threads = [
            threading.Thread(target=book, args=(user,))
            for user in (patient, other_patient)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)

        assert sorted(outcomes) == ["booked", "rejected"]
        assert Appointment.objects.count() == 1


class TestOrderedIntervals:
    """CHECK constraints: an interval cannot end before it starts."""

    def test_appointment_may_not_end_before_it_starts(self, provider, patient):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Appointment.objects.create(
                    provider=provider,
                    patient=patient,
                    start_at=utc(2026, 3, 2, 16, 0),
                    end_at=utc(2026, 3, 2, 15, 0),
                )

    def test_zero_length_appointment_is_rejected(self, provider, patient):
        moment = utc(2026, 3, 2, 15, 0)
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Appointment.objects.create(
                    provider=provider, patient=patient, start_at=moment, end_at=moment
                )

    def test_availability_may_not_end_before_it_starts(self, provider):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                AvailabilityRule.objects.create(
                    provider=provider,
                    weekday=Weekday.TUESDAY,
                    start_time=time(17, 0),
                    end_time=time(9, 0),
                    valid_from=date(2026, 1, 1),
                )

    def test_time_off_may_not_end_before_it_starts(self, provider):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                TimeOff.objects.create(
                    provider=provider,
                    start_at=utc(2026, 3, 2, 16, 0),
                    end_at=utc(2026, 3, 2, 15, 0),
                )


class TestDuplicateAvailability:
    def test_identical_window_is_rejected(self, provider):
        existing = provider.availability_rules.get()

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                AvailabilityRule.objects.create(
                    provider=provider,
                    weekday=existing.weekday,
                    start_time=existing.start_time,
                    end_time=existing.end_time,
                    valid_from=existing.valid_from,
                )

    def test_same_window_from_a_later_date_is_allowed(self, provider):
        """valid_from is part of the key, so hours can be re-declared later."""
        existing = provider.availability_rules.get()
        a_year_later = existing.valid_from + timedelta(days=365)

        successor = AvailabilityRule.objects.create(
            provider=provider,
            weekday=existing.weekday,
            start_time=existing.start_time,
            end_time=existing.end_time,
            valid_from=a_year_later,
        )

        assert successor.pk is not None


class TestReferentialProtection:
    def test_deleting_a_patient_with_history_is_blocked(
        self, patient, booked_appointment
    ):
        """on_delete=PROTECT: an admin misclick must not erase clinical history."""
        with pytest.raises(ProtectedError):
            with transaction.atomic():
                patient.delete()

        assert Appointment.objects.filter(pk=booked_appointment.pk).exists()
