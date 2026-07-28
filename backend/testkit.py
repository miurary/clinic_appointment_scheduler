"""Plain helpers shared by tests.

Separate from conftest.py because these are functions tests call directly
rather than fixtures pytest injects. Deliberately not named test_*.py, or
pytest would try to collect it as a test module.
"""
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

# Monday 2026-03-02, 07:00 in New York -- before that day's 9-5 window, so
# same-day booking is testable. It is also the Monday before the 2026 US
# spring-forward (Sunday 2026-03-08), which the DST fixtures rely on.
FROZEN_NOW = datetime(2026, 3, 2, 12, 0, tzinfo=dt_timezone.utc)

NY = ZoneInfo("America/New_York")
LA = ZoneInfo("America/Los_Angeles")
# Half-hour offset, and no DST at all.
KOLKATA = ZoneInfo("Asia/Kolkata")
# Half-hour offset, and DST that runs the opposite way round to the US.
ADELAIDE = ZoneInfo("Australia/Adelaide")


def utc(year, month, day, hour, minute=0) -> datetime:
    """An aware UTC instant, for when a test means a specific absolute moment."""
    return datetime(year, month, day, hour, minute, tzinfo=dt_timezone.utc)


def slot_at(day: date, spec, index: int) -> datetime:
    """The provider's nth slot on `day`, as an aware instant.

    Derives fixture times from the ProviderSpec instead of hand-computed UTC
    literals: change a spec's opening hour or timezone and the fixtures follow
    rather than silently drifting outside the provider's availability.

    buffer_minutes is deliberately not a factor. The generator steps the grid
    by slot_duration_minutes from the opening time and applies the buffer only
    when widening the blocked interval around an existing appointment -- so a
    buffer removes slots from the grid, it never moves the ones that remain.

    Assumes `day` has no DST transition, which holds for every fixture day.
    The transition cases build their times explicitly, since the gap between
    wall clock and elapsed time is the thing they exist to test.
    """
    opens = datetime.combine(day, spec.opens, tzinfo=ZoneInfo(spec.timezone))
    return opens + timedelta(minutes=index * spec.slot_minutes)


def hhmm(value: time) -> str:
    return value.strftime("%H:%M")


def local_starts(slots, tz=NY) -> list[str]:
    return [s.start_at.astimezone(tz).strftime("%H:%M") for s in slots]


def local_ends(slots, tz=NY) -> list[str]:
    return [s.end_at.astimezone(tz).strftime("%H:%M") for s in slots]
