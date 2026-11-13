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
#   .chiron.json.lock   lock file of lesson_manifest.py
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
SLUG="$(basename "${OUT}" .chiron)"   # the library slug: the catalog names each bundle <slug>.chiron

# --- the lesson's own id ------------------------------------------------------
# The page keys its saved progress by <meta name="chiron-lesson-id">. Language lessons copied that tag from
# the chiron-italian-appunto donor page, so they all shared its id; give each one its own slug.
DONOR_ID="italian-appunto-lucrezia-2026-06-29"
if [[ "${SLUG}" != "chiron-italian-appunto" ]] && grep -q "name=\"chiron-lesson-id\" content=\"${DONOR_ID}\"" "${LESSON_DIR}/${ENTRY}"; then
  sed -i "s|name=\"chiron-lesson-id\" content=\"${DONOR_ID}\"|name=\"chiron-lesson-id\" content=\"${SLUG}\"|" "${LESSON_DIR}/${ENTRY}"
fi

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
  # 4. Offline lesson-to-lesson links. A saved copy lives at lesson.localhost/<timestamp id>/, so a link like
  #    ../<other lesson>/lesson.html finds nothing. When running from saved storage, ask the app to open that lesson
  #    (it picks the saved copy when the computer is unreachable). A no-op anywhere else. No backslashes: awk -v eats them.
  if ! grep -q 'CHIRON_OFFLINE_LINKS' "${ENTRY_HTML}" 2>/dev/null && grep -q '</body>' "${ENTRY_HTML}" 2>/dev/null; then
    _ol="<script>/*CHIRON_OFFLINE_LINKS*/(function(){if(location.hostname!=='lesson.localhost'&&location.protocol!=='lesson:')return;document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var u;try{u=new URL(a.getAttribute('href'),location.href)}catch(x){return}var p=u.pathname.split('/');if(p[p.length-1]!=='lesson.html')return;var id='';if(u.origin===location.origin){id=p.slice(1,-1).join('/')}else{var li=p.indexOf('lessons');if(li<0)return;id=p.slice(li+1,-1).join('/')}id=decodeURIComponent(id);if(!id||id===location.pathname.split('/')[1])return;e.preventDefault();e.stopPropagation();parent.postMessage({type:'chiron-open-lesson',id:id,hash:u.hash||''},'*')},true)})();</script>"
    # insert right before the </body> TAG, not before its line: </body> often shares a line with the end of a script
    awk -v c="${_ol}" 'BEGIN{d=0} !d && (i = index($0, "</body>")) {print substr($0, 1, i-1) c substr($0, i); d=1; next} {print}' \
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
# MERGE onto any existing manifest through lesson_manifest.stamp: every stored key (tags, labels, depth, status,
# subject, source, ...) is kept. The domain is the stored chiron.json domain, else content.json's, else the
# --domain argument, normalized to one of the canonical domains; an unknown value is reported and not written.
CHIRON_TITLE="${TITLE}" CHIRON_ENTRY="${ENTRY}" CHIRON_DOMAIN_ARG="${DOMAIN}" CHIRON_SCRIPTS="${SCRIPT_DIR}" \
CHIRON_CLIPS="${CLIPS:-0}" CHIRON_CREATED="${CREATED}" CHIRON_SLUG="${SLUG}" python3 - "${LESSON_DIR}" <<'PY'
import json, os, sys
sys.path.insert(0, os.environ["CHIRON_SCRIPTS"])
import lesson_manifest as lm
d = sys.argv[1]
def _load(p):
    try: return json.load(open(p))
    except Exception: return {}
old = lm.read(d); content = _load(os.path.join(d, "content.json"))
raw = old.get("domain") or content.get("domain") or os.environ.get("CHIRON_DOMAIN_ARG") or ""
domain = lm.normalize_domain(raw)
if raw and domain is None:
    print(f"bundle-lesson: unknown domain {raw!r} for {d}; chiron.json domain left as is", file=sys.stderr)
# stamp merges onto the stored manifest: every existing key stays, only these are set.
# an existing manifest title wins; the page <title> fills in only when there is none (stamp cleans either one).
lm.stamp(d, title=old.get("title") or os.environ["CHIRON_TITLE"], domain=domain, generator="chiron",
         extra={"format": "chiron/1", "entry": os.environ["CHIRON_ENTRY"], "created": os.environ["CHIRON_CREATED"],
                "audioClips": int(os.environ.get("CHIRON_CLIPS") or 0), "slug": os.environ["CHIRON_SLUG"]})
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
  -x '.chiron.json.lock' \
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
