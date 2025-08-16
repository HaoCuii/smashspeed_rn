import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Animated,
  Dimensions,
  TouchableOpacity,
  Image,
  StyleSheet,
  SafeAreaView,
  FlatList,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import GlassPanel from '../components/GlassPanel';

const { width, height } = Dimensions.get('window');

// Arrow Button Component
const ArrowButton = ({ icon, onPress }) => (
  <TouchableOpacity onPress={onPress} style={styles.arrowButton}>
    <View style={styles.arrowButtonContainer}>
      <Text style={styles.arrowIcon}>{icon}</Text>
    </View>
  </TouchableOpacity>
);

// Welcome View Component
const OnboardingWelcomeView = ({ slideIndex, currentTab }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-30)).current;
  const iconFade = useRef(new Animated.Value(0)).current;
  const titleFade = useRef(new Animated.Value(0)).current;
  const promptFade = useRef(new Animated.Value(0)).current;
  const swipeFade = useRef(new Animated.Value(0)).current;
  const [showContent, setShowContent] = useState(false);

  const triggerAnimation = () => {
    if (showContent) return;
    setShowContent(true);
    
    // Immediate animation - no delay
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        tension: 100,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();

    // Faster content animations
    Animated.timing(iconFade, {
      toValue: 1,
      duration: 200,
      delay: 100,
      useNativeDriver: true,
    }).start();

    Animated.timing(titleFade, {
      toValue: 1,
      duration: 200,
      delay: 150,
      useNativeDriver: true,
    }).start();

    Animated.timing(promptFade, {
      toValue: 1,
      duration: 200,
      delay: 200,
      useNativeDriver: true,
    }).start();

    Animated.timing(swipeFade, {
      toValue: 1,
      duration: 200,
      delay: 250,
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    if (currentTab === slideIndex) {
      triggerAnimation();
    }
  }, [currentTab, slideIndex]);

  return (
    <View style={styles.welcomeContainer}>
      {/* Background Blurs - Keep original blue decoration for welcome */}
      <View style={[styles.backgroundBlur, styles.blur1]} />
      <View style={[styles.backgroundBlur, styles.blur2]} />
      
      <View style={styles.welcomeContent}>
        <Animated.View
          style={[
            styles.welcomeCard,
            {
              opacity: fadeAnim,
              transform: [{ translateY }],
            },
          ]}
        >
          <GlassPanel style={styles.welcomeGlass}>
            <Animated.View style={{ opacity: iconFade }}>
              <Image
                source={require('../../assets/AppIconTransparent.png')}
                style={styles.appIcon}
              />
            </Animated.View>
            
            <Animated.View style={[styles.titleContainer, { opacity: titleFade }]}>
              <Text style={styles.welcomeSubtitle}>Welcome to</Text>
                              <Text style={styles.welcomeTitle}>Smash</Text>
                <Text style={styles.welcomeTitleSecond}>speed</Text>
            </Animated.View>
            
            <Animated.View style={{ opacity: promptFade }}>
              <Text style={styles.welcomePrompt}>
                Let's get you started with a quick tour
              </Text>
            </Animated.View>
          </GlassPanel>
        </Animated.View>
        
        <Animated.View style={[styles.swipePrompt, { opacity: swipeFade }]}>
          <Text style={styles.swipeText}>Swipe to continue ›</Text>
        </Animated.View>
      </View>
    </View>
  );
};

// Instruction View Component
const OnboardingInstructionView = ({
  slideIndex,
  currentTab,
  images,
  isLastSlide = false,
  onComplete,
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [showContent, setShowContent] = useState(false);

  const triggerAnimation = () => {
    if (showContent) return;
    setShowContent(true);
    
    // Immediate show - no animation
    fadeAnim.setValue(1);
  };

  useEffect(() => {
    if (currentTab === slideIndex) {
      triggerAnimation();
    }
  }, [currentTab, slideIndex]);

  return (
    <View style={styles.instructionContainer}>
      {/* Background decoration - positioned to avoid image area */}
      <View style={styles.backgroundDecoration} />
      
      <View style={styles.instructionContent}>
        <Animated.View
          style={[
            styles.imageOnlyContainer,
            { opacity: fadeAnim },
          ]}
        >
          <GlassPanel style={styles.imageGlassPanel}>
            <Image source={images[0]} style={styles.fullscreenImage} />
          </GlassPanel>
          
          {/* Get Started Button */}
          {isLastSlide && (
            <View style={styles.overlayButton}>
              <TouchableOpacity
                style={styles.getStartedButton}
                onPress={onComplete}
              >
                <LinearGradient
                  colors={['#007AFF', '#0051D5']}
                  style={styles.getStartedGradient}
                >
                  <Text style={styles.getStartedText}>Get Started</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>
      </View>
    </View>
  );
};

// Main Onboarding Component
const OnboardingView = ({ onComplete }) => {
  const [currentTab, setCurrentTab] = useState(0);
  const scrollViewRef = useRef(null);
  const lastSlideIndex = 7;

  // Preload all images using Image.getSize for better preloading
  const preloadImages = () => {
    const imagesToPreload = [
      require('../../assets/AppIconTransparent.png'),
      require('../../assets/OnboardingSlide1.1.png'),
      require('../../assets/OnboardingSlide2.1.png'),
      require('../../assets/OnboardingSlide2.2.png'),
      require('../../assets/OnboardingSlide2.3.png'),
      require('../../assets/OnboardingSlide3.1.png'),
      require('../../assets/OnboardingSlide3.2.png'),
      require('../../assets/OnboardingSlide1.2.png'),
    ];

    // Force loading by creating hidden Image components
    imagesToPreload.forEach((imageSource) => {
      Image.resolveAssetSource(imageSource);
    });
  };

  useEffect(() => {
    preloadImages();
  }, []);

  const slides = [
    {
      type: 'welcome',
      component: OnboardingWelcomeView,
    },
    {
      type: 'instruction',
      images: [
        require('../../assets/OnboardingSlide1.1.png'),
      ],
    },
    {
      type: 'instruction',
      images: [
        require('../../assets/OnboardingSlide2.1.png'),
      ],
    },
    {
      type: 'instruction',
      images: [
        require('../../assets/OnboardingSlide2.2.png'),
      ],
    },
    {
      type: 'instruction',
      images: [
        require('../../assets/OnboardingSlide2.3.png'),
      ],
    },
    {
      type: 'instruction',
      images: [
        require('../../assets/OnboardingSlide3.1.png'),
      ],
    },
    {
      type: 'instruction',
      images: [
        require('../../assets/OnboardingSlide3.2.png'),
      ],
    },
    {
      type: 'instruction',
      images: [
        require('../../assets/OnboardingSlide1.2.png'),
      ],
      isLastSlide: true,
    },
  ];

  const handleScroll = (event) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / width);
    setCurrentTab(index);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={styles.mainScrollView}
      >
        {slides.map((slide, index) => (
          <View key={index} style={styles.slideContainer}>
            {slide.type === 'welcome' ? (
              <OnboardingWelcomeView
                slideIndex={index}
                currentTab={currentTab}
              />
            ) : (
              <OnboardingInstructionView
                slideIndex={index}
                currentTab={currentTab}
                images={slide.images}
                isLastSlide={slide.isLastSlide}
                onComplete={onComplete}
              />
            )}
          </View>
        ))}
      </ScrollView>
      
      {/* Hidden preload images */}
      <View style={styles.hiddenPreloadContainer}>
        <Image source={require('../../assets/AppIconTransparent.png')} style={styles.hiddenImage} />
        <Image source={require('../../assets/OnboardingSlide1.1.png')} style={styles.hiddenImage} />
        <Image source={require('../../assets/OnboardingSlide2.1.png')} style={styles.hiddenImage} />
        <Image source={require('../../assets/OnboardingSlide2.2.png')} style={styles.hiddenImage} />
        <Image source={require('../../assets/OnboardingSlide2.3.png')} style={styles.hiddenImage} />
        <Image source={require('../../assets/OnboardingSlide3.1.png')} style={styles.hiddenImage} />
        <Image source={require('../../assets/OnboardingSlide3.2.png')} style={styles.hiddenImage} />
        <Image source={require('../../assets/OnboardingSlide1.2.png')} style={styles.hiddenImage} />
      </View>
      
      {/* Close Button - Show on all slides */}
      <TouchableOpacity style={styles.closeButton} onPress={onComplete}>
        <View style={styles.closeButtonContainer}>
          <Text style={styles.closeIcon}>×</Text>
        </View>
      </TouchableOpacity>
      
      {/* Page Indicator */}
      <View style={styles.pageIndicator}>
        {slides.map((_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              { 
                backgroundColor: currentTab === index ? '#007AFF' : '#007AFF',
                opacity: currentTab === index ? 1 : 0.3,
              },
            ]}
          />
        ))}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  mainScrollView: {
    flex: 1,
  },
  slideContainer: {
    width,
    height,
  },
  
  // Background Effects - Original blue decoration for welcome, subtle for others
  backgroundBlur: {
    position: 'absolute',
    borderRadius: 200,
  },
  blur1: {
    width: 300,
    height: 300,
    backgroundColor: '#007AFF',
    opacity: 0.8,
    top: -200,
    left: -150,
  },
  blur2: {
    width: 360,
    height: 360,
    backgroundColor: '#007AFF',
    opacity: 0.5,
    bottom: 150,
    right: 150,
  },
  backgroundDecoration: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  
  // Welcome Screen
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcomeContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  welcomeCard: {
    width: '100%',
  },
  welcomeGlass: {
    padding: 50,
    alignItems: 'center',
    marginHorizontal: 20,
    borderRadius: 35,
    paddingVertical: 50,
  },
  appIcon: {
    width: 100,
    height: 100,
    borderRadius: 20,
    marginBottom: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 5,
  },
  titleContainer: {
    alignItems: 'center',
    marginBottom: 15,
  },
  welcomeSubtitle: {
    fontSize: 18,
    fontWeight: '500',
    color: '#000',
    marginBottom: 5,
  },
  welcomeTitle: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#007AFF',
    lineHeight: 50,
  },
  welcomeTitleSecond: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#007AFF',
    marginTop: -10,
  },
  welcomePrompt: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    textAlign: 'center',
    lineHeight: 24,
  },
  swipePrompt: {
    marginTop: 40,
    marginBottom: 60,
  },
  swipeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  
  // Instruction Screen
  instructionContainer: {
    flex: 1,
  },
  instructionContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Get Started Button
  getStartedButton: {
    borderRadius: 25,
    overflow: 'hidden',
  },
  getStartedGradient: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  getStartedText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  
  // Image-only instruction styles
  imageOnlyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  imageGlassPanel: {
    borderRadius: 25,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  fullscreenImage: {
    width: width - 40,
    height: (width - 40) * 0.6, // Maintain aspect ratio for horizontal images
    borderRadius: 25,
    resizeMode: 'contain', // Keep full image visible with correct aspect ratio
  },
  overlayButton: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
  },
  
  // Close Button
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 44,
    height: 44,
  },
  closeButtonContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(142, 142, 147, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 5,
  },
  closeIcon: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  
  // Page Indicator
  pageIndicator: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  
  // Hidden preload styles
  hiddenPreloadContainer: {
    position: 'absolute',
    top: -1000,
    opacity: 0,
  },
  hiddenImage: {
    width: 1,
    height: 1,
  },
});

export default OnboardingView;