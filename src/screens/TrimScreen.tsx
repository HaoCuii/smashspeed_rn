// src/screens/TrimScreen.tsx
import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Dimensions,
  TouchableOpacity,
  ImageBackground,
  ScrollView,
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

  const { sourceUri = '', duration: durationParam = 0 } = route.params || {};

  const videoRef = React.useRef<VideoHandle | null>(null);
  const lastSeekRef = React.useRef(0);

  const [videoDuration, setVideoDuration] = React.useState(
    Number.isFinite(durationParam) && durationParam > 0 ? durationParam : 0
  );
  const [isExporting, setIsExporting] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [renderVideo, setRenderVideo] = React.useState(true);

  // Handles position in pixels
  const leftHandleX = useSharedValue(0);
  const rightHandleX = useSharedValue(TRACK_WIDTH);
  const startX = useSharedValue(0);

  // Calculated time values based on handle positions
  const [startSec, setStartSec] = React.useState(0);
  const [endSec, setEndSec] = React.useState(0);

  // Initialize endSec when videoDuration changes
  React.useEffect(() => {
    if (videoDuration > 0) {
      setEndSec(videoDuration);
    }
  }, [videoDuration]);

  // Handle focus changes
  React.useEffect(() => {
    if (!isFocused) {
      setPaused(true);
    }
  }, [isFocused]);

  const onVideoLoad = React.useCallback((meta: OnLoadData) => {
    const duration = Number(meta?.duration) || 0;
    if (duration > 0) {
      setVideoDuration(duration);
      // Reset handles to full duration
      rightHandleX.value = TRACK_WIDTH;
      leftHandleX.value = 0;
    }
  }, []);

  const seekThrottled = React.useCallback((time: number) => {
    const now = Date.now();
    if (now - lastSeekRef.current > SEEK_THROTTLE_MS) {
      videoRef.current?.seek(time);
      lastSeekRef.current = now;
    }
  }, []);

  const updateTimesOnJS = React.useCallback((start: number, end: number) => {
    setStartSec(start);
    setEndSec(end);
  }, []);

  // Update start/end times when handles move
  useAnimatedReaction(
    () => ({ left: leftHandleX.value, right: rightHandleX.value }),
    ({ left, right }) => {
      if (videoDuration > 0) {
        const startTime = (left / TRACK_WIDTH) * videoDuration;
        const endTime = (right / TRACK_WIDTH) * videoDuration;
        runOnJS(updateTimesOnJS)(startTime, endTime);
      }
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
          handle.value = wClamp(newX, 0, rightHandleX.value - 1);
        } else {
          handle.value = wClamp(newX, leftHandleX.value + 1, TRACK_WIDTH);
        }
        
        // Seek to the handle position
        if (videoDuration > 0) {
          const time = (handle.value / TRACK_WIDTH) * videoDuration;
          runOnJS(seekThrottled)(time);
        }
      })
      .onEnd(() => {
        handle.value = withSpring(handle.value);
        runOnJS(setPaused)(false); // Resume playback
      });
  };

  const leftPanGesture = createPanGesture(leftHandleX, true);
  const rightPanGesture = createPanGesture(rightHandleX, false);

  const leftHandleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: leftHandleX.value }]
  }));

  const rightHandleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: rightHandleX.value }]
  }));

  const selectedTrackStyle = useAnimatedStyle(() => ({
    left: leftHandleX.value,
    right: TRACK_WIDTH - rightHandleX.value,
  }));

  // Handle video progress and looping
  const onVideoProgress = React.useCallback(
    (prog: OnProgressData) => {
      const currentTime = prog.currentTime ?? 0;
      
      if (!paused && videoDuration > 0) {
        const loopStart = Math.max(0, startSec);
        const loopEnd = Math.min(endSec, videoDuration);
        
        // Always loop within the selected range
        if (currentTime >= loopEnd - LOOP_EPS || currentTime < loopStart) {
          videoRef.current?.seek(loopStart);
        }
      }
    },
    [paused, startSec, endSec, videoDuration]
  );

  const onConfirm = React.useCallback(() => {
    const selectedDuration = endSec - startSec;
    
    if (selectedDuration <= 0) {
      Alert.alert("Invalid Selection", "Please select a valid time range.");
      return;
    }
    
    if (selectedDuration > 0.7) {
      Alert.alert(
        "Clip Too Long",
        `Your selection is ${selectedDuration.toFixed(2)}s. Please select a clip shorter than 0.7s for the best results.`
      );
      return;
    }

    setIsExporting(true);
    setPaused(true);
    
    setTimeout(() => {
      setRenderVideo(false);
      navigation.navigate('Calibration', {
        sourceUri,
        duration: videoDuration,
        startSec,
        endSec
      });
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
              <Text style={styles.title}>Trim to the Smash</Text>
              <Text style={styles.description}>
                Isolate the moment of impact. The final clip should be very short (~0.25 seconds), 
                and the birdie should be clearly visible in each frame.
              </Text>
            </View>

            <View style={styles.videoWrapper}>
              {isFocused && renderVideo && sourceUri ? (
                <Video
                  ref={videoRef}
                  source={{ uri: sourceUri }}
                  style={styles.video}
                  paused={paused}
                  resizeMode="contain"
                  onLoad={onVideoLoad}
                  progressUpdateInterval={50}
                  onProgress={onVideoProgress}
                  playInBackground={false}
                  playWhenInactive={false}
                  repeat={false} // We handle looping manually
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
                <Text style={[styles.timeLabel, styles.durationLabel]}>
                  Selected Duration: {formatTime(endSec - startSec)}
                </Text>
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
    fontSize: 14,
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
    fontSize: 12,
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