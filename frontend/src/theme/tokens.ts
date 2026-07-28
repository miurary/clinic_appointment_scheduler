/**
 * Design tokens from the Kivo handoff ("Clinical Calm", Direction 1a).
 *
 * The handoff specifies its teal/status palette in OKLCH, which React Native
 * cannot parse. Every OKLCH value has been converted through OKLab -> linear
 * sRGB -> gamma-encoded sRGB; the original is kept in a comment so a designer
 * can check the conversion rather than take it on faith.
 */

export const color = {
  // Ink
  ink: '#26221d',
  inkMuted: '#7a7266',
  inkFaint: '#9a9184',
  inkSubtle: '#8a8175',
  inkBody: '#6f685d',
  inkStrong: '#5f584d',

  // Surfaces
  appSurface: '#faf8f5',
  card: '#fffdfa',
  tanPanel: '#f3efe8',
  gridWorking: '#f7f3ec',
  gridBlocked: '#efe9e0',
  segmentTrack: '#f0ece4',

  // Page background stops (radial in CSS, vertical gradient here)
  pageTop: '#f2eee8',
  pageMid: '#e6e1d9',
  pageBottom: '#ddd8cf',

  // Borders
  border: '#e7e2da',
  borderSoft: '#ece7df',
  borderField: '#e2dcd2',
  borderDashed: '#d5cdbf',
  borderSegment: '#e5dfd5',

  // Primary teal — oklch(0.62 0.08 195)
  primary: '#429595',
  // CTA gradient — oklch(0.61 0.095 195) -> oklch(0.515 0.09 195)
  ctaTop: '#259595',
  ctaBottom: '#007777',
  // inset 0 1px 0 oklch(0.78 0.06 195 / .45)
  ctaInsetHighlight: '#8ac4c3',
  // Brand mark — oklch(0.68 0.085 195) -> oklch(0.555 0.085 195)
  brandMarkTop: '#50a9a8',
  brandMarkBottom: '#238282',
  // Marketing panel — oklch(0.47 0.07 197) -> oklch(0.35 0.055 205)
  brandPanelTop: '#1d6768',
  brandPanelBottom: '#0b4348',
  brandPanelMark: '#57b6b6',
  brandPanelText: '#eaf3f0',
  brandPanelBody: '#c3ddd6',
  brandPanelFaint: '#a7cabf',

  link: '#157171', // oklch(0.5 0.08 195)

  // Teal tints
  tintBg: '#e3f6f6', // oklch(0.96 0.02 195)
  tintBorder: '#bae0e0', // oklch(0.88 0.04 195)
  tintText: '#4a6a63',
  chipBg: '#d5f2f1', // oklch(0.94 0.03 195)
  chipBorder: '#acdcdb', // oklch(0.86 0.05 195)
  chipText: '#3d6b62',
  rowHighlight: '#eefcfb', // oklch(0.98 0.015 195)

  // Status
  successBg: '#d6f0da', // oklch(0.93 0.04 150)
  successText: '#225a31', // oklch(0.42 0.09 150)
  successCircle: '#d1f2d7', // oklch(0.93 0.05 150)
  successCheck: '#2b7440', // oklch(0.5 0.11 150)
  amberBg: '#f6edda',
  amberText: '#8a6d3d',
  neutralBg: '#f0ece4',
  neutralText: '#6f685d',
  errorBg: '#ffe5e1', // oklch(0.95 0.04 25)
  errorBorder: '#f9bdb7', // oklch(0.85 0.07 25)
  errorText: '#9a3b32',
  dangerText: '#a15c5c',
  warnBg: '#fdf0dc', // oklch(0.96 0.03 80)
  warnBorder: '#e9d5b3', // oklch(0.88 0.05 80)
  warnText: '#7a5f2d',

  // Disabled CTA
  disabledBg: '#e5ded3',
  disabledText: '#a99f8f',

  toastBg: '#26221d',
  toastText: '#faf8f5',
  white: '#ffffff',
} as const;

/** Initials-circle tints, keyed so the same person keeps the same colour. */
export const avatarTint = {
  amber: { bg: '#e9dcc8', fg: '#7a6a4d' },
  teal: { bg: '#acdcdb', fg: '#3d6b62' },
  coral: { bg: '#f1cec8', fg: '#8a5a4d' },
  violet: { bg: '#d0d5f9', fg: '#5a5b8a' },
  green: { bg: '#cadec6', fg: '#4d7a5a' },
} as const;

export type AvatarTintName = keyof typeof avatarTint;

/** Booked-visit blocks on the provider schedule. */
export const visitTint = {
  teal: { bg: '#d5f2f1', border: '#acdcdb', fg: '#3d6b62', sub: '#5c8078' },
  coral: { bg: '#ffe4df', border: '#f0c6be', fg: '#8a5a4d', sub: '#a37d70' },
  violet: { bg: '#e7e9ff', border: '#cacef2', fg: '#5a5b8a', sub: '#7d7ea3' },
} as const;

export type VisitTintName = keyof typeof visitTint;

export const font = {
  /** Newsreader: headings, greetings, big numbers. */
  display: 'Newsreader_500Medium',
  body: 'PublicSans_400Regular',
  medium: 'PublicSans_500Medium',
  semibold: 'PublicSans_600SemiBold',
  bold: 'PublicSans_700Bold',
} as const;

export const radius = {
  field: 11,
  button: 11,
  buttonLg: 14,
  chip: 10,
  card: 16,
  cardSm: 14,
  appCard: 20,
  pill: 999,
  brandMark: 7,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  cardMobile: 20,
  cardDesktop: 40,
} as const;

/**
 * RN has no multi-layer or inset shadows, so each of the handoff's stacked
 * shadows collapses to the one layer that carries the visible weight.
 */
export const shadow = {
  card: {
    shadowColor: 'rgb(60,50,30)',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 6,
  },
  cta: {
    shadowColor: '#0f5f5f',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 4,
  },
  slotSelected: {
    shadowColor: '#0f5f5f',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 3,
  },
  brandMark: {
    shadowColor: '#0f5f5f',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 2,
  },
  toast: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

export const motion = {
  fadeUpMs: 400,
  popMs: 500,
  toastMs: 2600,
} as const;

/** Above this width the desktop (D…) layouts render; below, the mobile (M…). */
export const BREAKPOINT = 768;

/** The clinic's own zone. Availability is authored here; storage is UTC. */
export const CLINIC_TIMEZONE = 'America/Los_Angeles';

export const TIMEZONES = [
  { id: 'America/Los_Angeles', short: 'PT', label: 'PT · Seattle' },
  { id: 'America/Denver', short: 'MT', label: 'MT · Denver' },
  { id: 'America/Chicago', short: 'CT', label: 'CT · Chicago' },
  { id: 'America/New_York', short: 'ET', label: 'ET · New York' },
] as const;
