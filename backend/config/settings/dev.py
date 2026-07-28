"""Local development settings."""

from .base import *

DEBUG = True
ALLOWED_HOSTS = ["*"]

# Expo dev server ports (web bundle) plus anything on localhost.
CORS_ALLOW_ALL_ORIGINS = True

# Browsable API is handy while poking at endpoints by hand.
REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = (
    "rest_framework.renderers.JSONRenderer",
    "rest_framework.renderers.BrowsableAPIRenderer",
)

# Hashed/manifested static files are pointless locally and break on missing files.
STORAGES["staticfiles"] = {
    "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
}

# runserver serves static files itself in development, so WhiteNoise has
# nothing to do and only warns about the uncollected staticfiles directory.
MIDDLEWARE = [m for m in MIDDLEWARE if "whitenoise" not in m]

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
