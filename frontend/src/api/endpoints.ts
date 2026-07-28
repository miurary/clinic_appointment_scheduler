import { request } from './client';
import type {
  Appointment,
  AvailabilityRule,
  Paginated,
  Provider,
  ProviderProfile,
  Slot,
  TokenPair,
  User,
} from './types';

/**
 * One place per backend route, so screens never build URLs or remember which
 * verb an action uses.
 */
export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<TokenPair>('/api/auth/token/', {
        method: 'POST',
        body: { email, password },
        anonymous: true,
      }),

    register: (input: {
      email: string;
      password: string;
      first_name?: string;
      last_name?: string;
      role?: 'patient' | 'provider';
      timezone?: string;
    }) =>
      request<User>('/api/auth/register/', {
        method: 'POST',
        body: input,
        anonymous: true,
      }),

    /** Revokes the refresh token server-side; the access token lives out its span. */
    logout: (refresh: string) =>
      request<void>('/api/auth/logout/', {
        method: 'POST',
        body: { refresh },
        anonymous: true,
      }),

    me: () => request<User>('/api/auth/me/'),

    updateMe: (input: Partial<Pick<User, 'first_name' | 'last_name' | 'phone' | 'timezone'>>) =>
      request<User>('/api/auth/me/', { method: 'PATCH', body: input }),

    myProviderProfile: () => request<ProviderProfile>('/api/auth/me/provider/'),

    updateMyProviderProfile: (input: Partial<ProviderProfile>) =>
      request<ProviderProfile>('/api/auth/me/provider/', {
        method: 'PATCH',
        body: input,
      }),
  },

  providers: {
    list: (query?: { specialty?: string; accepting_new_patients?: string }) =>
      request<Paginated<Provider>>('/api/providers/', { query }),

    get: (id: number) => request<Provider>(`/api/providers/${id}/`),

    /** Open slots between two provider-local dates (inclusive). */
    slots: (id: number, dateFrom: string, dateTo: string) =>
      request<Slot[]>(`/api/providers/${id}/slots/`, {
        query: { date_from: dateFrom, date_to: dateTo },
      }),
  },

  appointments: {
    list: (scope?: 'upcoming' | 'past') =>
      request<Paginated<Appointment>>('/api/appointments/', { query: { scope } }),

    /**
     * Throws ApiError with status 409 when the slot went in the meantime --
     * the booking screen turns that into the "just taken" banner.
     */
    book: (providerId: number, startAt: string, reason?: string) =>
      request<Appointment>('/api/appointments/', {
        method: 'POST',
        body: { provider: providerId, start_at: startAt, reason },
      }),

    reschedule: (id: number, startAt: string) =>
      request<Appointment>(`/api/appointments/${id}/reschedule/`, {
        method: 'POST',
        body: { start_at: startAt },
      }),

    cancel: (id: number, reason?: string) =>
      request<Appointment>(`/api/appointments/${id}/cancel/`, {
        method: 'POST',
        body: { cancellation_reason: reason ?? '' },
      }),
  },

  availability: {
    list: () => request<Paginated<AvailabilityRule>>('/api/availability/'),

    create: (input: Omit<AvailabilityRule, 'id' | 'weekday_display'>) =>
      request<AvailabilityRule>('/api/availability/', { method: 'POST', body: input }),

    update: (id: number, input: Partial<AvailabilityRule>) =>
      request<AvailabilityRule>(`/api/availability/${id}/`, {
        method: 'PATCH',
        body: input,
      }),

    remove: (id: number) =>
      request<void>(`/api/availability/${id}/`, { method: 'DELETE' }),
  },
};
