import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialIcons';

type SpeedResultParams = {
  maxKph: number;
  angle: number;
};

export default function SpeedResultScreen({ route, navigation }: any) {
  const { maxKph, angle } = route.params as SpeedResultParams;
  
  const [displaySpeed, setDisplaySpeed] = useState(0);
  const [displayAngle, setDisplayAngle] = useState(0);
  const animationValue = useRef(new Animated.Value(0)).current;
  const hasAnimated = useRef(false);

  // Start the rolling animation when component mounts
  useEffect(() => {
    if (!hasAnimated.current) {
      hasAnimated.current = true;
      
      // Start animation after a small delay
      setTimeout(() => {
        Animated.timing(animationValue, {
          toValue: 1,
          duration: 1500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
      }, 500);
    }
  }, [animationValue]);

  // Update display values based on animation progress
  useEffect(() => {
    const listener = animationValue.addListener(({ value }) => {
      const currentSpeed = value * maxKph;
      const currentAngle = value * angle;
      setDisplaySpeed(currentSpeed);
      setDisplayAngle(currentAngle);
    });

    return () => {
      animationValue.removeListener(listener);
    };
  }, [animationValue, maxKph, angle]);

  const formatSpeed = (speed: number) => {
    return speed.toFixed(1);
  };

  const formatAngle = (angleValue: number) => {
    return Math.round(angleValue);
  };

  const goHome = () => {
    navigation.navigate('Tabs');
  };

  return (
    <View style={styles.container}>
      {/* Background Gradient */}
      <LinearGradient
        colors={['rgba(0, 122, 255, 0.1)', 'rgba(0, 122, 255, 0.05)', 'transparent']}
        style={styles.backgroundGradient}
      />
      
      {/* Floating Circles */}
      <View style={[styles.floatingCircle, styles.circle1]} />
      <View style={[styles.floatingCircle, styles.circle2]} />

      <SafeAreaView style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Analysis Complete</Text>
        </View>

        {/* Main Content */}
        <View style={styles.content}>
          <View style={styles.speedDisplay}>
            <Text style={styles.speedNumber}>
              {formatSpeed(displaySpeed)}
            </Text>
            <Text style={styles.speedUnit}>km/h</Text>
          </View>

          {angle > 0 && (
            <View style={styles.angleDisplay}>
              <Text style={styles.angleValue}>
                {formatAngle(displayAngle)}°
              </Text>
              <Text style={styles.angleLabel}>Trajectory Angle</Text>
            </View>
          )}
        </View>

        {/* Action Button */}
        <View style={styles.footer}>
          <TouchableOpacity onPress={goHome} style={styles.primaryButton}>
            <Icon name="home" size={20} color="white" />
            <Text style={styles.primaryButtonText}>New Analysis</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  floatingCircle: {
    position: 'absolute',
    borderRadius: 100,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
  },
  circle1: {
    width: 200,
    height: 200,
    top: -50,
    left: -100,
  },
  circle2: {
    width: 150,
    height: 150,
    bottom: 100,
    right: -75,
  },
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  speedDisplay: {
    alignItems: 'center',
    marginBottom: 40,
  },
  speedNumber: {
    fontSize: 100,
    fontWeight: '800',
    color: '#007AFF',
    lineHeight: 100,
  },
  speedUnit: {
    fontSize: 24,
    fontWeight: '600',
    color: '#666',
    marginTop: 8,
  },
  angleDisplay: {
    alignItems: 'center',
  },
  angleValue: {
    fontSize: 48,
    fontWeight: '700',
    color: '#000',
  },
  angleLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#888',
    marginTop: 4,
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 10,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 10,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
