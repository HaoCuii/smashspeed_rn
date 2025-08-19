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

type AnalyzeParams = {
  sourceUri: string;
  startSec: number;
  endSec: number;
  metersPerPixel: number;
};

type FrameDetections = { t: number; boxes: Box[] }; // t in ms
type VideoHandle = React.ElementRef<typeof Video>;

// User-editable box stored in VIDEO pixel space
type VBox = { x: number; y: number; width: number; height: number };

type Selected =
  | { type: 'ai'; idx: number }
  | { type: 'user'; idx: number };

export default function AnalyzeScreen({ route }: any) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { sourceUri, startSec, endSec, metersPerPixel } = route.params as AnalyzeParams;

  const [isLoading, setIsLoading] = useState(false);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  const [drawRect, setDrawRect] = useState({ x: 0, y: 0, w: screenW, h: Math.floor(screenH * 0.6) });
  const [frames, setFrames] = useState<FrameDetections[]>([]);

  // Current frame index being shown (of frames[])
  const [currentIndex, setCurrentIndex] = useState(0);
  // Index we intend to show after seek finishes
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  // Per-frame user boxes (VIDEO px): { [frameIndex]: VBox[] }
  const [userBoxesByIndex, setUserBoxesByIndex] = useState<Record<number, VBox[]>>({});
  // Currently selected box (AI or user), or null
  const [selected, setSelected] = useState<Selected | null>(null);

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
    setUserBoxesByIndex({});
    setSelected(null);
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
      setSelected(null); // clear selection when changing frames
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

  // Current frame + mapping
  const current = frames.length ? frames[Math.max(0, Math.min(currentIndex, frames.length - 1))] : null;

  // Detection boxes mapped to VIDEO px space
  const detectedVideoBoxes: VBox[] = useMemo(() => {
    if (!current || !vw || !vh) return [];
    return current.boxes.map(b => mapModelToVideo(b, vw, vh));
  }, [current, vw, vh]);

  // User boxes (VIDEO px) for current frame
  const userVideoBoxes: VBox[] = userBoxesByIndex[currentIndex] || [];

  // VIDEO px -> SCREEN px scale
  const scale = useMemo(() => (!vw || !vh ? 1 : Math.min(drawRect.w / vw, drawRect.h / vh)), [drawRect, vw, vh]);

  const toScreen = (b: VBox) => ({
    left: drawRect.x + b.x * scale,
    top: drawRect.y + b.y * scale,
    width: b.width * scale,
    height: b.height * scale,
  });

  const timeLabel = current ? (current.t / 1000).toFixed(2) + 's' : `${startSec.toFixed(2)}s`;
  const frameReadout = frames.length
    ? `Frame ${currentIndex + 1} / ${frames.length}`
    : isLoading
    ? 'Analyzing...'
    : 'No frames detected';

  const meterReadout = useMemo(() => {
    if (!vw || !vh) return null;
    const widths = [
      ...detectedVideoBoxes.map(m => m.width || 0),
      ...userVideoBoxes.map(m => m.width || 0),
    ];
    const maxWpx = widths.length ? Math.max(...widths) : 0;
    if (maxWpx <= 0) return null;
    const meters = maxWpx * metersPerPixel;
    return meters.toFixed(2) + ' m';
  }, [detectedVideoBoxes, userVideoBoxes, metersPerPixel, vw, vh]);

  const atStart = currentIndex <= 0;
  const atEnd = frames.length ? currentIndex >= frames.length - 1 : true;

  const prevFrame = () => seekToIndex(currentIndex - 1);
  const nextFrame = () => seekToIndex(currentIndex + 1);

  // -------- Manual box helpers --------
  const clampBox = (b: VBox): VBox => {
    if (!vw || !vh) return b;
    const width = Math.max(2, Math.min(b.width, vw));
    const height = Math.max(2, Math.min(b.height, vh));
    const x = Math.max(0, Math.min(b.x, Math.max(0, vw - width)));
    const y = Math.max(0, Math.min(b.y, Math.max(0, vh - height)));
    return { x, y, width, height };
  };

  const updateUserBoxes = (transform: (boxes: VBox[]) => VBox[]) => {
    setUserBoxesByIndex(prev => {
      const oldArr = prev[currentIndex] ?? [];
      const nextArr = transform(oldArr);
      return { ...prev, [currentIndex]: nextArr };
    });
  };

  const addBox = () => {
    if (!vw || !vh) return;
    const w = Math.round(vw * 0.18);
    const h = Math.round(vh * 0.18);
    const nb = clampBox({ x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), width: w, height: h });
    updateUserBoxes(arr => {
      const next = [...arr, nb];
      setSelected({ type: 'user', idx: next.length - 1 });
      return next;
    });
  };

  const deleteSelected = () => {
    if (!selected) return;
    if (selected.type === 'user') {
      updateUserBoxes(arr => arr.filter((_, i) => i !== selected.idx));
    } else if (selected.type === 'ai' && current) {
      // Remove selected AI box from current frame's detections (model-space)
      setFrames(prev => {
        const out = prev.slice();
        const f = out[currentIndex];
        if (!f) return prev;
        const newBoxes = f.boxes.filter((_, i) => i !== selected.idx);
        out[currentIndex] = { ...f, boxes: newBoxes };
        return out;
      });
    }
    setSelected(null);
  };

  // Move/resize only apply to USER boxes
  const step = useMemo(() => {
    if (!vw || !vh) return 4;
    return Math.max(1, Math.round(Math.min(vw, vh) * 0.01)); // ~1% of min dimension
  }, [vw, vh]);

  const nudge = (dx: number, dy: number) => {
    if (!selected || selected.type !== 'user') return;
    updateUserBoxes(arr => {
      const next = arr.slice();
      const b = next[selected.idx];
      if (!b) return arr;
      next[selected.idx] = clampBox({ ...b, x: b.x + dx, y: b.y + dy });
      return next;
    });
  };

  const resize = (dw: number, dh: number) => {
    if (!selected || selected.type !== 'user') return;
    updateUserBoxes(arr => {
      const next = arr.slice();
      const b = next[selected.idx];
      if (!b) return arr;
      next[selected.idx] = clampBox({ ...b, width: b.width + dw, height: b.height + dh });
      return next;
    });
  };

  // Renders
  const DetBox = ({ b, i }: { b: VBox; i: number }) => {
    const isSel = selected?.type === 'ai' && selected.idx === i;
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => setSelected({ type: 'ai', idx: i })}
        style={[styles.box, styles.detBox, toScreen(b), isSel && styles.selBox]}
      />
    );
  };

  const UserBox = ({ b, i }: { b: VBox; i: number }) => {
    const isSel = selected?.type === 'user' && selected.idx === i;
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => setSelected({ type: 'user', idx: i })}
        style={[styles.box, styles.userBox, toScreen(b), isSel && styles.selBox]}
      />
    );
  };

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

        {/* Model detections (AI, red) */}
        {detectedVideoBoxes.map((b, i) => (
          <DetBox key={`d-${i}`} b={b} i={i} />
        ))}

        {/* User boxes (cyan) */}
        {(userBoxesByIndex[currentIndex] || []).map((b, i) => (
          <UserBox key={`u-${i}`} b={b} i={i} />
        ))}
      </View>

      {/* Frame navigation */}
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

      {/* Manual edit bar */}
      <View style={styles.editBar}>
        <TouchableOpacity onPress={addBox} style={styles.smallBtn}>
          <Text style={styles.smallBtnTxt}>＋ Add Box</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={deleteSelected}
          disabled={!selected}
          style={[styles.smallBtn, !selected && styles.btnDisabled]}
        >
          <Text style={styles.smallBtnTxt}>⨉ Delete</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        {/* Move/resize controls (enabled only for user boxes) */}
        <View style={styles.inlineRow}>
          <TouchableOpacity
            onPress={() => nudge(0, -step)}
            disabled={selected?.type !== 'user'}
            style={[styles.stepBtn, selected?.type !== 'user' && styles.btnDisabled]}
          >
            <Text style={styles.stepTxt}>↑</Text>
          </TouchableOpacity>
          <View style={styles.row}>
            <TouchableOpacity
              onPress={() => nudge(-step, 0)}
              disabled={selected?.type !== 'user'}
              style={[styles.stepBtn, selected?.type !== 'user' && styles.btnDisabled]}
            >
              <Text style={styles.stepTxt}>←</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => nudge(step, 0)}
              disabled={selected?.type !== 'user'}
              style={[styles.stepBtn, selected?.type !== 'user' && styles.btnDisabled]}
            >
              <Text style={styles.stepTxt}>→</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => nudge(0, step)}
            disabled={selected?.type !== 'user'}
            style={[styles.stepBtn, selected?.type !== 'user' && styles.btnDisabled]}
          >
            <Text style={styles.stepTxt}>↓</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <TouchableOpacity
            onPress={() => resize(-step, 0)}
            disabled={selected?.type !== 'user'}
            style={[styles.smallBtn, selected?.type !== 'user' && styles.btnDisabled]}
          >
            <Text style={styles.smallBtnTxt}>W−</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => resize(step, 0)}
            disabled={selected?.type !== 'user'}
            style={[styles.smallBtn, selected?.type !== 'user' && styles.btnDisabled]}
          >
            <Text style={styles.smallBtnTxt}>W＋</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => resize(0, -step)}
            disabled={selected?.type !== 'user'}
            style={[styles.smallBtn, selected?.type !== 'user' && styles.btnDisabled]}
          >
            <Text style={styles.smallBtnTxt}>H−</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => resize(0, step)}
            disabled={selected?.type !== 'user'}
            style={[styles.smallBtn, selected?.type !== 'user' && styles.btnDisabled]}
          >
            <Text style={styles.smallBtnTxt}>H＋</Text>
          </TouchableOpacity>
        </View>

        {selected?.type === 'ai' && (
          <Text style={styles.roHint}>AI box selected (move/resize disabled)</Text>
        )}
        {selected?.type === 'user' && (
          <Text style={styles.roHint}>Step: {step}px (video space)</Text>
        )}
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

  // Boxes
  box: {
    position: 'absolute',
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  detBox: { borderColor: '#FF3B30' },     // red (AI detections)
  userBox: { borderColor: '#0fd1ff' },    // cyan (user)
  selBox: { borderColor: '#FFD60A', borderWidth: 3 }, // yellow highlight

  // Frame controls
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

  // Manual edit bar
  editBar: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
    backgroundColor: '#0A0A0A',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1C1C1E',
    borderRadius: 10,
    alignItems: 'center',
    marginRight: 8,
    marginBottom: 6,
  },
  smallBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 12 },
  selLabel: { color: '#bbb', fontSize: 12, marginLeft: 6 },
  divider: { width: 1, height: 22, backgroundColor: '#222', marginHorizontal: 8 },
  roHint: { color: '#888', fontSize: 12, marginLeft: 6, marginBottom: 6 },

  row: { flexDirection: 'row', alignItems: 'center' },
  inlineRow: { flexDirection: 'column', alignItems: 'center', marginRight: 8 },

  stepBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#1C1C1E',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 2,
    minWidth: 40,
  },
  stepTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },

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
