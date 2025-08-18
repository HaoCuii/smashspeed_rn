package com.smashspeed.yolo

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
        // Optional: enable NNAPI on supported devices
        // opts.addNnapi()
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
            val frameRateStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE)
            frameRateStr?.toFloatOrNull()?.toInt() ?: 30
        }
        
        val startUs = (startSec * 1_000_000).toLong()
        val endUs = (endSec * 1_000_000).toLong()
        val durationUs = endUs - startUs
        
        if (durationUs <= 0) {
            promise.resolve(null)
            return@Thread
        }

        val stepUs = 1_000_000L / targetFps
        val numFrames = Math.round(durationUs.toDouble() / stepUs)

        for (i in 0 until numFrames) {
            val tUs = startUs + (i * stepUs)
            // FIXED: Change option to sync with the video player's seek behavior
            val bmp = retriever.getFrameAtTime(tUs, MediaMetadataRetriever.OPTION_PREVIOUS_SYNC)

            if (bmp != null) {
                val chw = preprocessLetterbox640(bmp)
                val dets = runOrtDecodeNms(chw)
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
        
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("detect_error", e)
      } finally {
        try { retriever.release() } catch (_: Throwable) {}
      }
    }.start()
  }

  /** Letterbox to 640x640, then output CHW (RGB) float32 in [0..1] */
  private fun preprocessLetterbox640(src: Bitmap): FloatArray {
    val dst = Bitmap.createBitmap(640, 640, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(dst)
    canvas.drawColor(Color.BLACK)

    val sW = src.width.toFloat()
    val sH = src.height.toFloat()
    val scale = minOf(640f / sW, 640f / sH)
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

  /** Create NCHW tensor, run session, decode [x,y,w,h,obj,cls] rows, filter + NMS */
  private fun runOrtDecodeNms(chw: FloatArray): List<WritableMap> {
    val env = env ?: throw IllegalStateException("ORT not initialized")
    val session = session ?: throw IllegalStateException("Session not created")
    val inputName = session.inputNames.iterator().next()

    val fb = FloatBuffer.wrap(chw)
    val shape = longArrayOf(1, 3, 640, 640) // NCHW

    OnnxTensor.createTensor(env, fb, shape).use { tensor ->
      session.run(mapOf(inputName to tensor)).use { result ->
        @Suppress("UNCHECKED_CAST")
        val rows = (result.get(0).value as Array<Array<FloatArray>>)[0]

        val pre = mutableListOf<FloatArray>() // [x,y,w,h,conf]
        for (r in rows) {
          val conf = r[4] * r[5]
          if (conf >= 0.10f && r[2] > 0f && r[3] > 0f && conf.isFinite()) {
            pre.add(floatArrayOf(r[0], r[1], r[2], r[3], conf))
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
          }
          out.add(map)
          for (j in i + 1 until pre.size) {
            if (active[j] && iou(pre[i], pre[j]) > 0.45f) active[j] = false
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