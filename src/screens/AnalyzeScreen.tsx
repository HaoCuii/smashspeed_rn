import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  DeviceEventEmitter,
  ActivityIndicator,
  ScrollView,
  Platform,
  Alert,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Video, { OnLoadData } from 'react-native-video';
import { runDetection, mapModelToVideo, Box } from '../ml/yolo';
import { pxPerSecToKph } from '../ml/kalman';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import Slider from '@react-native-community/slider';
import HapticFeedback, { HapticFeedbackTypes } from 'react-native-haptic-feedback';
import { HapticFeedbackTypes as HapticConstants } from 'react-native-haptic-feedback';
import Ionicons from 'react-native-vector-icons/Ionicons'; // MODIFICATION: Import icons

// --- Type Definitions ---
type AnalyzeParams = {
  sourceUri: string;
  startSec: number;
  endSec: number;
  metersPerPixel: number;
};
type FrameDetections = { t: number; boxes: Box[] };
type VideoHandle = React.ElementRef<typeof Video>;
type VBox = { x: number; y: number; width: number; height: number };
type Selected = { type: 'ai'; idx: number } | { type: 'user'; idx: number };
type EditMode = 'move' | 'resize';
type UndoState = { frames: FrameDetections[], userBoxesByIndex: Record<number, VBox[]> };

// --- Haptic Feedback Options ---
const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

const triggerHaptic = (type: 'light' | 'medium' | 'heavy' = 'light') => {
  let feedbackType: HapticFeedbackTypes;
  if (Platform.OS === 'ios') {
    const iosMap = {
      light: HapticConstants.impactLight,
      medium: HapticConstants.impactMedium,
      heavy: HapticConstants.impactHeavy,
    };
    feedbackType = iosMap[type];
  } else {
    const androidMap = {
      light: HapticConstants.virtualKey,
      medium: HapticConstants.keyboardTap,
      heavy: HapticConstants.longPress,
    };
    feedbackType = androidMap[type];
  }
  HapticFeedback.trigger(feedbackType, hapticOptions);
};

// --- Reusable UI Components ---
const RepeatingFineTuneButton = ({
  icon,
  onPress,
}: {
  icon: React.ReactNode; // MODIFICATION: Changed from string to ReactNode
  onPress: (pressCount: number) => void;
}) => {
  const [isPressing, setIsPressing] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pressCountRef = useRef(0);

  const startTimer = () => {
    stopTimer();
    pressCountRef.current = 0;
    onPress(pressCountRef.current);
    pressCountRef.current += 1;
    timerRef.current = setInterval(() => {
      onPress(pressCountRef.current);
      pressCountRef.current += 1;
      triggerHaptic('light');
    }, 100);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    pressCountRef.current = 0;
  };

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPressIn={() => { setIsPressing(true); triggerHaptic('medium'); startTimer(); }}
      onPressOut={() => { setIsPressing(false); stopTimer(); }}
      style={[styles.fineTuneBtn, isPressing && styles.fineTuneBtnActive]}
    >
      {icon}
    </TouchableOpacity>
  );
};

const GlowButton = ({ onPress, disabled, children }: { onPress: () => void, disabled?: boolean, children: React.ReactNode }) => {
  const [isPressed, setIsPressed] = useState(false);
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      style={[isPressed && !disabled ? styles.glowEffect : {}, disabled ? styles.btnDisabled : {}]}
    >
      {children}
    </TouchableOpacity>
  );
};

export default function AnalyzeScreen({ route, navigation }: any) {
  // --- Hooks and State ---
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { sourceUri, startSec, endSec, metersPerPixel } = route.params as AnalyzeParams;

  const [isLoading, setIsLoading] = useState(false);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  const [drawRect, setDrawRect] = useState({ x: 0, y: 0, w: screenW, h: Math.floor(screenH * 0.45) });
  const [frames, setFrames] = useState<FrameDetections[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [userBoxesByIndex, setUserBoxesByIndex] = useState<Record<number, VBox[]>>({});
  const [selected, setSelected] = useState<Selected | null>(null);
  const [showTuningControls, setShowTuningControls] = useState(false); // MODIFICATION: Closed by default
  const [editMode, setEditMode] = useState<EditMode>('move');

  const [undoStack, setUndoStack] = useState<UndoState[]>([]);
  const [redoStack, setRedoStack] = useState<UndoState[]>([]);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const videoRef = useRef<VideoHandle>(null);
  const videoLoaded = useRef(false);
  const didAutoSeek = useRef(false);

  // --- Memos & Callbacks ---
  useEffect(() => {
    if (!vw || !vh) return;
    const maxW = screenW;
    const maxH = Math.floor(screenH * 0.45);
    const scale = Math.min(maxW / vw, maxH / vh);
    const w = vw * scale;
    const h = vh * scale;
    setDrawRect({ x: (screenW - w) / 2, y: (maxH - h) / 2, w, h });
  }, [vw, vh, screenW, screenH]);

  const saveUndoState = useCallback(() => {
    setUndoStack(prev => [...prev, { frames, userBoxesByIndex }]);
    setRedoStack([]);
  }, [frames, userBoxesByIndex]);

  const undo = () => {
    if (undoStack.length === 0) return;
    triggerHaptic('medium');
    const lastState = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev, { frames, userBoxesByIndex }]);
    setFrames(lastState.frames);
    setUserBoxesByIndex(lastState.userBoxesByIndex);
    setUndoStack(prev => prev.slice(0, -1));
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    triggerHaptic('medium');
    const nextState = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev, { frames, userBoxesByIndex }]);
    setFrames(nextState.frames);
    setUserBoxesByIndex(nextState.userBoxesByIndex);
    setRedoStack(prev => prev.slice(0, -1));
  };

  const loadDetections = useCallback(async () => {
    setIsLoading(true);
    setFrames([]);
    setCurrentIndex(0);
    setPendingIndex(null);
    setUserBoxesByIndex({});
    setSelected(null);
    setUndoStack([]);
    setRedoStack([]);
    didAutoSeek.current = false;
    try {
      await runDetection(sourceUri, 0, startSec, endSec);
    } catch (e) {
      console.warn('Detection error', e);
    } finally {
      setIsLoading(false);
    }
  }, [sourceUri, startSec, endSec]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('onFrameDetected', (frame: FrameDetections) => {
      setFrames(prev => [...prev, frame].sort((a, b) => a.t - b.t));
    });
    loadDetections();
    return () => sub.remove();
  }, [loadDetections]);

  const approxFps = useMemo(() => {
    if (frames.length < 2) return 30;
    const deltas = frames.slice(1).map((f, i) => Math.max(1, f.t - frames[i].t)).sort((a, b) => a - b);
    const median = deltas[Math.floor(deltas.length / 2)] || 33.33;
    const fps = 1000 / median;
    return isFinite(fps) && fps > 1 ? fps : 30;
  }, [frames]);

  const seekToIndex = useCallback((idx: number) => {
    if (!frames.length) return;
    const clamped = Math.max(0, Math.min(idx, frames.length - 1));
    const halfFrame = 1 / (approxFps * 2);
    const tSec = Math.max(0, frames[clamped].t / 1000 - halfFrame);
    setPendingIndex(clamped);
    setSelected(null);
    videoRef.current?.seek(tSec);
  }, [frames, approxFps]);

  const onSeek = () => {
    if (pendingIndex != null) {
      setCurrentIndex(pendingIndex);
      setPendingIndex(null);
    }
  };

  const onLoad = (meta: OnLoadData) => {
    setVw(meta.naturalSize.width || 0);
    setVh(meta.naturalSize.height || 0);
    videoLoaded.current = true;
    if (frames.length) seekToIndex(0);
    else videoRef.current?.seek(Math.max(0, startSec));
  };

  useEffect(() => {
    if (videoLoaded.current && frames.length && !didAutoSeek.current) {
      didAutoSeek.current = true;
      seekToIndex(0);
    }
  }, [frames, seekToIndex]);

  const current = frames.length ? frames[Math.max(0, Math.min(currentIndex, frames.length - 1))] : null;
  const detectedVideoBoxes = useMemo(() => {
    if (!current || !vw || !vh) return [];
    return current.boxes.map(b => mapModelToVideo(b, vw, vh)).slice(0, 1);
  }, [current, vw, vh]);
  const userVideoBoxes: VBox[] = userBoxesByIndex[currentIndex] || [];
  const videoToScreenScale = useMemo(() => (!vw || !vh) ? 1 : Math.min(drawRect.w / vw, drawRect.h / vh), [drawRect, vw, vh]);
  const toScreen = (b: VBox) => ({
    left: b.x * videoToScreenScale,
    top: b.y * videoToScreenScale,
    width: b.width * videoToScreenScale,
    height: b.height * videoToScreenScale,
  });

  const centers: ({ x: number; y: number; tSec: number } | null)[] = useMemo(() => {
    if (!vw || !vh || frames.length === 0) return [];
    return frames.map((f, i) => {
      const ub = (userBoxesByIndex[i] || [])[0];
      if (ub) return { x: ub.x + ub.width / 2, y: ub.y + ub.height / 2, tSec: f.t / 1000 };
      if (!f.boxes.length) return null;
      const top = mapModelToVideo(f.boxes[0], vw, vh);
      return { x: top.x + top.width / 2, y: top.y + top.height / 2, tSec: f.t / 1000 };
    });
  }, [frames, vw, vh, userBoxesByIndex]);

  const speedsKph: (number | null)[] = useMemo(() => {
    const out: (number | null)[] = new Array(centers.length).fill(null);
    if (centers.length < 2) return out;
    const MIN_DT = 1 / 240, MAX_DT = 0.5;
    let lastIdx: number | null = null;
    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      if (!c) continue;
      if (lastIdx == null) { lastIdx = i; continue; }
      const p = centers[lastIdx];
      if (!p) { lastIdx = i; continue; }
      let dt = c.tSec - p.tSec;
      dt = Math.max(MIN_DT, Math.min(dt, MAX_DT));
      const pxPerSec = Math.hypot(c.x - p.x, c.y - p.y) / dt;
      out[i] = pxPerSecToKph(pxPerSec, metersPerPixel);
      lastIdx = i;
    }
    return out;
  }, [centers, metersPerPixel]);

  const currentSpeedKph = useMemo(() => {
    if (!speedsKph.length) return null;
    for (let i = currentIndex; i >= 0; i--) {
      const v = speedsKph[i];
      if (Number.isFinite(v as number)) return v as number;
    }
    return null;
  }, [speedsKph, currentIndex]);
  const speedLabel = currentSpeedKph != null ? `${currentSpeedKph.toFixed(0)}` : 'N/A';
  const speedUnit = currentSpeedKph != null ? 'km/h' : '';

  const maxSpeed = useMemo(() => {
    let best = { maxKph: -Infinity, atIndex: -1 };
    for (let i = 0; i < speedsKph.length; i++) {
      const v = speedsKph[i];
      if (Number.isFinite(v as number) && (v as number) > best.maxKph) {
        best = { maxKph: v as number, atIndex: i };
      }
    }
    
    // Calculate angle at max speed frame
    let angle = 0;
    if (best.atIndex >= 0 && best.atIndex < centers.length - 1) {
      const current = centers[best.atIndex];
      const next = centers[best.atIndex + 1];
      if (current && next) {
        const dx = next.x - current.x;
        const dy = next.y - current.y;
        angle = Math.atan2(dy, dx) * (180 / Math.PI);
        // Normalize to 0-360 degrees
        if (angle < 0) angle += 360;
      }
    }
    
    return best.maxKph === -Infinity ? null : { ...best, angle };
  }, [speedsKph, centers]);

  const finish = () => {
    triggerHaptic('heavy');
  
    const resultData = maxSpeed
      ? { maxKph: maxSpeed.maxKph, atIndex: maxSpeed.atIndex }
      : { maxKph: 0, atIndex: -1 };
  
    navigation.navigate('SpeedResult', {
      ...resultData,
      sourceUri,
      startSec,
      endSec,
      frames,
    });
  };

  const clampBox = (b: VBox): VBox => {
    if (!vw || !vh) return b;
    const width = Math.max(2, Math.min(b.width, vw));
    const height = Math.max(2, Math.min(b.height, vh));
    const x = Math.max(0, Math.min(b.x, vw - width));
    const y = Math.max(0, Math.min(b.y, vh - height));
    return { x, y, width, height };
  };

  const updateUserBoxes = (transform: (boxes: VBox[]) => VBox[], saveState = true) => {
    if (saveState) saveUndoState();
    setUserBoxesByIndex(prev => ({ ...prev, [currentIndex]: transform(prev[currentIndex] ?? []) }));
  };

  const addBox = () => {
    if (!vw || !vh) return;
    triggerHaptic('medium');
    const w = Math.round(vw * 0.18), h = Math.round(vh * 0.18);
    const nb = clampBox({ x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), width: w, height: h });
    updateUserBoxes(arr => {
      const next = [...arr, nb];
      setSelected({ type: 'user', idx: next.length - 1 });
      return next;
    });
  };

  const deleteSelected = () => {
    if (!selected) return;
    triggerHaptic('medium');
    saveUndoState();
    if (selected.type === 'user') {
      updateUserBoxes(arr => arr.filter((_, i) => i !== selected.idx), false);
    } else if (selected.type === 'ai' && current) {
      setFrames(prev => {
        const out = prev.slice();
        out[currentIndex] = { ...out[currentIndex], boxes: out[currentIndex].boxes.filter((_, i) => i !== selected.idx) };
        return out;
      });
    }
    setSelected(null);
  };

  const isInterpolationRecommended = useMemo(() => {
    if (frames.length < 3) return false;
    let inGap = false;
    for (let i = 0; i < frames.length - 1; i++) {
      const currentHasBox = !!(userBoxesByIndex[i]?.[0]) || !!(frames[i]?.boxes?.[0]);
      const nextHasBox = !!(userBoxesByIndex[i + 1]?.[0]) || !!(frames[i + 1]?.boxes?.[0]);
      if (currentHasBox && !nextHasBox) inGap = true;
      if (inGap && nextHasBox) return true;
    }
    return false;
  }, [frames, userBoxesByIndex]);

  const interpolateFrames = () => {
    triggerHaptic('heavy');
    saveUndoState();
    let tempUserBoxes = { ...userBoxesByIndex };
    let i = 0;
    while (i < frames.length - 1) {
      const startBox = tempUserBoxes[i]?.[0] || mapModelToVideo(frames[i]?.boxes?.[0], vw, vh);
      if (startBox) {
        let endIndex = -1;
        for (let j = i + 1; j < frames.length; j++) {
          const endBoxCand = tempUserBoxes[j]?.[0] || mapModelToVideo(frames[j]?.boxes?.[0], vw, vh);
          if (endBoxCand) { endIndex = j; break; }
        }
        if (endIndex > i + 1) {
          const endBox = tempUserBoxes[endIndex]?.[0] || mapModelToVideo(frames[endIndex]?.boxes?.[0], vw, vh);
          const gapLength = endIndex - i;
          for (let k = i + 1; k < endIndex; k++) {
            if (!tempUserBoxes[k]?.[0] && !frames[k]?.boxes?.[0]) {
              const t = (k - i) / gapLength;
              const interpolatedBox: VBox = {
                x: startBox.x + t * (endBox.x - startBox.x),
                y: startBox.y + t * (endBox.y - startBox.y),
                width: startBox.width + t * (endBox.width - startBox.width),
                height: startBox.height + t * (endBox.height - startBox.height),
              };
              tempUserBoxes[k] = [interpolatedBox];
            }
          }
          i = endIndex;
        } else { i++; }
      } else { i++; }
    }
    setUserBoxesByIndex(tempUserBoxes);
  };

  const adjustBox = (dx: number, dy: number, dw: number, dh: number, pressCount: number) => {
    if (selected?.type !== 'user') return;
    const multiplier = pressCount < 5 ? 1 : pressCount < 15 ? 4 : 10;
    const moveStep = (vw + vh) / 2 * 0.002 * multiplier / scale.value;
    const resizeStep = (vw + vh) / 2 * 0.004 * multiplier / scale.value;
    updateUserBoxes(arr => {
      const b = arr[selected.idx];
      if (!b) return arr;
      const next = arr.slice();
      next[selected.idx] = clampBox({
        ...b,
        x: b.x + dx * moveStep,
        y: b.y + dy * moveStep,
        width: b.width + dw * resizeStep,
        height: b.height + dh * resizeStep,
      });
      return next;
    }, pressCount === 0);
  };

  // --- Gestures and Animation ---
  const panGesture = Gesture.Pan().onUpdate(e => {
    translateX.value = savedTranslateX.value + e.translationX;
    translateY.value = savedTranslateY.value + e.translationY;
  }).onEnd(() => {
    savedTranslateX.value = translateX.value;
    savedTranslateY.value = translateY.value;
  });
  const pinchGesture = Gesture.Pinch().onUpdate(e => {
    scale.value = savedScale.value * e.scale;
  }).onEnd(() => {
    savedScale.value = scale.value;
  });
  const resetZoom = () => {
    triggerHaptic('medium');
    scale.value = withTiming(1); savedScale.value = 1;
    translateX.value = withTiming(0); savedTranslateX.value = 0;
    translateY.value = withTiming(0); savedTranslateY.value = 0;
  };
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));
  const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture);

  // --- Render ---
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ImageBackground
        source={require('../../assets/aurora_background.png')}
        style={styles.container}
      >
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.topBarContainer}>
            <View style={styles.topBar}>
              <View style={styles.topBarSection}>
                <TouchableOpacity onPress={undo} disabled={undoStack.length === 0} style={undoStack.length === 0 && styles.btnDisabled}><Ionicons name="arrow-undo-outline" style={styles.iconBtn} /></TouchableOpacity>
                <TouchableOpacity onPress={redo} disabled={redoStack.length === 0} style={redoStack.length === 0 && styles.btnDisabled}><Ionicons name="arrow-redo-outline" style={styles.iconBtn} /></TouchableOpacity>
              </View>
              <Text style={styles.topBarTitle}>{frames.length ? `Frame ${currentIndex + 1} / ${frames.length}` : 'Loading...'}</Text>
              <View style={[styles.topBarSection, { justifyContent: 'flex-end' }]}>
                <TouchableOpacity onPress={() => { scale.value = withTiming(Math.min(scale.value * 1.5, 5)); savedScale.value = scale.value; }}><Ionicons name="add-circle-outline" style={styles.iconBtn} /></TouchableOpacity>
                <TouchableOpacity onPress={() => { scale.value = withTiming(Math.max(scale.value * 0.66, 1)); savedScale.value = scale.value; }}><Ionicons name="remove-circle-outline" style={styles.iconBtn} /></TouchableOpacity>
                <TouchableOpacity onPress={resetZoom}><Ionicons name="scan-outline" style={styles.iconBtn} /></TouchableOpacity>
              </View>
            </View>
          </View>
          
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={[styles.videoContainer, { height: drawRect.h }, animatedStyle]}>
              <Video ref={videoRef} source={{ uri: sourceUri }} style={{ width: drawRect.w, height: drawRect.h }} resizeMode="contain" paused={true} onLoad={onLoad} onSeek={onSeek} />
              <View style={[StyleSheet.absoluteFill, { width: drawRect.w, height: drawRect.h }]}>
                {detectedVideoBoxes.map((b, i) => {
                  const isSel = selected?.type === 'ai' && selected.idx === i;
                  return <TouchableOpacity key={`d-${i}`} activeOpacity={0.9} onPress={() => setSelected({ type: 'ai', idx: i })} style={[styles.box, styles.detBox, toScreen(b), isSel && styles.selBox]} />;
                })}
                {userVideoBoxes.map((b, i) => {
                  const isSel = selected?.type === 'user' && selected.idx === i;
                  return <TouchableOpacity key={`u-${i}`} activeOpacity={0.9} onPress={() => setSelected({ type: 'user', idx: i })} style={[styles.box, styles.userBox, toScreen(b), isSel && styles.selBox]} />;
                })}
              </View>
            </Animated.View>
          </GestureDetector>

          {isInterpolationRecommended && (
            <View style={styles.interpContainer}>
              <View style={styles.interpContent}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <Ionicons name="sparkles-outline" size={24} color="#BF5A00" />
                  <View>
                    <Text style={styles.interpTitle}>Detection Gap Found</Text>
                    <Text style={styles.interpSub}>Interpolation can improve accuracy.</Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.interpBtn} onPress={interpolateFrames}><Text style={styles.interpBtnTxt}>✨ Interpolate</Text></TouchableOpacity>
              </View>
            </View>
          )}

          <ScrollView contentContainerStyle={styles.controlsContainer}>
            <View style={styles.panel}>
              <Text style={styles.sectionHeader}>NAVIGATE FRAMES</Text>
              <View style={styles.speedReadout}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={styles.speedLabel}>Speed</Text>
                  <TouchableOpacity onPress={() => Alert.alert('Speed Calculation', 'Speed is estimated based on the change in the object\'s center point between frames.')}>
                    <Ionicons name="information-circle-outline" style={styles.infoIcon} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.speedValue}>{speedLabel} <Text style={styles.speedUnit}>{speedUnit}</Text></Text>
              </View>

              <View style={styles.sliderRow}>
                <GlowButton onPress={() => seekToIndex(currentIndex - 1)} disabled={currentIndex <= 0}>
                  <Ionicons name="chevron-back-circle" style={[styles.navArrowIcon, currentIndex <= 0 && styles.btnDisabled]} />
                </GlowButton>
                <Slider style={{ flex: 1, height: 40 }} minimumValue={0} maximumValue={Math.max(0, frames.length - 1)} step={1} value={currentIndex} onValueChange={() => triggerHaptic('light')} onSlidingComplete={val => seekToIndex(val)} minimumTrackTintColor="#007AFF" maximumTrackTintColor="#D1D1D6" thumbTintColor="#000" />
                <GlowButton onPress={() => seekToIndex(currentIndex + 1)} disabled={currentIndex >= frames.length - 1}>
                  <Ionicons name="chevron-forward-circle" style={[styles.navArrowIcon, currentIndex >= frames.length - 1 && styles.btnDisabled]} />
                </GlowButton>
              </View>

              <View style={styles.divider} />
              <TouchableOpacity onPress={() => setShowTuningControls(s => !s)} style={styles.toggleBtn}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 5}}>
                  <Text style={styles.toggleBtnText}>{showTuningControls ? 'Hide Manual Controls' : 'Show Manual Controls'}</Text>
                  <Ionicons name={showTuningControls ? 'chevron-up' : 'chevron-down'} size={16} color={'#6D6D72'} />
                </View>
              </TouchableOpacity>
              {!showTuningControls && <Text style={styles.aiWarning}>Manual controls are hidden. AI detections are being used.</Text>}
            </View>

            {showTuningControls && (
              <View style={styles.panel}>
                <View style={styles.manualHeader}>
                  <Text style={styles.sectionHeader}>MANUAL FINE-TUNING</Text>
                  <TouchableOpacity onPress={() => Alert.alert('Manual Adjustments', 'Add, remove, or edit bounding boxes. Hold adjustment buttons to accelerate changes.')}>
                    <Ionicons name="information-circle-outline" style={styles.infoIcon} />
                  </TouchableOpacity>
                </View>

                {!userVideoBoxes.length && !detectedVideoBoxes.length ? (
                  <TouchableOpacity style={[styles.actionBtn, styles.addBtn]} onPress={addBox}>
                    <View style={styles.actionBtnContent}>
                      <Ionicons name="add-circle" size={22} color="#FFF" />
                      <Text style={styles.actionBtnTxt}>Add Box</Text>
                    </View>
                  </TouchableOpacity>
                ) : (
                  <>
                    <TouchableOpacity style={[styles.actionBtn, styles.removeBtn, !selected && styles.btnDisabled]} onPress={deleteSelected} disabled={!selected}>
                      <View style={styles.actionBtnContent}>
                        <Ionicons name="remove-circle" size={22} color="#FFF" />
                        <Text style={styles.actionBtnTxt}>Remove Selected</Text>
                      </View>
                    </TouchableOpacity>
                    <View style={styles.segmentedControl}>
                      <TouchableOpacity style={[styles.segment, editMode === 'move' && styles.segmentActive]} onPress={() => setEditMode('move')}><Text style={styles.segmentText}>Move</Text></TouchableOpacity>
                      <TouchableOpacity style={[styles.segment, editMode === 'resize' && styles.segmentActive]} onPress={() => setEditMode('resize')}><Text style={styles.segmentText}>Resize</Text></TouchableOpacity>
                    </View>
                    {editMode === 'move' ? (
                      <View style={styles.dPad}>
                        <RepeatingFineTuneButton icon={<Ionicons name="arrow-up" size={28} color="#000" />} onPress={(c) => adjustBox(0, -1, 0, 0, c)} />
                        <View style={{ flexDirection: 'row', gap: 70 }}>
                          <RepeatingFineTuneButton icon={<Ionicons name="arrow-back" size={28} color="#000" />} onPress={(c) => adjustBox(-1, 0, 0, 0, c)} />
                          <RepeatingFineTuneButton icon={<Ionicons name="arrow-forward" size={28} color="#000" />} onPress={(c) => adjustBox(1, 0, 0, 0, c)} />
                        </View>
                        <RepeatingFineTuneButton icon={<Ionicons name="arrow-down" size={28} color="#000" />} onPress={(c) => adjustBox(0, 1, 0, 0, c)} />
                      </View>
                    ) : (
                      <View style={styles.resizeControls}>
                        <Text style={styles.resizeLabel}>Width</Text>
                        <RepeatingFineTuneButton icon={<Ionicons name="remove" size={28} color="#000" />} onPress={(c) => adjustBox(0, 0, -1, 0, c)} />
                        <RepeatingFineTuneButton icon={<Ionicons name="add" size={28} color="#000" />} onPress={(c) => adjustBox(0, 0, 1, 0, c)} />
                        <Text style={styles.resizeLabel}>Height</Text>
                        <RepeatingFineTuneButton icon={<Ionicons name="remove" size={28} color="#000" />} onPress={(c) => adjustBox(0, 0, 0, -1, c)} />
                        <RepeatingFineTuneButton icon={<Ionicons name="add" size={28} color="#000" />} onPress={(c) => adjustBox(0, 0, 0, 1, c)} />
                      </View>
                    )}
                  </>
                )}
              </View>
            )}
          </ScrollView>

          <View style={styles.bottomBarContainer}>
            <TouchableOpacity onPress={finish} style={styles.finishBtn}><Text style={styles.finishBtnTxt}>Finish</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.recalibrateTxt}>Recalibrate</Text></TouchableOpacity>
          </View>

          {isLoading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text style={styles.loadingText}>Analyzing Video...</Text>
            </View>
          )}
        </SafeAreaView>
      </ImageBackground>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  // Top Bar
  topBarContainer: { height: 44, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderColor: '#D1D1D6' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, flex: 1 },
  topBarSection: { flexDirection: 'row', alignItems: 'center', gap: 20, flex: 1 },
  iconBtn: { color: '#007AFF', fontSize: 26 }, // MODIFICATION: New icon style
  topBarTitle: { color: '#000', fontSize: 17, fontWeight: '600' },
  // Video & Boxes
  videoContainer: { width: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  box: { position: 'absolute', borderWidth: 2, backgroundColor: 'transparent' },
  detBox: { borderColor: 'rgba(255, 69, 58, 0.8)' },
  userBox: { borderColor: 'rgba(10, 215, 255, 0.8)' },
  selBox: { borderColor: '#FF9500', borderWidth: 3 },
  // Interpolation
  interpContainer: { borderBottomWidth: 1, borderColor: '#D1D1D6', backgroundColor: 'rgba(255, 226, 183, 0.5)' },
  interpContent: { padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  interpTitle: { color: '#BF5A00', fontWeight: 'bold', fontSize: 14 },
  interpSub: { color: '#BF5A00', fontSize: 13, opacity: 0.8 },
  interpBtn: { backgroundColor: '#A259FF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  interpBtnTxt: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  // Controls ScrollView
  controlsContainer: { padding: 16, gap: 16, paddingBottom: 120 },
  panel: { 
    backgroundColor: '#FFFFFF', 
    borderRadius: 16, 
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  sectionHeader: { color: '#6D6D72', fontSize: 13, fontWeight: '600', marginBottom: 16 },
  // Navigation Panel
  speedReadout: { alignItems: 'center', marginBottom: 10 },
  speedLabel: { color: '#6D6D72', fontSize: 13, fontWeight: '500' },
  infoIcon: { color: '#007AFF', fontSize: 18 }, // MODIFICATION: Adjusted size
  speedValue: { color: '#000', fontSize: 28, fontWeight: '700' },
  speedUnit: { fontSize: 20, color: '#6D6D72' },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navArrowIcon: { color: '#007AFF', fontSize: 40 }, // MODIFICATION: New icon style
  glowEffect: { shadowColor: '#007AFF', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 10 },
  divider: { height: 1, backgroundColor: '#E5E5EA', marginVertical: 12 },
  toggleBtn: { paddingVertical: 4, alignItems: 'center' },
  toggleBtnText: { color: '#6D6D72', fontSize: 13, fontWeight: '500' },
  aiWarning: { color: '#6D6D72', fontSize: 12, textAlign: 'center', marginTop: 8, paddingHorizontal: 10 },
  // Manual Panel
  manualHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actionBtn: { paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginBottom: 16 },
  actionBtnContent: { flexDirection: 'row', alignItems: 'center', gap: 8 }, // MODIFICATION: New style for button content
  addBtn: { backgroundColor: '#007AFF' },
  removeBtn: { backgroundColor: '#FF9500' },
  actionBtnTxt: { color: '#FFF', fontWeight: '600', fontSize: 16 },
  segmentedControl: { flexDirection: 'row', backgroundColor: '#E5E5EA', borderRadius: 10, padding: 2, marginBottom: 16 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: '#FFF', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: {width: 0, height: 2}, elevation: 2 },
  segmentText: { color: '#000', fontWeight: '600' },
  dPad: { alignItems: 'center', gap: 12, marginVertical: 10 },
  resizeControls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 12, marginVertical: 10 },
  resizeLabel: { color: '#000', fontWeight: '600', width: 60, textAlign: 'center' },
  fineTuneBtn: { width: 64, height: 48, backgroundColor: '#E5E5EA', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  fineTuneBtnActive: { backgroundColor: '#D1D1D6' },
  // Bottom Bar
  bottomBarContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 34, paddingTop: 12, paddingHorizontal: 16, gap: 14, borderTopWidth: 1, borderColor: '#D1D1D6', backgroundColor: '#FFFFFF' },
  finishBtn: { backgroundColor: '#007AFF', paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  finishBtnTxt: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  recalibrateTxt: { color: '#007AFF', textAlign: 'center', fontSize: 15 },
  btnDisabled: { opacity: 0.3 },
  // Overlays
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#fff', marginTop: 15, fontSize: 16 },
});
