@file:OptIn(ExperimentalApi::class)

package com.gyasi.chiron.llm

import android.Manifest
import android.app.Activity
import android.os.SystemClock
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.ExperimentalFlags
import com.google.ai.edge.litertlm.LogSeverity
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import com.google.ai.edge.litertlm.ThinkingConfig
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@InvokeArg class DownloadArgs { var url: String = ""; var sha256: String = ""; var onEvent: Channel? = null }
@InvokeArg class LoadArgs { var backend: String = "gpu" }
@InvokeArg class GenerateArgs { var system: String = ""; var prompt: String = ""; var maxTokens: Int = 0; var onEvent: Channel? = null }
@InvokeArg class ListenArgs { var lang: String = "it-IT"; var preferOffline: Boolean = true; var onEvent: Channel? = null }
@InvokeArg class SpeakArgs { var text: String = ""; var lang: String = "it-IT" }
@InvokeArg class StatusArgs { var verify: Boolean = false }

private fun obj(m: Map<String, Any?>): JSObject {
    val o = JSObject()
    for ((k, v) in m) o.put(k, v)
    return o
}

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")])
class LlmPlugin(private val activity: Activity) : Plugin(activity) {
    private val store = ModelStore(activity.applicationContext)
    private val voice = Voice(activity.applicationContext)

    // Heavy work never runs on the main thread. One lane for model work (load/generate/download are serialized
    // by their own guards), one for voice so a long generate cannot delay a TTS stop.
    private val work = Executors.newCachedThreadPool()

    // ---- engine singleton: loaded ONCE and kept until llm_unload / process death ----
    private val engineLock = Any()
    private var engine: Engine? = null
    private var backendName: String = ""
    private var loadedStamp: String = ""

    private val downloading = AtomicBoolean(false)
    private val cancelDownload = AtomicBoolean(false)
    private val generating = AtomicBoolean(false)
    @Volatile private var activeConv: Conversation? = null

    // ---------------------------------------------------------------- status
    @Command
    fun llmStatus(invoke: Invoke) {
        work.execute {
            try {
                val a = try { invoke.parseArgs(StatusArgs::class.java) } catch (e: Exception) { StatusArgs() }
                val f = store.file
                var ok: Boolean? = store.sha256Ok()
                if (a.verify && f.exists()) Log.i(TAG, "verify requested; sha256=${store.sha256Of(f)}")
                invoke.resolve(obj(mapOf(
                    "downloaded" to f.exists(),
                    "path" to f.path,
                    "size" to (if (f.exists()) f.length() else 0L),
                    "sha256_ok" to ok,
                    "partial_bytes" to store.partBytes(),
                    "free_bytes" to store.freeBytes(),
                    "wifi" to store.wifi(),
                    "downloading" to downloading.get(),
                    "loaded" to (engine != null),
                    "backend" to backendName,
                    "generating" to generating.get(),
                )))
            } catch (e: Exception) { fail(invoke, "llm_status", e) }
        }
    }

    // -------------------------------------------------------------- download
    @Command
    fun llmDownload(invoke: Invoke) {
        val a = invoke.parseArgs(DownloadArgs::class.java)
        if (a.url.isBlank()) { invoke.reject("URL del modello mancante"); return }
        if (!downloading.compareAndSet(false, true)) { invoke.reject("Download gia in corso"); return }
        cancelDownload.set(false)
        work.execute {
            try {
                Log.i(TAG, "download start ${a.url} -> ${store.file.path} (part=${store.partBytes()})")
                val res = store.download(a.url, a.sha256, { cancelDownload.get() }) { ev -> a.onEvent?.send(obj(ev)) }
                invoke.resolve(obj(res))
            } catch (e: ModelStore.Cancelled) {
                invoke.resolve(obj(mapOf("status" to "paused", "partial_bytes" to store.partBytes())))
            } catch (e: Exception) {
                a.onEvent?.send(obj(mapOf("phase" to "error", "message" to (e.message ?: e.toString()))))
                fail(invoke, "llm_download", e)
            } finally { downloading.set(false) }
        }
    }

    @Command
    fun llmDownloadCancel(invoke: Invoke) {
        cancelDownload.set(true)
        invoke.resolve(obj(mapOf("cancelling" to downloading.get())))
    }

    // ------------------------------------------------------------------ load
    @Command
    fun llmLoad(invoke: Invoke) {
        val a = try { invoke.parseArgs(LoadArgs::class.java) } catch (e: Exception) { LoadArgs() }
        work.execute {
            try {
                val f = store.file
                if (!f.exists()) { invoke.reject("Modello non scaricato (${f.path})"); return@execute }
                val stamp = "${f.length()}:${f.lastModified()}"
                synchronized(engineLock) {
                    val cur = engine
                    if (cur != null && loadedStamp == stamp && (a.backend == backendName || a.backend == "auto")) {
                        invoke.resolve(obj(mapOf("backend" to backendName, "load_ms" to 0, "already_loaded" to true)))
                        return@execute
                    }
                    closeEngineLocked()
                    Engine.setNativeMinLogSeverity(LogSeverity.WARNING)
                    ExperimentalFlags.enableBenchmark = true   // gives exact decode tok/s + TTFT per answer
                    val order = if (a.backend == "cpu") listOf("cpu") else listOf("gpu", "cpu")
                    var gpuError: String? = null
                    for (b in order) {
                        val t0 = SystemClock.elapsedRealtime()
                        try {
                            val cfg = EngineConfig(
                                modelPath = f.path,
                                backend = if (b == "gpu") Backend.GPU() else Backend.CPU(),
                                cacheDir = activity.applicationContext.cacheDir.path,
                            )
                            val e = Engine(cfg)
                            e.initialize()
                            engine = e; backendName = b; loadedStamp = stamp
                            val ms = SystemClock.elapsedRealtime() - t0
                            Log.i(TAG, "engine loaded backend=$b in $ms ms (gpuError=$gpuError)")
                            invoke.resolve(obj(mapOf(
                                "backend" to b, "load_ms" to ms, "fell_back" to (b != order.first()),
                                "gpu_error" to gpuError, "already_loaded" to false)))
                            return@execute
                        } catch (e: Throwable) {
                            val msg = "${e.javaClass.simpleName}: ${e.message}"
                            Log.e(TAG, "engine load failed on $b after ${SystemClock.elapsedRealtime() - t0} ms: $msg", e)
                            if (b == "gpu") gpuError = msg else {
                                invoke.reject("Impossibile caricare il modello (${if (gpuError != null) "GPU: $gpuError; " else ""}CPU: $msg)")
                                return@execute
                            }
                        }
                    }
                }
            } catch (e: Throwable) { fail(invoke, "llm_load", e) }
        }
    }

    private fun closeEngineLocked() {
        try { activeConv?.cancelProcess() } catch (e: Throwable) {}
        try { engine?.close() } catch (e: Throwable) { Log.w(TAG, "engine close", e) }
        engine = null; backendName = ""; loadedStamp = ""
    }

    // -------------------------------------------------------------- generate
    @Command
    fun llmGenerate(invoke: Invoke) {
        val a = invoke.parseArgs(GenerateArgs::class.java)
        val ch = a.onEvent
        if (a.prompt.isBlank()) { invoke.reject("Domanda vuota"); return }
        val eng = engine
        if (eng == null) { invoke.reject("Modello non caricato: chiama llm_load prima"); return }
        if (!generating.compareAndSet(false, true)) { invoke.reject("Il modello sta gia rispondendo"); return }
        work.execute {
            var conv: Conversation? = null
            try {
                val cfg = ConversationConfig(
                    systemInstruction = if (a.system.isBlank()) null else Contents.of(a.system),
                    thinkingConfig = ThinkingConfig(enableThinking = false),   // Gemma 4: thinking OFF (quick answers)
                    extraContext = mapOf("enable_thinking" to false),
                    maxOutputToken = if (a.maxTokens > 0) a.maxTokens else null,
                )
                conv = eng.createConversation(cfg)
                activeConv = conv
                val done = CountDownLatch(1)
                val t0 = SystemClock.elapsedRealtime()
                var ttft = -1L
                var chunks = 0
                var thinkChars = 0
                val text = StringBuilder()
                var err: Throwable? = null
                val cancelled = AtomicBoolean(false)
                conv.sendMessageAsync(Contents.of(a.prompt), object : MessageCallback {
                    override fun onMessage(message: Message) {
                        val delta = message.contents.contents.filterIsInstance<Content.Text>().joinToString("") { it.text }
                        thinkChars += message.channels.values.sumOf { it.length }
                        if (delta.isNotEmpty()) {
                            if (ttft < 0) ttft = SystemClock.elapsedRealtime() - t0
                            chunks++
                            text.append(delta)
                            ch?.send(obj(mapOf("type" to "token", "text" to delta)))
                        }
                    }
                    override fun onDone() { done.countDown() }
                    override fun onError(throwable: Throwable) { err = throwable; done.countDown() }
                })
                done.await()
                val total = SystemClock.elapsedRealtime() - t0
                var decTps = -1.0
                var decTok = -1
                var bTtft = -1.0
                try {
                    val bi = conv.getBenchmarkInfo()
                    decTps = bi.lastDecodeTokensPerSecond; decTok = bi.lastDecodeTokenCount; bTtft = bi.timeToFirstTokenInSecond
                } catch (e: Throwable) { Log.w(TAG, "benchmarkInfo unavailable: ${e.message}") }
                val e = err
                if (e != null && !isCancel(e)) {
                    Log.e(TAG, "generate failed after ${total} ms: ${e.message}", e)
                    ch?.send(obj(mapOf("type" to "error", "message" to (e.message ?: e.toString()))))
                    invoke.reject("Generazione fallita: ${e.javaClass.simpleName}: ${e.message}")
                } else {
                    val wasCancelled = e != null
                    val stats = mapOf(
                        "type" to "done", "cancelled" to wasCancelled, "text" to text.toString(),
                        "ttft_ms" to ttft, "total_ms" to total, "chunks" to chunks,
                        "decode_tokens" to decTok, "decode_tok_s" to decTps, "bench_ttft_s" to bTtft,
                        "thinking_chars" to thinkChars, "backend" to backendName)
                    Log.i(TAG, "generate ok: ttft=${ttft}ms total=${total}ms tok/s=$decTps tokens=$decTok chunks=$chunks thinkChars=$thinkChars backend=$backendName")
                    ch?.send(obj(stats))
                    invoke.resolve(obj(stats))
                }
            } catch (e: Throwable) {
                Log.e(TAG, "generate crashed: ${e.message}", e)
                ch?.send(obj(mapOf("type" to "error", "message" to (e.message ?: e.toString()))))
                fail(invoke, "llm_generate", e)
            } finally {
                activeConv = null
                try { conv?.close() } catch (e: Throwable) { Log.w(TAG, "conversation close", e) }
                generating.set(false)
            }
        }
    }

    private fun isCancel(t: Throwable): Boolean {
        val m = (t.message ?: "").lowercase()
        return m.contains("cancel") || m.contains("abort")
    }

    @Command
    fun llmCancel(invoke: Invoke) {
        try { activeConv?.cancelProcess() } catch (e: Throwable) { Log.w(TAG, "cancelProcess", e) }
        invoke.resolve(obj(mapOf("cancelling" to generating.get())))
    }

    @Command
    fun llmUnload(invoke: Invoke) {
        work.execute {
            synchronized(engineLock) { closeEngineLocked() }
            Log.i(TAG, "engine unloaded")
            invoke.resolve(obj(mapOf("loaded" to false)))
        }
    }

    @Command
    fun llmDelete(invoke: Invoke) {
        work.execute {
            try {
                if (downloading.get()) cancelDownload.set(true)
                synchronized(engineLock) { closeEngineLocked() }
                store.delete()
                Log.i(TAG, "model deleted")
                invoke.resolve(obj(mapOf("downloaded" to false)))
            } catch (e: Throwable) { fail(invoke, "llm_delete", e) }
        }
    }

    // ----------------------------------------------------------------- voice
    @Command
    fun voiceStatus(invoke: Invoke) {
        work.execute {
            try {
                invoke.resolve(obj(mapOf(
                    "stt" to mapOf("available" to voice.sttAvailable(), "on_device" to voice.sttOnDevice(),
                        "permission" to (getPermissionState("microphone")?.toString() ?: "unknown")),
                    "tts" to mapOf("it" to voice.ttsHas("it-IT"), "en" to voice.ttsHas("en-US")),
                )))
            } catch (e: Throwable) { fail(invoke, "voice_status", e) }
        }
    }

    @Command
    fun sttListen(invoke: Invoke) {
        if (getPermissionState("microphone")?.toString() != "granted") {
            requestPermissionForAlias("microphone", invoke, "micPermissionDone")
            return
        }
        startListening(invoke)
    }

    @PermissionCallback
    private fun micPermissionDone(invoke: Invoke) {
        if (getPermissionState("microphone")?.toString() == "granted") startListening(invoke)
        else invoke.reject("Permesso microfono negato: Impostazioni > App > Chiron > Autorizzazioni.")
    }

    private fun startListening(invoke: Invoke) {
        val a = invoke.parseArgs(ListenArgs::class.java)
        val ch = a.onEvent
        voice.listen(a.lang, a.preferOffline, { ev -> ch?.send(obj(ev)) }) { res, err ->
            if (err != null) {
                ch?.send(obj(mapOf("type" to "error", "message" to err)))
                invoke.reject(err)
            } else {
                ch?.send(obj(mapOf("type" to "final") + (res ?: emptyMap())))
                invoke.resolve(obj(res ?: emptyMap()))
            }
        }
    }

    @Command
    fun sttStop(invoke: Invoke) { voice.stopListening(); invoke.resolve(obj(mapOf("stopping" to true))) }

    @Command
    fun ttsSpeak(invoke: Invoke) {
        val a = invoke.parseArgs(SpeakArgs::class.java)
        if (a.text.isBlank()) { invoke.resolve(obj(mapOf("status" to "empty"))); return }
        work.execute {
            voice.speak(a.text, a.lang) { err ->
                when (err) {
                    null -> invoke.resolve(obj(mapOf("status" to "done")))
                    "stopped" -> invoke.resolve(obj(mapOf("status" to "stopped")))
                    else -> invoke.reject(err)
                }
            }
        }
    }

    @Command
    fun ttsStop(invoke: Invoke) { voice.stopSpeaking(); invoke.resolve(obj(mapOf("stopping" to true))) }

    override fun onDestroy() {
        synchronized(engineLock) { closeEngineLocked() }
        voice.shutdown()
        super.onDestroy()
    }

    private fun fail(invoke: Invoke, what: String, e: Throwable) {
        Log.e(TAG, "$what failed: ${e.message}", e)
        invoke.reject("${e.message ?: e.javaClass.simpleName}")
    }
}
