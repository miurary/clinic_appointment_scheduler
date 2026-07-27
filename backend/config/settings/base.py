"""Base settings shared by every environment.

Environment-specific modules (dev.py, prod.py) import * from here and override.
Nothing in this file should assume it is running locally.
"""
from datetime import timedelta
from pathlib import Path

import environ

# backend/config/settings/base.py -> backend/
BASE_DIR = Path(__file__).resolve().parent.parent.parent
REPO_ROOT = BASE_DIR.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:8081", "http://localhost:19006"]),
    CSRF_TRUSTED_ORIGINS=(list, []),
)
environ.Env.read_env(REPO_ROOT / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-only-insecure-key-replace-before-deploying")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    # Third party
    "rest_framework",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    # Local
    "apps.accounts",
    "apps.scheduling",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Postgres only. The scheduling app relies on an exclusion constraint and
# tstzrange, neither of which SQLite can express.
DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgres://clinic:clinic@localhost:5432/clinic",
    )
}
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"

# Everything is stored in UTC. Conversion to a provider's or patient's local
# time happens only at the edges -- see apps.scheduling.services.slots.
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    # Deny by default: a view must explicitly opt out to be public.
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": ("django_filters.rest_framework.DjangoFilterBackend",),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_THROTTLE_CLASSES": ("rest_framework.throttling.ScopedRateThrottle",),
    # Read by views that set throttle_scope. Counters live in the Django cache,
    # which defaults to per-process memory -- under multiple gunicorn workers
    # the effective limit is multiplied by the worker count. Point CACHES at
    # Redis before relying on these in production.
    "DEFAULT_THROTTLE_RATES": {
        "register": env("THROTTLE_REGISTER", default="10/hour"),
        "login": env("THROTTLE_LOGIN", default="20/hour"),
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Clinic Scheduling API",
    "DESCRIPTION": "Provider availability and patient appointment booking.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {"format": "{levelname} {asctime} {name} {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
}
