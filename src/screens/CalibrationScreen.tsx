// src/screens/CalibrationScreen.tsx
import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  LayoutChangeEvent,
  TextInput,
  Platform,
  Modal,
  ImageBackground, // Added ImageBackground
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Video, { OnLoadData } from 'react-native-video';
import Svg, { Line, Path } from 'react-native-svg';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import Ionicons from 'react-native-vector-icons/Ionicons';

const AnimatedLine = Animated.createAnimatedComponent(Line);

// --- Type Definitions ---
type RootStackParamList = {
  Calibration: { sourceUri: string; duration: number; startSec: number; endSec: number };
  Analyze: { sourceUri: string; startSec: number; endSec: number; metersPerPixel: number };
};
type CalibRoute = RouteProp<RootStackParamList, 'Calibration'>;
type CGPoint = { x: number; y: number };
type CGSize = { width: number; height: number };

// --- Reusable Components ---

const GlassPanel = ({ children, style }: { children: React.ReactNode; style?: any }) => {
  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={80} tint="light" style={[styles.glassPanel, style]}>
        {children}
      </BlurView>
    );
  }
  return <View style={[styles.glassPanelAndroid, style]}>{children}</View>;
};

const CalibrationHandle = ({ position, liveOffset, isDragging }: { position: SharedValue<CGPoint>, liveOffset: SharedValue<CGSize>, isDragging: SharedValue<boolean> }) => {
  const animatedStyle = useAnimatedStyle(() => {
    const scale = withTiming(isDragging.value ? 1.1 : 1, { duration: 150 });
    return {
      position: 'absolute',
      left: position.value.x + liveOffset.value.width,
      top: position.value.y + liveOffset.value.height,
      transform: [{ scale }],
    };
  });

  const animatedIndicatorStyle = useAnimatedStyle(() => ({
    opacity: withTiming(isDragging.value ? 1 : 0),
  }));

  return (
    <Animated.View style={animatedStyle}>
      <View style={styles.handleContainer}>
        <Animated.View style={[styles.handleDragIndicator, animatedIndicatorStyle]} />
        <View style={styles.handlePin}>
          <Svg height="32" width="24" viewBox="0 0 24 32">
            <Path
              d="M12 32C12 25.6 0 20.8 0 12.8A12 12 0 1 1 24 12.8C24 20.8 12 25.6 12 32Z"
              fill="red"
            />
          </Svg>
          <View style={styles.handlePinDot} />
        </View>
      </View>
    </Animated.View>
  );
};

// --- Main Component ---
export default function CalibrationScreen() {
  const navigation = useNavigation();
  const route = useRoute<CalibRoute>();
  const insets = useSafeAreaInsets();
  const { sourceUri } = route.params;

  const [referenceLength, setReferenceLength] = useState('3.87');
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const videoPixelSize = useRef({ width: 0, height: 0 });
  const [showInfoSheet, setShowInfoSheet] = useState(false);

  const point1 = useSharedValue({ x: 0, y: 0 });
  const point2 = useSharedValue({ x: 0, y: 0 });
  const liveOffset1 = useSharedValue({ width: 0, height: 0 });
  const liveOffset2 = useSharedValue({ width: 0, height: 0 });
  const isDragging1 = useSharedValue(false);
  const isDragging2 = useSharedValue(false);
  const activeHandle = useSharedValue<1 | 2 | null>(null);

  const onContainerLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (viewSize.width === 0) {
      setViewSize({ width, height });
      point1.value = { x: width * 0.3, y: height * 0.8 };
      point2.value = { x: width * 0.7, y: height * 0.8 };
    }
  };

  const onVideoLoad = (meta: OnLoadData) => {
    videoPixelSize.current = { width: meta.naturalSize.width, height: meta.naturalSize.height };
  };

  const panGesture = Gesture.Pan()
    .onBegin((e) => {
      const dist1 = Math.sqrt(Math.pow(e.x - point1.value.x, 2) + Math.pow(e.y - point1.value.y, 2));
      const dist2 = Math.sqrt(Math.pow(e.x - point2.value.x, 2) + Math.pow(e.y - point2.value.y, 2));
      
      if (dist1 < dist2) {
        activeHandle.value = 1;
        isDragging1.value = true;
      } else {
        activeHandle.value = 2;
        isDragging2.value = true;
      }
    })
    .onUpdate((e) => {
      if (activeHandle.value === 1) {
        liveOffset1.value = { width: e.translationX, height: e.translationY };
      } else {
        liveOffset2.value = { width: e.translationX, height: e.translationY };
      }
    })
    .onEnd((e) => {
      if (activeHandle.value === 1) {
        const newX = point1.value.x + e.translationX;
        const newY = point1.value.y + e.translationY;
        point1.value = {
          x: Math.max(0, Math.min(newX, viewSize.width)),
          y: Math.max(0, Math.min(newY, viewSize.height)),
        };
        liveOffset1.value = { width: 0, height: 0 };
      } else {
        const newX = point2.value.x + e.translationX;
        const newY = point2.value.y + e.translationY;
        point2.value = {
          x: Math.max(0, Math.min(newX, viewSize.width)),
          y: Math.max(0, Math.min(newY, viewSize.height)),
        };
        liveOffset2.value = { width: 0, height: 0 };
      }
    })
    .onFinalize(() => {
      isDragging1.value = false;
      isDragging2.value = false;
      activeHandle.value = null;
    });

  const animatedLineProps = useAnimatedProps(() => ({
    x1: point1.value.x + liveOffset1.value.width,
    y1: point1.value.y + liveOffset1.value.height,
    x2: point2.value.x + liveOffset2.value.width,
    y2: point2.value.y + liveOffset2.value.height,
  }));

  const calculateAndProceed = () => {
    const realLength = parseFloat(referenceLength);
    if (!Number.isFinite(realLength) || realLength <= 0) {
      Alert.alert('Invalid Input', 'Please enter a valid reference length.');
      return;
    }
    if (videoPixelSize.current.width === 0 || viewSize.width === 0) {
      Alert.alert('Error', 'Video dimensions not loaded yet.');
      return;
    }

    const dx = point2.value.x - point1.value.x;
    const dy = point2.value.y - point1.value.y;
    const pointDistance = Math.sqrt(dx * dx + dy * dy);

    const scaleRatio = Math.min(viewSize.width / videoPixelSize.current.width, viewSize.height / videoPixelSize.current.height);
    if (scaleRatio <= 0) return;

    const pixelDistance = pointDistance / scaleRatio;
    if (pixelDistance <= 0) {
      Alert.alert('Invalid Points', 'Please move handles to two distinct points.');
      return;
    }

    const metersPerPixel = realLength / pixelDistance;
    // @ts-ignore
    navigation.navigate('Analyze', { ...route.params, metersPerPixel });
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ImageBackground
        style={styles.root}
        source={require('../../assets/aurora_background.png')}
      >
        <View style={[styles.topBar, { paddingTop: insets.top }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.topBarButton}>
            <Text style={styles.topBarButtonText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Set Scale</Text>
          <TouchableOpacity onPress={() => setShowInfoSheet(true)} style={styles.topBarButton}>
            <Ionicons name="information-circle-outline" size={24} color="#007AFF" />
          </TouchableOpacity>
        </View>

        <GestureDetector gesture={panGesture}>
          <View style={styles.videoContainer} onLayout={onContainerLayout}>
            {viewSize.width > 0 && (
              <>
                <Video source={{ uri: sourceUri }} style={styles.video} resizeMode="contain" paused={true} onLoad={onVideoLoad} />
                <Svg style={StyleSheet.absoluteFill}>
                  <AnimatedLine animatedProps={animatedLineProps} stroke="#007AFF" strokeWidth={2} strokeDasharray="5, 5" />
                </Svg>
                <CalibrationHandle position={point1} liveOffset={liveOffset1} isDragging={isDragging1} />
                <CalibrationHandle position={point2} liveOffset={liveOffset2} isDragging={isDragging2} />
              </>
            )}
          </View>
        </GestureDetector>

        <GlassPanel>
          <View style={styles.panelContent}>
            <View style={styles.instructionRow}>
              <Ionicons name="hand-left-outline" size={20} color="#007AFF" />
              <Text style={styles.instructionText}>Place one point on the front service line and the other on the doubles long service (flick) line.</Text>
            </View>
            <View style={styles.instructionRow}>
              <Ionicons name="move-outline" size={20} color="#007AFF" />
              <Text style={styles.instructionText}>Tip: Drag from the area around a point to avoid covering it with your finger</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.inputRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="resize-outline" size={20} color="#3c3c43" />
                <Text style={styles.inputLabel}>Reference Length</Text>
              </View>
              <View style={styles.inputWrapper}>
                <TextInput value={referenceLength} onChangeText={setReferenceLength} keyboardType="decimal-pad" style={styles.textInput} />
                <Text style={styles.unitText}>meters</Text>
              </View>
            </View>
            <TouchableOpacity onPress={calculateAndProceed} style={styles.confirmButton}>
              <Text style={styles.confirmButtonText}>Start Analysis</Text>
            </TouchableOpacity>
          </View>
        </GlassPanel>
      </ImageBackground>
      <Modal visible={showInfoSheet} animationType="slide" onRequestClose={() => setShowInfoSheet(false)}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Calibration Info</Text>
          <Text style={{ textAlign: 'center', padding: 20 }}>Detailed instructions about how to properly calibrate would go here.</Text>
          <TouchableOpacity onPress={() => setShowInfoSheet(false)} style={styles.confirmButton}>
            <Text style={styles.confirmButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </GestureHandlerRootView>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    height: 44,
    backgroundColor: 'rgba(248, 248, 248, 0.85)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.29)',
  },
  topBarButton: { padding: 8, minWidth: 70, alignItems: 'center' },
  topBarButtonText: { color: '#007AFF', fontSize: 17 },
  topBarTitle: { fontSize: 17, fontWeight: '600' },
  videoContainer: { flex: 1, backgroundColor: 'transparent' }, // MODIFIED: Changed from #000
  video: { ...StyleSheet.absoluteFillObject },
  handleContainer: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateX: -40 }, { translateY: -40 }],
  },
  handleDragIndicator: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0, 122, 255, 0.2)',
  },
  handlePin: {
    width: 24,
    height: 32,
    alignItems: 'center',
    transform: [{ translateY: -16 }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  handlePinDot: {
    position: 'absolute',
    top: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
  },
  handlePinCenterDot: {
    position: 'absolute',
    top: 16,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.5)',
  },
  glassPanel: { borderRadius: 35, overflow: 'hidden', margin: 16 },
  glassPanelAndroid: {
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderRadius: 35,
    margin: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  panelContent: { padding: 30, gap: 16 },
  instructionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  instructionText: { fontSize: 16, color: '#3c3c43', flex: 1, lineHeight: 22 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(60, 60, 67, 0.29)', marginVertical: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inputLabel: { fontSize: 17, fontWeight: '500' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  textInput: {
    backgroundColor: 'rgba(118, 118, 128, 0.12)',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    width: 80,
    textAlign: 'center',
    fontSize: 17,
  },
  unitText: { fontSize: 17, color: '#3c3c43' },
  confirmButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  confirmButtonText: { color: 'white', fontSize: 17, fontWeight: '600' },
});