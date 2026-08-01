#!/usr/bin/env bash
# ============================================================================
# Sync the arcade source into the aix-proto app's public/ directory.
#
# The arcade has one source of truth — arcade/ in the CostBot repo. GitHub Pages
# serves that directly; the aix-proto app serves a COPY at examples/costbot-arcade/
# public/, because a Docker build needs real files in its context (a symlink into
# another repo would not survive COPY).
#
# This script is the bridge. Run it before every `aix-proto deploy`.
#
#   ./sync-to-app.sh            copy, then report what changed
#   ./sync-to-app.sh --check    report drift only, change nothing (exit 1 if drifted)
#
# For a fast local loop you usually do NOT need this at all — run the app with
# ARCADE_PUBLIC pointed straight at the source and skip copying entirely:
#   ARCADE_PUBLIC=~/projects/costbot/arcade node server.js
# ============================================================================
set -euo pipefail

SRC="${ARCADE_SRC:-$HOME/projects/costbot/arcade}"
DEST="${ARCADE_DEST:-$HOME/aix-proto/examples/costbot-arcade/public}"
CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

# Things that belong to the source repo but must not ship in the app image.
EXCLUDES=(
  --exclude 'shots/'          # generated test screenshots
  --exclude 'smoketest.js'    # dev-only harness, needs playwright
  --exclude '.gitignore'
  --exclude 'tools/'          # this script
  --exclude '*.md'
)

if [[ ! -d "$SRC" ]]; then
  echo "error: arcade source not found at $SRC" >&2
  exit 2
fi
if [[ ! -d "$(dirname "$DEST")" ]]; then
  echo "error: aix-proto app not found at $(dirname "$DEST")" >&2
  echo "       scaffold it first, or set ARCADE_DEST" >&2
  exit 2
fi

echo "source : $SRC"
echo "dest   : $DEST"

# --delete so a file removed from the source is removed from the app copy too;
# without it a deleted asset would linger in the image forever.
RSYNC_ARGS=(-a --delete "${EXCLUDES[@]}" "$SRC/" "$DEST/")

if [[ $CHECK -eq 1 ]]; then
  DRIFT="$(rsync -n -i "${RSYNC_ARGS[@]}" | grep -v '^$' || true)"
  if [[ -z "$DRIFT" ]]; then
    echo "status : in sync ✅"
    exit 0
  fi
  echo "status : DRIFTED — the app copy differs from source"
  echo "$DRIFT" | sed 's/^/  /'
  echo
  echo "run without --check to bring them back in line"
  exit 1
fi

CHANGED="$(rsync -i "${RSYNC_ARGS[@]}" | grep -v '^$' || true)"
if [[ -z "$CHANGED" ]]; then
  echo "status : already in sync, nothing copied"
else
  echo "status : synced"
  echo "$CHANGED" | sed 's/^/  /'
fi

# Guard the failure that actually bit us: a file the Dockerfile COPYs going missing.
APP_DIR="$(dirname "$DEST")"
MISSING=0
while read -r line; do
  for tok in $line; do
    case "$tok" in
      ./*|/app/*|--from=*) continue ;;
      examples/*)
        [[ -e "$HOME/aix-proto/$tok" ]] || { echo "  MISSING Dockerfile source: $tok"; MISSING=1; } ;;
    esac
  done
done < <(grep '^COPY' "$APP_DIR/Dockerfile" 2>/dev/null | sed 's/^COPY //')
[[ $MISSING -eq 1 ]] && { echo "error: the image build will fail on the paths above" >&2; exit 1; }

echo "files  : $(find "$DEST" -type f | wc -l)   size: $(du -sh "$DEST" | cut -f1)"
echo "docker : every COPY source resolves ✅"
