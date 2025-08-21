import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Dimensions,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Video from 'react-native-video';
import type { OnProgressData, OnLoadData } from 'react-native-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useAnimatedReaction,
  runOnJS,
} from 'react-native-reanimated';
import { RootStackParamList } from '../../App';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TRIMMER_PADDING = 30;
const TRACK_WIDTH = SCREEN_WIDTH - 2 * TRIMMER_PADDING;
const HANDLE_WIDTH = 20;
const EFFECTIVE_TRACK_WIDTH = TRACK_WIDTH - HANDLE_WIDTH;
const LOOP_EPSILON = 0.05;

const formatTime = (seconds: number) => {
  const safeSeconds = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(
    remainingSeconds.toFixed(2)
  ).padStart(5, '0')}`;
};

const clamp = (value: number, min: number, max: number) => {
  'worklet';
  return Math.max(min, Math.min(value, max));
};

type TrimRoute = RouteProp<RootStackParamList, 'Trim'>;
type VideoHandle = React.ElementRef<typeof Video>;

const TrimScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<TrimRoute>();
  const { sourceUri, duration: initialDuration = 0 } = route.params;

  const videoRef = React.useRef<VideoHandle | null>(null);

  const [videoDuration, setVideoDuration] = React.useState(initialDuration);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [startTimeStr, setStartTimeStr] = React.useState('00:00.00');
  const [endTimeStr, setEndTimeStr] = React.useState(
    formatTime(initialDuration)
  );

  const leftHandleX = useSharedValue(0);
  const rightHandleX = useSharedValue(EFFECTIVE_TRACK_WIDTH);
  const dragContextX = useSharedValue(0);

  const startSec = useDerivedValue(() => {
    if (videoDuration === 0) return 0;
    return (leftHandleX.value / EFFECTIVE_TRACK_WIDTH) * videoDuration;
  }, [videoDuration]);

  const endSec = useDerivedValue(() => {
    if (videoDuration === 0) return 0;
    return (rightHandleX.value / EFFECTIVE_TRACK_WIDTH) * videoDuration;
  }, [videoDuration]);

  const onVideoLoad = React.useCallback((meta: OnLoadData) => {
    if (meta.duration && meta.duration > 0) {
      setVideoDuration(meta.duration);
      setEndTimeStr(formatTime(meta.duration));
    }
  }, []);

  const updateTimeStrings = React.useCallback((start: number, end: number) => {
    setStartTimeStr(formatTime(start));
    setEndTimeStr(formatTime(end));
  }, []);

  useAnimatedReaction(
    () => ({ start: startSec.value, end: endSec.value }),
    (current, previous) => {
      if (current.start !== previous?.start || current.end !== previous?.end) {
        runOnJS(updateTimeStrings)(current.start, current.end);
      }
    },
    [updateTimeStrings]
  );

  const seekVideo = React.useCallback((time: number) => {
    videoRef.current?.seek(time);
  }, []);

  const leftPanGesture = Gesture.Pan()
    .onStart(() => {
      dragContextX.value = leftHandleX.value;
    })
    .onUpdate((event) => {
      const newX = dragContextX.value + event.translationX;
      leftHandleX.value = clamp(newX, 0, rightHandleX.value - HANDLE_WIDTH);
      runOnJS(seekVideo)(startSec.value);
    });

  const rightPanGesture = Gesture.Pan()
    .onStart(() => {
      dragContextX.value = rightHandleX.value;
    })
    .onUpdate((event) => {
      const newX = dragContextX.value + event.translationX;
      rightHandleX.value = clamp(
        newX,
        leftHandleX.value + HANDLE_WIDTH,
        EFFECTIVE_TRACK_WIDTH
      );
      runOnJS(seekVideo)(endSec.value);
    });

  const onVideoProgress = React.useCallback(
    (progress: OnProgressData) => {
      setCurrentTime(progress.currentTime);

        const loopStart = startSec.value;
        const loopEnd = endSec.value;
        const isValidRange = loopEnd > loopStart + LOOP_EPSILON;
        if (isValidRange && progress.currentTime >= loopEnd - LOOP_EPSILON) {
          videoRef.current?.seek(loopStart);
        }

    },
    []
  );

  const onCalibrate = React.useCallback(() => {
    const s = startSec.value;
    const e = endSec.value;
    const duration = e - s;

    if (duration < 0.1) {
      Alert.alert(
        'Selection Too Short',
        'Please select a longer video segment.'
      );
      return;
    }

    if (duration > 1) {
      Alert.alert(
        'Selection Too Long',
        'Please select a shorter video segment.'
      );
      return;
    }

    navigation.navigate('Calibration', {
      sourceUri,
      duration,
      startSec: s,
      endSec: e,
    });
  }, [navigation, sourceUri]);

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Trim Video</Text>
        <TouchableOpacity onPress={onCalibrate} style={styles.calibrateButton}>
          <Text style={styles.calibrateText}>Calibrate</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.videoContainer}>
        <Video
          ref={videoRef}
          source={{ uri: sourceUri }}
          style={styles.video}
          paused={false}
          muted={true}
          resizeMode="contain"
          onLoad={onVideoLoad}
          onProgress={onVideoProgress}
          progressUpdateInterval={100}
        />
        <View style={styles.clockPill}>
          <Text style={styles.clockText}>
            {formatTime(currentTime)} / {formatTime(videoDuration)}
          </Text>
        </View>
      </View>

      <View style={styles.trimmerContainer}>
        <View style={styles.timeLabelContainer}>
          <Text style={styles.timeLabel}>{startTimeStr}</Text>
          <Text style={styles.timeLabel}>{endTimeStr}</Text>
        </View>
        <View style={styles.trackContainer}>
          <View style={styles.track} />
          <Animated.View style={[styles.selectedTrack, selectedTrackStyle]} />
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
        <Text style={styles.instructionText}>
          Drag the handles to trim your video
        </Text>
      </View>
    </SafeAreaView>
  );
};

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
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  calibrateButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 'auto',
  },
  calibrateText: {
    color: '#fff',
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
  clockPill: {
    position: 'absolute',
    right: 12,
    top: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  clockText: {
    color: '#fff',
    fontVariant: ['tabular-nums'],
    fontSize: 12,
  },
  trimmerContainer: {
    width: '100%',
    padding: TRIMMER_PADDING,
    paddingBottom: 20,
  },
  timeLabelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  timeLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
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
  instructionText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
  },
});

export default TrimScreen;