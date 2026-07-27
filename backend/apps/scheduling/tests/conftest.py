"""Scheduling-domain fixtures used by more than one test module.

pytest merges this with the backend-root conftest for tests in this directory,
so these can build on `provider`, `patient` and friends.

Single-use setup (overlap attempts, DST appointments) is defined in the test
module that needs it, not here: a fixture only earns a place in conftest when
several modules share it, otherwise the reader has to leave the test file to
find out what it means.

All datetimes are UTC, with the provider-local equivalent in a comment: that
mapping is the part a future reader is most likely to misread.
"""
from datetime import datetime, timezone as dt_timezone

import pytest

from apps.scheduling.models import Appointment, TimeOff


def utc(year, month, day, hour, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=dt_timezone.utc)


@pytest.fixture
def booked_appointment(provider, patient):
    """Monday 10:00-10:30 New York."""
    return Appointment.objects.create(
        provider=provider,
        patient=patient,
        booked_by=patient,
        start_at=utc(2026, 3, 2, 15, 0),
        end_at=utc(2026, 3, 2, 15, 30),
        reason="Annual physical",
    )


@pytest.fixture
def other_appointment(other_provider, other_patient):
    """Monday 10:00-11:00 Los Angeles: a different provider and patient."""
    return Appointment.objects.create(
        provider=other_provider,
        patient=other_patient,
        booked_by=other_patient,
        start_at=utc(2026, 3, 2, 18, 0),
        end_at=utc(2026, 3, 2, 19, 0),
        reason="Follow-up",
    )


@pytest.fixture
def time_off(provider):
    """Monday 15:00-16:00 New York, covering two of the provider's slots."""
    return TimeOff.objects.create(
        provider=provider,
        start_at=utc(2026, 3, 2, 20, 0),
        end_at=utc(2026, 3, 2, 21, 0),
        reason="Team meeting",
    )
