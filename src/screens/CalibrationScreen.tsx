// src/screens/CalibrationScreen.tsx
import React, { useState, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, LayoutChangeEvent, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Video, { OnLoadData } from 'react-native-video';
import Svg, { Line } from 'react-native-svg';

// Import necessary types
import { Gesture, GestureDetector, GestureUpdateEvent, PanGestureHandlerEventPayload } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  SharedValue,
} from 'react-native-reanimated';

const AnimatedLine = Animated.createAnimatedComponent(Line);

// Define navigation types
type RootStackParamList = {
  Calibration: {
    sourceUri: string;
    duration: number;
    startSec: number;
    endSec: number;
  };
  Analyze: {
    sourceUri: string;
    startSec: number;
    endSec: number;
    metersPerPixel: number;
  };
};
type CalibRoute = RouteProp<RootStackParamList, 'Calibration'>;

const HANDLE_DIAMETER = 30;

export default function CalibrationScreen() {
  const navigation = useNavigation();
  const route = useRoute<CalibRoute>();
  const { sourceUri } = route.params;

  // --- Restored State ---
  const [referenceLength, setReferenceLength] = useState('3.87');
  const [containerLayout, setContainerLayout] = useState({ width: 0, height: 0 });
  const videoW = useRef(0); // To store video's original width
  const videoH = useRef(0); // To store video's original height

  // --- Handle 1 Position & State ---
  const isDragging1 = useSharedValue(false);
  const positionX1 = useSharedValue(0);
  const positionY1 = useSharedValue(0);
  const offsetX1 = useSharedValue(0);
  const offsetY1 = useSharedValue(0);

  // --- Handle 2 Position & State ---
  const isDragging2 = useSharedValue(false);
  const positionX2 = useSharedValue(0);
  const positionY2 = useSharedValue(0);
  const offsetX2 = useSharedValue(0);
  const offsetY2 = useSharedValue(0);

  const onContainerLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (containerLayout.width === 0) {
      setContainerLayout({ width, height });
      positionX1.value = width * 0.25;
      positionY1.value = height * 0.75;
      positionX2.value = width * 0.75;
      positionY2.value = height * 0.75;
    }
  };

  // --- Restored onVideoLoad function ---
  const onVideoLoad = (meta: OnLoadData) => {
    videoW.current = meta.naturalSize.width;
    videoH.current = meta.naturalSize.height;
  };
  
  const createPanGesture = (
    isDragging: SharedValue<boolean>,
    positionX: SharedValue<number>,
    positionY: SharedValue<number>,
    offsetX: SharedValue<number>,
    offsetY: SharedValue<number>
  ) => {
    return Gesture.Pan()
      .onBegin(() => { isDragging.value = true; })
      .onUpdate((event: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
        offsetX.value = event.translationX;
        offsetY.value = event.translationY;
      })
      .onEnd(() => {
        positionX.value += offsetX.value;
        positionY.value += offsetY.value;
        offsetX.value = 0;
        offsetY.value = 0;
      })
      .onFinalize(() => { isDragging.value = false; });
  };

  const panGesture1 = createPanGesture(isDragging1, positionX1, positionY1, offsetX1, offsetY1);
  const panGesture2 = createPanGesture(isDragging2, positionX2, positionY2, offsetX2, offsetY2);

  const createAnimatedHandleStyle = (
    isDragging: SharedValue<boolean>,
    positionX: SharedValue<number>,
    positionY: SharedValue<number>,
    offsetX: SharedValue<number>,
    offsetY: SharedValue<number>
  ) => {
    return useAnimatedStyle(() => {
      const currentX = positionX.value + offsetX.value;
      const currentY = positionY.value + offsetY.value;
      const scale = withTiming(isDragging.value ? 1.2 : 1, { duration: 150 });
      return {
        transform: [
          { translateX: currentX - HANDLE_DIAMETER / 2 },
          { translateY: currentY - HANDLE_DIAMETER / 2 },
          { scale },
        ],
      };
    });
  };

  const animatedHandleStyle1 = createAnimatedHandleStyle(isDragging1, positionX1, positionY1, offsetX1, offsetY1);
  const animatedHandleStyle2 = createAnimatedHandleStyle(isDragging2, positionX2, positionY2, offsetX2, offsetY2);

  const animatedLineProps = useAnimatedProps(() => {
    return {
      x1: positionX1.value + offsetX1.value,
      y1: positionY1.value + offsetY1.value,
      x2: positionX2.value + offsetX2.value,
      y2: positionY2.value + offsetY2.value,
    };
  });

  // --- Restored Calculation Logic ---
  const onStart = () => {
    const realLength = parseFloat(referenceLength);
    if (!Number.isFinite(realLength) || realLength <= 0) {
      Alert.alert('Invalid Input', 'Please enter a valid reference length in meters.');
      return;
    }

    const { width: boxW, height: boxH } = containerLayout;
    if (!boxW || !boxH || !videoW.current || !videoH.current) {
      Alert.alert('Error', 'Video dimensions not loaded yet. Please wait a moment.');
      return;
    }

    // distance between the two draggable points (in container coords)
    const dx = (positionX2.value + offsetX2.value) - (positionX1.value + offsetX1.value);
    const dy = (positionY2.value + offsetY2.value) - (positionY1.value + offsetY1.value);
    const pointDistance = Math.sqrt(dx * dx + dy * dy);

    // container shows the video with `contain` → uniform scale, translation doesn’t affect distance
    const scaleRatio = Math.min(boxW / videoW.current, boxH / videoH.current); // pixels_on_screen = pixels_in_video * scaleRatio
    const pixelDistance = pointDistance / scaleRatio;

    if (!Number.isFinite(pixelDistance) || pixelDistance <= 0) {
      Alert.alert('Invalid Points', 'Please move the handles to two distinct points.');
      return;
    }

    const metersPerPixel = realLength / pixelDistance;

    // ✅ Go to the analyzer screen with everything it needs to run inference + draw boxes
    // @ts-ignore
    navigation.navigate('Analyze', {
      sourceUri,
      startSec: route.params.startSec,
      endSec: route.params.endSec,
      metersPerPixel,
    });
  };


  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.link}>Cancel</Text></TouchableOpacity>
        <Text style={styles.title}>Calibration</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.container}>
        <View style={styles.mediaWrap} onLayout={onContainerLayout}>
          {containerLayout.width > 0 && (
            <>
              <Video
                source={{ uri: sourceUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
                paused={true}
                onLoad={onVideoLoad}
              />
              <Svg style={StyleSheet.absoluteFill}>
                <AnimatedLine
                  animatedProps={animatedLineProps}
                  stroke="cyan"
                  strokeWidth="2"
                  strokeDasharray="6"
                />
              </Svg>
              <GestureDetector gesture={panGesture1}>
                <Animated.View style={[styles.handle, animatedHandleStyle1]} />
              </GestureDetector>
              <GestureDetector gesture={panGesture2}>
                <Animated.View style={[styles.handle, animatedHandleStyle2]} />
              </GestureDetector>
            </>
          )}
        </View>
      </View>
      
      {/* --- MODIFIED UI Panel --- */}
      {/* 👇 This is now the main button */}
      <TouchableOpacity
        style={styles.panel}
        onPress={onStart}
        activeOpacity={1} // Prevents the panel from flashing
      >
        <View style={styles.instructionRow}>
          <Text style={styles.instructionIcon}>☝️</Text>
          <Text style={styles.instructionText}>Drag the markers to align with a known distance.</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.inputRow}>
          <Text style={styles.inputLabel}>Reference Length</Text>
          <View style={styles.inputRight}>
            <TextInput
              value={referenceLength}
              onChangeText={setReferenceLength}
              keyboardType="decimal-pad"
              style={styles.textInput}
              placeholderTextColor="rgba(255,255,255,0.4)"
            />
            <Text style={styles.unit}>meters</Text>
          </View>
        </View>
        
        {/* 👇 This is now a non-interactive dummy button */}
        <View style={styles.cta}>
          <Text style={styles.ctaLabel}>Start</Text>
        </View>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// --- Restored Styles ---
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 50,
  },
  title: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  link: { color: '#0A84FF', fontSize: 16, width: 60 },
  container: { flex: 1, padding: 16, paddingBottom: 8 },
  mediaWrap: {
    flex: 1,
    backgroundColor: 'black',
    borderRadius: 12,
    overflow: 'hidden',
  },
  handle: {
    position: 'absolute',
    width: HANDLE_DIAMETER,
    height: HANDLE_DIAMETER,
    borderRadius: HANDLE_DIAMETER / 2,
    backgroundColor: 'rgba(255, 0, 0, 0.7)',
    borderColor: 'white',
    borderWidth: 2,
  },
  panel: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: '#1C1C1E',
  },
  instructionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  instructionIcon: { fontSize: 18 },
  instructionText: { color: 'rgba(255,255,255,0.8)', fontSize: 14, flex: 1 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  inputLabel: { color: 'white', fontSize: 16, fontWeight: '500' },
  inputRight: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' },
  textInput: {
    color: 'white',
    fontSize: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    width: 80,
    textAlign: 'right',
  },
  unit: { color: 'rgba(255,255,255,0.7)', marginLeft: 8 },
  cta: { backgroundColor: '#0A84FF', borderRadius: 12, alignItems: 'center', paddingVertical: 14 },
  ctaLabel: { color: 'white', fontWeight: 'bold', fontSize: 16 },
});