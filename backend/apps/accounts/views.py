from drf_spectacular.utils import extend_schema
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .serializers import LogoutSerializer, RegistrationSerializer, UserSerializer


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


@extend_schema(
    request=LogoutSerializer,
    responses={204: None},
    description="Revoke a refresh token so it can no longer mint access tokens.",
)
class LogoutView(APIView):
    """Blacklists the presented refresh token.

    Rotation revokes the previous token as a side effect of refreshing; this is
    the deliberate version, for signing out. Access tokens already issued stay
    valid until they expire -- they are not looked up on each request, which is
    the tradeoff JWTs make. Keeping ACCESS_TOKEN_LIFETIME short is what bounds
    that window.

    Deliberately unauthenticated: the refresh token presented is itself the
    credential, and an invalid one is refused anyway. Requiring a live access
    token would mean a client whose access token had expired could no longer
    revoke its refresh token -- exactly when revoking matters most.
    """

    permission_classes = [AllowAny]
    serializer_class = LogoutSerializer

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            RefreshToken(serializer.validated_data["refresh"]).blacklist()
        except TokenError as exc:
            # Already revoked, expired, or never valid.
            raise ValidationError({"refresh": "Token is invalid or expired."}) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)
