import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { api } from '../../src/api/endpoints';
import type { Appointment, ProviderProfile, Slot } from '../../src/api/types';
import { Avatar, initialsFor, Note, tintFor } from '../../src/components/Bits';
import { BottomTabs, PROVIDER_NAV, TopNav } from '../../src/components/Nav';
import { AppCard, Card } from '../../src/components/Surface';
import {
  Body,
  Display,
  Label,
  Muted,
  Semi,
  Strong,
} from '../../src/components/Typography';
import { useAuth } from '../../src/lib/auth';
import {
  addDaysToKey,
  formatTime,
  keyDayNumber,
  keyShortDate,
  keyWeekdayAbbr,
  keyWeekLabel,
  localDateKey,
  localTimeKey,
  minutesBetween,
  minutesOfDay,
  prettyTimeKey,
  startOfWeekKey,
  todayKeyIn,
} from '../../src/lib/datetime';
import {
  CLINIC_TIMEZONE,
  color,
  layout,
  visitTint,
  type VisitTintName,
} from '../../src/theme/tokens';
import { useResponsive } from '../../src/theme/useResponsive';

const WORKING_DAYS = 5;
const TINTS: VisitTintName[] = ['teal', 'coral', 'violet'];

/** Same patient, same colour block, across the whole grid. */
function tintForVisit(seed: string): VisitTintName {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length];
}

export default function ProviderScheduleScreen() {
  const { user } = useAuth();
  const { isDesktop } = useResponsive();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [openSlots, setOpenSlots] = useState<Slot[]>([]);
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // A dropped request must not look like an empty calendar.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  // Clinic time, matching the availability screen. A provider's day is the
  // clinic's day, so drawing this grid in anything else would put their hours
  // at times they never entered.
  const zone = profile?.timezone ?? CLINIC_TIMEZONE;

  // Plain calendar dates in the clinic's zone, so the columns cannot drift when
  // the device is set to a different timezone.
  const weekStartKey = useMemo(
    () => addDaysToKey(startOfWeekKey(todayKeyIn(zone)), weekOffset * 7),
    [zone, weekOffset],
  );
  const dayKeys = useMemo(
    () =>
      Array.from({ length: WORKING_DAYS }, (_, i) => addDaysToKey(weekStartKey, i)),
    [weekStartKey],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [upcoming, past, me] = await Promise.all([
        api.appointments.list('upcoming'),
        api.appointments.list('past'),
        api.auth.myProviderProfile().catch(() => null),
      ]);
      setAppointments([...past.results, ...upcoming.results]);
      setProfile(me);
      if (me) {
        setOpenSlots(
          await api.providers.slots(me.id, dayKeys[0], dayKeys[WORKING_DAYS - 1]),
        );
      }
      setLoadError(null);
    } catch {
      setAppointments([]);
      setOpenSlots([]);
      setLoadError('Could not load your schedule. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [dayKeys]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const visitsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const visit of appointments) {
      if (visit.status === 'cancelled') continue;
      const key = localDateKey(visit.start_at, zone);
      const list = map.get(key);
      if (list) list.push(visit);
      else map.set(key, [visit]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    }
    return map;
  }, [appointments, zone]);

  const openByDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of openSlots) {
      const key = localDateKey(slot.start_at, zone);
      const list = map.get(key);
      if (list) list.push(slot);
      else map.set(key, [slot]);
    }
    return map;
  }, [openSlots, zone]);

  const activeDayKey = selectedDayKey ?? dayKeys[0];

  /**
   * The desktop grid is a time axis, not a list.
   *
   * It previously rendered the first four open slots per column and dropped the
   * rest, so a full working day looked like it ended at 10:30. Rows now run
   * from the earliest to the latest thing happening that week, at the
   * provider's own slot length, and every cell is accounted for: a visit, an
   * open slot, or not-working.
   */
  const rowStep = profile?.slot_duration_minutes ?? 30;

  const rowTimes = useMemo(() => {
    const minutes: number[] = [];
    for (const visit of appointments) {
      if (visit.status === 'cancelled') continue;
      minutes.push(minutesOfDay(visit.start_at, zone));
      minutes.push(minutesOfDay(visit.end_at, zone) || 24 * 60);
    }
    for (const slot of openSlots) {
      minutes.push(minutesOfDay(slot.start_at, zone));
      minutes.push(minutesOfDay(slot.end_at, zone) || 24 * 60);
    }
    if (minutes.length === 0) return [];

    // Snap outward to whole rows so nothing is clipped at either end.
    const start = Math.floor(Math.min(...minutes) / rowStep) * rowStep;
    const end = Math.ceil(Math.max(...minutes) / rowStep) * rowStep;

    const rows: string[] = [];
    for (let minute = start; minute < end; minute += rowStep) {
      rows.push(
        `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(
          minute % 60,
        ).padStart(2, '0')}`,
      );
    }
    return rows;
  }, [appointments, openSlots, zone, rowStep]);

  /** cell lookup: `${dayKey} ${HH:MM}` -> what occupies that slot of time. */
  const cells = useMemo(() => {
    const map = new Map<
      string,
      { kind: 'open' } | { kind: 'visit'; visit: Appointment; first: boolean }
    >();

    for (const slot of openSlots) {
      const key = `${localDateKey(slot.start_at, zone)} ${localTimeKey(slot.start_at, zone)}`;
      map.set(key, { kind: 'open' });
    }

    // A visit longer than one row occupies every row it covers, so the grid
    // does not show "not working" in the middle of an appointment.
    for (const visit of appointments) {
      if (visit.status === 'cancelled') continue;
      const dayKey = localDateKey(visit.start_at, zone);
      const from = minutesOfDay(visit.start_at, zone);
      const to = minutesOfDay(visit.end_at, zone) || 24 * 60;
      for (let minute = from; minute < to; minute += rowStep) {
        const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(
          minute % 60,
        ).padStart(2, '0')}`;
        map.set(`${dayKey} ${time}`, {
          kind: 'visit',
          visit,
          first: minute === from,
        });
      }
    }
    return map;
  }, [appointments, openSlots, zone, rowStep]);

  const errorBanner = loadError ? (
    <Note
      tone="error"
      icon="⚠"
      style={styles.errorBanner}
      action={
        <Pressable onPress={load} accessibilityRole="button" hitSlop={8}>
          <Semi size={13.5} style={{ color: color.errorText }}>
            Retry
          </Semi>
        </Pressable>
      }
    >
      {loadError}
    </Note>
  ) : null;

  const weekBar = (
    <View style={styles.weekBar}>
      <Pressable
        onPress={() => setWeekOffset((w) => w - 1)}
        accessibilityRole="button"
        accessibilityLabel="Previous week"
        style={styles.weekArrow}
      >
        <Body size={16}>‹</Body>
      </Pressable>
      <Semi size={14} style={styles.weekLabel}>
        {keyWeekLabel(weekStartKey)}
      </Semi>
      <Pressable
        onPress={() => setWeekOffset((w) => w + 1)}
        accessibilityRole="button"
        accessibilityLabel="Next week"
        style={styles.weekArrow}
      >
        <Body size={16}>›</Body>
      </Pressable>
    </View>
  );

  // ------------------------------------------------------------- D8 desktop
  if (isDesktop) {
    return (
      <AppCard>
        <TopNav items={PROVIDER_NAV} name={user?.full_name ?? 'You'} role="Provider" />
        <View style={styles.desktopBody}>
          {errorBanner}
          <View style={styles.headRow}>
            <Display size={32}>Schedule</Display>
            {weekBar}
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={color.primary} />
            </View>
          ) : rowTimes.length === 0 ? (
            <Card dashed style={styles.emptyWeek}>
              <Muted size={14}>Nothing scheduled or open this week.</Muted>
            </Card>
          ) : (
            <View style={styles.grid}>
              {/* Header row: the gutter is empty, then one cell per day. */}
              <View style={styles.gridRow}>
                <View style={styles.gutterCell} />
                {dayKeys.map((dayKey) => (
                  <View key={dayKey} style={styles.headCell}>
                    <Label>{keyWeekdayAbbr(dayKey)}</Label>
                    <Strong size={15}>{keyShortDate(dayKey)}</Strong>
                  </View>
                ))}
              </View>

              {rowTimes.map((time) => (
                <View key={time} style={styles.gridRow}>
                  <View style={styles.gutterCell}>
                    <Muted size={11}>{prettyTimeKey(time)}</Muted>
                  </View>

                  {dayKeys.map((dayKey) => {
                    const cell = cells.get(`${dayKey} ${time}`);

                    if (!cell) {
                      return <View key={dayKey} style={styles.blockedCell} />;
                    }

                    if (cell.kind === 'open') {
                      return <View key={dayKey} style={styles.openCell} />;
                    }

                    const name =
                      cell.visit.patient.full_name || cell.visit.patient.email;
                    const palette = visitTint[tintForVisit(name)];
                    return (
                      <View
                        key={dayKey}
                        style={[
                          styles.visitCell,
                          {
                            backgroundColor: palette.bg,
                            borderColor: palette.border,
                            // Only the first row of a visit draws the top edge,
                            // so a long appointment reads as one block.
                            borderTopWidth: cell.first ? 1 : 0,
                          },
                        ]}
                      >
                        {cell.first ? (
                          <Semi size={11} numberOfLines={1} style={{ color: palette.fg }}>
                            {name}
                          </Semi>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          )}

          <View style={styles.legend}>
            <LegendSwatch color={visitTint.teal.bg} border={visitTint.teal.border} label="Booked visit" />
            <LegendSwatch color={color.gridWorking} border={color.borderSoft} label="Open slot" />
            <LegendSwatch color={color.gridBlocked} border={color.borderSoft} label="Not working" />
          </View>
        </View>
      </AppCard>
    );
  }

  // -------------------------------------------------------------- M8 mobile
  const dayVisits = visitsByDay.get(activeDayKey) ?? [];
  const dayOpen = openByDay.get(activeDayKey) ?? [];
  const timeline = [
    ...dayVisits.map((visit) => ({ kind: 'visit' as const, at: visit.start_at, visit })),
    ...dayOpen.map((slot) => ({ kind: 'open' as const, at: slot.start_at })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <AppCard scroll={false}>
      <View style={styles.mobileHeader}>
        <Avatar
          initials={initialsFor(user?.full_name ?? 'You')}
          size={38}
          tint={tintFor(user?.full_name ?? 'You')}
        />
      </View>
      <ScrollView contentContainerStyle={styles.mobileBody}>
        {errorBanner}
        <Display size={24}>Schedule</Display>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.dayPills}>
            {dayKeys.map((key) => {
              const active = key === activeDayKey;
              const count = (visitsByDay.get(key) ?? []).length;
              return (
                <Pressable
                  key={key}
                  onPress={() => setSelectedDayKey(key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.dayPill,
                    active && styles.dayPillActive,
                    count === 0 && !active && styles.dayPillEmpty,
                  ]}
                >
                  <Body size={10.5} style={{ color: active ? color.white : color.inkFaint }}>
                    {keyWeekdayAbbr(key)}
                  </Body>
                  <Strong size={15} style={{ color: active ? color.white : color.ink }}>
                    {keyDayNumber(key)}
                  </Strong>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <Muted size={12.5} style={styles.daySummary}>
          {dayVisits.length} visit{dayVisits.length === 1 ? '' : 's'} · {dayOpen.length}{' '}
          open
        </Muted>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={color.primary} />
          </View>
        ) : timeline.length === 0 ? (
          <Card dashed style={styles.emptyDay}>
            <Muted size={14}>Nothing scheduled.</Muted>
          </Card>
        ) : (
          <View style={styles.timeline}>
            {timeline.map((entry) => {
              if (entry.kind === 'open') {
                return (
                  <View key={`open-${entry.at}`} style={styles.timelineRow}>
                    <Muted size={11.5} style={styles.gutter}>
                      {formatTime(entry.at, zone)}
                    </Muted>
                    <View style={styles.openBlock}>
                      <Muted size={12.5} style={styles.italic}>
                        Open slot
                      </Muted>
                    </View>
                  </View>
                );
              }
              const name = entry.visit.patient.full_name || entry.visit.patient.email;
              const palette = visitTint[tintForVisit(name)];
              return (
                <View key={entry.visit.id} style={styles.timelineRow}>
                  <Muted size={11.5} style={styles.gutter}>
                    {formatTime(entry.at, zone)}
                  </Muted>
                  <View
                    style={[
                      styles.timelineBlock,
                      { backgroundColor: palette.bg, borderColor: palette.border },
                    ]}
                  >
                    <Semi size={13.5} style={{ color: palette.fg }}>
                      {name}
                    </Semi>
                    <Body size={11.5} style={{ color: palette.sub }}>
                      {entry.visit.reason || 'Visit'} ·{' '}
                      {minutesBetween(entry.visit.start_at, entry.visit.end_at)} min
                    </Body>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      <BottomTabs items={PROVIDER_NAV} />
    </AppCard>
  );
}

function LegendSwatch({
  color: swatch,
  border,
  label,
}: {
  color: string;
  border: string;
  label: string;
}) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[styles.legendSwatch, { backgroundColor: swatch, borderColor: border }]}
      />
      <Muted size={12.5}>{label}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  desktopBody: { paddingHorizontal: 40, paddingVertical: 34 },
  errorBanner: { marginBottom: 16 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekBar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  weekArrow: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.borderField,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekLabel: { minWidth: 130, textAlign: 'center' },
  loading: { paddingVertical: 60, alignItems: 'center' },
  grid: { marginTop: 24 },
  // The time label and that time's five day cells are siblings in one row, so
  // they line up structurally. No height has to be kept in sync to match them.
  gridRow: { flexDirection: 'row', gap: 2, minHeight: layout.scheduleRow },
  gutterCell: {
    width: layout.scheduleGutter,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 8,
  },
  headCell: { flex: 1, alignItems: 'center', gap: 2, paddingBottom: 8 },
  visitCell: {
    flex: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 8,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  openCell: {
    flex: 1,
    backgroundColor: color.gridWorking,
    borderBottomWidth: 1,
    borderColor: color.card,
  },
  blockedCell: {
    flex: 1,
    backgroundColor: color.gridBlocked,
    borderBottomWidth: 1,
    borderColor: color.card,
  },
  emptyWeek: { marginTop: 24, alignItems: 'center', paddingVertical: 40 },
  legend: { flexDirection: 'row', gap: 20, marginTop: 22 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendSwatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1 },
  mobileHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  mobileBody: { paddingHorizontal: 20, paddingBottom: 24 },
  dayPills: { flexDirection: 'row', gap: 6, paddingVertical: 14 },
  dayPill: {
    width: 52,
    paddingVertical: 8,
    borderRadius: 11,
    alignItems: 'center',
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.borderField,
  },
  dayPillActive: { backgroundColor: color.ctaBottom, borderColor: color.ctaBottom },
  dayPillEmpty: { opacity: 0.5 },
  daySummary: { marginBottom: 12 },
  timeline: { gap: 8 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  gutter: { width: 48, textAlign: 'right', paddingTop: 14 },
  timelineBlock: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 12 },
  openBlock: {
    flex: 1,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.borderDashed,
    borderRadius: 12,
    padding: 12,
  },
  italic: { fontStyle: 'italic' },
  emptyDay: { alignItems: 'center', paddingVertical: 28 },
});
