#!/usr/bin/env bash
#
# One command to bring up the whole stack: Postgres, the Django API, and the
# Expo app.
#
#   ./dev.sh              database + API + frontend
#   ./dev.sh --seed       ... and load demo providers, patients and bookings
#   ./dev.sh --api        API only (no Expo)
#   ./dev.sh --stop       stop everything, including the database container
#
# Ctrl-C shuts the API and Expo down. The Postgres container is deliberately
# left running so the next start is instant; use --stop to take it down too.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
PYTHON="$BACKEND/.venv/bin/python"
LOG_DIR="$ROOT/.dev-logs"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-8081}"

SEED=0
RUN_FRONTEND=1

for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    --api) RUN_FRONTEND=0 ;;
    --stop)
      echo "Stopping the database container..."
      docker compose -f "$ROOT/docker-compose.yml" stop db
      exit 0
      ;;
    -h|--help)
      sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

# --- pretty output -----------------------------------------------------------
BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
TEAL=$'\033[36m'; YELLOW=$'\033[33m'; RED=$'\033[31m'

say()  { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$1"; }
warn() { printf '%s==>%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()  { printf '%s==>%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }

# --- shutdown ----------------------------------------------------------------
# Each service spawns children (Django's autoreloader, Metro under Expo), so
# killing only the PID we launched would leave orphans holding the ports.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

PIDS=()
cleanup() {
  trap - EXIT INT TERM
  echo
  say "Shutting down..."
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill_tree "$pid"
  done
  wait 2>/dev/null || true
  printf '%sPostgres is still running. ./dev.sh --stop to take it down.%s\n' "$DIM" "$RESET"
}
trap cleanup EXIT INT TERM

# --- preflight ---------------------------------------------------------------
command -v docker >/dev/null || die "docker is not installed or not on PATH."
docker info >/dev/null 2>&1 || die "The docker daemon is not running. Start Docker Desktop and retry."
[ -x "$PYTHON" ] || die "No virtualenv at backend/.venv. Create it, then: pip install -r backend/requirements-dev.txt"

if [ ! -f "$ROOT/.env" ]; then
  warn "No .env found — copying .env.example."
  cp "$ROOT/.env.example" "$ROOT/.env"
fi

if [ "$RUN_FRONTEND" -eq 1 ] && [ ! -d "$FRONTEND/node_modules" ]; then
  say "Installing frontend dependencies (first run only)..."
  (cd "$FRONTEND" && npm install)
fi

mkdir -p "$LOG_DIR"

# --- database ----------------------------------------------------------------
say "Starting Postgres..."
docker compose -f "$ROOT/docker-compose.yml" up -d db >/dev/null

printf '%s    waiting for it to accept connections' "$DIM"
for _ in $(seq 1 60); do
  if docker compose -f "$ROOT/docker-compose.yml" exec -T db pg_isready -U clinic -d clinic >/dev/null 2>&1; then
    ready=1
    break
  fi
  printf '.'
  sleep 1
done
printf '%s\n' "$RESET"
[ "${ready:-0}" = 1 ] || die "Postgres did not become ready in 60s. Check: docker compose logs db"

# --- migrations --------------------------------------------------------------
say "Applying migrations..."
(cd "$BACKEND" && "$PYTHON" manage.py migrate --no-input >"$LOG_DIR/migrate.log" 2>&1) \
  || { cat "$LOG_DIR/migrate.log"; die "Migrations failed."; }

if [ "$SEED" -eq 1 ]; then
  say "Seeding demo data..."
  (cd "$BACKEND" && "$PYTHON" manage.py seed_demo)
fi

# --- services ----------------------------------------------------------------
say "Starting the API on :$BACKEND_PORT"
(cd "$BACKEND" && "$PYTHON" manage.py runserver "0.0.0.0:$BACKEND_PORT") \
  >"$LOG_DIR/backend.log" 2>&1 &
PIDS+=($!)

if [ "$RUN_FRONTEND" -eq 1 ]; then
  say "Starting Expo on :$FRONTEND_PORT"
  # EXPO_PUBLIC_API_URL is read by the API client; without it a phone on the
  # LAN would try to reach the API on its own loopback.
  (cd "$FRONTEND" && EXPO_PUBLIC_API_URL="http://localhost:$BACKEND_PORT" \
    npx expo start --port "$FRONTEND_PORT") >"$LOG_DIR/frontend.log" 2>&1 &
  PIDS+=($!)
fi

sleep 3
cat <<BANNER

  ${BOLD}Kivo scheduler is up${RESET}

    API        ${TEAL}http://localhost:$BACKEND_PORT${RESET}
    API docs   ${TEAL}http://localhost:$BACKEND_PORT/api/docs/${RESET}
    Admin      ${TEAL}http://localhost:$BACKEND_PORT/admin/${RESET}
BANNER

if [ "$RUN_FRONTEND" -eq 1 ]; then
  cat <<BANNER
    Web app    ${TEAL}http://localhost:$FRONTEND_PORT${RESET}  ${DIM}(press w in the Expo output)${RESET}
    Mobile     ${DIM}scan the QR in .dev-logs/frontend.log with Expo Go${RESET}
BANNER
fi

cat <<BANNER

  ${DIM}Logs stream below, and are also in .dev-logs/. Ctrl-C to stop.${RESET}

BANNER

# --- stream logs -------------------------------------------------------------
# Tailing files rather than piping the processes directly keeps each service's
# real PID killable; a pipeline would hand us the subshell's PID instead.
TAIL_TARGETS=("$LOG_DIR/backend.log")
[ "$RUN_FRONTEND" -eq 1 ] && TAIL_TARGETS+=("$LOG_DIR/frontend.log")

tail -n +1 -F "${TAIL_TARGETS[@]}" 2>/dev/null &
PIDS+=($!)

wait
