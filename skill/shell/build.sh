#!/bin/bash
# Chiron — Stage 5 Assemble: build single self-contained lesson.html.
#
# Inlines EVERY vendor library under shell/vendor/* as inline <script> / <style>
# blocks per FR-037 / Q9 / contracts/pipeline-stages.md Stage 5, so the
# resulting lesson opens with zero CDN calls (Pyodide is the lone runtime
# exception per R-03 and is loaded lazily by the page only if the lesson
# contains a `code-runner` widget).
#
# Run from the lesson directory:  bash build.sh
#
# Layout produced by upstream stages:
#   _base.html
#   modules/*.html       <- chapter fragments
#   _footer.html
#   vendor/<lib>/*.js    <- vendored runtime libraries (inlined as <script>)
#   vendor/<lib>/*.css   <- vendored stylesheets (inlined as <style>)
#   vendor/<lib>/*.md    <- included as HTML comments for traceability

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${HERE}/lesson.html"
VENDOR_DIR="${HERE}/vendor"

cd "${HERE}"

# --- 1. Concatenate base + chapter modules + footer ----------------------------
BODY="$(mktemp)"
cat _base.html > "${BODY}"
if compgen -G "modules/*.html" > /dev/null; then
  cat modules/*.html >> "${BODY}"
fi
cat _footer.html >> "${BODY}"

# --- 2. Build inline vendor block -----------------------------------------------
VENDOR_BLOCK="$(mktemp)"
trap 'rm -f "${VENDOR_BLOCK}" "${BODY}"' EXIT

if [[ -d "${VENDOR_DIR}" ]]; then
  echo "<!-- ===== chiron vendor inline (FR-037) ===== -->" >> "${VENDOR_BLOCK}"

  # Walk every subdirectory of vendor/ deterministically.
  while IFS= read -r -d '' dir; do
    [[ "${dir}" == "${VENDOR_DIR}" ]] && continue
    relname="${dir#${VENDOR_DIR}/}"
    echo "<!-- vendor: ${relname} -->" >> "${VENDOR_BLOCK}"

    # README / .md files included as HTML comments for traceability.
    while IFS= read -r -d '' readme; do
      echo "<!-- ${readme#${VENDOR_DIR}/} :" >> "${VENDOR_BLOCK}"
      sed 's/-->/--&gt;/g' "${readme}" >> "${VENDOR_BLOCK}"
      echo "-->" >> "${VENDOR_BLOCK}"
    done < <(find "${dir}" -maxdepth 1 -type f -iname '*.md' -print0 | sort -z)

    # CSS → inline <style>.
    while IFS= read -r -d '' css; do
      echo "<style data-chiron-vendor=\"${css#${VENDOR_DIR}/}\">" >> "${VENDOR_BLOCK}"
      cat "${css}" >> "${VENDOR_BLOCK}"
      echo "</style>" >> "${VENDOR_BLOCK}"
    done < <(find "${dir}" -maxdepth 1 -type f -iname '*.css' -print0 | sort -z)

    # JS → inline <script>. Skip non-text binaries (e.g. .wasm) — those need
    # the base64 shim authored alongside the molecule-renderer Phase 4 work.
    while IFS= read -r -d '' js; do
      echo "<script data-chiron-vendor=\"${js#${VENDOR_DIR}/}\">" >> "${VENDOR_BLOCK}"
      cat "${js}" >> "${VENDOR_BLOCK}"
      echo "</script>" >> "${VENDOR_BLOCK}"
    done < <(find "${dir}" -maxdepth 1 -type f -iname '*.js' -print0 | sort -z)
  done < <(find "${VENDOR_DIR}" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

  echo "<!-- ===== /chiron vendor inline ===== -->" >> "${VENDOR_BLOCK}"
fi

# --- 3. Splice the vendor block into the body just before </head> --------------
if grep -qi "</head>" "${BODY}"; then
  awk -v block_file="${VENDOR_BLOCK}" '
    BEGIN {
      while ((getline line < block_file) > 0) block = block "\n" line
      close(block_file)
      done = 0
    }
    !done && match($0, /<\/head>/) {
      pre  = substr($0, 1, RSTART - 1)
      post = substr($0, RSTART)
      print pre block
      print post
      done = 1
      next
    }
    { print }
  ' "${BODY}" > "${OUT}"
else
  # No </head> — append at the end (degraded but functional).
  cat "${BODY}" "${VENDOR_BLOCK}" > "${OUT}"
fi

echo "Built ${OUT} — open it in your browser."
