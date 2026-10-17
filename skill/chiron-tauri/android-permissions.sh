#!/usr/bin/env bash
# android-permissions.sh — re-apply the voice-tutor mic permissions to the (gitignored, regenerable)
# Android manifest after `npm run tauri android init`. Idempotent.
set -euo pipefail
M="$(dirname "$0")/src-tauri/gen/android/app/src/main/AndroidManifest.xml"
[ -f "$M" ] || { echo "no manifest at $M — run: npm run tauri android init" >&2; exit 1; }
grep -q RECORD_AUDIO "$M" && { echo "already has RECORD_AUDIO"; exit 0; }
sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#&\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />\n    <uses-feature android:name="android.hardware.microphone" android:required="false" />#' "$M"
grep -q RECORD_AUDIO "$M" && echo "patched $M"
