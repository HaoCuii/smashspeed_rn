// src/screens/SpeedResultScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Platform,
  Alert,
  ImageBackground,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Share from 'react-native-share';

// Optional: expo-blur for iOS glass effect
let BlurView: any;
try {
  BlurView = require('expo-blur').BlurView;
} catch {
  BlurView = null;
}

// Required: react-native-view-shot for image sharing
let captureRef: any;
try {
  captureRef = require('react-native-view-shot').captureRef;
} catch {
  captureRef = null;
}

type SpeedResultParams = {
  maxKph: number;
  angle?: number; // optional
};

export default function SpeedResultScreen({ route, navigation }: any) {
  const { maxKph, angle } = route.params as SpeedResultParams;
  const hasAngle = typeof angle === 'number' && isFinite(angle) && (angle as number) > 0;

  const [displaySpeed, setDisplaySpeed] = useState(0);
  const [displayAngle, setDisplayAngle] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;
  const animOnce = useRef(false);

  const { width: SW } = useWindowDimensions();
  const CARD_W = Math.min(440, Math.max(300, SW * 0.92));
  const NUM_FS = Math.round(Math.min(96, Math.max(64, CARD_W * 0.22)));
  const UNIT_FS = Math.round(NUM_FS * 0.28);

  useEffect(() => {
    if (animOnce.current) return;
    animOnce.current = true;
    setTimeout(() => {
      Animated.timing(anim, {
        toValue: 1,
        duration: 1500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }, 250);
  }, [anim]);

  useEffect(() => {
    const id = anim.addListener(({ value }) => {
      setDisplaySpeed(value * maxKph);
      if (hasAngle) setDisplayAngle(value * (angle as number));
    });
    return () => anim.removeListener(id);
  }, [anim, maxKph, angle, hasAngle]);

  const speedStr = useMemo(() => displaySpeed.toFixed(1), [displaySpeed]);

  const goAnalyzeAnother = () => {
    try { navigation.popToTop?.(); } catch {}
    navigation.navigate('Detect');
  };

  // --- SHARE (snapshot the card) ---
  const shareCardRef = useRef<View | null>(null);
  const [plainGlass, setPlainGlass] = useState(false); // disable blur while capturing
  const [isSharing, setIsSharing] = useState(false);

  const onShare = async () => {
    if (isSharing || !captureRef || !shareCardRef.current) {
        Alert.alert('Error', 'Unable to share result at this moment.');
        return;
    }

    try {
      setIsSharing(true);
      setPlainGlass(true);
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 16)));

      const uri: string = await captureRef(shareCardRef.current, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });

      setPlainGlass(false);

      const shareOptions = {
        title: 'SmashSpeed Result',
        message: '', // MODIFICATION: Removed the caption
        url: uri,
        type: 'image/png',
      };
      await Share.open(shareOptions);

    } catch (error: any) {
      setPlainGlass(false);
      if (error.message.includes('User did not share') || error.message.includes('Cancel')) {
        return;
      }
      console.error("Share Error:", error);
      Alert.alert('Share Failed', 'An error occurred while trying to share the image.');
    } finally {
      setIsSharing(false);
    }
  };

  const GlassPanel: React.FC<{ style?: any; children: React.ReactNode; plain?: boolean }> = ({
    style,
    children,
    plain,
  }) => {
    if (!plain && Platform.OS === 'ios' && BlurView) {
      return (
        <BlurView intensity={20} tint="light" style={[styles.glassPanel, style]}>
          {children}
        </BlurView>
      );
    }
    return <View style={[styles.glassPanelAndroid, style]}>{children}</View>;
  };

  return (
    <ImageBackground
      source={require('../../assets/aurora_background.png')}
      style={styles.bg}
      imageStyle={styles.bgImage}
    >
      <SafeAreaView style={styles.safeArea}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={{ width: 44 }} />
          <TouchableOpacity onPress={onShare} style={styles.iconBtn} disabled={isSharing}>
            {isSharing ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <Ionicons name="share-outline" size={22} color="#007AFF" />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View ref={shareCardRef} collapsable={false} style={{ backgroundColor: 'transparent' }}>
            <GlassPanel style={[styles.card, { width: CARD_W }]} plain={plainGlass}>
              <View style={{ alignItems: 'center', width: '100%', paddingHorizontal: 2 }}>
                <Text style={styles.cardSubtitle}>Max Speed</Text>

                <Text style={[styles.speedNumber, { fontSize: NUM_FS, lineHeight: NUM_FS * 1.06 }]}>
                  {speedStr}
                </Text>
                <Text style={[styles.speedUnit, { fontSize: UNIT_FS }]}>km/h</Text>

                <View style={styles.divider} />

                {hasAngle ? (
                  <View style={styles.angleRow}>
                    <Text style={styles.angleLabel}>Smash Angle</Text>
                    <Text style={styles.angleValue}>{Math.round(displayAngle)}°</Text>
                  </View>
                ) : (
                  <View style={styles.angleMissing}>
                    <Text style={styles.angleMissingTitle}>Angle not calculated</Text>
                    <Text style={styles.angleMissingNote}>
                      Add angle analysis in a future update to unlock this metric.
                    </Text>
                  </View>
                )}
              </View>
            </GlassPanel>
          </View>
        </View>

        {/* MODIFICATION: Moved button to a new footer view */}
        <View style={styles.footer}>
          <TouchableOpacity onPress={goAnalyzeAnother} style={styles.secondaryBtn}>
            <Ionicons name="arrow-undo-circle" size={20} color="#007AFF" />
            <Text style={styles.secondaryBtnText}>Analyze Another</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, width: '100%', height: '100%' },
  bgImage: { resizeMode: 'cover' },
  safeArea: { flex: 1 },

  topBar: {
    height: 44,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarTitle: { fontSize: 16, fontWeight: '700', color: '#000' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  // MODIFICATION: Adjusted content style to center the card
  content: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Glass panel
  glassPanel: {
    borderRadius: 35,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  glassPanelAndroid: {
    borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.96)',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },

  // Card
  card: {
    paddingVertical: 26,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  cardSubtitle: {
    fontSize: 18,
    color: '#6B7280',
    marginBottom: 8,
  },
  speedNumber: {
    fontWeight: '800',
    color: '#007AFF',
  },
  speedUnit: {
    fontWeight: '600',
    color: '#6B7280',
    marginTop: -6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
    alignSelf: 'stretch',
    marginTop: 18,
    marginBottom: 12,
  },
  angleRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginTop: 2,
  },
  angleLabel: { fontSize: 16, color: '#6B7280', fontWeight: '600' },
  angleValue: { marginLeft: 'auto', fontSize: 18, fontWeight: '700', color: '#111827' },

  angleMissing: { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 2 },
  angleMissingTitle: { fontSize: 16, fontWeight: '700', color: '#6B7280' },
  angleMissingNote: { fontSize: 12, color: '#6B7280', textAlign: 'center', marginTop: 4 },

  // MODIFICATION: New footer style
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 34, // Safe area for home bar
    paddingTop: 10,
    alignItems: 'center',
  },

  // Button
  secondaryBtn: {
    // marginTop: 22, // MODIFICATION: Removed marginTop
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#007AFF',
    fontWeight: '700',
    fontSize: 16,
    marginLeft: 8,
  },
});
