import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PRIVACY_POLICY_URL, REFUND_POLICY_URL, SUPPORT_URL, TERMS_OF_USE_URL } from '../config';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Legal'>;

async function openExternalUrl(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('We could not open link', `Please open this URL manually:\n\n${url}`);
  }
}

export function LegalScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brandTag}>Penncrest Theater</Text>
        <Text style={styles.title}>
          Legal &{'\n'}
          <Text style={styles.titleAccent}>Support</Text>
        </Text>
        <Text style={styles.subtitle}>Review policies and contact the box office support team.</Text>
        <View style={styles.divider} />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Privacy Policy</Text>
          <Text style={styles.cardBody}>
            This app is for authenticated theater staff and processes ticketing and in-person payment operations.
          </Text>
          <Pressable style={styles.linkButton} onPress={() => void openExternalUrl(PRIVACY_POLICY_URL)}>
            <Text style={styles.linkButtonLabel}>Open Privacy Policy</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Terms of Service</Text>
          <Text style={styles.cardBody}>Terms cover permitted staff use, payment handling, and event operations.</Text>
          <Pressable style={styles.linkButton} onPress={() => void openExternalUrl(TERMS_OF_USE_URL)}>
            <Text style={styles.linkButtonLabel}>Open Terms of Service</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Refund Policy</Text>
          <Text style={styles.cardBody}>Refund handling for cancellations, reschedules, and ticket-holder requests.</Text>
          <Pressable style={styles.linkButton} onPress={() => void openExternalUrl(REFUND_POLICY_URL)}>
            <Text style={styles.linkButtonLabel}>Open Refund Policy</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Support</Text>
          <Text style={styles.cardBody}>Need help with device setup, sign-in, or payments? Contact the box office support team.</Text>
          <Pressable style={styles.linkButton} onPress={() => void openExternalUrl(SUPPORT_URL)}>
            <Text style={styles.linkButtonLabel}>Contact Support</Text>
          </Pressable>
        </View>

        <Pressable style={[styles.linkButton, styles.backButton]} onPress={() => navigation.goBack()}>
          <Text style={styles.linkButtonLabel}>Back</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
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
  divider: {
    width: 32,
    height: 2,
    backgroundColor: '#c9a84c',
    opacity: 0.7,
    marginBottom: 20
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.25)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 14,
    marginBottom: 14
  },
  cardTitle: {
    fontFamily: 'Georgia',
    color: '#f5f0e8',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8
  },
  cardBody: {
    fontFamily: 'Georgia',
    color: 'rgba(245,240,232,0.8)',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10
  },
  linkButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c9a84c',
    backgroundColor: '#8b1a1a',
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center'
  },
  backButton: {
    marginTop: 6
  },
  linkButtonLabel: {
    color: '#f5f0e8',
    fontFamily: 'Georgia',
    fontWeight: '700',
    fontSize: 15
  }
});
