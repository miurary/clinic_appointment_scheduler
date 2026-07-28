import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Token storage, per platform.
 *
 * expo-secure-store is backed by the iOS Keychain and Android Keystore, which
 * is where refresh tokens belong on a device. It has no web implementation, so
 * the web build falls back to AsyncStorage (localStorage underneath).
 *
 * TODO(production): the web fallback is a deliberate, known weakening and MUST
 * be revisited before this handles real patient data. Anything in localStorage
 * is readable by injected script, so an XSS on the web build can lift the
 * refresh token and replay it until it expires. The fix is to stop holding
 * tokens in JS on web at all: issue them as httpOnly, Secure, SameSite cookies
 * set by the server, and add CSRF protection to the cookie-authenticated
 * routes. Until then the exposure is bounded only by the 30-minute access
 * token, refresh rotation with blacklisting, and never rendering untrusted
 * HTML. Tracked in the deployment checklist in the README.
 *
 * Native builds are unaffected -- Keychain/Keystore are not reachable from
 * page script.
 */
const secureAvailable = Platform.OS !== 'web';

export const tokenStore = {
  async get(key: string): Promise<string | null> {
    if (secureAvailable) return SecureStore.getItemAsync(key);
    return AsyncStorage.getItem(key);
  },

  async set(key: string, value: string): Promise<void> {
    if (secureAvailable) return SecureStore.setItemAsync(key, value);
    return AsyncStorage.setItem(key, value);
  },

  async remove(key: string): Promise<void> {
    if (secureAvailable) return SecureStore.deleteItemAsync(key);
    return AsyncStorage.removeItem(key);
  },
};

export const ACCESS_KEY = 'kivo.access';
export const REFRESH_KEY = 'kivo.refresh';
