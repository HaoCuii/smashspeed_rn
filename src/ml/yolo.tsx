// src/ml/yolo.ts
import { NativeModules } from 'react-native';

const { YoloDetector } = NativeModules as {
  YoloDetector: {
    warmup: () => Promise<void>;
    detectVideo: (path: string, fps: number) =>
      Promise<Array<{ t: number; boxes: Box[] }>>;
  };
};

// Boxes are returned in MODEL space (640×640, top-left x/y)
export type Box = {
  x: number; y: number; width: number; height: number; confidence: number;
};

export async function runDetection(videoPath: string, fps = 10) {
  await YoloDetector.warmup();
  return YoloDetector.detectVideo(videoPath, fps);
}

/**
 * Map a MODEL-space box (after our 640×640 letterbox preprocess)
 * back to ORIGINAL VIDEO pixel space (w×h).
 */
export function mapModelToVideo(
  b: Box, videoW: number, videoH: number
) {
  const scale = Math.min(640 / videoW, 640 / videoH); // same as preprocess
  const drawnW = videoW * scale;
  const drawnH = videoH * scale;
  const padX = (640 - drawnW) / 2;
  const padY = (640 - drawnH) / 2;
  const inv = 1 / scale;

  const x = (b.x - padX) * inv;
  const y = (b.y - padY) * inv;
  const width  = b.width  * inv;
  const height = b.height * inv;
  return { x, y, width, height, confidence: b.confidence };
}
