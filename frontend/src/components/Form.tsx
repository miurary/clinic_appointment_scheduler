import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { color, font, radius } from '../theme/tokens';
import { Label } from './Typography';

type FieldProps = TextInputProps & {
  label: string;
  /** Rendered to the right of the label, e.g. the "Forgot?" link. */
  accessory?: React.ReactNode;
  error?: string;
};

/**
 * A labelled text input. The mock shows fields as static divs; these are real
 * inputs wearing that styling, with the platform keyboard hints the mock had
 * no way to express.
 */
export function Field({ label, accessory, error, style, ...rest }: FieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Label>{label}</Label>
        {accessory}
      </View>
      <TextInput
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        placeholderTextColor={color.inkFaint}
        style={[
          styles.input,
          focused && styles.inputFocused,
          !!error && styles.inputError,
          style,
        ]}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

/**
 * The Patient / Provider segmented toggle. Hugs its content on desktop and
 * fills the row on mobile, matching D1 and M1.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  block,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  block?: boolean;
}) {
  return (
    <View style={[styles.segment, block && styles.segmentBlock]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[
              styles.segmentItem,
              block && styles.segmentItemBlock,
              selected && styles.segmentItemSelected,
            ]}
          >
            <Text
              style={[styles.segmentLabel, { color: selected ? color.ink : '#8a8175' }]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The on/off switch on provider availability rows. */
export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={[styles.track, { backgroundColor: value ? color.primary : '#d9d2c6' }]}
    >
      <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  input: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.borderField,
    borderRadius: radius.field,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontFamily: font.body,
    fontSize: 14.5,
    color: color.ink,
  },
  inputFocused: { borderColor: color.chipBorder },
  inputError: { borderColor: color.errorBorder },
  errorText: { fontFamily: font.body, fontSize: 12.5, color: color.errorText },
  segment: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: color.segmentTrack,
    borderWidth: 1,
    borderColor: color.borderSegment,
    borderRadius: radius.field,
    padding: 4,
    alignSelf: 'flex-start',
  },
  segmentBlock: { alignSelf: 'stretch' },
  segmentItem: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  segmentItemBlock: { flex: 1, alignItems: 'center', paddingHorizontal: 0, paddingVertical: 9 },
  segmentItemSelected: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.borderField,
  },
  segmentLabel: { fontFamily: font.semibold, fontSize: 13.5 },
  track: {
    width: 38,
    height: 22,
    borderRadius: radius.pill,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  knob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: color.white,
  },
  knobOn: { alignSelf: 'flex-end' },
  knobOff: { alignSelf: 'flex-start' },
});
