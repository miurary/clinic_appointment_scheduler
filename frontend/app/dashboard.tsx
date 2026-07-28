import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ApiError } from '../src/api/client';
import { api } from '../src/api/endpoints';
import type { Appointment } from '../src/api/types';
import {
  Avatar,
  initialsFor,
  Note,
  StatusPill,
  tintFor,
} from '../src/components/Bits';
import { GhostButton, PrimaryButton } from '../src/components/Button';
import { BottomTabs, PATIENT_NAV, TopNav } from '../src/components/Nav';
import { AppCard, Card, RowGroup } from '../src/components/Surface';
import { useToast } from '../src/components/Toast';
import {
  Body,
  Display,
  Label,
  Muted,
  Semi,
  Strong,
} from '../src/components/Typography';
import { useAuth } from '../src/lib/auth';
import { useBooking } from '../src/lib/booking';
import { addToCalendar } from '../src/lib/calendar';
import {
  formatDayNumber,
  formatMonthAbbr,
  formatShortDate,
  formatTime,
  formatWeekdayShort,
  minutesBetween,
  shortLabelFor,
} from '../src/lib/datetime';
import { color } from '../src/theme/tokens';
import { useResponsive } from '../src/theme/useResponsive';

export default function DashboardScreen() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { isDesktop } = useResponsive();
  const booking = useBooking();

  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [past, setPast] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  // Without this a failed fetch renders as "no upcoming visits", which is
  // a very different thing to tell a patient than "we could not check".
  const [loadError, setLoadError] = useState<string | null>(null);

  const zone = user?.timezone ?? booking.timezone;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The server does the upcoming/past split, so a patient with more than a
      // page of history still sees the right thing.
      const [next, history] = await Promise.all([
        api.appointments.list('upcoming'),
        api.appointments.list('past'),
      ]);
      setUpcoming(next.results);
      setPast(history.results);
      setLoadError(null);
    } catch {
      setUpcoming([]);
      setPast([]);
      setLoadError('Could not load your visits. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch on focus: arriving here after booking or cancelling should show
  // the change, not a stale list from the last visit.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const next = upcoming[0] ?? null;
  // Everything after the soonest. Previously these were fetched and silently
  // dropped, so a patient with two bookings saw one and no sign of the other.
  const laterVisits = upcoming.slice(1);

  const onReschedule = (appointment: Appointment) => {
    booking.startReschedule(appointment);
    router.push('/book');
  };

  const onCancel = async (appointment: Appointment) => {
    try {
      await api.appointments.cancel(appointment.id);
      toast.show('Appointment canceled');
      load();
    } catch (caught) {
      toast.show(
        caught instanceof ApiError ? caught.detail : 'Could not cancel that visit',
      );
    }
  };

  const greeting = `Hi, ${user?.first_name || user?.full_name || 'there'}`;
  const subtitle = loading
    ? 'Loading your visits…'
    : next
      ? 'One upcoming visit.'
      : 'No upcoming visits.';

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

  const upcomingBlock = loading ? (
    <View style={styles.loading}>
      <ActivityIndicator color={color.primary} />
    </View>
  ) : next ? (
    <Card accent style={styles.upcoming}>
      <View style={styles.upcomingHead}>
        <View style={styles.upcomingLeft}>
          <View style={styles.dateChip}>
            <Semi size={12} style={{ color: color.inkSubtle }}>
              {formatMonthAbbr(next.start_at, zone)}
            </Semi>
            <Display size={isDesktop ? 28 : 26} style={styles.dateNumber}>
              {formatDayNumber(next.start_at, zone)}
            </Display>
            <Body size={11} style={{ color: color.inkSubtle }}>
              {formatWeekdayShort(next.start_at, zone)}
            </Body>
          </View>
          <View style={styles.flexShrink}>
            <Strong size={isDesktop ? 18 : 16}>{next.reason || 'Visit'}</Strong>
            <Muted size={isDesktop ? 14 : 13} style={styles.upcomingProvider}>
              {next.provider.full_name}
              {isDesktop && next.provider.specialty
                ? ` · ${next.provider.specialty}`
                : ''}
            </Muted>
            <View style={styles.upcomingMeta}>
              <Body size={13.5} style={{ color: color.inkStrong }}>
                🕓 {formatTime(next.start_at, zone)} {shortLabelFor(zone)} ·{' '}
                {minutesBetween(next.start_at, next.end_at)} min
              </Body>
              {isDesktop && next.provider.location ? (
                <Body size={13.5} style={{ color: color.inkStrong }}>
                  📍 {next.provider.location}
                </Body>
              ) : null}
            </View>
          </View>
        </View>
        <StatusPill label="Confirmed" tone="success" />
      </View>
      <View style={styles.upcomingActions}>
        <GhostButton
          label="Add to calendar"
          size="sm"
          onPress={async () => toast.show(await addToCalendar(next))}
        />
        <GhostButton label="Reschedule" size="sm" onPress={() => onReschedule(next)} />
        <GhostButton
          label="Cancel"
          size="sm"
          danger
          onPress={() => onCancel(next)}
        />
      </View>
    </Card>
  ) : (
    <Card dashed style={styles.emptyUpcoming}>
      <Muted size={15}>No upcoming visits.</Muted>
      <PrimaryButton
        label="Book a visit"
        onPress={() => {
          booking.reset();
          router.push('/book');
        }}
        style={styles.emptyCta}
      />
    </Card>
  );

  const laterBlock =
    laterVisits.length === 0 ? null : (
      <>
        <Label style={styles.sectionLabelSpaced}>
          Also booked ({laterVisits.length})
        </Label>
        <RowGroup>
          {laterVisits.map((visit) => (
            <View key={visit.id} style={styles.pastRow}>
              <View style={styles.flexShrink}>
                <Semi size={14.5}>{visit.reason || 'Visit'}</Semi>
                <Muted size={13}>
                  {visit.provider.full_name} ·{' '}
                  {formatShortDate(visit.start_at, zone)} ·{' '}
                  {formatTime(visit.start_at, zone)} {shortLabelFor(zone)}
                </Muted>
              </View>
              <GhostButton
                label="Cancel"
                size="sm"
                danger
                onPress={() => onCancel(visit)}
              />
            </View>
          ))}
        </RowGroup>
      </>
    );

  const pastBlock =
    past.length === 0 ? (
      <Card dashed style={styles.emptyPast}>
        <Muted size={14}>Nothing in your history yet.</Muted>
      </Card>
    ) : (
      <RowGroup>
        {past.map((visit) => (
          <View key={visit.id} style={styles.pastRow}>
            <View style={styles.flexShrink}>
              <Semi size={14.5}>{visit.reason || 'Visit'}</Semi>
              <Muted size={13}>
                {visit.provider.full_name} · {formatShortDate(visit.start_at, zone)}
              </Muted>
            </View>
            {/* The mock has a "Visit summary" link here. There is no visit
                summary in this build and no endpoint behind one, so it is
                omitted rather than rendered as a link that goes nowhere. */}
            {isDesktop ? (
              <StatusPill
                label={visit.status === 'completed' ? 'Completed' : 'Past'}
                tone={visit.status === 'completed' ? 'success' : 'neutral'}
                size={11.5}
              />
            ) : null}
          </View>
        ))}
      </RowGroup>
    );

  // ------------------------------------------------------------- D5 desktop
  if (isDesktop) {
    return (
      <AppCard>
        <TopNav items={PATIENT_NAV} name={user?.full_name ?? 'You'} />
        <View style={styles.desktopBody}>
          <Display size={32}>{greeting}</Display>
          <Muted size={15} style={styles.subtitle}>
            {subtitle}
          </Muted>

          {errorBanner}

          <View style={styles.twoColumn}>
            <View style={styles.mainColumn}>
              <Label style={styles.sectionLabel}>Upcoming</Label>
              {upcomingBlock}
              {laterBlock}
              <Label style={styles.sectionLabelSpaced}>Past visits</Label>
              {pastBlock}
            </View>

            <View style={styles.rail}>
              <Card style={styles.railCard}>
                <View style={styles.profileRow}>
                  <Avatar
                    initials={initialsFor(user?.full_name ?? 'You')}
                    size={48}
                    tint={tintFor(user?.full_name ?? 'You')}
                  />
                  <View style={styles.flexShrink}>
                    <Strong size={15}>{user?.full_name}</Strong>
                    <Muted size={13}>Patient</Muted>
                  </View>
                </View>
                <View style={styles.profileMeta}>
                  <View style={styles.metaRow}>
                    <Muted size={13}>Timezone</Muted>
                    <Semi size={13}>{shortLabelFor(zone) || zone}</Semi>
                  </View>
                  {/* Derived from the upcoming visit rather than asserted:
                      there is no care-team model, and inventing one would put
                      a specialty on the screen that nothing backs. */}
                  {next?.provider.specialty ? (
                    <View style={styles.metaRow}>
                      <Muted size={13}>Care team</Muted>
                      <Semi size={13}>{next.provider.specialty}</Semi>
                    </View>
                  ) : null}
                </View>
              </Card>

              <Card style={styles.promo}>
                <Strong size={15}>Need to be seen sooner?</Strong>
                <Body size={13.5} style={styles.promoBody}>
                  Openings often come up within the week for respiratory concerns.
                </Body>
                <PrimaryButton
                  block
                  size="sm"
                  label="Book a new visit"
                  onPress={() => {
                    booking.reset();
                    router.push('/book');
                  }}
                />
              </Card>
            </View>
          </View>
        </View>
      </AppCard>
    );
  }

  // -------------------------------------------------------------- M5 mobile
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
        <Display size={28}>{greeting}</Display>
        <Muted size={13.5} style={styles.subtitle}>
          {subtitle}
        </Muted>

        {errorBanner}

        <Label style={styles.sectionLabel}>Upcoming</Label>
        {upcomingBlock}
        {laterBlock}

        <Label style={styles.sectionLabelSpaced}>Past visits</Label>
        {pastBlock}
      </ScrollView>
      <BottomTabs items={PATIENT_NAV} />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  flexShrink: { flexShrink: 1 },
  desktopBody: { paddingHorizontal: 40, paddingVertical: 34 },
  subtitle: { marginTop: 4 },
  twoColumn: { flexDirection: 'row', gap: 28, marginTop: 28 },
  mainColumn: { flex: 1 },
  rail: { width: 320, gap: 20 },
  errorBanner: { marginTop: 18 },
  sectionLabel: { marginBottom: 12 },
  sectionLabelSpaced: { marginTop: 28, marginBottom: 12 },
  loading: { paddingVertical: 40, alignItems: 'center' },
  upcoming: { padding: 24 },
  upcomingHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  upcomingLeft: { flexDirection: 'row', gap: 16, flexShrink: 1 },
  dateChip: {
    alignItems: 'center',
    backgroundColor: color.tanPanel,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dateNumber: { lineHeight: 30 },
  upcomingProvider: { marginTop: 2 },
  upcomingMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  upcomingActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    paddingTop: 18,
  },
  emptyUpcoming: { alignItems: 'center', paddingVertical: 34 },
  emptyCta: { marginTop: 16 },
  emptyPast: { alignItems: 'center', paddingVertical: 22 },
  pastRow: {
    backgroundColor: color.card,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  railCard: { padding: 22 },
  profileRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  profileMeta: {
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    marginTop: 16,
    paddingTop: 14,
    gap: 8,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  promo: {
    padding: 22,
    backgroundColor: color.tintBg,
    borderColor: color.tintBorder,
  },
  promoBody: { color: '#5f6f6a', marginTop: 8, marginBottom: 14, lineHeight: 20 },
  mobileHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
  },
  mobileBody: { paddingHorizontal: 20, paddingBottom: 24 },
});
