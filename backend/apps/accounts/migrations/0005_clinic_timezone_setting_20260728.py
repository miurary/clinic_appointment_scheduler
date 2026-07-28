"""Availability is authored in the clinic's zone, not a per-provider one.

0004 gave each provider their own scheduling zone. That was the wrong shape: a
single-site clinic has one zone, providers work its hours, and making the zone a
provider-editable field forced the UI to ask an unanswerable question whenever
one changed ("did you move, or was the zone wrong?"). The zone is now
settings.CLINIC_TIMEZONE.

Dropping the column cannot lose scheduling behaviour for a deployment whose
providers were all on the clinic's zone, which is every deployment that exists.
The check below refuses to run if that is not true, rather than silently moving
somebody's working hours by three hours.
"""

from django.conf import settings
from django.db import migrations


def refuse_if_providers_disagree(apps, schema_editor):
    ProviderProfile = apps.get_model("accounts", "ProviderProfile")
    clinic = settings.CLINIC_TIMEZONE
    conflicting = (
        ProviderProfile.objects.exclude(scheduling_timezone="")
        .exclude(scheduling_timezone=clinic)
        .values_list("user__email", "scheduling_timezone")
    )
    if conflicting:
        listed = ", ".join(f"{email} ({zone})" for email, zone in conflicting)
        raise RuntimeError(
            f"These providers author availability in a zone other than the "
            f"clinic's ({clinic}): {listed}. Dropping the column would "
            f"reinterpret their hours as clinic-local and move when they work. "
            f"Set CLINIC_TIMEZONE to match, or rewrite their AvailabilityRule "
            f"times into clinic time first."
        )


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0004_provider_scheduling_timezone_20260728"),
    ]

    operations = [
        migrations.RunPython(
            refuse_if_providers_disagree, migrations.RunPython.noop, elidable=True
        ),
        migrations.RemoveField(
            model_name="providerprofile",
            name="scheduling_timezone",
        ),
    ]
