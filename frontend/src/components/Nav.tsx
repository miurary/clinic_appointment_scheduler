import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font, radius } from '../theme/tokens';
import { Avatar, BrandMark, initialsFor, tintFor } from './Bits';

export type NavItem = { label: string; href: string; icon: string };

export const PATIENT_NAV: NavItem[] = [
  { label: 'Appointments', href: '/dashboard', icon: '◉' },
  { label: 'Book', href: '/book', icon: '＋' },
  { label: 'Messages', href: '/messages', icon: '✉' },
];

export const PROVIDER_NAV: NavItem[] = [
  { label: 'Today', href: '/provider', icon: '◉' },
  { label: 'Schedule', href: '/provider/schedule', icon: '▦' },
  { label: 'Availability', href: '/provider/availability', icon: '🕓' },
];

/** Desktop: the app card's top bar — brand left, links and avatar right. */
export function TopNav({
  items,
  name,
  role,
}: {
  items: NavItem[];
  name: string;
  role?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View style={styles.topNav}>
      <BrandMark badge={role} />
      <View style={styles.topLinks}>
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Pressable
              key={item.href}
              onPress={() => router.push(item.href as never)}
              accessibilityRole="link"
              accessibilityState={{ selected: active }}
              style={active ? styles.topLinkActive : undefined}
            >
              <Text style={[styles.topLink, active && styles.topLinkActiveText]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
        <Avatar initials={initialsFor(name)} size={34} tint={tintFor(name)} />
      </View>
    </View>
  );
}

/** Mobile: the fixed bottom tab bar (M5, M6, M8). */
export function BottomTabs({
  items,
  name,
}: {
  items: NavItem[];
  name: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const tabs = [...items, { label: 'Profile', href: '/profile', icon: '◑' }];

  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Pressable
            key={tab.href}
            onPress={() => router.push(tab.href as never)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            style={styles.tab}
          >
            <Text style={[styles.tabIcon, active && styles.tabActive]}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, active && styles.tabActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Mobile: the back / title / avatar header on pushed screens (M2, M3). */
export function MobileHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.mobileHeader}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backButton}
        >
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
      ) : (
        <View style={styles.backButton} />
      )}
      <Text style={styles.mobileTitle}>{title}</Text>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

/**
 * `/provider` must not light up while on `/provider/schedule`, so the index
 * route matches exactly and the others match by prefix.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === '/provider' || href === '/dashboard') return pathname === href;
  return pathname.startsWith(href);
}

const styles = StyleSheet.create({
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: color.borderSoft,
    backgroundColor: color.card,
  },
  topLinks: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  topLink: { fontFamily: font.body, fontSize: 14, color: color.inkBody },
  topLinkActive: {
    borderBottomWidth: 2,
    borderBottomColor: color.primary,
    paddingBottom: 2,
  },
  topLinkActiveText: { fontFamily: font.semibold, color: color.ink },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: color.card,
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    paddingTop: 12,
    paddingBottom: 26,
  },
  tab: { alignItems: 'center', gap: 2 },
  tabIcon: { fontSize: 18, color: color.inkFaint },
  tabLabel: { fontFamily: font.body, fontSize: 11, color: color.inkFaint },
  tabActive: { color: color.link, fontFamily: font.semibold },
  mobileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.borderSoft,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.borderField,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backChevron: { fontSize: 18, color: color.inkStrong, lineHeight: 20 },
  mobileTitle: { fontFamily: font.bold, fontSize: 16, color: color.ink },
  headerRight: { width: 38, alignItems: 'flex-end' },
});
