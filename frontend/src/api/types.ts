/** Response shapes from the DRF backend. */

export type Role = 'patient' | 'provider' | 'clinic_staff';

export type User = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  role: Role;
  timezone: string;
  date_joined: string;
};

export type Provider = {
  id: number;
  full_name: string;
  timezone: string;
  specialty: string;
  bio: string;
  slot_duration_minutes: number;
  accepting_new_patients: boolean;
};

/** The provider's own editable settings, from /api/auth/me/provider/. */
export type ProviderProfile = Provider & {
  user: User;
  buffer_minutes: number;
  booking_horizon_days: number;
  min_notice_minutes: number;
};

/**
 * The patient's own record from /api/auth/me/patient/.
 * Clinical notes are staff-authored and deliberately not exposed here.
 */
export type PatientProfile = {
  id: number;
  user: User;
  date_of_birth: string | null;
};

/** A one-off absence: absolute instants, not a weekly pattern. */
export type TimeOff = {
  id: number;
  start_at: string;
  end_at: string;
  reason: string;
};

/** Computed, never stored: a slot is an offer, only a booking is a row. */
export type Slot = {
  start_at: string;
  end_at: string;
};

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';

export type Appointment = {
  id: number;
  provider: Provider;
  patient: User;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  reason: string;
  cancelled_at: string | null;
  cancellation_reason: string;
  created_at: string;
};

export type AvailabilityRule = {
  id: number;
  weekday: number;
  weekday_display: string;
  start_time: string;
  end_time: string;
  valid_from: string;
  valid_until: string | null;
};

export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type TokenPair = {
  access: string;
  refresh: string;
};
