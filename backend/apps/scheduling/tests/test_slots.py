"""Slot generation: the expansion of weekly rules into bookable instants.

Expected counts come from the ProviderSpec the fixture was built from, so no
assertion contains a bare number whose derivation the reader has to reconstruct.
Where a count cannot come from the window -- the DST transition days, where wall
clock and real elapsed time disagree -- the real hours are stated explicitly and
the discrepancy is the point of the test.
"""

from dataclasses import replace
from datetime import date, time, timedelta

import pytest

from apps.scheduling.models import (
    Appointment,
    AppointmentStatus,
    AvailabilityRule,
    TimeOff,
    Weekday,
)
from apps.scheduling.services.slots import generate_slots
from testkit import (
    ADELAIDE,
    KOLKATA,
    LA,
    NY,
    hhmm,
    local_ends,
    local_starts,
    slot_at,
    utc,
)

pytestmark = pytest.mark.django_db


class TestWindowExpansion:
    def test_full_day_is_divided_into_slots(
        self, provider, provider_spec, monday, frozen_clock
    ):
        slots = generate_slots(provider, monday, monday)

        assert len(slots) == provider_spec.slot_count
        assert local_starts(slots)[0] == hhmm(provider_spec.opens)
        assert local_ends(slots)[-1] == hhmm(provider_spec.closes)

    def test_trailing_remainder_is_not_offered(
        self, provider, provider_spec, monday, frozen_clock
    ):
        """Extending the window by half a slot adds no slot."""
        rule = provider.availability_rules.get()
        rule.end_time = time(17, 15)  # 15 minutes past close, half a slot
        rule.save()

        slots = generate_slots(provider, monday, monday)

        assert len(slots) == provider_spec.slot_count
        assert local_ends(slots)[-1] == hhmm(provider_spec.closes)

    def test_a_shorter_window_yields_proportionally_fewer_slots(
        self, provider, provider_spec, monday, frozen_clock
    ):
        # The spec variant describes the provider after the change, so the
        # expected count derives itself rather than being worked out by hand.
        shortened = replace(provider_spec, closes=time(12, 0))
        rule = provider.availability_rules.get()
        rule.end_time = shortened.closes
        rule.save()

        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == shortened.slot_count
        assert "12:00" not in starts

    def test_split_day_leaves_the_lunch_gap_empty(
        self, provider, provider_spec, monday, frozen_clock
    ):
        """A real schedule is two windows with a break, not one block."""
        morning_spec = replace(provider_spec, closes=time(12, 0))
        afternoon_spec = replace(provider_spec, opens=time(13, 0), closes=time(17, 0))

        morning = provider.availability_rules.get()
        morning.end_time = morning_spec.closes
        morning.save()
        AvailabilityRule.objects.create(
            provider=provider,
            weekday=Weekday.MONDAY,
            start_time=afternoon_spec.opens,
            end_time=afternoon_spec.closes,
            valid_from=date(2020, 1, 1),
        )

        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == morning_spec.slot_count + afternoon_spec.slot_count
        assert "11:30" in starts
        assert "13:00" in starts
        assert not any(s.startswith("12:") for s in starts)  # the break

    def test_non_working_day_has_no_slots(self, provider, monday, frozen_clock):
        tuesday = monday + timedelta(days=1)
        assert generate_slots(provider, tuesday, tuesday) == []

    def test_provider_with_no_rules_has_no_slots(self, provider, monday, frozen_clock):
        provider.availability_rules.all().delete()
        assert generate_slots(provider, monday, monday) == []

    def test_inverted_range_returns_nothing(self, provider, monday, frozen_clock):
        assert generate_slots(provider, monday, monday - timedelta(days=1)) == []


class TestMultiDayRanges:
    def test_a_fortnight_covers_both_working_days(
        self, provider, provider_spec, monday, frozen_clock
    ):
        """The provider works Mondays only, so 14 days contains two of them."""
        slots = generate_slots(provider, monday, monday + timedelta(days=7))

        assert len(slots) == provider_spec.slot_count * 2

    def test_results_are_ordered_by_start(self, provider, monday, frozen_clock):
        slots = generate_slots(provider, monday, monday + timedelta(days=7))

        starts = [s.start_at for s in slots]
        assert starts == sorted(starts)


class TestRuleValidityWindow:
    """valid_from / valid_until are how a provider changes hours without
    rewriting the history that explains existing bookings."""

    def test_rule_not_yet_in_effect_produces_nothing(
        self, provider, monday, frozen_clock
    ):
        rule = provider.availability_rules.get()
        rule.valid_from = monday + timedelta(days=1)
        rule.save()

        assert generate_slots(provider, monday, monday) == []

    def test_expired_rule_produces_nothing(self, provider, monday, frozen_clock):
        rule = provider.availability_rules.get()
        rule.valid_until = monday - timedelta(days=1)
        rule.save()

        assert generate_slots(provider, monday, monday) == []

    def test_validity_bounds_are_inclusive(
        self, provider, provider_spec, monday, frozen_clock
    ):
        """A rule valid exactly on the requested day still applies."""
        rule = provider.availability_rules.get()
        rule.valid_from = monday
        rule.valid_until = monday
        rule.save()

        assert len(generate_slots(provider, monday, monday)) == provider_spec.slot_count

    def test_superseded_rule_stops_at_its_end_date(
        self, provider, provider_spec, monday, frozen_clock
    ):
        """Old hours end, new shorter hours begin the following week."""
        new_hours = replace(provider_spec, opens=time(10, 0), closes=time(14, 0))

        old = provider.availability_rules.get()
        old.valid_until = monday
        old.save()
        AvailabilityRule.objects.create(
            provider=provider,
            weekday=Weekday.MONDAY,
            start_time=new_hours.opens,
            end_time=new_hours.closes,
            valid_from=monday + timedelta(days=1),
        )
        next_monday = monday + timedelta(days=7)

        this_week = generate_slots(provider, monday, monday)
        next_week = generate_slots(provider, next_monday, next_monday)

        assert len(this_week) == provider_spec.slot_count
        assert len(next_week) == new_hours.slot_count
        assert local_starts(next_week)[0] == hhmm(new_hours.opens)


class TestSubtraction:
    def test_booked_time_is_removed(
        self, provider, provider_spec, monday, booked_appointment, frozen_clock
    ):
        """The 10:00 booking removes exactly the 10:00 slot."""
        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == provider_spec.slot_count - 1
        assert "10:00" not in starts

    def test_cancelled_booking_frees_its_slot(
        self, provider, provider_spec, monday, booked_appointment, frozen_clock
    ):
        booked_appointment.status = AppointmentStatus.CANCELLED
        booked_appointment.save()

        slots = generate_slots(provider, monday, monday)

        assert len(slots) == provider_spec.slot_count

    def test_time_off_is_removed(
        self, provider, provider_spec, monday, time_off, frozen_clock
    ):
        """The blocked window removes exactly the slots it covers."""
        blocked_minutes = (time_off.end_at - time_off.start_at).total_seconds() / 60
        covered = int(blocked_minutes // provider_spec.slot_minutes)

        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == provider_spec.slot_count - covered
        assert "15:00" not in starts
        assert "15:30" not in starts

    def test_buffer_widens_the_blocked_window(
        self, buffered_provider, buffered_provider_spec, patient, monday, frozen_clock
    ):
        """15 minutes of buffer on each side of a 10:00-10:30 booking blocks
        09:45-10:45, which intersects three slots rather than one.

        The surviving slots stay on the original grid: a buffer removes slots,
        it does not shift them.
        """
        spec = buffered_provider_spec
        start = slot_at(monday, spec, index=2)
        Appointment.objects.create(
            provider=buffered_provider,
            patient=patient,
            start_at=start,
            end_at=start + timedelta(minutes=spec.slot_minutes),
        )

        starts = local_starts(generate_slots(buffered_provider, monday, monday))

        blocked = ("09:30", "10:00", "10:30")
        assert len(starts) == spec.slot_count - len(blocked)
        for slot in blocked:
            assert slot not in starts
        assert "11:00" in starts  # unmoved


class TestBoundaries:
    """Everything here is half-open: touching is not overlapping.

    Slot.overlaps uses `a_start < b_end and b_start < a_end`, matching the
    '[)' bounds on the database exclusion constraint. Turning either into <=
    would silently destroy back-to-back booking, so these are the tests that
    pin that behaviour down.
    """

    def test_booking_ending_exactly_at_a_slot_start_does_not_block_it(
        self, provider, monday, booked_appointment, frozen_clock
    ):
        # booked_appointment is 10:00-10:30 local.
        starts = local_starts(generate_slots(provider, monday, monday))

        assert "10:00" not in starts
        assert "10:30" in starts  # abuts the booking, does not overlap it

    def test_booking_starting_exactly_at_a_slot_end_does_not_block_it(
        self, provider, monday, booked_appointment, frozen_clock
    ):
        starts = local_starts(generate_slots(provider, monday, monday))

        assert "09:30" in starts  # ends exactly when the 10:00 booking starts

    def test_time_off_abutting_a_slot_leaves_it_bookable(
        self, provider, provider_spec, monday, frozen_clock
    ):
        """Exactly the opening slot: 09:00-09:30, aligned to the grid."""
        opening = slot_at(monday, provider_spec, index=0)
        TimeOff.objects.create(
            provider=provider,
            start_at=opening,
            end_at=opening + timedelta(minutes=provider_spec.slot_minutes),
        )

        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == provider_spec.slot_count - 1
        assert "09:00" not in starts
        assert "09:30" in starts

    def test_partial_overlap_removes_both_touched_slots(
        self, provider, provider_spec, monday, frozen_clock
    ):
        """Half a slot late and half a slot long: covers neither the 09:00 nor
        the 09:30 slot fully, but intersects both."""
        half_slot = timedelta(minutes=provider_spec.slot_minutes / 2)
        start = slot_at(monday, provider_spec, index=0) + half_slot
        TimeOff.objects.create(
            provider=provider, start_at=start, end_at=start + 2 * half_slot
        )

        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == provider_spec.slot_count - 2
        assert "09:00" not in starts
        assert "09:30" not in starts
        assert "10:00" in starts

    def test_one_minute_of_overlap_is_enough_to_block(
        self, provider, provider_spec, monday, frozen_clock
    ):
        """Straddles a slot boundary by a minute on each side, clipping the
        end of one slot and the start of the next."""
        minute = timedelta(minutes=1)
        boundary = slot_at(monday, provider_spec, index=1)
        TimeOff.objects.create(
            provider=provider, start_at=boundary - minute, end_at=boundary + minute
        )

        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == provider_spec.slot_count - 2
        assert "09:00" not in starts
        assert "09:30" not in starts
        assert "10:00" in starts


class TestNoticeAndHorizon:
    def test_minimum_notice_hides_imminent_slots(
        self, notice_provider, notice_provider_spec, monday, frozen_clock
    ):
        """Now is 07:00 local. Four hours notice makes 11:00 the earliest
        bookable time, leaving the 11:00-17:00 remainder of the day."""
        starts = local_starts(generate_slots(notice_provider, monday, monday))

        assert starts[0] == "11:00"
        assert len(starts) == notice_provider_spec.slots_in_hours(6)

    def test_booking_horizon_clamps_the_range(self, provider, monday, frozen_clock):
        horizon_days = 3
        provider.booking_horizon_days = horizon_days
        provider.save()

        slots = generate_slots(provider, monday, monday + timedelta(days=60))

        assert slots
        latest = max(s.start_at for s in slots).astimezone(NY).date()
        assert latest <= monday + timedelta(days=horizon_days)


class TestQueryCount:
    """Slot generation runs on every calendar page load.

    It fetches rules, time off and bookings once each and expands them in
    Python, so the query count must not grow with the size of the range. These
    are the guard against someone reintroducing a per-day query.
    """

    EXPECTED_QUERIES = 3  # availability rules, time off, active appointments

    def test_generation_uses_a_fixed_number_of_queries(
        self, provider, monday, frozen_clock, django_assert_num_queries
    ):
        with django_assert_num_queries(self.EXPECTED_QUERIES):
            generate_slots(provider, monday, monday)

    def test_a_longer_range_costs_no_extra_queries(
        self, provider, monday, frozen_clock, django_assert_num_queries
    ):
        with django_assert_num_queries(self.EXPECTED_QUERIES):
            generate_slots(provider, monday, monday + timedelta(days=56))

    def test_existing_bookings_cost_no_extra_queries(
        self,
        provider,
        monday,
        booked_appointment,
        time_off,
        frozen_clock,
        django_assert_num_queries,
    ):
        with django_assert_num_queries(self.EXPECTED_QUERIES):
            generate_slots(provider, monday, monday + timedelta(days=56))


class TestClinicTimezone:
    """The clinic's timezone drives everything, not the server's UTC."""

    @pytest.mark.parametrize(
        "provider_fixture,spec_fixture",
        [
            ("provider", "provider_spec"),
            ("other_provider", "other_provider_spec"),
            ("kolkata_provider", "kolkata_provider_spec"),
        ],
    )
    def test_every_slot_is_exactly_one_slot_long(
        self, request, provider_fixture, spec_fixture, monday, frozen_clock
    ):
        """Whatever the zone or slot length, no slot is short or long.

        Uses the following Monday because the frozen instant (12:00 UTC) is
        already 17:30 in Kolkata, so that provider's working day has ended.
        """
        provider = request.getfixturevalue(provider_fixture)
        spec = request.getfixturevalue(spec_fixture)
        next_monday = monday + timedelta(days=7)

        slots = generate_slots(provider, next_monday, next_monday)

        assert slots
        durations = {s.end_at - s.start_at for s in slots}
        assert durations == {timedelta(minutes=spec.slot_minutes)}

    def test_half_hour_offset_zones_are_handled(
        self, kolkata_provider, kolkata_provider_spec, monday, frozen_clock
    ):
        """UTC+5:30 catches anything that assumes whole-hour offsets.

        The following Monday, not the frozen one: 12:00 UTC is already 17:30 in
        Kolkata, so that day's window has closed and correctly yields nothing.
        """
        next_monday = monday + timedelta(days=7)

        slots = generate_slots(kolkata_provider, next_monday, next_monday)

        assert len(slots) == kolkata_provider_spec.slot_count
        assert local_starts(slots, KOLKATA)[0] == hhmm(kolkata_provider_spec.opens)
        # 09:00 in Kolkata is 03:30 UTC, not 03:00 or 04:00.
        assert slots[0].start_at == utc(2026, 3, 9, 3, 30)

    def test_a_day_already_over_in_the_providers_zone_yields_nothing(
        self, kolkata_provider, monday, frozen_clock
    ):
        """The corollary: 12:00 UTC is past closing time in Kolkata."""
        assert generate_slots(kolkata_provider, monday, monday) == []

    def test_a_pacific_clinic_generates_pacific_local_hours(
        self, other_provider, other_provider_spec, monday, frozen_clock, settings
    ):
        settings.CLINIC_TIMEZONE = LA.key

        slots = generate_slots(other_provider, monday, monday)

        assert len(slots) == other_provider_spec.slot_count
        assert local_starts(slots, LA)[0] == hhmm(other_provider_spec.opens)
        assert local_ends(slots, LA)[-1] == hhmm(other_provider_spec.closes)

    def test_a_pacific_clinic_maps_to_the_right_utc_instant(
        self, other_provider, monday, frozen_clock, settings
    ):
        """2 March is before the 2026 transition, so Los Angeles is on PST
        (UTC-8) and a 10:00 opening is 18:00 UTC.

        A bug reading the provider's display preference instead of the clinic
        zone would put this at 15:00 UTC, since the fixture user displays in
        Eastern.
        """
        settings.CLINIC_TIMEZONE = LA.key

        slots = generate_slots(other_provider, monday, monday)

        assert slots[0].start_at == utc(2026, 3, 2, 18, 0)

    def test_two_providers_at_one_clinic_do_not_interfere(
        self,
        provider,
        provider_spec,
        other_provider,
        other_provider_spec,
        monday,
        frozen_clock,
    ):
        """Same zone, different windows and slot lengths.

        They share a clinic zone by construction now, so what is left to leak
        between them is the window and the slot length -- which the two specs
        deliberately disagree about.
        """
        first = generate_slots(provider, monday, monday)
        second = generate_slots(other_provider, monday, monday)

        assert len(first) == provider_spec.slot_count
        assert len(second) == other_provider_spec.slot_count
        assert local_starts(first)[0] == hhmm(provider_spec.opens)
        assert local_starts(second)[0] == hhmm(other_provider_spec.opens)


class TestHoursAreClinicLocal:
    """A provider's display preference must not move their working hours.

    These were one field once, so changing how a provider wanted times *shown*
    silently reinterpreted every AvailabilityRule and moved their whole week.
    The zone that hours are written in now belongs to the clinic, which is the
    only thing a provider cannot change about it.
    """

    def test_the_display_preference_cannot_move_a_single_slot(
        self, provider, provider_spec, monday, frozen_clock
    ):
        before = generate_slots(provider, monday, monday)

        provider.user.timezone = "Asia/Kolkata"
        provider.user.save()
        provider.refresh_from_db()

        after = generate_slots(provider, monday, monday)

        assert [slot.start_at for slot in after] == [slot.start_at for slot in before]
        assert local_starts(after)[0] == hhmm(provider_spec.opens)

    def test_hours_are_read_in_the_clinic_zone(
        self, provider, provider_spec, monday, frozen_clock, settings
    ):
        """Moving the clinic moves everyone's hours, which is the intent."""
        before = generate_slots(provider, monday, monday)

        settings.CLINIC_TIMEZONE = LA.key

        after = generate_slots(provider, monday, monday)

        # Still opening at 9, but 9am Pacific -- three hours later in real time.
        assert local_starts(after, LA)[0] == hhmm(provider_spec.opens)
        assert after[0].start_at - before[0].start_at == timedelta(hours=3)

    def test_every_provider_reads_the_same_zone(
        self, provider, other_provider, settings
    ):
        settings.CLINIC_TIMEZONE = LA.key

        assert provider.timezone == LA.key
        assert other_provider.timezone == LA.key


class TestDaylightSaving:
    """The only place wall-clock arithmetic and real elapsed time disagree.

    The dst_provider works 01:00-05:00, which is four hours on an ordinary
    Sunday. On the transition days it is three or five, and the expected counts
    below say which and why -- deriving them from the window would assume away
    the very thing under test.
    """

    SPRING_FORWARD = date(2026, 3, 8)  # 02:00 -> 03:00, one hour vanishes
    FALL_BACK = date(2026, 11, 1)  # 02:00 -> 01:00, one hour repeats

    def test_no_slot_is_offered_in_the_missing_hour(self, dst_provider, frozen_clock):
        slots = generate_slots(dst_provider, self.SPRING_FORWARD, self.SPRING_FORWARD)

        assert not any(s.startswith("02:") for s in local_starts(slots))

    def test_spring_forward_day_loses_an_hour(
        self, dst_provider, dst_provider_spec, frozen_clock
    ):
        """The 02:00 hour never happens, so the window is three real hours."""
        slots = generate_slots(dst_provider, self.SPRING_FORWARD, self.SPRING_FORWARD)

        assert len(slots) == dst_provider_spec.slots_in_hours(3)
        assert local_starts(slots) == [
            "01:00",
            "01:30",
            "03:00",
            "03:30",
            "04:00",
            "04:30",
        ]

    def test_slots_stay_contiguous_in_real_time(
        self, dst_provider, dst_provider_spec, frozen_clock
    ):
        """Wall clock jumps 01:30 -> 03:00, but the instants are one slot apart."""
        slots = generate_slots(dst_provider, self.SPRING_FORWARD, self.SPRING_FORWARD)

        gaps = {
            slots[i + 1].start_at - slots[i].start_at for i in range(len(slots) - 1)
        }
        assert gaps == {timedelta(minutes=dst_provider_spec.slot_minutes)}

    def test_fall_back_day_gains_an_hour(
        self, dst_provider, dst_provider_spec, frozen_clock
    ):
        """The 01:00 hour happens twice, so the window is five real hours."""
        slots = generate_slots(dst_provider, self.FALL_BACK, self.FALL_BACK)

        assert len(slots) == dst_provider_spec.slots_in_hours(5)

    def test_repeated_hour_is_offered_as_two_distinct_instants(
        self, dst_provider, dst_provider_spec, frozen_clock
    ):
        """01:00 EDT and 01:00 EST are an hour apart and both are bookable."""
        slots = generate_slots(dst_provider, self.FALL_BACK, self.FALL_BACK)
        starts = local_starts(slots)

        # Each wall-clock time in the repeated hour appears once per pass.
        assert starts.count("01:00") == 2
        assert starts.count("01:30") == 2

        one_oclocks = sorted(
            s.start_at for s in slots if s.start_at.astimezone(NY).hour == 1
        )
        # First 01:00 EDT to last 01:30 EST: one repeated hour plus one slot.
        assert one_oclocks[-1] - one_oclocks[0] == timedelta(
            minutes=60 + dst_provider_spec.slot_minutes
        )

    def test_an_ordinary_sunday_is_unaffected(
        self, dst_provider, dst_provider_spec, frozen_clock
    ):
        normal_sunday = self.SPRING_FORWARD + timedelta(days=7)

        slots = generate_slots(dst_provider, normal_sunday, normal_sunday)

        assert len(slots) == dst_provider_spec.slot_count


class TestSouthernHemisphereDaylightSaving:
    """The same handling, with the transitions the other way round.

    Australia/Adelaide goes forward in October and back in April, and sits at a
    half-hour offset. If the transition logic were hard-coded to US rules or to
    whole-hour offsets, these would fail while the New York tests still passed.
    """

    SPRING_FORWARD = date(2026, 10, 4)  # 02:00 -> 03:00, one hour vanishes
    FALL_BACK = date(2026, 4, 5)  # 03:00 -> 02:00, one hour repeats

    def test_no_slot_is_offered_in_the_missing_hour(
        self, adelaide_provider, frozen_clock
    ):
        slots = generate_slots(
            adelaide_provider, self.SPRING_FORWARD, self.SPRING_FORWARD
        )

        assert not any(s.startswith("02:") for s in local_starts(slots, ADELAIDE))

    def test_spring_forward_day_loses_an_hour(
        self, adelaide_provider, adelaide_provider_spec, frozen_clock
    ):
        slots = generate_slots(
            adelaide_provider, self.SPRING_FORWARD, self.SPRING_FORWARD
        )

        assert len(slots) == adelaide_provider_spec.slots_in_hours(3)

    def test_fall_back_day_gains_an_hour(
        self, adelaide_provider, adelaide_provider_spec, frozen_clock
    ):
        slots = generate_slots(adelaide_provider, self.FALL_BACK, self.FALL_BACK)

        assert len(slots) == adelaide_provider_spec.slots_in_hours(5)

    def test_an_ordinary_sunday_is_unaffected(
        self, adelaide_provider, adelaide_provider_spec, frozen_clock
    ):
        normal_sunday = self.SPRING_FORWARD + timedelta(days=7)

        slots = generate_slots(adelaide_provider, normal_sunday, normal_sunday)

        assert len(slots) == adelaide_provider_spec.slot_count
