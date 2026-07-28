import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, type ViewStyle } from 'react-native';

import { motion } from '../theme/tokens';

/**
 * The handoff's screen-enter animation: fade in while rising 8px.
 *
 * CSS @keyframes have no RN equivalent, so this is the Animated API. Both
 * values are driven from one 0->1 clock so they cannot drift apart, and
 * useNativeDriver keeps it off the JS thread (opacity and transform are the
 * two things the native driver supports).
 */
export function FadeUp({
  children,
  style,
  delay = 0,
}: {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  delay?: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.fadeUpMs,
      delay,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delay]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The success check's entrance: scale .7 -> 1.08 -> 1, so it overshoots and
 * settles rather than simply appearing.
 */
export function Pop({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.popMs,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
          transform: [
            {
              scale: progress.interpolate({
                inputRange: [0, 0.6, 1],
                outputRange: [0.7, 1.08, 1],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
