// src/screens/AnalyzeScreen.tsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Video, { OnLoadData } from 'react-native-video';
import { runDetection, mapModelToVideo, Box } from '../ml/yolo';

type AnalyzeParams = {
  sourceUri: string;
  startSec: number;
  endSec: number;
  metersPerPixel: number;
};

type FrameDetections = { t: number; boxes: Box[] }; // t in ms

export default function AnalyzeScreen({ route }: any) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { sourceUri, startSec, endSec, metersPerPixel } = route.params as AnalyzeParams;

  // Video natural size
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);

  // Drawn rect for contain layout
  const [drawRect, setDrawRect] = useState({ x: 0, y: 0, w: screenW, h: Math.floor(screenH * 0.6) });

  // Detections + selection
  const [frames, setFrames] = useState<FrameDetections[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Allow bumping FPS if you only got 1 frame
  const [fps, setFps] = useState(10);

  // Video ref (type-safe)
  type VideoHandle = React.ElementRef<typeof Video>;
  const videoRef = useRef<VideoHandle | null>(null);

  // Layout recompute
  useEffect(() => {
    if (!vw || !vh) return;
    const maxW = screenW;
    const maxH = Math.floor(screenH * 0.6);
    const scale = Math.min(maxW / vw, maxH / vh);
    const w = vw * scale;
    const h = vh * scale;
    setDrawRect({ x: (screenW - w) / 2, y: 0, w, h });
  }, [vw, vh, screenW, screenH]);

  // Run inference once (or when fps changes), then filter to trimmed window
  const loadDetections = useCallback(async () => {
    try {
      const all = await runDetection(sourceUri, fps);
      const startMs = startSec * 1000;
      const endMs = endSec * 1000;
      const inRange = all.filter(f => f.t >= startMs && f.t <= endMs).sort((a, b) => a.t - b.t);
      setFrames(inRange);
      setCurrentIndex(0);
    } catch (e) {
      console.warn('Detection error', e);
      setFrames([]);
      setCurrentIndex(0);
    }
  }, [sourceUri, startSec, endSec, fps]);

  useEffect(() => { loadDetections(); }, [loadDetections]);

  // Seek when selected frame changes
  useEffect(() => {
    if (!frames.length) return;
    const tSec = frames[Math.max(0, Math.min(currentIndex, frames.length - 1))].t / 1000;
    videoRef.current?.seek(tSec);
  }, [currentIndex, frames]);

  const current = frames.length ? frames[Math.max(0, Math.min(currentIndex, frames.length - 1))] : null;

  // Map MODEL boxes → video pixels → screen rect
  const screenBoxes = useMemo(() => {
    if (!current || !vw || !vh) return [];
    const mapped = current.boxes.map(b => mapModelToVideo(b, vw, vh));
    const scale = Math.min(drawRect.w / vw, drawRect.h / vh);
    return mapped.map(m => ({
      left: drawRect.x + m.x * scale,
      top:  drawRect.y + m.y * scale,
      width: m.width * scale,
      height: m.height * scale,
      conf: m.confidence,
    }));
  }, [current, vw, vh, drawRect]);

  // Simple metric (largest width)
  const meterReadout = useMemo(() => {
    if (!current || !vw || !vh) return null;
    const mapped = current.boxes.map(b => mapModelToVideo(b, vw, vh));
    const maxWpx = Math.max(0, ...mapped.map(m => m.width || 0));
    const meters = maxWpx * metersPerPixel;
    return meters.toFixed(2) + ' m';
  }, [current, metersPerPixel, vw, vh]);

  const onLoad = (meta: OnLoadData) => {
    setVw(meta.naturalSize.width || 0);
    setVh(meta.naturalSize.height || 0);
    const initial = frames.length ? frames[0].t / 1000 : startSec;
    videoRef.current?.seek(initial);
  };

  // --- Controls ---
  const atStart = currentIndex <= 0;
  const atEnd = frames.length ? currentIndex >= frames.length - 1 : true;

  const prevFrame = () => {
    if (!frames.length) return;
    setCurrentIndex(i => Math.max(0, i - 1));
  };
  const nextFrame = () => {
    if (!frames.length) return;
    setCurrentIndex(i => Math.min(frames.length - 1, i + 1));
  };

  const bumpFps = (delta: number) => {
    setFps(f => Math.max(1, Math.min(60, f + delta)));
  };

  const timeLabel = current ? (current.t / 1000).toFixed(2) + 's' : `${startSec.toFixed(2)}s`;

  return (
    <SafeAreaView style={styles.root}>
      <View style={[styles.videoWrap, { height: drawRect.h }]}>
        <Video
          ref={videoRef}
          source={{ uri: sourceUri }}
          style={[styles.video, { width: drawRect.w, height: drawRect.h, left: drawRect.x }]}
          resizeMode="contain"
          paused={true} // no autoplay
          onLoad={onLoad}
          controls={false}
        />
        {/* Red overlays */}
        {screenBoxes.map((b, i) => (
          <View
            key={i}
            pointerEvents="none"
            style={[styles.box, { left: b.left, top: b.top, width: b.width, height: b.height }]}
          />
        ))}
      </View>

      {/* Controls row */}
      <View style={styles.controls}>
        <TouchableOpacity
          onPress={prevFrame}
          disabled={atStart || !frames.length}
          style={[styles.arrowBtn, (atStart || !frames.length) && styles.btnDisabled]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.arrowTxt}>◀︎ Prev</Text>
        </TouchableOpacity>

        <View style={styles.readout}>
          <Text style={styles.readoutTxt}>
            {frames.length ? `Frame ${currentIndex + 1} / ${frames.length}` : 'No frames (try higher FPS)'}
          </Text>
          <Text style={styles.readoutTxt}>{timeLabel}</Text>
          {meterReadout && <Text style={styles.readoutSub}>Largest box ≈ {meterReadout}</Text>}
        </View>

        <TouchableOpacity
          onPress={nextFrame}
          disabled={atEnd || !frames.length}
          style={[styles.arrowBtn, (atEnd || !frames.length) && styles.btnDisabled]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.arrowTxt}>Next ▶︎</Text>
        </TouchableOpacity>
      </View>

      {/* FPS row */}
      <View style={styles.fpsRow}>
        <Text style={styles.fpsLabel}>FPS:</Text>
        <TouchableOpacity onPress={() => bumpFps(-2)} style={styles.fpsBtn}><Text style={styles.fpsTxt}>-</Text></TouchableOpacity>
        <Text style={styles.fpsValue}>{fps}</Text>
        <TouchableOpacity onPress={() => bumpFps(+2)} style={styles.fpsBtn}><Text style={styles.fpsTxt}>+</Text></TouchableOpacity>

        <TouchableOpacity onPress={loadDetections} style={[styles.fpsBtn, { marginLeft: 12 }]}>
          <Text style={styles.fpsTxt}>Re-run</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerTxt}>
          Trim: {startSec.toFixed(2)}s → {endSec.toFixed(2)}s • Scale: {metersPerPixel.toExponential(3)} m/px
        </Text>
      </View>
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

  // Red square boxes
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FF3B30',
    backgroundColor: 'transparent',
  },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
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

  fpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
  },
  fpsLabel: { color: '#fff', fontSize: 14 },
  fpsValue: { color: '#fff', fontSize: 14, width: 28, textAlign: 'center' },
  fpsBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#1C1C1E',
    borderRadius: 8,
  },
  fpsTxt: { color: '#fff', fontWeight: '700' },

  footer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
  },
  footerTxt: { color: '#bbb', fontSize: 12, textAlign: 'center' },
});
