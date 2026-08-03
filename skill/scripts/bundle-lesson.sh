#!/usr/bin/env bash
# Chiron — Portable lesson bundler. Produces a `.chiron` file (the chiron/1
# format: a ZIP with a self-describing chiron.json manifest at its root).
#
# A `.chiron` opens in the Chiron app (PWA or native) — import it and it runs
# offline, audio and all. The `.chiron` extension is just a ZIP; the app accepts
# `.chiron` and `.zip` interchangeably and reads the bytes as a zip regardless.
#
# Usage:
#   bash bundle-lesson.sh <lesson-dir> [out.chiron] [--domain <d>]
#
# Defaults the output to <lesson-dir>/<basename>.chiron.
#
# AUTO-FIX (default on; --no-fix to skip): before zipping, the entry HTML is made
# mobile-responsive in place (idempotent, marker-guarded):
#   1. inject-mobile-layer.js  → hamburger drawer + footer audio player (if the
#      entry is lesson.html with an <aside class="side">; skips gracefully else)
#   2. fix-language-{responsive,tables,table-cards}.mjs → stacked-card vocab
#      tables etc. (only when the lesson has .v-table)
#   3. a universal overflow-x clamp so nothing side-scrolls on a phone
#
# chiron/1 format (see skill/CHIRON-FORMAT.md):
#   chiron.json   manifest {format,title,entry,domain,created,audioClips,generator}
#   lesson.html   the entry document (or index.html)
#   audio/        optional mp3 clips + manifest.js + manifest.json
#   themes/       optional *.css the lesson references
#
# EXCLUDED from the bundle:
#   .chiron-state.db*   runtime learner state (never travels with the lesson)
#   source/             original PDFs (not needed to view; can be large)
#   modules/ _base.html _footer.html vendor/ build.sh  build inputs already inlined
#   *.chiron / *.chiron.zip   don't nest a previous bundle

set -euo pipefail

LESSON_DIR="${1:-}"
OUT_ARG="${2:-}"
DOMAIN=""
NOFIX=0
# parse flags: --domain <d>, --no-fix
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  case "${args[$i]}" in
    --domain) DOMAIN="${args[$((i+1))]:-}" ;;
    --no-fix) NOFIX=1 ;;
  esac
done
[[ "${OUT_ARG}" == "--domain" || "${OUT_ARG}" == "--no-fix" ]] && OUT_ARG=""

if [[ -z "${LESSON_DIR}" || ! -d "${LESSON_DIR}" ]]; then
  echo "usage: bash bundle-lesson.sh <lesson-dir> [out.chiron] [--domain <d>]" >&2
  exit 1
fi
LESSON_DIR="$(cd "${LESSON_DIR}" && pwd)"

# entry html: prefer lesson.html, else first root *.html
ENTRY=""
[[ -f "${LESSON_DIR}/lesson.html" ]] && ENTRY="lesson.html"
if [[ -z "${ENTRY}" ]]; then
  ENTRY="$(cd "${LESSON_DIR}" && ls -1 *.html 2>/dev/null | head -1 || true)"
fi
if [[ -z "${ENTRY}" ]]; then
  echo "bundle-lesson: no lesson.html / *.html in ${LESSON_DIR} — run build.sh first." >&2
  exit 1
fi

command -v zip >/dev/null 2>&1 || { echo "bundle-lesson: 'zip' not found (apt install zip)." >&2; exit 1; }

NAME="$(basename "${LESSON_DIR}")"
OUT="${OUT_ARG:-${LESSON_DIR}/${NAME}.chiron}"
OUT="$(cd "$(dirname "${OUT}")" && pwd)/$(basename "${OUT}")"

# --- auto-apply the mobile / responsive layer (idempotent) ---------------------
# Make sure every .chiron opens clean on a phone. All steps mutate the entry HTML
# in place and are marker-guarded, so re-bundling is a no-op. Skip with --no-fix.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRY_HTML="${LESSON_DIR}/${ENTRY}"
if [[ "${NOFIX}" -eq 0 ]]; then
  if command -v node >/dev/null 2>&1; then
    # 1. Mobile layer: hamburger drawer + footer audio player + responsive CSS.
    #    inject-mobile-layer.js is hardcoded to a wards dir and loops, so drive it
    #    via an isolated symlink dir pointing only at THIS lesson. (Needs the entry
    #    to be lesson.html + an <aside class="side">; skips gracefully otherwise.)
    if [[ "${ENTRY}" == "lesson.html" && -f "${SCRIPT_DIR}/inject-mobile-layer.js" ]] \
       && ! grep -q 'CHIRON_MOBILE_LAYER_INJECTED' "${ENTRY_HTML}"; then
      _work="$(mktemp -d)"; ln -s "${LESSON_DIR}" "${_work}/lesson"
      _runner="$(mktemp --suffix=.js)"
      sed "s#^const WARDS_DIR = .*#const WARDS_DIR = '${_work}';#" \
        "${SCRIPT_DIR}/inject-mobile-layer.js" > "${_runner}"
      node "${_runner}" >/dev/null 2>&1 || true
      rm -f "${_work}/lesson" "${_runner}"; rmdir "${_work}" 2>/dev/null || true
    fi
    # 2. Language vocab/sentence table fixes — only when the lesson has .v-table.
    if grep -q 'v-table' "${ENTRY_HTML}" 2>/dev/null; then
      for fx in fix-language-responsive fix-language-tables fix-language-table-cards; do
        [[ -f "${SCRIPT_DIR}/${fx}.mjs" ]] && node "${SCRIPT_DIR}/${fx}.mjs" "${ENTRY_HTML}" >/dev/null 2>&1 || true
      done
    fi
  else
    echo "bundle-lesson: node not found — skipping mobile-layer fixes (bundled as-is)." >&2
  fi
  # 3. Universal overflow clamp — kills any stray horizontal pan on mobile.
  if ! grep -q 'CHIRON_OVERFLOW_CLAMP' "${ENTRY_HTML}" 2>/dev/null && grep -q '</body>' "${ENTRY_HTML}" 2>/dev/null; then
    _clamp='<style>/*CHIRON_OVERFLOW_CLAMP*/@media(max-width:768px){html,body{overflow-x:hidden!important;max-width:100vw!important}}</style>'
    awk -v c="${_clamp}" 'BEGIN{d=0} /<\/body>/ && !d {print c; d=1} {print}' \
      "${ENTRY_HTML}" > "${ENTRY_HTML}.tmp" && mv "${ENTRY_HTML}.tmp" "${ENTRY_HTML}"
  fi
fi

# --- write the chiron/1 manifest into the lesson dir ---------------------------
TITLE="$(grep -oE '<title>[^<]*' "${LESSON_DIR}/${ENTRY}" | head -1 | sed 's/<title>//' | sed 's/[[:space:]]*$//')"
[[ -z "${TITLE}" || "${TITLE}" == "COURSE_TITLE" ]] && TITLE="${NAME}"
# JSON-escape backslashes and quotes in the title
TITLE_ESC="$(printf '%s' "${TITLE}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
# count mp3s recursively (top-level audio/ AND multi-page wards/*/audio/); the
# trailing `|| true` keeps set -e/pipefail from aborting when there's no audio.
CLIPS="$( { find "${LESSON_DIR}" -name '*.mp3' 2>/dev/null || true; } | wc -l | tr -d ' ')"
CREATED="$(date +%F)"
# MERGE onto any existing manifest — a re-bundle must NEVER strip the lesson's real category domain
# or its provenance. The category domain (video-it / language-it / medicine) is authoritative and is
# preserved: existing chiron.json.domain > content.json.domain (the chain's declaration) > the --domain
# arg (a theme-ish default, correct only on a FIRST bundle). tags/status/subject/level/source are carried
# forward. (Root cause of the "video-it keeps resetting to medicine on every rebundle" bug.)
CHIRON_TITLE="${TITLE}" CHIRON_ENTRY="${ENTRY}" CHIRON_DOMAIN_ARG="${DOMAIN}" \
CHIRON_CLIPS="${CLIPS:-0}" CHIRON_CREATED="${CREATED}" python3 - "${LESSON_DIR}" <<'PY'
import json, os, sys
d = sys.argv[1]; cjp = os.path.join(d, "chiron.json")
def _load(p):
    try: return json.load(open(p))
    except Exception: return {}
old = _load(cjp); content = _load(os.path.join(d, "content.json"))
domain = old.get("domain") or content.get("domain") or os.environ.get("CHIRON_DOMAIN_ARG") or ""
m = {"format": "chiron/1", "title": os.environ["CHIRON_TITLE"], "entry": os.environ["CHIRON_ENTRY"],
     "domain": domain, "created": os.environ["CHIRON_CREATED"],
     "audioClips": int(os.environ.get("CHIRON_CLIPS") or 0), "generator": "chiron"}
for k in ("tags", "status", "subject", "level", "source", "source_ref", "accepted", "series"):
    if old.get(k) is not None: m[k] = old[k]
json.dump(m, open(cjp, "w"), ensure_ascii=False, indent=2)
PY

# --- zip (paths relative; entry html + chiron.json at the root) ----------------
rm -f "${OUT}"
cd "${LESSON_DIR}"
zip -r -q "${OUT}" . \
  -x 'episode.mp4' \
  -x '*.orig.mp4' \
  -x 'audio/**/*.wav' \
  -x '*.log' \
  -x '.chiron-state.db*' \
  -x 'source/*' \
  -x 'modules/*' \
  -x '_base.html' \
  -x '_footer.html' \
  -x 'build.sh' \
  -x 'vendor/*' \
  -x '*.chiron' \
  -x '*.chiron.zip'

SIZE="$(du -h "${OUT}" | cut -f1)"
echo "Bundled ${OUT} (${SIZE}) — chiron/1, title \"${TITLE}\", ${CLIPS:-0} audio clip(s)."
echo "Open it in the Chiron app: + Add lesson → pick this .chiron."
