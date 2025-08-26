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
import { getFirestore, collection, addDoc, serverTimestamp } from '@react-native-firebase/firestore';
import { getStorage, ref, putFile, getDownloadURL } from '@react-native-firebase/storage';
import { getAuth } from '@react-native-firebase/auth';
import { trim } from 'react-native-video-trim';
import * as FileSystem from 'expo-file-system';
import { BlurView } from 'expo-blur';
import { captureRef } from 'react-native-view-shot';

// Type Definitions
type VBox = { x: number; y: number; width: number; height: number; };
type FrameData = {
  timestamp: number;
  speedKPH: number;
  boundingBox: VBox;
};
type SpeedResultParams = {
  maxKph: number;
  angle?: number;
  videoUri?: string;
  startSec?: number;
  endSec?: number;
  frameData?: FrameData[];
};

const toFileUri = (p: string) => (p?.startsWith('file://') ? p : `file://${p}`);

const GlassPanel: React.FC<{ style?: any; children: React.ReactNode }> = ({
  style,
  children,
}) => {
  return (
    <BlurView intensity={80} tint="light" style={style}>
      {children}
    </BlurView>
  );
};

export default function SpeedResultScreen({ route, navigation }: any) {
  const { maxKph, angle, videoUri, startSec, endSec, frameData } = route.params as SpeedResultParams;
  const hasAngle = typeof angle === 'number' && isFinite(angle);

  const [displaySpeed, setDisplaySpeed] = useState(0);
  const [displayAngle, setDisplayAngle] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;
  const animOnce = useRef(false);

  const { width: SW } = useWindowDimensions();
  const CARD_W = Math.min(440, Math.max(300, SW * 0.92));
  const NUM_FS = Math.round(Math.min(96, Math.max(64, CARD_W * 0.22)));
  const UNIT_FS = Math.round(NUM_FS * 0.28);

  const shareCardRef = useRef<View | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [showWatermark, setShowWatermark] = useState(false);

  const [saveStatus, setSaveStatus] = useState<'idle' | 'trimming' | 'saving' | 'saved' | 'not_logged_in' | 'error'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);

  // Initialize Firebase services
  const db = getFirestore();
  const storage = getStorage();
  const auth = getAuth();

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

  useEffect(() => {
    const saveResult = async () => {
      const user = auth.currentUser;
      if (!user) {
        setSaveStatus('not_logged_in');
        return;
      }

      if (!videoUri || startSec === undefined || endSec === undefined) return;

      setSaveStatus('trimming');
      
      try {
        const { uid } = user;
        const timestamp = Date.now();

        const trimmedPath = await trim(videoUri, {
          startTime: startSec * 1000,
          endTime: endSec * 1000,
        });

        const fileUri = toFileUri(trimmedPath);

        setSaveStatus('saving');
        setUploadProgress(0);

        const filename = `${timestamp}.mp4`;
        const remotePath = `videos/${uid}/${filename}`;
        const storageRef = ref(storage, remotePath);

        await putFile(storageRef, fileUri, { contentType: 'video/mp4' });
        const videoURL = await getDownloadURL(storageRef);

        await FileSystem.deleteAsync(fileUri, { idempotent: true });

        const detectionData = {
          angle: hasAngle ? Math.round(angle as number) : null,
          date: serverTimestamp(),
          peakSpeedKph: Math.round(maxKph),
          videoURL,
          userId: uid,
          frameData: frameData || [],
        };

        const detectionsRef = collection(db, 'users', uid, 'detections');
        await addDoc(detectionsRef, detectionData);
        
        setSaveStatus('saved');
        setUploadProgress(100);
      } catch (error) {
        console.error('Failed to save result:', error);
        setSaveStatus('error');
        setUploadProgress(0);
        if (error instanceof Error) {
            Alert.alert('Upload Failed', 'An error occurred while saving your result.');
        }
      }
    };

    if (videoUri && startSec !== undefined && endSec !== undefined) {
      saveResult();
    } else if (!auth.currentUser) {
      setSaveStatus('not_logged_in');
    }
  }, [maxKph, angle, hasAngle, videoUri, startSec, endSec, frameData, db, storage, auth]);

  const speedStr = useMemo(() => displaySpeed.toFixed(1), [displaySpeed]);

  const goAnalyzeAnother = () => {
    navigation.popToTop?.();
    navigation.navigate('Detect');
  };

  const onShare = async () => {
    if (isSharing || !shareCardRef.current) return;

    try {
      setIsSharing(true);
      setShowWatermark(true);
      await new Promise<void>((r) => setTimeout(r, 50));

      const uri: string = await captureRef(shareCardRef.current, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });

      setShowWatermark(false);
      await Share.open({ url: uri, type: 'image/png' });
    } catch (error: any) {
      setShowWatermark(false);
      if (!error?.message?.includes('User did not share')) {
        Alert.alert('Share Failed', 'An error occurred.');
      }
    } finally {
      setIsSharing(false);
    }
  };

  const navigateToLogin = () => navigation.navigate('Auth');

  const renderSaveStatus = () => {
    switch (saveStatus) {
      case 'trimming': return <StatusIndicator text="Processing video..." />;
      case 'saving': return <StatusIndicator text={`Uploading... ${uploadProgress}%`} />;
      case 'saved': return <StatusIndicator text="Result saved" icon="checkmark-circle" />;
      case 'not_logged_in':
        return (
          <TouchableOpacity onPress={navigateToLogin} style={styles.loginPrompt}>
            <Ionicons name="person-circle" size={16} color="#007AFF" />
            <Text style={styles.loginPromptText}>Sign in to save results</Text>
          </TouchableOpacity>
        );
      case 'error': return <StatusIndicator text="Failed to save" icon="alert-circle" />;
      default: return null;
    }
  };

  return (
    <ImageBackground
      source={require('../../assets/aurora_background.png')}
      style={styles.bg}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
             <Ionicons name="close-outline" size={26} color="#007AFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={onShare} style={styles.iconBtn} disabled={isSharing}>
            {isSharing ? <ActivityIndicator size="small" color="#007AFF" /> : <Ionicons name="share-outline" size={22} color="#007AFF" />}
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View ref={shareCardRef} collapsable={false}>
            <GlassPanel style={[styles.card, { width: CARD_W }]}>
              <View style={styles.cardContent}>
                <Text style={styles.cardSubtitle}>Max Speed</Text>
                <Text style={[styles.speedNumber, { fontSize: NUM_FS, lineHeight: NUM_FS * 1.06 }]}>{speedStr}</Text>
                <Text style={[styles.speedUnit, { fontSize: UNIT_FS }]}>km/h</Text>
                <View style={styles.divider} />
                {hasAngle ? (
                  <View style={styles.angleRow}>
                    <Text style={styles.angleLabel}>Smash Angle</Text>
                    <Text style={styles.angleValue}>{Math.round(displayAngle)}°</Text>
                  </View>
                ) : (
                  <View style={styles.angleRow}>
                    <Text style={styles.angleLabel}>Smash Angle</Text>
                    <Text style={styles.angleValue}>--°</Text>
                  </View>
                )}
                {saveStatus !== 'idle' && <View style={styles.statusWrapper}>{renderSaveStatus()}</View>}
              </View>
              {showWatermark && <Text style={styles.watermark}>@smashspeed</Text>}
            </GlassPanel>
          </View>
        </View>

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

function StatusIndicator({ text, icon }: { text: string; icon?: string }) {
  return (
    <View style={styles.statusContainer}>
      {icon ? <Ionicons name={icon as any} size={16} color="#007AFF" /> : <ActivityIndicator size="small" color="#007AFF" />}
      <Text style={styles.statusText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  safeArea: { flex: 1 },
  topBar: { height: 44, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, paddingHorizontal: 20, justifyContent: 'center', alignItems: 'center' },
  card: { borderRadius: 35, overflow: 'hidden' },
  cardContent: { paddingVertical: 26, paddingHorizontal: 22, alignItems: 'center', width: '100%' },
  cardSubtitle: { fontSize: 18, color: '#6B7280', marginBottom: 8 },
  speedNumber: { fontWeight: '800', color: '#007AFF' },
  speedUnit: { fontWeight: '600', color: '#6B7280', marginTop: -6 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB', alignSelf: 'stretch', marginTop: 18, marginBottom: 12 },
  angleRow: { flexDirection: 'row', alignSelf: 'stretch', alignItems: 'center', paddingHorizontal: 6, marginTop: 2 },
  angleLabel: { fontSize: 16, color: '#6B7280', fontWeight: '600' },
  angleValue: { marginLeft: 'auto', fontSize: 18, fontWeight: '700', color: '#111827' },
  statusWrapper: { marginTop: 18 },
  statusContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(0, 122, 255, 0.1)' },
  statusText: { marginLeft: 6, fontSize: 12, fontWeight: '500', color: '#007AFF' },
  loginPrompt: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(0, 122, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(0, 122, 255, 0.2)' },
  loginPromptText: { marginLeft: 6, fontSize: 12, fontWeight: '600', color: '#007AFF' },
  watermark: { position: 'absolute', bottom: 12, right: 16, fontSize: 11, fontWeight: '600', color: '#007AFF', opacity: 0.8 },
  footer: { paddingHorizontal: 20, paddingBottom: 34, paddingTop: 10, alignItems: 'center' },
  secondaryBtn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center' },
  secondaryBtnText: { color: '#007AFF', fontWeight: '700', fontSize: 16, marginLeft: 8 },
});