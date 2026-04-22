/*
Handoff note for Mr. Smith:
- File: `mobile/App.tsx`
- What this is: Mobile bootstrap/config entry file.
- What it does: Initializes app startup behavior and top-level wiring.
- Connections: Bridge between native runtime and JS app tree.
- Main content type: Startup/config orchestration.
- Safe edits here: Comments and carefully additive startup notes.
- Be careful with: Import order and startup side effects.
- Useful context: If app startup fails before first render, begin debugging here.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import { DeviceRuntimeProvider } from './src/device/DeviceRuntimeProvider';
import { AppNavigator } from './src/navigation/AppNavigator';
import { stripePaymentSheet } from './src/payments/stripePaymentSheet';
import { TerminalProvider } from './src/terminal/terminal';
import BatteryOverlay from './src/components/BatteryOverlay';

export default function App() {
  useEffect(() => {
    const handleUrl = async (url: string) => {
      try {
        await stripePaymentSheet.handleURLCallback(url);
      } catch {
        // Ignore deep-link handling failures and allow app navigation to continue.
      }
    };

    const subscription = Linking.addEventListener('url', (event) => {
      void handleUrl(event.url);
    });

    void Linking.getInitialURL().then((url) => {
      if (url) {
        void handleUrl(url);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <DeviceRuntimeProvider>
          <TerminalProvider>
            <AppNavigator />
            <BatteryOverlay />
            <StatusBar style="dark" />
          </TerminalProvider>
        </DeviceRuntimeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
