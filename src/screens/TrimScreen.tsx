// src/screens/TrimScreen.tsx
import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Video from 'react-native-video';
import type { OnProgressData, OnLoadData } from 'react-native-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
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
const HANDLE_WIDTH = 20;
const SEEK_THROTTLE_MS = 80;
const LOOP_EPS = 0.05; // slightly larger epsilon for safety

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
  const mins = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const secsFloat = safe - Math.floor(safe / 60) * 60;
  let secsStr = secsFloat.toFixed(2);
  if (secsFloat < 10) secsStr = `0${secsStr}`;
  return `${mins}:${secsStr}`;
};

const TrimScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<TrimRoute>();
  const { sourceUri = '', duration: durationParam = 0 } = route.params ?? ({} as any);

  const videoRef = React.useRef<VideoHandle | null>(null);
  const lastSeekRef = React.useRef(0);

  const [videoDuration, setVideoDuration] = React.useState(
    Number.isFinite(durationParam) && durationParam > 0 ? durationParam : 0
  );

  // Handles (px)
  const leftHandleX = useSharedValue(0);
  const rightHandleX = useSharedValue(TRACK_WIDTH - HANDLE_WIDTH);
  const startX = useSharedValue(0);

  // Selected range and playback state
  const [startSec, setStartSec] = React.useState(0);
  const [endSec, setEndSec] = React.useState(videoDuration);
  const [startTime, setStartTime] = React.useState('00:00.00');
  const [endTime, setEndTime] = React.useState(formatTime(videoDuration));
  const [nowSec, setNowSec] = React.useState(0);
  const [isPreview, setIsPreview] = React.useState(false);

  // CHANGED: start unpaused so we autoplay & loop during editing
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    setEndSec(videoDuration);
    setEndTime(formatTime(videoDuration));
  }, [videoDuration]);

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
    setStartTime(formatTime(start));
    setEndTime(formatTime(end));
  }, []);

  // Handy helper to ensure playback is running when user interacts
  const resumePlayback = React.useCallback(() => setPaused(false), []);

  useAnimatedReaction(
    () => ({ l: leftHandleX.value, r: rightHandleX.value }),
    ({ l, r }: { l: number; r: number }) => {
      const denom = TRACK_WIDTH - HANDLE_WIDTH || 1;
      const s = wClamp((l / denom) * videoDuration, 0, videoDuration);
      const e = wClamp((r / denom) * videoDuration, 0, videoDuration);
      runOnJS(updateTimesOnJS)(s, e);
    },
    [videoDuration]
  );

  const leftPanGesture = Gesture.Pan()
    .onStart(() => {
      startX.value = leftHandleX.value;
      // CHANGED: ensure playback so we can see the loop live while trimming
      runOnJS(resumePlayback)();
    })
    .onUpdate((event) => {
      const newX = startX.value + event.translationX;
      leftHandleX.value = wClamp(newX, 0, rightHandleX.value - HANDLE_WIDTH);
      const denom = TRACK_WIDTH - HANDLE_WIDTH || 1;
      const t = wClamp((leftHandleX.value / denom) * videoDuration, 0, videoDuration);
      runOnJS(seekThrottled)(t);
    })
    .onEnd(() => {
      leftHandleX.value = withSpring(leftHandleX.value);
    });

  const rightPanGesture = Gesture.Pan()
    .onStart(() => {
      startX.value = rightHandleX.value;
      // CHANGED: ensure playback so we can see the loop live while trimming
      runOnJS(resumePlayback)();
    })
    .onUpdate((event) => {
      const newX = startX.value + event.translationX;
      rightHandleX.value = wClamp(newX, leftHandleX.value + HANDLE_WIDTH, TRACK_WIDTH - HANDLE_WIDTH);
      const denom = TRACK_WIDTH - HANDLE_WIDTH || 1;
      const t = wClamp((rightHandleX.value / denom) * videoDuration, 0, videoDuration);
      runOnJS(seekThrottled)(t);
    })
    .onEnd(() => {
      rightHandleX.value = withSpring(rightHandleX.value);
    });

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

  // CHANGED: Loop regardless of preview mode; loop only while playing
  const onVideoProgress = React.useCallback(
    (prog: OnProgressData) => {
      const t = prog.currentTime ?? 0;
      setNowSec(t);

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

  const onPreview = React.useCallback(() => {
    if (!(endSec > startSec)) return;
    setIsPreview(true);
    setPaused(false);
    requestAnimationFrame(() => videoRef.current?.seek(startSec));
  }, [startSec, endSec]);

  const onCalibrate = React.useCallback(() => {
    // @ts-ignore
    navigation.navigate('Calibration', { sourceUri, duration: videoDuration, startSec, endSec });
  }, [navigation, sourceUri, videoDuration, startSec, endSec]);

  const exitPreview = React.useCallback(() => {
    setIsPreview(false);
    // CHANGED: keep playing so edit mode live-loops the trimmed range
    setPaused(false);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {isPreview ? (
          <TouchableOpacity onPress={onCalibrate} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.doneButton}>Calibrate</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 88 }} />
        )}
        <Text style={styles.title}>Trim Video</Text>
        {isPreview ? (
          <TouchableOpacity onPress={exitPreview}>
            <Text style={styles.doneButton}>Edit</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onPreview} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.doneButton}>Done</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.videoContainer}>
        <Video
          ref={videoRef}
          key={sourceUri}
          source={{ uri: sourceUri }}
          style={styles.video}
          controls={!isPreview}
          paused={paused}
          resizeMode="contain"
          onLoad={onVideoLoad}
          progressUpdateInterval={33}
          onProgress={onVideoProgress}
          // CHANGED: always jump back to current loop start on natural end
          onEnd={() => {
            const loopStart = Number.isFinite(startSec) ? startSec : 0;
            videoRef.current?.seek(loopStart);
          }}
          onError={(e) => console.error('Video error', e)}
        />
        <View style={styles.clockPill}>
          <Text style={styles.clockText}>
            {formatTime(nowSec)} / {formatTime(videoDuration)}
          </Text>
        </View>
      </View>

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

      {isPreview && (
        <View style={[styles.trimmerContainer, { paddingTop: 12 }]}>
          <View style={styles.timeLabelContainer}>
            <Text style={styles.timeLabel}>Start: {formatTime(startSec)}</Text>
            <Text style={styles.timeLabel}>End: {formatTime(endSec)}</Text>
          </View>
          <Text style={[styles.timeLabel, { textAlign: 'center', opacity: 0.75 }]}>
            Previewing {formatTime(startSec)}–{formatTime(endSec)}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center' },
  header: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#000',
    zIndex: 10,
    elevation: 10,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  doneButton: { color: '#007AFF', fontSize: 16, fontWeight: '600' },
  videoContainer: { flex: 1, width: '100%', justifyContent: 'center' },
  video: { width: '100%', height: '100%' },
  clockPill: {
    position: 'absolute',
    right: 12,
    top: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  clockText: { color: '#fff', fontVariant: ['tabular-nums'] },
  trimmerContainer: { width: '100%', padding: TRIMMER_PADDING, paddingVertical: 40 },
  timeLabelContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  timeLabel: { color: '#fff', fontSize: 14 },
  trackContainer: { height: 40, width: TRACK_WIDTH, justifyContent: 'center', alignSelf: 'center' },
  track: { height: 4, backgroundColor: 'rgba(255, 255, 255, 0.3)', borderRadius: 2 },
  selectedTrack: { height: 6, backgroundColor: '#007AFF', borderRadius: 3, position: 'absolute' },
  handle: { width: HANDLE_WIDTH, height: 40, position: 'absolute', justifyContent: 'center', alignItems: 'center' },
  handleIndicator: {
    width: 6, height: 24, backgroundColor: '#fff', borderRadius: 3, borderWidth: 1, borderColor: 'rgba(0,0,0,0.5)',
  },
});

export default TrimScreen;
