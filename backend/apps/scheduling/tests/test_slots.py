"""Slot generation: the expansion of weekly rules into bookable instants.

Expected counts come from the ProviderSpec the fixture was built from, so no
assertion contains a bare number whose derivation the reader has to reconstruct.
Where a count cannot come from the window -- the DST transition days, where wall
clock and real elapsed time disagree -- the real hours are stated explicitly and
the discrepancy is the point of the test.
"""
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

import pytest

from apps.scheduling.models import AppointmentStatus, AvailabilityRule, TimeOff, Weekday
from apps.scheduling.services.slots import generate_slots

NY = ZoneInfo("America/New_York")
LA = ZoneInfo("America/Los_Angeles")

pytestmark = pytest.mark.django_db


def utc(year, month, day, hour, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=dt_timezone.utc)


def hhmm(value: time) -> str:
    return value.strftime("%H:%M")


def local_starts(slots, tz=NY):
    return [s.start_at.astimezone(tz).strftime("%H:%M") for s in slots]


def local_ends(slots, tz=NY):
    return [s.end_at.astimezone(tz).strftime("%H:%M") for s in slots]


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
        rule = provider.availability_rules.get()
        rule.end_time = time(12, 0)  # 09:00-12:00
        rule.save()

        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == provider_spec.slots_in_hours(3)
        assert "12:00" not in starts

    def test_split_day_leaves_the_lunch_gap_empty(
        self, provider, provider_spec, monday, frozen_clock
    ):
        """A real schedule is two windows with a break, not one block."""
        morning = provider.availability_rules.get()
        morning.end_time = time(12, 0)  # 09:00-12:00, three hours
        morning.save()
        AvailabilityRule.objects.create(
            provider=provider,
            weekday=Weekday.MONDAY,
            start_time=time(13, 0),  # 13:00-17:00, four hours
            end_time=time(17, 0),
            valid_from=date(2020, 1, 1),
        )

        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == provider_spec.slots_in_hours(3) + provider_spec.slots_in_hours(4)
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
        old = provider.availability_rules.get()
        old.valid_until = monday
        old.save()
        AvailabilityRule.objects.create(
            provider=provider,
            weekday=Weekday.MONDAY,
            start_time=time(10, 0),  # 10:00-14:00, four hours
            end_time=time(14, 0),
            valid_from=monday + timedelta(days=1),
        )
        next_monday = monday + timedelta(days=7)

        this_week = generate_slots(provider, monday, monday)
        next_week = generate_slots(provider, next_monday, next_monday)

        assert len(this_week) == provider_spec.slot_count
        assert len(next_week) == provider_spec.slots_in_hours(4)
        assert local_starts(next_week)[0] == "10:00"


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
        """One hour off covers two 30 minute slots: 15:00 and 15:30."""
        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == provider_spec.slot_count - provider_spec.slots_in_hours(1)
        assert "15:00" not in starts
        assert "15:30" not in starts

    def test_buffer_widens_the_blocked_window(
        self, provider, provider_spec, monday, booked_appointment, frozen_clock
    ):
        """15 minutes of buffer on each side of the 10:00-10:30 booking blocks
        09:45-10:45, which intersects three slots rather than one."""
        provider.buffer_minutes = 15
        provider.save()

        starts = local_starts(generate_slots(provider, monday, monday))

        blocked = ("09:30", "10:00", "10:30")
        assert len(starts) == provider_spec.slot_count - len(blocked)
        for slot in blocked:
            assert slot not in starts


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
        """Exactly 09:00-09:30 local: one slot's worth, aligned to the grid."""
        TimeOff.objects.create(
            provider=provider,
            start_at=utc(2026, 3, 2, 14, 0),
            end_at=utc(2026, 3, 2, 14, 30),
        )

        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == provider_spec.slot_count - 1
        assert "09:00" not in starts
        assert "09:30" in starts

    def test_partial_overlap_removes_both_touched_slots(
        self, provider, provider_spec, monday, frozen_clock
    ):
        """09:15-09:45 covers neither slot fully but intersects both."""
        TimeOff.objects.create(
            provider=provider,
            start_at=utc(2026, 3, 2, 14, 15),
            end_at=utc(2026, 3, 2, 14, 45),
        )

        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == provider_spec.slot_count - 2
        assert "09:00" not in starts
        assert "09:30" not in starts
        assert "10:00" in starts

    def test_one_minute_of_overlap_is_enough_to_block(
        self, provider, provider_spec, monday, frozen_clock
    ):
        """09:29-09:31 clips one minute from each neighbouring slot."""
        TimeOff.objects.create(
            provider=provider,
            start_at=utc(2026, 3, 2, 14, 29),
            end_at=utc(2026, 3, 2, 14, 31),
        )

        starts = local_starts(generate_slots(provider, monday, monday))

        assert len(starts) == provider_spec.slot_count - 2
        assert "09:00" not in starts
        assert "09:30" not in starts
        assert "10:00" in starts


class TestNoticeAndHorizon:
    def test_minimum_notice_hides_imminent_slots(
        self, provider, provider_spec, monday, frozen_clock
    ):
        """Now is 07:00 local. Four hours notice makes 11:00 the earliest
        bookable time, leaving the 11:00-17:00 remainder of the day."""
        provider.min_notice_minutes = 4 * 60
        provider.save()

        starts = local_starts(generate_slots(provider, monday, monday))

        assert starts[0] == "11:00"
        assert len(starts) == provider_spec.slots_in_hours(6)

    def test_booking_horizon_clamps_the_range(self, provider, monday, frozen_clock):
        horizon_days = 3
        provider.booking_horizon_days = horizon_days
        provider.save()

        slots = generate_slots(provider, monday, monday + timedelta(days=60))

        assert slots
        latest = max(s.start_at for s in slots).astimezone(NY).date()
        assert latest <= monday + timedelta(days=horizon_days)


class TestProviderTimezone:
    """The provider's own timezone drives everything, not the server's."""

    def test_pacific_provider_generates_pacific_local_hours(
        self, other_provider, other_provider_spec, monday, frozen_clock
    ):
        slots = generate_slots(other_provider, monday, monday)

        assert len(slots) == other_provider_spec.slot_count
        assert local_starts(slots, LA)[0] == hhmm(other_provider_spec.opens)
        assert local_ends(slots, LA)[-1] == hhmm(other_provider_spec.closes)

    def test_pacific_provider_maps_to_the_right_utc_instant(
        self, other_provider, monday, frozen_clock
    ):
        """2 March is before the 2026 transition, so Los Angeles is on PST
        (UTC-8) and its 10:00 opening is 18:00 UTC.

        A bug that fell back to the Eastern provider's zone would put this at
        15:00 UTC instead.
        """
        slots = generate_slots(other_provider, monday, monday)

        assert slots[0].start_at == utc(2026, 3, 2, 18, 0)

    def test_two_providers_in_different_zones_do_not_interfere(
        self, provider, provider_spec, other_provider, other_provider_spec, monday, frozen_clock
    ):
        eastern = generate_slots(provider, monday, monday)
        pacific = generate_slots(other_provider, monday, monday)

        assert len(eastern) == provider_spec.slot_count
        assert len(pacific) == other_provider_spec.slot_count


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
            "01:00", "01:30", "03:00", "03:30", "04:00", "04:30",
        ]

    def test_slots_stay_contiguous_in_real_time(
        self, dst_provider, dst_provider_spec, frozen_clock
    ):
        """Wall clock jumps 01:30 -> 03:00, but the instants are one slot apart."""
        slots = generate_slots(dst_provider, self.SPRING_FORWARD, self.SPRING_FORWARD)

        gaps = {slots[i + 1].start_at - slots[i].start_at for i in range(len(slots) - 1)}
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
