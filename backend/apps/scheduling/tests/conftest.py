"""Scheduling-domain fixtures used by more than one test module.

pytest merges this with the backend-root conftest for tests in this directory,
so these can build on `provider`, `patient` and friends.

Single-use setup (overlap attempts, DST appointments) is defined in the test
module that needs it, not here: a fixture only earns a place in conftest when
several modules share it, otherwise the reader has to leave the test file to
find out what it means.

Times come from slot_at(day, spec, index) rather than UTC literals. A literal
like "15:00 UTC" is only meaningful given the provider's opening hour and
timezone, so it silently stops describing a real slot the moment a spec
changes; deriving it means the fixture follows instead.
"""
from datetime import timedelta

import pytest

from apps.scheduling.models import Appointment, TimeOff
from testkit import slot_at


@pytest.fixture
def booked_appointment(provider, provider_spec, patient, monday):
    """The provider's third slot of the day: 10:00-10:30 New York."""
    start = slot_at(monday, provider_spec, index=2)
    return Appointment.objects.create(
        provider=provider,
        patient=patient,
        booked_by=patient,
        start_at=start,
        end_at=start + timedelta(minutes=provider_spec.slot_minutes),
        reason="Annual physical",
    )


@pytest.fixture
def other_appointment(other_provider, other_provider_spec, other_patient, monday):
    """The other provider's opening slot: 10:00-11:00 Los Angeles.

    A different provider, a different patient and a different timezone, so a
    scoping bug cannot pass by coincidence.
    """
    start = slot_at(monday, other_provider_spec, index=0)
    return Appointment.objects.create(
        provider=other_provider,
        patient=other_patient,
        booked_by=other_patient,
        start_at=start,
        end_at=start + timedelta(minutes=other_provider_spec.slot_minutes),
        reason="Follow-up",
    )


@pytest.fixture
def time_off(provider, provider_spec, monday):
    """Two slots' worth, starting at 15:00 New York."""
    covered_slots = 2
    start = slot_at(monday, provider_spec, index=12)
    return TimeOff.objects.create(
        provider=provider,
        start_at=start,
        end_at=start + timedelta(minutes=covered_slots * provider_spec.slot_minutes),
        reason="Team meeting",
    )
