import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { DetailRow } from '../src/components/Bits';
import { GhostButton, PrimaryButton } from '../src/components/Button';
import { FadeUp, Pop } from '../src/components/FadeUp';
import { Card, PageBackground } from '../src/components/Surface';
import { Body, Display, Muted } from '../src/components/Typography';
import { useToast } from '../src/components/Toast';
import { useAuth } from '../src/lib/auth';
import { useBooking } from '../src/lib/booking';
import { addToCalendar } from '../src/lib/calendar';
import {
  clinicNote,
  formatDayDate,
  formatTime,
  minutesBetween,
  shortLabelFor,
} from '../src/lib/datetime';
import { color, radius, shadow } from '../src/theme/tokens';
import { useResponsive } from '../src/theme/useResponsive';

export default function ConfirmedScreen() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { isDesktop } = useResponsive();
  const booking = useBooking();

  const appointment = booking.result;
  const wasReschedule = booking.rescheduling !== null;

  if (!appointment) {
    return (
      <PageBackground>
        <View style={styles.fallback}>
          <Muted size={15}>Nothing to confirm just yet.</Muted>
        </View>
      </PageBackground>
    );
  }

  const zone = booking.timezone;
  const minutes = minutesBetween(appointment.start_at, appointment.end_at);
  const note = clinicNote(appointment.start_at, zone);

  const goToDashboard = () => {
    booking.reset();
    router.replace('/dashboard');
  };

  const body = (
    <>
      <Pop style={styles.checkCircle}>
        {/* The handoff draws the tick as two borders on a rotated box — no
            icon font involved, so it scales cleanly at any size. */}
        <View style={styles.check} />
      </Pop>

      <Display size={isDesktop ? 30 : 28} style={styles.title}>
        {wasReschedule ? 'Rescheduled' : "You're booked"}
      </Display>
      <Muted size={isDesktop ? 15 : 14} style={styles.subtitle}>
        A confirmation was sent to {user?.email ?? 'your email'}
      </Muted>

      <Card style={styles.recap}>
        <DetailRow label={appointment.reason || 'Visit'} value={`${minutes} min`} />
        <DetailRow
          label={appointment.provider.full_name}
          value={appointment.provider.specialty || 'General'}
        />
        <DetailRow
          label={`${formatDayDate(appointment.start_at, zone)} · ${formatTime(
            appointment.start_at,
            zone,
          )}`}
          value={shortLabelFor(zone)}
        />
        {note ? (
          <View style={styles.noteRow}>
            <Body size={12.5} style={{ color: color.inkSubtle }}>
              🕓 {note}
            </Body>
          </View>
        ) : null}
      </Card>
    </>
  );

  const actions = (
    <View style={isDesktop ? styles.actionsRow : styles.actionsColumn}>
      {isDesktop ? (
        <>
          <GhostButton
            block
            label="Add to calendar"
            onPress={async () => toast.show(await addToCalendar(appointment))}
            style={styles.action}
          />
          <PrimaryButton
            block
            label="View my appointments"
            onPress={goToDashboard}
            style={styles.action}
          />
        </>
      ) : (
        <>
          <PrimaryButton
            block
            size="lg"
            label="View my appointments"
            onPress={goToDashboard}
          />
          <GhostButton
            block
            size="lg"
            label="Add to calendar"
            onPress={async () => toast.show(await addToCalendar(appointment))}
          />
        </>
      )}
    </View>
  );

  if (isDesktop) {
    return (
      <PageBackground>
        <ScrollView contentContainerStyle={styles.desktopPage}>
          <FadeUp style={[styles.desktopCard, shadow.card]}>
            {body}
            {actions}
          </FadeUp>
        </ScrollView>
      </PageBackground>
    );
  }

  return (
    <PageBackground>
      <View style={styles.mobileScreen}>
        <ScrollView contentContainerStyle={styles.mobileBody}>{body}</ScrollView>
        <View style={styles.mobileFooter}>{actions}</View>
      </View>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  desktopPage: { flexGrow: 1, alignItems: 'center', paddingVertical: 40 },
  desktopCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: color.appSurface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.appCard,
    padding: 48,
    alignItems: 'center',
  },
  mobileScreen: { flex: 1, backgroundColor: color.appSurface },
  mobileBody: { paddingHorizontal: 26, paddingTop: 60, alignItems: 'center' },
  checkCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: color.successCircle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    width: 26,
    height: 14,
    borderLeftWidth: 4,
    borderBottomWidth: 4,
    borderColor: color.successCheck,
    transform: [{ rotate: '-45deg' }, { translateY: -3 }],
  },
  title: { marginTop: 22, textAlign: 'center' },
  subtitle: { marginTop: 6, textAlign: 'center' },
  recap: { width: '100%', marginTop: 26, gap: 10 },
  noteRow: {
    borderTopWidth: 1,
    borderTopColor: color.neutralBg,
    paddingTop: 10,
    marginTop: 2,
  },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 24, width: '100%' },
  actionsColumn: { gap: 10 },
  action: { flex: 1 },
  mobileFooter: { padding: 20, paddingBottom: 26, gap: 10 },
});
