import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { color, font, radius, shadow } from '../theme/tokens';

type Props = {
  time: string;
  selected?: boolean;
  /** Taken out from under the patient mid-flow: struck through, unpickable. */
  taken?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  /** Mobile slots are ≥44px tall to stay a comfortable tap target. */
  large?: boolean;
};

/**
 * The core booking control, in the handoff's three states:
 *   default   card background, hairline border
 *   selected  teal gradient, white label, glow
 *   taken     struck through and muted — shown, not removed, so the patient
 *             can see what happened to the slot they had picked
 */
export function SlotButton({ time, selected, taken, onPress, style, large }: Props) {
  const [hovered, setHovered] = useState(false);
  const padding = large ? 14 : 11;
  const fontSize = large ? 15 : 13.5;

  if (selected) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" style={style}>
        <LinearGradient
          colors={[color.ctaTop, color.ctaBottom]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[styles.base, shadow.slotSelected, { paddingVertical: padding }]}
        >
          <Text style={[styles.label, { fontSize, color: color.white }]}>{time}</Text>
        </LinearGradient>
      </Pressable>
    );
  }

  if (taken) {
    return (
      <Pressable
        disabled
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        accessibilityLabel={`${time}, no longer available`}
        style={[styles.base, styles.taken, { paddingVertical: padding }, style]}
      >
        <Text style={[styles.label, styles.takenLabel, { fontSize }]}>{time}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={`Book ${time}`}
      style={[
        styles.base,
        styles.default,
        { paddingVertical: padding, borderColor: hovered ? color.chipBorder : color.borderField },
        style,
      ]}
    >
      <Text style={[styles.label, { fontSize, color: color.ink }]}>{time}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  default: {
    backgroundColor: color.card,
    borderWidth: 1,
  },
  taken: {
    backgroundColor: color.tanPanel,
    borderWidth: 1,
    borderColor: color.borderSoft,
  },
  label: { fontFamily: font.semibold },
  takenLabel: {
    color: color.inkFaint,
    textDecorationLine: 'line-through',
  },
});
