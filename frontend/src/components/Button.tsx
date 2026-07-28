import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { color, font, radius, shadow } from '../theme/tokens';

type Props = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Fill the row rather than hugging the label. */
  block?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: ViewStyle;
};

const PAD = { sm: 10, md: 12, lg: 15 } as const;
const FONT = { sm: 13.5, md: 14, lg: 16 } as const;

/**
 * The primary CTA: a vertical teal gradient with a glow.
 *
 * Gradients are not a style property in RN, so this is a LinearGradient with
 * the Pressable wrapped around it. The handoff's inset highlight (a 1px light
 * line along the top edge) has no RN equivalent and is approximated by a hairline
 * View, which keeps the button from reading flat against the warm background.
 */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  block,
  size = 'md',
  style,
}: Props) {
  const [hovered, setHovered] = useState(false);

  if (disabled) {
    return (
      <View
        style={[
          styles.base,
          { paddingVertical: PAD[size], backgroundColor: color.disabledBg },
          block && styles.block,
          style,
        ]}
      >
        <Text style={[styles.label, { fontSize: FONT[size], color: color.disabledText }]}>
          {label}
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[block && styles.block, style]}
    >
      {({ pressed }) => (
        <LinearGradient
          colors={[color.ctaTop, color.ctaBottom]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[
            styles.base,
            shadow.cta,
            { paddingVertical: PAD[size], opacity: pressed ? 0.9 : hovered ? 0.94 : 1 },
          ]}
        >
          <View style={styles.insetHighlight} />
          <Text style={[styles.label, { fontSize: FONT[size], color: color.white }]}>
            {label}
          </Text>
        </LinearGradient>
      )}
    </Pressable>
  );
}

/** The bordered secondary action: "Add to calendar", "Reschedule", "Cancel". */
export function GhostButton({
  label,
  onPress,
  block,
  size = 'md',
  danger,
  style,
}: Props & { danger?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.base,
        styles.ghost,
        {
          paddingVertical: PAD[size],
          paddingHorizontal: block ? 0 : 18,
          borderColor: hovered ? color.borderDashed : color.borderField,
        },
        block && styles.block,
        style,
      ]}
    >
      <Text
        style={[
          styles.ghostLabel,
          { fontSize: FONT[size], color: danger ? color.dangerText : color.ink },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  block: { alignSelf: 'stretch', width: '100%' },
  label: { fontFamily: font.bold, textAlign: 'center' },
  ghost: {
    backgroundColor: color.card,
    borderWidth: 1,
  },
  ghostLabel: { fontFamily: font.semibold, textAlign: 'center' },
  insetHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: color.ctaInsetHighlight,
    opacity: 0.45,
  },
});
