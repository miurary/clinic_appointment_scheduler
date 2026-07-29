import { useWindowDimensions } from 'react-native';

import { BREAKPOINT } from './tokens';

/**
 * The desktop (D…) and mobile (M…) designs are one responsive tree, not two
 * apps. Every screen renders the wide branch above the breakpoint and the
 * narrow branch below it, so a phone, a tablet and a browser window all get
 * the layout the handoff drew for that width.
 *
 * Driven by useWindowDimensions rather than Platform.OS: a narrow browser
 * window should get the mobile layout, and a tablet should get the desktop one.
 */
export function useResponsive() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isDesktop: width >= BREAKPOINT,
    isMobile: width < BREAKPOINT,
  };
}
