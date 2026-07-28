import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ApiError } from '../src/api/client';
import { BrandMark, Note } from '../src/components/Bits';
import { PrimaryButton } from '../src/components/Button';
import { FadeUp } from '../src/components/FadeUp';
import { Field, Segmented } from '../src/components/Form';
import { PageBackground } from '../src/components/Surface';
import { Body, Display, Link, Muted } from '../src/components/Typography';
import { useAuth } from '../src/lib/auth';
import { color, radius, shadow } from '../src/theme/tokens';
import { useResponsive } from '../src/theme/useResponsive';

type Mode = 'signin' | 'signup';
type RoleChoice = 'patient' | 'provider';

const HEADLINE_DESKTOP = "Breathe easier.\nWe'll handle the scheduling.";
const HEADLINE_MOBILE = "Breathe easier.\nWe'll handle it.";
const BLURB =
  'Book pulmonology visits, respiratory therapy, and follow-ups with your Kivo care team — all in one place.';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, signUp } = useAuth();
  const { isDesktop } = useResponsive();

  const [mode, setMode] = useState<Mode>('signin');
  const [role, setRole] = useState<RoleChoice>('patient');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const user =
        mode === 'signin'
          ? await signIn(email.trim(), password)
          : await signUp({
              email: email.trim(),
              password,
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              role,
            });
      router.replace(user.role === 'provider' ? '/provider' : '/dashboard');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.detail
          : 'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <View style={isDesktop ? styles.formColumn : styles.formMobile}>
      <Display size={isDesktop ? 30 : 26}>
        {mode === 'signin' ? 'Sign in' : 'Create your account'}
      </Display>
      <Muted size={14} style={styles.formSub}>
        {mode === 'signin'
          ? 'Welcome back. Sign in to manage your appointments.'
          : 'A few details and you can book your first visit.'}
      </Muted>

      <View style={styles.segmentWrap}>
        <Segmented<RoleChoice>
          block={!isDesktop}
          value={role}
          onChange={setRole}
          options={[
            { value: 'patient', label: 'Patient' },
            { value: 'provider', label: 'Provider' },
          ]}
        />
      </View>

      {error ? (
        <Note tone="error" icon="⚠" style={styles.error}>
          {error}
        </Note>
      ) : null}

      <View style={styles.fields}>
        {mode === 'signup' ? (
          <View style={styles.nameRow}>
            <Field
              label="First name"
              value={firstName}
              onChangeText={setFirstName}
              autoComplete="given-name"
              style={styles.nameField}
            />
            <Field
              label="Last name"
              value={lastName}
              onChangeText={setLastName}
              autoComplete="family-name"
              style={styles.nameField}
            />
          </View>
        ) : null}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          inputMode="email"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••••"
          secureTextEntry
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          onSubmitEditing={submit}
          returnKeyType="go"
          /* The mock shows a "Forgot?" link. Password reset needs an email
             backend that does not exist here, and a link that silently does
             nothing is worse for someone actually locked out than no link at
             all. Listed in the README as a known omission. */
        />
      </View>

      <PrimaryButton
        block
        size={isDesktop ? 'md' : 'lg'}
        label={busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        onPress={submit}
        disabled={busy || !email || !password}
        style={styles.cta}
      />

      <View style={styles.switchRow}>
        <Muted size={13.5}>
          {mode === 'signin' ? 'New patient? ' : 'Already have an account? '}
        </Muted>
        <Pressable
          onPress={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
          }}
          accessibilityRole="button"
        >
          <Link size={13.5}>
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </Link>
        </Pressable>
      </View>
    </View>
  );

  // --- D1: two-column card, brand panel beside the form -------------------
  if (isDesktop) {
    return (
      <PageBackground>
        <ScrollView contentContainerStyle={styles.desktopPage}>
          <FadeUp style={[styles.desktopCard, shadow.card]}>
            <LinearGradient
              colors={[color.brandPanelTop, color.brandPanelBottom]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.7, y: 1 }}
              style={styles.brandPanel}
            >
              <BrandMark onDark labelSize={18} />
              <View>
                <Display size={40} style={styles.brandHeadline}>
                  {HEADLINE_DESKTOP}
                </Display>
                <Body size={15} style={styles.brandBlurb}>
                  {BLURB}
                </Body>
              </View>
              <Body size={12.5} style={styles.privacy}>
                🔒 Your health information is encrypted and private.
              </Body>
            </LinearGradient>
            {form}
          </FadeUp>
        </ScrollView>
      </PageBackground>
    );
  }

  // --- M1: gradient header block, form beneath ----------------------------
  return (
    <PageBackground>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.mobilePage}
          keyboardShouldPersistTaps="handled"
        >
          <LinearGradient
            colors={[color.brandPanelTop, color.brandPanelBottom]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.7, y: 1 }}
            style={styles.mobileBrand}
          >
            <BrandMark onDark size={20} labelSize={16} />
            <Display size={30} style={styles.mobileHeadline}>
              {HEADLINE_MOBILE}
            </Display>
          </LinearGradient>
          <FadeUp>{form}</FadeUp>
        </ScrollView>
      </KeyboardAvoidingView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  desktopPage: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  desktopCard: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 1000,
    minHeight: 560,
    backgroundColor: color.appSurface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.appCard,
    overflow: 'hidden',
  },
  brandPanel: {
    flex: 1,
    padding: 48,
    justifyContent: 'space-between',
    gap: 32,
  },
  brandHeadline: { color: color.brandPanelText, lineHeight: 45 },
  brandBlurb: {
    color: color.brandPanelBody,
    marginTop: 18,
    maxWidth: 380,
    lineHeight: 24,
  },
  privacy: { color: color.brandPanelFaint },
  formColumn: { flex: 1, padding: 56, justifyContent: 'center' },
  formMobile: { padding: 26 },
  formSub: { marginTop: 4 },
  segmentWrap: { marginTop: 24 },
  fields: { marginTop: 22, gap: 16 },
  nameRow: { flexDirection: 'row', gap: 12 },
  nameField: { flex: 1 },
  error: { marginTop: 18 },
  cta: { marginTop: 26 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  mobilePage: { flexGrow: 1 },
  mobileBrand: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 40, gap: 40 },
  mobileHeadline: { color: color.brandPanelText, lineHeight: 35 },
});
