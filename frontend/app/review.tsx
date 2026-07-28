import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ApiError } from '../src/api/client';
import { api } from '../src/api/endpoints';
import { Avatar, DetailRow, initialsFor, Note, tintFor } from '../src/components/Bits';
import { PrimaryButton } from '../src/components/Button';
import { FadeUp } from '../src/components/FadeUp';
import { MobileHeader } from '../src/components/Nav';
import { Card, PageBackground } from '../src/components/Surface';
import { Display, Link, Muted, Strong } from '../src/components/Typography';
import { useBooking } from '../src/lib/booking';
import {
  clinicNote,
  formatDayDate,
  formatTime,
  labelFor,
  minutesBetween,
} from '../src/lib/datetime';
import { color, radius, shadow } from '../src/theme/tokens';
import { useResponsive } from '../src/theme/useResponsive';

const VISIT_LABELS: Record<string, string> = {
  follow: 'Follow-up',
  consult: 'New consult',
  pft: 'PFT review',
};

export default function ReviewScreen() {
  const router = useRouter();
  const { isDesktop } = useResponsive();
  const booking = useBooking();
  const params = useLocalSearchParams<{ visitType?: string }>();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { provider, slot, timezone, rescheduling } = booking;

  // Arriving here without a selection means a reload or a stale link.
  if (!provider || !slot) {
    return (
      <PageBackground>
        <View style={styles.fallback}>
          <Muted size={15}>That booking is no longer in progress.</Muted>
          <Pressable onPress={() => router.replace('/book')} accessibilityRole="button">
            <Link size={14}>Start again</Link>
          </Pressable>
        </View>
      </PageBackground>
    );
  }

  const visitLabel = VISIT_LABELS[params.visitType ?? 'follow'] ?? 'Visit';
  const minutes = minutesBetween(slot.start_at, slot.end_at);
  const note = clinicNote(slot.start_at, timezone);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const appointment = rescheduling
        ? await api.appointments.reschedule(rescheduling.id, slot.start_at)
        : await api.appointments.book(provider.id, slot.start_at, visitLabel);
      booking.complete(appointment);
      router.replace('/confirmed');
    } catch (caught) {
      if (caught instanceof ApiError && caught.isSlotTaken) {
        // Someone else took it between selection and confirm. Mark the slot,
        // clear the pick, and send the patient back to choose again — the
        // banner explains what happened.
        booking.markTaken(slot.start_at);
        router.replace('/book');
        return;
      }
      setError(
        caught instanceof ApiError
          ? caught.detail
          : 'Could not reach the server. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const detail = (
    <Card style={styles.detailCard}>
      <View style={styles.providerRow}>
        <Avatar
          initials={initialsFor(provider.full_name)}
          size={52}
          tint={tintFor(provider.full_name)}
        />
        <View style={styles.flexShrink}>
          <Strong size={16}>{provider.full_name}</Strong>
          <Muted size={13}>{provider.specialty || 'General'}</Muted>
        </View>
      </View>
      <View style={styles.rows}>
        <DetailRow label="Visit" value={`${visitLabel} · ${minutes} min`} />
        <DetailRow
          label="When"
          value={`${formatDayDate(slot.start_at, timezone)} · ${formatTime(
            slot.start_at,
            timezone,
          )}`}
        />
        <DetailRow label="Timezone" value={labelFor(timezone)} />
        <DetailRow label="Location" value="Ballard clinic" />
      </View>
      {note ? (
        <Note tone="info" icon="🕓" style={styles.note}>
          {note}
        </Note>
      ) : null}
    </Card>
  );

  const cta = (
    <PrimaryButton
      block
      size={isDesktop ? 'md' : 'lg'}
      label={busy ? 'Booking…' : rescheduling ? 'Confirm new time' : 'Confirm booking'}
      onPress={confirm}
      disabled={busy}
    />
  );

  // ------------------------------------------------------------- D3 desktop
  if (isDesktop) {
    return (
      <PageBackground>
        <ScrollView contentContainerStyle={styles.desktopPage}>
          <FadeUp style={[styles.desktopCard, shadow.card]}>
            <View style={styles.desktopHead}>
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Back to times"
              >
                <Link size={13.5}>‹ Back to times</Link>
              </Pressable>
              <Display size={30} style={styles.title}>
                Review your appointment
              </Display>
              <Muted size={14} style={styles.subtitle}>
                Confirm the details below to book.
              </Muted>
            </View>
            {error ? (
              <Note tone="error" icon="⚠" style={styles.errorDesktop}>
                {error}
              </Note>
            ) : null}
            <View style={styles.desktopDetail}>{detail}</View>
            <View style={styles.desktopFooter}>{cta}</View>
          </FadeUp>
        </ScrollView>
      </PageBackground>
    );
  }

  // -------------------------------------------------------------- M3 mobile
  return (
    <PageBackground>
      <View style={styles.mobileScreen}>
        <MobileHeader title="Review" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.mobileBody}>
          <Display size={26}>Confirm your visit</Display>
          <Muted size={13.5} style={styles.subtitle}>
            Check the details and book.
          </Muted>
          {error ? (
            <Note tone="error" icon="⚠" style={styles.note}>
              {error}
            </Note>
          ) : null}
          <View style={styles.mobileDetail}>{detail}</View>
        </ScrollView>
        <View style={styles.mobileFooter}>{cta}</View>
      </View>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  flexShrink: { flexShrink: 1 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  desktopPage: { flexGrow: 1, alignItems: 'center', paddingVertical: 40 },
  desktopCard: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: color.appSurface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.appCard,
    overflow: 'hidden',
  },
  desktopHead: { paddingHorizontal: 40, paddingTop: 34, paddingBottom: 8 },
  title: { marginTop: 14 },
  subtitle: { marginTop: 4 },
  desktopDetail: { paddingHorizontal: 40, paddingVertical: 22 },
  desktopFooter: { paddingHorizontal: 40, paddingBottom: 34 },
  errorDesktop: { marginHorizontal: 40, marginTop: 16 },
  detailCard: { padding: 24 },
  providerRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: color.borderSoft,
  },
  rows: { gap: 12, marginTop: 18 },
  note: { marginTop: 16 },
  mobileScreen: { flex: 1, backgroundColor: color.appSurface },
  mobileBody: { padding: 20, paddingBottom: 32 },
  mobileDetail: { marginTop: 20 },
  mobileFooter: {
    padding: 20,
    paddingBottom: 26,
    backgroundColor: color.card,
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
  },
});
