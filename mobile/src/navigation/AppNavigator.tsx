import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { HomeScreen } from '../screens/HomeScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { LegalScreen } from '../screens/LegalScreen';
import { ScanScreen } from '../screens/ScanScreen';
import { SellTicketsScreen } from '../screens/SellTicketsScreen';
import { StartupPreflightScreen } from '../screens/StartupPreflightScreen';
import { SuccessScreen } from '../screens/SuccessScreen';
import { TapToPayScreen } from '../screens/TapToPayScreen';
import { TerminalStationScreen } from '../screens/TerminalStationScreen';
import { MaintenanceScreen } from '../screens/MaintenanceScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  const { token } = useAuth();
  const [preflightReady, setPreflightReady] = useState(false);

  if (!preflightReady) {
    return <StartupPreflightScreen onReady={() => setPreflightReady(true)} />;
  }

  return (
    <NavigationContainer>
      {!token ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Legal" component={LegalScreen} />
        </Stack.Navigator>
      ) : (
        <Stack.Navigator
          screenOptions={{
            headerTitleStyle: {
              fontSize: 20,
              fontWeight: '700'
            }
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Box Office' }} />
          <Stack.Screen name="Maintenance" component={MaintenanceScreen} options={{ title: 'Maintenance' }} />
          <Stack.Screen name="Legal" component={LegalScreen} options={{ title: 'Legal & Support' }} />
          <Stack.Screen name="TerminalStation" component={TerminalStationScreen} options={{ headerShown: false }} />
          <Stack.Screen name="ScanTickets" component={ScanScreen} options={{ headerShown: false }} />
          <Stack.Screen name="SellTickets" component={SellTicketsScreen} options={{ title: 'Sell Tickets' }} />
          <Stack.Screen name="TapToPay" component={TapToPayScreen} options={{ title: 'Tap to Pay' }} />
          <Stack.Screen name="Success" component={SuccessScreen} options={{ title: 'Success', headerBackVisible: false }} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
