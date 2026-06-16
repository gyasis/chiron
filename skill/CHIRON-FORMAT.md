# The `.chiron` format (chiron/1)

A `.chiron` file is a **ZIP archive** containing a single self-contained lesson.
The extension is `.chiron`; the bytes are a normal zip, so the Chiron app accepts
`.chiron` **and** `.zip` interchangeably and always reads them as a zip.

## Layout

```
<bundle>.chiron  (zip)
├── chiron.json        REQUIRED — the manifest (see below)
├── lesson.html        REQUIRED — the entry document (or index.html)
├── audio/             OPTIONAL — voiced lessons
│   ├── manifest.js        sets window.__chironAudioManifest (file:// global)
│   ├── manifest.json      same data for HTTP/native loaders
│   └── <kind>/<id>.mp3     section / dialogue / phrase / story / summary clips
├── themes/            OPTIONAL — *.css the lesson references
└── …                  any other sibling assets the lesson references (relative paths)
```

Paths are **relative to the zip root** (no wrapping top-level folder). The entry
HTML references its siblings relatively (`styles`/`audio/x.mp3`/`themes/x.css`),
which is what lets a host (service worker, or the native `lesson://` protocol)
serve the lesson as if over HTTP.

## `chiron.json` (the manifest)

```json
{
  "format": "chiron/1",
  "title": "Al bar, al ristorante, il conto",
  "entry": "lesson.html",
  "domain": "language-it",
  "created": "2026-06-13",
  "audioClips": 44,
  "generator": "chiron"
}
```

| field | meaning |
|---|---|
| `format` | magic + version. MUST be `"chiron/1"`. A reader validates this. |
| `title` | display name for the library (falls back to the HTML `<title>`). |
| `entry` | the HTML to open (default `lesson.html`). |
| `domain` | `code` / `medicine` / `language-it` / … (optional, `""` if unknown). |
| `created` | ISO date the bundle was made. |
| `audioClips` | number of mp3 clips (0 = text-only). |
| `generator` | tool that produced it (`chiron`). |

A reader SHOULD prefer `chiron.json` for metadata and fall back to scraping the
HTML `<title>` if the manifest is absent (older bundles predate the manifest).

## Producing one

```bash
bash skill/scripts/bundle-lesson.sh <lesson-dir> [out.chiron] [--domain language-it]
```
Writes `chiron.json` into the lesson dir, then zips (excluding runtime state +
build inputs). Output defaults to `<lesson-dir>/<name>.chiron`.

## Consuming one

- **PWA player** (`skill/player`, on a phone via GitHub Pages): import → unzipped
  in-browser (fflate) into Cache Storage → served by a service worker.
- **Native app** (`skill/chiron-tauri`): import → unzipped natively (Rust) into
  app data → served via the `lesson://` custom protocol (service workers don't
  work in Tauri's webview).

## Not yet (roadmap)

- A registered **MIME type** (`application/x-chiron`) + **Android file
  association**, so tapping a `.chiron` in Files opens it directly in Chiron
  (instead of import-from-within-the-app). Needs an intent-filter + URI intake.
