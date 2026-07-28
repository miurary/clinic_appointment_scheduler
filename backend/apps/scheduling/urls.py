from rest_framework.routers import DefaultRouter

from .views import (
    AppointmentViewSet,
    AvailabilityRuleViewSet,
    ProviderViewSet,
    TimeOffViewSet,
)

# Mounted under /api/ by config.urls. The router expands each viewset into its
# list, detail and @action routes.
router = DefaultRouter()
router.register("providers", ProviderViewSet, basename="provider")
router.register("availability", AvailabilityRuleViewSet, basename="availability")
router.register("time-off", TimeOffViewSet, basename="timeoff")
router.register("appointments", AppointmentViewSet, basename="appointment")

urlpatterns = router.urls
