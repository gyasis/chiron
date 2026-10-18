#!/usr/bin/env bash
# android-permissions.sh — re-apply the voice-tutor mic permissions to the (gitignored, regenerable)
# Android manifest after `npm run tauri android init`. Idempotent.
set -euo pipefail
M="$(dirname "$0")/src-tauri/gen/android/app/src/main/AndroidManifest.xml"
[ -f "$M" ] || { echo "no manifest at $M — run: npm run tauri android init" >&2; exit 1; }
if grep -q RECORD_AUDIO "$M"; then echo "already has RECORD_AUDIO"; else
sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#&\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />\n    <uses-feature android:name="android.hardware.microphone" android:required="false" />#' "$M"
grep -q RECORD_AUDIO "$M" && echo "patched $M"
fi

# chiron:// deep link (Match Madness "Studia nella lezione"). tauri-plugin-deep-link writes this intent-filter itself from
# tauri.conf.json plugins.deep-link on every `tauri android build/dev`; this is the belt-and-braces re-apply for a build
# that skipped it. Idempotent. NB the RECORD_AUDIO early-exit above must not skip this, so it lives in its own script step.
if grep -q 'android:scheme="chiron"' "$M"; then echo "already has the chiron:// intent-filter"; else
  sed -i '0,/<\/activity>/s##    <intent-filter>\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="chiron" />\n            </intent-filter>\n        </activity>#' "$M"
  grep -q 'android:scheme="chiron"' "$M" && echo "patched chiron:// intent-filter into $M" || { echo "could not add the chiron:// intent-filter to $M" >&2; exit 1; }
fi

# Background playback (Ascolta keeps playing with the screen off / the Fold closed): our MainActivity (ChironAudio JS bridge)
# + PlaybackService live in android/ (src-tauri/gen is gitignored), copied over the generated ones; the manifest gets the
# foreground-service permissions and the <service>. Idempotent.
J="$(dirname "$0")/src-tauri/gen/android/app/src/main/java/com/gyasi/chiron"
cp "$(dirname "$0")/android/MainActivity.kt" "$(dirname "$0")/android/PlaybackService.kt" "$J/" && echo "copied MainActivity.kt + PlaybackService.kt"
if grep -q FOREGROUND_SERVICE_MEDIA_PLAYBACK "$M"; then echo "already has the playback service"; else
  sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#&\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />\n    <uses-permission android:name="android.permission.WAKE_LOCK" />\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />#' "$M"
  sed -i 's#</application>#    <service android:name=".PlaybackService" android:exported="false" android:foregroundServiceType="mediaPlayback" />\n    </application>#' "$M"
  grep -q 'android:name=".PlaybackService"' "$M" && echo "patched the playback service into $M" || { echo "could not add the playback service to $M" >&2; exit 1; }
fi
