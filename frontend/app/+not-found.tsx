import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '../src/components/Button';
import { Card, PageBackground } from '../src/components/Surface';
import { Display, Muted } from '../src/components/Typography';
import { useAuth } from '../src/lib/auth';

/**
 * Expo Router renders this for any unmatched path. Without it a mistyped URL
 * on web falls through to the framework's default unmatched screen, which is a
 * developer artefact rather than something a patient should ever see.
 */
export default function NotFoundScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const home = !user ? '/sign-in' : user.role === 'provider' ? '/provider' : '/dashboard';

  return (
    <PageBackground>
      <View style={styles.page}>
        <Card style={styles.card}>
          <Display size={30}>Page not found</Display>
          <Muted size={15} style={styles.body}>
            That link doesn&apos;t go anywhere. It may have moved, or the address
            may have a typo.
          </Muted>
          <PrimaryButton
            label={user ? 'Back to your appointments' : 'Go to sign in'}
            onPress={() => router.replace(home)}
            style={styles.cta}
          />
        </Card>
      </View>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { maxWidth: 460, alignItems: 'center', paddingVertical: 44 },
  body: { marginTop: 10, textAlign: 'center' },
  cta: { marginTop: 24 },
});
