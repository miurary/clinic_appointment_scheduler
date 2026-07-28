FROM python:3.12-slim

# No .pyc files in an immutable image; unbuffered stdout so `docker logs` is live.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first: this layer is cached and only rebuilds when the pinned
# requirements change, so a code edit does not reinstall every package.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Gather admin/DRF static files for WhiteNoise. prod settings require a real
# SECRET_KEY to import, so feed throwaway values for this one command -- they
# are not baked into the image and no database is contacted.
RUN DJANGO_SETTINGS_MODULE=config.settings.prod \
    DJANGO_SECRET_KEY=build-time-only-not-used-for-signing \
    DJANGO_ALLOWED_HOSTS=localhost \
    python manage.py collectstatic --noinput

# Drop privileges: a compromised process should not be able to write system
# paths or install packages.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Migrations are NOT run here: every worker would race to apply them on boot.
# Run `manage.py migrate` as a separate deploy step (see README).
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--timeout", "60", \
     "--access-logfile", "-"]
