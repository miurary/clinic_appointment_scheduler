import { Platform } from 'react-native';

import { ACCESS_KEY, REFRESH_KEY, tokenStore } from './storage';

/**
 * Where the API lives.
 *
 * `localhost` means the device on native, not the machine running Django, so
 * the Android emulator gets its host-loopback alias and a real device needs
 * EXPO_PUBLIC_API_URL set to the LAN address (see the README).
 */
function defaultBaseUrl(): string {
  if (Platform.OS === 'android') return 'http://10.0.2.2:8000';
  return 'http://localhost:8000';
}

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? defaultBaseUrl();

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown, message?: string) {
    super(message ?? `Request failed with ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }

  /**
   * The slot went while the patient was deciding. The server distinguishes
   * this from ordinary validation failure with a 409 so the booking screen can
   * show the "just taken" banner rather than a field error.
   */
  get isSlotTaken(): boolean {
    return this.status === 409;
  }

  /** First human-readable message DRF returned, whatever shape it used. */
  get detail(): string {
    const payload = this.payload as Record<string, unknown> | undefined;
    if (!payload) return this.message;
    if (typeof payload.detail === 'string') return payload.detail;
    const first = Object.values(payload)[0];
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
    if (typeof first === 'string') return first;
    return this.message;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skips the Authorization header and the refresh dance. */
  anonymous?: boolean;
  query?: Record<string, string | number | undefined>;
};

let refreshInFlight: Promise<string | null> | null = null;
let onAuthLost: (() => void) | null = null;

/** Lets the auth context clear its state when the session cannot be renewed. */
export function setAuthLostHandler(handler: () => void) {
  onAuthLost = handler;
}

/**
 * Trades the refresh token for a new access token.
 *
 * Single-flight on purpose: a screen that fires three requests at mount would
 * otherwise send three refreshes, and with ROTATE_REFRESH_TOKENS the first
 * response invalidates the token the other two are still using — logging the
 * user out at random.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refresh = await tokenStore.get(REFRESH_KEY);
    if (!refresh) return null;

    const response = await fetch(`${API_BASE_URL}/api/auth/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    });

    if (!response.ok) {
      await tokenStore.remove(ACCESS_KEY);
      await tokenStore.remove(REFRESH_KEY);
      onAuthLost?.();
      return null;
    }

    const data = (await response.json()) as { access: string; refresh?: string };
    await tokenStore.set(ACCESS_KEY, data.access);
    // Rotation hands back a replacement; storing it is what keeps the session
    // alive past the old token's blacklisting.
    if (data.refresh) await tokenStore.set(REFRESH_KEY, data.refresh);
    return data.access;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, API_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous, query } = options;

  const send = async (token: string | null): Promise<Response> =>
    fetch(buildUrl(path, query), {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let token = anonymous ? null : await tokenStore.get(ACCESS_KEY);
  let response = await send(token);

  // One retry, and only for an expired access token. Retrying anything else
  // would turn a genuine authorization failure into an infinite loop.
  if (response.status === 401 && !anonymous) {
    token = await refreshAccessToken();
    if (token) response = await send(token);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 401 && !anonymous) onAuthLost?.();
    throw new ApiError(response.status, payload);
  }

  return payload as T;
}
