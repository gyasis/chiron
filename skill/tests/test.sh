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
# Mode-A inputs pair `golden-inputs/<name>/` with `snapshots/<name>.json`.
# Mode-B inputs (case-study fixtures) carry `golden-inputs/<name>/expected-handoff.json`
# and don't require a snapshot. If both exist, Mode-B handoff validation wins.
echo "[discover] golden-inputs:"
INPUTS=()
declare -A INPUT_MODE  # name -> "A" | "B"
for d in "$GOLDEN_DIR"/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  snap="$SNAPSHOT_DIR/$name.json"
  handoff="$d/expected-handoff.json"
  if [ -f "$handoff" ]; then
    INPUT_MODE["$name"]="B"
    INPUTS+=("$name")
    echo "  - $name (mode-B handoff: $handoff)"
    continue
  fi
  if [ ! -f "$snap" ]; then
    echo "[warn] golden input '$name' has no matching snapshot at $snap and no expected-handoff.json — skipping" >&2
    continue
  fi
  INPUT_MODE["$name"]="A"
  INPUTS+=("$name")
  echo "  - $name (snapshot: $snap)"
done

# Reverse-check: every snapshot has a golden input (still fatal — orphan snapshot is a bug)
for s in "$SNAPSHOT_DIR"/*.json; do
  [ -f "$s" ] || continue
  sname="$(basename "$s" .json)"
  if [ ! -d "$GOLDEN_DIR/$sname" ]; then
    echo "[warn] snapshot '$sname.json' has no matching golden-input dir" >&2
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

# ---------- Medicine-domain marker extraction (T097) ----------
# Per-medicine marker classes (USMLE/AMBOSS-style):
#   class="mcq-clinical-vignette"            -> vignette stems
#   data-hammer="1|2|3"                       -> difficulty hammer flags
#   class="key-info-chips" w/ class="chip"    -> key-info tags per vignette
#   class="attending-tip"                     -> subject-expert persona tips
#   class="chemical-reaction"                 -> chem reaction widgets
#   class="molecule-2d"                       -> 2D molecule renderer
#   data-vignette-category="<X>"              -> taxonomy coverage
#   class="verifier-cycle-marker" or
#     data-verifier-cycle="N"                 -> medicine verifier loop trace
#
# Echoes a single space-separated record:
#   "<vignettes> <hammers_csv> <keyinfo_min_per_vig> <attending_tips>
#    <chem> <molecules> <taxonomy_csv> <verifier_cycles>"
extract_medicine_fields() {
  local html="$1"
  local lesson_dir
  lesson_dir="$(dirname "$html")"

  local vignettes attending_tips chem molecules verifier_cycles
  vignettes="$(count_marker "$html" "mcq-clinical-vignette")"
  attending_tips="$(count_marker "$html" "attending-tip")"
  chem="$(count_marker "$html" "chemical-reaction")"
  molecules="$(count_marker "$html" "molecule-2d")"

  # Hammer levels — collect unique levels seen (1|2|3) into CSV.
  local hammers_csv
  hammers_csv="$(grep -oE 'data-hammer=[\"'"'"'][123][\"'"'"']' "$html" 2>/dev/null \
    | sed -E 's/data-hammer=[\"'"'"']([123])[\"'"'"']/\1/' \
    | sort -u | paste -sd, - 2>/dev/null || true)"
  hammers_csv="${hammers_csv:-}"

  # Per-vignette key-info chip count: minimum across vignettes.
  # Strategy: split HTML into per-vignette chunks via awk, then count chips
  # (class="chip") inside each chunk's key-info-chips block.
  local keyinfo_min
  if [ "$vignettes" -gt 0 ]; then
    keyinfo_min="$(awk '
      BEGIN { vig=0; in_chips=0; chip_count=0; min=-1 }
      /class=["'"'"']?[^"'"'"']*mcq-clinical-vignette/ {
        if (vig > 0) {
          if (min < 0 || chip_count < min) min = chip_count
        }
        vig++; chip_count=0; in_chips=0
      }
      /class=["'"'"']?[^"'"'"']*key-info-chips/ { in_chips=1 }
      in_chips && /class=["'"'"']?[^"'"'"']*\bchip\b/ { chip_count++ }
      END {
        if (vig > 0) {
          if (min < 0 || chip_count < min) min = chip_count
          print min
        } else { print 0 }
      }
    ' "$html" 2>/dev/null)"
    keyinfo_min="${keyinfo_min:-0}"
  else
    keyinfo_min=0
  fi

  # Vignette taxonomy coverage — unique data-vignette-category values, CSV.
  local taxonomy_csv
  taxonomy_csv="$(grep -oE 'data-vignette-category=[\"'"'"'][^\"'"'"']+[\"'"'"']' "$html" 2>/dev/null \
    | sed -E 's/data-vignette-category=[\"'"'"']([^\"'"'"']+)[\"'"'"']/\1/' \
    | sort -u | paste -sd, - 2>/dev/null || true)"
  taxonomy_csv="${taxonomy_csv:-}"

  # Verifier cycles — primary: class="verifier-cycle-marker"
  verifier_cycles="$(count_marker "$html" "verifier-cycle-marker")"
  # Fallback A: data-verifier-cycle="N" attribute count
  if [ "$verifier_cycles" -eq 0 ]; then
    verifier_cycles="$(grep -oE 'data-verifier-cycle=[\"'"'"'][0-9]+[\"'"'"']' "$html" 2>/dev/null | wc -l | awk '{print $1}')"
  fi
  # Fallback B: sidecar verifier-state.json or "verifier" mention in lesson dir
  if [ "$verifier_cycles" -eq 0 ]; then
    if [ -f "$lesson_dir/verifier-state.json" ]; then
      verifier_cycles=1
    elif grep -qiE 'verifier|verification cycle' "$html" 2>/dev/null; then
      verifier_cycles=1
    fi
  fi

  echo "$vignettes ${hammers_csv:-_} $keyinfo_min $attending_tips $chem $molecules ${taxonomy_csv:-_} $verifier_cycles"
}

# Helper: array containment — every expected element must appear in actual CSV set.
# Usage: check_array_contains <label> <expected_json_array> <actual_csv>
check_array_contains() {
  local label="$1" expected_json="$2" actual_csv="$3"
  if [ -z "$expected_json" ] || [ "$expected_json" = "null" ]; then return 0; fi
  local want_list
  want_list="$(echo "$expected_json" | tr -d '[]"' | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' || true)"
  while IFS= read -r want_item; do
    [ -z "$want_item" ] && continue
    if ! echo ",${actual_csv}," | grep -q ",${want_item},"; then
      echo "    [diff] $label: '$want_item' not found (got=[${actual_csv}])"
      fail=1
    fi
  done <<< "$want_list"
}

# ---------- Italian / language-domain marker extraction (T065) ----------
# Per-language marker classes:
#   class="fill-blank", class="cloze", class="audio-tts", class="matching-pair"
#   data-speaker="<id>"
# Plus fuzzyAccentCheck: presence of NFD combining-mark regex or FR-020 marker.
extract_italian_fields() {
  # extract_italian_fields <lesson.html>
  #   -> echoes "fill_blank cloze audio_tts matching_pair fuzzy_accent <speaker_csv>"
  local html="$1"
  local fill_blank cloze audio_tts matching_pair fuzzy_accent speakers
  fill_blank="$(count_marker "$html" "fill-blank")"
  cloze="$(count_marker "$html" "cloze")"
  audio_tts="$(count_marker "$html" "audio-tts")"
  matching_pair="$(count_marker "$html" "matching-pair")"

  # Fuzzy accent check: look for NFD combining-mark regex or FR-020 source marker.
  # The renderer's normalization should ship as either a regex like /[̀-ͯ]/g
  # / [̀-ͯ] (literal NFD range) or be tagged with a "// FR-020" comment.
  if grep -qE '\[\\u0300-\\u036f\]|\[̀-ͯ\]|FR-020' "$html" 2>/dev/null; then
    fuzzy_accent="passed"
  else
    fuzzy_accent="failed"
  fi

  # Collect speaker ids from data-speaker="..." attributes (uniq, comma-separated).
  speakers="$(grep -oE 'data-speaker=[\"'"'"'][^\"'"'"']+[\"'"'"']' "$html" \
    | sed -E 's/data-speaker=[\"'"'"']([^\"'"'"']+)[\"'"'"']/\1/' \
    | sort -u | paste -sd, - 2>/dev/null || true)"
  speakers="${speakers:-}"

  echo "$fill_blank $cloze $audio_tts $matching_pair $fuzzy_accent ${speakers}"
}

# Helper: minimum-threshold check (got >= min)
check_min() {
  local label="$1" min="$2" got="$3"
  if [ -z "$min" ]; then return 0; fi
  if [ "$got" -lt "$min" ]; then
    echo "    [diff] $label: got=$got expected>=$min"
    fail=1
  fi
}

# Helper: exact equality (integers or strings)
check_eq() {
  local label="$1" want="$2" got="$3"
  if [ -z "$want" ] || [ "$want" = "null" ]; then return 0; fi
  if [ "$want" != "$got" ]; then
    echo "    [diff] $label: got=$got expected=$want"
    fail=1
  fi
}

# Helper: floating-point closeness using awk; tolerance is absolute.
check_float_close() {
  local label="$1" want="$2" got="$3" tol="$4"
  if [ -z "$want" ] || [ "$want" = "null" ]; then return 0; fi
  if [ -z "$got" ]; then
    echo "    [diff] $label: got=<empty> expected=$want+/-$tol"
    fail=1
    return 0
  fi
  local ok
  ok="$(awk -v w="$want" -v g="$got" -v t="$tol" 'BEGIN{ d=g-w; if (d<0) d=-d; print (d<=t)?"1":"0" }')"
  if [ "$ok" != "1" ]; then
    echo "    [diff] $label: got=$got expected=$want+/-$tol"
    fail=1
  fi
}

# Helper: integer absolute-tolerance closeness
check_int_close() {
  local label="$1" want="$2" got="$3" tol="$4"
  if [ -z "$want" ] || [ "$want" = "null" ]; then return 0; fi
  if [ -z "$got" ]; then
    echo "    [diff] $label: got=<empty> expected=$want+/-$tol"
    fail=1
    return 0
  fi
  local ok
  ok="$(awk -v w="$want" -v g="$got" -v t="$tol" 'BEGIN{ d=g-w; if (d<0) d=-d; print (d<=t)?"1":"0" }')"
  if [ "$ok" != "1" ]; then
    echo "    [diff] $label: got=$got expected=$want+/-$tol"
    fail=1
  fi
}

# ---------- Research-paper-domain marker extraction (T107) ----------
# Per-research-paper marker classes:
#   class="forest-plot"                       -> forestPlotCount
#   class="forest-plot-row" (within plots)    -> expectedForestPlotStudies
#   data-pooled-hr="<val>" or
#     class="forest-pooled" containing <val>  -> pooledHr
#   data-i2="<val>" or text 'I²=NN' near plot -> i2
#   class="mcq-widget"                        -> mcqCount (reuses code marker)
#   data-section="<X>"                        -> sectionStructure (CSV)
#   data-speaker="dr-hofmann"                 -> drHofmannDialoguePresent
#   data-key-concept="<X>" or
#     class="key-concept" data-concept="<X>"  -> keyConcepts (CSV)
#   data-speaker="<X>"                        -> personaSpeakers (CSV)
#
# Echoes a single space-separated record:
#   "<forest> <studies> <pooled_hr> <i2> <mcq> <sections_csv>
#    <hofmann> <concepts_csv> <speakers_csv>"
extract_research_paper_fields() {
  local html="$1"
  local forest studies pooled_hr i2 mcq hofmann sections_csv concepts_csv speakers_csv

  forest="$(count_marker "$html" "forest-plot")"
  mcq="$(count_marker "$html" "mcq-widget")"

  # Forest plot rows — count occurrences of class="forest-plot-row" anywhere.
  studies="$(grep -oE "class=[\"'][^\"']*\\bforest-plot-row\\b[^\"']*[\"']" "$html" 2>/dev/null | wc -l | awk '{print $1}')"

  # Pooled HR — primary: data-pooled-hr="<val>"
  pooled_hr="$(grep -oE 'data-pooled-hr=[\"'"'"'][0-9.]+[\"'"'"']' "$html" 2>/dev/null \
    | sed -E 's/data-pooled-hr=[\"'"'"']([0-9.]+)[\"'"'"']/\1/' | head -1 || true)"
  # Fallback: class="forest-pooled" ... <val>
  if [ -z "$pooled_hr" ]; then
    pooled_hr="$(grep -oE "class=[\"'][^\"']*\\bforest-pooled\\b[^\"']*[\"'][^<]*[0-9]+\\.[0-9]+" "$html" 2>/dev/null \
      | grep -oE '[0-9]+\.[0-9]+' | head -1 || true)"
  fi
  pooled_hr="${pooled_hr:-}"

  # I^2 — primary: data-i2="NN"
  i2="$(grep -oE 'data-i2=[\"'"'"'][0-9]+[\"'"'"']' "$html" 2>/dev/null \
    | sed -E 's/data-i2=[\"'"'"']([0-9]+)[\"'"'"']/\1/' | head -1 || true)"
  # Fallback: I²=NN textual near forest-plot
  if [ -z "$i2" ]; then
    i2="$(grep -oE 'I[²2]\s*=\s*[0-9]+' "$html" 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
  fi
  i2="${i2:-}"

  # Section structure — unique data-section="..." values, CSV.
  sections_csv="$(grep -oE 'data-section=[\"'"'"'][^\"'"'"']+[\"'"'"']' "$html" 2>/dev/null \
    | sed -E 's/data-section=[\"'"'"']([^\"'"'"']+)[\"'"'"']/\1/' \
    | sort -u | paste -sd, - 2>/dev/null || true)"
  sections_csv="${sections_csv:-}"

  # Dr. Hofmann dialogue — at least one data-speaker="dr-hofmann"
  local hofmann_count
  hofmann_count="$(grep -oE 'data-speaker=[\"'"'"']dr-hofmann[\"'"'"']' "$html" 2>/dev/null | wc -l | awk '{print $1}')"
  if [ "$hofmann_count" -ge 1 ]; then
    hofmann="true"
  else
    hofmann="false"
  fi

  # Key concepts — primary: data-key-concept; fallback: data-concept on key-concept class
  concepts_csv="$(grep -oE 'data-key-concept=[\"'"'"'][^\"'"'"']+[\"'"'"']' "$html" 2>/dev/null \
    | sed -E 's/data-key-concept=[\"'"'"']([^\"'"'"']+)[\"'"'"']/\1/' \
    | sort -u | paste -sd, - 2>/dev/null || true)"
  if [ -z "$concepts_csv" ]; then
    concepts_csv="$(grep -oE 'data-concept=[\"'"'"'][^\"'"'"']+[\"'"'"']' "$html" 2>/dev/null \
      | sed -E 's/data-concept=[\"'"'"']([^\"'"'"']+)[\"'"'"']/\1/' \
      | sort -u | paste -sd, - 2>/dev/null || true)"
  fi
  concepts_csv="${concepts_csv:-}"

  # Persona speakers — unique data-speaker values, CSV.
  speakers_csv="$(grep -oE 'data-speaker=[\"'"'"'][^\"'"'"']+[\"'"'"']' "$html" 2>/dev/null \
    | sed -E 's/data-speaker=[\"'"'"']([^\"'"'"']+)[\"'"'"']/\1/' \
    | sort -u | paste -sd, - 2>/dev/null || true)"
  speakers_csv="${speakers_csv:-}"

  echo "$forest $studies ${pooled_hr:-_} ${i2:-_} $mcq ${sections_csv:-_} $hofmann ${concepts_csv:-_} ${speakers_csv:-_}"
}

# ---------- US6 extensibility regression helpers (T114) ----------
# SC-007: extending Chiron to a new domain MUST require zero changes under
# skill/lib/, skill/ingest-adapters/, or skill/shell/. The 3 catalog dirs
# (concepts/, curricula/, personas/) are the ONLY allowed surface.
#
# Strategy: capture `git status --porcelain` of the 3 pipeline dirs once at
# the start of the run, then re-check after the test branch executes. Any
# delta (new/modified file) for the snapshotted directory FAILS the test.
US6_PIPELINE_DIRS=("skill/lib" "skill/ingest-adapters" "skill/shell")
US6_REPO_ROOT=""
US6_BASELINE=""

us6_capture_baseline() {
  # us6_capture_baseline — populate US6_BASELINE with `git status --porcelain`
  # restricted to the pipeline dirs. Idempotent: only runs once per script
  # invocation. Silently no-ops if not in a git repo.
  if [ -n "$US6_BASELINE" ]; then return 0; fi
  local root
  root="$(cd "$SCRIPT_DIR" && git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -z "$root" ] || ! command -v git >/dev/null 2>&1; then
    US6_REPO_ROOT="__nogit__"
    US6_BASELINE="__nogit__"
    return 0
  fi
  US6_REPO_ROOT="$root"
  US6_BASELINE="$(cd "$root" && git status --porcelain -- "${US6_PIPELINE_DIRS[@]}" 2>/dev/null || true)"
  US6_BASELINE="${US6_BASELINE:-__clean__}"
}

us6_check_regression() {
  # us6_check_regression — compare current `git status --porcelain` of the
  # pipeline dirs against the baseline. Sets fail=1 (caller scope) on any
  # delta. No-op when git is unavailable.
  if [ "$US6_BASELINE" = "__nogit__" ] || [ -z "$US6_REPO_ROOT" ]; then
    echo "    [info] us6-extensibility: git unavailable — skipping pipeline-dir check"
    return 0
  fi
  local now baseline
  now="$(cd "$US6_REPO_ROOT" && git status --porcelain -- "${US6_PIPELINE_DIRS[@]}" 2>/dev/null || true)"
  now="${now:-__clean__}"
  baseline="$US6_BASELINE"
  if [ "$now" = "$baseline" ]; then
    echo "    [ok] us6-extensibility: no changes under ${US6_PIPELINE_DIRS[*]}"
    return 0
  fi
  # Compute the delta (lines in $now not in $baseline) for a focused error.
  local delta
  delta="$(comm -23 <(printf '%s\n' "$now" | sort -u) <(printf '%s\n' "$baseline" | sort -u) 2>/dev/null || true)"
  if [ -z "$delta" ]; then
    delta="$now"
  fi
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    [ "$line" = "__clean__" ] && continue
    # Identify which pipeline dir was touched for the error message.
    local touched="<unknown>"
    for d in "${US6_PIPELINE_DIRS[@]}"; do
      case "$line" in
        *"$d"*) touched="$d/$(echo "$line" | awk '{print $NF}')" ; break ;;
      esac
    done
    echo "    [diff] SC-007 violated — extending to new domain caused changes to $touched ($line)"
    fail=1
  done <<< "$delta"
}

# ---------- Validation phase ----------
FAILS=0
SKIPS=0
PASSES=0

# Capture baseline once before any per-input validation runs.
us6_capture_baseline

for name in "${INPUTS[@]}"; do
  mode="${INPUT_MODE[$name]:-A}"
  snap="$SNAPSHOT_DIR/$name.json"
  base_dir="${CHIRON_LESSON_DIR:+$CHIRON_LESSON_DIR/$name}"
  base_dir="${base_dir:-/tmp/chiron-test-$name}"
  html="$base_dir/lesson.html"

  echo
  echo "[validate] $name (mode-$mode)"

  # ---------- Mode-B branch: case-study handoff validation ----------
  if [ "$mode" = "B" ]; then
    expected_handoff="$GOLDEN_DIR/$name/expected-handoff.json"
    runtime_handoff="$base_dir/case-study-handoff.json"
    echo "  expected-handoff: $expected_handoff"
    echo "  runtime-handoff:  $runtime_handoff"

    if [ ! -f "$runtime_handoff" ]; then
      if [ "$STRICT" -eq 1 ]; then
        echo "  [FAIL] case-study-handoff.json missing (--strict)"
        FAILS=$(( FAILS + 1 ))
      else
        echo "  [skip] no case-study-handoff.json found — generate first"
        SKIPS=$(( SKIPS + 1 ))
      fi
      continue
    fi

    fail=0
    # Compare each required key. Values may be nested (metadata.domain).
    # Use jq when available; fall back to python3.
    handoff_get() {
      local f="$1" path="$2"
      if [ "$HAS_JQ" -eq 1 ]; then
        jq -r --arg p "$path" '
          ($p | split(".")) as $keys
          | reduce $keys[] as $k (.; if . == null then null else .[$k] // null end)
          | if . == null then "" elif type == "object" or type == "array" then tojson else tostring end
        ' "$f" 2>/dev/null
      else
        python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
for k in sys.argv[2].split('.'):
    if isinstance(d, dict) and k in d:
        d = d[k]
    else:
        d = None
        break
if d is None: print('')
elif isinstance(d, (list, dict, bool)): print(json.dumps(d))
else: print(d)
" "$f" "$path" 2>/dev/null
      fi
    }

    for key in kind siblingSkillPath modeReason metadata.domain metadata.sourceType metadata.briefSchemaVersion; do
      want="$(handoff_get "$expected_handoff" "$key")"
      got="$(handoff_get "$runtime_handoff" "$key")"
      if [ -z "$want" ]; then
        echo "    [info] expected-handoff missing key $key — skipping"
        continue
      fi
      if [ -z "$got" ]; then
        echo "    [diff] handoff key '$key' missing in runtime handoff (expected=$want)"
        fail=1
        continue
      fi
      if [ "$want" != "$got" ]; then
        echo "    [diff] handoff key '$key': got=$got expected=$want"
        fail=1
      fi
    done

    # Mode-B inputs only run SC-007 if explicitly tagged (case-study-incident isn't).
    reg_check_b="$(handoff_get "$expected_handoff" "regressionCheckType")"
    if [ "$reg_check_b" = "us6-extensibility" ]; then
      echo "  us6-extensibility: verifying zero changes under ${US6_PIPELINE_DIRS[*]}"
      us6_check_regression
    fi

    if [ "$fail" -eq 0 ]; then
      echo "  [PASS] $name"
      PASSES=$(( PASSES + 1 ))
    else
      echo "  [FAIL] $name"
      FAILS=$(( FAILS + 1 ))
    fi
    continue
  fi

  # ---------- Mode-A branch: snapshot diff ----------
  echo "  snapshot: $snap"
  echo "  lesson:   $html"

  if [ ! -f "$snap" ]; then
    echo "  [FAIL] snapshot missing at $snap"
    FAILS=$(( FAILS + 1 ))
    continue
  fi

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

  # ---------- Domain dispatch (T065) ----------
  # Detect from snapshot's "domain" field. Fallback to "code" when absent so
  # legacy snapshots (code-small-repo) keep their existing semantics.
  domain="$(json_get "$snap" domain)"
  domain="${domain:-code}"
  echo "  domain:  $domain"

  case "$domain" in
    language-it|language-de|language)
      read -r got_fb got_cloze got_audio got_match got_fuzzy got_speakers \
        < <(extract_italian_fields "$html")
      echo "  italian: fill_blank=$got_fb cloze=$got_cloze audio_tts=$got_audio matching=$got_match fuzzy=$got_fuzzy speakers=[${got_speakers}]"

      exp_fb_min="$(json_get "$snap" fillBlankCountMin)"
      exp_cloze_min="$(json_get "$snap" clozeCountMin)"
      exp_audio_min="$(json_get "$snap" mariaAudioClipCountMin)"
      exp_match_min="$(json_get "$snap" matchingPairCountMin)"
      exp_fuzzy="$(json_get "$snap" fuzzyAccentCheck)"
      exp_speakers="$(json_get "$snap" expectedPersonaSpeakers)"

      check_min "fillBlankCount"        "$exp_fb_min"    "$got_fb"
      check_min "clozeCount"            "$exp_cloze_min" "$got_cloze"
      check_min "mariaAudioClipCount"   "$exp_audio_min" "$got_audio"
      check_min "matchingPairCount"     "$exp_match_min" "$got_match"

      if [ -n "$exp_fuzzy" ] && [ "$exp_fuzzy" != "$got_fuzzy" ]; then
        echo "    [diff] fuzzyAccentCheck: got=$got_fuzzy expected=$exp_fuzzy"
        fail=1
      fi

      # expectedPersonaSpeakers is a JSON array (e.g. ["maria","alice"]).
      # Verify each appears at least once in the rendered HTML's data-speaker set.
      if [ -n "$exp_speakers" ] && [ "$exp_speakers" != "null" ]; then
        # Strip JSON brackets/quotes -> comma-separated list
        want_list="$(echo "$exp_speakers" | tr -d '[]"' | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' || true)"
        while IFS= read -r want_sp; do
          [ -z "$want_sp" ] && continue
          if ! echo ",${got_speakers}," | grep -q ",${want_sp},"; then
            echo "    [diff] expectedPersonaSpeakers: '$want_sp' not found (got=[${got_speakers}])"
            fail=1
          fi
        done <<< "$want_list"
      fi
      ;;
    medicine)
      # T097: medicine-domain validators (vignettes, hammer range, key-info
      # chips, attending tips, chem/molecule renderers, verifier cycle).
      read -r got_vig got_hammers got_kinfo_min got_atip \
              got_chem got_molec got_taxonomy got_verifier \
        < <(extract_medicine_fields "$html")

      # Restore empty markers from sentinel "_" for cleaner display.
      [ "$got_hammers"  = "_" ] && got_hammers=""
      [ "$got_taxonomy" = "_" ] && got_taxonomy=""

      echo "  medicine: vignettes=$got_vig hammers=[${got_hammers}] keyinfo_min=$got_kinfo_min attending_tips=$got_atip chem=$got_chem molecules=$got_molec taxonomy=[${got_taxonomy}] verifier_cycles=$got_verifier"

      exp_vig_min="$(json_get "$snap" vignetteCountMin)"
      exp_taxonomy="$(json_get "$snap" vignetteTaxonomyCoverage)"
      exp_hammer_present="$(json_get "$snap" hammerRangePresent)"
      exp_kinfo_min="$(json_get "$snap" keyInfoTagsPerVignetteMin)"
      exp_atip_per_vig="$(json_get "$snap" attendingTipPerVignette)"
      exp_chem_min="$(json_get "$snap" chemicalReactionCountMin)"
      exp_molec_min="$(json_get "$snap" moleculeCountMin)"
      exp_verifier_min="$(json_get "$snap" verifierCycleCountMin)"

      check_min "vignetteCount"          "$exp_vig_min"      "$got_vig"
      check_min "chemicalReactionCount"  "$exp_chem_min"     "$got_chem"
      check_min "moleculeCount"          "$exp_molec_min"    "$got_molec"
      check_min "verifierCycleCount"     "$exp_verifier_min" "$got_verifier"

      # Per-vignette key-info chip floor (every vignette must clear the floor;
      # extractor returns the minimum observed across vignettes).
      if [ -n "$exp_kinfo_min" ] && [ "$exp_kinfo_min" != "null" ]; then
        if [ "$got_vig" -gt 0 ] && [ "$got_kinfo_min" -lt "$exp_kinfo_min" ]; then
          echo "    [diff] keyInfoTagsPerVignette: min observed=$got_kinfo_min expected>=$exp_kinfo_min (per vignette)"
          fail=1
        fi
      fi

      # Hammer range: 1, 2, 3 must ALL be present when expected true.
      if [ "$exp_hammer_present" = "true" ]; then
        for lvl in 1 2 3; do
          if ! echo ",${got_hammers}," | grep -q ",${lvl},"; then
            echo "    [diff] hammerRangePresent: level $lvl missing (got=[${got_hammers}])"
            fail=1
          fi
        done
      fi

      # Attending tip per vignette: count(.attending-tip) === count(vignettes).
      if [ "$exp_atip_per_vig" = "true" ]; then
        if [ "$got_atip" -ne "$got_vig" ]; then
          echo "    [diff] attendingTipPerVignette: tips=$got_atip vignettes=$got_vig (must match)"
          fail=1
        fi
      fi

      # Vignette taxonomy coverage — array containment.
      check_array_contains "vignetteTaxonomyCoverage" "$exp_taxonomy" "$got_taxonomy"
      ;;
    research-paper)
      # T107: research-paper-domain validators (forest plots, sections,
      # MCQs, Dr. Hofmann persona, key concepts, persona speakers).
      read -r got_forest got_studies got_pooled got_i2 got_rp_mcq \
              got_sections got_hofmann got_concepts got_rp_speakers \
        < <(extract_research_paper_fields "$html")

      # Restore empty markers from sentinel "_" for cleaner display + checks.
      [ "$got_pooled"      = "_" ] && got_pooled=""
      [ "$got_i2"          = "_" ] && got_i2=""
      [ "$got_sections"    = "_" ] && got_sections=""
      [ "$got_concepts"    = "_" ] && got_concepts=""
      [ "$got_rp_speakers" = "_" ] && got_rp_speakers=""

      echo "  research-paper: forest=$got_forest studies=$got_studies pooledHr=${got_pooled:-<none>} i2=${got_i2:-<none>} mcq=$got_rp_mcq sections=[${got_sections}] hofmann=$got_hofmann concepts=[${got_concepts}] speakers=[${got_rp_speakers}]"

      exp_section_count="$(json_get "$snap" sectionCount)"
      tol_section_count="$(json_get "$snap" sectionCountTolerance)"
      exp_section_struct="$(json_get "$snap" expectedSectionStructure)"
      exp_mcq_min="$(json_get "$snap" mcqCountMin)"
      exp_forest_min="$(json_get "$snap" forestPlotCountMin)"
      exp_forest_studies="$(json_get "$snap" expectedForestPlotStudies)"
      exp_pooled_hr="$(json_get "$snap" expectedPooledHr)"
      exp_i2="$(json_get "$snap" expectedI2)"
      exp_hofmann="$(json_get "$snap" drHofmannDialoguePresent)"
      exp_concepts="$(json_get "$snap" expectedKeyConcepts)"
      exp_rp_speakers="$(json_get "$snap" expectedPersonaSpeakers)"

      # Section count — exact when tolerance is 0/empty, else range.
      got_section_count=0
      if [ -n "$got_sections" ]; then
        got_section_count="$(echo "$got_sections" | tr ',' '\n' | grep -v '^$' | wc -l | awk '{print $1}')"
      fi
      if [ -n "$exp_section_count" ] && [ "$exp_section_count" != "null" ]; then
        if [ -z "$tol_section_count" ] || [ "$tol_section_count" = "null" ] || [ "$tol_section_count" = "0" ]; then
          check_eq "sectionCount" "$exp_section_count" "$got_section_count"
        else
          check_tol "sectionCount" "$exp_section_count" "$tol_section_count" "$got_section_count"
        fi
      fi

      # Section structure — array containment.
      check_array_contains "expectedSectionStructure" "$exp_section_struct" "$got_sections"

      # Min checks.
      check_min "mcqCount"        "$exp_mcq_min"    "$got_rp_mcq"
      check_min "forestPlotCount" "$exp_forest_min" "$got_forest"

      # Forest-plot-row exact count.
      check_eq "expectedForestPlotStudies" "$exp_forest_studies" "$got_studies"

      # Pooled HR within +/- 0.02.
      check_float_close "expectedPooledHr" "$exp_pooled_hr" "$got_pooled" "0.02"

      # I^2 within +/- 2 (integer).
      check_int_close "expectedI2" "$exp_i2" "$got_i2" "2"

      # Dr. Hofmann dialogue presence.
      if [ -n "$exp_hofmann" ] && [ "$exp_hofmann" != "null" ]; then
        if [ "$exp_hofmann" != "$got_hofmann" ]; then
          echo "    [diff] drHofmannDialoguePresent: got=$got_hofmann expected=$exp_hofmann"
          fail=1
        fi
      fi

      # Key concepts + persona speakers — array containment.
      check_array_contains "expectedKeyConcepts"     "$exp_concepts"     "$got_concepts"
      check_array_contains "expectedPersonaSpeakers" "$exp_rp_speakers"  "$got_rp_speakers"
      ;;
    music-theory)
      # T114: minimal validators for the US6 extensibility regression input.
      # The fixture is a single paragraph — chapter count is the only marker
      # check. Domain-specific markers are intentionally NOT validated here
      # because the whole point of SC-007 is that extending to a new domain
      # required no new marker-extraction code in skill/lib/.
      :
      ;;
    code|*)
      # Default: code-domain markers already validated above.
      :
      ;;
  esac

  # ---------- US6 extensibility regression check (T114, SC-007) ----------
  # Honor `regressionCheckType` as a no-op for everything else.
  reg_check="$(json_get "$snap" regressionCheckType)"
  if [ "$reg_check" = "us6-extensibility" ]; then
    echo "  us6-extensibility: verifying zero changes under ${US6_PIPELINE_DIRS[*]}"
    us6_check_regression
  fi

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
