import { CLINIC_TIMEZONE, TIMEZONES } from '../theme/tokens';

/**
 * Rendering UTC instants in whichever zone the viewer picked.
 *
 * The server stores and returns UTC. Nothing here ever changes an instant --
 * the timezone control is purely a display concern, so switching it re-labels
 * the same moments. Intl.DateTimeFormat does the conversion, which is
 * available in Hermes and on web, so one implementation serves both.
 */

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions) {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let existing = cache.get(key);
  if (!existing) {
    existing = new Intl.DateTimeFormat('en-US', { timeZone, ...options });
    cache.set(key, existing);
  }
  return existing;
}

/** "9:00 AM" */
export function formatTime(iso: string, timeZone: string): string {
  return formatter(timeZone, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** "Mon, Jul 27" */
export function formatDayDate(iso: string, timeZone: string): string {
  return formatter(timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

/** "Jul 27" */
export function formatShortDate(iso: string, timeZone: string): string {
  return formatter(timeZone, { month: 'short', day: 'numeric' }).format(new Date(iso));
}

/** "MON" — the day-selector pills. */
export function formatWeekdayAbbr(iso: string, timeZone: string): string {
  return formatter(timeZone, { weekday: 'short' })
    .format(new Date(iso))
    .toUpperCase();
}

/** "Mon" */
export function formatWeekdayShort(iso: string, timeZone: string): string {
  return formatter(timeZone, { weekday: 'short' }).format(new Date(iso));
}

/** "JUL" — the date chip on the upcoming card. */
export function formatMonthAbbr(iso: string, timeZone: string): string {
  return formatter(timeZone, { month: 'short' }).format(new Date(iso)).toUpperCase();
}

/** "27" */
export function formatDayNumber(iso: string, timeZone: string): string {
  return formatter(timeZone, { day: 'numeric' }).format(new Date(iso));
}

/** "Monday, Jul 27" — the provider's day heading. */
export function formatLongDay(iso: string, timeZone: string): string {
  return formatter(timeZone, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

/** The YYYY-MM-DD the instant falls on *in that zone*, for grouping and queries. */
export function localDateKey(iso: string | Date, timeZone: string): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  // en-CA formats as YYYY-MM-DD, which sorts lexically and matches the API.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * The device's own IANA zone, used as the default when creating an account.
 * Without it every new user inherits the model default and sees their times in
 * New York regardless of where they actually are.
 */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || CLINIC_TIMEZONE;
  } catch {
    return CLINIC_TIMEZONE;
  }
}

export function shortLabelFor(timeZone: string): string {
  return TIMEZONES.find((zone) => zone.id === timeZone)?.short ?? '';
}

export function labelFor(timeZone: string): string {
  return TIMEZONES.find((zone) => zone.id === timeZone)?.label ?? timeZone;
}

/**
 * The clarification the handoff asks for when the patient is not on clinic
 * time: "9:00 AM ET is 6:00 AM PT at the Seattle clinic".
 *
 * Returns null when the patient is already on clinic time, so callers can just
 * render whatever comes back.
 */
export function clinicNote(iso: string, patientZone: string): string | null {
  if (patientZone === CLINIC_TIMEZONE) return null;
  const theirs = `${formatTime(iso, patientZone)} ${shortLabelFor(patientZone)}`;
  const clinic = `${formatTime(iso, CLINIC_TIMEZONE)} ${shortLabelFor(CLINIC_TIMEZONE)}`;
  return `${theirs} is ${clinic} at the Seattle clinic — the same moment, shown in your timezone.`;
}

/**
 * Calendar-date helpers, working on "YYYY-MM-DD" strings.
 *
 * A week of columns is a run of calendar dates, not a run of instants. Deriving
 * them by converting local-midnight Date objects into a display zone shifts the
 * whole week by a day whenever the device is ahead of that zone -- the columns
 * then key to different days than the slots inside them. Keeping the week as
 * plain strings removes the class of bug entirely.
 */

/** Parsed at midday UTC, far from any midnight or DST edge. */
function keyToDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function todayKeyIn(timeZone: string): string {
  return localDateKey(new Date(), timeZone);
}

/** Monday of the week containing `key`. */
export function startOfWeekKey(key: string): string {
  const date = keyToDate(key);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

export function addDaysToKey(key: string, days: number): string {
  const date = keyToDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Formats a calendar date without letting a timezone shift it. */
export function formatKey(
  key: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(
    keyToDate(key),
  );
}

export const keyWeekdayAbbr = (key: string) =>
  formatKey(key, { weekday: 'short' }).toUpperCase();
export const keyShortDate = (key: string) =>
  formatKey(key, { month: 'short', day: 'numeric' });
export const keyDayNumber = (key: string) => formatKey(key, { day: 'numeric' });
export const keyWeekLabel = (key: string) =>
  `Week of ${formatKey(key, { month: 'short', day: 'numeric' })}`;

/** Monday of the week containing `date`, as a local calendar date. */
export function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  const weekday = (copy.getDay() + 6) % 7; // Monday = 0
  copy.setDate(copy.getDate() - weekday);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/**
 * YYYY-MM-DD for an API date range.
 *
 * Pass the clinic's timezone whenever the range is about a provider's calendar:
 * the slots endpoint interprets these as clinic-local dates, so a device in
 * Tokyo asking about a Seattle clinic would otherwise be a day out. Falls back
 * to the device's calendar when no zone is given.
 */
export function toDateParam(date: Date, timeZone?: string): string {
  if (timeZone) return localDateKey(date, timeZone);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** "Week of Jul 27" */
export function weekLabel(weekStart: Date): string {
  return `Week of ${new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(weekStart)}`;
}

/** Slots split into the handoff's Morning / Afternoon groups, in view zone. */
export function splitByHalfDay<T extends { start_at: string }>(
  slots: T[],
  timeZone: string,
): { morning: T[]; afternoon: T[] } {
  const morning: T[] = [];
  const afternoon: T[] = [];
  for (const slot of slots) {
    const hour = Number(
      formatter(timeZone, { hour: 'numeric', hour12: false }).format(
        new Date(slot.start_at),
      ),
    );
    (hour < 12 ? morning : afternoon).push(slot);
  }
  return { morning, afternoon };
}

/** How far `timeZone` is from UTC at that instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  // Hour comes back as 24 rather than 0 at midnight in some engines.
  const hour = get('hour') % 24;
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return asIfUtc - instant.getTime();
}

/**
 * A wall-clock date and time in `timeZone`, as a UTC instant.
 *
 * The inverse of everything else here: the provider types "2pm on the 14th"
 * meaning 2pm where they are, and the server stores instants. Done in two
 * passes because the offset itself depends on the instant -- guessing with the
 * offset at the wrong side of a DST change would land an hour out. The second
 * pass re-reads the offset at the corrected instant and settles.
 *
 * Times inside a spring-forward gap do not exist; this returns the instant the
 * clock jumps to, which is the sane reading of "block out 2:30am" on a day
 * where 2:30am never happens.
 */
export function zonedTimeToUtc(
  dateKey: string,
  time: string,
  timeZone: string,
): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const naiveAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  let instant = new Date(naiveAsUtc - zoneOffsetMs(new Date(naiveAsUtc), timeZone));
  instant = new Date(naiveAsUtc - zoneOffsetMs(instant, timeZone));
  return instant.toISOString();
}

/** "HH:MM" in 24-hour form, for keying a time-axis grid. */
export function localTimeKey(iso: string, timeZone: string): string {
  return formatter(timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(iso))
    .replace('24:', '00:');
}

/** Minutes since local midnight, for ordering and axis maths. */
export function minutesOfDay(iso: string, timeZone: string): number {
  const [hour, minute] = localTimeKey(iso, timeZone).split(':').map(Number);
  return hour * 60 + minute;
}

/** "13:30" -> "1:30 PM" */
export function prettyTimeKey(key: string): string {
  const [hour, minute] = key.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000,
  );
}
