# Chiron — native Tauri app (Android prototype)

A native wrapper around the Chiron player (`../player`) for a real installable
app with no browser chrome. Because service workers don't run in Tauri's
(wry) webview, lessons are served **natively**: `import_lesson` unzips a
`.chiron` into app storage and a `lesson://` custom protocol (Rust) serves it —
replacing the player's service-worker engine. The frontend (`../player/app.js`)
branches into this mode when `window.__TAURI__` is present.

## Layout (what's committed)
```
package.json              local @tauri-apps/cli (REQUIRED — see gotcha below)
src-tauri/
  Cargo.toml, Cargo.lock  Rust deps (tauri, dialog + fs plugins, zip, mime_guess)
  src/lib.rs              lesson:// protocol + import_lesson/list_lessons/delete_lesson
  tauri.conf.json         frontendDist=../../player, withGlobalTauri, identifier
  capabilities/           dialog + fs permissions
  icons/                  navy centaur app icons
```
`node_modules/`, `src-tauri/target/`, `src-tauri/gen/` are gitignored (multi-GB).

## Build (Android)
Prereqs: Rust + Android targets (`rustup target add aarch64-linux-android …`),
Android SDK + NDK (`ANDROID_HOME`, `NDK_HOME`), JDK 17+.
```bash
npm install                      # local @tauri-apps/cli
npm run tauri android init       # regenerates src-tauri/gen/ (gitignored)
npm run tauri android build --debug --apk --target aarch64
# → src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

## Gotchas (learned the hard way)
- **`node tauri` runner bug:** if `android init` ran without a local
  `@tauri-apps/cli`, the generated `gen/android/buildSrc/.../BuildTask.kt` calls
  `node tauri …` and fails (`Cannot find module .../src-tauri/tauri`). Fix: keep
  the local `@tauri-apps/cli` (package.json) and re-init; if it persists, point
  that task's args at `node_modules/@tauri-apps/cli/tauri.js`.
- **Android file import returns a `content://` URI**, not a path — read its bytes
  on the JS side via the **fs plugin** (`window.__TAURI__.fs.readFile`) and pass
  them to `import_lesson(data)`. `std::fs::read` on the URI fails.
- **No file-picker MIME filter** — Android greys out `.chiron` (unknown MIME), so
  the dialog opens unfiltered; Rust validates it's a real zip on import.
- NDK r30-beta worked for the Rust cross-compile; a stable NDK (r26/r27) is safer.
- **Audio/video won't play unless the `lesson://` handler supports HTTP Range (BLOCKING).**
  webkit2gtk (wry) media elements issue a `Range:` request and **refuse to play a plain `200`
  full-body response**. The handler MUST parse `Range: bytes=start-end` and return **`206 Partial
  Content`** with `Content-Range` + `Accept-Ranges: bytes` (and `Accept-Ranges` on the `200` too).
  Symptom: lesson HTML + Listen buttons render fine, but no sound. Fixed in `src/lib.rs`
  (`parse_range` + the 206 branch), 2026-06-24.

## Web-parity screens (mobile/extras.js, mobile/tutor-panel.js)
The phone covers the web library + tutor extras over the same chiron-server routes:
- **Tutor panel** — select text in a lesson (streamed lessons report it through `shell/select-report.js`, injected by the
  server next to `scene-report.js`; offline copies use the manual "✎ Evidenzia" box) → numbered highlights → ⭐ `/capture`,
  cards/quiz/drill/lesson via `/captures/cards`, real images (`:8912 /images`, `/images/keep`), "Dove si testa" pills
  (`:8912 /related`), and per-answer deep tools (`:8912 /decompose` → `/mcqs` `/train` `/cards`).
- **Captures** (drawer) — `/captures`, delete, cards/quiz/lesson from a capture.
- **Activity** — cancel, clear failed, pause/resume + provider rotation (`/gen/*`), step-by-step job detail (`/jobs/{slug}/steps|recovery`).
- **Generate** — grounding notes, "skip audio bake" (`stage: audio`), select + batch generate, "generate next N".
- **Audio** — bake one / batch / all with engine choice + cost estimate (`/bake*`); lesson ⋯ menu: regenerate, corpus status.
The https hub (`chiron-https-serve`) only proxies some of these routes; on the plain-http LAN address all of them work.

## ⚡ Veloce — on-device tutor (plugin `chiron-llm`)
`src-tauri/plugins/tauri-plugin-chiron-llm` (Rust shim + Kotlin `LlmPlugin`) runs **Gemma 4 E2B (`.litertlm`) on the phone**
with Google **LiteRT-LM** (`com.google.ai.edge.litertlm:litertlm-android:0.18.0`, GPU first, CPU fallback). The Engine is
loaded once and kept; each question is a fresh Conversation (thinking OFF). Logcat tag `ChironLLM`.
- Commands (`window.__TAURI__.core.invoke('plugin:chiron-llm|<cmd>')`): `llm_status`, `llm_download` (Channel progress,
  resumable HTTP Range → `<file>.part`, sha256, atomic rename), `llm_download_cancel`, `llm_load`, `llm_generate` (Channel
  tokens), `llm_cancel`, `llm_unload`, `llm_delete`; voice: `voice_status`, `stt_listen`/`stt_stop` (SpeechRecognizer, it-IT/en-US,
  prefers on-device, partial results), `tts_speak`/`tts_stop` (TextToSpeech).
- Model file: `<getExternalFilesDir>/gemma-4-E2B-it.litertlm` (`/sdcard/Android/data/com.gyasi.chiron/files/`; `adb push` works for a dev loop).
- Hosting: the Razer serves `~/Documents/generated/models/` on :8910 (`gemma-4-E2B-it.litertlm` + `manifest.json`
  `{name,file,size,sha256}`). The app reads `http://<LIB host>:8910/models/manifest.json`; override in localStorage `chiron.llm.url`
  (the ✎ Indirizzo button on the download card).
- Grounding: `GET :8912/lesson-text/<slug>?q=&cap=&t=&scene=` (tutor_server) for streamed lessons; the `lesson_text` Rust command
  for saved copies. Panel: `mobile/tutor-panel.js` (⚡ Veloce / 🧠 Approfondita switch, download card, "🧠 Chiedi meglio").

## Roadmap
- Read `chiron.json` (chiron/1 manifest) for title/domain instead of scraping `<title>`.
- Register `.chiron` as an Android file association (intent-filter) so tapping a
  `.chiron` in Files opens it straight in Chiron.
- iOS target (Tauri mobile supports it) + a signed release build (smaller APK).
