import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ApiError } from '../src/api/client';
import { api } from '../src/api/endpoints';
import type { PatientProfile } from '../src/api/types';
import { Avatar, Chip, DetailRow, initialsFor, tintFor } from '../src/components/Bits';
import { GhostButton } from '../src/components/Button';
import { OptionColumn, Sheet } from '../src/components/Sheet';
import {
  BottomTabs,
  PATIENT_NAV,
  PROVIDER_NAV,
  TopNav,
} from '../src/components/Nav';
import { AppCard, Card } from '../src/components/Surface';
import { useToast } from '../src/components/Toast';
import { Display, Label, Muted, Strong } from '../src/components/Typography';
import { useAuth } from '../src/lib/auth';
import { labelFor } from '../src/lib/datetime';
import { TIMEZONES } from '../src/theme/tokens';
import { useResponsive } from '../src/theme/useResponsive';

export default function ProfileScreen() {
  const router = useRouter();
  const toast = useToast();
  const { isDesktop } = useResponsive();
  const { user, signOut, refreshUser } = useAuth();

  const nav = user?.role === 'provider' ? PROVIDER_NAV : PATIENT_NAV;
  const name = user?.full_name ?? 'You';
  const isPatient = user?.role === 'patient';

  const [patientProfile, setPatientProfile] = useState<PatientProfile | null>(null);
  const [dobDraft, setDobDraft] = useState<{
    year: number;
    month: number;
    day: number;
  } | null>(null);

  // Only patients have this record; providers would get a 403.
  useFocusEffect(
    useCallback(() => {
      if (!isPatient) return;
      api.auth
        .myPatientProfile()
        .then(setPatientProfile)
        .catch(() => setPatientProfile(null));
    }, [isPatient]),
  );

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 110 }, (_, i) => {
      const year = current - i;
      return { value: year, label: String(year) };
    });
  }, []);

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        value: i + 1,
        label: new Intl.DateTimeFormat('en-US', { month: 'long' }).format(
          new Date(2000, i, 1),
        ),
      })),
    [],
  );

  /** Day count follows the chosen month and year, so February behaves. */
  const days = useMemo(() => {
    const year = dobDraft?.year ?? 2000;
    const month = dobDraft?.month ?? 1;
    const count = new Date(year, month, 0).getDate();
    return Array.from({ length: count }, (_, i) => ({
      value: i + 1,
      label: String(i + 1),
    }));
  }, [dobDraft?.year, dobDraft?.month]);

  const openDobSheet = () => {
    const existing = patientProfile?.date_of_birth;
    if (existing) {
      const [year, month, day] = existing.split('-').map(Number);
      setDobDraft({ year, month, day });
    } else {
      setDobDraft({ year: 1990, month: 1, day: 1 });
    }
  };

  const saveDob = async () => {
    if (!dobDraft) return;
    const value = `${dobDraft.year}-${String(dobDraft.month).padStart(2, '0')}-${String(
      // Clamp: switching from the 31st to February would otherwise send an
      // impossible date.
      Math.min(dobDraft.day, days.length),
    ).padStart(2, '0')}`;
    try {
      setPatientProfile(await api.auth.updateMyPatientProfile({ date_of_birth: value }));
      setDobDraft(null);
      toast.show('Date of birth saved');
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.detail : 'Could not save that');
    }
  };

  const changeTimezone = async (timezone: string) => {
    try {
      await api.auth.updateMe({ timezone });
      await refreshUser();
      toast.show(`Times now shown in ${labelFor(timezone)}`);
    } catch {
      toast.show('Could not update your timezone');
    }
  };

  const onSignOut = async () => {
    await signOut();
    router.replace('/sign-in');
  };

  const body = (
    <>
      <Display size={isDesktop ? 32 : 26}>Your profile</Display>

      <Card style={styles.card}>
        <View style={styles.identity}>
          <Avatar initials={initialsFor(name)} size={52} tint={tintFor(name)} />
          <View style={styles.flexShrink}>
            <Strong size={16}>{name}</Strong>
            <Muted size={13}>{user?.email}</Muted>
          </View>
        </View>
        <View style={styles.rows}>
          <DetailRow
            label="Role"
            value={user?.role === 'provider' ? 'Provider' : 'Patient'}
          />
          <DetailRow label="Timezone" value={labelFor(user?.timezone ?? '')} />
          {isPatient ? (
            <View style={styles.dobRow}>
              <Muted size={14}>Date of birth</Muted>
              <GhostButton
                size="sm"
                label={patientProfile?.date_of_birth ?? 'Add'}
                onPress={openDobSheet}
              />
            </View>
          ) : null}
        </View>
      </Card>

      <Label style={styles.sectionLabel}>Show times in</Label>
      <Muted size={13} style={styles.note}>
        A display preference only — it never changes when an appointment
        actually happens.
      </Muted>
      <View style={styles.chipRow}>
        {TIMEZONES.map((zone) => (
          <Chip
            key={zone.id}
            label={zone.label}
            selected={user?.timezone === zone.id}
            onPress={() => changeTimezone(zone.id)}
          />
        ))}
      </View>

      <GhostButton
        label="Sign out"
        danger
        onPress={onSignOut}
        style={styles.signOut}
      />
    </>
  );

  const dobSheet = (
    <Sheet
      visible={dobDraft !== null}
      title="Date of birth"
      subtitle="Used by the clinic to match you to your records."
      onClose={() => setDobDraft(null)}
      primaryLabel="Save"
      onPrimary={saveDob}
    >
      <View style={styles.columns}>
        <OptionColumn
          label="Year"
          options={years}
          value={dobDraft?.year ?? null}
          onChange={(year) => setDobDraft((d) => (d ? { ...d, year } : d))}
        />
        <OptionColumn
          label="Month"
          options={months}
          value={dobDraft?.month ?? null}
          onChange={(month) => setDobDraft((d) => (d ? { ...d, month } : d))}
        />
        <OptionColumn
          label="Day"
          options={days}
          value={dobDraft?.day ?? null}
          onChange={(day) => setDobDraft((d) => (d ? { ...d, day } : d))}
        />
      </View>
    </Sheet>
  );

  if (isDesktop) {
    return (
      <>
        <AppCard maxWidth={720}>
          <TopNav
            items={nav}
            name={name}
            role={user?.role === 'provider' ? 'Provider' : undefined}
          />
          <View style={styles.desktopBody}>{body}</View>
        </AppCard>
        {dobSheet}
      </>
    );
  }

  return (
    <>
      <AppCard scroll={false}>
        <ScrollView contentContainerStyle={styles.mobileBody}>{body}</ScrollView>
        <BottomTabs items={nav} />
      </AppCard>
      {dobSheet}
    </>
  );
}

const styles = StyleSheet.create({
  flexShrink: { flexShrink: 1 },
  desktopBody: { paddingHorizontal: 40, paddingVertical: 34 },
  mobileBody: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 },
  card: { marginTop: 20, padding: 22 },
  identity: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  rows: { marginTop: 18, gap: 12 },
  sectionLabel: { marginTop: 28 },
  note: { marginTop: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  signOut: { marginTop: 32, alignSelf: 'flex-start' },
  dobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  columns: { flexDirection: 'row', gap: 10 },
});
