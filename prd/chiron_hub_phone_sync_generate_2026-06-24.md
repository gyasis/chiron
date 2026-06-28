# Chiron Hub — LAN home hub, phone sync, on-device generate PRD

**Date:** 2026-06-24
**Status:** DRAFT — design confirmed with the user (LAN home hub; phased). Build Phase 1 first.
**Owner:** Gyasi Sutton (solo)
**Related:** [`chiron_lesson_scope_and_reuse_2026-06-24.md`](./chiron_lesson_scope_and_reuse_2026-06-24.md) (library.yaml + the Library app), `skill/player` (PWA import/offline/delete-local engine), `skill/library` (faceted Library UI), `skill/chiron-tauri` (native wrapper, audio Range fix). Working artifacts: `~/Documents/generated/chiron-library/`, the LAN HTTPS server `~/.local/bin/chiron-https-serve`.

**Delete when:** Phase 1 (browse/sync/download/remove-local on the phone) AND Phase 2 (on-device Generate with live "preparing…" status) both ship.

---

## 1. Problem / goal
The user generates many lessons (heading to hundreds) on the home box and wants to **study on the phone** without juggling files. Needs: a **home hub** that is the source of truth for all lessons; a **phone app** (installed PWA, no address bar) that **syncs the full catalog over the home network**, **downloads** lessons for offline, and **removes** local copies to save space — and, eventually, **triggers generation** of a not-yet-built lesson from the app, showing a **"preparing lesson…"** status while the hub builds it.

## 2. Decision — LAN home hub (private)
The hub is the **always-on Linux box on the home LAN**, served over **LAN HTTPS**. The phone reaches it directly at home (most private; matches "my home network"). Not GitHub Pages for the data (Pages is only the optional install-shell fallback).

## 3. The never-erase-source rule (BLOCKING)
**Phone-side "Remove" clears ONLY that phone's local cache** (Cache Storage / app data). It MUST NOT delete, or send any delete to, the hub. The hub's lessons are the source of truth and are never mutated by the phone. (Consistent with the user's hard data-safety rule.) The phone is a *cache* of the hub.

**No desktop delete affordance (BLOCKING, user 2026-06-24).** Storage management
(Download / Remove-from-device) is **PHONE-ONLY**. The **desktop view shows NO
remove/delete control at all** — only Open (+ Generate) — so nothing can be mistakenly
deleted. The app NEVER deletes a *source* lesson anywhere; the hub source is removed only
by the user, manually, on the filesystem (with the project's 3× confirmation). "Remove"
is always device-cache-only and never appears on desktop. (Implemented: `library.js`
gates Download/Remove behind `matchMedia('(max-width:760px)')`.)

## 4. Architecture
```
HOME HUB (Linux box, always-on, LAN HTTPS)        PHONE (installed PWA — Library UI)
 ├─ all generated lessons (source of truth)  ◀─sync─ browse full faceted catalog (library.yaml-driven)
 ├─ lessons.json  catalog (the manifest)              Ready  → Download → cache offline (SW + fflate)
 ├─ *.chiron bundles (one per lesson)                 Ready  → Open → stream from hub over LAN (range)
 ├─ library.config.json (menu from library.yaml)      Cached → Remove → clears LOCAL cache ONLY
 ├─ [P2] POST /generate {subject,scope,domain}        Queued → Generate → "preparing lesson…" (poll)
 └─ [P2] GET  /jobs/<id> → {state,progress}                     grounding→writing→baking→ready → Download
```
- **Catalog** = `lessons.json` (player format: file/title/domain/clips/sizeMB/tags) + `.chiron` bundles, built by extending `build-library-index.mjs` (bundle each ready lesson + emit the manifest).
- **App** = the faceted **Library UI** + the **player's engine** (`import_from_server`/cache/`delete_lesson` local-only). One installable PWA.
- **Generation (P2)** reuses the hardened pipeline (chapterN.json → assembler → **Atelier bake** → bundle → catalog), wrapped in a small hub job API.

## 5. Phases
- **Phase 1 — Discover + Sync (no generation).**
  1. Hub publishes the catalog: `lessons.json` + fresh `.chiron` for all ready lessons + `library.config.json`, served via `chiron-https-serve` (LAN HTTPS).
  2. Merge: Library faceted UI + player's server-catalog/offline/remove-local engine → one PWA.
  3. Install on the phone from the hub HTTPS URL → browse, open (stream from hub), Download (offline), Remove (local only).
- **Phase 2 — On-device Generate.**
  1. Hub `/generate` + `/jobs` API: enqueue → run the real pipeline → add to catalog.
  2. App **Generate** on a queued lesson → POST → "preparing lesson…" live status (poll `/jobs`) → ready → Download.
  3. Bake step still routes to **Atelier** (Mac) per `chiron.md` R-CH1.

## 6. Reuse (don't reinvent)
- Player `skill/player/app.js`: `serverUrl`, `server_lessons`, `import_from_server`, `importBundleBytes` (fflate unzip → Cache), `delete_lesson` (local), `sw.js` (SW serves cached lessons). Lift the engine; keep the Library UI.
- `chiron-https-serve` (LAN HTTPS, supports Range → audio works).
- `build-library-index.mjs` (catalog/tagging) — extend to bundle + emit `lessons.json`.

## 7. Open questions
1. Trusted LAN HTTPS for a real phone PWA install — self-signed needs device trust; **mkcert** (local CA trusted once on the phone) is the clean fix. Decide in Phase 1 install step.
2. Hub always-on: a small `systemd --user` service for `chiron-https-serve` (+ later the generate API) so the hub survives reboots.
3. Phase-2 job runner: in-process queue vs a tiny job file/dir; bake concurrency vs Atelier (one omnivoice).

---

*Captured 2026-06-24. LAN home hub; phone is a cache of the hub; phone-remove never touches the source.*
