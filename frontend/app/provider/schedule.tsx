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
import type { Appointment, Slot } from '../../src/api/types';
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
  minutesBetween,
  startOfWeekKey,
  todayKeyIn,
} from '../../src/lib/datetime';
import { color, visitTint, type VisitTintName } from '../../src/theme/tokens';
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
  const [loading, setLoading] = useState(true);
  // A dropped request must not look like an empty calendar.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const zone = user?.timezone ?? 'America/Los_Angeles';

  // Plain calendar dates in the provider's own zone, so the columns cannot
  // drift when the device is set to a different timezone than the clinic.
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
      const [upcoming, past, profile] = await Promise.all([
        api.appointments.list('upcoming'),
        api.appointments.list('past'),
        api.auth.myProviderProfile().catch(() => null),
      ]);
      setAppointments([...past.results, ...upcoming.results]);
      if (profile) {
        setOpenSlots(
          await api.providers.slots(
            profile.id,
            dayKeys[0],
            dayKeys[WORKING_DAYS - 1],
          ),
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
          ) : (
            <View style={styles.grid}>
              {dayKeys.map((key) => {
                const visits = visitsByDay.get(key) ?? [];
                const open = openByDay.get(key) ?? [];
                return (
                  <View key={key} style={styles.gridColumn}>
                    <View style={styles.gridHead}>
                      <Label>{keyWeekdayAbbr(key)}</Label>
                      <Strong size={15}>{keyShortDate(key)}</Strong>
                    </View>
                    <View style={styles.gridCells}>
                      {visits.length === 0 && open.length === 0 ? (
                        <View style={styles.blockedCell}>
                          <Muted size={11.5}>Not working</Muted>
                        </View>
                      ) : (
                        <>
                          {visits.map((visit) => {
                            const name =
                              visit.patient.full_name || visit.patient.email;
                            const palette = visitTint[tintForVisit(name)];
                            return (
                              <View
                                key={visit.id}
                                style={[
                                  styles.visitBlock,
                                  {
                                    backgroundColor: palette.bg,
                                    borderColor: palette.border,
                                  },
                                ]}
                              >
                                <Semi size={11.5} style={{ color: palette.fg }}>
                                  {formatTime(visit.start_at, zone)}
                                </Semi>
                                <Semi size={13} style={{ color: palette.fg }}>
                                  {name}
                                </Semi>
                                <Body size={11.5} style={{ color: palette.sub }}>
                                  {visit.reason || 'Visit'}
                                </Body>
                              </View>
                            );
                          })}
                          {open.slice(0, 4).map((slot) => (
                            <View key={slot.start_at} style={styles.openCell}>
                              <Muted size={11.5}>{formatTime(slot.start_at, zone)}</Muted>
                            </View>
                          ))}
                        </>
                      )}
                    </View>
                  </View>
                );
              })}
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
  grid: { flexDirection: 'row', gap: 8, marginTop: 24 },
  gridColumn: { flex: 1 },
  gridHead: { alignItems: 'center', gap: 2, marginBottom: 10 },
  gridCells: { gap: 6 },
  visitBlock: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 1 },
  openCell: {
    backgroundColor: color.gridWorking,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  blockedCell: {
    backgroundColor: color.gridBlocked,
    borderRadius: 8,
    paddingVertical: 20,
    alignItems: 'center',
  },
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
