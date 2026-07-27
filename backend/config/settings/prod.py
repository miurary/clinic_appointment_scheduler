"""Production settings (AWS Lightsail container service, or any Docker host).

Everything that differs from local is driven by environment variables, so the
same image runs in both places.
"""
from .base import *  # noqa: F403

DEBUG = False

# Fail loudly at boot rather than silently running with an insecure default.
SECRET_KEY = env("DJANGO_SECRET_KEY")  # noqa: F405
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")  # noqa: F405

# Lightsail terminates TLS at its load balancer and forwards over HTTP, so
# Django needs the forwarded header to know the original scheme.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)  # noqa: F405
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=60 * 60 * 24 * 30)  # noqa: F405
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
X_FRAME_OPTIONS = "DENY"

# Managed Postgres (Lightsail database) requires TLS.
DATABASES["default"].setdefault("OPTIONS", {})  # noqa: F405
DATABASES["default"]["OPTIONS"]["sslmode"] = env(  # noqa: F405
    "DB_SSLMODE", default="require"
)
