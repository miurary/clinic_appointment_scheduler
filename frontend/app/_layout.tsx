import { Newsreader_500Medium, useFonts } from '@expo-google-fonts/newsreader';
import {
  PublicSans_400Regular,
  PublicSans_500Medium,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
} from '@expo-google-fonts/public-sans';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PageBackground } from '../src/components/Surface';
import { ToastProvider } from '../src/components/Toast';
import { AuthProvider } from '../src/lib/auth';
import { BookingProvider } from '../src/lib/booking';
import { color } from '../src/theme/tokens';

export default function RootLayout() {
  // Nothing renders until the fonts are in: the design is specified in
  // Newsreader and Public Sans, and a flash of the system serif is worse than
  // a beat of blank warm background.
  const [fontsLoaded] = useFonts({
    Newsreader_500Medium,
    PublicSans_400Regular,
    PublicSans_500Medium,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <PageBackground>
        <View style={styles.loading}>
          <ActivityIndicator color={color.primary} />
        </View>
      </PageBackground>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <BookingProvider>
          <ToastProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                // The screens animate themselves in with FadeUp, matching the
                // handoff; a second native transition on top reads as a stutter.
                animation: 'fade',
                contentStyle: { backgroundColor: color.pageMid },
              }}
            />
          </ToastProvider>
        </BookingProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
