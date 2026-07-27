"""Registration, token issuance, and the boundaries of self-service editing."""
import pytest
from django.core.cache import cache

from apps.accounts.models import PatientProfile, ProviderProfile, Role, User

pytestmark = pytest.mark.django_db

REGISTER = "/api/auth/register/"
TOKEN = "/api/auth/token/"
REFRESH = "/api/auth/token/refresh/"
ME = "/api/auth/me/"

GOOD_PASSWORD = "correct-horse-battery-1"


@pytest.fixture(autouse=True)
def clear_throttle_counters():
    """Throttle state lives in the local-memory cache, which outlives a single
    test. Without this, adding one more registration test would start tripping
    the rate limit in whichever test happened to run last."""
    cache.clear()
    yield
    cache.clear()


class TestRegistration:
    def test_creates_a_patient_with_a_profile(self, api_client):
        response = api_client.post(
            REGISTER,
            {
                "email": "new@example.com",
                "password": GOOD_PASSWORD,
                "first_name": "New",
                "last_name": "Person",
            },
            format="json",
        )

        assert response.status_code == 201
        user = User.objects.get(email="new@example.com")
        assert user.role == Role.PATIENT  # the default
        assert PatientProfile.objects.filter(user=user).exists()

    def test_creates_a_provider_with_a_provider_profile(self, api_client):
        """A provider without a profile would break every slot lookup, so the
        two writes happen in one transaction."""
        response = api_client.post(
            REGISTER,
            {
                "email": "doc@example.com",
                "password": GOOD_PASSWORD,
                "role": Role.PROVIDER,
            },
            format="json",
        )

        assert response.status_code == 201
        user = User.objects.get(email="doc@example.com")
        assert ProviderProfile.objects.filter(user=user).exists()
        assert not PatientProfile.objects.filter(user=user).exists()

    def test_the_password_is_hashed_not_stored(self, api_client):
        api_client.post(
            REGISTER,
            {"email": "hash@example.com", "password": GOOD_PASSWORD},
            format="json",
        )

        user = User.objects.get(email="hash@example.com")
        assert user.password != GOOD_PASSWORD
        assert user.check_password(GOOD_PASSWORD)

    def test_the_password_is_never_echoed_back(self, api_client):
        response = api_client.post(
            REGISTER,
            {"email": "quiet@example.com", "password": GOOD_PASSWORD},
            format="json",
        )

        assert "password" not in response.data

    def test_a_weak_password_is_rejected(self, api_client):
        """Django's AUTH_PASSWORD_VALIDATORS run through the serializer."""
        response = api_client.post(
            REGISTER,
            {"email": "weak@example.com", "password": "12345"},
            format="json",
        )

        assert response.status_code == 400
        assert "password" in response.data
        assert not User.objects.filter(email="weak@example.com").exists()

    def test_a_duplicate_email_is_rejected(self, api_client, patient):
        response = api_client.post(
            REGISTER,
            {"email": patient.email, "password": GOOD_PASSWORD},
            format="json",
        )

        assert response.status_code == 400
        assert "email" in response.data

    def test_an_invalid_timezone_is_rejected(self, api_client):
        response = api_client.post(
            REGISTER,
            {
                "email": "tz@example.com",
                "password": GOOD_PASSWORD,
                "timezone": "Mars/Olympus_Mons",
            },
            format="json",
        )

        assert response.status_code == 400
        assert "timezone" in response.data

    def test_clinic_staff_cannot_be_self_assigned(self, api_client):
        """Only patient and provider are offered; staff is created internally."""
        response = api_client.post(
            REGISTER,
            {
                "email": "sneaky@example.com",
                "password": GOOD_PASSWORD,
                "role": Role.CLINIC_STAFF,
            },
            format="json",
        )

        assert response.status_code == 400
        assert "role" in response.data


class TestTokens:
    def test_valid_credentials_return_a_token_pair(self, api_client, patient, password):
        response = api_client.post(
            TOKEN, {"email": patient.email, "password": password}, format="json"
        )

        assert response.status_code == 200
        assert "access" in response.data
        assert "refresh" in response.data

    def test_a_wrong_password_is_rejected(self, api_client, patient):
        response = api_client.post(
            TOKEN, {"email": patient.email, "password": "not-it"}, format="json"
        )

        assert response.status_code == 401

    def test_an_inactive_account_cannot_log_in(self, api_client, patient, password):
        """Deactivation is how an account is disabled without deleting the
        history that references it."""
        patient.is_active = False
        patient.save()

        response = api_client.post(
            TOKEN, {"email": patient.email, "password": password}, format="json"
        )

        assert response.status_code == 401

    def test_a_refresh_token_yields_a_new_access_token(self, api_client, patient, password):
        pair = api_client.post(
            TOKEN, {"email": patient.email, "password": password}, format="json"
        )

        response = api_client.post(
            REFRESH, {"refresh": pair.data["refresh"]}, format="json"
        )

        assert response.status_code == 200
        assert "access" in response.data

    def test_an_issued_token_authenticates_a_request(self, api_client, patient, password):
        pair = api_client.post(
            TOKEN, {"email": patient.email, "password": password}, format="json"
        )

        response = api_client.get(
            ME, HTTP_AUTHORIZATION=f"Bearer {pair.data['access']}"
        )

        assert response.status_code == 200
        assert response.data["email"] == patient.email


class TestMe:
    def test_returns_the_authenticated_user(self, patient_client, patient):
        response = patient_client.get(ME)

        assert response.status_code == 200
        assert response.data["email"] == patient.email
        assert response.data["full_name"] == "Pat Ient"

    def test_requires_authentication(self, api_client):
        assert api_client.get(ME).status_code == 401

    def test_a_user_may_change_their_own_timezone(self, patient_client, patient):
        """This is what every displayed time is rendered in."""
        response = patient_client.patch(
            ME, {"timezone": "Europe/Berlin"}, format="json"
        )

        assert response.status_code == 200
        patient.refresh_from_db()
        assert patient.timezone == "Europe/Berlin"

    def test_a_user_cannot_promote_themselves(self, patient_client, patient):
        """role is read-only: otherwise a PATCH is a privilege escalation."""
        patient_client.patch(ME, {"role": Role.PROVIDER}, format="json")

        patient.refresh_from_db()
        assert patient.role == Role.PATIENT

    def test_a_user_cannot_change_their_email(self, patient_client, patient):
        """Email is the login identifier; changing it needs a verification flow."""
        original = patient.email

        patient_client.patch(ME, {"email": "someone.else@example.com"}, format="json")

        patient.refresh_from_db()
        assert patient.email == original

    def test_it_never_reaches_another_user(self, other_patient_client, patient, other_patient):
        """get_object ignores the URL entirely, so there is no id to tamper with."""
        response = other_patient_client.get(ME)

        assert response.data["email"] == other_patient.email


class TestUserModel:
    def test_superusers_are_operators_not_patients(self, db):
        user = User.objects.create_superuser(
            email="root@example.com", password=GOOD_PASSWORD
        )

        assert user.role == Role.CLINIC_STAFF
        assert user.is_staff and user.is_superuser

    def test_creating_a_user_without_an_email_fails(self, db):
        with pytest.raises(ValueError):
            User.objects.create_user(email="", password=GOOD_PASSWORD)

    def test_email_domains_are_normalised(self, db):
        user = User.objects.create_user(
            email="Mixed@EXAMPLE.COM", password=GOOD_PASSWORD
        )

        # normalize_email lowercases the domain only; the local part is left
        # alone, so this is not case-insensitive login.
        assert user.email == "Mixed@example.com"

    def test_role_helpers_agree_with_the_role_field(self, patient, provider, staff):
        assert patient.is_patient and not patient.is_provider
        assert provider.user.is_provider and not provider.user.is_patient
        assert staff.is_clinic_staff
        # Django's admin flag is a separate concept from the clinic role.
        assert not staff.is_staff
