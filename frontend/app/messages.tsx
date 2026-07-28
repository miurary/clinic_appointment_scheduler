import { StyleSheet, View } from 'react-native';

import { BottomTabs, PATIENT_NAV, TopNav } from '../src/components/Nav';
import { AppCard, Card } from '../src/components/Surface';
import { Body, Display, Muted } from '../src/components/Typography';
import { useAuth } from '../src/lib/auth';
import { useResponsive } from '../src/theme/useResponsive';

/**
 * Messaging appears in the handoff's navigation but is outside the agreed
 * scope (booking + availability + auth), and there is no backend for it.
 *
 * An honest empty state rather than a mocked-up inbox: a fake thread list
 * suggests a feature exists, and secure patient messaging is exactly the kind
 * of thing nobody should believe is working when it isn't.
 */
export default function MessagesScreen() {
  const { user } = useAuth();
  const { isDesktop } = useResponsive();
  const name = user?.full_name ?? 'You';

  const body = (
    <>
      <Display size={isDesktop ? 32 : 26}>Messages</Display>
      <Card dashed style={styles.card}>
        <Body size={22}>✉</Body>
        <Muted size={15} style={styles.title}>
          Secure messaging isn&apos;t part of this build.
        </Muted>
        <Muted size={13.5} style={styles.body}>
          Scope here is booking, availability and auth. For anything urgent,
          call the clinic.
        </Muted>
      </Card>
    </>
  );

  if (isDesktop) {
    return (
      <AppCard maxWidth={720}>
        <TopNav items={PATIENT_NAV} name={name} />
        <View style={styles.desktopBody}>{body}</View>
      </AppCard>
    );
  }

  return (
    <AppCard scroll={false}>
      <View style={styles.mobileBody}>{body}</View>
      <BottomTabs items={PATIENT_NAV} name={name} />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  desktopBody: { paddingHorizontal: 40, paddingVertical: 34 },
  mobileBody: { flex: 1, paddingHorizontal: 20, paddingTop: 24 },
  card: { marginTop: 20, alignItems: 'center', paddingVertical: 44 },
  title: { marginTop: 14, textAlign: 'center' },
  body: { marginTop: 6, textAlign: 'center', maxWidth: 320 },
});
