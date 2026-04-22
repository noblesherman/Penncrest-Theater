/*
Handoff note for Mr. Smith:
- File: `mobile/src/screens/StartupPreflightScreen.tsx`
- What this is: React Native screen module.
- What it does: Implements one full mobile screen and its workflow logic.
- Connections: Registered through navigator and connected to mobile api/device/payment helpers.
- Main content type: Screen layout + user flow logic + visible operator text.
- Safe edits here: UI copy tweaks and presentational layout polish.
- Be careful with: Navigation params, async state flow, and payment/scan side effects.
- Useful context: If terminal workflows feel off, these screen files are key investigation points.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getStartupPreflight } from '../api/mobile';
import { API_BASE_URL, TERMINAL_MOCK_MODE } from '../config';
import { useTerminal } from '../terminal/terminal';
import { TAP_TO_PAY_BUILD_HINT, TAP_TO_PAY_DISPLAY_NAME, TAP_TO_PAY_LIVE_SETUP_HINT } from '../terminal/tapToPay';

type StartupPreflightScreenProps = {
  onReady: () => void;
};

type CheckStatus = 'pending' | 'ok' | 'failed';

type CheckResult = {
  status: CheckStatus;
  detail: string;
  fix?: string;
};

const INITIAL_CHECK: CheckResult = {
  status: 'pending',
  detail: 'Running check...'
};

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json'
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

export function StartupPreflightScreen({ onReady }: StartupPreflightScreenProps) {
  const terminal = useTerminal();
  const [running, setRunning] = useState(false);
  const [apiCheck, setApiCheck] = useState<CheckResult>(INITIAL_CHECK);
  const [routesCheck, setRoutesCheck] = useState<CheckResult>(INITIAL_CHECK);
  const [terminalCheck, setTerminalCheck] = useState<CheckResult>(INITIAL_CHECK);

  const hasNavigatedRef = useRef(false);
  const runningRef = useRef(false);

  const allChecksPassing = useMemo(
    () => apiCheck.status === 'ok' && routesCheck.status === 'ok' && terminalCheck.status === 'ok',
    [apiCheck.status, routesCheck.status, terminalCheck.status]
  );
  const hasAnyFailure = useMemo(
    () => apiCheck.status === 'failed' || routesCheck.status === 'failed' || terminalCheck.status === 'failed',
    [apiCheck.status, routesCheck.status, terminalCheck.status]
  );

  useEffect(() => {
    if (!allChecksPassing || hasNavigatedRef.current) {
      return;
    }

    hasNavigatedRef.current = true;
    const timer = setTimeout(() => {
      onReady();
    }, 350);

    return () => {
      clearTimeout(timer);
    };
  }, [allChecksPassing, onReady]);

  const runChecks = useCallback(async () => {
    if (runningRef.current) {
      return;
    }

    runningRef.current = true;
    hasNavigatedRef.current = false;
    setRunning(true);
    setApiCheck(INITIAL_CHECK);
    setRoutesCheck(INITIAL_CHECK);
    setTerminalCheck(INITIAL_CHECK);

    try {
      try {
        const response = await fetchWithTimeout(`${API_BASE_URL}/api/health/ready`, 8_000);
        if (!response.ok) {
          setApiCheck({
            status: 'failed',
            detail: `Health check returned HTTP ${response.status}.`,
            fix: 'Confirm backend is running and EXPO_PUBLIC_API_BASE_URL points to the correct API host.'
          });
        } else {
          const payload = (await response.json()) as { status?: string };
          setApiCheck({
            status: payload.status === 'ok' || payload.status === 'degraded' ? 'ok' : 'failed',
            detail: payload.status ? `API responded with status: ${payload.status}.` : 'API is reachable.',
            fix: payload.status ? undefined : 'Confirm /api/health/ready returns JSON from this backend.'
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'That request missed its cue';
        setApiCheck({
          status: 'failed',
          detail: `We could not reach API: ${message}`,
          fix: 'Bring backend online, verify network access, and recheck EXPO_PUBLIC_API_BASE_URL.'
        });
      }

      try {
        const preflight = await getStartupPreflight();
        const requiredRouteValues = Object.values(preflight.requiredRoutes);
        const hasMissingRoute = requiredRouteValues.some((isPresent) => !isPresent);
        if (hasMissingRoute) {
          setRoutesCheck({
            status: 'failed',
            detail: 'Backend is missing one or more required mobile terminal routes.',
            fix: 'Deploy the latest backend build that includes mobile terminal retry/cancel/telemetry endpoints.'
          });
        } else if (!preflight.stripe.terminalSecretKeyConfigured) {
          setRoutesCheck({
            status: 'failed',
            detail: 'Backend route set is present, but Stripe Terminal secret key is not configured.',
            fix: 'Set STRIPE_SECRET_KEY on the backend and restart the API service.'
          });
        } else {
          setRoutesCheck({
            status: 'ok',
            detail: preflight.stripe.publishableKeyConfigured
              ? 'Required backend routes are available and Stripe keys are configured.'
              : 'Required backend routes are available. Publishable key is optional for terminal-station mode.'
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'That request missed its cue';
        setRoutesCheck({
          status: 'failed',
          detail: `We could not validate route support: ${message}`,
          fix: 'Update backend so /api/mobile/preflight is available and reachable from this device.'
        });
      }

      if (TERMINAL_MOCK_MODE) {
        setTerminalCheck({
          status: 'ok',
          detail: 'Demo mode is enabled. Stripe Terminal hardware checks are bypassed intentionally.'
        });
      } else if (terminal.isAvailable) {
        setTerminalCheck({
          status: 'ok',
          detail: `Stripe Terminal native module is available in this build. ${TAP_TO_PAY_LIVE_SETUP_HINT}`
        });
      } else {
        setTerminalCheck({
          status: 'failed',
          detail: `${TAP_TO_PAY_DISPLAY_NAME} is unavailable because the Stripe Terminal native module is missing from this build.`,
          fix: TAP_TO_PAY_BUILD_HINT
        });
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [terminal.isAvailable]);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brandTag}>Penncrest Theater</Text>
        <Text style={styles.title}>Startup{`\n`}<Text style={styles.titleAccent}>Preflight</Text></Text>
        <Text style={styles.subtitle}>Checking service availability before opening sign-in.</Text>

        <View style={styles.card}>
          <PreflightRow label="API Reachability" check={apiCheck} />
          <PreflightRow label="Backend Routes" check={routesCheck} />
          <PreflightRow label="Stripe Terminal" check={terminalCheck} />

          {running ? <ActivityIndicator size="small" color="#c9a84c" style={{ marginTop: 12 }} /> : null}
        </View>

        <Pressable style={[styles.button, running && styles.buttonDisabled]} disabled={running} onPress={() => void runChecks()}>
          <Text style={styles.buttonLabel}>Run Checks Again</Text>
        </Pressable>

        <Pressable
          style={[styles.button, styles.continueButton, running && !allChecksPassing && styles.buttonDisabled]}
          disabled={running && !allChecksPassing}
          onPress={onReady}
        >
          <Text style={[styles.buttonLabel, styles.continueButtonLabel]}>
            {allChecksPassing ? 'Open App' : 'Continue to Sign In'}
          </Text>
        </Pressable>

        {allChecksPassing ? <Text style={styles.readyText}>All checks passed. Opening app...</Text> : null}
        {hasAnyFailure ? (
          <Text style={styles.warningText}>
            One or more startup checks failed. You can still sign in, but payment or scanner flows may be limited until service
            connectivity is restored.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

type PreflightRowProps = {
  label: string;
  check: CheckResult;
};

function PreflightRow({ label, check }: PreflightRowProps) {
  const statusColor = check.status === 'ok' ? '#86efac' : check.status === 'failed' ? '#fecaca' : '#fef08a';
  const statusLabel = check.status === 'ok' ? 'OK' : check.status === 'failed' ? 'FAIL' : 'CHECKING';

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={[styles.rowStatus, { color: statusColor }]}>{statusLabel}</Text>
      </View>
      <Text style={styles.rowDetail}>{check.detail}</Text>
      {check.fix ? <Text style={styles.rowFix}>Fix: {check.fix}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1a0505'
  },
  content: {
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 40
  },
  brandTag: {
    fontSize: 10,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: '#c9a84c',
    fontFamily: 'Georgia',
    marginBottom: 10
  },
  title: {
    fontSize: 40,
    fontWeight: '700',
    color: '#f5f0e8',
    fontFamily: 'Georgia',
    lineHeight: 44,
    marginBottom: 8
  },
  titleAccent: {
    color: '#c9a84c',
    fontStyle: 'italic'
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(245,240,232,0.55)',
    fontFamily: 'Georgia',
    marginBottom: 22
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.25)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 14
  },
  row: {
    marginBottom: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.2)',
    backgroundColor: 'rgba(245,240,232,0.04)',
    padding: 10
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  rowLabel: {
    fontFamily: 'Georgia',
    fontWeight: '700',
    color: '#f5f0e8',
    fontSize: 14
  },
  rowStatus: {
    fontFamily: 'Arial',
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '700'
  },
  rowDetail: {
    fontFamily: 'Georgia',
    color: 'rgba(245,240,232,0.85)',
    fontSize: 12,
    lineHeight: 18
  },
  rowFix: {
    marginTop: 6,
    fontFamily: 'Arial',
    color: '#f5d98b',
    fontSize: 12,
    lineHeight: 18
  },
  button: {
    marginTop: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c9a84c',
    backgroundColor: '#8b1a1a',
    paddingVertical: 12,
    alignItems: 'center'
  },
  buttonDisabled: {
    opacity: 0.55
  },
  buttonLabel: {
    color: '#f5f0e8',
    fontFamily: 'Georgia',
    fontWeight: '700',
    fontSize: 15
  },
  continueButton: {
    marginTop: 10,
    backgroundColor: 'rgba(245,240,232,0.08)',
    borderColor: 'rgba(201,168,76,0.55)'
  },
  continueButtonLabel: {
    color: '#f5f0e8'
  },
  readyText: {
    marginTop: 14,
    color: '#86efac',
    fontFamily: 'Georgia',
    fontSize: 13
  },
  warningText: {
    marginTop: 14,
    color: '#f5d98b',
    fontFamily: 'Georgia',
    fontSize: 12,
    lineHeight: 18
  }
});
