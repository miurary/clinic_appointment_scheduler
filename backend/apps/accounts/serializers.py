from django.contrib.auth.password_validation import (
    validate_password as django_validate_password,
)
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from .models import PatientProfile, ProviderProfile, Role, User
from .models import validate_timezone as check_timezone


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "full_name",
            "phone",
            "role",
            "timezone",
            "date_joined",
        ]
        # Without this a user could PATCH their own role to "provider".
        read_only_fields = ["id", "email", "role", "date_joined"]


class RegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    # Self-registration as a provider is a demo affordance. A real clinic would
    # create provider accounts through staff tooling or the admin.
    role = serializers.ChoiceField(
        choices=[Role.PATIENT, Role.PROVIDER], default=Role.PATIENT
    )

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "password",
            "first_name",
            "last_name",
            "phone",
            "role",
            "timezone",
        ]

    # DRF finds per-field validators by the name validate_<field>, so these
    # method names are fixed. The imports are aliased to keep the calls below
    # from looking recursive.
    def validate_password(self, value):
        try:
            django_validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def validate_timezone(self, value):
        try:
            check_timezone(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    @transaction.atomic
    def create(self, validated_data):
        password = validated_data.pop("password")
        # create_user hashes the password; User(**data).save() would not.
        user = User.objects.create_user(password=password, **validated_data)
        # A provider without a profile would break every slot lookup, so the
        # two writes have to succeed or fail together.
        if user.is_provider:
            # Closed until they set their hours. A brand new provider has no
            # availability rules, so listing them as accepting bookings puts a
            # name in the patient's picker that can never have a free slot.
            ProviderProfile.objects.create(user=user, accepting_new_patients=False)
        else:
            PatientProfile.objects.create(user=user)
        return user


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField(write_only=True)


class PatientProfileSerializer(serializers.ModelSerializer):
    """Staff-facing view, including clinical notes."""

    user = UserSerializer(read_only=True)

    class Meta:
        model = PatientProfile
        fields = ["id", "user", "date_of_birth", "notes"]


class MyPatientProfileSerializer(serializers.ModelSerializer):
    """What a patient may see and change about their own record.

    `notes` is deliberately absent rather than read-only: it is staff-authored
    clinical text, and a patient has no business either editing it or reading
    it through this endpoint.
    """

    user = UserSerializer(read_only=True)

    class Meta:
        model = PatientProfile
        fields = ["id", "user", "date_of_birth"]


class ProviderProfileSerializer(serializers.ModelSerializer):
    """Full view, for a provider managing their own settings."""

    user = UserSerializer(read_only=True)
    timezone = serializers.CharField(source="user.timezone", read_only=True)

    class Meta:
        model = ProviderProfile
        fields = [
            "id",
            "user",
            "timezone",
            "specialty",
            "bio",
            "location",
            "slot_duration_minutes",
            "buffer_minutes",
            "booking_horizon_days",
            "min_notice_minutes",
            "accepting_new_patients",
        ]


class ProviderPublicSerializer(serializers.ModelSerializer):
    """Trimmed view for patients browsing providers."""

    full_name = serializers.CharField(source="user.get_full_name", read_only=True)
    timezone = serializers.CharField(source="user.timezone", read_only=True)

    class Meta:
        model = ProviderProfile
        fields = [
            "id",
            "full_name",
            "timezone",
            "specialty",
            "bio",
            "location",
            "slot_duration_minutes",
            "accepting_new_patients",
        ]
