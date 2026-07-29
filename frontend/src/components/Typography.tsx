import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { color, font } from '../theme/tokens';

type Props = TextProps & { style?: TextStyle | TextStyle[] };

/**
 * RN has no cascading font inheritance and no implicit text nodes: every run
 * of text needs its own <Text> carrying its own family. Wrapping the handoff's
 * type ramp in named components keeps that from becoming a styling free-for-all.
 */

/** Newsreader 500. Page and section headings, greetings, big numbers. */
export function Display({ size = 30, style, ...rest }: Props & { size?: number }) {
  return <Text {...rest} style={[styles.display, { fontSize: size }, style]} />;
}

export function Body({ size = 14, style, ...rest }: Props & { size?: number }) {
  return <Text {...rest} style={[styles.body, { fontSize: size }, style]} />;
}

export function Muted({ size = 14, style, ...rest }: Props & { size?: number }) {
  return <Text {...rest} style={[styles.muted, { fontSize: size }, style]} />;
}

export function Strong({ size = 14, style, ...rest }: Props & { size?: number }) {
  return <Text {...rest} style={[styles.strong, { fontSize: size }, style]} />;
}

export function Semi({ size = 14, style, ...rest }: Props & { size?: number }) {
  return <Text {...rest} style={[styles.semi, { fontSize: size }, style]} />;
}

/**
 * The 11px uppercase hairline label. letterSpacing is a number in RN, not the
 * CSS `.14em`, so it is computed from the size to stay proportional.
 */
export function Label({ size = 11, style, ...rest }: Props & { size?: number }) {
  return (
    <Text
      {...rest}
      style={[styles.label, { fontSize: size, letterSpacing: size * 0.14 }, style]}
    />
  );
}

export function Link({ size = 13.5, style, ...rest }: Props & { size?: number }) {
  return <Text {...rest} style={[styles.link, { fontSize: size }, style]} />;
}

const styles = StyleSheet.create({
  display: {
    fontFamily: font.display,
    color: color.ink,
    // The handoff's -.01em tracking on large serif headings.
    letterSpacing: -0.3,
  },
  body: { fontFamily: font.body, color: color.ink },
  muted: { fontFamily: font.body, color: color.inkMuted },
  strong: { fontFamily: font.bold, color: color.ink },
  semi: { fontFamily: font.semibold, color: color.ink },
  label: {
    fontFamily: font.semibold,
    color: color.inkFaint,
    textTransform: 'uppercase',
  },
  link: { fontFamily: font.semibold, color: color.link },
});
