// src/screens/DetectScreen.tsx
import React, { useState } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, SafeAreaView, Image, ImageBackground,
  Platform, StatusBar, ScrollView, Linking, Alert, PermissionsAndroid,
  InteractionManager,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { launchCamera, launchImageLibrary, Asset } from 'react-native-image-picker';
import Modal from 'react-native-modal'; // Using react-native-modal for all popups
import { BlurView } from 'expo-blur';

import AppIcon from '../components/AppIcon';
import CourtDiagram from '../../assets/courtdiagram.png';
import Onboarding from './OnboardingScreen';

// Type definition for navigation parameters
type RootStackParamList = {
  Trim: { sourceUri: string; duration: number };
};

const GlassPanel = ({ children, style }) => (
  <BlurView intensity={80} tint="light" style={style}>
    {children}
  </BlurView>
);

const DetectScreen = () => {
  const [showInputSelector, setShowInputSelector] = useState(false);
  const [showRecordingGuide, setShowRecordingGuide] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const navigation = useNavigation<{ navigate: (screen: 'Trim', params: RootStackParamList['Trim']) => void }>();

  // Permissions & handlers
  const requestCameraPermission = async () => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'SmashSpeed needs access to your camera to record videos.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn(err);
      return false;
    }
  };

  const requestStoragePermission = async () => {
    if (Platform.OS !== 'android') return true;
    try {
      if (Platform.Version >= 33) {
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        ]);
        return results[PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO] === PermissionsAndroid.RESULTS.GRANTED;
      }
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        {
          title: 'Storage Permission',
          message: 'SmashSpeed needs access to your storage to select a video.',
          buttonPositive: 'OK',
          buttonNegative: 'Cancel',
        }
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch (e) {
      console.warn('Permission error', e);
      return false;
    }
  };

  const navigateToTrim = (uri: string, durationSec: number | undefined) => {
    navigation.navigate('Trim', { sourceUri: uri, duration: durationSec || 0 });
  };

  const handleRecordNewVideo = async () => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Cannot open camera without permission.');
      return;
    }
    setShowInputSelector(false);

    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        launchCamera(
          {
            mediaType: 'video',
            videoQuality: 'high',
            includeExtra: true,
          },
          (response) => {
            if (response?.didCancel) return;
            if (response?.errorCode) {
              Alert.alert('Error', response.errorMessage || 'Failed to record video.');
              return;
            }
            const asset: Asset | undefined = response?.assets?.[0];
            const uri = asset?.uri;
            const durationSec = asset?.duration;
            if (uri) navigateToTrim(uri, durationSec);
            else Alert.alert('No video', 'No video was returned by the camera.');
          }
        );
      }, 120);
    });
  };

  const handleChooseFromLibrary = async () => {
    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Cannot access library without permission.');
      return;
    }
    setShowInputSelector(false);

    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        launchImageLibrary(
          {
            mediaType: 'video',
            selectionLimit: 1,
            includeExtra: true,
          },
          (response) => {
            if (response?.didCancel) return;
            if (response?.errorCode) {
              Alert.alert('Error', response.errorMessage || 'Failed to select video.');
              return;
            }
            const asset: Asset | undefined = response?.assets?.[0];
            const uri = asset?.uri;
            const durationSec = asset?.duration;
            if (uri) navigateToTrim(uri, durationSec);
            else Alert.alert('No video', 'No video was returned by the picker.');
          }
        );
      }, 120);
    });
  };

  return (
    <ImageBackground
      style={styles.container}
      source={require('../../assets/aurora_background.png')}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/AppLabel.png')}
              style={styles.headerImage}
            />
          </View>
          <TouchableOpacity onPress={() => setShowOnboarding(true)}>
            <AppIcon name="info.circle" fallbackName="info" size={22} color="#007AFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
            <>
              <TouchableOpacity onPress={() => setShowInputSelector(true)}>
                <View style={[styles.mainButton, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                  <AppIcon
                    name="arrow.up.circle.fill"
                    fallbackName="arrow-up"
                    size={70}
                    color="rgba(255,255,255,0.8)"
                    style={styles.mainButtonIcon}
                  />
                </View>
              </TouchableOpacity>
              <Text style={styles.promptText}>Select a video to begin</Text>
              <TouchableOpacity style={styles.guideButton} onPress={() => setShowRecordingGuide(true)}>
                <AppIcon name="questionmark.circle" fallbackName="help-circle" size={16} color="#007AFF" />
                <Text style={styles.guideButtonText}>How to Record</Text>
              </TouchableOpacity>
            </>
        </View>
      </SafeAreaView>

      <InputSourceSelectorModal
        visible={showInputSelector}
        onClose={() => setShowInputSelector(false)}
        onRecord={handleRecordNewVideo}
        onChoose={handleChooseFromLibrary}
      />

      {/* TALL, DRAGGABLE "HOW TO RECORD" MODAL */}
      <Modal
        isVisible={showRecordingGuide}
        onSwipeComplete={() => setShowRecordingGuide(false)}
        swipeDirection={['down']}
        onBackdropPress={() => setShowRecordingGuide(false)}
        style={styles.tallSheetModal}
      >
        <RecordingGuideModalContent onClose={() => setShowRecordingGuide(false)} />
      </Modal>

      {/* ONBOARDING POPUP STYLED TO HAVE GAP AT TOP */}
      <Modal
        isVisible={showOnboarding}
        onSwipeComplete={() => setShowOnboarding(false)}
        swipeDirection={['down']}
        style={styles.onboardingModal} // MODIFICATION: Applied new style
      >
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      </Modal>
    </ImageBackground>
  );
};

// --- Child Components ---

interface InputSourceSelectorModalProps {
  visible: boolean;
  onClose: () => void;
  onRecord: () => void;
  onChoose: () => void;
}

const InputSourceSelectorModal = ({ visible, onClose, onRecord, onChoose }: InputSourceSelectorModalProps) => {
  return (
    <Modal
      isVisible={visible}
      onSwipeComplete={onClose}
      swipeDirection={['down']}
      onBackdropPress={onClose}
      style={styles.bottomSheetModal}
    >
        <GlassPanel style={styles.inputSelectorSheet}>
          <View style={styles.grabber} />
          <Text style={styles.inputSelectorTitle}>Analyze a Smash</Text>
          <View style={styles.warningBox}>
            <AppIcon name="exclamationmark.triangle" fallbackName="alert-triangle" size={16} color="#555" />
            <Text style={styles.warningText}>Only landscape videos are supported.</Text>
          </View>
          <View style={styles.inputSelectorCard}>
            <TouchableOpacity style={[styles.inputButton, styles.inputButtonProminent]} onPress={onRecord}>
              <AppIcon name="camera.fill" fallbackName="camera" size={20} color="#FFF" />
              <Text style={[styles.inputButtonText, styles.inputButtonTextProminent]}>Record New Video</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.inputButton, styles.inputButtonBordered]} onPress={onChoose}>
              <AppIcon name="photo.on.rectangle.angled" fallbackName="image" size={20} color="#007AFF" />
              <Text style={[styles.inputButtonText, styles.inputButtonTextBordered]}>Choose from Library</Text>
            </TouchableOpacity>
          </View>
        </GlassPanel>
    </Modal>
  );
};

interface RecordingGuideModalProps {
  onClose: () => void;
}

const RecordingGuideModalContent = ({ onClose }: RecordingGuideModalProps) => {
  const openTutorial = () => Linking.openURL('https://smashspeed.ca').catch(() => {});
  return (
    <ImageBackground
      source={require('../../assets/aurora_background.png')}
      style={styles.rgBg}
      imageStyle={styles.rgBgImage}
    >
      <SafeAreaView style={styles.rgSafeArea}>
        <View style={styles.rgHeader}>
          <TouchableOpacity onPress={onClose} style={styles.doneButton}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
          <Text style={styles.rgTitle}>Recording Guide</Text>
          <View style={styles.headerRightSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.rgScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity onPress={openTutorial} activeOpacity={0.7}>
            <Text style={styles.rgCaption}>For a video tutorial, visit smashspeed.ca</Text>
          </TouchableOpacity>
          <Image source={CourtDiagram} style={styles.rgDiagram} resizeMode="contain" />
          <GlassPanel style={styles.rgCard}>
            <Text style={styles.rgCardTitle}>How to Record for Best Results</Text>
            <View style={styles.rgRow}>
              <AppIcon name="video.fill" fallbackName="video" size={20} color="#007AFF" />
              <Text style={styles.rgRowText}><Text style={styles.rgBold}>Player A (Recorder): </Text>Stand in the side tram lines.</Text>
            </View>
            <View style={styles.rgRow}>
              <AppIcon name="figure.tennis" fallbackName="user" size={20} color="#007AFF" />
              <Text style={styles.rgRowText}><Text style={styles.rgBold}>Player B (Smasher): </Text>Smash from the opposite half of the court.</Text>
            </View>
            <View style={styles.rgRow}>
              <AppIcon name="camera.viewfinder" fallbackName="camera" size={20} color="#007AFF" />
              <Text style={styles.rgRowText}><Text style={styles.rgBold}>Camera: </Text>Use landscape mode with <Text style={styles.rgMono}>0.5×</Text> zoom.</Text>
            </View>
            <View style={styles.rgRow}>
              <AppIcon name="film.stack" fallbackName="film" size={20} color="#007AFF" />
              <Text style={styles.rgRowText}><Text style={styles.rgBold}>Frame Rate: </Text>30 FPS is fine; 60 FPS is better.</Text>
            </View>
          </GlassPanel>
        </ScrollView>
      </SafeAreaView>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  // Main
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 25, marginTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 10 : 10 },
  headerLeft: { alignItems: 'flex-start' },
  headerImage: { width: 150, height: 35, resizeMode: 'contain' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 60 },
  mainButton: { width: 160, height: 160, borderRadius: 80, justifyContent: 'center', alignItems: 'center' },
  mainButtonIcon: { shadowColor: '#000', shadowRadius: 5, shadowOpacity: 0.3, shadowOffset: { width: 0, height: 2 } },
  promptText: { marginTop: 20, fontSize: 17, fontWeight: '600', color: 'gray' },
  guideButton: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#E5E5EA', borderRadius: 20 },
  guideButtonText: { color: '#007AFF', marginLeft: 12, fontSize: 14, fontWeight: '600' },

  // Modal Styles
  bottomSheetModal: {
    justifyContent: 'flex-end',
    margin: 0,
  },
  tallSheetModal: {
    margin: 0,
    paddingTop: '8%', // Creates space at the top, pushing content down
  },
  // MODIFICATION: New style for the onboarding modal
  onboardingModal: {
    margin: 0,
    paddingTop: '8%', // Creates space at the top, pushing content down
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#D1D1D6',
    alignSelf: 'center',
    marginBottom: 10,
  },

  // Input source bottom sheet
  inputSelectorSheet: {
    paddingTop: 10,
    paddingBottom: (StatusBar.currentHeight || 0) + 30,
    paddingHorizontal: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  inputSelectorTitle: { fontSize: 18, fontWeight: '600', color: '#3C3C43', marginBottom: 10 },
  warningBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(174,174,178,0.2)', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, marginBottom: 15 },
  warningText: { marginLeft: 8, fontSize: 14, fontWeight: '500', color: '#3C3C43' },
  inputSelectorCard: { width: '100%', padding: 20, borderRadius: 20, backgroundColor: '#FFFFFF' },
  inputButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', paddingVertical: 16, borderRadius: 14 },
  inputButtonProminent: { backgroundColor: '#007AFF', marginBottom: 12 },
  inputButtonBordered: { backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1, borderColor: 'rgba(60,60,67,0.1)' },
  inputButtonText: { fontSize: 17, fontWeight: '600', marginLeft: 10 },
  inputButtonTextProminent: { color: '#FFF' },
  inputButtonTextBordered: { color: '#007AFF' },

  // "How to Record" Modal Styles
  rgBg: {
    flex: 1,
    width: '100%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  rgBgImage: {
    resizeMode: 'cover',
  },
  rgSafeArea: {
    flex: 1,
  },
  rgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: 'transparent',
  },
  doneButton: { paddingVertical: 6, paddingHorizontal: 4, minWidth: 54 },
  doneButtonText: { color: '#007AFF', fontSize: 17, fontWeight: '600', textAlign: 'left' },
  rgTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#000' },
  headerRightSpacer: { width: 54 },
  rgScrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  rgCaption: { fontSize: 13, color: '#1F2937', textAlign: 'center', marginVertical: 20, textDecorationLine: 'underline', marginBottom: 60},
  rgDiagram: { width: '90%', height: 200, marginBottom: 20, alignSelf: 'center' },
  rgCard: { 
    width: '100%', 
    padding: 18, 
    borderRadius: 16,
    overflow: 'hidden',
  },
  rgCardTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 12, color: '#1F2937', textAlign: 'center' },
  rgRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  rgRowText: { marginLeft: 10, fontSize: 16, color: '#1F2937', lineHeight: 20, flex: 1 },
  rgBold: { fontWeight: '700' },
  rgMono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontWeight: '600' },
});

export default DetectScreen;
