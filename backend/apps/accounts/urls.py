from django.urls import path

from .views import LoginView, MeView, RefreshView, RegisterView

# Mounted under /api/auth/ by config.urls
urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("token/", LoginView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", RefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="me"),
]
