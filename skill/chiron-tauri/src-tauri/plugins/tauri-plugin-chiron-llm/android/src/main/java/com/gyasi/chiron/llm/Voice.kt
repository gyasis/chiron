package com.gyasi.chiron.llm

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Offline-first Android SpeechRecognizer + TextToSpeech. SpeechRecognizer must live on the main thread. */
internal class Voice(private val ctx: Context) {
    private val main = Handler(Looper.getMainLooper())
    private var rec: SpeechRecognizer? = null
    private var sttFinish: ((Map<String, Any>?, String?) -> Unit)? = null

    private var tts: TextToSpeech? = null
    @Volatile private var ttsReady = false
    @Volatile private var ttsInitError: String? = null
    private val ttsWaiters = ConcurrentHashMap<String, (String?) -> Unit>()

    private fun locale(tag: String): Locale = Locale.forLanguageTag(tag.replace('_', '-'))

    fun sttAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(ctx)
    fun sttOnDevice(): Boolean = Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)

    // ---------------- STT ----------------
    fun listen(lang: String, preferOffline: Boolean, emit: (Map<String, Any>) -> Unit, finish: (Map<String, Any>?, String?) -> Unit) {
        main.post {
            try {
                teardownStt()
                if (!sttAvailable()) {
                    finish(null, "Nessun servizio di riconoscimento vocale sul telefono (installa/abilita 'Servizi vocali di Google').")
                    return@post
                }
                var onDevice = false
                val r = if (preferOffline && sttOnDevice()) {
                    onDevice = true
                    SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx)
                } else {
                    SpeechRecognizer.createSpeechRecognizer(ctx)
                }
                rec = r
                sttFinish = finish
                var lastRms = 0L
                r.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(p: Bundle?) { emit(mapOf("type" to "ready", "onDevice" to onDevice, "lang" to lang)) }
                    override fun onBeginningOfSpeech() { emit(mapOf("type" to "speech")) }
                    override fun onRmsChanged(rms: Float) {
                        val now = System.currentTimeMillis()
                        if (now - lastRms > 120) { lastRms = now; emit(mapOf("type" to "level", "rms" to rms.toDouble())) }
                    }
                    override fun onBufferReceived(b: ByteArray?) {}
                    override fun onEndOfSpeech() { emit(mapOf("type" to "end")) }
                    override fun onEvent(t: Int, p: Bundle?) {}
                    override fun onPartialResults(p: Bundle?) {
                        val t = p?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                        if (t.isNotEmpty()) emit(mapOf("type" to "partial", "text" to t))
                    }
                    override fun onResults(p: Bundle?) {
                        val list = p?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                        val text = list.firstOrNull().orEmpty()
                        Log.i(TAG, "stt final (${lang}, onDevice=$onDevice): '${text.take(80)}'")
                        val f = sttFinish; teardownStt()
                        f?.invoke(mapOf("text" to text, "onDevice" to onDevice, "lang" to lang), null)
                    }
                    override fun onError(code: Int) {
                        val msg = sttErrorText(code, lang, onDevice)
                        Log.w(TAG, "stt error $code ($msg)")
                        val f = sttFinish; teardownStt()
                        // NO_MATCH / SPEECH_TIMEOUT are "nothing heard", not failures: resolve with empty text
                        if (code == SpeechRecognizer.ERROR_NO_MATCH || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)
                            f?.invoke(mapOf("text" to "", "onDevice" to onDevice, "lang" to lang, "code" to code), null)
                        else f?.invoke(null, "[$code] $msg")
                    }
                })
                val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                }
                r.startListening(i)
            } catch (e: Exception) {
                Log.e(TAG, "stt start failed", e)
                val f = sttFinish; teardownStt()
                (f ?: finish).invoke(null, "Riconoscimento vocale non avviato: ${e.message}")
            }
        }
    }

    fun stopListening() { main.post { try { rec?.stopListening() } catch (e: Exception) { Log.w(TAG, "stopListening", e) } } }

    private fun teardownStt() {
        sttFinish = null
        rec?.let { try { it.setRecognitionListener(null); it.cancel(); it.destroy() } catch (e: Exception) { Log.w(TAG, "stt teardown", e) } }
        rec = null
    }

    private fun sttErrorText(code: Int, lang: String, onDevice: Boolean): String = when (code) {
        SpeechRecognizer.ERROR_AUDIO -> "Errore audio del microfono."
        SpeechRecognizer.ERROR_CLIENT -> "Errore del client di riconoscimento (riprova)."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Permesso microfono negato: Impostazioni > App > Chiron > Autorizzazioni."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
            "Serve la rete per questa lingua ($lang): scarica il pacchetto offline in Impostazioni > Google > Riconoscimento vocale offline."
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Il riconoscimento e occupato, riprova tra un attimo."
        SpeechRecognizer.ERROR_SERVER -> "Errore del servizio di riconoscimento."
        13 /* ERROR_LANGUAGE_NOT_SUPPORTED */, 12 /* ERROR_LANGUAGE_UNAVAILABLE */ ->
            "Lingua $lang non disponibile offline: scaricala in Impostazioni > Google > Riconoscimento vocale offline."
        else -> "Errore di riconoscimento vocale ($code${if (onDevice) ", on-device" else ""})."
    }

    // ---------------- TTS ----------------
    private fun ensureTts(timeoutMs: Long): Boolean {
        if (ttsReady) return true
        val latch = CountDownLatch(1)
        main.post {
            if (tts == null) {
                tts = TextToSpeech(ctx) { status ->
                    if (status == TextToSpeech.SUCCESS) ttsReady = true else ttsInitError = "TextToSpeech init status=$status"
                    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(id: String?) {}
                        override fun onDone(id: String?) { ttsWaiters.remove(id)?.invoke(null) }
                        @Deprecated("deprecated in API 21") override fun onError(id: String?) { ttsWaiters.remove(id)?.invoke("errore di sintesi vocale") }
                        override fun onError(id: String?, code: Int) { ttsWaiters.remove(id)?.invoke("errore di sintesi vocale ($code)") }
                        override fun onStop(id: String?, interrupted: Boolean) { ttsWaiters.remove(id)?.invoke("stopped") }
                    })
                    latch.countDown()
                }
            } else latch.countDown()
        }
        latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        return ttsReady
    }

    /** Tri-state per language: true = voice installed, false = missing/unsupported, null = engine not ready. */
    fun ttsHas(tag: String): Boolean? {
        if (!ensureTts(3000)) return null
        val r = tts?.isLanguageAvailable(locale(tag)) ?: return null
        return r >= TextToSpeech.LANG_AVAILABLE
    }

    /** Speaks [text]; [done] gets null on natural end, "stopped" when interrupted, else an error message. */
    fun speak(text: String, lang: String, done: (String?) -> Unit) {
        if (!ensureTts(4000)) { done(ttsInitError ?: "Sintesi vocale non pronta (nessun motore TTS installato?)"); return }
        val t = tts ?: run { done("Sintesi vocale non disponibile"); return }
        val r = t.setLanguage(locale(lang))
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
            done("Voce $lang non installata: Impostazioni > Sistema > Lingue > Sintesi vocale, scarica la voce.")
            return
        }
        val id = UUID.randomUUID().toString()
        ttsWaiters[id] = done
        val max = TextToSpeech.getMaxSpeechInputLength()
        val rc = t.speak(text.take(max), TextToSpeech.QUEUE_FLUSH, null, id)
        if (rc != TextToSpeech.SUCCESS) { ttsWaiters.remove(id); done("speak() ha risposto $rc") }
    }

    fun stopSpeaking() { main.post { try { tts?.stop() } catch (e: Exception) { Log.w(TAG, "tts stop", e) } } }

    fun shutdown() {
        main.post { teardownStt(); try { tts?.stop(); tts?.shutdown() } catch (e: Exception) {}; tts = null; ttsReady = false }
    }
}
