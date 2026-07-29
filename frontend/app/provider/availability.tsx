import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import { api } from '../../src/api/endpoints';
import type { AvailabilityRule, ProviderProfile, TimeOff } from '../../src/api/types';
import { Avatar, Chip, initialsFor, Note, tintFor } from '../../src/components/Bits';
import { GhostButton } from '../../src/components/Button';
import { Toggle } from '../../src/components/Form';
import { BottomTabs, PROVIDER_NAV, TopNav } from '../../src/components/Nav';
import {
  dateOptions,
  OptionColumn,
  Sheet,
  timeOptions,
} from '../../src/components/Sheet';
import { AppCard, Card } from '../../src/components/Surface';
import { useToast } from '../../src/components/Toast';
import { Body, Display, Label, Muted, Semi, Strong } from '../../src/components/Typography';
import { useAuth } from '../../src/lib/auth';
import {
  formatDayDate,
  formatTime,
  labelFor,
  zonedTimeToUtc,
} from '../../src/lib/datetime';
import { CLINIC_TIMEZONE, color } from '../../src/theme/tokens';
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

const DEFAULT_START = '09:00:00';
const DEFAULT_END = '17:00:00';

/** "09:00:00" -> "9 AM" / "8:30 AM", the compact chip label in the mock. */
function prettyTime(value: string): string {
  const [rawHour, rawMinute] = value.split(':');
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0
    ? `${twelve} ${suffix}`
    : `${twelve}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/** What the window editor is currently working on. */
type WindowDraft = {
  weekday: number;
  /** Null when adding rather than editing. */
  rule: AvailabilityRule | null;
  start: string;
  end: string;
};

type TimeOffDraft = { date: string; start: string; end: string };

export default function ProviderAvailabilityScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const { isDesktop } = useResponsive();

  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [windowDraft, setWindowDraft] = useState<WindowDraft | null>(null);
  const [timeOffDraft, setTimeOffDraft] = useState<TimeOffDraft | null>(null);

  // The clinic's zone. Every time on this screen is entered and displayed in
  // it, so the provider never has to convert anything in their head.
  const zone = profile?.timezone ?? CLINIC_TIMEZONE;
  const times = useMemo(() => timeOptions(), []);
  const dates = useMemo(() => dateOptions(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rulePage, offPage, me] = await Promise.all([
        api.availability.list(),
        api.timeOff.list(),
        api.auth.myProviderProfile(),
      ]);
      setRules(rulePage.results);
      setTimeOff(offPage.results);
      setProfile(me);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.detail : 'Could not load your availability',
      );
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
    for (const list of map.values()) {
      list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    }
    return map;
  }, [rules]);

  // --- availability windows ------------------------------------------------

  const saveWindow = async () => {
    if (!windowDraft) return;
    const { weekday, rule, start, end } = windowDraft;
    try {
      if (rule) {
        const updated = await api.availability.update(rule.id, {
          start_time: start,
          end_time: end,
        });
        setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
      } else {
        const created = await api.availability.create({
          weekday,
          start_time: start,
          end_time: end,
          valid_from: todayKey(),
          valid_until: null,
        });
        setRules((prev) => [...prev, created]);
      }
      setWindowDraft(null);
      toast.show('Hours updated');
    } catch (caught) {
      toast.show(
        caught instanceof ApiError ? caught.detail : 'Could not save those hours',
      );
    }
  };

  const removeWindow = async () => {
    if (!windowDraft?.rule) return;
    const { id } = windowDraft.rule;
    try {
      await api.availability.remove(id);
      setRules((prev) => prev.filter((rule) => rule.id !== id));
      setWindowDraft(null);
      toast.show('Hours removed');
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.detail : 'Could not remove those hours');
    }
  };

  /**
   * Availability is modelled as rows, not a per-day flag, so "off" is simply
   * the absence of any window. Switching a day on opens the editor rather than
   * silently inventing 9-5, which was the old behaviour and gave providers no
   * say in their own hours.
   */
  const toggleDay = async (weekday: number, on: boolean) => {
    if (on) {
      setWindowDraft({ weekday, rule: null, start: DEFAULT_START, end: DEFAULT_END });
      return;
    }
    const existing = byWeekday.get(weekday) ?? [];
    try {
      await Promise.all(existing.map((rule) => api.availability.remove(rule.id)));
      setRules((prev) => prev.filter((rule) => rule.weekday !== weekday));
      toast.show(`${WEEKDAYS[weekday]} cleared`);
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.detail : 'Could not update that day');
    }
  };

  // --- time off ------------------------------------------------------------

  const saveTimeOff = async () => {
    if (!timeOffDraft) return;
    const { date, start, end } = timeOffDraft;
    try {
      const created = await api.timeOff.create({
        // Entered as wall-clock time where the provider is; stored as instants.
        start_at: zonedTimeToUtc(date, start, zone),
        end_at: zonedTimeToUtc(date, end, zone),
        reason: '',
      });
      setTimeOff((prev) => [created, ...prev]);
      setTimeOffDraft(null);
      toast.show('Time off added');
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.detail : 'Could not add that time off');
    }
  };

  const removeTimeOff = async (id: number) => {
    try {
      await api.timeOff.remove(id);
      setTimeOff((prev) => prev.filter((entry) => entry.id !== id));
      toast.show('Time off removed');
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.detail : 'Could not remove that');
    }
  };

  // --- blocks --------------------------------------------------------------

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
        <Label>Clinic time</Label>
        <Semi size={13.5}>{labelFor(zone)}</Semi>
        <Muted size={12} style={styles.zoneNote}>
          Your hours below are clinic hours. Change the timezone on your profile
          to read them somewhere else — it will not change when you work.
        </Muted>
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

  async function saveSlotRules(patch: Partial<ProviderProfile>) {
    if (!profile) return;
    try {
      setProfile(await api.auth.updateMyProviderProfile(patch));
      toast.show('Saved');
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.detail : 'Could not save');
    }
  }

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
            <View style={styles.hourChips}>
              {windows.map((rule) => (
                <Pressable
                  key={rule.id}
                  onPress={() =>
                    setWindowDraft({
                      weekday,
                      rule,
                      start: rule.start_time,
                      end: rule.end_time,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${name} ${prettyTime(
                    rule.start_time,
                  )} to ${prettyTime(rule.end_time)}`}
                  style={styles.hourChip}
                >
                  <Semi size={12.5} style={{ color: color.chipText }}>
                    {prettyTime(rule.start_time)}–{prettyTime(rule.end_time)}
                  </Semi>
                </Pressable>
              ))}
              <Pressable
                onPress={() =>
                  setWindowDraft({
                    weekday,
                    rule: null,
                    start: DEFAULT_START,
                    end: DEFAULT_END,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`Add hours on ${name}`}
                style={styles.addChip}
              >
                <Muted size={12.5}>+ Add hours</Muted>
              </Pressable>
            </View>
            {!on ? (
              <Muted size={12.5} style={styles.unavailable}>
                Unavailable
              </Muted>
            ) : null}
          </Card>
        );
      })}
    </View>
  );

  const timeOffBlock = (
    <View>
      <View style={styles.timeOffHead}>
        <Label>Time off</Label>
        <Pressable
          onPress={() =>
            setTimeOffDraft({ date: dates[0].value, start: '09:00:00', end: '17:00:00' })
          }
          accessibilityRole="button"
          accessibilityLabel="Add time off"
        >
          <Semi size={13} style={{ color: color.link }}>
            + Add a one-time date override
          </Semi>
        </Pressable>
      </View>
      {timeOff.length === 0 ? (
        <Card dashed style={styles.timeOffEmpty}>
          <Muted size={13}>
            No time off booked. Blocks added here remove slots from your week.
          </Muted>
        </Card>
      ) : (
        <View style={styles.timeOffList}>
          {timeOff.map((entry) => (
            <Card key={entry.id} style={styles.timeOffRow}>
              <View style={styles.flexShrink}>
                <Semi size={13.5}>{formatDayDate(entry.start_at, zone)}</Semi>
                <Muted size={12.5}>
                  {formatTime(entry.start_at, zone)} – {formatTime(entry.end_at, zone)}
                  {entry.reason ? ` · ${entry.reason}` : ''}
                </Muted>
              </View>
              <GhostButton
                size="sm"
                danger
                label="Remove"
                onPress={() => removeTimeOff(entry.id)}
              />
            </Card>
          ))}
        </View>
      )}
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
        Weekly hours are clock times at the clinic, so 9 AM stays 9 AM through
        daylight saving. Time off is a specific moment and does not shift.
      </Note>
      {isDesktop ? (
        <View style={styles.twoColumn}>
          <View style={styles.leftColumn}>{slotRulesBlock}</View>
          <View style={styles.flex}>
            <Label style={styles.sectionLabel}>Weekly hours</Label>
            {dayRows}
            <View style={styles.timeOffSection}>{timeOffBlock}</View>
          </View>
        </View>
      ) : (
        <>
          {slotRulesBlock}
          <Label style={styles.sectionLabel}>Weekly hours</Label>
          {dayRows}
          <View style={styles.timeOffSection}>{timeOffBlock}</View>
        </>
      )}
    </>
  );

  const sheets = (
    <>
      <Sheet
        visible={windowDraft !== null}
        title={windowDraft?.rule ? 'Edit hours' : 'Add hours'}
        subtitle={
          windowDraft ? `${WEEKDAYS[windowDraft.weekday]}, in ${labelFor(zone)}` : undefined
        }
        onClose={() => setWindowDraft(null)}
        primaryLabel="Save"
        onPrimary={saveWindow}
        primaryDisabled={!!windowDraft && windowDraft.end <= windowDraft.start}
        destructiveLabel={windowDraft?.rule ? 'Remove' : undefined}
        onDestructive={removeWindow}
      >
        <View style={styles.columns}>
          <OptionColumn
            label="Starts"
            options={times}
            value={windowDraft?.start ?? null}
            onChange={(start) =>
              setWindowDraft((draft) => (draft ? { ...draft, start } : draft))
            }
          />
          <OptionColumn
            label="Ends"
            options={times}
            value={windowDraft?.end ?? null}
            onChange={(end) =>
              setWindowDraft((draft) => (draft ? { ...draft, end } : draft))
            }
          />
        </View>
        {windowDraft && windowDraft.end <= windowDraft.start ? (
          <Body size={12.5} style={styles.validation}>
            The end time needs to be after the start time.
          </Body>
        ) : null}
      </Sheet>

      <Sheet
        visible={timeOffDraft !== null}
        title="Add time off"
        subtitle={`Blocks bookings for that period, in ${labelFor(zone)}`}
        onClose={() => setTimeOffDraft(null)}
        primaryLabel="Add"
        onPrimary={saveTimeOff}
        primaryDisabled={!!timeOffDraft && timeOffDraft.end <= timeOffDraft.start}
      >
        <View style={styles.columns}>
          <OptionColumn
            label="Date"
            options={dates}
            value={timeOffDraft?.date ?? null}
            onChange={(date) =>
              setTimeOffDraft((draft) => (draft ? { ...draft, date } : draft))
            }
          />
          <OptionColumn
            label="From"
            options={times}
            value={timeOffDraft?.start ?? null}
            onChange={(start) =>
              setTimeOffDraft((draft) => (draft ? { ...draft, start } : draft))
            }
          />
          <OptionColumn
            label="Until"
            options={times}
            value={timeOffDraft?.end ?? null}
            onChange={(end) =>
              setTimeOffDraft((draft) => (draft ? { ...draft, end } : draft))
            }
          />
        </View>
        {timeOffDraft && timeOffDraft.end <= timeOffDraft.start ? (
          <Body size={12.5} style={styles.validation}>
            The end time needs to be after the start time.
          </Body>
        ) : null}
      </Sheet>
    </>
  );

  if (isDesktop) {
    return (
      <>
        <AppCard>
          <TopNav items={PROVIDER_NAV} name={user?.full_name ?? 'You'} role="Provider" />
          <View style={styles.desktopBody}>
            {heading}
            {content}
          </View>
        </AppCard>
        {sheets}
      </>
    );
  }

  return (
    <>
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
        <BottomTabs items={PROVIDER_NAV} />
      </AppCard>
      {sheets}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
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
  dayCardOff: { opacity: 0.62 },
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
  addChip: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.borderDashed,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  unavailable: { marginTop: 8 },
  timeOffSection: { marginTop: 28 },
  timeOffHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 12,
  },
  timeOffEmpty: { paddingVertical: 20, alignItems: 'center' },
  timeOffList: { gap: 8 },
  timeOffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    gap: 12,
  },
  loading: { paddingVertical: 60, alignItems: 'center' },
  columns: { flexDirection: 'row', gap: 10 },
  zoneNote: { lineHeight: 17 },
  validation: { color: color.errorText, marginTop: 10 },
});
