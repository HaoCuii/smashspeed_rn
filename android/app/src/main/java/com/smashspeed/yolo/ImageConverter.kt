package com.smashspeed.yolo

import android.graphics.Bitmap
import android.media.Image
import java.nio.ByteBuffer

/**
 * A singleton object that acts as a bridge to the native C++ image conversion code.
 */
object ImageConverter {
    init {
        // This loads the compiled C++ library (.so file) into the JVM.
        // The name "yoloconverter" must match the project name in CMakeLists.txt.
        System.loadLibrary("yoloconverter")
    }

    /**
     * Declares the native function signature. The 'external' keyword tells Kotlin
     * that the implementation for this function is located in a native library (JNI).
     * The parameters must match the C++ function's signature.
     */
    private external fun yuvToBitmap(
        yBuffer: ByteBuffer, uBuffer: ByteBuffer, vBuffer: ByteBuffer,
        yRowStride: Int, uRowStride: Int, vRowStride: Int,
        uPixelStride: Int,
        width: Int, height: Int,
        bitmap: Bitmap
    )

    /**
     * A public-facing, user-friendly helper that takes an android.media.Image
     * and a destination Bitmap, extracts the necessary data, and calls the native function.
     * This abstracts away the complexity of dealing with image planes and strides.
     *
     * @param image The input Image in YUV_420_888 format from the MediaCodec decoder.
     * @param bitmap The output Bitmap, which must be pre-allocated with the correct
     * dimensions and ARGB_8888 config.
     */
    fun convert(image: Image, bitmap: Bitmap) {
        val planes = image.planes
        yuvToBitmap(
            yBuffer = planes[0].buffer,
            uBuffer = planes[1].buffer,
            vBuffer = planes[2].buffer,
            yRowStride = planes[0].rowStride,
            uRowStride = planes[1].rowStride,
            vRowStride = planes[2].rowStride,
            uPixelStride = planes[1].pixelStride, // Used to detect NV12/I420 format
            width = image.width,
            height = image.height,
            bitmap = bitmap
        )
    }
}