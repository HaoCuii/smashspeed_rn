// src/screens/DetectScreen.tsx

import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  Image,
  ImageBackground,
  Platform,
  StatusBar,
  Modal,
  ScrollView,
} from 'react-native';
import AppIcon from '../components/AppIcon';
import GlassPanel from '../components/GlassPanel';

const DetectScreen: React.FC = () => {
  const [showInputSelector, setShowInputSelector] = useState(false);
  const [showRecordingGuide, setShowRecordingGuide] = useState(false);

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
          <TouchableOpacity onPress={() => setShowInputSelector(true)}>
            <GlassPanel style={styles.mainButton}>
              <AppIcon
                name="arrow.up.circle.fill"
                fallbackName="arrow-up"
                size={70}
                color="rgba(255,255,255,0.8)"
                style={styles.mainButtonIcon}
              />
            </GlassPanel>
          </TouchableOpacity>
          <Text style={styles.promptText}>Select a video to begin</Text>
          <TouchableOpacity
            style={styles.guideButton}
            onPress={() => setShowRecordingGuide(true)}
          >
            <AppIcon name="questionmark.circle" fallbackName="help-circle" size={16} color="#007AFF" />
            <Text style={styles.guideButtonText}>How to Record</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* HOW TO RECORD MODAL */}
      <Modal
        visible={showRecordingGuide}
        animationType="slide"
        transparent
        onRequestClose={() => setShowRecordingGuide(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowRecordingGuide(false)}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>How to Record a Great Smash Video</Text>
            <ScrollView
              style={{ maxHeight: 420, width: '100%' }}
              contentContainerStyle={{ paddingBottom: 10 }}
              showsVerticalScrollIndicator={false}
            >
              <GuideRow
                icon="video"
                label="Use landscape"
                detail="Hold your phone horizontally so the racket and ball stay in frame."
              />
              <GuideRow
                icon="focus"
                label="Keep the subject centered"
                detail="Stand ~3–5m away; make sure the full swing is visible without clipping."
              />
              <GuideRow
                icon="sun.max"
                label="Good lighting"
                detail="Shoot in bright, even light. Avoid strong backlight that causes silhouettes."
              />
              <GuideRow
                icon="camera.aperture"
                label="Higher FPS if possible"
                detail="60 fps (or higher) gives sharper frame-by-frame analysis."
              />
              <GuideRow
                icon="figure.tennis"
                label="Record 2–3 attempts"
                detail="Capture a few smashes so the best one can be selected."
              />
              <PlatformHint />
            </ScrollView>

            <TouchableOpacity
              style={styles.modalPrimaryButton}
              onPress={() => setShowRecordingGuide(false)}
            >
              <Text style={styles.modalPrimaryButtonText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ImageBackground>
  );
};

/** Small inline helpers to keep JSX tidy */
const GuideRow = ({
  icon,
  label,
  detail,
}: {
  icon: string;
  label: string;
  detail: string;
}) => (
  <View style={styles.row}>
    <AppIcon name={icon} fallbackName="check-circle" size={18} color="#007AFF" />
    <View style={{ marginLeft: 12, flex: 1 }}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowDetail}>{detail}</Text>
    </View>
  </View>
);

const PlatformHint = () => {
  const isIOS = Platform.OS === 'ios';
  return (
    <View style={[styles.platformCard, isIOS ? styles.platformCardIOS : styles.platformCardAndroid]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <AppIcon
          name={isIOS ? 'camera' : 'camera'}
          fallbackName="camera"
          size={16}
          color={isIOS ? '#0A84FF' : '#34A853'}
        />
        <Text style={[styles.platformTitle, { marginLeft: 8 }]}>
          {isIOS ? 'iOS tips' : 'Android tips'}
        </Text>
      </View>
      <Text style={styles.platformBody}>
        {isIOS
          ? 'In Camera, set Format → 1080p at 60 fps for smoother playback.'
          : 'In Camera, choose 1080p/60 fps in Settings if available for smoother playback.'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 25,
    marginTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 10 : 10,
  },
  headerLeft: {
    alignItems: 'flex-start',
  },
  headerImage: {
    width: 150,
    height: 35,
    resizeMode: 'contain',
  },
  title: {
    fontSize: 34,
    fontWeight: 'bold',
    marginTop: 4,
    color: '#000',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
  },
  mainButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainButtonIcon: {
    shadowColor: '#000',
    shadowRadius: 5,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 2 },
  },
  promptText: {
    marginTop: 20,
    fontSize: 17,
    fontWeight: '600',
    color: 'gray',
  },
  guideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#E5E5EA',
    borderRadius: 20,
  },
  guideButtonText: {
    color: '#007AFF',
    marginLeft: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  /* Modal styles */
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalSheet: {
    backgroundColor: '#FFF',
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    alignItems: 'center',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D1D6',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
    marginBottom: 2,
  },
  rowDetail: {
    fontSize: 14,
    color: '#3A3A3C',
    lineHeight: 19,
  },
  modalPrimaryButton: {
    marginTop: 8,
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  modalPrimaryButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  platformCard: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
  },
  platformCardIOS: {
    backgroundColor: '#E7F0FF',
  },
  platformCardAndroid: {
    backgroundColor: '#E9F6EC',
  },
  platformTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
    marginBottom: 6,
  },
  platformBody: {
    fontSize: 13,
    color: '#333',
    marginTop: 6,
    lineHeight: 18,
  },
});

export default DetectScreen;
