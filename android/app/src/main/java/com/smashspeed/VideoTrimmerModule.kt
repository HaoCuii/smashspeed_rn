package com.smashspeed

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaMetadataRetriever
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.nio.ByteBuffer

class VideoTrimmerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName() = "VideoTrimmer"

    // NEW: get duration in seconds (double)
    @ReactMethod
    fun getDuration(uriString: String, promise: Promise) {
        val ctx = reactApplicationContext
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(ctx, Uri.parse(uriString))
            val durMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
            if (durMs == null || durMs <= 0) {
                promise.reject("E_DURATION", "Failed to read duration")
            } else {
                promise.resolve(durMs.toDouble() / 1000.0)
            }
        } catch (e: Exception) {
            promise.reject("E_DURATION", "Failed to read duration: ${e.message}", e)
        } finally {
            try { retriever.release() } catch (_: Exception) {}
        }
    }

    @ReactMethod
    fun trim(uriString: String, startTime: Double, endTime: Double, promise: Promise) {
        val context = reactApplicationContext
        if (endTime <= startTime) {
            promise.reject("E_BAD_RANGE", "endTime must be greater than startTime")
            return
        }
        try {
            context.contentResolver.openFileDescriptor(Uri.parse(uriString), "r").use { pfd ->
                if (pfd == null) {
                    promise.reject("E_FILE_NOT_FOUND", "Could not open URI: $uriString")
                    return
                }
                val out = File(context.cacheDir, "trimmed-${System.currentTimeMillis()}.mp4")
                genVideoUsingMuxer(pfd.fileDescriptor, out.absolutePath, startTime, endTime)
                promise.resolve(Uri.fromFile(out).toString())
            }
        } catch (e: Exception) {
            e.printStackTrace()
            promise.reject("E_TRIM_FAILED", "Video trimming failed: ${e.message}", e)
        }
    }

    private fun genVideoUsingMuxer(
        srcFd: java.io.FileDescriptor,
        dstPath: String,
        startSecs: Double,
        endSecs: Double
    ) {
        val extractor = MediaExtractor()
        val muxer = MediaMuxer(dstPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

        try {
            extractor.setDataSource(srcFd)

            val trackIndexMap = mutableMapOf<Int, Int>()
            var videoTrackIndex: Int? = null
            var rotation = 0
            var durationUs: Long = -1

            for (i in 0 until extractor.trackCount) {
                val fmt = extractor.getTrackFormat(i)
                val mime = fmt.getString(MediaFormat.KEY_MIME) ?: ""
                if (fmt.containsKey(MediaFormat.KEY_DURATION)) {
                    val d = fmt.getLong(MediaFormat.KEY_DURATION)
                    durationUs = maxOf(durationUs, d)
                }
                if (mime.startsWith("video/")) {
                    videoTrackIndex = i
                    if (fmt.containsKey("rotation-degrees")) {
                        rotation = fmt.getInteger("rotation-degrees")
                    }
                }
            }
            if (videoTrackIndex == null) throw IllegalArgumentException("No video track found")
            if (durationUs <= 0) throw IllegalArgumentException("Invalid source duration")

            val reqStartUs = (startSecs * 1_000_000).toLong().coerceIn(0, durationUs - 1)
            val reqEndUs = (endSecs * 1_000_000).toLong().coerceIn(reqStartUs + 1, durationUs)
            if (reqEndUs <= reqStartUs) throw IllegalArgumentException("endTime must be > startTime")

            fun bufferSizeForTrack(i: Int): Int {
                val f = extractor.getTrackFormat(i)
                return if (f.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE))
                    f.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE).coerceAtLeast(256 * 1024)
                else 1 * 1024 * 1024
            }

            for (i in 0 until extractor.trackCount) {
                val fmt = extractor.getTrackFormat(i)
                val mime = fmt.getString(MediaFormat.KEY_MIME) ?: ""
                if (mime.startsWith("video/") || mime.startsWith("audio/")) {
                    val newIdx = muxer.addTrack(fmt)
                    trackIndexMap[i] = newIdx
                }
            }
            if (trackIndexMap.isEmpty()) throw IllegalArgumentException("No audio/video tracks found")

            if (rotation != 0) muxer.setOrientationHint(rotation)
            muxer.start()

            extractor.selectTrack(videoTrackIndex!!)
            extractor.seekTo(reqStartUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            var baseVideoPts = -1L
            run {
                val tmpBuf = ByteBuffer.allocate(bufferSizeForTrack(videoTrackIndex!!))
                val info = MediaCodec.BufferInfo()
                while (true) {
                    val size = extractor.readSampleData(tmpBuf, 0)
                    if (size < 0) break
                    val pts = extractor.sampleTime
                    if (pts > reqEndUs) break
                    baseVideoPts = pts
                    break
                }
            }
            extractor.unselectTrack(videoTrackIndex!!)
            if (baseVideoPts < 0) baseVideoPts = reqStartUs
            val baseOffsetUs = baseVideoPts

            for ((srcTrack, dstTrack) in trackIndexMap) {
                val buf = ByteBuffer.allocate(bufferSizeForTrack(srcTrack))
                val info = MediaCodec.BufferInfo()

                extractor.selectTrack(srcTrack)
                extractor.seekTo(reqStartUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

                while (true) {
                    val size = extractor.readSampleData(buf, 0)
                    if (size < 0) break
                    val pts = extractor.sampleTime
                    if (pts < reqStartUs) { extractor.advance(); continue }
                    if (pts > reqEndUs) break

                    info.size = size
                    info.offset = 0
                    info.presentationTimeUs = (pts - baseOffsetUs).coerceAtLeast(0)
                    info.flags = extractor.sampleFlags

                    muxer.writeSampleData(dstTrack, buf, info)
                    extractor.advance()
                }
                extractor.unselectTrack(srcTrack)
            }
        } finally {
            try { muxer.stop() } catch (_: Exception) {}
            try { muxer.release() } catch (_: Exception) {}
            try { extractor.release() } catch (_: Exception) {}
        }
    }
}
