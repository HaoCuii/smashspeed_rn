// src/screens/TrimScreen.tsx
import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Dimensions,
  TouchableOpacity,
  ImageBackground,
  ScrollView, // Added ScrollView
  Platform,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useIsFocused } from '@react-navigation/native';
import Video from 'react-native-video';
import type { OnProgressData, OnLoadData } from 'react-native-video';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  useAnimatedReaction,
  runOnJS,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TRIMMER_PADDING = 30;
const TRACK_WIDTH = SCREEN_WIDTH - 2 * TRIMMER_PADDING;
const HANDLE_WIDTH = 30;
const SEEK_THROTTLE_MS = 80;
const LOOP_EPS = 0.05;

const wClamp = (v: number, min: number, max: number) => {
  'worklet';
  return Math.max(min, Math.min(v, max));
};

type RootStackParamList = {
  Trim: { sourceUri: string; duration: number };
  Calibration: { sourceUri: string; duration: number; startSec: number; endSec: number };
};
type TrimRoute = RouteProp<RootStackParamList, 'Trim'>;
type VideoHandle = React.ElementRef<typeof Video>;

const formatTime = (seconds: number) => {
    const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
    const secsFloat = safe.toFixed(2);
    return `${secsFloat}s`;
};

const TrimScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<TrimRoute>();
  const isFocused = useIsFocused();

  const { sourceUri = '', duration: durationParam = 0 } = route.params ?? ({} as any);

  const videoRef = React.useRef<VideoHandle | null>(null);
  const lastSeekRef = React.useRef(0);

  const [videoDuration, setVideoDuration] = React.useState(
    Number.isFinite(durationParam) && durationParam > 0 ? durationParam : 0
  );
  const [isExporting, setIsExporting] = React.useState(false);

  // Handles (px)
  const leftHandleX = useSharedValue(0);
  const rightHandleX = useSharedValue(TRACK_WIDTH);
  const startX = useSharedValue(0);

  // Selected range and playback state
  const [startSec, setStartSec] = React.useState(0);
  const [endSec, setEndSec] = React.useState(videoDuration);
  const [paused, setPaused] = React.useState(true); // Start paused
  const [renderVideo, setRenderVideo] = React.useState(true);

  React.useEffect(() => {
    setEndSec(videoDuration);
  }, [videoDuration]);
  
  React.useEffect(() => {
    if (!isFocused) setPaused(true);
    else videoRef.current?.seek(startSec); // Seek to start on focus
    return () => setPaused(true);
  }, [isFocused, startSec]);

  const onVideoLoad = React.useCallback((meta: OnLoadData) => {
    const d = Number(meta?.duration) || 0;
    if (d > 0) setVideoDuration(d);
  }, []);

  const seekThrottled = React.useCallback((t: number) => {
    const now = Date.now();
    if (now - lastSeekRef.current > SEEK_THROTTLE_MS) {
      videoRef.current?.seek(t);
      lastSeekRef.current = now;
    }
  }, []);

  const updateTimesOnJS = React.useCallback((start: number, end: number) => {
    setStartSec(start);
    setEndSec(end);
  }, []);

  useAnimatedReaction(
    () => ({ l: leftHandleX.value, r: rightHandleX.value }),
    ({ l, r }) => {
      const s = wClamp((l / TRACK_WIDTH) * videoDuration, 0, videoDuration);
      const e = wClamp((r / TRACK_WIDTH) * videoDuration, 0, videoDuration);
      runOnJS(updateTimesOnJS)(s, e);
    },
    [videoDuration]
  );

  const createPanGesture = (handle: Animated.SharedValue<number>, isLeft: boolean) => {
    return Gesture.Pan()
      .onStart(() => {
        startX.value = handle.value;
        runOnJS(setPaused)(true);
      })
      .onUpdate((event) => {
        const newX = startX.value + event.translationX;
        if (isLeft) {
          handle.value = wClamp(newX, 0, rightHandleX.value);
        } else {
          handle.value = wClamp(newX, leftHandleX.value, TRACK_WIDTH);
        }
        const t = wClamp((handle.value / TRACK_WIDTH) * videoDuration, 0, videoDuration);
        runOnJS(seekThrottled)(t);
      })
      .onEnd(() => {
        handle.value = withSpring(handle.value);
        runOnJS(setPaused)(false); // Resume playback on release
      });
  };

  const leftPanGesture = createPanGesture(leftHandleX, true);
  const rightPanGesture = createPanGesture(rightHandleX, false);

  const leftHandleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: leftHandleX.value }] }));
  const rightHandleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: rightHandleX.value }] }));
  const selectedTrackStyle = useAnimatedStyle(() => ({
    left: leftHandleX.value,
    right: TRACK_WIDTH - rightHandleX.value,
  }));

  const onVideoProgress = React.useCallback(
    (prog: OnProgressData) => {
      const t = prog.currentTime ?? 0;
      if (!paused) {
        const loopStart = Number.isFinite(startSec) ? startSec : 0;
        const validRange = Number.isFinite(endSec) && endSec > loopStart + LOOP_EPS;
        const loopEnd = validRange ? endSec : videoDuration;
        if (t >= loopEnd - LOOP_EPS) {
          videoRef.current?.seek(loopStart);
        }
      }
    },
    [paused, startSec, endSec, videoDuration]
  );

  const onConfirm = React.useCallback(() => {
    const selectedDuration = endSec - startSec;
    if (selectedDuration > 0.7) {
      Alert.alert(
        "Clip Too Long",
        `Your selection is ${selectedDuration.toFixed(2)}s. Please select a clip shorter than 0.7s for the best results.`,
        [{ text: "OK" }]
      );
      return;
    }

    setIsExporting(true);
    setPaused(true);
    setTimeout(() => {
      setRenderVideo(false);
      // @ts-ignore
      navigation.navigate('Calibration', { sourceUri, duration: videoDuration, startSec, endSec });
      setIsExporting(false);
    }, 500);
  }, [navigation, sourceUri, videoDuration, startSec, endSec]);

  const onCancel = React.useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ImageBackground
        style={styles.container}
        source={require('../../assets/aurora_background.png')}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }}>
          <Modal visible={isExporting} transparent animationType="fade">
            <View style={styles.exportingOverlay}>
              <View style={styles.exportingBox}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.exportingText}>Trimming video...</Text>
              </View>
            </View>
          </Modal>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.header}>
              <Text style={styles.title}>Trim Video</Text>
              <Text style={styles.description}>Isolate the moment of impact for the most accurate analysis.</Text>
            </View>

            <View style={styles.videoWrapper}>
              {isFocused && renderVideo ? (
                <Video
                  ref={videoRef}
                  key={sourceUri}
                  source={{ uri: sourceUri }}
                  style={styles.video}
                  paused={paused}
                  resizeMode="contain"
                  onLoad={onVideoLoad}
                  progressUpdateInterval={50}
                  onProgress={onVideoProgress}
                  playInBackground={false}
                  playWhenInactive={false}
                />
              ) : null}
            </View>

            <View style={styles.trimmerContainer}>
              <View style={styles.trackContainer}>
                <View style={styles.track} />
                <Animated.View style={[styles.selectedTrack, selectedTrackStyle]} />
                <GestureDetector gesture={leftPanGesture}>
                  <Animated.View style={[styles.handle, { left: -HANDLE_WIDTH / 2 }, leftHandleStyle]}>
                    <View style={styles.handleIndicator} />
                  </Animated.View>
                </GestureDetector>
                <GestureDetector gesture={rightPanGesture}>
                  <Animated.View style={[styles.handle, { left: -HANDLE_WIDTH / 2 }, rightHandleStyle]}>
                    <View style={styles.handleIndicator} />
                  </Animated.View>
                </GestureDetector>
              </View>
              <View style={styles.timeLabelContainer}>
                <Text style={styles.timeLabel}>{formatTime(startSec)}</Text>
                <Text style={[styles.timeLabel, styles.durationLabel]}>{formatTime(endSec - startSec)}</Text>
                <Text style={styles.timeLabel}>{formatTime(endSec)}</Text>
              </View>
            </View>
            
            <View style={styles.spacer} />

            <View style={styles.buttonContainer}>
              <TouchableOpacity onPress={onCancel} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onConfirm} style={styles.confirmButton}>
                <Text style={styles.confirmButtonText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
    container: { 
      flex: 1, 
    },
    scrollContent: {
      flexGrow: 1,
      padding: 20,
      justifyContent: 'space-between',
    },
    header: {
      alignItems: 'center',
      marginBottom: 20,
    },
    title: { 
      fontSize: 32, 
      fontWeight: 'bold',
      color: '#1c1c1e',
    },
    description: {
      fontSize: 16,
      color: '#6c6c70',
      textAlign: 'center',
      marginTop: 8,
      maxWidth: '85%',
    },
    videoWrapper: {
      height: 300,
      borderRadius: 16,
      backgroundColor: '#000',
      marginBottom: 30,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 8,
    },
    video: { 
      width: '100%', 
      height: '100%' 
    },
    trimmerContainer: { 
      paddingHorizontal: TRIMMER_PADDING - 20,
    },
    trackContainer: { 
      height: 60, 
      width: TRACK_WIDTH, 
      justifyContent: 'center', 
      alignSelf: 'center',
    },
    track: { 
      height: 8, 
      backgroundColor: '#d1d1d6', 
      borderRadius: 4,
    },
    selectedTrack: { 
      height: 8, 
      backgroundColor: '#007AFF', 
      borderRadius: 4, 
      position: 'absolute' 
    },
    handle: { 
      width: HANDLE_WIDTH, 
      height: '100%', 
      position: 'absolute', 
      justifyContent: 'center', 
      alignItems: 'center',
    },
    handleIndicator: {
      width: 24, 
      height: 24, 
      backgroundColor: '#fff', 
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.1)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 5,
    },
    timeLabelContainer: { 
      flexDirection: 'row', 
      justifyContent: 'space-between', 
      marginTop: 4,
    },
    timeLabel: { 
      color: '#3c3c43', 
      fontSize: 14,
      fontWeight: '500',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    durationLabel: {
      color: '#007AFF',
      fontWeight: 'bold',
    },
    spacer: {
      flex: 1,
      minHeight: 20,
    },
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    cancelButton: {
      flex: 1,
      backgroundColor: '#e5e5ea',
      paddingVertical: 16,
      borderRadius: 14,
      alignItems: 'center',
    },
    cancelButtonText: {
      color: '#007AFF',
      fontSize: 17,
      fontWeight: '600',
    },
    confirmButton: {
      flex: 1,
      backgroundColor: '#007AFF',
      paddingVertical: 16,
      borderRadius: 14,
      alignItems: 'center',
    },
    confirmButtonText: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '600',
    },
    exportingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    exportingBox: {
      backgroundColor: 'white',
      padding: 30,
      borderRadius: 20,
      alignItems: 'center',
      gap: 15,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 10,
    },
    exportingText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#3c3c43'
    },
  });
  
  export default TrimScreen;