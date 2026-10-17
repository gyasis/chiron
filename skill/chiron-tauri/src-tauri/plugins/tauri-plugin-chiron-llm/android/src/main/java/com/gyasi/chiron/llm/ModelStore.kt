package com.gyasi.chiron.llm

import android.content.Context
import android.net.ConnectivityManager
import android.os.SystemClock
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

internal const val TAG = "ChironLLM"

/** The .litertlm on disk: location, resumable download, sha256 verification. */
internal class ModelStore(private val ctx: Context) {
    companion object {
        const val FILE_NAME = "gemma-4-E2B-it.litertlm"
        private const val BUF = 256 * 1024
    }

    // App-specific external dir (/sdcard/Android/data/<pkg>/files): needs no permission, `adb push` can reach it,
    // and it is removed with the app. Falls back to internal storage when no external volume is mounted.
    val dir: File get() = ctx.getExternalFilesDir(null) ?: ctx.filesDir
    val file: File get() = File(dir, FILE_NAME)
    private val part: File get() = File(dir, "$FILE_NAME.part")
    private val marker: File get() = File(dir, "$FILE_NAME.verified")

    fun wifi(): Boolean = try {
        !(ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered
    } catch (e: Exception) { false }

    fun freeBytes(): Long = try { dir.usableSpace } catch (e: Exception) { -1 }

    /** true = sha256 verified for exactly this file (size+mtime), false = known-bad, null = never verified (e.g. adb push). */
    fun sha256Ok(): Boolean? {
        val f = file
        if (!f.exists()) return null
        val m = try { marker.readText().trim() } catch (e: Exception) { return null }
        return if (m == "${f.length()}:${f.lastModified()}") true else null
    }

    fun partBytes(): Long = if (part.exists()) part.length() else 0L

    fun delete() {
        for (f in listOf(file, part, marker)) if (f.exists() && !f.delete()) Log.w(TAG, "could not delete ${f.path}")
    }

    fun sha256Of(f: File, onProgress: ((Long, Long) -> Unit)? = null): String {
        val md = MessageDigest.getInstance("SHA-256")
        val buf = ByteArray(BUF)
        val total = f.length()
        var done = 0L
        var last = 0L
        FileInputStream(f).use { ins ->
            while (true) {
                val n = ins.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
                done += n
                val now = SystemClock.elapsedRealtime()
                if (onProgress != null && now - last > 250) { onProgress(done, total); last = now }
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    class Cancelled : Exception("download paused")

    /**
     * Resumable download (HTTP Range) into <file>.part, sha256 verified, then atomically renamed.
     * [cancel] is polled between chunks; the .part is kept so a later call resumes.
     * Returns a map of facts for JS; throws IllegalStateException with an actionable message.
     */
    fun download(url: String, sha256: String, cancel: () -> Boolean, emit: (Map<String, Any>) -> Unit): Map<String, Any> {
        dir.mkdirs()
        val want = sha256.trim().lowercase()
        if (file.exists() && want.isNotEmpty() && sha256Ok() == true) {
            return mapOf("status" to "already", "size" to file.length())
        }
        var have = partBytes()
        val t0 = SystemClock.elapsedRealtime()
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = true
            if (have > 0) setRequestProperty("Range", "bytes=$have-")
        }
        try {
            val code = try { conn.responseCode } catch (e: Exception) {
                throw IllegalStateException("Server non raggiungibile ($url): ${e.message}. Il Mac/Razer e acceso e sul Wi-Fi?")
            }
            var total: Long
            when (code) {
                206 -> {
                    // Content-Range: bytes START-END/TOTAL
                    total = conn.getHeaderField("Content-Range")?.substringAfter('/')?.toLongOrNull() ?: (have + conn.contentLengthLong)
                }
                200 -> {
                    if (have > 0) { Log.i(TAG, "server ignored Range, restarting from 0"); have = 0 }
                    total = conn.contentLengthLong
                }
                416 -> {
                    // our .part is already >= the file: treat as complete, verification below decides
                    total = have
                    Log.i(TAG, "HTTP 416 with part=$have: assuming complete, verifying")
                    return finish(want, total, emit)
                }
                else -> throw IllegalStateException("Download HTTP $code da $url (manca models/gemma-4-E2B-it.litertlm sul server?)")
            }
            if (total <= 0) throw IllegalStateException("Il server non ha dichiarato la dimensione del file ($url)")
            val need = total - have
            val free = freeBytes()
            if (free in 0 until need + 64L * 1024 * 1024) {
                throw IllegalStateException("Spazio insufficiente: servono ${need / 1048576} MB, liberi ${free / 1048576} MB")
            }
            emit(mapOf("phase" to "download", "received" to have, "total" to total, "bps" to 0))
            val buf = ByteArray(BUF)
            var got = have
            var lastEmit = 0L
            var windowStart = SystemClock.elapsedRealtime()
            var windowBytes = 0L
            var bps = 0L
            RandomAccessFile(part, "rw").use { raf ->
                if (have == 0L) raf.setLength(0)
                raf.seek(have)
                conn.inputStream.use { ins ->
                    while (true) {
                        if (cancel()) { emit(mapOf("phase" to "paused", "received" to got, "total" to total)); throw Cancelled() }
                        val n = ins.read(buf)
                        if (n < 0) break
                        raf.write(buf, 0, n)
                        got += n; windowBytes += n
                        val now = SystemClock.elapsedRealtime()
                        if (now - windowStart >= 1000) { bps = windowBytes * 1000 / (now - windowStart); windowStart = now; windowBytes = 0 }
                        if (now - lastEmit > 250) {
                            emit(mapOf("phase" to "download", "received" to got, "total" to total, "bps" to bps))
                            lastEmit = now
                        }
                    }
                }
            }
            if (got < total) throw IllegalStateException("Download interrotto a $got/$total byte: premi Riprendi per continuare")
            Log.i(TAG, "downloaded ${got} bytes in ${SystemClock.elapsedRealtime() - t0} ms")
            return finish(want, total, emit)
        } finally {
            conn.disconnect()
        }
    }

    private fun finish(want: String, total: Long, emit: (Map<String, Any>) -> Unit): Map<String, Any> {
        if (part.length() != total) throw IllegalStateException("File parziale: ${part.length()} di $total byte")
        emit(mapOf("phase" to "verify", "received" to 0L, "total" to total))
        val got = sha256Of(part) { d, t -> emit(mapOf("phase" to "verify", "received" to d, "total" to t)) }
        if (want.isNotEmpty() && got != want) {
            part.delete()
            Log.e(TAG, "sha256 mismatch: got $got want $want")
            throw IllegalStateException("Controllo sha256 fallito (atteso ${want.take(12)}…, ottenuto ${got.take(12)}…): file scartato, riprova")
        }
        file.delete()
        if (!part.renameTo(file)) throw IllegalStateException("Impossibile rinominare il file scaricato in ${file.path}")
        if (want.isNotEmpty()) marker.writeText("${file.length()}:${file.lastModified()}")
        emit(mapOf("phase" to "done", "received" to total, "total" to total))
        return mapOf("status" to "ok", "size" to total, "sha256" to got, "sha256_checked" to want.isNotEmpty())
    }
}
