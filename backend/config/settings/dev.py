"""Local development settings."""
from .base import *  # noqa: F403

DEBUG = True
ALLOWED_HOSTS = ["*"]

# Expo dev server ports (web bundle) plus anything on localhost.
CORS_ALLOW_ALL_ORIGINS = True

# Browsable API is handy while poking at endpoints by hand.
REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = (  # noqa: F405
    "rest_framework.renderers.JSONRenderer",
    "rest_framework.renderers.BrowsableAPIRenderer",
)

# Hashed/manifested static files are pointless locally and break on missing files.
STORAGES["staticfiles"] = {  # noqa: F405
    "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
}

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
