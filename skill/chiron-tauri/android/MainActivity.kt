package com.gyasi.chiron

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
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
