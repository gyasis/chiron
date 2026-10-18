package com.gyasi.chiron

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

/* PlaybackService — keeps Chiron alive while the Ascolta player plays with the screen off / the Fold closed.
 * The audio itself stays in the WebView's <audio> element; this foreground service (type mediaPlayback) only stops Android
 * from freezing the process, holds a partial wake lock + Wi-Fi lock (clips stream from the LAN), and shows a MediaStyle
 * notification backed by a MediaSession: the media card in the shade and on the lock screen, plus headset/Bluetooth buttons.
 * Every control (Indietro / Pausa|Riprendi / Avanti) is relayed back to play.js. Started/stopped by MainActivity's ChironAudio JS bridge. */
class PlaybackService : Service() {
  private var wake: PowerManager.WakeLock? = null
  private var wifi: WifiManager.WifiLock? = null
  private var session: MediaSession? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> { stopSelf(); return START_NOT_STICKY }
      ACTION_TOGGLE, ACTION_NEXT, ACTION_PREV -> { MainActivity.relay(intent.action!!); return START_NOT_STICKY }
    }
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Chiron"
    val paused = intent?.getBooleanExtra(EXTRA_PAUSED, false) ?: false
    updateSession(title, paused)
    val n = notification(title, paused)
    try {
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      else startForeground(NOTE_ID, n)
    } catch (e: Exception) { Log.w(TAG, "startForeground refused: ${e.message}"); stopSelf(); return START_NOT_STICKY }
    if (wake == null) wake = (getSystemService(Context.POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "chiron:playback").apply { setReferenceCounted(false); acquire(4 * 60 * 60 * 1000L) }
    if (wifi == null) wifi = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
      .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "chiron:playback").apply { setReferenceCounted(false); acquire() }
    Log.i(TAG, (if (paused) "paused: " else "playing: ") + title)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wake?.let { if (it.isHeld) it.release() }; wake = null
    wifi?.let { if (it.isHeld) it.release() }; wifi = null
    session?.run { isActive = false; release() }; session = null
    Log.i(TAG, "stopped")
    super.onDestroy()
  }

  private fun updateSession(title: String, paused: Boolean) {
    val ms = session ?: MediaSession(this, "chiron-ascolta").also { m ->
      m.setCallback(object : MediaSession.Callback() {
        override fun onPlay() = MainActivity.relay(ACTION_TOGGLE)
        override fun onPause() = MainActivity.relay(ACTION_TOGGLE)
        override fun onSkipToNext() = MainActivity.relay(ACTION_NEXT)
        override fun onSkipToPrevious() = MainActivity.relay(ACTION_PREV)
      })
      session = m
    }
    ms.setMetadata(MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_TITLE, title)
      .putString(MediaMetadata.METADATA_KEY_ARTIST, "Chiron · Ascolta").build())
    ms.setPlaybackState(PlaybackState.Builder()
      .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
        PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS)
      .setState(if (paused) PlaybackState.STATE_PAUSED else PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
      .build())
    ms.isActive = true
  }

  private fun notification(title: String, paused: Boolean): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Ascolta", NotificationManager.IMPORTANCE_LOW))
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    fun act(a: String, rc: Int) = PendingIntent.getService(this, rc, Intent(this, PlaybackService::class.java).setAction(a), flags)
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), flags)
    @Suppress("DEPRECATION")
    val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
    @Suppress("DEPRECATION")
    return b.setSmallIcon(if (paused) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
      .setContentTitle(title).setContentText(if (paused) "Chiron · Ascolta · in pausa" else "Chiron · Ascolta")
      .setContentIntent(open).setOngoing(true).setVisibility(Notification.VISIBILITY_PUBLIC)
      .addAction(Notification.Action.Builder(android.R.drawable.ic_media_previous, "Indietro", act(ACTION_PREV, 3)).build())
      .addAction(Notification.Action.Builder(if (paused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause,
        if (paused) "Riprendi" else "Pausa", act(ACTION_TOGGLE, 1)).build())
      .addAction(Notification.Action.Builder(android.R.drawable.ic_media_next, "Avanti", act(ACTION_NEXT, 2)).build())
      .setStyle(Notification.MediaStyle().setMediaSession(session?.sessionToken).setShowActionsInCompactView(0, 1, 2))
      .build()
  }

  companion object {
    const val TAG = "ChironPlayback"
    const val CHANNEL = "chiron-ascolta"
    const val NOTE_ID = 7301
    const val EXTRA_TITLE = "title"
    const val EXTRA_PAUSED = "paused"
    const val ACTION_STOP = "com.gyasi.chiron.STOP"
    const val ACTION_TOGGLE = "com.gyasi.chiron.TOGGLE"
    const val ACTION_NEXT = "com.gyasi.chiron.NEXT"
    const val ACTION_PREV = "com.gyasi.chiron.PREV"
  }
}
