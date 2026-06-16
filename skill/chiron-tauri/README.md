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

## Roadmap
- Read `chiron.json` (chiron/1 manifest) for title/domain instead of scraping `<title>`.
- Register `.chiron` as an Android file association (intent-filter) so tapping a
  `.chiron` in Files opens it straight in Chiron.
- iOS target (Tauri mobile supports it) + a signed release build (smaller APK).
