# Clinic Scheduler

A clinic appointment scheduler — patients browse a provider's real availability and book; providers set their weekly hours, block time off, and see their week.

<!-- GIF -->

## Why

I wanted to create a bookings solution for clinics.

What I found were some problems that you wouldn't encounter until actually trying to build a booking site:

- Race conditions between two patients trying to book the same slot at the same time. 
- A time slot or an opening time at 9AM is always 9AM, even when daylight savings occurs.
- People and devices operate in different timezones - the provider, patient, computers, and phones could all have a different idea about what timezone is right.

I also wanted to get experience in React Native and Django with AI-assisted tooling.

## Stack

Django 5.1 · DRF · SimpleJWT · PostgreSQL 16 · React Native (Expo SDK 57) targeting iOS, Android and web from one codebase.

## Architecture decisions

### 1. The database prevents double-booking, not the application

`Appointment` carries a Postgres `ExclusionConstraint` scoped to active statuses:

```python
ExclusionConstraint(
    name="appointment_no_provider_overlap",
    expressions=[
        ("provider", RangeOperators.EQUAL),
        (TsTzRange("start_at", "end_at", RangeBoundary()), RangeOperators.OVERLAPS),
    ],
    condition=Q(status__in=ACTIVE_STATUSES),
)
```

**Rejected:** Checking for a conflicting appointment in the serializer, and `SELECT … FOR UPDATE` on the provider row.

**Why:** The serializer check is a race. If two requests come in, they can both pass and write. This results
in a double-booked provider which has real consequences. Row locking works, but now every booking for a provider
is behind a single lock and future paths have to rely on using it. The DB constraint will always hold.

**What it costs:** This locks the solution to PostgreSQL only. The bounds hold a lot of the logic. The race condition can fail in multiple ways depending on the timing, so we have to key off SQLSTATE:

```python
SLOT_CONFLICT_SQLSTATES = frozenset({"23P01", "40P01", "40001"})
```

`40P01` (deadlock) surfaces as `OperationalError`.
This was caught with testing. All three now map to HTTP409 rather than 500.

### 2. Availability is wall-clock; appointments are instants

`AvailabilityRule` stores a bare `TimeField` — `09:00`, no zone — interpreted in the clinic's timezone. `Appointment` and `TimeOff` store UTC `DateTimeField`s.

**Rejected (twice):**

Storing availability as UTC. This doesn't work with DST since 9AM would become 8AM.

Tried to fix with a per-provider scheduling timezone. This gave the provider the option to say that either
they moved or the zone was mislabeled. Both changed the timing of the meeting when selected and were
honestly incoherent. Both of these seemed like cases that wouldn't be encountered in a normal clinic - I chose
to focus on the case that providers are working in a single clinic rather than full remote where they could
be in any timezone.

**Why the current design:** A single-site clinic only has one timezone. Providers work hours at that clinic,
so the timezone is a deployment setting/constant. The user's timezone is a display preference.

DST is handled in `_to_utc`. `zoneinfo` raises on neither a nonexistent time nor an ambiguous one, so the only reliable detection is a round-trip:

```python
aware = naive.replace(tzinfo=tz, fold=0)
if aware.astimezone(UTC).astimezone(tz).replace(tzinfo=None) != naive:
    return None  # 2:30 AM on a spring-forward Sunday never happens
```

Ambiguous fall-back times resolve to `fold=0`, the first occurrence.

### 3. Slots are computed

`generate_slots()` turns provider rules into timeslots on demand. Nothing saves to the DB until a booking is made. `generate_slots()` runs 3 queries regardless of days requested by widening the window once and filtering in Python instead of querying per day. This is tested to prevent an increase in query count from future changes.

**Rejected:** Materialising a `Slot` table.

**Why:** Slots are computed from the availability rule, any time off added, existing bookings, and the provider's
information - slot length and buffer time before and after appointments. Changing one causes the table to be
wrong unless backfilled. This has consequences if a patient sees a slot that isn't actually available.

**What it costs:** Slots can't be filtered or paginated in SQL, so the booking horizon is what keeps the range bounded.

### Smaller calls

- `citext` for email despite deprecation. Non-deterministic `db_collation` forbids `LIKE` and breaks `icontains` in Django admin.
- One React Native tree with a 768px breakpoint. Layout branches on `useWindowDimensions()` so the data layer never forks.
- Refresh token rotation with blacklisting. Logout revokes immediately.

## Running it

Needs Docker (for Postgres), Python 3.12+, and Node 20+.

```bash
git clone <this repo> && cd django

cp .env.example .env

python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt

npm --prefix frontend install

./dev.sh --seed
```

`dev.sh` starts the Postgres container, waits for it to accept connections, applies migrations, then runs the API and Expo together, tailing both logs into `.dev-logs/`.

- API — http://localhost:8000
- OpenAPI docs — http://localhost:8000/api/docs/
- Django admin — http://localhost:8000/admin/
- Web app — http://localhost:8081

`--seed` loads three providers, four patients and a week of bookings. Every demo account uses the password `demo-password-1234`; sign in as `dana.okafor@clinic.test` for the provider views or `alex.rivera@example.test` for the patient views.

Other flags: `./dev.sh --api` skips Expo, `./dev.sh --stop` takes the database container down too (Ctrl-C leaves it running so the next start is instant).

```bash
cd backend && .venv/bin/python -m pytest    # 194 tests
cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .
cd frontend && npx tsc --noEmit
```

## Known limitations

### Data Issues

- Web stores JWTs where XSS can reach them. Production wants httpOnly cookies with CSRF protection.
- `PatientProfile.notes` is PHI in a plain text column - needs encryption at rest, access auditing, and a retention policy.
- Throttle counters live in each worker's memory, so the effective rate limit multiplies by worker count. Needs Redis as the cache backend.
- `X-Forwarded-For` isn't trusted, so behind a load balancer every request throttles against the balancer's IP.

### Product gaps

- Overlapping availability windows on the same day aren't rejected.
- Toggling a day off deletes its windows with no confirmation.
- Time off can't span midnight into a second day.
- Appointments can't be marked for status - the status field holds values for no-shows and completed, but gives providers no way to mark past appointments.
- `accepting_new_patients` flag isn't enforced.

### Engineering gaps

- No frontend tests and no frontend linting.
- Add a `Location` model to handle multi-clinic or remote providers.
- Was built for Lightsail - gunicorn, WhiteNoise, env-driven settings - but hasn't been fully deployed to AWS.
