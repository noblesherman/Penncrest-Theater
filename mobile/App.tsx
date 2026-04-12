import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import { DeviceRuntimeProvider } from './src/device/DeviceRuntimeProvider';
import { AppNavigator } from './src/navigation/AppNavigator';
import { stripePaymentSheet } from './src/payments/stripePaymentSheet';
import { TerminalProvider } from './src/terminal/terminal';

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
            <StatusBar style="dark" />
          </TerminalProvider>
        </DeviceRuntimeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
