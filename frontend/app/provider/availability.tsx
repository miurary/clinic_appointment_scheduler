import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import { api } from '../../src/api/endpoints';
import type { AvailabilityRule, ProviderProfile } from '../../src/api/types';
import { Avatar, Chip, initialsFor, Note, tintFor } from '../../src/components/Bits';
import { PrimaryButton } from '../../src/components/Button';
import { Toggle } from '../../src/components/Form';
import { BottomTabs, PROVIDER_NAV, TopNav } from '../../src/components/Nav';
import { AppCard, Card } from '../../src/components/Surface';
import { useToast } from '../../src/components/Toast';
import { Body, Display, Label, Muted, Semi, Strong } from '../../src/components/Typography';
import { useAuth } from '../../src/lib/auth';
import { labelFor } from '../../src/lib/datetime';
import { color } from '../../src/theme/tokens';
import { useResponsive } from '../../src/theme/useResponsive';

/** Monday-first, matching the backend's Weekday choices (Monday = 0). */
const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const SLOT_LENGTHS = [15, 20, 30, 45, 60];
const BUFFERS = [0, 5, 10, 15];

/** "09:00:00" -> "9 AM" / "8:30 AM", the compact chip label in the mock. */
function prettyTime(value: string): string {
  const [rawHour, rawMinute] = value.split(':');
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${twelve} ${suffix}` : `${twelve}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export default function ProviderAvailabilityScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const { isDesktop } = useResponsive();

  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zone = user?.timezone ?? 'America/Los_Angeles';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rulePage, me] = await Promise.all([
        api.availability.list(),
        api.auth.myProviderProfile(),
      ]);
      setRules(rulePage.results);
      setProfile(me);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.detail : 'Could not load availability');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const byWeekday = useMemo(() => {
    const map = new Map<number, AvailabilityRule[]>();
    for (const rule of rules) {
      const list = map.get(rule.weekday);
      if (list) list.push(rule);
      else map.set(rule.weekday, [rule]);
    }
    return map;
  }, [rules]);

  /**
   * Turning a day off deletes its rules; turning it on restores a default
   * 9–5 window. The backend models availability as rows, not as a per-day
   * flag, so "off" is simply the absence of any window that day.
   */
  const toggleDay = async (weekday: number, on: boolean) => {
    const existing = byWeekday.get(weekday) ?? [];
    try {
      if (on) {
        const created = await api.availability.create({
          weekday,
          start_time: '09:00:00',
          end_time: '17:00:00',
          valid_from: new Date().toISOString().slice(0, 10),
          valid_until: null,
        });
        setRules((prev) => [...prev, created]);
      } else {
        await Promise.all(existing.map((rule) => api.availability.remove(rule.id)));
        setRules((prev) => prev.filter((rule) => rule.weekday !== weekday));
      }
    } catch (caught) {
      toast.show(
        caught instanceof ApiError ? caught.detail : 'Could not update that day',
      );
    }
  };

  const saveSlotRules = async (patch: Partial<ProviderProfile>) => {
    if (!profile) return;
    setSaving(true);
    try {
      setProfile(await api.auth.updateMyProviderProfile(patch));
      toast.show('Availability saved');
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.detail : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const slotRulesBlock = (
    <View style={isDesktop ? styles.rulesColumn : styles.rulesRow}>
      <Card style={styles.ruleCard}>
        <Label>Slot length</Label>
        <View style={styles.chipWrap}>
          {SLOT_LENGTHS.map((minutes) => (
            <Chip
              key={minutes}
              label={`${minutes} min`}
              selected={profile?.slot_duration_minutes === minutes}
              onPress={() => saveSlotRules({ slot_duration_minutes: minutes })}
            />
          ))}
        </View>
      </Card>
      <Card style={styles.ruleCard}>
        <Label>Buffer</Label>
        <View style={styles.chipWrap}>
          {BUFFERS.map((minutes) => (
            <Chip
              key={minutes}
              label={minutes === 0 ? 'None' : `${minutes} min`}
              selected={profile?.buffer_minutes === minutes}
              onPress={() => saveSlotRules({ buffer_minutes: minutes })}
            />
          ))}
        </View>
      </Card>
      <Card style={styles.ruleCard}>
        <Label>Accepting new patients</Label>
        <View style={styles.acceptingRow}>
          <Muted size={13}>
            {profile?.accepting_new_patients ? 'Open to new bookings' : 'Closed'}
          </Muted>
          <Toggle
            label="Accepting new patients"
            value={profile?.accepting_new_patients ?? false}
            onChange={(next) => saveSlotRules({ accepting_new_patients: next })}
          />
        </View>
      </Card>
    </View>
  );

  const dayRows = (
    <View style={styles.dayList}>
      {WEEKDAYS.map((name, weekday) => {
        const windows = byWeekday.get(weekday) ?? [];
        const on = windows.length > 0;
        return (
          <Card key={name} style={[styles.dayCard, !on && styles.dayCardOff]}>
            <View style={styles.dayHead}>
              <Strong size={14}>{name}</Strong>
              <Toggle
                label={`${name} availability`}
                value={on}
                onChange={(next) => toggleDay(weekday, next)}
              />
            </View>
            {on ? (
              <View style={styles.hourChips}>
                {windows.map((rule) => (
                  <View key={rule.id} style={styles.hourChip}>
                    <Semi size={12.5} style={{ color: color.chipText }}>
                      {prettyTime(rule.start_time)}–{prettyTime(rule.end_time)}
                    </Semi>
                  </View>
                ))}
              </View>
            ) : (
              <Muted size={12.5} style={styles.unavailable}>
                Unavailable
              </Muted>
            )}
          </Card>
        );
      })}
    </View>
  );

  const heading = (
    <>
      <Display size={isDesktop ? 32 : 24}>Your availability</Display>
      <Muted size={isDesktop ? 15 : 12.5} style={styles.subtitle}>
        Times in {labelFor(zone)}
      </Muted>
    </>
  );

  const content = loading ? (
    <View style={styles.loading}>
      <ActivityIndicator color={color.primary} />
    </View>
  ) : (
    <>
      {error ? (
        <Note tone="error" icon="⚠" style={styles.banner}>
          {error}
        </Note>
      ) : null}
      <Note tone="info" icon="🕓" style={styles.banner}>
        Hours are recurring weekly and stored as clinic-local wall time, so they
        stay put across daylight saving changes.
      </Note>
      {isDesktop ? (
        <View style={styles.twoColumn}>
          <View style={styles.leftColumn}>{slotRulesBlock}</View>
          <View style={styles.flex}>
            <Label style={styles.sectionLabel}>Weekly hours</Label>
            {dayRows}
          </View>
        </View>
      ) : (
        <>
          {slotRulesBlock}
          <Label style={styles.sectionLabel}>Weekly hours</Label>
          {dayRows}
        </>
      )}
    </>
  );

  if (isDesktop) {
    return (
      <AppCard>
        <TopNav items={PROVIDER_NAV} name={user?.full_name ?? 'You'} role="Provider" />
        <View style={styles.desktopBody}>
          {heading}
          {content}
        </View>
      </AppCard>
    );
  }

  return (
    <AppCard scroll={false}>
      <View style={styles.mobileHeader}>
        <Avatar
          initials={initialsFor(user?.full_name ?? 'You')}
          size={38}
          tint={tintFor(user?.full_name ?? 'You')}
        />
      </View>
      <ScrollView contentContainerStyle={styles.mobileBody}>
        {heading}
        {content}
      </ScrollView>
      <View style={styles.mobileFooter}>
        <PrimaryButton
          block
          size="lg"
          label={saving ? 'Saving…' : 'Done'}
          disabled={saving}
          onPress={() => toast.show('Availability saved')}
        />
      </View>
      <BottomTabs items={PROVIDER_NAV} name={user?.full_name ?? 'You'} />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  desktopBody: { paddingHorizontal: 40, paddingVertical: 34 },
  mobileHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  mobileBody: { paddingHorizontal: 20, paddingBottom: 24 },
  subtitle: { marginTop: 2 },
  banner: { marginTop: 18 },
  twoColumn: { flexDirection: 'row', gap: 28, marginTop: 24 },
  leftColumn: { width: 250 },
  rulesColumn: { gap: 12 },
  rulesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  ruleCard: { padding: 14, gap: 8, minWidth: 160, flexGrow: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  acceptingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionLabel: { marginTop: 18, marginBottom: 10 },
  dayList: { gap: 10 },
  dayCard: { padding: 14 },
  dayCardOff: { opacity: 0.55 },
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hourChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  hourChip: {
    backgroundColor: color.chipBg,
    borderWidth: 1,
    borderColor: color.chipBorder,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  unavailable: { marginTop: 8 },
  loading: { paddingVertical: 60, alignItems: 'center' },
  mobileFooter: {
    padding: 20,
    paddingTop: 14,
    backgroundColor: color.card,
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
  },
});
