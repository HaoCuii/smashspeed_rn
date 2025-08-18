import React from 'react';
import {
    View, Text, Image, FlatList, Dimensions, StyleSheet, TouchableOpacity,
    Animated, ScrollView, StatusBar, Platform
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Entypo from 'react-native-vector-icons/Entypo';
import { BlurView } from 'expo-blur';
import { useRef, useState, useEffect } from 'react';

//================================================================================
// Constants & Configuration
//================================================================================

const { width } = Dimensions.get('window');

// --- Localization Strings ---
const strings = {
  onboarding_getStartedButton: "Get Started",
  onboarding_slide1_title: "1. Record Your Smash",
  onboarding_slide1_instruction1: "Set the camera on the sideline, facing straight across. Court lines should look parallel to the frame.",
  onboarding_slide1_instruction2: "Keep the shuttle visible — avoid glare or busy backgrounds.",
  onboarding_slide1_instruction3: "Use regular video. Avoid Slo-Mo or filters.",
  onboarding_slide1_instruction4: "Trim to just the smash — under 1 second (~10 frames).",
  onboarding_slide2_title: "2. Mark a Known Distance",
  onboarding_slide2_instruction1: "Mark the front service line and doubles service line — 3.87 m apart.",
  onboarding_slide2_instruction2: "Place the line directly under the player.",
  onboarding_slide2_instruction3: "Keep 3.87 m unless using different lines — changing it may reduce accuracy.",
  onboarding_slide3_title: "3. Review Detection",
  onboarding_slide3_instruction1: "Use the slider or arrow keys to move through each frame and view the shuttle speed.",
  onboarding_slide3_instruction2: "Use the 'Interpolate' tool to automatically fill in gaps between good detections. This is highly recommended.",
  onboarding_slide3_instruction3: "For fine-tuning, use the manual controls to move, resize, add, or remove a detection box.",
  onboarding_slide3_instruction4: "If you make a mistake, use the undo/redo buttons in the top left.",
  onboarding_swipePrompt: "Swipe to get started",
  onboarding_welcome_title: "Welcome to",
  onboarding_welcome_brand: "Smashspeed",
  onboarding_welcome_prompt: "Wanna know how fast you really smash?"
};

// --- Onboarding Slides Data ---
const slides = [
  { type: 'welcome', images: [require('../../assets/AppIconTransparent.png')] },
  {
    type: 'instruction',
    title: strings.onboarding_slide1_title,
    images: [
      require('../../assets/OnboardingSlide1.2.png'),
      require('../../assets/OnboardingSlide1.1.png')
    ],
    instructions: [
      { icon: 'swap-horizontal', iconSet: 'Ionicons', text: strings.onboarding_slide1_instruction1 },
      { icon: 'eye', iconSet: 'Ionicons', text: strings.onboarding_slide1_instruction2 },
      { icon: 'videocam-off', iconSet: 'Ionicons', text: strings.onboarding_slide1_instruction3 },
      { icon: 'cut', iconSet: 'Ionicons', text: strings.onboarding_slide1_instruction4 }
    ]
  },
  {
    type: 'instruction',
    title: strings.onboarding_slide2_title,
    images: [
      require('../../assets/OnboardingSlide2.1.png'),
      require('../../assets/OnboardingSlide2.2.png'),
      require('../../assets/OnboardingSlide2.3.png')
    ],
    instructions: [
      { icon: 'crosshairs-gps', iconSet: 'MaterialCommunityIcons', text: strings.onboarding_slide2_instruction1 },
      { icon: 'person', iconSet: 'Ionicons', text: strings.onboarding_slide2_instruction2 },
      { icon: 'ruler', iconSet: 'Entypo', text: strings.onboarding_slide2_instruction3 }
    ]
  },
  {
    type: 'instruction',
    title: strings.onboarding_slide3_title,
    images: [
      require('../../assets/OnboardingSlide3.1.png'),
      require('../../assets/OnboardingSlide3.2.png')
    ],
    instructions: [
      { icon: 'swap-horizontal', iconSet: 'Ionicons', text: strings.onboarding_slide3_instruction1 },
      { icon: 'vector-rectangle', iconSet: 'MaterialCommunityIcons', text: strings.onboarding_slide3_instruction2 },
      { icon: 'options', iconSet: 'Ionicons', text: strings.onboarding_slide3_instruction3 },
      { icon: 'checkmark-circle', iconSet: 'Ionicons', text: strings.onboarding_slide3_instruction4 }
    ],
    isLast: true
  }
];

//================================================================================
// Reusable UI Components
//================================================================================

const BackgroundGradient = () => {
  const animatedValue1 = useRef(new Animated.Value(0)).current;
  const animatedValue2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createLoopingAnimation = (value, duration) => Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration, useNativeDriver: false }),
        Animated.timing(value, { toValue: 0, duration, useNativeDriver: false }),
      ])
    );
    const animation1 = createLoopingAnimation(animatedValue1, 4000);
    const animation2 = createLoopingAnimation(animatedValue2, 6000);
    animation1.start();
    animation2.start();
    return () => {
      animation1.stop();
      animation2.stop();
    };
  }, []);

  const circle1Transform = animatedValue1.interpolate({ inputRange: [0, 1], outputRange: [-150, -100] });
  const circle2Transform = animatedValue2.interpolate({ inputRange: [0, 1], outputRange: [150, 100] });

  return (
    <>
      <Animated.View style={[styles.backgroundCircle1, { transform: [{ translateX: circle1Transform }, { translateY: -200 }] }]} />
      <Animated.View style={[styles.backgroundCircle2, { transform: [{ translateX: circle2Transform }, { translateY: 150 }] }]} />
    </>
  );
};

const GlassPanel = ({ children, style }) => {
  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={20} tint="light" style={[styles.glassPanel, style]}>{children}</BlurView>
    );
  }
  return <View style={[styles.glassPanelAndroid, style]}>{children}</View>;
};

const IconComponent = ({ icon, iconSet, size = 24, color = '#007AFF' }) => {
  const iconProps = { name: icon, size, color };
  switch (iconSet) {
    case 'MaterialCommunityIcons': return <MaterialCommunityIcons {...iconProps} />;
    case 'Entypo': return <Entypo {...iconProps} />;
    default: return <Ionicons {...iconProps} />;
  }
};

//================================================================================
// Onboarding Screen Components
//================================================================================

function WelcomeSlide({ currentSlide, slideIndex }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-30)).current;

  useEffect(() => {
    if (currentSlide === slideIndex) {
      Animated.stagger(100, [
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
      ]).start();
    }
  }, [currentSlide, slideIndex]);

  return (
    <View style={styles.slide}>
      <View style={styles.welcomeContent}>
        <GlassPanel style={styles.welcomeCard}>
          <Animated.View style={[styles.welcomeInner, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <Image source={require('../../assets/AppIconTransparent.png')} style={styles.appIcon} resizeMode="contain" />
            <View style={styles.titleContainer}>
              <Text style={styles.welcomeTitle}>{strings.onboarding_welcome_title}</Text>
              <Text style={styles.brandTitle}>{strings.onboarding_welcome_brand}</Text>
            </View>
            <Text style={styles.welcomePrompt}>{strings.onboarding_welcome_prompt}</Text>
          </Animated.View>
        </GlassPanel>
      </View>
      <View style={styles.swipePromptContainer}>
        <Ionicons name="chevron-forward" size={16} color="#666" />
        <Text style={styles.swipeText}>{strings.onboarding_swipePrompt}</Text>
      </View>
    </View>
  );
}

function InstructionSlide({ slide, currentSlide, slideIndex, onComplete }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-30)).current;
  const imageScrollViewRef = useRef(null); // Changed ref name for clarity
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const imageCarouselWidth = width - 100;

  useEffect(() => {
    if (currentSlide === slideIndex) {
      Animated.stagger(150, [
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
      ]).start();
    }
  }, [currentSlide, slideIndex]);

  // --- FIX: Use scrollTo for ScrollView instead of scrollToIndex ---
  const handleImageScroll = (direction) => {
    const newIndex = direction === 'next'
      ? Math.min(slide.images.length - 1, currentImageIndex + 1)
      : Math.max(0, currentImageIndex - 1);
    
    setCurrentImageIndex(newIndex);
    imageScrollViewRef.current?.scrollTo({ x: newIndex * imageCarouselWidth, y: 0, animated: true });
  };
  
  const renderImageCarousel = () => (
    <View style={styles.imageCarouselContainer}>
      {/* --- FIX: Replaced FlatList with ScrollView to prevent nesting error --- */}
      <ScrollView
        ref={imageScrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={ev => {
          const newIndex = Math.round(ev.nativeEvent.contentOffset.x / imageCarouselWidth);
          setCurrentImageIndex(newIndex);
        }}
        scrollEventThrottle={16}
        style={{ width: imageCarouselWidth }}
      >
        {slide.images.map((image, index) => (
            <Image key={index} source={image} style={[styles.instructionImage, { width: imageCarouselWidth }]} resizeMode="contain" />
        ))}
      </ScrollView>
      {slide.images.length > 1 && (
        <>
          {currentImageIndex > 0 && (
            <TouchableOpacity style={[styles.arrowButton, styles.leftArrow]} onPress={() => handleImageScroll('prev')}>
              <Ionicons name="chevron-back" size={16} color="#333" />
            </TouchableOpacity>
          )}
          {currentImageIndex < slide.images.length - 1 && (
            <TouchableOpacity style={[styles.arrowButton, styles.rightArrow]} onPress={() => handleImageScroll('next')}>
              <Ionicons name="chevron-forward" size={16} color="#333" />
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );

  // Note: The parent is now a View, but could be a ScrollView if vertical scroll is needed.
  // For this layout, a View is sufficient and safer.
  return (
    <View style={styles.slide}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <Animated.Text style={[styles.instructionTitle, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {slide.title}
        </Animated.Text>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <GlassPanel style={styles.instructionCard}>
            <View style={styles.instructionContent}>
              {renderImageCarousel()}
              <View style={styles.instructionsContainer}>
                {slide.instructions.map((instruction, idx) => (
                  <View key={idx} style={styles.instructionRow}>
                    <View style={styles.iconContainer}>
                      <IconComponent icon={instruction.icon} iconSet={instruction.iconSet} size={24} color="#007AFF" />
                    </View>
                    <Text style={styles.instructionText}>{instruction.text}</Text>
                  </View>
                ))}
              </View>
            </View>
          </GlassPanel>
        </Animated.View>
        {slide.isLast && (
          <Animated.View style={[styles.getStartedContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <TouchableOpacity onPress={onComplete} style={styles.getStartedButton}>
              <Text style={styles.getStartedText}>{strings.onboarding_getStartedButton}</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
  
}

//================================================================================
// Main Onboarding Component
//================================================================================

export default function Onboarding({ onComplete }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;

  const renderSlide = ({ item, index }) => {
    return item.type === 'welcome'
      ? <WelcomeSlide currentSlide={currentSlide} slideIndex={index} />
      : <InstructionSlide slide={item} currentSlide={currentSlide} slideIndex={index} onComplete={onComplete} />;
  };

  const PageIndicator = () => (
    <View style={styles.pageIndicator}>
      {slides.map((_, index) => (
        <View key={index} style={[styles.dot, currentSlide === index ? styles.activeDot : styles.inactiveDot]} />
      ))}
    </View>
  );

  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <View style={styles.container}>
        <BackgroundGradient />
        <Animated.FlatList
          data={slides}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(_, i) => i.toString()}
          renderItem={renderSlide}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: true } // Can set to true now for performance
          )}
          onMomentumScrollEnd={ev => setCurrentSlide(Math.round(ev.nativeEvent.contentOffset.x / width))}
        />

          <TouchableOpacity onPress={onComplete} style={styles.closeButton}>
            <Ionicons name="close-circle" size={32} color="rgba(128, 128, 128, 0.8)" />
          </TouchableOpacity>
        
        <PageIndicator />
      </View>
    </>
  );
}

//================================================================================
// Styles
//================================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  slide: { width: width, flex: 1 },
  backgroundCircle1: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(0, 122, 255, 0.8)', top: -100, left: -100, opacity: 0.6 },
  backgroundCircle2: { position: 'absolute', width: 360, height: 360, borderRadius: 180, backgroundColor: 'rgba(0, 122, 255, 0.5)', bottom: -100, right: -100, opacity: 0.4 },
  glassPanel: { borderRadius: 35, overflow: 'hidden', backgroundColor: 'rgba(255, 255, 255, 1)' },
  glassPanelAndroid: { backgroundColor: 'rgba(255, 255, 255, 1)', borderRadius: 35, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.1, shadowRadius: 15 },
  welcomeContent: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  welcomeCard: { marginHorizontal: 0 },
  welcomeInner: { padding: 40, alignItems: 'center' },
  appIcon: { width: 100, height: 100, marginBottom: 25 },
  titleContainer: { alignItems: 'center', marginBottom: 15 },
  welcomeTitle: { fontSize: 20, fontWeight: '500', color: '#666', marginBottom: 5 },
  brandTitle: { fontSize: 48, fontWeight: 'bold', color: '#007AFF' },
  welcomePrompt: { fontSize: 18, color: '#666', textAlign: 'center', lineHeight: 24 },
  swipePromptContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingBottom: 40, gap: 8 },
  swipeText: { color: '#666', fontWeight: '600', fontSize: 16 },
  instructionTitle: { fontSize: 32, fontWeight: 'bold', textAlign: 'center', marginTop: 80, marginBottom: 30, marginHorizontal: 20, color: '#333' },
  instructionCard: { marginHorizontal: 20, marginBottom: 30 },
  instructionContent: { padding: 30, alignItems: 'center' },
  imageCarouselContainer: { position: 'relative', height: 250, marginBottom: 25, alignItems: 'center', justifyContent: 'center' },
  instructionImage: { height: 250 },
  arrowButton: { position: 'absolute', top: '50%', marginTop: -18, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255, 255, 255, 0.9)', justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, zIndex: 10 },
  leftArrow: { left: 5 },
  rightArrow: { right: 5 },
  instructionsContainer: { gap: 25, alignSelf: 'stretch', marginTop: 25 },
  instructionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  iconContainer: { width: 30, alignItems: 'center', paddingTop: 2 },
  instructionText: { flex: 1, fontSize: 16, fontWeight: '600', color: '#666', lineHeight: 22 },
  getStartedContainer: { alignItems: 'center', paddingTop: 10, paddingBottom: 20 },
  getStartedButton: { backgroundColor: '#007AFF', paddingHorizontal: 40, paddingVertical: 16, borderRadius: 25, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
  getStartedText: { color: '#fff', fontWeight: '600', fontSize: 18 },
  closeButton: { position: 'absolute', top: Platform.OS === 'ios' ? 60 : 40, right: 20, zIndex: 10 },
  pageIndicator: { position: 'absolute', bottom: 20, width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  activeDot: { backgroundColor: '#007AFF' },
  inactiveDot: { backgroundColor: 'rgba(0, 122, 255, 0.3)' },
});