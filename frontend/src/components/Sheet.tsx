import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { color, font, radius, shadow } from '../theme/tokens';
import { GhostButton, PrimaryButton } from './Button';
import { Body, Display, Label, Muted, Semi } from './Typography';

/**
 * A centred modal card, used for every picker in the app.
 *
 * RN's Modal renders above everything on native and as a fixed overlay on web,
 * so one component covers both. Nothing here nests modals -- pickers are
 * columns inside a single sheet rather than a sheet that opens another sheet,
 * which on native is unreliable and on web traps focus badly.
 */
export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  destructiveLabel,
  onDestructive,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  destructiveLabel?: string;
  onDestructive?: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/* Tapping the scrim dismisses, matching every other sheet on both
          platforms. The card stops the press so taps inside do not close it. */}
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={[styles.card, shadow.card]} onPress={() => {}}>
          <Display size={22}>{title}</Display>
          {subtitle ? (
            <Muted size={13} style={styles.subtitle}>
              {subtitle}
            </Muted>
          ) : null}

          <View style={styles.body}>{children}</View>

          <View style={styles.actions}>
            {destructiveLabel ? (
              <GhostButton
                danger
                size="sm"
                label={destructiveLabel}
                onPress={onDestructive}
              />
            ) : null}
            <View style={styles.spacer} />
            <GhostButton size="sm" label="Cancel" onPress={onClose} />
            {primaryLabel ? (
              <PrimaryButton
                size="sm"
                label={primaryLabel}
                onPress={onPrimary}
                disabled={primaryDisabled}
                style={styles.primary}
              />
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export type Option<T> = { value: T; label: string; sublabel?: string };

/**
 * A scrollable single-select column. Several sit side by side to build a
 * date/start/end editor without nesting modals.
 */
export function OptionColumn<T extends string | number>({
  label,
  options,
  value,
  onChange,
  height = 210,
}: {
  label: string;
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  height?: number;
}) {
  return (
    <View style={styles.column}>
      <Label style={styles.columnLabel}>{label}</Label>
      <ScrollView
        style={[styles.list, { height }]}
        showsVerticalScrollIndicator={false}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              onPress={() => onChange(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Semi
                size={13.5}
                style={{ color: selected ? color.chipText : color.ink }}
              >
                {option.label}
              </Semi>
              {option.sublabel ? (
                <Body size={11.5} style={{ color: color.inkFaint }}>
                  {option.sublabel}
                </Body>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(38,34,29,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: color.appSurface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.appCard,
    padding: 24,
  },
  subtitle: { marginTop: 4 },
  body: { marginTop: 18 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 22,
  },
  spacer: { flex: 1 },
  primary: {},
  column: { flex: 1 },
  columnLabel: { marginBottom: 6 },
  list: {
    borderWidth: 1,
    borderColor: color.borderField,
    borderRadius: radius.chip,
    backgroundColor: color.card,
  },
  option: { paddingHorizontal: 12, paddingVertical: 10 },
  optionSelected: { backgroundColor: color.chipBg },
});

/** Every quarter hour from 06:00 to 21:45, as "HH:MM:SS" values. */
export function timeOptions(): Option<string>[] {
  const options: Option<string>[] = [];
  for (let minutes = 6 * 60; minutes <= 21 * 60 + 45; minutes += 15) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    options.push({
      value,
      label: `${twelve}:${String(minute).padStart(2, '0')} ${suffix}`,
    });
  }
  return options;
}

const monthDay = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/** The next `count` calendar days, for picking a time-off date. */
export function dateOptions(count = 60): Option<string>[] {
  const options: Option<string>[] = [];
  const today = new Date();
  for (let offset = 0; offset < count; offset += 1) {
    const day = new Date(today);
    day.setDate(day.getDate() + offset);
    const year = day.getFullYear();
    const month = String(day.getMonth() + 1).padStart(2, '0');
    const date = String(day.getDate()).padStart(2, '0');
    options.push({
      value: `${year}-${month}-${date}`,
      label: monthDay.format(day),
    });
  }
  return options;
}
