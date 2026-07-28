from datetime import timedelta

from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import ProviderProfile, User
from apps.accounts.permissions import (
    IsAppointmentParticipant,
    IsProvider,
    IsProviderOwner,
)
from apps.accounts.serializers import ProviderPublicSerializer

from .models import Appointment, AppointmentStatus, AvailabilityRule, TimeOff
from .serializers import (
    AppointmentCancelSerializer,
    AppointmentCreateSerializer,
    AppointmentRescheduleSerializer,
    AppointmentSerializer,
    AvailabilityRuleSerializer,
    SlotSerializer,
    TimeOffSerializer,
)
from .services.slots import generate_slots

MAX_SLOT_RANGE_DAYS = 60


class ProviderViewSet(viewsets.ReadOnlyModelViewSet):
    """Browse providers and their open slots."""

    serializer_class = ProviderPublicSerializer
    queryset = ProviderProfile.objects.select_related("user").all()
    filterset_fields = ["specialty", "accepting_new_patients"]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "date_from", str, description="YYYY-MM-DD, provider local"
            ),
            OpenApiParameter("date_to", str, description="YYYY-MM-DD, provider local"),
        ],
        responses=SlotSerializer(many=True),
    )
    @action(detail=True, methods=["get"])
    def slots(self, request, pk=None):
        provider = self.get_object()
        date_from, date_to = self._parse_range(request)
        slots = generate_slots(provider, date_from, date_to)
        return Response(SlotSerializer(slots, many=True).data)

    def _parse_range(self, request):
        """Validate the query params generate_slots cannot defend itself against.

        The generator clamps date_to to the provider's booking horizon, but
        nothing bounds date_from, so an old start date would still walk decades
        of days. Parsing failures also have to be caught here: parse_date
        returns None on bad input rather than raising.
        """
        today = timezone.now().date()
        raw_from = request.query_params.get("date_from")
        raw_to = request.query_params.get("date_to")

        date_from = parse_date(raw_from) if raw_from else today
        if date_from is None:
            raise ValidationError({"date_from": "Expected YYYY-MM-DD."})

        date_to = parse_date(raw_to) if raw_to else date_from + timedelta(days=13)
        if date_to is None:
            raise ValidationError({"date_to": "Expected YYYY-MM-DD."})

        # generate_slots would return [] here; a 400 is clearer than an empty 200.
        if date_to < date_from:
            raise ValidationError({"date_to": "Must be on or after date_from."})
        if (date_to - date_from).days > MAX_SLOT_RANGE_DAYS:
            raise ValidationError(
                {"date_to": f"Range may not exceed {MAX_SLOT_RANGE_DAYS} days."}
            )
        return date_from, date_to


class ProviderScopedViewSet(viewsets.ModelViewSet):
    """Base for resources a provider owns outright.

    get_queryset is the actual security boundary here: object permissions are
    never consulted on list endpoints, so the queryset itself must be narrowed.
    """

    # IsProvider already implies authentication, but permission_classes
    # replaces the settings default, so state it rather than rely on that.
    permission_classes = [IsAuthenticated, IsProvider, IsProviderOwner]

    def get_provider_profile(self) -> ProviderProfile:
        profile = getattr(self.request.user, "provider_profile", None)
        if profile is None:
            raise PermissionDenied("This account has no provider profile.")
        return profile

    def get_queryset(self):
        return self.queryset.filter(provider=self.get_provider_profile())

    def perform_create(self, serializer):
        serializer.save(provider=self.get_provider_profile())


class AvailabilityRuleViewSet(ProviderScopedViewSet):
    serializer_class = AvailabilityRuleSerializer
    queryset = AvailabilityRule.objects.select_related("provider__user")


class TimeOffViewSet(ProviderScopedViewSet):
    serializer_class = TimeOffSerializer
    queryset = TimeOff.objects.select_related("provider__user")


class AppointmentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """No update or destroy routes exist: appointments are cancelled, not
    rewritten or deleted, so the record of what a patient was told survives."""

    # Setting permission_classes REPLACES the IsAuthenticated default from
    # settings, so it has to be restated here rather than assumed.
    permission_classes = [IsAuthenticated, IsAppointmentParticipant]
    filterset_fields = ["status"]

    def get_serializer_class(self):
        if self.action == "create":
            return AppointmentCreateSerializer
        if self.action == "cancel":
            return AppointmentCancelSerializer
        if self.action == "reschedule":
            return AppointmentRescheduleSerializer
        return AppointmentSerializer

    def get_queryset(self):
        user = self.request.user
        qs = Appointment.objects.select_related("provider__user", "patient")
        if user.is_clinic_staff:
            pass
        elif user.is_provider:
            qs = qs.filter(provider__user=user)
        else:
            qs = qs.filter(patient=user)
        return self._apply_scope(qs)

    def _apply_scope(self, qs):
        """?scope=upcoming|past, the split the patient dashboard is built on.

        Server-side because a client filtering one page of results would
        silently show the wrong thing once a patient has more than a page of
        history. Ordering flips so each list reads nearest-first.
        """
        scope = self.request.query_params.get("scope")
        if scope is None:
            return qs
        if scope not in {"upcoming", "past"}:
            raise ValidationError({"scope": "Expected 'upcoming' or 'past'."})

        now = timezone.now()
        if scope == "upcoming":
            return qs.filter(
                start_at__gte=now, status=AppointmentStatus.SCHEDULED
            ).order_by("start_at")
        return qs.filter(start_at__lt=now).order_by("-start_at")

    def perform_create(self, serializer):
        user = self.request.user
        patient = user
        # Identity comes from the token, not the request body. Only staff may
        # name a different patient.
        if user.is_clinic_staff:
            patient_id = serializer.initial_data.get("patient_id")
            if not patient_id:
                raise ValidationError({"patient_id": "Required when booking as staff."})
            patient = get_object_or_404(User, pk=patient_id)
        elif user.is_provider:
            raise PermissionDenied("Providers cannot book their own appointments.")
        serializer.save(patient=patient, booked_by=user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        # Echo back the full read shape rather than the thin create shape.
        output = AppointmentSerializer(serializer.instance)
        return Response(output.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        request=AppointmentRescheduleSerializer, responses=AppointmentSerializer
    )
    @action(detail=True, methods=["post"])
    def reschedule(self, request, pk=None):
        """Move an existing appointment to another open slot.

        A dedicated action rather than an open PATCH: moving an appointment has
        to re-run the same availability checks as booking it, and must not be a
        route through which status or patient can be rewritten.

        The exclusion constraint covers UPDATE as well as INSERT, so the same
        conflict handling applies -- the row is validated against the generator
        first, and the database still has the final say.
        """
        appointment = self.get_object()
        if appointment.status != AppointmentStatus.SCHEDULED:
            raise ValidationError(
                {"status": "Only scheduled appointments can be rescheduled."}
            )
        if self.request.user.is_provider:
            raise PermissionDenied("Providers cannot reschedule on their own calendar.")

        serializer = AppointmentRescheduleSerializer(
            appointment, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(AppointmentSerializer(appointment).data)

    @extend_schema(request=AppointmentCancelSerializer, responses=AppointmentSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        appointment = self.get_object()
        if appointment.status == AppointmentStatus.CANCELLED:
            raise ValidationError({"status": "Already cancelled."})
        if appointment.status != AppointmentStatus.SCHEDULED:
            raise ValidationError(
                {"status": "Only scheduled appointments can be cancelled."}
            )

        serializer = AppointmentCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        appointment.status = AppointmentStatus.CANCELLED
        appointment.cancelled_at = timezone.now()
        appointment.cancellation_reason = serializer.validated_data.get(
            "cancellation_reason", ""
        )
        appointment.save(
            update_fields=[
                "status",
                "cancelled_at",
                "cancellation_reason",
                "updated_at",
            ]
        )
        return Response(AppointmentSerializer(appointment).data)
