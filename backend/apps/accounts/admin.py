from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import UserChangeForm, UserCreationForm

from .models import PatientProfile, ProviderProfile, User


class UserCreateForm(UserCreationForm):
    """Renders two password inputs and hashes on save."""

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("email", "first_name", "last_name", "role", "timezone")


class UserEditForm(UserChangeForm):
    """Shows a read-only password hash plus a link to the change-password form,
    rather than a text input that would save plaintext."""

    class Meta(UserChangeForm.Meta):
        model = User
        fields = "__all__"


class ProviderProfileInline(admin.StackedInline):
    model = ProviderProfile
    can_delete = False
    max_num = 1
    verbose_name_plural = "provider profile"


class PatientProfileInline(admin.StackedInline):
    model = PatientProfile
    can_delete = False
    max_num = 1
    verbose_name_plural = "patient profile"


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    # Django's UserAdmin is written against AbstractUser and references
    # `username` throughout, so every one of these has to be redeclared.
    form = UserEditForm
    add_form = UserCreateForm
    ordering = ("email",)
    list_display = ("email", "first_name", "last_name", "role", "is_active", "is_staff")
    list_filter = ("role", "is_active", "is_staff", "is_superuser")
    search_fields = ("email", "first_name", "last_name")

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal", {"fields": ("first_name", "last_name", "phone", "timezone")}),
        ("Role", {"fields": ("role",)}),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "first_name",
                    "last_name",
                    "role",
                    "timezone",
                    "password1",
                    "password2",
                ),
            },
        ),
    )

    def get_inlines(self, request, obj=None):
        # No profile to edit until the user exists and has a role.
        if obj is None:
            return []
        if obj.is_provider:
            return [ProviderProfileInline]
        if obj.is_patient:
            return [PatientProfileInline]
        return []


@admin.register(ProviderProfile)
class ProviderProfileAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "specialty",
        "slot_duration_minutes",
        "accepting_new_patients",
    )
    list_filter = ("accepting_new_patients", "specialty")
    search_fields = ("user__email", "user__first_name", "user__last_name", "specialty")
    list_select_related = ("user",)
    autocomplete_fields = ("user",)


@admin.register(PatientProfile)
class PatientProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "date_of_birth")
    search_fields = ("user__email", "user__first_name", "user__last_name")
    list_select_related = ("user",)
    autocomplete_fields = ("user",)
