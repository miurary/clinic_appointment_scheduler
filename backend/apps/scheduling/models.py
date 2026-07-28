from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import (
    DateTimeRangeField,
    RangeBoundary,
    RangeOperators,
)
from django.db import models
from django.db.models import Func, Q

from apps.accounts.models import ProviderProfile, User


class TsTzRange(Func):
    """Lets the ORM emit tstzrange(start, end, '[)') inside a constraint."""

    function = "TSTZRANGE"
    output_field = DateTimeRangeField()


class Weekday(models.IntegerChoices):
    """Matches datetime.date.weekday(): Monday is 0."""

    MONDAY = 0, "Monday"
    TUESDAY = 1, "Tuesday"
    WEDNESDAY = 2, "Wednesday"
    THURSDAY = 3, "Thursday"
    FRIDAY = 4, "Friday"
    SATURDAY = 5, "Saturday"
    SUNDAY = 6, "Sunday"


class AvailabilityRule(models.Model):
    """A recurring weekly window a provider is willing to see patients in.

    Times are WALL CLOCK times in the provider's own timezone, deliberately not
    absolute instants: "9am to 5pm" stays 9am to 5pm across a DST transition.
    """

    provider = models.ForeignKey(
        ProviderProfile, on_delete=models.CASCADE, related_name="availability_rules"
    )
    weekday = models.IntegerField(choices=Weekday.choices)
    start_time = models.TimeField()
    end_time = models.TimeField()

    # Bounds on when this rule applies, so hours can change without rewriting
    # history. valid_until is null for "until further notice".
    valid_from = models.DateField()
    valid_until = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["weekday", "start_time"]
        constraints = [
            models.CheckConstraint(
                condition=Q(end_time__gt=models.F("start_time")),
                name="availability_end_after_start",
            ),
            models.UniqueConstraint(
                fields=["provider", "weekday", "start_time", "valid_from"],
                name="availability_no_duplicate_window",
            ),
        ]
        indexes = [models.Index(fields=["provider", "weekday"])]

    def __str__(self) -> str:
        return (
            f"{self.provider} {self.get_weekday_display()} "
            f"{self.start_time:%H:%M}-{self.end_time:%H:%M}"
        )


class TimeOff(models.Model):
    """A one-off absence that removes slots from an otherwise available window."""

    provider = models.ForeignKey(
        ProviderProfile, on_delete=models.CASCADE, related_name="time_off"
    )
    # Absolute instants, unlike AvailabilityRule: a specific vacation, not a
    # recurring pattern.
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    reason = models.CharField(max_length=200, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-start_at"]
        verbose_name_plural = "time off"
        constraints = [
            models.CheckConstraint(
                condition=Q(end_at__gt=models.F("start_at")),
                name="timeoff_end_after_start",
            ),
        ]
        indexes = [models.Index(fields=["provider", "start_at"])]

    def __str__(self) -> str:
        return f"{self.provider} off {self.start_at:%Y-%m-%d %H:%M}"


class AppointmentStatus(models.TextChoices):
    SCHEDULED = "scheduled", "Scheduled"
    COMPLETED = "completed", "Completed"
    CANCELLED = "cancelled", "Cancelled"
    NO_SHOW = "no_show", "No-show"


# Statuses that still occupy the provider's calendar.
ACTIVE_STATUSES = (AppointmentStatus.SCHEDULED, AppointmentStatus.COMPLETED)


class Appointment(models.Model):
    provider = models.ForeignKey(
        ProviderProfile, on_delete=models.PROTECT, related_name="appointments"
    )
    patient = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name="appointments"
    )
    # Who actually made the booking -- the patient, or clinic staff on their
    # behalf. Null for records created before this was tracked.
    booked_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="appointments_booked",
    )

    start_at = models.DateTimeField()
    end_at = models.DateTimeField()

    status = models.CharField(
        max_length=16,
        choices=AppointmentStatus.choices,
        default=AppointmentStatus.SCHEDULED,
    )
    reason = models.CharField(max_length=280, blank=True)

    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.CharField(max_length=280, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-start_at"]
        constraints = [
            models.CheckConstraint(
                condition=Q(end_at__gt=models.F("start_at")),
                name="appointment_end_after_start",
            ),
            # The real defence against double-booking. An application-level
            # check has a race between validating and inserting; this does not.
            # Requires the btree_gist extension (see migration 0002).
            ExclusionConstraint(
                name="appointment_no_provider_overlap",
                expressions=[
                    ("provider", RangeOperators.EQUAL),
                    (
                        TsTzRange("start_at", "end_at", RangeBoundary()),
                        RangeOperators.OVERLAPS,
                    ),
                ],
                condition=Q(status__in=ACTIVE_STATUSES),
            ),
        ]
        indexes = [
            models.Index(fields=["provider", "start_at"]),
            models.Index(fields=["patient", "start_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.patient} with {self.provider} at {self.start_at:%Y-%m-%d %H:%M}"

    @property
    def is_active(self) -> bool:
        return self.status in ACTIVE_STATUSES
