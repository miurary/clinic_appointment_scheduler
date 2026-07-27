"""Expansion of recurring availability rules into concrete bookable slots.

Nothing here is persisted. A slot is a computed offer; only a booking is a row.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.db.models import Q
from django.utils import timezone as django_timezone

from apps.accounts.models import ProviderProfile

from ..models import ACTIVE_STATUSES, Appointment, AvailabilityRule, TimeOff

UTC = dt_timezone.utc


@dataclass(frozen=True)
class Slot:
    start_at: datetime  # timezone-aware, UTC
    end_at: datetime

    def overlaps(self, other_start: datetime, other_end: datetime) -> bool:
        return self.start_at < other_end and other_start < self.end_at


def _to_utc(local_date: date, local_time: time, tz: ZoneInfo) -> datetime | None:
    """Attach `tz` to a naive wall-clock time and convert to UTC.

    Returns None for times that do not exist locally (the skipped hour on a
    spring-forward DST transition). Ambiguous times on fall-back resolve to
    fold=0, the first of the two occurrences.

    zoneinfo does not raise on either case, so the only reliable detection is
    to round-trip the conversion and check we land where we started.
    """
    naive = datetime.combine(local_date, local_time)
    aware = naive.replace(tzinfo=tz, fold=0)
    if aware.astimezone(UTC).astimezone(tz).replace(tzinfo=None) != naive:
        return None
    return aware.astimezone(UTC)


def _dates_in_range(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def generate_slots(
    provider: ProviderProfile,
    date_from: date,
    date_to: date,
    *,
    now: datetime | None = None,
) -> list[Slot]:
    """Bookable slots for `provider` between two dates in the provider's timezone.

    Both bounds are inclusive and are interpreted as local calendar dates, not
    UTC dates -- a provider's Monday is not the same span of UTC everywhere.
    """
    now = now or django_timezone.now()
    tz = ZoneInfo(provider.timezone)

    # Respect how far ahead this provider allows booking.
    horizon = (now.astimezone(tz).date()) + timedelta(days=provider.booking_horizon_days)
    date_to = min(date_to, horizon)
    if date_from > date_to:
        return []

    earliest_start = now + timedelta(minutes=provider.min_notice_minutes)

    # Widen the window by a day on each side so that rules near midnight, which
    # can land in an adjacent UTC day, are still matched against bookings.
    window_start = datetime.combine(date_from - timedelta(days=1), time.min, tzinfo=tz)
    window_end = datetime.combine(date_to + timedelta(days=2), time.min, tzinfo=tz)

    # Rules that overlap the window: started by its end, and either open-ended
    # or not yet expired at its start.
    rules = list(
        AvailabilityRule.objects.filter(
            provider=provider, valid_from__lte=date_to
        ).filter(Q(valid_until__isnull=True) | Q(valid_until__gte=date_from))
    )
    if not rules:
        return []

    time_off = list(
        TimeOff.objects.filter(
            provider=provider, start_at__lt=window_end, end_at__gt=window_start
        ).values_list("start_at", "end_at")
    )
    booked = list(
        Appointment.objects.filter(
            provider=provider,
            status__in=ACTIVE_STATUSES,
            start_at__lt=window_end,
            end_at__gt=window_start,
        ).values_list("start_at", "end_at")
    )

    # A buffer is dead time on both sides of an appointment: turnover before,
    # notes after. Expanding one side only would leave no gap on the other.
    buffer = timedelta(minutes=provider.buffer_minutes)
    blocked = [(s - buffer, e + buffer) for s, e in booked] + time_off

    duration = timedelta(minutes=provider.slot_duration_minutes)
    rules_by_weekday: dict[int, list[AvailabilityRule]] = {}
    for rule in rules:
        rules_by_weekday.setdefault(rule.weekday, []).append(rule)

    slots: list[Slot] = []
    for day in _dates_in_range(date_from, date_to):
        for rule in rules_by_weekday.get(day.weekday(), []):
            if day < rule.valid_from:
                continue
            if rule.valid_until and day > rule.valid_until:
                continue

            window_open = _to_utc(day, rule.start_time, tz)
            window_close = _to_utc(day, rule.end_time, tz)
            if window_open is None or window_close is None:
                continue  # window straddles a nonexistent local hour

            cursor = window_open
            while cursor + duration <= window_close:
                slot = Slot(start_at=cursor, end_at=cursor + duration)
                cursor += duration

                if slot.start_at < earliest_start:
                    continue
                if any(slot.overlaps(s, e) for s, e in blocked):
                    continue
                slots.append(slot)

    slots.sort(key=lambda s: s.start_at)
    return slots
