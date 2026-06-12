#!/usr/bin/env bash
# Chiron — Portable lesson bundler.
#
# Packs an assembled lesson directory into a single `<name>.chiron.zip` that you
# can AirDrop / cloud-share / email and open on any phone:
#   tap the .zip in iOS/Android Files → extract → tap lesson.html → audio plays.
#
# Why a zip (not a base64-inlined single .html): keeps the instant text render +
# lazy per-clip audio, avoids the tens-of-MB parse that chokes mobile Safari, and
# a .zip is universally accepted as an attachment where a big .html is blocked.
# Audio works on file:// because the player reads window.__chironAudioManifest
# from audio/manifest.js (no fetch) and sets <audio>.src to RELATIVE mp3 paths,
# which media elements load on file:// (unlike fetch()).
#
# Usage:
#   bash bundle-lesson.sh <lesson-dir> [out.chiron.zip]
#
# Defaults the output to <lesson-dir>/<basename>.chiron.zip.
#
# EXCLUDED from the bundle:
#   .chiron-state.db*   runtime learner state (never travels with the lesson)
#   source/             original PDFs (not needed to view; can be large)
#   modules/ _base.html _footer.html vendor/ build.sh  build inputs already
#                       inlined into lesson.html by build.sh
#   *.chiron.zip        don't nest a previous bundle

set -euo pipefail

LESSON_DIR="${1:-}"
if [[ -z "${LESSON_DIR}" || ! -d "${LESSON_DIR}" ]]; then
  echo "usage: bash bundle-lesson.sh <lesson-dir> [out.chiron.zip]" >&2
  echo "  <lesson-dir> must be a directory containing lesson.html" >&2
  exit 1
fi

LESSON_DIR="$(cd "${LESSON_DIR}" && pwd)"   # absolutize

if [[ ! -f "${LESSON_DIR}/lesson.html" ]]; then
  echo "bundle-lesson: no lesson.html in ${LESSON_DIR} — run build.sh first." >&2
  exit 1
fi

command -v zip >/dev/null 2>&1 || { echo "bundle-lesson: 'zip' not found — install it (apt install zip)." >&2; exit 1; }

NAME="$(basename "${LESSON_DIR}")"
OUT="${2:-${LESSON_DIR}/${NAME}.chiron.zip}"
OUT="$(cd "$(dirname "${OUT}")" && pwd)/$(basename "${OUT}")"   # absolutize

# Rebuild from scratch so stale clips don't linger in the archive.
rm -f "${OUT}"

# zip from inside the lesson dir so paths are relative (lesson.html at root of
# the extracted folder).
cd "${LESSON_DIR}"
zip -r -q "${OUT}" . \
  -x '.chiron-state.db*' \
  -x 'source/*' \
  -x 'modules/*' \
  -x '_base.html' \
  -x '_footer.html' \
  -x 'build.sh' \
  -x 'vendor/*' \
  -x '*.chiron.zip'

SIZE="$(du -h "${OUT}" | cut -f1)"
echo "Bundled ${OUT} (${SIZE})."
echo "Phone: share the .zip → extract in Files → tap lesson.html → press play."
