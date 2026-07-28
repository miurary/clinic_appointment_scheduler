import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { setAuthLostHandler } from '../api/client';
import { api } from '../api/endpoints';
import { ACCESS_KEY, REFRESH_KEY, tokenStore } from '../api/storage';
import type { Role, User } from '../api/types';

type AuthContextValue = {
  user: User | null;
  /** True until the stored session has been checked, so screens can wait. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (input: {
    email: string;
    password: string;
    first_name?: string;
    last_name?: string;
    role: Extract<Role, 'patient' | 'provider'>;
  }) => Promise<User>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // The client clears the session when a refresh fails, which can happen on
  // any request. Without this hook the app would keep rendering a signed-in
  // shell against a dead token.
  useEffect(() => {
    setAuthLostHandler(() => setUser(null));
  }, []);

  // Restore a stored session on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await tokenStore.get(ACCESS_KEY);
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const me = await api.auth.me();
        if (!cancelled) setUser(me);
      } catch {
        // Expired past refreshing, or revoked. Start clean rather than
        // leaving a half-signed-in shell on screen.
        await tokenStore.remove(ACCESS_KEY);
        await tokenStore.remove(REFRESH_KEY);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const tokens = await api.auth.login(email, password);
    await tokenStore.set(ACCESS_KEY, tokens.access);
    await tokenStore.set(REFRESH_KEY, tokens.refresh);
    const me = await api.auth.me();
    setUser(me);
    return me;
  }, []);

  const signUp = useCallback<AuthContextValue['signUp']>(
    async (input) => {
      await api.auth.register(input);
      // Registration returns the user but no tokens, so sign in to get a session.
      return signIn(input.email, input.password);
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    const refresh = await tokenStore.get(REFRESH_KEY);
    // Clear locally first: the user asked to be signed out, and that must
    // happen even if the network call fails.
    await tokenStore.remove(ACCESS_KEY);
    await tokenStore.remove(REFRESH_KEY);
    setUser(null);
    if (refresh) {
      try {
        await api.auth.logout(refresh);
      } catch {
        // Already expired or revoked; nothing left to revoke.
      }
    }
  }, []);

  const refreshUser = useCallback(async () => {
    setUser(await api.auth.me());
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut, refreshUser }),
    [user, loading, signIn, signUp, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
