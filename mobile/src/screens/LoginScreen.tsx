/*
Handoff note for Mr. Smith:
- File: `mobile/src/screens/LoginScreen.tsx`
- What this is: React Native screen module.
- What it does: Implements one full mobile screen and its workflow logic.
- Connections: Registered through navigator and connected to mobile api/device/payment helpers.
- Main content type: Screen layout + user flow logic + visible operator text.
- Safe edits here: UI copy tweaks and presentational layout polish.
- Be careful with: Navigation params, async state flow, and payment/scan side effects.
- Useful context: If terminal workflows feel off, these screen files are key investigation points.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { AdminEscapeModal } from '../components/AdminEscapeModal';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { login, isLoading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await login({ username: username.trim(), password, otpCode: otpCode.trim() || undefined });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'We could not log in';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !!username.trim() && !!password && !submitting;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#c9a84c" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.brandTag}>Penncrest Theater</Text>
            <Text style={styles.title}>
              Box Office{'\n'}
              <Text style={styles.titleAccent}>Sign In</Text>
            </Text>
            <Text style={styles.subtitle}>Use your staff credentials. Review credentials are provided in App Review Notes.</Text>
            <View style={styles.divider} />
          </View>

          <View style={styles.form}>
            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>Username</Text>
              <TextInput
                style={styles.input}
                placeholder="your.name"
                placeholderTextColor="rgba(245,240,232,0.25)"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textContentType="username"
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="rgba(245,240,232,0.25)"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="password"
                textContentType="password"
                returnKeyType="next"
              />
            </View>

            <View style={[styles.inputWrap, styles.inputWrapLast]}>
              <View style={styles.inputLabelRow}>
                <Text style={styles.inputLabel}>2FA Code</Text>
                <Text style={styles.inputLabelOptional}>optional</Text>
              </View>
              <TextInput
                style={[styles.input, styles.inputOtp]}
                placeholder="000000"
                placeholderTextColor="rgba(245,240,232,0.25)"
                value={otpCode}
                onChangeText={setOtpCode}
                keyboardType="number-pad"
                autoCorrect={false}
                textContentType="oneTimeCode"
                returnKeyType="done"
                onSubmitEditing={onSubmit}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.signInBtn, !canSubmit && styles.signInBtnDisabled]}
              onPress={onSubmit}
              disabled={!canSubmit}
              activeOpacity={0.75}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#f5d98b" />
              ) : (
                <Text style={styles.signInBtnText}>Sign In</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.legalButton} onPress={() => navigation.navigate('Legal')} activeOpacity={0.75}>
              <Text style={styles.legalButtonText}>Privacy, Terms & Support</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.adminButton} onPress={() => setShowAdminModal(true)} activeOpacity={0.75}>
              <Text style={styles.adminButtonText}>Admin Unlock</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
      <AdminEscapeModal visible={showAdminModal} onClose={() => setShowAdminModal(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1a0505',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyboardView: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 32,
  },

  // Header
  header: {
    marginBottom: 8,
  },
  brandTag: {
    fontSize: 10,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: '#c9a84c',
    fontFamily: 'Georgia',
    marginBottom: 10,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#f5f0e8',
    fontFamily: 'Georgia',
    lineHeight: 40,
    marginBottom: 8,
  },
  titleAccent: {
    color: '#c9a84c',
    fontStyle: 'italic',
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(245,240,232,0.4)',
    fontFamily: 'Georgia',
    marginBottom: 24,
  },
  divider: {
    width: 32,
    height: 2,
    backgroundColor: '#c9a84c',
    opacity: 0.7,
    marginBottom: 28,
  },

  // Form
  form: {},
  inputWrap: {
    marginBottom: 14,
  },
  inputWrapLast: {
    marginBottom: 20,
  },
  inputLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  inputLabel: {
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#c9a84c',
    fontFamily: 'Arial',
    opacity: 0.8,
    marginBottom: 5,
  },
  inputLabelOptional: {
    fontSize: 9,
    color: 'rgba(245,240,232,0.3)',
    fontFamily: 'Arial',
    marginBottom: 5,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.25)',
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#f5f0e8',
    fontFamily: 'Arial',
    fontSize: 15,
  },
  inputOtp: {
    letterSpacing: 6,
    fontSize: 18,
  },

  // Error
  errorBox: {
    backgroundColor: 'rgba(139,26,26,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.2)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: '#f5d98b',
    fontFamily: 'Arial',
    lineHeight: 18,
  },

  // Sign in button
  signInBtn: {
    backgroundColor: '#8b1a1a',
    borderWidth: 1,
    borderColor: '#c9a84c',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  signInBtnDisabled: {
    opacity: 0.45,
  },
  signInBtnText: {
    fontFamily: 'Georgia',
    fontSize: 17,
    fontWeight: '700',
    color: '#f5d98b',
    letterSpacing: 0.3,
  },
  legalButton: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 8,
  },
  legalButtonText: {
    color: '#f5d98b',
    fontFamily: 'Georgia',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  adminButton: {
    marginTop: 2,
    alignItems: 'center',
    paddingVertical: 8,
  },
  adminButtonText: {
    color: 'rgba(245,240,232,0.7)',
    fontFamily: 'Arial',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
});
