from django.contrib import admin

from .models import Appointment, AvailabilityRule, TimeOff


@admin.register(AvailabilityRule)
class AvailabilityRuleAdmin(admin.ModelAdmin):
    list_display = ("provider", "weekday", "start_time", "end_time", "valid_from", "valid_until")
    list_filter = ("weekday", "provider")
    list_select_related = ("provider", "provider__user")
    autocomplete_fields = ("provider",)


@admin.register(TimeOff)
class TimeOffAdmin(admin.ModelAdmin):
    list_display = ("provider", "start_at", "end_at", "reason")
    list_filter = ("provider",)
    list_select_related = ("provider", "provider__user")
    autocomplete_fields = ("provider",)
    date_hierarchy = "start_at"


@admin.register(Appointment)
class AppointmentAdmin(admin.ModelAdmin):
    list_display = ("start_at", "end_at", "provider", "patient", "status")
    list_filter = ("status", "provider")
    search_fields = ("patient__email", "patient__first_name", "patient__last_name", "reason")
    list_select_related = ("provider", "provider__user", "patient")
    autocomplete_fields = ("provider", "patient", "booked_by")
    date_hierarchy = "start_at"
    # Audit trail: recorded by the system, not edited after the fact.
    readonly_fields = ("created_at", "updated_at", "booked_by")
