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
import auth from '@react-native-firebase/auth';
import { getFirestore, collection, addDoc, serverTimestamp } from '@react-native-firebase/firestore';
import storage from '@react-native-firebase/storage';
import { trim } from 'react-native-video-trim';
import * as FileSystem from 'expo-file-system';

// Optional dependencies
let BlurView: any;
try {
  BlurView = require('expo-blur').BlurView;
} catch {
  BlurView = null;
}

let captureRef: any;
try {
  captureRef = require('react-native-view-shot').captureRef;
} catch {
  captureRef = null;
}

type SpeedResultParams = {
  maxKph: number;
  angle?: number;
  videoUri?: string;
  startSec?: number;
  endSec?: number;
};

export default function SpeedResultScreen({ route, navigation }: any) {
  const { maxKph, angle, videoUri, startSec, endSec } = route.params as SpeedResultParams;
  
  // Debug logging
  console.log('SpeedResultScreen params:', {
    maxKph,
    angle,
    videoUri,
    startSec,
    endSec,
  });
  
  const hasAngle = typeof angle === 'number' && isFinite(angle) && angle >= 0;

  // Animation states
  const [displaySpeed, setDisplaySpeed] = useState(0);
  const [displayAngle, setDisplayAngle] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;
  const animOnce = useRef(false);

  // UI states
  const { width: SW } = useWindowDimensions();
  const CARD_W = Math.min(440, Math.max(300, SW * 0.92));
  const NUM_FS = Math.round(Math.min(96, Math.max(64, CARD_W * 0.22)));
  const UNIT_FS = Math.round(NUM_FS * 0.28);

  // Share states
  const shareCardRef = useRef<View | null>(null);
  const [plainGlass, setPlainGlass] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [showWatermark, setShowWatermark] = useState(false);

  // Firebase save states
  const [saveStatus, setSaveStatus] = useState<'idle' | 'trimming' | 'saving' | 'saved' | 'not_logged_in' | 'error'>('idle');

  // Animation effect
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

  // Update display values during animation
  useEffect(() => {
    const id = anim.addListener(({ value }) => {
      setDisplaySpeed(value * maxKph);
      if (hasAngle) setDisplayAngle(value * (angle as number));
    });
    return () => anim.removeListener(id);
  }, [anim, maxKph, angle, hasAngle]);

  // Firebase save functionality
  useEffect(() => {
    const saveResult = async () => {
      console.log('Starting save process...');
      const user = auth().currentUser;
      console.log('Current user:', user ? 'Logged in' : 'Not logged in');
      
      if (!user) {
        console.log('Setting save status to not_logged_in');
        setSaveStatus('not_logged_in');
        return;
      }
      
      console.log('Checking video params:', { videoUri, startSec, endSec });
      if (!videoUri || startSec === undefined || endSec === undefined) {
        console.log('Missing video parameters, skipping save');
        return;
      }

      console.log('Starting video trim and upload...');
      setSaveStatus('trimming');
      try {
        const { uid } = user;
        const timestamp = Date.now();
        
        console.log('Trimming video:', { startSec, endSec });
        const resultPath = await trim(videoUri, { 
          startTime: startSec * 1000, 
          endTime: endSec * 1000 
        });
        console.log('Video trimmed to:', resultPath);
        
        setSaveStatus('saving');

        const filename = `${timestamp}.mp4`;
        console.log('Uploading to storage:', filename);
        const storageRef = storage().ref(`videos/${uid}/${filename}`);
        await storageRef.putFile(resultPath);
        const videoURL = await storageRef.getDownloadURL();
        console.log('Video uploaded, URL:', videoURL);

        await FileSystem.deleteAsync(resultPath).catch(console.warn);

        const detectionData = {
          angle: hasAngle ? Math.round(angle as number) : null,
          date: serverTimestamp(),
          peakSpeedKph: Math.round(maxKph),
          videoURL,
        };
        console.log('Saving to Firestore:', detectionData);

        const db = getFirestore();
        await addDoc(collection(db, 'users', uid, 'detections'), detectionData);
        console.log('Successfully saved to Firestore');

        setSaveStatus('saved');
      } catch (error) {
        console.error("Failed to save result:", error);
        setSaveStatus('error');
      }
    };

    // Always attempt to save if we have video data
    if (videoUri && startSec !== undefined && endSec !== undefined) {
      console.log('Video data available, attempting save');
      saveResult();
    } else {
      // Check if user is logged in even without video
      const user = auth().currentUser;
      if (!user) {
        console.log('No video data and not logged in');
        setSaveStatus('not_logged_in');
      } else {
        console.log('No video data but user is logged in');
      }
    }
  }, [maxKph, angle, hasAngle, videoUri, startSec, endSec]);

  const speedStr = useMemo(() => displaySpeed.toFixed(1), [displaySpeed]);

  const goAnalyzeAnother = () => {
    try { navigation.popToTop?.(); } catch {}
    navigation.navigate('Detect');
  };

  // Share functionality
  const onShare = async () => {
    if (isSharing || !captureRef || !shareCardRef.current) {
      Alert.alert('Error', 'Unable to share result at this moment.');
      return;
    }

    try {
      setIsSharing(true);
      setPlainGlass(true);
      
      // Add watermark for sharing
      setShowWatermark(true);
      
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 32)));

      const uri: string = await captureRef(shareCardRef.current, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });

      // Remove watermark and restore glass effect
      setShowWatermark(false);
      setPlainGlass(false);

      const shareOptions = {
        title: 'SmashSpeed Result',
        message: '',
        url: uri,
        type: 'image/png',
      };
      await Share.open(shareOptions);

    } catch (error: any) {
      setShowWatermark(false);
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

  const navigateToLogin = () => {
    navigation.navigate('Auth');
  };

  // Save status indicator
  const renderSaveStatus = () => {
    switch (saveStatus) {
      case 'trimming':
        return <StatusIndicator text="Processing video..." icon={null} />;
      case 'saving':
        return <StatusIndicator text="Saving result..." icon={null} />;
      case 'saved':
        return <StatusIndicator text="Result saved" icon="checkmark-circle" />;
      case 'not_logged_in':
        return (
          <TouchableOpacity onPress={navigateToLogin} style={styles.loginPrompt}>
            <Ionicons name="person-circle" size={16} color="#007AFF" />
            <Text style={styles.loginPromptText}>Sign in to save results</Text>
          </TouchableOpacity>
        );
      case 'error':
        return <StatusIndicator text="Failed to save" icon="alert-circle" />;
      default:
        return null;
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
                ) : maxKph < 100 ? (
                  <View style={styles.angleMissing}>
                    <Text style={styles.angleMissingTitle}>Smash over 100km/h to calculate angle</Text>
                  </View>
                ) : (
                  <View style={styles.angleRow}>
                    <Text style={styles.angleLabel}>Smash Angle</Text>
                    <Text style={styles.angleValue}>--°</Text>
                  </View>
                )}

                {/* Save status */}
                {saveStatus !== 'idle' && (
                  <View style={styles.statusWrapper}>
                    {renderSaveStatus()}
                  </View>
                )}
              </View>

              {/* Watermark for sharing only */}
              {showWatermark && (
                <Text style={styles.watermark}>@smashspeed</Text>
              )}
            </GlassPanel>
          </View>
        </View>

        {/* Footer */}
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

// Status indicator component
function StatusIndicator({ text, icon }: { text: string; icon: string | null }) {
  return (
    <View style={styles.statusContainer}>
      {icon ? (
        <Ionicons name={icon as any} size={16} color="#007AFF" />
      ) : (
        <ActivityIndicator size="small" color="#007AFF" />
      )}
      <Text style={styles.statusText}>{text}</Text>
    </View>
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
  iconBtn: { 
    width: 44, 
    height: 44, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },

  content: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Glass panel styles
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

  // Card styles
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

  // Angle styles
  angleRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginTop: 2,
  },
  angleLabel: { 
    fontSize: 16, 
    color: '#6B7280', 
    fontWeight: '600' 
  },
  angleValue: { 
    marginLeft: 'auto', 
    fontSize: 18, 
    fontWeight: '700', 
    color: '#111827' 
  },
  angleMissing: { 
    alignItems: 'center', 
    paddingHorizontal: 10, 
    paddingVertical: 2 
  },
  angleMissingTitle: { 
    fontSize: 16, 
    fontWeight: '700', 
    color: '#6B7280' 
  },
  angleMissingNote: { 
    fontSize: 12, 
    color: '#6B7280', 
    textAlign: 'center', 
    marginTop: 4 
  },

  // Status styles
  statusWrapper: {
    marginTop: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
  },
  statusText: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '500',
    color: '#007AFF',
  },
  loginPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.2)',
  },
  loginPromptText: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
  },

  // Watermark
  watermark: {
    position: 'absolute',
    bottom: 12,
    right: 16,
    fontSize: 11,
    fontWeight: '600',
    color: '#007AFF',
    opacity: 0.8,
  },

  // Footer styles
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 34,
    paddingTop: 10,
    alignItems: 'center',
  },
  secondaryBtn: {
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