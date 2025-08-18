import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  DeviceEventEmitter,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Video, { OnLoadData } from 'react-native-video';
import { runDetection, mapModelToVideo, Box } from '../ml/yolo';

/**
 * Full implementation that fixes the one-frame offset by:
 *  - Seeking first, then committing overlay in onSeek() ("pendingIndex" strategy)
 *  - Biasing seek target earlier by ~1/2 frame to reduce keyframe snap issues
 *  - Avoiding seek-on-currentIndex-change (which caused the overlay to lead the picture)
 */

type AnalyzeParams = {
  sourceUri: string;
  startSec: number;
  endSec: number;
  metersPerPixel: number;
};

type FrameDetections = { t: number; boxes: Box[] }; // t in ms

type VideoHandle = React.ElementRef<typeof Video>;

export default function AnalyzeScreen({ route }: any) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { sourceUri, startSec, endSec, metersPerPixel } = route.params as AnalyzeParams;

  const [isLoading, setIsLoading] = useState(false);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  const [drawRect, setDrawRect] = useState({ x: 0, y: 0, w: screenW, h: Math.floor(screenH * 0.6) });
  const [frames, setFrames] = useState<FrameDetections[]>([]);

  // The index whose boxes are currently drawn
  const [currentIndex, setCurrentIndex] = useState(0);
  // The index we intend to show after seek completes
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  const videoRef = useRef<VideoHandle | null>(null);
  const videoLoaded = useRef(false);
  const didAutoSeek = useRef(false);

  // Layout the contained video area
  useEffect(() => {
    if (!vw || !vh) return;
    const maxW = screenW;
    const maxH = Math.floor(screenH * 0.6);
    const scale = Math.min(maxW / vw, maxH / vh);
    const w = vw * scale;
    const h = vh * scale;
    setDrawRect({ x: (screenW - w) / 2, y: 0, w, h });
  }, [vw, vh, screenW, screenH]);

  const loadDetections = useCallback(async () => {
    setIsLoading(true);
    setFrames([]);
    setCurrentIndex(0);
    setPendingIndex(null);
    didAutoSeek.current = false;
    try {
      // Pass 0 for FPS to tell the native module to use the video's actual FPS
      await runDetection(sourceUri, 0, startSec, endSec);
    } catch (e) {
      console.warn('Detection error', e);
      setFrames([]);
    } finally {
      setIsLoading(false);
    }
  }, [sourceUri, startSec, endSec]);

  // Subscribe to native detection events
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('onFrameDetected', (frame: FrameDetections) => {
      setFrames(prev => [...prev, frame].sort((a, b) => a.t - b.t));
    });
    loadDetections();
    return () => subscription.remove();
  }, [loadDetections]);

  // Estimate FPS from detection timestamps (median of deltas)
  const approxFps = useMemo(() => {
    if (frames.length < 2) return 30; // fallback
    const deltas = frames.slice(1).map((f, i) => Math.max(1, f.t - frames[i].t)).sort((a, b) => a - b);
    const median = deltas[Math.floor(deltas.length / 2)] || 33.33;
    const fps = 1000 / median;
    return isFinite(fps) && fps > 1 ? fps : 30;
  }, [frames]);

  // Seek helper that biases slightly earlier to avoid landing on a previous keyframe
  const seekToIndex = useCallback(
    (idx: number) => {
      if (!frames.length) return;
      const clamped = Math.max(0, Math.min(idx, frames.length - 1));
      const halfFrame = 1 / (approxFps * 2);
      const tSec = Math.max(0, frames[clamped].t / 1000 - halfFrame);
      setPendingIndex(clamped);
      videoRef.current?.seek(tSec);
    },
    [frames, approxFps]
  );

  // Commit the overlay only once the player has actually finished seeking
  const onSeek = () => {
    if (pendingIndex != null) {
      setCurrentIndex(pendingIndex);
      setPendingIndex(null);
    }
  };

  // When the video loads: set natural size and show either the trim start or first detection
  const onLoad = (meta: OnLoadData) => {
    setVw(meta.naturalSize.width || 0);
    setVh(meta.naturalSize.height || 0);
    videoLoaded.current = true;

    if (frames.length) {
      // Jump to first detection; commit overlay in onSeek
      seekToIndex(0);
    } else {
      // No detections yet—park the video at trim start for visual context
      videoRef.current?.seek(Math.max(0, startSec));
    }
  };

  // If detections arrive after the video is ready, auto-seek once to the first detection
  useEffect(() => {
    if (videoLoaded.current && frames.length && !didAutoSeek.current) {
      didAutoSeek.current = true;
      seekToIndex(0);
    }
  }, [frames, seekToIndex]);

  // Compute current frame + overlays
  const current = frames.length ? frames[Math.max(0, Math.min(currentIndex, frames.length - 1))] : null;

  const screenBoxes = useMemo(() => {
    if (!current || !vw || !vh) return [] as { left: number; top: number; width: number; height: number }[];
    const mapped = current.boxes.map(b => mapModelToVideo(b, vw, vh));
    const scale = Math.min(drawRect.w / vw, drawRect.h / vh);
    return mapped.map(m => ({
      left: drawRect.x + m.x * scale,
      top: drawRect.y + m.y * scale,
      width: m.width * scale,
      height: m.height * scale,
    }));
  }, [current, vw, vh, drawRect]);

  const meterReadout = useMemo(() => {
    if (!current || !vw || !vh) return null;
    const mapped = current.boxes.map(b => mapModelToVideo(b, vw, vh));
    const maxWpx = Math.max(0, ...mapped.map(m => m.width || 0));
    const meters = maxWpx * metersPerPixel;
    return meters.toFixed(2) + ' m';
  }, [current, metersPerPixel, vw, vh]);

  const atStart = currentIndex <= 0;
  const atEnd = frames.length ? currentIndex >= frames.length - 1 : true;

  const prevFrame = () => seekToIndex(currentIndex - 1);
  const nextFrame = () => seekToIndex(currentIndex + 1);

  const timeLabel = current ? (current.t / 1000).toFixed(2) + 's' : `${startSec.toFixed(2)}s`;
  const frameReadout = frames.length
    ? `Frame ${currentIndex + 1} / ${frames.length}`
    : isLoading
    ? 'Analyzing...'
    : 'No frames detected';

  return (
    <SafeAreaView style={styles.root}>
      <View style={[styles.videoWrap, { height: drawRect.h }]}>
        <Video
          ref={videoRef}
          source={{ uri: sourceUri }}
          style={[styles.video, { width: drawRect.w, height: drawRect.h, left: drawRect.x }]}
          resizeMode="contain"
          paused={true}
          onLoad={onLoad}
          onSeek={onSeek}
          controls={false}
        />
        {screenBoxes.map((b, i) => (
          <View key={i} pointerEvents="none" style={[styles.box, { left: b.left, top: b.top, width: b.width, height: b.height }]} />
        ))}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          onPress={prevFrame}
          disabled={atStart || isLoading}
          style={[styles.arrowBtn, (atStart || isLoading) && styles.btnDisabled]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.arrowTxt}>◀︎ Prev</Text>
        </TouchableOpacity>

        <View style={styles.readout}>
          <Text style={styles.readoutTxt}>{frameReadout}</Text>
          <Text style={styles.readoutTxt}>{timeLabel}</Text>
          {meterReadout && <Text style={styles.readoutSub}>Largest box ≈ {meterReadout}</Text>}
        </View>

        <TouchableOpacity
          onPress={nextFrame}
          disabled={atEnd || isLoading}
          style={[styles.arrowBtn, (atEnd || isLoading) && styles.btnDisabled]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.arrowTxt}>Next ▶︎</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerTxt}>
          Trim: {startSec.toFixed(2)}s → {endSec.toFixed(2)}s • Scale: {metersPerPixel.toExponential(3)} m/px
        </Text>
      </View>

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.loadingText}>Processing Video...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  videoWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  video: { position: 'absolute', top: 0 },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FF3B30',
    backgroundColor: 'transparent',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
  },
  arrowBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#1C1C1E',
    borderRadius: 10,
  },
  arrowTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.4 },
  readout: { alignItems: 'center', justifyContent: 'center' },
  readoutTxt: { color: '#fff', fontSize: 14, fontWeight: '600' },
  readoutSub: { color: '#ccc', fontSize: 12, marginTop: 2 },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
    marginTop: 'auto',
  },
  footerTxt: { color: '#bbb', fontSize: 12, textAlign: 'center' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    marginTop: 10,
    fontSize: 16,
  },
});
