import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { color, font, motion, radius, shadow } from '../theme/tokens';

type ToastContextValue = { show: (message: string) => void };

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export const useToast = () => useContext(ToastContext);

/**
 * The transient bottom-centre pill: "Added to your calendar",
 * "Appointment canceled", the race message. Auto-dismisses after 2.6s.
 *
 * A provider rather than per-screen state so a toast raised during navigation
 * (cancel, then land on the dashboard) survives the screen change.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (next: string) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(next);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(() => setMessage(null));
      }, motion.toastMs);
    },
    [opacity],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {message ? (
        <View pointerEvents="none" style={styles.layer}>
          <Animated.View
            style={[
              styles.toast,
              shadow.toast,
              {
                opacity,
                transform: [
                  {
                    translateY: opacity.interpolate({
                      inputRange: [0, 1],
                      outputRange: [8, 0],
                    }),
                  },
                ],
              },
            ]}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            <Text style={styles.text}>{message}</Text>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    alignItems: 'center',
    zIndex: 50,
  },
  toast: {
    backgroundColor: color.toastBg,
    borderRadius: radius.chip + 2,
    paddingHorizontal: 22,
    paddingVertical: 13,
  },
  text: { fontFamily: font.medium, fontSize: 14, color: color.toastText },
});
