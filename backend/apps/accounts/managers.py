from django.contrib.auth.base_user import BaseUserManager


class UserManager(BaseUserManager):
    """Django's default UserManager assumes a username field; ours uses email."""

    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("An email address is required.")
        # Lowercases the domain only -- this is not case-insensitive login.
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        # set_password hashes; never assign to user.password directly.
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        from .models import Role  # local import: models.py imports this module

        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        # A superuser is an operator, not a patient (the model-level default).
        extra_fields.setdefault("role", Role.CLINIC_STAFF)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        return self._create_user(email, password, **extra_fields)
