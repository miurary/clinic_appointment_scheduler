from django.urls import path

from .views import (
    LoginView,
    LogoutView,
    MeView,
    MyPatientProfileView,
    MyProviderProfileView,
    RefreshView,
    RegisterView,
)

# Mounted under /api/auth/ by config.urls
urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("token/", LoginView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", RefreshView.as_view(), name="token_refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", MeView.as_view(), name="me"),
    # Role-specific halves of "my account".
    path("me/provider/", MyProviderProfileView.as_view(), name="me-provider"),
    path("me/patient/", MyPatientProfileView.as_view(), name="me-patient"),
]
