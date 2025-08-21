// src/screens/AnalyzeScreen.tsx
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
import { pxPerSecToKph } from '../ml/kalman';
import LinearGradient from 'react-native-linear-gradient';

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

export default function AnalyzeScreen({ route, navigation }: any) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { sourceUri, startSec, endSec, metersPerPixel } = route.params as AnalyzeParams;

  const [isLoading, setIsLoading] = useState(false);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  const [drawRect, setDrawRect] = useState({ x: 0, y: 0, w: screenW, h: Math.floor(screenH * 0.5) });
  const [frames, setFrames] = useState<FrameDetections[]>([]);

  // Current frame index being shown
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  // Manual boxes per-frame (video px)
  const [userBoxesByIndex, setUserBoxesByIndex] = useState<Record<number, VBox[]>>({});
  const [selected, setSelected] = useState<Selected | null>(null);

  const videoRef = useRef<VideoHandle | null>(null);
  const videoLoaded = useRef(false);
  const didAutoSeek = useRef(false);

  // Layout the contained video area
  useEffect(() => {
    if (!vw || !vh) return;
    const maxW = screenW;
    const maxH = Math.floor(screenH * 0.5);
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
      await runDetection(sourceUri, 0, startSec, endSec); // 0 => native uses actual fps
    } catch (e) {
      console.warn('Detection error', e);
      setFrames([]);
    } finally {
      setIsLoading(false);
    }
  }, [sourceUri, startSec, endSec]);

  // Subscribe to native detection events
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('onFrameDetected', (frame: FrameDetections) => {
      setFrames(prev => [...prev, frame].sort((a, b) => a.t - b.t));
    });
    loadDetections();
    return () => sub.remove();
  }, [loadDetections]);

  // FPS estimate (used for seeking bias only)
  const approxFps = useMemo(() => {
    if (frames.length < 2) return 30;
    const deltas = frames.slice(1).map((f, i) => Math.max(1, f.t - frames[i].t)).sort((a, b) => a - b);
    const median = deltas[Math.floor(deltas.length / 2)] || 33.33;
    const fps = 1000 / median;
    return isFinite(fps) && fps > 1 ? fps : 30;
  }, [frames]);

  // Seek helper with half-frame bias
  const seekToIndex = useCallback(
    (idx: number) => {
      if (!frames.length) return;
      const clamped = Math.max(0, Math.min(idx, frames.length - 1));
      const halfFrame = 1 / (approxFps * 2);
      const tSec = Math.max(0, frames[clamped].t / 1000 - halfFrame);
      setPendingIndex(clamped);
      setSelected(null);
      videoRef.current?.seek(tSec);
    },
    [frames, approxFps]
  );

  const onSeek = () => {
    if (pendingIndex != null) {
      setCurrentIndex(pendingIndex);
      setPendingIndex(null);
    }
  };

  const onLoad = (meta: OnLoadData) => {
    setVw(meta.naturalSize.width || 0);
    setVh(meta.naturalSize.height || 0);
    videoLoaded.current = true;

    if (frames.length) {
      seekToIndex(0);
    } else {
      videoRef.current?.seek(Math.max(0, startSec));
    }
  };

  useEffect(() => {
    if (videoLoaded.current && frames.length && !didAutoSeek.current) {
      didAutoSeek.current = true;
      seekToIndex(0);
    }
  }, [frames, seekToIndex]);

  // Current frame object
  const current = frames.length ? frames[Math.max(0, Math.min(currentIndex, frames.length - 1))] : null;

  // AI detections (VIDEO px) for current frame — TOP-1 by confidence
  const detectedVideoBoxes = useMemo(() => {
    if (!current || !vw || !vh) return [];
    const mapped = current.boxes.map(b => {
      const m = mapModelToVideo(b, vw, vh);
      return { x: m.x, y: m.y, width: m.width, height: m.height, confidence: (b as any).confidence ?? 0 };
    });
    mapped.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    return mapped.slice(0, 1); // only highest confidence box
  }, [current, vw, vh]);

  // User boxes for current frame
  const userVideoBoxes: VBox[] = userBoxesByIndex[currentIndex] || [];

  // VIDEO px -> SCREEN px scale
  const scale = useMemo(() => (!vw || !vh) ? 1 : Math.min(drawRect.w / vw, drawRect.h / vh), [drawRect, vw, vh]);

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

  // ---------- Centers per frame (user > top-1 AI) ----------
  type Center = { x: number; y: number; tSec: number } | null;

  const centers: Center[] = useMemo(() => {
    if (!vw || !vh || frames.length === 0) return [];
    return frames.map((f, i) => {
      const ub = (userBoxesByIndex[i] || [])[0];
      if (ub) return { x: ub.x + ub.width / 2, y: ub.y + ub.height / 2, tSec: f.t / 1000 };

      if (!f.boxes.length) return null;
      const top = [...f.boxes]
        .map(b => {
          const m = mapModelToVideo(b, vw, vh);
          return { cx: m.x + m.width / 2, cy: m.y + m.height / 2, conf: (b as any).confidence ?? 0 };
        })
        .sort((a, b) => (b.conf ?? 0) - (a.conf ?? 0))[0];
      return top ? { x: top.cx, y: top.cy, tSec: f.t / 1000 } : null;
    });
  }, [frames, vw, vh, userBoxesByIndex, mapModelToVideo]);

  // ---------- Robust per-frame speed from deltas ----------
  const speedsKph: (number | null)[] = useMemo(() => {
    const out: (number | null)[] = new Array(centers.length).fill(null);
    if (centers.length < 2) return out;

    const MIN_DT = 1 / 240; // avoid infinitesimal dt
    const MAX_DT = 0.5;     // ignore huge gaps

    let lastIdx: number | null = null;

    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      if (!c) continue;

      if (lastIdx == null) {
        lastIdx = i;
        continue;
      }

      const p = centers[lastIdx];
      if (!p) { lastIdx = i; continue; }

      let dt = c.tSec - p.tSec;
      dt = Math.max(MIN_DT, Math.min(dt, MAX_DT));
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      const pxPerSec = Math.hypot(dx, dy) / dt;
      const kph = pxPerSecToKph(pxPerSec, metersPerPixel);

      out[i] = Number.isFinite(kph) ? kph : null;
      lastIdx = i;
    }
    return out;
  }, [centers, metersPerPixel]);

  const currentSpeedKph = useMemo(() => {
    if (!speedsKph.length) return null;
    for (let i = currentIndex; i >= 0; i--) {
      const v = speedsKph[i];
      if (Number.isFinite(v as number)) return v as number;
    }
    return null;
  }, [speedsKph, currentIndex]);

  const speedLabel = currentSpeedKph != null ? `${currentSpeedKph.toFixed(1)} km/h` : '—';

  // Max speed across run and trajectory angle calculation
  const maxSpeedData = useMemo(() => {
    let best = { maxKph: -Infinity, atIndex: -1 };
    for (let i = 0; i < speedsKph.length; i++) {
      const v = speedsKph[i];
      if (Number.isFinite(v as number) && (v as number) > best.maxKph) {
        best = { maxKph: v as number, atIndex: i };
      }
    }
    
    // Calculate angle at max speed frame
    let angle = 0;
    if (best.atIndex >= 0 && best.atIndex < centers.length - 1) {
      const current = centers[best.atIndex];
      const next = centers[best.atIndex + 1];
      if (current && next) {
        const dx = next.x - current.x;
        const dy = next.y - current.y;
        angle = Math.atan2(dy, dx) * (180 / Math.PI);
        // Normalize to 0-360 degrees
        if (angle < 0) angle += 360;
      }
    }
    
    return best.maxKph === -Infinity ? null : { ...best, angle };
  }, [speedsKph, centers]);

  const finish = () => {
    if (!maxSpeedData) {
      navigation.navigate('SpeedResult', {
        maxKph: 0,
        angle: 0,
        videoUri: sourceUri,
        startSec,
        endSec,
      });
      return;
    }
    
    navigation.navigate('SpeedResult', {
      maxKph: maxSpeedData.maxKph,
      angle: maxSpeedData.angle,
      videoUri: sourceUri,
      startSec,
      endSec,
    });
  };

  // ---------- Manual box helpers ----------
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

  // Render helpers
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

  const atStart = currentIndex <= 0;
  const atEnd = frames.length ? currentIndex >= frames.length - 1 : true;

  const prevFrame = () => seekToIndex(currentIndex - 1);
  const nextFrame = () => seekToIndex(currentIndex + 1);

  // For meters readout: consider both AI and user
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

  return (
    <View style={styles.container}>
      {/* Background Gradient */}
      <LinearGradient
        colors={['rgba(0, 122, 255, 0.1)', 'rgba(0, 122, 255, 0.05)', 'transparent']}
        style={styles.backgroundGradient}
      />

      <SafeAreaView style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Analyze Video</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Video Section */}
        <View style={styles.glassPanel}>
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
              style={[styles.controlButton, (atStart || isLoading) && styles.buttonDisabled]}
            >
              <Text style={styles.controlButtonText}>◀︎ Prev</Text>
            </TouchableOpacity>

            <View style={styles.readout}>
              <Text style={styles.readoutText}>{frameReadout}</Text>
              <Text style={styles.readoutSubtext}>{timeLabel}</Text>
              {meterReadout && <Text style={styles.readoutSubtext}>Box ≈ {meterReadout}</Text>}
              <Text style={styles.readoutSubtext}>Speed: {speedLabel}</Text>
            </View>

            <TouchableOpacity
              onPress={nextFrame}
              disabled={atEnd || isLoading}
              style={[styles.controlButton, (atEnd || isLoading) && styles.buttonDisabled]}
            >
              <Text style={styles.controlButtonText}>Next ▶︎</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Manual edit controls */}
        <View style={styles.glassPanel}>
          <Text style={styles.sectionTitle}>Manual Adjustments</Text>
          
          <View style={styles.editRow}>
            <TouchableOpacity onPress={addBox} style={styles.editButton}>
              <Text style={styles.editButtonText}>＋ Add Box</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={deleteSelected}
              disabled={!selected}
              style={[styles.editButton, styles.deleteButton, !selected && styles.buttonDisabled]}
            >
              <Text style={styles.editButtonText}>⨉ Delete</Text>
            </TouchableOpacity>
          </View>

          {/* Move controls */}
          <View style={styles.moveControls}>
            <View style={styles.moveColumn}>
              <TouchableOpacity
                onPress={() => nudge(0, -step)}
                disabled={selected?.type !== 'user'}
                style={[styles.moveButton, selected?.type !== 'user' && styles.buttonDisabled]}
              >
                <Text style={styles.moveButtonText}>↑</Text>
              </TouchableOpacity>
              <View style={styles.moveRow}>
                <TouchableOpacity
                  onPress={() => nudge(-step, 0)}
                  disabled={selected?.type !== 'user'}
                  style={[styles.moveButton, selected?.type !== 'user' && styles.buttonDisabled]}
                >
                  <Text style={styles.moveButtonText}>←</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => nudge(step, 0)}
                  disabled={selected?.type !== 'user'}
                  style={[styles.moveButton, selected?.type !== 'user' && styles.buttonDisabled]}
                >
                  <Text style={styles.moveButtonText}>→</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                onPress={() => nudge(0, step)}
                disabled={selected?.type !== 'user'}
                style={[styles.moveButton, selected?.type !== 'user' && styles.buttonDisabled]}
              >
                <Text style={styles.moveButtonText}>↓</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.resizeControls}>
              <View style={styles.resizeRow}>
                <TouchableOpacity
                  onPress={() => resize(-step, 0)}
                  disabled={selected?.type !== 'user'}
                  style={[styles.resizeButton, selected?.type !== 'user' && styles.buttonDisabled]}
                >
                  <Text style={styles.resizeButtonText}>W−</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => resize(step, 0)}
                  disabled={selected?.type !== 'user'}
                  style={[styles.resizeButton, selected?.type !== 'user' && styles.buttonDisabled]}
                >
                  <Text style={styles.resizeButtonText}>W＋</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.resizeRow}>
                <TouchableOpacity
                  onPress={() => resize(0, -step)}
                  disabled={selected?.type !== 'user'}
                  style={[styles.resizeButton, selected?.type !== 'user' && styles.buttonDisabled]}
                >
                  <Text style={styles.resizeButtonText}>H−</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => resize(0, step)}
                  disabled={selected?.type !== 'user'}
                  style={[styles.resizeButton, selected?.type !== 'user' && styles.buttonDisabled]}
                >
                  <Text style={styles.resizeButtonText}>H＋</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {selected?.type === 'ai' && (
            <Text style={styles.hint}>AI box selected (move/resize disabled)</Text>
          )}
          {selected?.type === 'user' && (
            <Text style={styles.hint}>Step: {step}px (video space)</Text>
          )}
        </View>

        {/* Finish Button */}
        <TouchableOpacity onPress={finish} style={styles.finishButton}>
          <Text style={styles.finishButtonText}>Calculate Speed</Text>
        </TouchableOpacity>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Trim: {startSec.toFixed(2)}s → {endSec.toFixed(2)}s • Scale: {metersPerPixel.toExponential(3)} m/px
          </Text>
        </View>

        {/* Loading overlay */}
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Processing Video...</Text>
          </View>
        )}
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
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  backButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
  },
  backButtonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  glassPanel: {
    backgroundColor: 'rgba(255, 255, 255, 1)',
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 20,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  videoWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
  },
  video: {
    position: 'absolute',
    top: 0,
  },
  box: {
    position: 'absolute',
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  detBox: {
    borderColor: '#FF3B30',
  },
  userBox: {
    borderColor: '#0fd1ff',
  },
  selBox: {
    borderColor: '#FFD60A',
    borderWidth: 3,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 15,
  },
  controlButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  controlButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  readout: {
    alignItems: 'center',
  },
  readoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  readoutSubtext: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 15,
  },
  editRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 15,
  },
  editButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    flex: 1,
    alignItems: 'center',
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
  },
  editButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  moveControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: 15,
  },
  moveColumn: {
    alignItems: 'center',
  },
  moveRow: {
    flexDirection: 'row',
    gap: 10,
    marginVertical: 10,
  },
  moveButton: {
    backgroundColor: '#E5E5EA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 40,
    alignItems: 'center',
  },
  moveButtonText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 16,
  },
  resizeControls: {
    alignItems: 'center',
  },
  resizeRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 4,
  },
  resizeButton: {
    backgroundColor: '#E5E5EA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 45,
    alignItems: 'center',
  },
  resizeButtonText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 12,
  },
  hint: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
  finishButton: {
    backgroundColor: '#007AFF',
    marginHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  finishButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 'auto',
  },
  footerText: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
  },
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
