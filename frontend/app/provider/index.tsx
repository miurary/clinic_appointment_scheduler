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
import {
  Avatar,
  initialsFor,
  Note,
  StatusPill,
  tintFor,
} from '../../src/components/Bits';
import { BottomTabs, PROVIDER_NAV, TopNav } from '../../src/components/Nav';
import { AppCard, Card, RowGroup } from '../../src/components/Surface';
import {
  Display,
  Label,
  Muted,
  Semi,
  Strong,
} from '../../src/components/Typography';
import { useAuth } from '../../src/lib/auth';
import {
  formatLongDay,
  formatTime,
  localDateKey,
  minutesBetween,
  toDateParam,
} from '../../src/lib/datetime';
import { color } from '../../src/theme/tokens';
import { useResponsive } from '../../src/theme/useResponsive';

/** A booked visit or an unfilled slot, merged into one ordered day list. */
type DayEntry =
  | { kind: 'visit'; at: string; appointment: Appointment }
  | { kind: 'open'; at: string };

export default function ProviderTodayScreen() {
  const { user } = useAuth();
  const { isDesktop } = useResponsive();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [openSlots, setOpenSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  // A dropped request must not look like an empty calendar.
  const [loadError, setLoadError] = useState<string | null>(null);

  const zone = user?.timezone ?? 'America/Los_Angeles';
  const todayKey = localDateKey(new Date(), zone);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Both scopes, because "today" straddles now: visits earlier today are
      // past, the rest are upcoming. Each list is ordered outward from now, so
      // today's visits sit at the head of one or the other.
      const [upcoming, past, profile] = await Promise.all([
        api.appointments.list('upcoming'),
        api.appointments.list('past'),
        api.auth.myProviderProfile().catch(() => null),
      ]);

      setAppointments([...past.results, ...upcoming.results]);

      if (profile) {
        const today = toDateParam(new Date(), zone);
        setOpenSlots(await api.providers.slots(profile.id, today, today));
      }
      setLoadError(null);
    } catch {
      setAppointments([]);
      setOpenSlots([]);
      setLoadError('Could not load your schedule. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const todaysVisits = useMemo(
    () =>
      appointments
        .filter(
          (visit) =>
            localDateKey(visit.start_at, zone) === todayKey &&
            visit.status !== 'cancelled',
        )
        .sort((a, b) => a.start_at.localeCompare(b.start_at)),
    [appointments, zone, todayKey],
  );

  const todaysOpen = useMemo(
    () => openSlots.filter((slot) => localDateKey(slot.start_at, zone) === todayKey),
    [openSlots, zone, todayKey],
  );

  /** Visits and open slots interleaved in clock order, as the mock shows them. */
  const dayEntries = useMemo<DayEntry[]>(() => {
    const entries: DayEntry[] = [
      ...todaysVisits.map((appointment) => ({
        kind: 'visit' as const,
        at: appointment.start_at,
        appointment,
      })),
      ...todaysOpen.map((slot) => ({ kind: 'open' as const, at: slot.start_at })),
    ];
    return entries.sort((a, b) => a.at.localeCompare(b.at));
  }, [todaysVisits, todaysOpen]);

  const now = Date.now();
  const nextVisit = todaysVisits.find(
    (visit) => new Date(visit.start_at).getTime() >= now,
  );
  const distinctPatients = new Set(todaysVisits.map((visit) => visit.patient.id)).size;

  const stats = [
    { value: String(todaysVisits.length), label: isDesktop ? 'Appointments' : 'Visits' },
    { value: String(distinctPatients), label: 'Patients' },
    { value: String(todaysOpen.length), label: isDesktop ? 'Open slots' : 'Open' },
  ];

  const schedule = loading ? (
    <View style={styles.loading}>
      <ActivityIndicator color={color.primary} />
    </View>
  ) : dayEntries.length === 0 ? (
    <Card dashed style={styles.empty}>
      <Muted size={14}>Nothing scheduled today.</Muted>
    </Card>
  ) : (
    <RowGroup>
      {dayEntries.map((entry) => {
        if (entry.kind === 'open') {
          return (
            <View key={`open-${entry.at}`} style={styles.openRow}>
              <Semi size={12.5} style={styles.timeCol}>
                {formatTime(entry.at, zone)}
              </Semi>
              <Muted size={12.5} style={styles.openLabel}>
                Open slot
              </Muted>
            </View>
          );
        }

        const visit = entry.appointment;
        const isNext = nextVisit?.id === visit.id;
        const name = visit.patient.full_name || visit.patient.email;

        return (
          <View key={visit.id} style={[styles.visitRow, isNext && styles.visitRowNext]}>
            <Strong size={13} style={styles.timeCol}>
              {formatTime(visit.start_at, zone)}
            </Strong>
            <Avatar initials={initialsFor(name)} size={32} tint={tintFor(name)} />
            <View style={styles.flexShrink}>
              <Semi size={13.5}>{name}</Semi>
              <Muted size={11.5}>
                {visit.reason || 'Visit'} ·{' '}
                {minutesBetween(visit.start_at, visit.end_at)} min
              </Muted>
            </View>
            <StatusPill
              size={10.5}
              label={isNext ? 'Next' : visit.status === 'completed' ? 'Done' : 'Scheduled'}
              tone={isNext ? 'amber' : visit.status === 'completed' ? 'success' : 'neutral'}
            />
          </View>
        );
      })}
    </RowGroup>
  );

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

  const heading = (
    <>
      <Display size={isDesktop ? 32 : 26}>
        {formatLongDay(new Date().toISOString(), zone)}
      </Display>
      <Muted size={isDesktop ? 15 : 13.5} style={styles.subtitle}>
        {loading
          ? 'Loading your day…'
          : `${todaysVisits.length} visit${todaysVisits.length === 1 ? '' : 's'} today`}
      </Muted>
    </>
  );

  const statRow = (
    <View style={styles.statRow}>
      {stats.map((stat) => (
        <Card key={stat.label} style={styles.statCard}>
          <Display size={isDesktop ? 30 : 22}>{stat.value}</Display>
          <Muted size={isDesktop ? 13 : 11}>{stat.label}</Muted>
        </Card>
      ))}
      {isDesktop ? (
        <Card style={[styles.statCard, styles.nextCard]}>
          <Label style={{ color: color.chipText }}>Next up</Label>
          <Display size={22} style={styles.nextTime}>
            {nextVisit ? formatTime(nextVisit.start_at, zone) : '—'}
          </Display>
          <Muted size={12.5}>
            {nextVisit
              ? nextVisit.patient.full_name || nextVisit.patient.email
              : 'Nothing left today'}
          </Muted>
        </Card>
      ) : null}
    </View>
  );

  if (isDesktop) {
    return (
      <AppCard>
        <TopNav items={PROVIDER_NAV} name={user?.full_name ?? 'You'} role="Provider" />
        <View style={styles.desktopBody}>
          {errorBanner}
          {errorBanner}
        {heading}
          {statRow}
          <Label style={styles.sectionLabel}>Today&apos;s schedule</Label>
          {schedule}
        </View>
      </AppCard>
    );
  }

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
        {heading}
        {statRow}
        <Label style={styles.sectionLabel}>Schedule</Label>
        {schedule}
      </ScrollView>
      <BottomTabs items={PROVIDER_NAV} />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  flexShrink: { flexShrink: 1 },
  desktopBody: { paddingHorizontal: 40, paddingVertical: 34 },
  mobileHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  mobileBody: { paddingHorizontal: 20, paddingBottom: 24 },
  errorBanner: { marginTop: 16 },
  subtitle: { marginTop: 2 },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  statCard: { flex: 1, padding: 14, gap: 2 },
  nextCard: { backgroundColor: color.tintBg, borderColor: color.tintBorder },
  nextTime: { marginTop: 2 },
  sectionLabel: { marginTop: 24, marginBottom: 10 },
  loading: { paddingVertical: 40, alignItems: 'center' },
  empty: { alignItems: 'center', paddingVertical: 28 },
  timeCol: { width: 56 },
  visitRow: {
    backgroundColor: color.card,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  visitRowNext: {
    backgroundColor: color.rowHighlight,
    borderLeftWidth: 3,
    borderLeftColor: color.primary,
  },
  openRow: {
    backgroundColor: color.gridWorking,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  openLabel: { fontStyle: 'italic' },
});
