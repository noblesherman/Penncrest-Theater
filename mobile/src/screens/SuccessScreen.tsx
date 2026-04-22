/*
Handoff note for Mr. Smith:
- File: `mobile/src/screens/SuccessScreen.tsx`
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
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LargeButton } from '../components/LargeButton';
import type { RootStackParamList } from '../navigation/types';
import { screenStyles } from './styles';

type Props = NativeStackScreenProps<RootStackParamList, 'Success'>;

export function SuccessScreen({ navigation, route }: Props) {
  return (
    <SafeAreaView style={screenStyles.safeArea}>
      <View style={[screenStyles.container, { justifyContent: 'center' }]}>
        <Text style={screenStyles.title}>Payment Complete</Text>
        {route.params.orderId ? <Text style={screenStyles.subtitle}>Order ID: {route.params.orderId}</Text> : null}

        <LargeButton
          label="Return Home"
          onPress={() => {
            navigation.reset({
              index: 0,
              routes: [{ name: 'Home' }]
            });
          }}
        />
      </View>
    </SafeAreaView>
  );
}
