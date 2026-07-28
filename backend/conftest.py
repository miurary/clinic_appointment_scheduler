"""Shared fixtures, visible to every app's tests.

pytest collects conftest.py from each directory on the path to a test file, so
anything here is available app-wide. Scheduling-specific fixtures (appointments,
time off) live in apps/scheduling/tests/conftest.py instead.

Two fully specified patients and two fully specified providers exist so that
isolation tests are meaningful: the "other" records carry real data and
deliberately different settings, so a leak across accounts fails loudly rather
than coincidentally producing the right answer.

Each provider is built from a ProviderSpec, and tests derive their expected slot
counts from the same spec. That keeps expectations like "16 slots" out of the
assertions: change a window or a slot length in one place and the tests follow.
"""
from dataclasses import dataclass, replace
from datetime import date, time

import pytest
import time_machine
from rest_framework.test import APIClient

from apps.accounts.models import PatientProfile, ProviderProfile, Role, User
from apps.scheduling.models import AvailabilityRule, Weekday
from testkit import FROZEN_NOW, NY

PASSWORD = "tests-are-good-42"


@dataclass(frozen=True)
class ProviderSpec:
    """The declared shape of a provider fixture.

    Fixtures are built from it and tests derive expectations from it, so a
    count like "16 slots" is computed from the window rather than typed in.

    Every setting that affects slot generation belongs here. Leaving some of
    them in the construction helper would mean the spec no longer describes the
    provider it built.
    """

    timezone: str
    weekday: int
    opens: time
    closes: time
    slot_minutes: int
    specialty: str = "Family medicine"
    # Off by default so that most tests can book on the frozen Monday itself.
    min_notice_minutes: int = 0
    booking_horizon_days: int = 365
    # Dead time either side of a booking. Does not move the slot grid.
    buffer_minutes: int = 0

    def slots_in_hours(self, hours: float) -> int:
        """Whole slots fitting in a span of real elapsed hours.

        Takes hours rather than reading the window because on a DST transition
        day the wall-clock window and the real elapsed time differ -- which is
        exactly what those tests are about.
        """
        return int(hours * 60 // self.slot_minutes)

    @property
    def window_hours(self) -> float:
        opens = self.opens.hour + self.opens.minute / 60
        closes = self.closes.hour + self.closes.minute / 60
        return closes - opens

    @property
    def slot_count(self) -> int:
        """Slots on an ordinary day with no DST transition."""
        return self.slots_in_hours(self.window_hours)


PROVIDER_SPEC = ProviderSpec(
    timezone="America/New_York",
    weekday=Weekday.MONDAY,
    opens=time(9, 0),
    closes=time(17, 0),
    slot_minutes=30,
)

# Deliberately different in every dimension: if a view reads the wrong
# provider's timezone or slot length, the result is obviously wrong rather than
# accidentally matching the first provider's.
OTHER_PROVIDER_SPEC = ProviderSpec(
    timezone="America/Los_Angeles",
    weekday=Weekday.MONDAY,
    opens=time(10, 0),
    closes=time(16, 0),
    slot_minutes=60,
    specialty="Dermatology",
)

# Sundays 01:00-05:00 New York straddles both US DST transitions.
DST_PROVIDER_SPEC = ProviderSpec(
    timezone="America/New_York",
    weekday=Weekday.SUNDAY,
    opens=time(1, 0),
    closes=time(5, 0),
    slot_minutes=30,
)

# Asia/Kolkata is UTC+5:30 and never observes DST: it catches code that assumes
# whole-hour offsets, without any transition to muddy the result.
KOLKATA_PROVIDER_SPEC = replace(PROVIDER_SPEC, timezone="Asia/Kolkata")

# Australia/Adelaide is UTC+9:30 and its DST runs the opposite way round to the
# northern hemisphere -- clocks go forward in October, back in April. Proves the
# transition handling is not hard-coded to US rules.
ADELAIDE_PROVIDER_SPEC = replace(DST_PROVIDER_SPEC, timezone="Australia/Adelaide")

# Variants of the standard provider, expressed as deltas so the relationship
# stays visible and a change to PROVIDER_SPEC carries through. Declaring these
# is what lets tests stop mutating a model mid-test to set up their own world.
BUFFERED_PROVIDER_SPEC = replace(PROVIDER_SPEC, buffer_minutes=15)
# Four hours notice against a frozen 07:00 local clock makes 11:00 the first
# bookable slot.
NOTICE_PROVIDER_SPEC = replace(PROVIDER_SPEC, min_notice_minutes=4 * 60)


@pytest.fixture
def frozen_clock():
    """Pin timezone.now(). tick=False stops the clock rather than advancing it."""
    with time_machine.travel(FROZEN_NOW, tick=False):
        yield FROZEN_NOW


@pytest.fixture
def monday(frozen_clock):
    """The provider-local date of the frozen instant.

    Depends on frozen_clock deliberately: a test that took a fixed date while
    timezone.now() still ran live would evaluate notice windows and booking
    horizons against the real clock, and pass or fail by the calendar.
    """
    return frozen_clock.astimezone(NY).date()


@pytest.fixture
def password():
    """The password every user fixture is created with."""
    return PASSWORD


# --- construction helpers -------------------------------------------------


def make_patient(email, first, last, tz="America/New_York", dob=date(1990, 5, 17)):
    user = User.objects.create_user(
        email=email,
        password=PASSWORD,
        first_name=first,
        last_name=last,
        role=Role.PATIENT,
        timezone=tz,
    )
    PatientProfile.objects.create(user=user, date_of_birth=dob)
    return user


def make_provider(email, first, last, spec: ProviderSpec):
    user = User.objects.create_user(
        email=email,
        password=PASSWORD,
        first_name=first,
        last_name=last,
        role=Role.PROVIDER,
        timezone=spec.timezone,
    )
    profile = ProviderProfile.objects.create(
        user=user,
        specialty=spec.specialty,
        slot_duration_minutes=spec.slot_minutes,
        min_notice_minutes=spec.min_notice_minutes,
        booking_horizon_days=spec.booking_horizon_days,
        buffer_minutes=spec.buffer_minutes,
    )
    AvailabilityRule.objects.create(
        provider=profile,
        weekday=spec.weekday,
        start_time=spec.opens,
        end_time=spec.closes,
        valid_from=date(2020, 1, 1),
    )
    return profile


# --- specs (available to tests for deriving expectations) -----------------


@pytest.fixture
def provider_spec():
    return PROVIDER_SPEC


@pytest.fixture
def other_provider_spec():
    return OTHER_PROVIDER_SPEC


@pytest.fixture
def dst_provider_spec():
    return DST_PROVIDER_SPEC


@pytest.fixture
def kolkata_provider_spec():
    return KOLKATA_PROVIDER_SPEC


@pytest.fixture
def adelaide_provider_spec():
    return ADELAIDE_PROVIDER_SPEC


@pytest.fixture
def buffered_provider_spec():
    return BUFFERED_PROVIDER_SPEC


@pytest.fixture
def notice_provider_spec():
    return NOTICE_PROVIDER_SPEC


# --- users ----------------------------------------------------------------


@pytest.fixture
def patient(db):
    return make_patient("patient@example.com", "Pat", "Ient")


@pytest.fixture
def other_patient(db):
    """A second real patient, for checking neither can reach the other's data."""
    return make_patient(
        "other.patient@example.com",
        "Otto",
        "Ther",
        tz="America/Chicago",
        dob=date(1978, 11, 2),
    )


@pytest.fixture
def staff(db):
    return User.objects.create_user(
        email="frontdesk@example.com",
        password=PASSWORD,
        first_name="Fran",
        last_name="Desk",
        role=Role.CLINIC_STAFF,
    )


@pytest.fixture
def provider(db):
    """New York, Mondays 09:00-17:00, 30 minute slots, no notice period."""
    return make_provider("provider@example.com", "Dana", "Docta", PROVIDER_SPEC)


@pytest.fixture
def other_provider(db):
    """Los Angeles, Mondays 10:00-16:00, 60 minute slots."""
    return make_provider(
        "other.provider@example.com", "Robin", "Elsewhere", OTHER_PROVIDER_SPEC
    )


@pytest.fixture
def kolkata_provider(db):
    """Mondays 09:00-17:00 at UTC+5:30, with no DST anywhere in the year."""
    return make_provider(
        "kolkata.provider@example.com", "Kiran", "Rao", KOLKATA_PROVIDER_SPEC
    )


@pytest.fixture
def adelaide_provider(db):
    """Sundays 01:00-05:00 at UTC+9:30, with southern-hemisphere DST."""
    return make_provider(
        "adelaide.provider@example.com", "Alex", "Downunder", ADELAIDE_PROVIDER_SPEC
    )


@pytest.fixture
def buffered_provider(db):
    """As `provider`, but with 15 minutes of turnover either side of a booking."""
    return make_provider(
        "buffered.provider@example.com", "Bev", "Buffer", BUFFERED_PROVIDER_SPEC
    )


@pytest.fixture
def notice_provider(db):
    """As `provider`, but requiring four hours notice before a slot."""
    return make_provider(
        "notice.provider@example.com", "Nick", "Notice", NOTICE_PROVIDER_SPEC
    )


@pytest.fixture
def dst_provider(db):
    """New York, Sundays 01:00-05:00 -- straddles both DST transitions.

    This is the case _to_utc's round-trip check exists for; without a fixture
    that crosses a transition, the most interesting code in the project is
    never exercised.
    """
    return make_provider("dst.provider@example.com", "Sam", "Shift", DST_PROVIDER_SPEC)


# --- authenticated clients ------------------------------------------------


@pytest.fixture
def api_client():
    return APIClient()


def _client_for(user):
    client = APIClient()
    # Bypasses the token endpoint: these tests are about authorization, not
    # about JWT issuance, which is tested separately.
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def patient_client(patient):
    return _client_for(patient)


@pytest.fixture
def other_patient_client(other_patient):
    return _client_for(other_patient)


@pytest.fixture
def provider_client(provider):
    return _client_for(provider.user)


@pytest.fixture
def other_provider_client(other_provider):
    return _client_for(other_provider.user)


@pytest.fixture
def staff_client(staff):
    return _client_for(staff)
