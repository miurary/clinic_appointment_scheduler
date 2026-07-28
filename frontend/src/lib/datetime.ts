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

/** YYYY-MM-DD in the *device's* calendar, for building API date ranges. */
export function toDateParam(date: Date): string {
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

export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000,
  );
}
