#!/usr/bin/env bash
# Chiron golden-input test driver (T049, FR-026).
#
# Pairs each tests/golden-inputs/<name>/ with tests/snapshots/<name>.json,
# locates a generated lesson.html, extracts marker counts via headless
# browser (or grep fallback), and diffs against the snapshot tolerances.
#
# Modes:
#   ./test.sh              run validation, exit non-zero on any failure
#   ./test.sh --regenerate print regen instructions, exit 0
#   ./test.sh --strict     also fail on missing lesson.html (default skips)
#   ./test.sh --help       usage
#
# Env:
#   CHIRON_LESSON_DIR  if set, expects $CHIRON_LESSON_DIR/<name>/lesson.html
#                      otherwise uses /tmp/chiron-test-<name>/lesson.html

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOLDEN_DIR="$SCRIPT_DIR/golden-inputs"
SNAPSHOT_DIR="$SCRIPT_DIR/snapshots"

MODE="validate"
STRICT=0

usage() {
  cat <<'EOF'
chiron test.sh — golden-input validation driver (FR-026)

USAGE:
  test.sh                 Run validation. Exit non-zero on any FAIL.
  test.sh --regenerate    Print regen instructions for each golden input. Exit 0.
  test.sh --strict        Also fail on missing lesson.html (default: skip).
  test.sh --help          Show this help.

ENV:
  CHIRON_LESSON_DIR       Override base dir. Looks for $CHIRON_LESSON_DIR/<name>/lesson.html.
                          Default: /tmp/chiron-test-<name>/lesson.html

NOTES:
  v1 cannot drive the LLM pipeline itself. Generation is performed by the
  parent Chiron skill against each golden-input directory. This script
  performs discovery, validation, marker extraction, and diff against
  snapshots.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --regenerate) MODE="regenerate" ;;
    --strict)     STRICT=1 ;;
    --help|-h)    usage; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; usage; exit 2 ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[fatal] required command not found in PATH: $1" >&2
    return 1
  fi
}

# Required tooling
require_cmd grep
require_cmd awk
require_cmd sed
require_cmd find
require_cmd basename

# jq is strongly preferred; fall back to a tiny python parser if absent
HAS_JQ=0
if command -v jq >/dev/null 2>&1; then
  HAS_JQ=1
fi
HAS_PY=0
if command -v python3 >/dev/null 2>&1; then
  HAS_PY=1
fi
if [ "$HAS_JQ" -eq 0 ] && [ "$HAS_PY" -eq 0 ]; then
  echo "[fatal] need either 'jq' or 'python3' to parse snapshot JSON" >&2
  exit 2
fi

json_get() {
  # json_get <file> <key>  — top-level key, string or number
  local f="$1" k="$2"
  if [ "$HAS_JQ" -eq 1 ]; then
    jq -r --arg k "$k" '.[$k] // empty' "$f"
  else
    python3 -c "import json,sys; d=json.load(open(sys.argv[1])); v=d.get(sys.argv[2]); print('' if v is None else (json.dumps(v) if isinstance(v,(list,dict,bool)) else v))" "$f" "$k"
  fi
}

# ---------- Discovery phase ----------
echo "[discover] golden-inputs:"
INPUTS=()
for d in "$GOLDEN_DIR"/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  snap="$SNAPSHOT_DIR/$name.json"
  if [ ! -f "$snap" ]; then
    echo "[fatal] golden input '$name' has no matching snapshot at $snap" >&2
    exit 2
  fi
  INPUTS+=("$name")
  echo "  - $name (snapshot: $snap)"
done

# Reverse-check: every snapshot has a golden input
for s in "$SNAPSHOT_DIR"/*.json; do
  [ -f "$s" ] || continue
  sname="$(basename "$s" .json)"
  if [ ! -d "$GOLDEN_DIR/$sname" ]; then
    echo "[fatal] snapshot '$sname.json' has no matching golden-input dir" >&2
    exit 2
  fi
done

if [ "${#INPUTS[@]}" -eq 0 ]; then
  echo "[fatal] no golden inputs found under $GOLDEN_DIR" >&2
  exit 2
fi

# ---------- Regenerate mode ----------
if [ "$MODE" = "regenerate" ]; then
  echo
  echo "[regenerate] To regenerate fixtures, invoke the chiron skill against each input:"
  for name in "${INPUTS[@]}"; do
    out_dir="${CHIRON_LESSON_DIR:-/tmp/chiron-test-$name}"
    [ -n "${CHIRON_LESSON_DIR:-}" ] && out_dir="$CHIRON_LESSON_DIR/$name"
    echo "  - input:  $GOLDEN_DIR/$name/"
    echo "    output: $out_dir/lesson.html"
    echo "    cmd:    (invoke chiron skill -> Mode A lesson generation)"
  done
  exit 0
fi

# ---------- Pick a "headless browser" (best-effort) ----------
BROWSER_TOOL=""
for cand in playwright puppeteer headless_shell chromium chromium-browser google-chrome; do
  if command -v "$cand" >/dev/null 2>&1; then
    BROWSER_TOOL="$cand"
    break
  fi
done
if [ -z "$BROWSER_TOOL" ]; then
  echo "[info] no headless browser found; using grep/sed marker-count fallback"
fi

# ---------- Marker extraction ----------
# Counts occurrences of class="<marker>" (single or double quote) in the HTML.
count_marker() {
  local html="$1" cls="$2"
  # Match class="...marker..." or class='...marker...' (token-aware via word boundary on space/quote)
  grep -oE "class=[\"'][^\"']*\\b${cls}\\b[^\"']*[\"']" "$html" | wc -l | awk '{print $1}'
}

extract_fields() {
  # extract_fields <lesson.html> -> echoes "chapters quizzes srcards persona spotbug mcq tf"
  local html="$1"
  local chapters quizzes_mcq quizzes_tf quizzes_spot srcards persona spotbug mcq tf total_quiz
  chapters="$(count_marker "$html" "chapter")"
  mcq="$(count_marker "$html" "mcq-widget")"
  tf="$(count_marker "$html" "true-false")"
  spotbug="$(count_marker "$html" "spot-the-bug")"
  srcards="$(count_marker "$html" "sr-card")"
  persona="$(count_marker "$html" "persona-line")"
  total_quiz=$(( mcq + tf + spotbug ))
  echo "$chapters $total_quiz $srcards $persona $mcq $tf $spotbug"
}

# ---------- Validation phase ----------
FAILS=0
SKIPS=0
PASSES=0

for name in "${INPUTS[@]}"; do
  snap="$SNAPSHOT_DIR/$name.json"
  base_dir="${CHIRON_LESSON_DIR:+$CHIRON_LESSON_DIR/$name}"
  base_dir="${base_dir:-/tmp/chiron-test-$name}"
  html="$base_dir/lesson.html"

  echo
  echo "[validate] $name"
  echo "  snapshot: $snap"
  echo "  lesson:   $html"

  if [ ! -f "$html" ]; then
    if [ "$STRICT" -eq 1 ]; then
      echo "  [FAIL] lesson.html missing (--strict)"
      FAILS=$(( FAILS + 1 ))
    else
      echo "  [skip] no lesson.html found — generate first (run with --regenerate for instructions)"
      SKIPS=$(( SKIPS + 1 ))
    fi
    continue
  fi

  # Read snapshot expectations
  exp_chapter="$(json_get "$snap" chapterCount)"
  tol_chapter="$(json_get "$snap" chapterCountTolerance)"
  exp_quiz="$(json_get "$snap" totalQuizCount)"
  tol_quiz="$(json_get "$snap" totalQuizCountTolerance)"
  exp_sr="$(json_get "$snap" srCardCount)"
  tol_sr="$(json_get "$snap" srCardCountTolerance)"
  exp_persona="$(json_get "$snap" peerDialogueLineCount)"
  tol_persona="$(json_get "$snap" peerDialogueLineCountTolerance)"
  exp_mcq="$(json_get "$snap" hasMcq)"
  exp_tf="$(json_get "$snap" hasTrueFalse)"
  exp_spot="$(json_get "$snap" hasSpotTheBug)"

  read -r got_chapter got_quiz got_sr got_persona got_mcq got_tf got_spot < <(extract_fields "$html")

  echo "  markers: chapters=$got_chapter quizzes=$got_quiz sr=$got_sr persona=$got_persona mcq=$got_mcq tf=$got_tf spot=$got_spot"

  fail=0
  check_tol() {
    local label="$1" exp="$2" tol="$3" got="$4"
    if [ -z "$exp" ] || [ -z "$tol" ]; then return 0; fi
    local lo=$(( exp - tol )) hi=$(( exp + tol ))
    if [ "$got" -lt "$lo" ] || [ "$got" -gt "$hi" ]; then
      echo "    [diff] $label: got=$got expected=$exp+/-$tol (range $lo..$hi)"
      fail=1
    fi
  }
  check_tol "chapterCount"        "$exp_chapter" "$tol_chapter" "$got_chapter"
  check_tol "totalQuizCount"      "$exp_quiz"    "$tol_quiz"    "$got_quiz"
  check_tol "srCardCount"         "$exp_sr"      "$tol_sr"      "$got_sr"
  check_tol "peerDialogueLineCount" "$exp_persona" "$tol_persona" "$got_persona"

  check_bool() {
    local label="$1" want="$2" got="$3"
    if [ "$want" = "true" ] && [ "$got" -eq 0 ]; then
      echo "    [diff] $label: expected present, found 0"
      fail=1
    fi
  }
  check_bool "hasMcq"        "$exp_mcq"  "$got_mcq"
  check_bool "hasTrueFalse"  "$exp_tf"   "$got_tf"
  check_bool "hasSpotTheBug" "$exp_spot" "$got_spot"

  if [ "$fail" -eq 0 ]; then
    echo "  [PASS] $name"
    PASSES=$(( PASSES + 1 ))
  else
    echo "  [FAIL] $name"
    FAILS=$(( FAILS + 1 ))
  fi
done

echo
echo "[summary] pass=$PASSES fail=$FAILS skip=$SKIPS total=${#INPUTS[@]}"

if [ "$FAILS" -gt 0 ]; then
  exit 1
fi
exit 0
