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
  private var inputName: String? = null

  // Reusable buffers / objects to avoid per-frame allocations
  private val MODEL_W = 640
  private val MODEL_H = 640
  private var dstBitmapCache: Bitmap? = null
  private var pixelsCache: IntArray? = null
  private var floatCache: FloatArray? = null
  private val sharedMatrix = Matrix()
  private val sharedPaint = Paint(Paint.FILTER_BITMAP_FLAG)

  override fun getName() = "YoloDetector"

  @ReactMethod
  fun warmup(promise: Promise) {
    try {
      if (env == null) env = OrtEnvironment.getEnvironment()
      if (session == null) {
        val modelBytes = reactContext.assets.open("model.onnx").readBytes()
        val opts = OrtSession.SessionOptions()
        // You can tweak opts here (threads, optimization level) if API available.
        session = env!!.createSession(modelBytes, opts)

        // cache input name once
        inputName = session!!.inputNames.iterator().next()

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

        // determine target FPS (same logic you had)
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

        // compute letterbox params once if video metadata available (width/height usually present)
        val videoW = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
        val videoH = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
        var precomputedLeft = 0f
        var precomputedTop = 0f
        var precomputedScale = 1f
        if (videoW != null && videoH != null && videoW > 0 && videoH > 0) {
          val sW = videoW.toFloat()
          val sH = videoH.toFloat()
          precomputedScale = minOf(MODEL_W / sW, MODEL_H / sH)
          val dW = (sW * precomputedScale).toInt()
          val dH = (sH * precomputedScale).toInt()
          precomputedLeft = (MODEL_W - dW) / 2f
          precomputedTop  = (MODEL_H - dH) / 2f
          sharedMatrix.setScale(precomputedScale, precomputedScale)
          sharedMatrix.postTranslate(precomputedLeft, precomputedTop)
        } else {
          // will compute per-frame fallback in preprocess
          precomputedScale = -1f
        }

        // allocate/reuse caches once
        val plane = MODEL_W * MODEL_H
        if (dstBitmapCache == null) dstBitmapCache = Bitmap.createBitmap(MODEL_W, MODEL_H, Bitmap.Config.ARGB_8888)
        if (pixelsCache == null) pixelsCache = IntArray(plane)
        if (floatCache == null) floatCache = FloatArray(3 * plane)

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

          val bmp = getFrameClosest(retriever, tUs)
          if (bmp != null) {
            // If we couldn't precompute scale/translate, compute from this frame once and set sharedMatrix
            if (precomputedScale <= 0f) {
              val sW = bmp.width.toFloat()
              val sH = bmp.height.toFloat()
              val scale = minOf(MODEL_W / sW, MODEL_H / sH)
              val dW = (sW * scale).toInt()
              val dH = (sH * scale).toInt()
              val left = (MODEL_W - dW) / 2f
              val top  = (MODEL_H - dH) / 2f
              sharedMatrix.setScale(scale, scale)
              sharedMatrix.postTranslate(left, top)
            }

            // Fill cached floatCache by reusing the shared dstBitmapCache and pixelsCache
            val chw = preprocessLetterbox640_reuse(bmp, dstBitmapCache!!, pixelsCache!!, floatCache!!, sharedMatrix, sharedPaint)
            val dets = runOrtDecodeNms(chw)               // decode + NMS (uses cached inputName)
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

  /** Reusable letterbox -> fills provided arrays, returns same out array */
  private fun preprocessLetterbox640_reuse(
    src: Bitmap,
    dst: Bitmap,
    pixels: IntArray,
    out: FloatArray,
    mtx: Matrix,
    paint: Paint
  ): FloatArray {
    // dst already 640x640, mtx is precomputed or set per-frame
    val canvas = Canvas(dst)
    canvas.drawColor(Color.rgb(114, 114, 114))
    canvas.drawBitmap(src, mtx, paint)

    // extract pixels into preallocated array
    dst.getPixels(pixels, 0, MODEL_W, 0, 0, MODEL_W, MODEL_H)

    val plane = MODEL_W * MODEL_H
    var r = 0; var g = plane; var b = 2 * plane; var p = 0
    for (y in 0 until MODEL_H) {
      for (x in 0 until MODEL_W) {
        val px = pixels[p++]
        out[r++] = ((px shr 16) and 0xFF) / 255f
        out[g++] = ((px shr 8) and 0xFF) / 255f
        out[b++] = ( px and 0xFF) / 255f
      }
    }
    return out
  }

  /* runOrtDecodeNms unchanged except it now uses cached inputName field */
  private fun runOrtDecodeNms(chw: FloatArray): List<WritableMap> {
    val envLocal = env ?: throw IllegalStateException("ORT not initialized")
    val sess = session ?: throw IllegalStateException("Session not created")
    val input = inputName ?: sess.inputNames.iterator().next()

    OnnxTensor.createTensor(envLocal, FloatBuffer.wrap(chw), longArrayOf(1, 3, 640, 640)).use { tensor ->
      sess.run(mapOf(input to tensor)).use { result ->
        val raw = result[0].value

        @Suppress("UNCHECKED_CAST")
        val rows: Array<FloatArray> = when (raw) {
          is Array<*> -> {
            val a = raw.getOrNull(0)
            when (a) {
              is Array<*> -> {
                val arr = a as Array<FloatArray>
                if (arr.isNotEmpty()) {
                  val dim0 = arr.size
                  val dim1 = arr[0].size
                  if (dim0 < dim1 && dim0 <= 256) {
                    val K = dim0
                    val N = dim1
                    Array(N) { i -> FloatArray(K) { k -> arr[k][i] } }
                  } else {
                    arr
                  }
                } else emptyArray()
              }
              is FloatArray -> arrayOf(a)
              else -> error("Unexpected ONNX output element type: ${a?.javaClass}")
            }
          }
          is FloatArray -> arrayOf(raw)
          else -> error("Unexpected ONNX output type: ${raw?.javaClass}")
        }

        val confThresh = 0.15f
        val iouThresh = 0.45f
        val pre = mutableListOf<FloatArray>()
        for (r in rows) {
          if (r.size < 6) continue
          val obj = r[4]
          var bestProb = 0f
          var bestClass = 0
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
