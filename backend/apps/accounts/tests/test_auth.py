"""Registration, token issuance, and the boundaries of self-service editing."""
from datetime import timedelta
from unittest.mock import patch

import pytest
import time_machine
from django.conf import settings
from django.core.cache import cache
from rest_framework.throttling import SimpleRateThrottle

from apps.accounts.models import PatientProfile, ProviderProfile, Role, User
from testkit import FROZEN_NOW

pytestmark = pytest.mark.django_db

REGISTER = "/api/auth/register/"
TOKEN = "/api/auth/token/"
REFRESH = "/api/auth/token/refresh/"
LOGOUT = "/api/auth/logout/"
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


class TestThrottling:
    """The rate limits are configured; these assert they actually fire.

    Without them the suite proved only that `throttle_scope` had been typed
    somewhere -- and the autouse cache-clearing fixture guaranteed the limits
    could never trip.
    """

    @pytest.fixture
    def tight_limits(self):
        """Shrink the rates so a limit is reachable in three requests.

        override_settings does not work for this: DRF binds
        SimpleRateThrottle.THROTTLE_RATES to the settings dict at import time,
        so the class holds the original object and never sees the override.
        Patching that dict is what takes effect.
        """
        with patch.dict(
            SimpleRateThrottle.THROTTLE_RATES,
            {"register": "2/hour", "login": "2/hour"},
        ):
            yield

    def _register(self, api_client, n):
        return api_client.post(
            REGISTER,
            {"email": f"applicant{n}@example.com", "password": GOOD_PASSWORD},
            format="json",
        )

    def test_registration_is_rate_limited(self, api_client, tight_limits):
        assert self._register(api_client, 1).status_code == 201
        assert self._register(api_client, 2).status_code == 201

        blocked = self._register(api_client, 3)

        assert blocked.status_code == 429
        assert not User.objects.filter(email="applicant3@example.com").exists()

    def test_login_is_rate_limited(self, api_client, patient, tight_limits):
        """Failed attempts count too, which is the point: an unthrottled login
        endpoint is a password-guessing oracle."""
        for _ in range(2):
            api_client.post(
                TOKEN, {"email": patient.email, "password": "wrong"}, format="json"
            )

        blocked = api_client.post(
            TOKEN, {"email": patient.email, "password": "wrong"}, format="json"
        )

        assert blocked.status_code == 429

    def test_scopes_are_counted_independently(
        self, api_client, patient, password, tight_limits
    ):
        """Exhausting sign-ups must not lock existing users out of logging in."""
        self._register(api_client, 1)
        self._register(api_client, 2)
        assert self._register(api_client, 3).status_code == 429

        response = api_client.post(
            TOKEN, {"email": patient.email, "password": password}, format="json"
        )

        assert response.status_code == 200

    def test_the_throttle_backend_is_wired_up(self):
        """Guards against the scopes being configured but the class removed."""
        classes = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"]
        rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]

        assert any("ScopedRateThrottle" in path for path in classes)
        assert {"register", "login"} <= set(rates)


class TestTokenLifecycle:
    ACCESS_LIFETIME = settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"]
    REFRESH_LIFETIME = settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]

    def _tokens(self, api_client, patient, password):
        response = api_client.post(
            TOKEN, {"email": patient.email, "password": password}, format="json"
        )
        return response.data

    def test_an_access_token_works_up_to_its_expiry(
        self, api_client, patient, password
    ):
        with time_machine.travel(FROZEN_NOW, tick=False):
            tokens = self._tokens(api_client, patient, password)

        just_inside = FROZEN_NOW + self.ACCESS_LIFETIME - timedelta(minutes=1)
        with time_machine.travel(just_inside, tick=False):
            response = api_client.get(
                ME, HTTP_AUTHORIZATION=f"Bearer {tokens['access']}"
            )

        assert response.status_code == 200

    def test_an_expired_access_token_is_rejected(self, api_client, patient, password):
        with time_machine.travel(FROZEN_NOW, tick=False):
            tokens = self._tokens(api_client, patient, password)

        just_outside = FROZEN_NOW + self.ACCESS_LIFETIME + timedelta(minutes=1)
        with time_machine.travel(just_outside, tick=False):
            response = api_client.get(
                ME, HTTP_AUTHORIZATION=f"Bearer {tokens['access']}"
            )

        assert response.status_code == 401

    def test_a_tampered_token_is_rejected(self, api_client, patient, password):
        """The signature is what makes the payload trustworthy."""
        tokens = self._tokens(api_client, patient, password)
        header, payload, signature = tokens["access"].split(".")
        forged = f"{header}.{payload}.{signature[:-4]}AAAA"

        response = api_client.get(ME, HTTP_AUTHORIZATION=f"Bearer {forged}")

        assert response.status_code == 401

    def test_a_refresh_token_cannot_be_used_as_an_access_token(
        self, api_client, patient, password
    ):
        """Tokens carry a type claim; a refresh token is not an authenticator."""
        tokens = self._tokens(api_client, patient, password)

        response = api_client.get(
            ME, HTTP_AUTHORIZATION=f"Bearer {tokens['refresh']}"
        )

        assert response.status_code == 401

    def test_an_expired_refresh_token_cannot_mint_an_access_token(
        self, api_client, patient, password
    ):
        with time_machine.travel(FROZEN_NOW, tick=False):
            tokens = self._tokens(api_client, patient, password)

        past_expiry = FROZEN_NOW + self.REFRESH_LIFETIME + timedelta(minutes=1)
        with time_machine.travel(past_expiry, tick=False):
            response = api_client.post(
                REFRESH, {"refresh": tokens["refresh"]}, format="json"
            )

        assert response.status_code == 401

    def test_refreshing_rotates_the_refresh_token(
        self, api_client, patient, password
    ):
        tokens = self._tokens(api_client, patient, password)

        response = api_client.post(
            REFRESH, {"refresh": tokens["refresh"]}, format="json"
        )

        assert response.status_code == 200
        assert response.data["refresh"] != tokens["refresh"]

    def test_the_previous_refresh_token_is_revoked_after_rotation(
        self, api_client, patient, password
    ):
        """BLACKLIST_AFTER_ROTATION is what makes rotation worth anything.

        Rotation alone hands out a replacement and leaves the old token valid
        for its full seven days, so a stolen one survives the real user
        refreshing. Blacklisting closes that window.
        """
        tokens = self._tokens(api_client, patient, password)
        api_client.post(REFRESH, {"refresh": tokens["refresh"]}, format="json")

        reused = api_client.post(
            REFRESH, {"refresh": tokens["refresh"]}, format="json"
        )

        assert reused.status_code == 401

    def test_the_rotated_replacement_still_works(
        self, api_client, patient, password
    ):
        """Revoking the old token must not revoke the one that replaced it."""
        tokens = self._tokens(api_client, patient, password)
        rotated = api_client.post(
            REFRESH, {"refresh": tokens["refresh"]}, format="json"
        )

        again = api_client.post(
            REFRESH, {"refresh": rotated.data["refresh"]}, format="json"
        )

        assert again.status_code == 200


class TestLogout:
    """Deliberate revocation, as opposed to rotation's incidental kind."""

    def _tokens(self, api_client, patient, password):
        return api_client.post(
            TOKEN, {"email": patient.email, "password": password}, format="json"
        ).data

    def test_logging_out_revokes_the_refresh_token(
        self, api_client, patient, password
    ):
        tokens = self._tokens(api_client, patient, password)

        logout = api_client.post(
            LOGOUT, {"refresh": tokens["refresh"]}, format="json"
        )

        assert logout.status_code == 204
        reused = api_client.post(
            REFRESH, {"refresh": tokens["refresh"]}, format="json"
        )
        assert reused.status_code == 401

    def test_an_already_issued_access_token_outlives_logout(
        self, api_client, patient, password
    ):
        """The tradeoff JWTs make, stated as a test rather than left implicit.

        Access tokens are verified by signature, not looked up in the database,
        so logging out cannot retract one that is already in the wild. A short
        ACCESS_TOKEN_LIFETIME is what bounds the exposure.
        """
        tokens = self._tokens(api_client, patient, password)
        api_client.post(LOGOUT, {"refresh": tokens["refresh"]}, format="json")

        response = api_client.get(ME, HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        assert response.status_code == 200

    def test_logging_out_twice_is_rejected(self, api_client, patient, password):
        tokens = self._tokens(api_client, patient, password)
        api_client.post(LOGOUT, {"refresh": tokens["refresh"]}, format="json")

        second = api_client.post(
            LOGOUT, {"refresh": tokens["refresh"]}, format="json"
        )

        assert second.status_code == 400

    def test_a_garbage_token_is_rejected(self, api_client, db):
        response = api_client.post(LOGOUT, {"refresh": "not-a-token"}, format="json")

        assert response.status_code == 400

    def test_the_refresh_token_is_required(self, api_client, db):
        response = api_client.post(LOGOUT, {}, format="json")

        assert response.status_code == 400
        assert "refresh" in response.data


class TestEmailCaseInsensitivity:
    """The email column is citext, so capitalisation never splits an account.

    Without it, someone who signs up as pat@ and later types Pat@ cannot log
    in, and registering again silently creates a second patient record --
    duplicate clinical history for one person.
    """

    def _register(self, api_client, email):
        return api_client.post(
            REGISTER, {"email": email, "password": GOOD_PASSWORD}, format="json"
        )

    def test_the_domain_is_case_insensitive(self, api_client, db):
        self._register(api_client, "pat@EXAMPLE.COM")

        response = api_client.post(
            TOKEN, {"email": "pat@example.com", "password": GOOD_PASSWORD}, format="json"
        )

        assert response.status_code == 200

    def test_the_local_part_is_case_insensitive_on_login(self, api_client, db):
        self._register(api_client, "pat@example.com")

        response = api_client.post(
            TOKEN, {"email": "Pat@example.com", "password": GOOD_PASSWORD}, format="json"
        )

        assert response.status_code == 200

    def test_differing_case_cannot_create_a_second_account(self, api_client, db):
        assert self._register(api_client, "pat@example.com").status_code == 201

        duplicate = self._register(api_client, "Pat@example.com")

        assert duplicate.status_code == 400
        assert "email" in duplicate.data
        assert User.objects.count() == 1

    def test_lookups_are_case_insensitive_at_the_orm_level(self, api_client, db):
        """Plain `=` matching is enough; no iexact needed anywhere in the code."""
        self._register(api_client, "pat@example.com")

        assert User.objects.filter(email="PAT@EXAMPLE.COM").exists()

    def test_partial_email_search_still_works(self, api_client, db):
        """citext rather than a non-deterministic collation was chosen exactly
        so LIKE keeps working -- the admin's patient search depends on it."""
        self._register(api_client, "pat@example.com")

        assert User.objects.filter(email__icontains="AT@EXAM").exists()


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

    def test_email_domains_are_normalised_on_the_way_in(self, db):
        """normalize_email lowercases the domain but preserves the local part.

        Case-insensitivity comes from the citext column, not from this: the
        address is stored as typed, and Postgres compares it without regard to
        case. See TestEmailCaseInsensitivity.
        """
        user = User.objects.create_user(
            email="Mixed@EXAMPLE.COM", password=GOOD_PASSWORD
        )

        assert user.email == "Mixed@example.com"

    def test_role_helpers_agree_with_the_role_field(self, patient, provider, staff):
        assert patient.is_patient and not patient.is_provider
        assert provider.user.is_provider and not provider.user.is_patient
        assert staff.is_clinic_staff
        # Django's admin flag is a separate concept from the clinic role.
        assert not staff.is_staff
