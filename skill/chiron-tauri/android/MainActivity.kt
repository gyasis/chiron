package com.gyasi.chiron

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import java.lang.ref.WeakReference

/* Copied over the generated MainActivity by android-permissions.sh (src-tauri/gen is gitignored).
 * Adds the ChironAudio JS bridge for background playback: play.js calls ChironAudio.playing(title, paused) / stopped(),
 * which start/update/stop PlaybackService; while the service runs, onPause re-resumes the WebView so wry's mWebView.onPause() (screen off,
 * Fold closed, app switched) does not suspend the page that owns the <audio> element. */
class MainActivity : TauriActivity() {
  @Volatile private var active = false   // PlaybackService running (playing, or paused with its notification up)
  private var web: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    current = WeakReference(this)
  }

  override fun onWebViewCreate(webView: WebView) {
    web = webView
    webView.addJavascriptInterface(Bridge(), "ChironAudio")
    webView.addJavascriptInterface(OpenBridge(), "ChironOpen")
    // Debug builds only: lets chrome://inspect attach (there was no webview_devtools socket when MM handoff was debugged).
    if ((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true)
    // wry's RustWebChromeClient answers onShowCustomView with callback.onCustomViewHidden(): every <video> fullscreen
    // button did nothing (2026-10-18). Wrap it once wry has installed it (post = after setup), keeping all its behaviour.
    webView.post { wrapChromeClient(webView) }
  }

  // ---- video fullscreen ----
  private var fsView: View? = null
  private var fsCallback: WebChromeClient.CustomViewCallback? = null
  private var fsPrevOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
  private val fsBack = object : OnBackPressedCallback(false) { override fun handleOnBackPressed() { exitFullscreen() } }

  private fun wrapChromeClient(webView: WebView) {
    if (Build.VERSION.SDK_INT < 26) return
    val inner = webView.webChromeClient ?: return
    if (inner is FullscreenChromeClient) return
    webView.webChromeClient = FullscreenChromeClient(inner)
    onBackPressedDispatcher.addCallback(this, fsBack)
    Log.i(PlaybackService.TAG, "video fullscreen enabled")
  }

  private fun enterFullscreen(view: View, callback: WebChromeClient.CustomViewCallback) {
    Log.i(PlaybackService.TAG, "video fullscreen: enter")
    if (fsView != null) { callback.onCustomViewHidden(); return }
    fsView = view; fsCallback = callback; fsPrevOrientation = requestedOrientation
    (window.decorView as ViewGroup).addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    WindowInsetsControllerCompat(window, window.decorView).apply {
      hide(WindowInsetsCompat.Type.systemBars()); systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    fsBack.isEnabled = true
  }

  private fun exitFullscreen() {
    val v = fsView ?: return
    Log.i(PlaybackService.TAG, "video fullscreen: exit", Throwable("who closed it"))
    (window.decorView as ViewGroup).removeView(v)
    WindowInsetsControllerCompat(window, window.decorView).show(WindowInsetsCompat.Type.systemBars())
    requestedOrientation = fsPrevOrientation
    fsView = null; fsBack.isEnabled = false
    fsCallback?.onCustomViewHidden(); fsCallback = null
  }

  /** Delegates everything to wry's client except fullscreen, which it refuses. */
  inner class FullscreenChromeClient(private val inner: WebChromeClient) : WebChromeClient() {
    override fun onShowCustomView(view: View, callback: CustomViewCallback) = enterFullscreen(view, callback)
    override fun onHideCustomView() = exitFullscreen()
    override fun onPermissionRequest(request: PermissionRequest) = inner.onPermissionRequest(request)
    override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult) = inner.onJsAlert(view, url, message, result)
    override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult) = inner.onJsConfirm(view, url, message, result)
    override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult) =
      inner.onJsPrompt(view, url, message, defaultValue, result)
    override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) =
      inner.onGeolocationPermissionsShowPrompt(origin, callback)
    override fun onShowFileChooser(webView: WebView, filePathCallback: ValueCallback<Array<Uri>>, fileChooserParams: FileChooserParams) =
      inner.onShowFileChooser(webView, filePathCallback, fileChooserParams)
    override fun onConsoleMessage(consoleMessage: ConsoleMessage) = inner.onConsoleMessage(consoleMessage)
    override fun onReceivedTitle(view: WebView, title: String?) = inner.onReceivedTitle(view, title)
    override fun onProgressChanged(view: WebView, newProgress: Int) = inner.onProgressChanged(view, newProgress)
  }

  override fun onPause() {
    super.onPause()
    if (active) web?.onResume()
  }

  override fun onDestroy() {
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  inner class Bridge {
    /** paused=true keeps the notification (with Riprendi) and the process alive; play.js calls stopped() later. */
    @JavascriptInterface fun playing(title: String?, paused: Boolean) {
      active = true
      if (!paused) askNotifications()
      val i = Intent(this@MainActivity, PlaybackService::class.java)
        .putExtra(PlaybackService.EXTRA_TITLE, title ?: "Chiron").putExtra(PlaybackService.EXTRA_PAUSED, paused)
      try { ContextCompat.startForegroundService(this@MainActivity, i) } catch (e: Exception) { Log.w(PlaybackService.TAG, "cannot start service: ${e.message}") }
    }
    @JavascriptInterface fun stopped() {
      active = false
      stopService(Intent(this@MainActivity, PlaybackService::class.java))
    }
  }

  /** Hands a matchmadness:// URL to the Match Madness app. The opener plugin is scope-checked and swallowed the call silently;
   *  a direct ACTION_VIEW intent is the robust path. Only that one scheme is accepted. Returns false if nothing handles it. */
  inner class OpenBridge {
    /** Diagnostics from the page into logcat (tag ChironPlayback) — the WebView has no devtools in a release/debug Tauri build. */
    @JavascriptInterface fun log(msg: String?) { Log.i(PlaybackService.TAG, "web: $msg") }
    @JavascriptInterface fun open(url: String?): Boolean {
      val u = try { Uri.parse(url ?: "") } catch (e: Exception) { null }
      if (u == null || u.scheme != "matchmadness") { Log.w(PlaybackService.TAG, "ChironOpen refused: $url"); return false }
      return try {
        runOnUiThread { try { startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); Log.i(PlaybackService.TAG, "ChironOpen -> $u") }
                        catch (e: Exception) { Log.w(PlaybackService.TAG, "ChironOpen failed: ${e.message}") } }
        true
      } catch (e: Exception) { false }
    }
  }

  private var askedNotes = false
  private fun askNotifications() {
    if (askedNotes || Build.VERSION.SDK_INT < 33) return
    askedNotes = true
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
      runOnUiThread { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7302) }
  }

  companion object {
    private var current: WeakReference<MainActivity>? = null
    /** Notification buttons → play.js (ChironPlay.remote). */
    fun relay(action: String) {
      val a = current?.get() ?: return
      val cmd = when (action) { PlaybackService.ACTION_NEXT -> "next"; PlaybackService.ACTION_PREV -> "prev"; else -> "toggle" }
      a.runOnUiThread { a.web?.evaluateJavascript("window.ChironPlay&&ChironPlay.remote&&ChironPlay.remote('$cmd')", null) }
    }
  }
}
