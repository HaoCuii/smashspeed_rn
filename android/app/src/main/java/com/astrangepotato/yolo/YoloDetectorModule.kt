package com.astrangepotato.yolo


import android.graphics.*
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import ai.onnxruntime.*
import ai.onnxruntime.TensorInfo
import java.nio.FloatBuffer

class YoloDetectorModule(private val reactContext: ReactApplicationContext)
  : ReactContextBaseJavaModule(reactContext) {

  private var env: OrtEnvironment? = null
  private var session: OrtSession? = null

  override fun getName() = "YoloDetector"

  @ReactMethod
  fun warmup(promise: Promise) {
    try {
      if (env == null) env = OrtEnvironment.getEnvironment()
      if (session == null) {
        val modelBytes = reactContext.assets.open("model.onnx").readBytes()
        val opts = OrtSession.SessionOptions()
        session = env!!.createSession(modelBytes, opts)

        session?.let { s ->
          for ((name, v) in s.inputInfo) {
            val ti = v.info as TensorInfo
            Log.i("YOLO", "Input  $name shape=${ti.shape.contentToString()} type=${ti.type}")
          }
          for ((name, v) in s.outputInfo) {
            val ti = v.info as TensorInfo
            Log.i("YOLO", "Output $name shape=${ti.shape.contentToString()} type=${ti.type}")
          }
        }
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("init_error", e)
    }
  }

  @ReactMethod
  fun detectVideo(path: String, fps: Int, startSec: Double, endSec: Double, promise: Promise) {
    Thread {
      val retriever = MediaMetadataRetriever()
      try {
        val uri = Uri.parse(path)
        if (uri.scheme == "content" || uri.scheme == "file") {
          retriever.setDataSource(reactContext, uri)
        } else {
          retriever.setDataSource(path)
        }

        val targetFps = if (fps > 0) {
          fps
        } else {
          val capRate = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE)?.toFloatOrNull()
          val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
          val frameCount = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toLongOrNull()
          when {
            capRate != null && capRate > 0f -> capRate.toInt()
            durationMs != null && frameCount != null && durationMs > 0 ->
              (((frameCount * 1000.0) / durationMs).toInt()).coerceAtLeast(1)
            else -> 30
          }
        }

        val startUs = (startSec * 1_000_000).toLong()
        val endUs = (endSec * 1_000_000).toLong()
        val durationUs = endUs - startUs
        if (durationUs <= 0) {
          emitComplete()
          promise.resolve(null)
          return@Thread
        }

        val stepUs = 1_000_000L / targetFps
        val numFrames = Math.round(durationUs.toDouble() / stepUs)

        for (i in 0 until numFrames) {
          val tUs = startUs + (i * stepUs)

          // Use the closest frame rather than previous keyframe to avoid "frozen" boxes
          val bmp = getFrameClosest(retriever, tUs)
          if (bmp != null) {
            val chw = preprocessLetterbox640(bmp)         // 640x640 letterbox
            val dets = runOrtDecodeNms(chw)               // decode + NMS
            val item = Arguments.createMap().apply {
              putDouble("t", tUs / 1000.0) // ms
              putArray("boxes", detsToWritable(dets))
            }
            reactContext
              .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit("onFrameDetected", item)
            bmp.recycle()
          }
        }

        emitComplete()
        promise.resolve(null)
      } catch (e: Exception) {
        emitError(e.message ?: "unknown error")
        promise.reject("detect_error", e)
      } finally {
        try { retriever.release() } catch (_: Throwable) {}
      }
    }.start()
  }

  /** Try to grab the true closest frame at tUs, with graceful fallbacks. */
  private fun getFrameClosest(retriever: MediaMetadataRetriever, tUs: Long): Bitmap? {
    return retriever.getFrameAtTime(tUs, MediaMetadataRetriever.OPTION_CLOSEST)
      ?: retriever.getFrameAtTime(tUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
      ?: retriever.getFrameAtTime(tUs, MediaMetadataRetriever.OPTION_NEXT_SYNC)
      ?: retriever.getFrameAtTime(tUs, MediaMetadataRetriever.OPTION_PREVIOUS_SYNC)
  }

  /** Notify JS listeners that we’re done */
  private fun emitComplete() {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("onDetectionComplete", null)
  }

  /** Notify JS listeners about an error */
  private fun emitError(message: String) {
    val map = Arguments.createMap().apply { putString("message", message) }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("onDetectionError", map)
  }

  /** Letterbox to 640x640, CHW, RGB, [0..1] */
  private fun preprocessLetterbox640(src: Bitmap): FloatArray {
    val dst = Bitmap.createBitmap(640, 640, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(dst)
    // Match Ultralytics default padding (114,114,114)
    canvas.drawColor(Color.rgb(114, 114, 114))

    val sW = src.width.toFloat()
    val sH = src.height.toFloat()
    val scale = minOf(640f / sW, 640f / sH)          // preserves aspect (letterbox)
    val dW = (sW * scale).toInt()
    val dH = (sH * scale).toInt()
    val left = (640 - dW) / 2f
    val top  = (640 - dH) / 2f

    val m = Matrix().apply { setScale(scale, scale); postTranslate(left, top) }
    canvas.drawBitmap(src, m, Paint(Paint.FILTER_BITMAP_FLAG))

    val W = 640
    val H = 640
    val plane = W * H
    val pixels = IntArray(plane)
    dst.getPixels(pixels, 0, W, 0, 0, W, H)

    val out = FloatArray(3 * plane)
    var r = 0; var g = plane; var b = 2 * plane; var p = 0
    for (y in 0 until H) {
      for (x in 0 until W) {
        val px = pixels[p++]
        out[r++] = ((px shr 16) and 0xFF) / 255f
        out[g++] = ((px shr 8) and 0xFF) / 255f
        out[b++] = ( px and 0xFF) / 255f
      }
    }
    dst.recycle()
    return out
  }

  /**
   * Robust postprocess:
   *  - Accepts YOLO head shaped [1, N, 5+C] or [1, 5+C, N]
   *  - confidence = obj * max(classProbs)  (works if C==1 or C>1)
   *  - Returns TLWH in model space (letterboxed 640x640)
   */
  private fun runOrtDecodeNms(chw: FloatArray): List<WritableMap> {
    val envLocal = env ?: throw IllegalStateException("ORT not initialized")
    val sess = session ?: throw IllegalStateException("Session not created")
    val inputName = sess.inputNames.iterator().next()

    OnnxTensor.createTensor(envLocal, FloatBuffer.wrap(chw), longArrayOf(1, 3, 640, 640)).use { tensor ->
      sess.run(mapOf(inputName to tensor)).use { result ->
        val raw = result[0].value

        // ---- Normalize to rows: Array<FloatArray> with length K = 5 + C
        val rows: Array<FloatArray> = when (raw) {
          is Array<*> -> {
            // Most exports: Array<Array<FloatArray>> with shape [1, A, B] (A,B = N,K or K,N)
            val a = raw.getOrNull(0)
            when (a) {
              is Array<*> -> {
                val arr = a as Array<FloatArray> // shape could be [N, K] OR [K, N]
                if (arr.isNotEmpty()) {
                  val dim0 = arr.size
                  val dim1 = arr[0].size
                  // If dim0 is small (e.g., 84) and dim1 is huge (e.g., 8400), we have [K, N] -> transpose to [N, K]
                  if (dim0 < dim1 && dim0 <= 256) {
                    val K = dim0
                    val N = dim1
                    Array(N) { i -> FloatArray(K) { k -> arr[k][i] } }
                  } else {
                    arr // already [N, K]
                  }
                } else {
                  emptyArray()
                }
              }
              is FloatArray -> {
                // Rare: [1, K] – treat as one "row"
                arrayOf(a)
              }
              else -> error("Unexpected ONNX output element type: ${a?.javaClass}")
            }
          }
          is FloatArray -> arrayOf(raw)
          else -> error("Unexpected ONNX output type: ${raw?.javaClass}")
        }

        // ---- Decode rows
        val confThresh = 0.15f      // tweakable
        val iouThresh = 0.45f
        val pre = mutableListOf<FloatArray>() // [cx,cy,w,h,conf,classId]

        for (r in rows) {
          if (r.size < 6) continue
          val obj = r[4]
          var bestProb = 0f
          var bestClass = 0
          // classes start at 5; works for C==1 too
          for (k in 5 until r.size) {
            val p = r[k]
            if (p > bestProb) { bestProb = p; bestClass = k - 5 }
          }
          val conf = obj * bestProb
          if (conf >= confThresh && r[2] > 0f && r[3] > 0f && conf.isFinite()) {
            pre.add(floatArrayOf(r[0], r[1], r[2], r[3], conf, bestClass.toFloat()))
          }
        }
        pre.sortByDescending { it[4] }

        // ---- NMS in center format
        val active = BooleanArray(pre.size) { true }
        fun iou(a: FloatArray, b: FloatArray): Float {
          val ax1 = a[0]-a[2]/2; val ay1 = a[1]-a[3]/2; val ax2 = a[0]+a[2]/2; val ay2 = a[1]+a[3]/2
          val bx1 = b[0]-b[2]/2; val by1 = b[1]-b[3]/2; val bx2 = b[0]+b[2]/2; val by2 = b[1]+b[3]/2
          val ix1 = maxOf(ax1, bx1); val iy1 = maxOf(ay1, by1)
          val ix2 = minOf(ax2, bx2); val iy2 = minOf(ay2, by2)
          val iw = maxOf(0f, ix2 - ix1); val ih = maxOf(0f, iy2 - iy1)
          val inter = iw * ih
          val ua = a[2]*a[3] + b[2]*b[3] - inter
          return if (ua > 0f) inter / ua else 0f
        }

        val out = mutableListOf<WritableMap>()
        for (i in pre.indices) {
          if (!active[i]) continue
          val k = pre[i]
          val map = Arguments.createMap().apply {
            // convert cx,cy,w,h -> tlwh in MODEL space
            putDouble("x", (k[0] - k[2]/2).toDouble())
            putDouble("y", (k[1] - k[3]/2).toDouble())
            putDouble("width",  k[2].toDouble())
            putDouble("height", k[3].toDouble())
            putDouble("confidence", k[4].toDouble())
            putInt("classId", k[5].toInt())
          }
          out.add(map)
          for (j in i + 1 until pre.size) {
            if (active[j] && iou(pre[i], pre[j]) > iouThresh) active[j] = false
          }
        }
        return out
      }
    }
  }

  private fun detsToWritable(list: List<WritableMap>): WritableArray {
    val arr = Arguments.createArray()
    list.forEach { arr.pushMap(it) }
    return arr
  }
}