import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { Appointment } from '../api/types';

/**
 * "Add to calendar", for real.
 *
 * Builds an RFC 5545 VEVENT and hands it to the platform: a file download on
 * web, a share sheet on native. This previously raised a toast and did nothing,
 * which is worse than not offering it at all -- a patient would believe the
 * visit was in their calendar when it was not.
 */

/** Timestamps in an .ics are UTC, formatted as YYYYMMDDTHHMMSSZ. */
function icsStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Commas, semicolons and backslashes are separators in ics text values. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 caps a content line at 75 octets, continued with CRLF + a space.
 * Some calendar clients genuinely reject longer lines.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join('\r\n');
}

export function buildIcs(appointment: Appointment, location = 'Ballard clinic'): string {
  const summary = `${appointment.reason || 'Visit'} — ${appointment.provider.full_name}`;
  const description = [appointment.provider.full_name, appointment.provider.specialty]
    .filter(Boolean)
    .join(' · ');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kivo Health//Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Stable per appointment, so re-importing updates the event rather than
    // creating a duplicate.
    `UID:appointment-${appointment.id}@kivo.health`,
    `DTSTAMP:${icsStamp(appointment.created_at || appointment.start_at)}`,
    `DTSTART:${icsStamp(appointment.start_at)}`,
    `DTEND:${icsStamp(appointment.end_at)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(location)}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT60M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Appointment in 1 hour',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldLine).join('\r\n');
}

function fileName(appointment: Appointment): string {
  return `kivo-visit-${appointment.id}.ics`;
}

/**
 * Returns the message to show the user rather than assuming success, so a
 * failed export says so instead of claiming the visit was saved.
 */
export async function addToCalendar(appointment: Appointment): Promise<string> {
  const ics = buildIcs(appointment);

  if (Platform.OS === 'web') {
    try {
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName(appointment);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Revoking immediately cancels the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return 'Calendar file downloaded';
    } catch {
      return 'Could not create the calendar file';
    }
  }

  try {
    // SDK 54 replaced writeAsStringAsync with the File/Paths classes.
    const file = new File(Paths.cache, fileName(appointment));
    if (file.exists) file.delete();
    file.create();
    file.write(ics);

    if (!(await Sharing.isAvailableAsync())) {
      return 'Sharing is not available on this device';
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/calendar',
      UTI: 'com.apple.ical.ics',
      dialogTitle: 'Add to calendar',
    });
    return 'Opened in your calendar app';
  } catch {
    return 'Could not create the calendar file';
  }
}
