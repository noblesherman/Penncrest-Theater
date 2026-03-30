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
