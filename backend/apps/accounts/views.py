from drf_spectacular.utils import extend_schema
from rest_framework import generics
from rest_framework.permissions import AllowAny
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .serializers import RegistrationSerializer, UserSerializer


class RegisterView(generics.CreateAPIView):
    """Public sign-up. The only endpoint that opts out of authentication.

    throttle_scope caps sign-ups per client (see DEFAULT_THROTTLE_RATES) so an
    unauthenticated endpoint cannot be scripted into filling the user table.
    """

    serializer_class = RegistrationSerializer
    permission_classes = [AllowAny]
    throttle_scope = "register"


class MeView(generics.RetrieveUpdateAPIView):
    """The authenticated user's own profile.

    get_object ignores the URL entirely, so there is no way to reach another
    user's record through this view and no object permission is needed.
    """

    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


@extend_schema(description="Exchange email and password for an access/refresh pair.")
class LoginView(TokenObtainPairView):
    # An unthrottled login endpoint is a password-guessing oracle.
    throttle_scope = "login"


@extend_schema(description="Exchange a refresh token for a new access token.")
class RefreshView(TokenRefreshView):
    throttle_scope = "login"
