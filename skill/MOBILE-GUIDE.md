# Chiron on your phone — the complete guide

How to get Chiron lessons onto a phone and use them offline. There are **two
apps** (pick either) and **one way to load lessons** into them.

```
generate a lesson ─▶ bundle to .chiron ─▶ serve over LAN ─▶ phone downloads
                                                              └▶ open in Chiron app ─▶ + Add lesson ─▶ plays offline
```

Lesson content is **imported on the device and never uploaded** — only the empty
app shell is ever public.

---

## 1. The two apps

### A) PWA (web app) — zero install friction
- **URL:** https://gyasi.github.io/chiron/
- On the phone: open that URL → **Share → Add to Home Screen** → it installs as
  the navy-centaur **Chiron** app (fullscreen, offline-capable).
- Auto-deploys: any push to `main` touching `skill/player/` rebuilds Pages
  (`.github/workflows/pages.yml`). Nothing to do manually.
- Best for: quick use, always-latest, no sideloading.

### B) Native Android app (Tauri) — true native, no browser chrome
- Built from `skill/chiron-tauri/` (see its `README.md` for the build).
  Produces an APK (~arm64) you sideload.
- On the phone: download the APK → allow **"install unknown apps"** → install →
  open **Chiron**.
- Best for: a real app icon with no URL bar, native file handling.
- Difference under the hood: the PWA serves imported lessons via a service
  worker; the native app uses a Rust `lesson://` protocol (service workers don't
  run in Tauri's webview). Same lessons, same `.chiron` files.

Either app keeps imported lessons in a **library** — import once, they persist
offline across launches.

---

## 2. Make a lesson portable — bundle to `.chiron`

A generated lesson is a folder (`lesson.html` + `audio/` + `themes/`). Bundle it:

```bash
bash skill/scripts/bundle-lesson.sh <lesson-dir> [out.chiron] [--domain language-it|medicine|code]
```

This **auto-makes the lesson mobile-responsive** at bundle time (idempotent):
hamburger drawer + footer audio player, stacked-card vocab tables (language),
and an overflow clamp so nothing side-scrolls. It also writes the `chiron/1`
manifest. Output defaults to `<lesson-dir>/<name>.chiron`. (`--no-fix` skips the
mobile fixes; see `CHIRON-FORMAT.md` for the format.)

A `.chiron` is just a ZIP — the app accepts `.chiron` **and** `.zip`.

---

## 3. Get the `.chiron` onto the phone (LAN download)

There's no AirDrop from Linux to a phone, so serve the files over the local
network and download them in the phone's browser.

```bash
# put the .chiron files in one folder and serve it on the LAN
mkdir -p /tmp/chiron-share
cp <lesson>.chiron /tmp/chiron-share/
cd /tmp/chiron-share && python3 -m http.server 8770 --bind 0.0.0.0
```

Find this machine's LAN address (the phone must be on the **same Wi-Fi**):
```bash
ip -4 -o addr show scope global   # use the en*/eth*/wlan* line, e.g. 192.168.0.146
#                                    (ignore docker br-* / tun0 VPN lines)
```

On the phone, open **`http://<LAN-IP>:8770`** → tap a lesson → it downloads to
Files/Downloads. Plain HTTP is fine here — it's just a file download (the *app*
is the part that needs HTTPS, and that's GitHub Pages).

> Tip: a tiny `index.html` in the share folder with big tap-targets beats the
> default directory listing on a phone.

---

## 4. Import it into the app

1. Open **Chiron** (PWA or native).
2. **+ Add lesson**.
3. Pick the `.chiron` you just downloaded (Files → Downloads).
   - Android may not pre-filter `.chiron` (unknown MIME) — the picker shows all
     files; just select it. The app validates it's a real lesson.
4. It opens and plays — **offline from now on**, kept in your library.
5. In a lesson: **swipe back / Android back → returns to the library** (doesn't
   exit the app). Remove a lesson with the **×** on its card.

---

## 5. Publishing the PWA (one-time / maintenance)

Already set up. For reference:
- `skill/player/` is the PWA (static: `index.html`, `app.js`, `sw.js`,
  `manifest.webmanifest`, `vendor/fflate.min.js`, `icons/`).
- `.github/workflows/pages.yml` publishes it to `https://gyasi.github.io/chiron/`
  on every push that touches `skill/player/`.
- To run/test it locally: `bash skill/player/serve.sh` → `http://localhost:8765`.

---

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Lesson makes you **zoom out** on the phone | Lesson built before the mobile layer. Re-bundle it — `bundle-lesson.sh` now auto-fixes responsiveness. |
| `.chiron` **greyed out** in the file picker | Android maps extension filters to MIME; `.chiron` has none. The app opens the picker **unfiltered** — select it anyway. |
| **Chrome/URL bar** shows in the app | That's the PWA opened in a normal tab — use **Add to Home Screen**, or the native app (no chrome). |
| Phone **can't reach** the LAN server | Same Wi-Fi? Right IP (en*/wlan*, not docker/VPN)? A VPN on this box can interfere. |
| Imported the **same lesson twice** | No dedup yet — two cards appear; delete one with **×**. |
| Native app: lesson **won't open / no audio** | Reinstall the latest APK — the native `lesson://` engine + `content://` byte-read fix must be present. |

---

## Reference
- `CHIRON-FORMAT.md` — the `.chiron/1` file format.
- `chiron-tauri/README.md` — building the native Android app + gotchas.
- `player/README.md` — how the PWA's offline engine works.
- Recipe (global): `~/.claude/recipes/chiron-serve-lesson-to-phone.md`.
