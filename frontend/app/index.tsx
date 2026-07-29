import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PageBackground } from '../src/components/Surface';
import { useAuth } from '../src/lib/auth';
import { color } from '../src/theme/tokens';

/**
 * The entry route decides where a visitor belongs.
 *
 * It waits for the stored session to be checked first: redirecting on a
 * still-loading session would bounce a signed-in user to the sign-in screen
 * for a frame before bouncing them back.
 */
export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <PageBackground>
        <View style={styles.center}>
          <ActivityIndicator color={color.primary} />
        </View>
      </PageBackground>
    );
  }

  if (!user) return <Redirect href="/sign-in" />;
  if (user.role === 'provider') return <Redirect href="/provider" />;
  return <Redirect href="/dashboard" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
