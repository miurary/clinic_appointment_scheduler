from datetime import timedelta
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction
from rest_framework import serializers

from apps.accounts.models import ProviderProfile
from apps.accounts.serializers import ProviderPublicSerializer, UserSerializer

from .models import Appointment, AvailabilityRule, TimeOff
from .services.slots import generate_slots


class AvailabilityRuleSerializer(serializers.ModelSerializer):
    weekday_display = serializers.CharField(source="get_weekday_display", read_only=True)

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
        valid_from = attrs.get("valid_from") or getattr(self.instance, "valid_from", None)
        valid_until = attrs.get("valid_until") or getattr(self.instance, "valid_until", None)
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
    provider = serializers.PrimaryKeyRelatedField(queryset=ProviderProfile.objects.all())
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
        except IntegrityError as exc:
            # The exclusion constraint fired: someone booked this slot between
            # our availability check and this insert.
            raise serializers.ValidationError(
                {"start_at": "That slot was just taken. Please pick another."}
            ) from exc


class AppointmentCancelSerializer(serializers.Serializer):
    cancellation_reason = serializers.CharField(
        required=False, allow_blank=True, max_length=280
    )
