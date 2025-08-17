// src/screens/DetectScreen.tsx
import React, { useState } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, SafeAreaView, Image, ImageBackground,
  Platform, StatusBar, Modal, ScrollView, Linking, Alert, PermissionsAndroid,
  Pressable, InteractionManager,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { launchCamera, launchImageLibrary, Asset } from 'react-native-image-picker';

import AppIcon from '../components/AppIcon';
import CourtDiagram from '../../assets/courtdiagram.png';

// ADDED: Type definition for navigation parameters
type RootStackParamList = {
  Trim: { sourceUri: string; duration: number };
};

const DetectScreen = () => {
  const [showInputSelector, setShowInputSelector] = useState(false);
  const [showRecordingGuide, setShowRecordingGuide] = useState(false);
  const [selectedVideoUri, setSelectedVideoUri] = useState<string | null>(null);
  // UPDATED: Added type for navigation
  const navigation = useNavigation<{ navigate: (screen: 'Trim', params: RootStackParamList['Trim']) => void }>();

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

  // UPDATED: Added types for function parameters
  const navigateToTrim = (uri: string, durationSec: number | undefined) => {
    setSelectedVideoUri(uri);
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
            includeExtra: true, // try to get duration from camera result too
          },
          (response) => {
            if (response?.didCancel) return;
            if (response?.errorCode) {
              Alert.alert('Error', response.errorMessage || 'Failed to record video.');
              return;
            }
            const asset: Asset | undefined = response?.assets?.[0];
            const uri = asset?.uri;
            const durationSec = asset?.duration; // may be undefined on some devices
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
            includeExtra: true, // get duration if provided by picker
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
            <Text style={styles.title}>Detect</Text>
          </View>
          <TouchableOpacity>
            <AppIcon name="info.circle" fallbackName="info" size={22} color="#007AFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {selectedVideoUri ? (
            <View style={styles.selectionConfirmation}>
              <Text style={styles.selectionText}>Video Selected!</Text>
              <Text numberOfLines={1} style={styles.uriText}>URI: {selectedVideoUri}</Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('Trim', { sourceUri: selectedVideoUri, duration: 0 })} // duration could be stored in state if needed here
                style={styles.clearButton}
              >
                <Text style={styles.clearButtonText}>Open Trim Screen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setSelectedVideoUri(null)}
                style={[styles.clearButton, { marginTop: 8 }]}
              >
                <Text style={styles.clearButtonText}>Select Another</Text>
              </TouchableOpacity>
            </View>
          ) : (
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
          )}
        </View>
      </SafeAreaView>

    <InputSourceSelectorModal
        visible={showInputSelector}
        onClose={() => setShowInputSelector(false)}
        onRecord={handleRecordNewVideo}
        onChoose={handleChooseFromLibrary}
    />

    <Modal
        visible={showRecordingGuide}
        animationType="slide"
        transparent
        onRequestClose={() => setShowRecordingGuide(false)}
    >
        <View style={styles.modalBackdrop}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowRecordingGuide(false)} />
            <View style={styles.modalSheet}>
                <View style={styles.modalHandle} />
                <ScrollView style={{ maxHeight: 520, width: '100%' }} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
                    <RecordingGuideModal onClose={() => setShowRecordingGuide(false)} />
                </ScrollView>
            </View>
        </View>
    </Modal>
    </ImageBackground>
  );
};

// ADDED: Type definition for component props
interface InputSourceSelectorModalProps {
  visible: boolean;
  onClose: () => void;
  onRecord: () => void;
  onChoose: () => void;
}

/** Input Source Selector Modal */
const InputSourceSelectorModal = ({ visible, onClose, onRecord, onChoose }: InputSourceSelectorModalProps) => {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.inputSelectorSheet} onStartShouldSetResponder={() => true}>
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
        </View>
      </View>
    </Modal>
  );
};

// ADDED: Type definition for component props
interface RecordingGuideModalProps {
  onClose: () => void;
}

const RecordingGuideModal = ({ onClose }: RecordingGuideModalProps) => {
  const openTutorial = () => Linking.openURL('https://smashspeed.ca').catch(() => {});
  return (
    <View style={styles.rgContainer}>
      <View style={styles.rgHeader}>
        <Text style={styles.rgTitle}>Recording Guide</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <AppIcon name="xmark.circle.fill" fallbackName="x-circle" size={22} color="#6B7280" />
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={openTutorial} activeOpacity={0.7}>
        <Text style={styles.rgCaption}>For a video tutorial, visit smashspeed.ca</Text>
      </TouchableOpacity>
      <Image source={CourtDiagram} style={styles.rgDiagram} resizeMode="contain" />
      <View style={styles.rgCard}>
        <Text style={styles.rgCardTitle}>How to Record for Best Results</Text>
        
        <View style={styles.rgRow}>
            <AppIcon name="video.fill" fallbackName="video" size={16} color="#007AFF" />
            <Text style={styles.rgRowText}>
                <Text style={styles.rgBold}>Player A (Recorder): </Text>
                Stand in the side tram lines.
            </Text>
        </View>
        
        <View style={styles.rgRow}>
            <AppIcon name="figure.tennis" fallbackName="user" size={16} color="#007AFF" />
            <Text style={styles.rgRowText}>
                <Text style={styles.rgBold}>Player B (Smasher): </Text>
                Smash from the opposite half of the court.
            </Text>
        </View>
        
        <View style={styles.rgRow}>
            <AppIcon name="camera.viewfinder" fallbackName="camera" size={16} color="#007AFF" />
            <Text style={styles.rgRowText}>
                <Text style={styles.rgBold}>Camera: </Text>
                Use landscape mode with <Text style={styles.rgMono}>0.5×</Text> zoom.
            </Text>
        </View>
        
        <View style={styles.rgRow}>
            <AppIcon name="film.stack" fallbackName="film" size={16} color="#007AFF" />
            <Text style={styles.rgRowText}>
                <Text style={styles.rgBold}>Frame Rate: </Text>
                30 FPS is fine; 60 FPS is better.
            </Text>
        </View>
    </View>
      <TouchableOpacity style={styles.modalPrimaryButton} onPress={onClose}>
        <Text style={styles.modalPrimaryButtonText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 25, marginTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 10 : 10 },
  headerLeft: { alignItems: 'flex-start' },
  headerImage: { width: 150, height: 35, resizeMode: 'contain' },
  title: { fontSize: 34, fontWeight: 'bold', marginTop: 4, color: '#000' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 60 },
  mainButton: { width: 160, height: 160, borderRadius: 80, justifyContent: 'center', alignItems: 'center' },
  mainButtonIcon: { shadowColor: '#000', shadowRadius: 5, shadowOpacity: 0.3, shadowOffset: { width: 0, height: 2 } },
  promptText: { marginTop: 20, fontSize: 17, fontWeight: '600', color: 'gray' },
  guideButton: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#E5E5EA', borderRadius: 20 },
  guideButtonText: { color: '#007AFF', marginLeft: 12, fontSize: 14, fontWeight: '600' },

  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: { backgroundColor: '#FFF', paddingTop: 12, paddingHorizontal: 20, paddingBottom: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20, alignItems: 'center' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D1D1D6', marginBottom: 12 },

  inputSelectorSheet: { backgroundColor: 'rgba(242,242,247,0.95)', paddingTop: 20, paddingBottom: (StatusBar.currentHeight || 0) + 30, paddingHorizontal: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20, alignItems: 'center' },
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

  selectionConfirmation: { alignItems: 'center', padding: 20 },
  selectionText: { fontSize: 22, fontWeight: 'bold', color: '#000', marginBottom: 8 },
  uriText: { fontSize: 12, color: 'gray', marginBottom: 20, paddingHorizontal: 20 },

  // ADDED: Missing clearButton styles
  clearButton: {
    backgroundColor: '#E5E5EA',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  clearButtonText: {
    color: '#007AFF',
    fontWeight: '600',
    fontSize: 16,
  },

  rgContainer: { width: '100%', alignSelf: 'center', paddingHorizontal: 8, paddingBottom: 6 },
  rgHeader: { width: '100%', paddingHorizontal: 4, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rgTitle: { fontSize: 18, fontWeight: '700', color: '#000' },
  rgCaption: { fontSize: 12, color: '#6B7280', textAlign: 'center', marginBottom: 10, textDecorationLine: 'underline' },
  rgDiagram: { width: '100%', height: 180, marginBottom: 10 },
  rgCard: { padding: 18, borderRadius: 20, marginBottom: 10, backgroundColor: '#FFFFFF' },
  // ADDED: Missing rgCardTitle style
  rgCardTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 12, color: '#1F2937' },
  rgRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  rgRowText: { marginLeft: 10, fontSize: 14, color: '#1F2937', lineHeight: 20, flex: 1 },
  rgBold: { fontWeight: '700' },
  rgMono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontWeight: '600' },

  modalPrimaryButton: { marginTop: 8, width: '100%', paddingVertical: 14, borderRadius: 12, backgroundColor: '#007AFF', alignItems: 'center' },
  modalPrimaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});

export default DetectScreen;