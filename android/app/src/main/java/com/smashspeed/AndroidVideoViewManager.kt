package com.smashspeed

import com.facebook.react.module.annotations.ReactModule          // ← add
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

@ReactModule(name = "AndroidVideoView")                           // ← add
class AndroidVideoViewManager : SimpleViewManager<AndroidVideoView>() {
    override fun getName() = "AndroidVideoView"

    override fun createViewInstance(reactContext: ThemedReactContext) =
        AndroidVideoView(reactContext)

    @ReactProp(name = "uri")
    fun setUri(view: AndroidVideoView, uri: String?) {
        view.setUri(uri)
    }
}
