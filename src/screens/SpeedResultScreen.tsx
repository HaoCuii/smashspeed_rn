import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import { Feather } from '@expo/vector-icons';
import auth from '@react-native-firebase/auth';
import { getFirestore, collection, addDoc, serverTimestamp } from '@react-native-firebase/firestore';
import storage from '@react-native-firebase/storage';
import { trim } from 'react-native-video-trim';
import * as FileSystem from 'expo-file-system';
import { RouteProp, useRoute } from '@react-navigation/native';
import { RootStackParamList } from '../../App';

type SpeedResultRouteProp = RouteProp<RootStackParamList, 'SpeedResult'>;

export default function SpeedResultScreen({ navigation }: any) {
  const route = useRoute<SpeedResultRouteProp>();
  const { maxKph, angle, videoUri, startSec, endSec } = route.params;

  const [displaySpeed, setDisplaySpeed] = useState(0);
  const [displayAngle, setDisplayAngle] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'trimming' | 'saving' | 'saved' | 'not_logged_in' | 'error'>('idle');

  const animationValue = useRef(new Animated.Value(0)).current;
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!hasAnimated.current) {
      hasAnimated.current = true;
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

  useEffect(() => {
    const listener = animationValue.addListener(({ value }) => {
      setDisplaySpeed(value * maxKph);
      setDisplayAngle(value * angle);
    });
    return () => animationValue.removeListener(listener);
  }, [animationValue, maxKph, angle]);

  const goHome = () => navigation.navigate('Tabs');

  const renderSaveStatus = () => {
    switch (saveStatus) {
      case 'trimming':
        return <StatusIndicator text="Processing video..." color="#007AFF" icon={null} />;
      case 'saving':
        return <StatusIndicator text="Saving result..." color="#007AFF" icon={null} />;
      case 'saved':
        return <StatusIndicator text="Result saved" color="#007AFF" icon="check-circle" />;
      case 'not_logged_in':
        return <StatusIndicator text="Result not saved - Please log in" color="#007AFF" icon="info" />;
      case 'error':
        return <StatusIndicator text="Failed to save" color="#FF3B30" icon="alert-circle" />;
      default:
        return null;
    }
  };

  useEffect(() => {
    const saveResult = async () => {
      const user = auth().currentUser;
      if (!user) return setSaveStatus('not_logged_in');
      if (!videoUri) return setSaveStatus('error');

      setSaveStatus('trimming');
      try {
        const { uid } = user;
        const timestamp = Date.now();
        const trimmedFilename = `trimmed_${timestamp}.mp4`;
        const trimmedPath = FileSystem.cacheDirectory + trimmedFilename;

        console.log('Trimming video from', startSec, 'to', endSec, 'seconds');

        const resultPath = await trim(videoUri, { startTime: startSec*1000, endTime: endSec*1000});
        setSaveStatus('saving');

        const filename = `${timestamp}.mp4`;
        const storageRef = storage().ref(`videos/${uid}/${filename}`);
        await storageRef.putFile(resultPath);
        const videoURL = await storageRef.getDownloadURL();

        await FileSystem.deleteAsync(resultPath).catch(console.warn);

        const db = getFirestore();
        await addDoc(collection(db, 'users', uid, 'detections'), {
          angle: Math.round(angle),
          date: serverTimestamp(),
          peakSpeedKph: Math.round(maxKph),
          videoURL,
        });

        setSaveStatus('saved');
      } catch (error) {
        console.error("Failed to save result:", error);
        setSaveStatus('error');
      }
    };

    saveResult();
  }, [maxKph, angle, videoUri, startSec, endSec]);

  return (
    <View style={styles.container}>
      <LinearGradient colors={['rgba(0, 122, 255, 0.1)', 'rgba(0, 122, 255, 0.05)', 'transparent']} style={styles.backgroundGradient} />
      <View style={[styles.floatingCircle, styles.circle1]} />
      <View style={[styles.floatingCircle, styles.circle2]} />
      <SafeAreaView style={styles.root}>
        <View style={styles.content}>
          <Text style={styles.title}>Your smash speed is:</Text>
          <View style={styles.speedDisplay}>
            <Text style={styles.speedNumber}>{displaySpeed.toFixed(1)}</Text>
            <Text style={styles.speedUnit}>km/h</Text>
          </View>
          <View style={styles.angleDisplay}>
            <Text style={styles.angleValue}>{Math.round(displayAngle)}°</Text>
            <Text style={styles.angleLabel}>Trajectory Angle</Text>
          </View>
          <View style={styles.statusWrapper}>{renderSaveStatus()}</View>
        </View>
        <View style={styles.footer}>
          <TouchableOpacity onPress={goHome} style={styles.primaryButton}>
            <Feather name="home" size={20} color="white" />
            <Text style={styles.primaryButtonText}>New Analysis</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

// Reusable component for status indication
function StatusIndicator({ text, color, icon }: { text: string; color: string; icon: string | null }) {
  return (
    <View style={styles.statusContainer}>
      {icon ? <Feather name={icon as any} size={18} color={color} /> : <ActivityIndicator size="small" color={color} />}
      <Text style={[styles.statusText, { color }]}>{text}</Text>
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
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 40,
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
  statusWrapper: {
    marginTop: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  statusText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
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