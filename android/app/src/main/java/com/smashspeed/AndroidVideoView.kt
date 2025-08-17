package com.smashspeed

import android.content.Context
import android.net.Uri
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.VideoView

class AndroidVideoView(ctx: Context) : FrameLayout(ctx) {
    private val videoView = VideoView(ctx)
    private val controller = MediaController(ctx)

    init {
        addView(videoView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        controller.setAnchorView(videoView)
        videoView.setMediaController(controller)
    }

    fun setUri(uriString: String?) {
        if (uriString.isNullOrBlank()) return
        videoView.setVideoURI(Uri.parse(uriString))
        videoView.setOnPreparedListener { mp ->
            mp.isLooping = false
            videoView.start()
        }
    }
}
