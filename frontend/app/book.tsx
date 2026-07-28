import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ApiError } from '../src/api/client';
import { api } from '../src/api/endpoints';
import type { Provider, Slot } from '../src/api/types';
import { Avatar, Chip, initialsFor, Note, tintFor } from '../src/components/Bits';
import { PrimaryButton } from '../src/components/Button';
import { BottomTabs, MobileHeader, PATIENT_NAV, TopNav } from '../src/components/Nav';
import { SlotButton } from '../src/components/SlotButton';
import { AppCard, Card } from '../src/components/Surface';
import { Body, Display, Label, Link, Muted, Semi, Strong } from '../src/components/Typography';
import { useAuth } from '../src/lib/auth';
import { useBooking } from '../src/lib/booking';
import {
  addDays,
  formatDayNumber,
  formatShortDate,
  formatTime,
  formatWeekdayAbbr,
  formatWeekdayShort,
  labelFor,
  localDateKey,
  shortLabelFor,
  splitByHalfDay,
  startOfWeek,
  toDateParam,
  weekLabel,
} from '../src/lib/datetime';
import { CLINIC_TIMEZONE, color, TIMEZONES } from '../src/theme/tokens';
import { useResponsive } from '../src/theme/useResponsive';

/**
 * Visit types are a presentation concept only.
 *
 * The mock varies appointment length by visit type; the backend has a single
 * slot_duration_minutes per provider and no visit-type model, and adding one
 * is outside the agreed scope (booking + availability + auth). These chips
 * therefore preset the appointment's `reason`, and the duration shown always
 * comes from the provider. See the README for the full divergence list.
 */
const VISIT_TYPES = [
  { id: 'follow', label: 'Follow-up' },
  { id: 'consult', label: 'New consult' },
  { id: 'pft', label: 'PFT review' },
] as const;

const WORKING_DAYS = 5; // Mon–Fri columns, as drawn

export default function BookScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { isDesktop } = useResponsive();
  const booking = useBooking();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [visitType, setVisitType] = useState<string>(VISIT_TYPES[0].id);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const viewZone = booking.timezone;
  const provider = booking.provider;

  const weekStart = useMemo(
    () => addDays(startOfWeek(new Date()), weekOffset * 7),
    [weekOffset],
  );
  const weekDays = useMemo(
    () => Array.from({ length: WORKING_DAYS }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  // Providers, once.
  useEffect(() => {
    let cancelled = false;
    api.providers
      .list()
      .then((page) => {
        if (cancelled) return;
        setProviders(page.results);
        if (!booking.provider && page.results.length > 0) {
          booking.setProvider(page.results[0]);
        }
      })
      .catch(() => setProviders([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slots, whenever the provider or week changes.
  const loadSlots = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    try {
      const found = await api.providers.slots(
        provider.id,
        toDateParam(weekDays[0]),
        toDateParam(weekDays[WORKING_DAYS - 1]),
      );
      setSlots(found);
    } catch {
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [provider, weekDays]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  /** Slots bucketed by the day they fall on *in the viewer's zone*. */
  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of slots) {
      const key = localDateKey(slot.start_at, viewZone);
      const list = map.get(key);
      if (list) list.push(slot);
      else map.set(key, [slot]);
    }
    return map;
  }, [slots, viewZone]);

  const dayKeys = useMemo(
    () => weekDays.map((day) => localDateKey(day, viewZone)),
    [weekDays, viewZone],
  );

  const activeDayKey = selectedDayKey ?? dayKeys[0];
  const daySlots = byDay.get(activeDayKey) ?? [];
  const emptyWeek = !loading && slots.length === 0;

  const crossZone = viewZone !== CLINIC_TIMEZONE;

  const onContinue = () => {
    if (!booking.canContinue) return;
    router.push({ pathname: '/review', params: { visitType } } as never);
  };

  const summary = booking.slot
    ? `${VISIT_TYPES.find((v) => v.id === visitType)?.label} · ${
        provider?.full_name ?? ''
      } · ${formatWeekdayShort(booking.slot.start_at, viewZone)} ${formatShortDate(
        booking.slot.start_at,
        viewZone,
      )} · ${formatTime(booking.slot.start_at, viewZone)} ${shortLabelFor(viewZone)}`
    : null;

  // ---------------------------------------------------------------- shared
  const banners = (
    <>
      {booking.rescheduling ? (
        <Note
          tone="warn"
          icon="↻"
          style={styles.banner}
          action={
            <Pressable onPress={booking.cancelReschedule} accessibilityRole="button">
              <Semi size={13.5} style={{ color: color.warnText }}>
                Keep original
              </Semi>
            </Pressable>
          }
        >
          Rescheduling your existing visit — pick a new time.
        </Note>
      ) : null}

      {booking.takenSlot ? (
        <Note tone="error" icon="⚠" style={styles.banner}>
          The time you picked was just booked by someone else. It&apos;s been removed —
          please choose another.
        </Note>
      ) : null}
    </>
  );

  const timezoneNote = crossZone ? (
    <Note tone="info" icon="🕓" style={styles.banner}>
      {`Times shown in ${labelFor(viewZone)}. The clinic runs on ${shortLabelFor(
        CLINIC_TIMEZONE,
      )} — you and your provider are looking at the same moment.`}
    </Note>
  ) : null;

  const providerCard = provider ? (
    <Card style={styles.providerCard}>
      <View style={styles.providerHead}>
        <Avatar
          initials={initialsFor(provider.full_name)}
          size={56}
          tint={tintFor(provider.full_name)}
        />
        <View style={styles.flexShrink}>
          <Strong size={16}>{provider.full_name}</Strong>
          <Muted size={13}>{provider.specialty || 'General'}</Muted>
        </View>
      </View>
      {provider.bio ? (
        <Body size={13.5} style={styles.bio}>
          {provider.bio}
        </Body>
      ) : null}
      <View style={styles.providerMeta}>
        <View style={styles.metaRow}>
          <Muted size={13}>Next available</Muted>
          <Semi size={13}>
            {slots.length > 0
              ? `${formatWeekdayShort(slots[0].start_at, viewZone)} ${formatTime(
                  slots[0].start_at,
                  viewZone,
                )}`
              : '—'}
          </Semi>
        </View>
        <View style={styles.metaRow}>
          <Muted size={13}>Visit length</Muted>
          <Semi size={13}>{provider.slot_duration_minutes} min</Semi>
        </View>
      </View>
    </Card>
  ) : null;

  // ------------------------------------------------------------- D2 desktop
  if (isDesktop) {
    return (
      <AppCard>
        <TopNav items={PATIENT_NAV} name={user?.full_name ?? 'You'} />
        <View style={styles.desktopBody}>
          <Display size={34}>Let&apos;s find a time that works</Display>
          <Muted size={15} style={styles.subtitle}>
            Choose your visit, provider, and an open slot.
          </Muted>

          {banners}

          <View style={styles.filters}>
            <FilterGroup label="Visit type">
              {VISIT_TYPES.map((type) => (
                <Chip
                  key={type.id}
                  label={type.label}
                  selected={visitType === type.id}
                  onPress={() => setVisitType(type.id)}
                />
              ))}
            </FilterGroup>
            <FilterGroup label="Provider">
              {providers.map((candidate) => (
                <Chip
                  key={candidate.id}
                  label={candidate.full_name}
                  selected={provider?.id === candidate.id}
                  onPress={() => booking.setProvider(candidate)}
                />
              ))}
            </FilterGroup>
            <FilterGroup label="Timezone">
              {TIMEZONES.map((zone) => (
                <Chip
                  key={zone.id}
                  label={zone.short}
                  selected={viewZone === zone.id}
                  onPress={() => booking.setTimezone(zone.id)}
                />
              ))}
            </FilterGroup>
          </View>

          {timezoneNote}

          <View style={styles.twoColumn}>
            <View style={styles.providerColumn}>{providerCard}</View>
            <View style={styles.flex}>
              <View style={styles.weekBar}>
                <View style={styles.weekNav}>
                  <WeekArrow
                    label="‹"
                    disabled={weekOffset === 0}
                    onPress={() => setWeekOffset((w) => Math.max(0, w - 1))}
                  />
                  <Semi size={14} style={styles.weekLabel}>
                    {weekLabel(weekStart)}
                  </Semi>
                  <WeekArrow label="›" onPress={() => setWeekOffset((w) => w + 1)} />
                </View>
                <Muted size={12.5}>Times in {labelFor(viewZone)}</Muted>
              </View>

              {loading ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={color.primary} />
                </View>
              ) : emptyWeek ? (
                <EmptyWeek
                  providerName={provider?.full_name ?? 'This provider'}
                  onBack={() => setWeekOffset((w) => Math.max(0, w - 1))}
                />
              ) : (
                <View style={styles.dayGrid}>
                  {weekDays.map((day, index) => {
                    const key = dayKeys[index];
                    const list = byDay.get(key) ?? [];
                    return (
                      <View key={key} style={styles.dayColumn}>
                        <View style={styles.dayHead}>
                          <Label>{formatWeekdayAbbr(day.toISOString(), viewZone)}</Label>
                          <Strong size={15}>
                            {formatShortDate(day.toISOString(), viewZone)}
                          </Strong>
                        </View>
                        <View style={styles.daySlots}>
                          {list.length === 0 ? (
                            <View style={styles.fullyBooked}>
                              <Muted size={12}>—</Muted>
                            </View>
                          ) : (
                            list.map((slot) => (
                              <SlotButton
                                key={slot.start_at}
                                time={formatTime(slot.start_at, viewZone)}
                                selected={booking.slot?.start_at === slot.start_at}
                                taken={booking.takenSlot === slot.start_at}
                                onPress={() => booking.selectSlot(slot)}
                              />
                            ))
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={styles.footerBar}>
          {summary ? (
            <Body size={14} style={{ color: color.inkStrong }}>
              {summary}
            </Body>
          ) : (
            <Muted size={14}>Select an open time to continue</Muted>
          )}
          <PrimaryButton
            label="Continue"
            disabled={!booking.canContinue}
            onPress={onContinue}
            style={styles.continueDesktop}
          />
        </View>
      </AppCard>
    );
  }

  // -------------------------------------------------------------- M2 mobile
  const { morning, afternoon } = splitByHalfDay(daySlots, viewZone);

  return (
    <AppCard scroll={false}>
      <MobileHeader
        title="Book a visit"
        onBack={() => router.back()}
        right={
          <Avatar
            initials={initialsFor(user?.full_name ?? 'You')}
            size={38}
            tint={tintFor(user?.full_name ?? 'You')}
          />
        }
      />
      <ScrollView contentContainerStyle={styles.mobileBody}>
        {banners}

        {provider ? (
          <Card style={styles.mobileProvider}>
            <Avatar
              initials={initialsFor(provider.full_name)}
              size={46}
              tint={tintFor(provider.full_name)}
            />
            <View style={styles.flex}>
              <Strong size={15}>{provider.full_name}</Strong>
              <Muted size={12.5}>
                {provider.specialty} · {provider.slot_duration_minutes} min
              </Muted>
            </View>
          </Card>
        ) : null}

        <View style={styles.tzRow}>
          <Muted size={12.5}>🕓 Times in {labelFor(viewZone)}</Muted>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.tzChips}>
            {TIMEZONES.map((zone) => (
              <Chip
                key={zone.id}
                label={zone.short}
                selected={viewZone === zone.id}
                onPress={() => booking.setTimezone(zone.id)}
              />
            ))}
          </View>
        </ScrollView>

        {timezoneNote}

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.dayPills}>
            {weekDays.map((day, index) => {
              const key = dayKeys[index];
              const active = key === activeDayKey;
              const count = (byDay.get(key) ?? []).length;
              return (
                <Pressable
                  key={key}
                  onPress={() => setSelectedDayKey(key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.dayPill,
                    active && styles.dayPillActive,
                    count === 0 && styles.dayPillEmpty,
                  ]}
                >
                  <Body
                    size={11}
                    style={{ color: active ? color.white : color.inkFaint }}
                  >
                    {formatWeekdayAbbr(day.toISOString(), viewZone)}
                  </Body>
                  <Strong size={16} style={{ color: active ? color.white : color.ink }}>
                    {formatDayNumber(day.toISOString(), viewZone)}
                  </Strong>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={color.primary} />
          </View>
        ) : daySlots.length === 0 ? (
          <EmptyWeek
            providerName={provider?.full_name ?? 'This provider'}
            onBack={() => setWeekOffset((w) => Math.max(0, w - 1))}
          />
        ) : (
          <>
            {morning.length > 0 ? (
              <>
                <Label style={styles.groupLabel}>Morning</Label>
                <SlotGrid
                  slots={morning}
                  zone={viewZone}
                  selected={booking.slot?.start_at}
                  taken={booking.takenSlot}
                  onSelect={booking.selectSlot}
                />
              </>
            ) : null}
            {afternoon.length > 0 ? (
              <>
                <Label style={styles.groupLabel}>Afternoon</Label>
                <SlotGrid
                  slots={afternoon}
                  zone={viewZone}
                  selected={booking.slot?.start_at}
                  taken={booking.takenSlot}
                  onSelect={booking.selectSlot}
                />
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <View style={styles.mobileFooter}>
        <Muted size={12.5} style={styles.mobileSummary}>
          {summary ?? 'Select an open time to continue'}
        </Muted>
        <PrimaryButton
          block
          size="lg"
          label="Continue"
          disabled={!booking.canContinue}
          onPress={onContinue}
        />
      </View>
      <BottomTabs items={PATIENT_NAV} name={user?.full_name ?? 'You'} />
    </AppCard>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Label style={styles.filterLabel}>{label}</Label>
      <View style={styles.chipRow}>{children}</View>
    </View>
  );
}

function SlotGrid({
  slots,
  zone,
  selected,
  taken,
  onSelect,
}: {
  slots: Slot[];
  zone: string;
  selected?: string;
  taken: string | null;
  onSelect: (slot: Slot) => void;
}) {
  return (
    <View style={styles.slotGrid}>
      {slots.map((slot) => (
        <SlotButton
          key={slot.start_at}
          large
          style={styles.slotGridItem}
          time={formatTime(slot.start_at, zone)}
          selected={selected === slot.start_at}
          taken={taken === slot.start_at}
          onPress={() => onSelect(slot)}
        />
      ))}
    </View>
  );
}

function WeekArrow({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label === '‹' ? 'Previous week' : 'Next week'}
      accessibilityState={{ disabled }}
      style={[styles.weekArrow, disabled && styles.weekArrowDisabled]}
    >
      <Body size={16} style={{ color: disabled ? color.inkFaint : color.ink }}>
        {label}
      </Body>
    </Pressable>
  );
}

function EmptyWeek({
  providerName,
  onBack,
}: {
  providerName: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Body size={22}>🗓</Body>
      </View>
      <Strong size={16} style={styles.emptyTitle}>
        No open times this week
      </Strong>
      <Muted size={14} style={styles.emptyBody}>
        {providerName} has no availability this week. Try another week, or pick a
        different provider.
      </Muted>
      <Pressable onPress={onBack} accessibilityRole="button" style={styles.emptyAction}>
        <Semi size={13.5}>‹ Back to this week</Semi>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  desktopBody: { paddingHorizontal: 40, paddingVertical: 34 },
  subtitle: { marginTop: 6 },
  banner: { marginTop: 20 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 26, marginTop: 24 },
  filterLabel: { marginBottom: 8 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  twoColumn: { flexDirection: 'row', gap: 28, marginTop: 26 },
  providerColumn: { width: 280 },
  providerCard: { padding: 22 },
  providerHead: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  bio: { color: color.inkBody, marginTop: 16, lineHeight: 21 },
  providerMeta: {
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    marginTop: 16,
    paddingTop: 16,
    gap: 9,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  weekBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  weekNav: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  weekLabel: { minWidth: 130, textAlign: 'center' },
  weekArrow: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.borderField,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekArrowDisabled: { opacity: 0.45 },
  dayGrid: { flexDirection: 'row', gap: 10 },
  dayColumn: { flex: 1 },
  dayHead: { alignItems: 'center', marginBottom: 10, gap: 2 },
  daySlots: { gap: 8 },
  fullyBooked: {
    backgroundColor: color.tanPanel,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  loading: { paddingVertical: 60, alignItems: 'center' },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.borderDashed,
    borderRadius: 16,
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: color.tanPanel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { marginTop: 16 },
  emptyBody: { marginTop: 4, maxWidth: 320, textAlign: 'center' },
  emptyAction: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.borderField,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 18,
  },
  footerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    paddingVertical: 18,
    backgroundColor: color.tanPanel,
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    gap: 20,
  },
  continueDesktop: { paddingHorizontal: 28 },
  mobileBody: { padding: 20, paddingBottom: 32, gap: 14 },
  mobileProvider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  tzRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tzChips: { flexDirection: 'row', gap: 8 },
  dayPills: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  dayPill: {
    width: 60,
    paddingVertical: 9,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.borderField,
  },
  dayPillActive: {
    backgroundColor: color.ctaBottom,
    borderColor: color.ctaBottom,
  },
  dayPillEmpty: { opacity: 0.5 },
  groupLabel: { marginTop: 6 },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slotGridItem: { width: '47.5%', flexGrow: 1 },
  mobileFooter: {
    backgroundColor: color.card,
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 10,
  },
  mobileSummary: { textAlign: 'center' },
});
