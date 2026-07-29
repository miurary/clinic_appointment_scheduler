from datetime import timedelta
from zoneinfo import ZoneInfo

from django.db import IntegrityError, OperationalError, transaction
from rest_framework import serializers
from rest_framework.exceptions import APIException

from apps.accounts.models import ProviderProfile
from apps.accounts.serializers import ProviderPublicSerializer, UserSerializer

from .models import ACTIVE_STATUSES, Appointment, AvailabilityRule, TimeOff
from .services.slots import generate_slots


class SlotTaken(APIException):
    """409, not 400: the request was valid, the world changed underneath it.

    Clients distinguish this from ordinary validation failure to show the
    "just booked by someone else" state rather than a field error.
    """

    status_code = 409
    default_detail = "That time was just booked by someone else. Please pick another."
    default_code = "slot_taken"


# Postgres SQLSTATEs that mean "another transaction got there first", as opposed
# to a genuine data error. Matching on these rather than on the exception class
# alone keeps a dropped connection from being reported as a taken slot.
SLOT_CONFLICT_SQLSTATES = frozenset(
    {
        "23P01",  # exclusion_violation: the no-overlap constraint fired
        "40P01",  # deadlock_detected: two inserts each checked the other's
        #           uncommitted row, so Postgres killed one of them
        "40001",  # serialization_failure
    }
)


def _is_slot_conflict(exc: Exception) -> bool:
    """True when the database rejected a write because the slot was taken."""
    return getattr(exc.__cause__, "sqlstate", None) in SLOT_CONFLICT_SQLSTATES


class AvailabilityRuleSerializer(serializers.ModelSerializer):
    weekday_display = serializers.CharField(
        source="get_weekday_display", read_only=True
    )

    class Meta:
        model = AvailabilityRule
        fields = [
            "id",
            "weekday",
            "weekday_display",
            "start_time",
            "end_time",
            "valid_from",
            "valid_until",
        ]

    def validate(self, attrs):
        """Cross-field rules go here; validate_<field> only sees one value."""
        start = attrs.get("start_time") or getattr(self.instance, "start_time", None)
        end = attrs.get("end_time") or getattr(self.instance, "end_time", None)
        if start and end and end <= start:
            raise serializers.ValidationError(
                {"end_time": "End time must be after start time."}
            )
        valid_from = attrs.get("valid_from") or getattr(
            self.instance, "valid_from", None
        )
        valid_until = attrs.get("valid_until") or getattr(
            self.instance, "valid_until", None
        )
        if valid_from and valid_until and valid_until < valid_from:
            raise serializers.ValidationError(
                {"valid_until": "Must be on or after valid_from."}
            )
        return attrs


class TimeOffSerializer(serializers.ModelSerializer):
    class Meta:
        model = TimeOff
        fields = ["id", "start_at", "end_at", "reason"]

    def validate(self, attrs):
        start = attrs.get("start_at") or getattr(self.instance, "start_at", None)
        end = attrs.get("end_at") or getattr(self.instance, "end_at", None)
        if start and end and end <= start:
            raise serializers.ValidationError({"end_at": "Must be after start_at."})
        return attrs


class SlotSerializer(serializers.Serializer):
    """Slots are computed, never stored, so this is not a ModelSerializer."""

    start_at = serializers.DateTimeField(read_only=True)
    end_at = serializers.DateTimeField(read_only=True)


class AppointmentSerializer(serializers.ModelSerializer):
    provider = ProviderPublicSerializer(read_only=True)
    patient = UserSerializer(read_only=True)

    class Meta:
        model = Appointment
        fields = [
            "id",
            "provider",
            "patient",
            "start_at",
            "end_at",
            "status",
            "reason",
            "cancelled_at",
            "cancellation_reason",
            "created_at",
        ]
        # Status changes go through the cancel action, not an arbitrary PATCH.
        read_only_fields = fields


class AppointmentCreateSerializer(serializers.ModelSerializer):
    provider = serializers.PrimaryKeyRelatedField(
        queryset=ProviderProfile.objects.all()
    )
    # Booking on behalf of a patient; ignored unless the caller is clinic staff.
    patient_id = serializers.IntegerField(required=False, write_only=True)

    class Meta:
        model = Appointment
        fields = ["id", "provider", "start_at", "reason", "patient_id"]

    def validate(self, attrs):
        provider = attrs["provider"]
        start_at = attrs["start_at"]

        if not provider.accepting_new_patients:
            raise serializers.ValidationError(
                {"provider": "This provider is not accepting bookings."}
            )

        # The slot generator is the single source of truth for what is
        # bookable: hours, grid alignment, time off, notice, horizon and
        # existing bookings are all already encoded there. Re-checking each
        # condition here would be a second implementation free to drift.
        # The provider's local date, since generate_slots works in local dates.
        local_date = start_at.astimezone(ZoneInfo(provider.timezone)).date()
        available = generate_slots(provider, local_date, local_date)
        if not any(slot.start_at == start_at for slot in available):
            # Two different failures wear the same face here. A slot that is
            # missing because somebody already booked it is a conflict the
            # client should show as "just taken"; a slot that was never on
            # offer is an ordinary bad request.
            if Appointment.objects.filter(
                provider=provider, start_at=start_at, status__in=ACTIVE_STATUSES
            ).exists():
                raise SlotTaken()
            raise serializers.ValidationError(
                {"start_at": "That time is not available for this provider."}
            )

        attrs["end_at"] = start_at + timedelta(minutes=provider.slot_duration_minutes)
        return attrs

    def create(self, validated_data):
        validated_data.pop("patient_id", None)
        try:
            with transaction.atomic():
                return super().create(validated_data)
        except (IntegrityError, OperationalError) as exc:
            # Someone booked this slot between our availability check and this
            # insert. Two shapes are possible: the loser blocks and then hits
            # the exclusion constraint (IntegrityError), or both inserts race
            # closely enough that each waits on the other's uncommitted row and
            # Postgres breaks the deadlock (OperationalError). Anything else --
            # a lost connection, a real integrity bug -- must not be swallowed.
            if not _is_slot_conflict(exc):
                raise
            raise SlotTaken() from exc


class AppointmentRescheduleSerializer(serializers.ModelSerializer):
    """Moves an existing appointment to a different open slot.

    Only start_at is writable; end_at is recomputed from the provider, and the
    new time is validated against the same slot generator a fresh booking uses.
    """

    class Meta:
        model = Appointment
        fields = ["start_at"]

    def validate_start_at(self, value):
        provider = self.instance.provider
        if value == self.instance.start_at:
            raise serializers.ValidationError("That is the current appointment time.")

        local_date = value.astimezone(ZoneInfo(provider.timezone)).date()
        available = generate_slots(provider, local_date, local_date)
        if not any(slot.start_at == value for slot in available):
            if (
                Appointment.objects.filter(
                    provider=provider, start_at=value, status__in=ACTIVE_STATUSES
                )
                .exclude(pk=self.instance.pk)
                .exists()
            ):
                raise SlotTaken()
            raise serializers.ValidationError(
                "That time is not available for this provider."
            )
        return value

    def update(self, instance, validated_data):
        start_at = validated_data["start_at"]
        instance.start_at = start_at
        instance.end_at = start_at + timedelta(
            minutes=instance.provider.slot_duration_minutes
        )
        try:
            with transaction.atomic():
                instance.save(update_fields=["start_at", "end_at", "updated_at"])
        except (IntegrityError, OperationalError) as exc:
            if not _is_slot_conflict(exc):
                raise
            raise SlotTaken() from exc
        return instance


class AppointmentCancelSerializer(serializers.Serializer):
    cancellation_reason = serializers.CharField(
        required=False, allow_blank=True, max_length=280
    )
