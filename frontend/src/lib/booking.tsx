import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import type { Appointment, Provider, Slot } from '../api/types';
import { CLINIC_TIMEZONE } from '../theme/tokens';

/**
 * The booking flow spans four screens (Book -> Review -> Success -> Dashboard),
 * so its state lives above them rather than being threaded through navigation
 * params. Matches the state list in the handoff.
 */
type BookingState = {
  provider: Provider | null;
  slot: Slot | null;
  /** Display zone only. Never changes the instant being booked. */
  timezone: string;
  /** Set when the flow was entered from "Reschedule" on the dashboard. */
  rescheduling: Appointment | null;
  /** The appointment just created or moved, for the success screen. */
  result: Appointment | null;
  /** A slot that vanished under us: struck through, selection cleared. */
  takenSlot: string | null;
};

type BookingContextValue = BookingState & {
  canContinue: boolean;
  setProvider: (provider: Provider | null) => void;
  selectSlot: (slot: Slot | null) => void;
  setTimezone: (timezone: string) => void;
  startReschedule: (appointment: Appointment) => void;
  cancelReschedule: () => void;
  markTaken: (startAt: string) => void;
  clearError: () => void;
  complete: (appointment: Appointment) => void;
  reset: () => void;
};

const BookingContext = createContext<BookingContextValue | null>(null);

export function useBooking(): BookingContextValue {
  const context = useContext(BookingContext);
  if (!context) throw new Error('useBooking must be used inside <BookingProvider>');
  return context;
}

const initialState: BookingState = {
  provider: null,
  slot: null,
  timezone: CLINIC_TIMEZONE,
  rescheduling: null,
  result: null,
  takenSlot: null,
};

export function BookingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BookingState>(initialState);

  const setProvider = useCallback((provider: Provider | null) => {
    // Changing provider invalidates the pick: that slot belonged to someone else's
    // calendar.
    setState((prev) => ({ ...prev, provider, slot: null, takenSlot: null }));
  }, []);

  const selectSlot = useCallback((slot: Slot | null) => {
    setState((prev) => ({ ...prev, slot }));
  }, []);

  const setTimezone = useCallback((timezone: string) => {
    // Display only: the selected slot is left alone, so switching zones
    // re-labels it rather than moving it.
    setState((prev) => ({ ...prev, timezone }));
  }, []);

  const startReschedule = useCallback((appointment: Appointment) => {
    setState((prev) => ({
      ...prev,
      rescheduling: appointment,
      provider: appointment.provider,
      slot: null,
      takenSlot: null,
      result: null,
    }));
  }, []);

  const cancelReschedule = useCallback(() => {
    setState((prev) => ({ ...prev, rescheduling: null, slot: null }));
  }, []);

  const markTaken = useCallback((startAt: string) => {
    // Clear the selection as well: the patient must actively pick again rather
    // than hitting Continue on a slot that no longer exists.
    setState((prev) => ({ ...prev, takenSlot: startAt, slot: null }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, takenSlot: null }));
  }, []);

  const complete = useCallback((appointment: Appointment) => {
    setState((prev) => ({ ...prev, result: appointment, slot: null, takenSlot: null }));
  }, []);

  const reset = useCallback(() => setState(initialState), []);

  const value = useMemo<BookingContextValue>(
    () => ({
      ...state,
      canContinue: state.provider !== null && state.slot !== null,
      setProvider,
      selectSlot,
      setTimezone,
      startReschedule,
      cancelReschedule,
      markTaken,
      clearError,
      complete,
      reset,
    }),
    [
      state,
      setProvider,
      selectSlot,
      setTimezone,
      startReschedule,
      cancelReschedule,
      markTaken,
      clearError,
      complete,
      reset,
    ],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}
