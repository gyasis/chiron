#!/usr/bin/env bash
# Vendor the acolyte bundle into skill/ask/vendor/ — build, copy, prune, verify.
#
# WHY THIS EXISTS
#   The Ask page loads a BUILT copy of acolyte, so an upstream fix does not reach
#   it until someone re-copies the bundle. Done by hand it drifts two ways, and
#   both are silent:
#     1. STALE   — the page keeps running an old acolyte and the fix "didn't work".
#     2. MISSING CHUNK — tsup code-splits the ESM build, so `index.js` imports a
#        sibling `chunk-*.js`. Copy only index.js and the import 404s: the page
#        hangs at boot with NO console error and NO visible failure. That cost a
#        debug cycle once; this script makes it impossible to ship.
#
# USAGE
#   vendor-acolyte.sh            build acolyte, vendor it, verify
#   vendor-acolyte.sh --check    verify only; non-zero if stale/broken (CI, doctor)
#   vendor-acolyte.sh --no-build vendor whatever is already in acolyte/dist
#
#   ACOLYTE_REPO=<path>          override the source repo location
set -euo pipefail

REPO="${ACOLYTE_REPO:-$HOME/Documents/code/acolyte}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$HERE/ask/vendor"
MANIFEST="$VENDOR/VENDORED.json"

MODE=vendor
for a in "$@"; do
  case "$a" in
    --check)    MODE=check ;;
    --no-build) MODE=nobuild ;;
    -h|--help)  sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }

# ---- integrity: every chunk the bundle imports must actually be present ----
verify() {
  local dir="$1" fail=0
  [[ -f "$dir/acolyte.js" ]] || { red "MISSING  $dir/acolyte.js"; return 1; }
  local want
  want="$(grep -oE 'chunk-[A-Za-z0-9_-]+\.js' "$dir/acolyte.js" | sort -u || true)"
  while read -r c; do
    [[ -z "$c" ]] && continue
    if [[ -f "$dir/$c" ]]; then
      echo "  chunk ok        $c"
    else
      red "  CHUNK MISSING   $c  → the page will hang at boot with no error"
      fail=1
    fi
  done <<< "$want"
  # orphans: a chunk left behind by an older build is dead weight and confusing
  for f in "$dir"/chunk-*.js; do
    [[ -e "$f" ]] || continue
    local b; b="$(basename "$f")"
    grep -q "$b" "$dir/acolyte.js" || { ylw "  orphan chunk    $b (not imported — pruned on next vendor)"; }
  done
  return $fail
}

if [[ "$MODE" == check ]]; then
  echo "Checking vendored acolyte in $VENDOR"
  verify "$VENDOR" || exit 1
  if [[ -f "$MANIFEST" && -d "$REPO/.git" ]]; then
    have="$(python3 -c "import json,sys;print(json.load(open('$MANIFEST')).get('commit',''))" 2>/dev/null || true)"
    head="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || true)"
    if [[ -n "$have" && -n "$head" && "$have" != "$head" ]]; then
      ylw "  STALE           vendored $have, acolyte is at $head — run vendor-acolyte.sh"
      exit 1
    fi
    grn "  up to date      acolyte $have"
  fi
  grn "vendored bundle OK"
  exit 0
fi

[[ -d "$REPO" ]] || { red "acolyte repo not found at $REPO (set ACOLYTE_REPO)"; exit 1; }

if [[ "$MODE" == vendor ]]; then
  echo "Building acolyte in $REPO"
  ( cd "$REPO" && npm run build >/dev/null ) || { red "acolyte build FAILED — not vendoring a broken bundle"; exit 1; }
fi

[[ -f "$REPO/dist/index.js" ]] || { red "no $REPO/dist/index.js — build first"; exit 1; }

mkdir -p "$VENDOR"
# prune first so a chunk from an older build can never linger and confuse a diff
rm -f "$VENDOR"/chunk-*.js
cp "$REPO/dist/index.js" "$VENDOR/acolyte.js"
shopt -s nullglob
for f in "$REPO"/dist/chunk-*.js; do cp "$f" "$VENDOR/"; done
shopt -u nullglob

commit="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
dirty=false; git -C "$REPO" diff --quiet 2>/dev/null || dirty=true
python3 - "$MANIFEST" "$commit" "$dirty" <<'PY'
import json, sys, datetime, os
path, commit, dirty = sys.argv[1], sys.argv[2], sys.argv[3] == "true"
json.dump({
    "source": "gyasis/acolyte",
    "commit": commit,
    "dirty": dirty,          # true = vendored from uncommitted work; reproduce before shipping
    "vendored_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "note": "Rebuild with skill/scripts/vendor-acolyte.sh — do not edit these files by hand.",
}, open(path, "w"), indent=2)
print("manifest:", os.path.basename(path))
PY

echo "Verifying"
verify "$VENDOR" || { red "vendored bundle is BROKEN — do not ship"; exit 1; }
$dirty && ylw "  note            acolyte working tree is dirty; vendored from uncommitted work"
grn "vendored acolyte $commit → $VENDOR"
