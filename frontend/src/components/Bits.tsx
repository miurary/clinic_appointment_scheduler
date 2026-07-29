import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import {
  avatarTint,
  type AvatarTintName,
  color,
  font,
  radius,
  shadow,
} from '../theme/tokens';
import { Body, Label, Semi } from './Typography';

/** Colored initials circle. */
export function Avatar({
  initials,
  size = 40,
  tint = 'teal',
}: {
  initials: string;
  size?: number;
  tint?: AvatarTintName;
}) {
  const palette = avatarTint[tint];
  return (
    <View
      style={[
        styles.center,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette.bg,
        },
      ]}
    >
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: size * 0.32,
          color: palette.fg,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}

/**
 * Deterministic tint per person, so the same patient is always the same colour
 * across the schedule and the day list rather than shuffling on every render.
 */
const TINTS: AvatarTintName[] = ['amber', 'teal', 'coral', 'violet', 'green'];

export function tintFor(seed: string): AvatarTintName {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length];
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type PillTone = 'success' | 'amber' | 'neutral';

const PILL: Record<PillTone, { bg: string; fg: string }> = {
  success: { bg: color.successBg, fg: color.successText },
  amber: { bg: color.amberBg, fg: color.amberText },
  neutral: { bg: color.neutralBg, fg: color.neutralText },
};

/** Status pill: Confirmed / Checked in (green), Arriving (amber), Scheduled. */
export function StatusPill({
  label,
  tone = 'neutral',
  size = 12,
}: {
  label: string;
  tone?: PillTone;
  size?: number;
}) {
  const palette = PILL[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={{ fontFamily: font.bold, fontSize: size, color: palette.fg }}>
        {label}
      </Text>
    </View>
  );
}

/** The rounded gradient square + wordmark. No raster asset in the handoff. */
export function BrandMark({
  size = 22,
  label = 'Kivo Health',
  labelSize = 17,
  onDark = false,
  badge,
}: {
  size?: number;
  label?: string | null;
  labelSize?: number;
  onDark?: boolean;
  badge?: string;
}) {
  return (
    <View style={styles.row}>
      {onDark ? (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: radius.brandMark,
            backgroundColor: color.brandPanelMark,
          }}
        />
      ) : (
        <LinearGradient
          colors={[color.brandMarkTop, color.brandMarkBottom]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            shadow.brandMark,
            { width: size, height: size, borderRadius: radius.brandMark },
          ]}
        />
      )}
      {label ? (
        <Text
          style={{
            fontFamily: font.bold,
            fontSize: labelSize,
            color: onDark ? color.brandPanelText : color.ink,
          }}
        >
          {label}
        </Text>
      ) : null}
      {badge ? (
        <View style={styles.roleBadge}>
          <Text style={{ fontFamily: font.body, fontSize: 11, color: color.inkSubtle }}>
            {badge}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

type NoteTone = 'info' | 'error' | 'warn';

const NOTE: Record<NoteTone, { bg: string; border: string; fg: string }> = {
  info: { bg: color.tintBg, border: color.tintBorder, fg: color.tintText },
  error: { bg: color.errorBg, border: color.errorBorder, fg: color.errorText },
  warn: { bg: color.warnBg, border: color.warnBorder, fg: color.warnText },
};

/** The tinted banners: timezone note, race error, rescheduling notice. */
export function Note({
  children,
  tone = 'info',
  icon,
  action,
  style,
}: {
  children: React.ReactNode;
  tone?: NoteTone;
  icon?: string;
  action?: React.ReactNode;
  style?: ViewStyle;
}) {
  const palette = NOTE[tone];
  return (
    <View
      style={[
        styles.note,
        { backgroundColor: palette.bg, borderColor: palette.border },
        style,
      ]}
    >
      <View style={styles.noteBody}>
        {icon ? (
          <Text style={{ fontSize: 13, color: palette.fg }} accessibilityElementsHidden>
            {icon}
          </Text>
        ) : null}
        <Text style={[styles.noteText, { color: palette.fg }]}>{children}</Text>
      </View>
      {action}
    </View>
  );
}

/** A labelled key/value row, used through the review and detail cards. */
export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Body style={{ color: color.inkMuted }}>{label}</Body>
      <Semi>{value}</Semi>
    </View>
  );
}

/** Selectable filter chip: visit type, provider, timezone. */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text
        style={{
          fontFamily: font.semibold,
          fontSize: 13,
          color: selected ? color.chipText : color.inkBody,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Section heading: the 11px uppercase hairline label. */
export function SectionLabel({ children, style }: { children: string; style?: ViewStyle }) {
  return <Label style={style as never}>{children}</Label>;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  roleBadge: {
    backgroundColor: color.tanPanel,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  note: {
    borderWidth: 1,
    borderRadius: radius.chip,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  noteBody: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  noteText: { fontFamily: font.body, fontSize: 13, flexShrink: 1, lineHeight: 19 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  chip: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.borderField,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipSelected: {
    backgroundColor: color.chipBg,
    borderColor: color.chipBorder,
  },
});
