// src/screens/TrimScreen.tsx
import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  SafeAreaView,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Video from 'react-native-video';
import type { OnProgressData } from 'react-native-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  useAnimatedReaction,
  runOnJS,
} from 'react-native-reanimated';

// ---------- Constants ----------
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TRIMMER_PADDING = 30;
const TRACK_WIDTH = SCREEN_WIDTH - 2 * TRIMMER_PADDING;
const HANDLE_WIDTH = 20;
const SEEK_THROTTLE_MS = 80; // keep scrubbing smooth

// ---------- Worklet helpers ----------
const wClamp = (v: number, min: number, max: number) => {
  'worklet';
  return Math.max(min, Math.min(v, max));
};

// ---------- Types ----------
type RootStackParamList = {
  Trim: { sourceUri: string; duration: number };
};
type TrimRoute = RouteProp<RootStackParamList, 'Trim'>;

type VideoHandle = React.ElementRef<typeof Video>; // instance type (has .seek)

// ---------- Helpers ----------
const formatTime = (seconds: number) => {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const mins = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const secsFloat = safe - Math.floor(safe / 60) * 60;
  let secsStr = secsFloat.toFixed(2);
  if (secsFloat < 10) secsStr = `0${secsStr}`; // 01:03.50
  return `${mins}:${secsStr}`;
};

// ---------- Screen ----------
const TrimScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<TrimRoute>();
  const { sourceUri = '', duration: rawDuration = 0 } = route.params ?? ({} as any);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;

  const videoRef = React.useRef<VideoHandle | null>(null);
  const lastSeekRef = React.useRef(0);

  // Handles (in px, relative to track left)
  const leftHandleX = useSharedValue(0);
  const rightHandleX = useSharedValue(TRACK_WIDTH - HANDLE_WIDTH);
  const startX = useSharedValue(0);

  // Selected times (seconds) + labels
  const [startSec, setStartSec] = React.useState(0);
  const [endSec, setEndSec] = React.useState(duration);
  const [startTime, setStartTime] = React.useState('00:00.00');
  const [endTime, setEndTime] = React.useState(formatTime(duration));

  // Preview mode: after tapping Done, loop within [startSec, endSec]
  const [isPreview, setIsPreview] = React.useState(false);

  React.useEffect(() => {
    setEndSec(duration);
    setEndTime(formatTime(duration));
  }, [duration]);

  // Seek with light throttling (JS)
  const seekThrottled = React.useCallback((t: number) => {
    const now = Date.now();
    if (now - lastSeekRef.current > SEEK_THROTTLE_MS) {
      videoRef.current?.seek(t);
      lastSeekRef.current = now;
    }
  }, []);

  // Update state from UI thread
  const updateTimesOnJS = React.useCallback((start: number, end: number) => {
    setStartSec(start);
    setEndSec(end);
    setStartTime(formatTime(start));
    setEndTime(formatTime(end));
  }, []);

  // UI ➜ JS: compute times from handles continuously
  useAnimatedReaction(
    () => ({ l: leftHandleX.value, r: rightHandleX.value }),
    ({ l, r }) => {
      const denom = TRACK_WIDTH - HANDLE_WIDTH || 1;
      const s = wClamp((l / denom) * duration, 0, duration);
      const e = wClamp((r / denom) * duration, 0, duration);
      runOnJS(updateTimesOnJS)(s, e);
    },
    [duration]
  );

  // Gestures (also scrub the video in real-time)
  const leftPanGesture = Gesture.Pan()
    .onStart(() => {
      startX.value = leftHandleX.value;
    })
    .onUpdate((event) => {
      const newX = startX.value + event.translationX;
      leftHandleX.value = wClamp(newX, 0, rightHandleX.value - HANDLE_WIDTH);

      // scrub to left handle time
      const denom = TRACK_WIDTH - HANDLE_WIDTH || 1;
      const t = wClamp((leftHandleX.value / denom) * duration, 0, duration);
      runOnJS(seekThrottled)(t);
    })
    .onEnd(() => {
      leftHandleX.value = withSpring(leftHandleX.value);
    });

  const rightPanGesture = Gesture.Pan()
    .onStart(() => {
      startX.value = rightHandleX.value;
    })
    .onUpdate((event) => {
      const newX = startX.value + event.translationX;
      rightHandleX.value = wClamp(newX, leftHandleX.value + HANDLE_WIDTH, TRACK_WIDTH - HANDLE_WIDTH);

      // scrub to right handle time
      const denom = TRACK_WIDTH - HANDLE_WIDTH || 1;
      const t = wClamp((rightHandleX.value / denom) * duration, 0, duration);
      runOnJS(seekThrottled)(t);
    })
    .onEnd(() => {
      rightHandleX.value = withSpring(rightHandleX.value);
    });

  // Animated styles
  const leftHandleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: leftHandleX.value }],
  }));
  const rightHandleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: rightHandleX.value }],
  }));
  const selectedTrackStyle = useAnimatedStyle(() => ({
    left: leftHandleX.value + HANDLE_WIDTH / 2,
    right: TRACK_WIDTH - rightHandleX.value - HANDLE_WIDTH / 2,
  }));

  // Loop inside selection during preview
  const onVideoProgress = React.useCallback(
    (prog: OnProgressData) => {
      if (!isPreview) return;
      const t = prog.currentTime ?? 0;
      if (t < startSec - 0.02 || t > endSec + 0.02) {
        videoRef.current?.seek(startSec);
      }
      if (t >= endSec) {
        // loop back smoothly
        videoRef.current?.seek(startSec);
      }
    },
    [isPreview, startSec, endSec]
  );

  // Enter preview: seek to start and loop
  const onDone = React.useCallback(() => {
    setIsPreview(true);
    requestAnimationFrame(() => videoRef.current?.seek(startSec));
  }, [startSec]);

  // Optional: exit preview to keep trimming
  const exitPreview = React.useCallback(() => {
    setIsPreview(false);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Trim Video</Text>
        {isPreview ? (
          <TouchableOpacity onPress={exitPreview}>
            <Text style={styles.doneButton}>Edit</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onDone}>
            <Text style={styles.doneButton}>Done</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Video */}
      <View style={styles.videoContainer}>
        <Video
          ref={videoRef}
          key={sourceUri}
          source={{ uri: sourceUri }}
          style={styles.video}
          controls
          paused={false}
          resizeMode="contain"
          onProgress={onVideoProgress}
          onError={(e) => {
            console.error('Video error', e);
          }}
        />
      </View>

      {/* Trimmer */}
      {!isPreview && (
        <View style={styles.trimmerContainer}>
          <View style={styles.timeLabelContainer}>
            <Text style={styles.timeLabel}>{startTime}</Text>
            <Text style={styles.timeLabel}>{endTime}</Text>
          </View>

          <View style={styles.trackContainer}>
            <Animated.View style={[styles.selectedTrack, selectedTrackStyle]} />
            <View style={styles.track} />

            <GestureDetector gesture={leftPanGesture}>
              <Animated.View style={[styles.handle, leftHandleStyle]}>
                <View style={styles.handleIndicator} />
              </Animated.View>
            </GestureDetector>

            <GestureDetector gesture={rightPanGesture}>
              <Animated.View style={[styles.handle, rightHandleStyle]}>
                <View style={styles.handleIndicator} />
              </Animated.View>
            </GestureDetector>
          </View>
        </View>
      )}

      {/* Preview labels shown while looping */}
      {isPreview && (
        <View style={[styles.trimmerContainer, { paddingTop: 12 }]}>
          <View style={styles.timeLabelContainer}>
            <Text style={styles.timeLabel}>Start: {startTime}</Text>
            <Text style={styles.timeLabel}>End: {endTime}</Text>
          </View>
          <Text style={[styles.timeLabel, { textAlign: 'center', opacity: 0.75 }]}>
            Previewing trimmed segment
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
};

// ---------- Styles ----------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  doneButton: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  videoContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  trimmerContainer: {
    width: '100%',
    padding: TRIMMER_PADDING,
    paddingVertical: 40,
  },
  timeLabelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  timeLabel: {
    color: '#fff',
    fontSize: 14,
  },
  trackContainer: {
    height: 40,
    width: TRACK_WIDTH,
    justifyContent: 'center',
    alignSelf: 'center',
  },
  track: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
  },
  selectedTrack: {
    height: 6,
    backgroundColor: '#007AFF',
    borderRadius: 3,
    position: 'absolute',
  },
  handle: {
    width: HANDLE_WIDTH,
    height: 40,
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  handleIndicator: {
    width: 6,
    height: 24,
    backgroundColor: '#fff',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.5)',
  },
});

export default TrimScreen;
