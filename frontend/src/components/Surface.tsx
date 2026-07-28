import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { color, radius, shadow, space } from '../theme/tokens';
import { useResponsive } from '../theme/useResponsive';
import { FadeUp } from './FadeUp';

/**
 * The warm page wash. The handoff uses a radial gradient; RN's LinearGradient
 * has no radial mode, so this approximates it with a vertical three-stop ramp
 * running light-to-dark, which reads the same at page scale.
 */
export function PageBackground({ children }: { children: ReactNode }) {
  return (
    <LinearGradient
      colors={[color.pageTop, color.pageMid, color.pageBottom]}
      locations={[0, 0.55, 1]}
      style={styles.page}
    >
      {children}
    </LinearGradient>
  );
}

/**
 * The desktop "app card" — the whole screen inside one rounded, shadowed
 * surface, capped at the handoff's 1160px canvas. On mobile it drops the
 * chrome entirely: the phone screen IS the surface, so a card inside it would
 * be a card inside a card.
 */
export function AppCard({
  children,
  scroll = true,
  maxWidth = 1160,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  maxWidth?: number;
  contentStyle?: ViewStyle;
}) {
  const { isDesktop } = useResponsive();

  const surface = isDesktop ? (
    <FadeUp style={[styles.appCard, shadow.card, { maxWidth }, contentStyle]}>
      {children}
    </FadeUp>
  ) : (
    <FadeUp style={[styles.mobileSurface, contentStyle]}>{children}</FadeUp>
  );

  if (!scroll) {
    return (
      <PageBackground>
        <View style={isDesktop ? styles.desktopPad : styles.mobilePad}>{surface}</View>
      </PageBackground>
    );
  }

  return (
    <PageBackground>
      <ScrollView
        contentContainerStyle={isDesktop ? styles.desktopPad : styles.mobilePad}
        showsVerticalScrollIndicator={false}
      >
        {surface}
      </ScrollView>
    </PageBackground>
  );
}

/** An inner content card: provider summary, review details, stat tiles. */
export function Card({
  children,
  style,
  accent,
  dashed,
}: {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** The teal left border on the upcoming-appointment card. */
  accent?: boolean;
  /** The dashed empty-state treatment. */
  dashed?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        dashed && styles.cardDashed,
        accent && styles.cardAccent,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * A hairline-separated list. The handoff builds these with a 1px gap over a
 * border-coloured background, so the "borders" are the parent showing through.
 */
export function RowGroup({ children }: { children: ReactNode }) {
  return <View style={styles.rowGroup}>{children}</View>;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  desktopPad: {
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 64,
    alignItems: 'center',
  },
  mobilePad: { flexGrow: 1 },
  appCard: {
    width: '100%',
    backgroundColor: color.appSurface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.appCard,
    overflow: 'hidden',
  },
  mobileSurface: { flex: 1, backgroundColor: color.appSurface },
  card: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.card,
    padding: space.lg,
  },
  cardDashed: {
    borderStyle: 'dashed',
    borderColor: color.borderDashed,
  },
  cardAccent: {
    borderLeftWidth: 4,
    borderLeftColor: color.primary,
  },
  rowGroup: {
    gap: 1,
    backgroundColor: color.borderSoft,
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.cardSm,
    overflow: 'hidden',
  },
});
