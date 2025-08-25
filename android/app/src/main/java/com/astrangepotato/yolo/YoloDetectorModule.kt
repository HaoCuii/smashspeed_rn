package com.astrangepotato.yolo

import android.graphics.*
import android.media.*
import android.net.Uri
import android.util.Log
import android.view.Surface
import com.facebook.react.bridge.*
import ai.onnxruntime.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.ByteArrayOutputStream
import java.nio.FloatBuffer
import java.lang.StringBuilder

class YoloDetectorModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null
    private var inputName: String? = null

    // Reusable buffers
    private val MODEL_W = 640
    private val MODEL_H = 640
    private var dstBitmapCache: Bitmap? = null
    private var pixelsCache: IntArray? = null
    private var floatCache: FloatArray? = null
    private val sharedMatrix = Matrix()
    private val sharedPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val DEBUG_TAG = "YOLO_DEBUG"

    override fun getName() = "YoloDetector"

    @ReactMethod
    fun warmup(promise: Promise) {
        try {
            if (env == null) env = OrtEnvironment.getEnvironment()
            if (session == null) {
                val modelBytes = reactContext.assets.open("model.onnx").readBytes()
                session = env!!.createSession(modelBytes, OrtSession.SessionOptions())
                inputName = session!!.inputNames.iterator().next()
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("init_error", e)
        }
    }

    @ReactMethod
    fun detectVideo(path: String, fps: Int, startSec: Double, endSec: Double, promise: Promise) {
        Thread {
            var extractor: MediaExtractor? = null
            var codec: MediaCodec? = null
            var imageReader: ImageReader? = null
            var surface: Surface? = null
            // *** THE FIX IS HERE: We use MediaMetadataRetriever once to get the FPS ***
            val metaRetriever = MediaMetadataRetriever()

            try {
                val uri = Uri.parse(path)
                
                // --- Get Video Metadata (including FPS) ---
                if (uri.scheme == "content" || uri.scheme == "file") {
                    metaRetriever.setDataSource(reactContext, uri)
                } else {
                    metaRetriever.setDataSource(path)
                }
                
                val videoW = metaRetriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
                val videoH = metaRetriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
                
                val targetFps = if (fps > 0) {
                    fps
                } else {
                    val capRate = metaRetriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE)?.toFloatOrNull()
                    val frameCount = metaRetriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toIntOrNull()
                    val durationMs = metaRetriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                    when {
                        capRate != null && capRate > 0f -> capRate.toInt()
                        frameCount != null && durationMs != null && durationMs > 0 -> (frameCount * 1000 / durationMs).toInt()
                        else -> 30 // Default fallback
                    }
                }.coerceAtLeast(1)

                Log.d(DEBUG_TAG, "Processing video at $targetFps FPS.")
                
                // 1. --- Initialize MediaExtractor ---
                extractor = MediaExtractor()
                if (uri.scheme == "content" || uri.scheme == "file") {
                    extractor.setDataSource(reactContext, uri, null)
                } else {
                    extractor.setDataSource(path)
                }

                // 2. --- Find Video Track and Configure Decoder ---
                var trackFormat: MediaFormat? = null
                var videoTrackIndex = -1
                for (i in 0 until extractor.trackCount) {
                    val format = extractor.getTrackFormat(i)
                    val mime = format.getString(MediaFormat.KEY_MIME)
                    if (mime?.startsWith("video/") == true) {
                        trackFormat = format
                        videoTrackIndex = i
                        break
                    }
                }

                if (videoTrackIndex == -1 || trackFormat == null) {
                    throw RuntimeException("No video track found in file")
                }

                extractor.selectTrack(videoTrackIndex)
                imageReader = ImageReader.newInstance(videoW, videoH, 35, 2) // 35 = YUV_420_888
                surface = imageReader.surface

                val mimeType = trackFormat.getString(MediaFormat.KEY_MIME)!!
                codec = MediaCodec.createDecoderByType(mimeType)
                codec.configure(trackFormat, surface, null, 0)
                codec.start()

                // 3. --- Prepare for processing loop ---
                val scale = minOf(MODEL_W.toFloat() / videoW, MODEL_H.toFloat() / videoH)
                val dW = (videoW * scale).toInt()
                val dH = (videoH * scale).toInt()
                val left = (MODEL_W - dW) / 2f
                val top = (MODEL_H - dH) / 2f
                sharedMatrix.reset()
                sharedMatrix.postScale(scale, scale)
                sharedMatrix.postTranslate(left, top)

                val plane = MODEL_W * MODEL_H
                dstBitmapCache = Bitmap.createBitmap(MODEL_W, MODEL_H, Bitmap.Config.ARGB_8888)
                pixelsCache = IntArray(plane)
                floatCache = FloatArray(3 * plane)

                val startUs = (startSec * 1_000_000).toLong()
                val endUs = (endSec * 1_000_000).toLong()
                // --- Use the correctly detected targetFps ---
                val frameIntervalUs = 1_000_000L / targetFps
                var nextFrameUs = startUs

                extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

                val bufferInfo = MediaCodec.BufferInfo()
                var inputDone = false
                var outputDone = false

                // 4. --- Decoding and Inference Loop ---
                while (!outputDone) {
                    if (!inputDone) {
                        val inputBufIndex = codec.dequeueInputBuffer(10000)
                        if (inputBufIndex >= 0) {
                            val inputBuf = codec.getInputBuffer(inputBufIndex)!!
                            val sampleSize = extractor.readSampleData(inputBuf, 0)
                            if (sampleSize < 0) {
                                codec.queueInputBuffer(inputBufIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else {
                                val presentationTimeUs = extractor.sampleTime
                                codec.queueInputBuffer(inputBufIndex, 0, sampleSize, presentationTimeUs, 0)
                                extractor.advance()
                            }
                        }
                    }

                    val outputBufIndex = codec.dequeueOutputBuffer(bufferInfo, 10000)
                    if (outputBufIndex >= 0) {
                        if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                            outputDone = true
                        }

                        val doRender = bufferInfo.size > 0
                        if (doRender && bufferInfo.presentationTimeUs >= nextFrameUs) {
                            codec.releaseOutputBuffer(outputBufIndex, true)
                            val image = imageReader.acquireNextImage()
                            
                            if (image != null) {
                                val bmp = imageToBitmap(image)
                                val chw = preprocessLetterbox640_reuse(bmp, dstBitmapCache!!, pixelsCache!!, floatCache!!, sharedMatrix, sharedPaint)
                                val dets = runOrtDecodeNms(chw)
                                logDetections(bufferInfo.presentationTimeUs, dets)
                                val item = Arguments.createMap().apply {
                                    putDouble("t", bufferInfo.presentationTimeUs / 1000.0)
                                    putArray("boxes", detsToWritable(dets))
                                }
                                reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("onFrameDetected", item)
                                bmp.recycle()
                                image.close()
                                nextFrameUs += frameIntervalUs
                            }
                        } else {
                           codec.releaseOutputBuffer(outputBufIndex, false)
                        }

                         if (bufferInfo.presentationTimeUs > endUs) {
                            outputDone = true
                        }
                    }
                }

                emitComplete()
                promise.resolve(null)

            } catch (e: Exception) {
                Log.e(DEBUG_TAG, "Video processing error", e)
                emitError(e.message ?: "Unknown video processing error")
                promise.reject("detect_error", e)
            } finally {
                // 5. --- Cleanup ---
                metaRetriever.release() // Make sure to release the retriever
                surface?.release()
                imageReader?.close()
                codec?.stop()
                codec?.release()
                extractor?.release()
            }
        }.start()
    }
    
    private fun imageToBitmap(image: Image): Bitmap {
        val planes = image.planes
        val yBuffer = planes[0].buffer
        val uBuffer = planes[1].buffer
        val vBuffer = planes[2].buffer
    
        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()
    
        val nv21 = ByteArray(ySize + uSize + vSize)
        yBuffer.get(nv21, 0, ySize)
        vBuffer.get(nv21, ySize, vSize)
        uBuffer.get(nv21, ySize + vSize, uSize)
    
        val yuvImage = YuvImage(nv21, 17, image.width, image.height, null)
        val out = ByteArrayOutputStream()
        yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), 100, out)
        val imageBytes = out.toByteArray()
        return BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
    }
    
    private fun logDetections(tUs: Long, dets: List<WritableMap>) {
        if (dets.isNotEmpty()) {
            val logMessage = StringBuilder()
            logMessage.append("Frame at ${"%.2f".format(tUs / 1000.0)} ms -> Found ${dets.size} detections:\n")
            dets.take(3).forEachIndexed { index, box ->
                val x = box.getDouble("x")
                val y = box.getDouble("y")
                val w = box.getDouble("width")
                val h = box.getDouble("height")
                logMessage.append("  Box $index: [x=${"%.1f".format(x)}, y=${"%.1f".format(y)}, w=${"%.1f".format(w)}, h=${"%.1f".format(h)}]\n")
            }
            Log.d(DEBUG_TAG, logMessage.toString())
        } else {
            Log.d(DEBUG_TAG, "Frame at ${"%.2f".format(tUs / 1000.0)} ms -> Found 0 detections.")
        }
    }

    private fun emitComplete() {
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("onDetectionComplete", null)
    }

    private fun emitError(message: String) {
        val map = Arguments.createMap().apply { putString("message", message) }
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("onDetectionError", map)
    }

    private fun preprocessLetterbox640_reuse(src: Bitmap, dst: Bitmap, pixels: IntArray, out: FloatArray, mtx: Matrix, paint: Paint): FloatArray {
        val canvas = Canvas(dst)
        canvas.drawColor(Color.rgb(114, 114, 114))
        canvas.drawBitmap(src, mtx, paint)
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
                        if (p > bestProb) {
                            bestProb = p; bestClass = k - 5
                        }
                    }
                    val conf = obj * bestProb
                    if (conf >= confThresh && r[2] > 0f && r[3] > 0f && conf.isFinite()) {
                        pre.add(floatArrayOf(r[0], r[1], r[2], r[3], conf, bestClass.toFloat()))
                    }
                }
                pre.sortByDescending { it[4] }

                val active = BooleanArray(pre.size) { true }
                fun iou(a: FloatArray, b: FloatArray): Float {
                    val ax1 = a[0] - a[2] / 2; val ay1 = a[1] - a[3] / 2; val ax2 = a[0] + a[2] / 2; val ay2 = a[1] + a[3] / 2
                    val bx1 = b[0] - b[2] / 2; val by1 = b[1] - b[3] / 2; val bx2 = b[0] + b[2] / 2; val by2 = b[1] + b[3] / 2
                    val ix1 = maxOf(ax1, bx1); val iy1 = maxOf(ay1, by1)
                    val ix2 = minOf(ax2, bx2); val iy2 = minOf(ay2, by2)
                    val iw = maxOf(0f, ix2 - ix1); val ih = maxOf(0f, iy2 - iy1)
                    val inter = iw * ih
                    val ua = a[2] * a[3] + b[2] * b[3] - inter
                    return if (ua > 0f) inter / ua else 0f
                }

                val out = mutableListOf<WritableMap>()
                for (i in pre.indices) {
                    if (!active[i]) continue
                    val k = pre[i]
                    val map = Arguments.createMap().apply {
                        putDouble("x", (k[0] - k[2] / 2).toDouble())
                        putDouble("y", (k[1] - k[3] / 2).toDouble())
                        putDouble("width", k[2].toDouble())
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