from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsProvider(BasePermission):
    message = "Only providers may do this."

    def has_permission(self, request, view):
        return bool(
            request.user and request.user.is_authenticated and request.user.is_provider
        )


class IsPatient(BasePermission):
    message = "Only patients may do this."

    def has_permission(self, request, view):
        return bool(
            request.user and request.user.is_authenticated and request.user.is_patient
        )


class IsClinicStaff(BasePermission):
    message = "Only clinic staff may do this."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_clinic_staff
        )


class IsProviderOwner(BasePermission):
    """Object-level: the record belongs to the requesting provider.

    Guards a provider's own schedule -- AvailabilityRule and TimeOff rows, and
    their own ProviderProfile -- so one provider cannot edit another's hours.
    Appointments use IsAppointmentParticipant instead, since patients need
    access to those too.

    Note this never runs on list endpoints -- DRF only consults object
    permissions via get_object(). List views must filter their own queryset.
    """

    message = "This belongs to another provider."

    def has_object_permission(self, request, view, obj):
        owner = getattr(obj, "provider", None)
        user = getattr(owner, "user", None) if owner else getattr(obj, "user", None)
        return user == request.user


class IsAppointmentParticipant(BasePermission):
    """Either side of an appointment can read it; staff can read any.

    has_permission is implemented as well as has_object_permission: without it
    BasePermission would default to True at the view level, letting an
    anonymous request reach the queryset and blow up on AnonymousUser, which
    has none of the role properties.
    """

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.is_clinic_staff:
            return True
        if obj.patient_id == user.id:
            return True
        return obj.provider.user_id == user.id


class IsReadOnly(BasePermission):
    def has_permission(self, request, view):
        return request.method in SAFE_METHODS
