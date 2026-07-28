import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { api } from '../src/api/endpoints';
import { Avatar, Chip, DetailRow, initialsFor, tintFor } from '../src/components/Bits';
import { GhostButton } from '../src/components/Button';
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

  if (isDesktop) {
    return (
      <AppCard maxWidth={720}>
        <TopNav
          items={nav}
          name={name}
          role={user?.role === 'provider' ? 'Provider' : undefined}
        />
        <View style={styles.desktopBody}>{body}</View>
      </AppCard>
    );
  }

  return (
    <AppCard scroll={false}>
      <ScrollView contentContainerStyle={styles.mobileBody}>{body}</ScrollView>
      <BottomTabs items={nav} name={name} />
    </AppCard>
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
});
