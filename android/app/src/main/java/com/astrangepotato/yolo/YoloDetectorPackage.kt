package com.astrangepotato.yolo


import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.bridge.NativeModule

class YoloDetectorPackage : ReactPackage {
  override fun createViewManagers(reactContext: ReactApplicationContext)
    : MutableList<ViewManager<*, *>> = mutableListOf()

  override fun createNativeModules(reactContext: ReactApplicationContext)
    : MutableList<NativeModule> = mutableListOf(YoloDetectorModule(reactContext))
}
