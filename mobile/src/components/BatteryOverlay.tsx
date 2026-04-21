import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBatteryStatus } from '../native/deviceControl';

type BatteryState = {
  level: number | null;
  isCharging: boolean;
};

const REFRESH_INTERVAL_MS = 15_000;

export default function BatteryOverlay() {
  const insets = useSafeAreaInsets();
  const [battery, setBattery] = useState<BatteryState>({
    level: null,
    isCharging: false
  });
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    let mounted = true;

    const refresh = async () => {
      const status = await getBatteryStatus();
      if (!mounted) return;
      if (!status) {
        setSupported(false);
        return;
      }
      setSupported(true);
      setBattery(status);
    };

    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (Platform.OS !== 'android') {
    return null;
  }

  const fillColor = useMemo(() => {
    if (battery.level === null) return '#94A3B8';
    if (battery.level <= 20) return '#EF4444';
    if (battery.level <= 50) return '#F59E0B';
    return '#10B981';
  }, [battery.level]);
  const label = !supported ? 'N/A' : battery.level === null ? '--%' : `${battery.level}%`;
  const fillPercent = battery.level === null ? 36 : Math.max(0, Math.min(100, battery.level));

  return (
    <View pointerEvents="none" style={[styles.container, { top: insets.top + 6 }]}>
      <View style={styles.batteryWrap}>
        <View style={styles.batteryBody}>
          <View style={[styles.batteryFill, { width: `${fillPercent}%`, backgroundColor: fillColor }]} />
          {battery.isCharging ? <Text style={styles.chargingMark}>C</Text> : null}
        </View>
        <View style={styles.batteryCap} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 10,
    zIndex: 1200,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  batteryWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6
  },
  batteryBody: {
    width: 22,
    height: 11,
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: '#334155',
    overflow: 'hidden',
    justifyContent: 'center'
  },
  batteryFill: {
    height: '100%'
  },
  batteryCap: {
    width: 2.5,
    height: 6,
    borderRadius: 1,
    backgroundColor: '#334155',
    marginLeft: 1.5
  },
  chargingMark: {
    position: 'absolute',
    alignSelf: 'center',
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '700'
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A'
  }
});
