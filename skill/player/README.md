# Chiron Player — the installable "light wrapper"

A tiny PWA that turns Chiron lessons into a **tap-to-open, offline library** on
your phone — no manual unzipping, no hunting for `lesson.html`. You install it
once (home-screen icon, fullscreen), then import `.chiron` bundles into it.

## Why this exists

A raw `.chiron.zip` works, but "extract the zip → find lesson.html → tap it" is
developer UX, not consumer UX. This wrapper fixes that: tap **Add lesson**, pick
a `.chiron` once, and it opens instantly and stays in your library — fully
offline, content never leaves the device.

## How it works (the one clever bit)

A **service worker acts as a local server** for imported lessons. On import,
`app.js` unzips the `.chiron` in-app (fflate) and writes every file into the
`chiron-lessons-v1` cache under `lessons/<id>/…`. The service worker then serves
those paths, so a lesson runs *exactly as if hosted over HTTP* — relative
`styles.css`, `main.js`, `audio/*.mp3`, and `audio/manifest.json` all resolve.
That sidesteps every `file://` limitation (no blocked `fetch`, no broken audio).

```
.chiron (zip)  ──import──▶  fflate unzip  ──▶  Cache: lessons/<id>/*
                                                   │
   iframe ◀── service worker serves lessons/<id>/… ┘   (works offline)
```

## Files

| File | Role |
|---|---|
| `index.html` | App shell — library list + viewer |
| `app.js` | Import / unzip / cache / library / open lesson |
| `sw.js` | Service worker — offline shell + local lesson server |
| `manifest.webmanifest` | PWA metadata (name, icons, standalone) |
| `vendor/fflate.min.js` | In-app unzip (32 KB) |
| `icons/` | App icons (192/512/maskable/apple-touch) |
| `serve.sh` | Local dev server (`bash serve.sh [port]`) |

## Run it locally (dev)

```bash
bash serve.sh            # → http://localhost:8765/
```
A service worker needs a secure context — `http://localhost` counts, `file://`
does not.

## Get it onto a phone

The player is just static files. For a real install you need it on **HTTPS**
(iOS only offers "Add to Home Screen" over https):

- **GitHub Pages** (simplest): push `player/` to a repo, enable Pages, open the
  URL on the phone → Share → Add to Home Screen.
- **Any static host** works — it's HTML/JS/PNG, no backend.

Then: get a `.chiron` onto the phone (AirDrop / iCloud / download), open the
installed **Chiron** app → **Add lesson** → pick the file. Done — offline from
then on.

## Make a `.chiron` to import

```bash
bash ../scripts/bundle-lesson.sh <lesson-dir>     # → <name>.chiron.zip
```

(The `.chiron.zip` and `.zip` extensions are both accepted by the importer.)

## Verified

End-to-end in real Chrome: SW registers → `.chiron` imports & unzips → SW serves
the lesson with correct mime types → `audio/manifest.js` global executes → mp3 is
served and **decodable** → library persists across reloads (offline). The final
on-device install + feel is yours to confirm on the actual phone (the meta-rule:
real device is ground truth).
