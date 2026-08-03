#!/usr/bin/env bash
# ============================================================================
# Sync the arcade into the aix-proto app.
#
# The arcade has one source of truth — arcade/ in the CostBot repo. GitHub Pages
# serves that directly; the aix-proto app serves a COPY, because a Docker build
# needs real files in its context (a symlink into another repo would not survive
# COPY).
#
# TWO sets of files move, in the same direction:
#
#   arcade/*        ->  <app>/public/    the games, art and shared modules
#   arcade/app/*    ->  <app>/           server.js, db.js, manifest.json, tests…
#
# The second set exists because those files used to live ONLY in ~/aix-proto.
# That bit us: a session edited server.js there, in a clone that was a commit
# behind, and nothing in the CostBot repo knew. Mirroring them here gives them a
# home, a history and a diff.
#
#   ./sync-to-app.sh            copy both sets, then report what changed
#   ./sync-to-app.sh --check    report drift only, change nothing (exit 1 if drifted)
#   ./sync-to-app.sh --adopt    pull app-side edits BACK into arcade/app/
#   ./sync-to-app.sh --force    overwrite app-side files even when they differ
#
# The app files are copied GUARDED: if one differs from its mirror, the script
# stops rather than overwriting, and tells you to --adopt (keep the app-side
# edit) or --force (discard it). public/ is never guarded — it is generated.
#
# For a fast local loop you usually do NOT need this at all — run the app with
# ARCADE_PUBLIC pointed straight at the source and skip copying entirely:
#   ARCADE_PUBLIC=~/projects/costbot/arcade node server.js
# ============================================================================
set -euo pipefail

SRC="${ARCADE_SRC:-$HOME/projects/costbot/arcade}"
DEST="${ARCADE_DEST:-$HOME/aix-proto/examples/costbot-arcade/public}"
APP_DIR="$(dirname "$DEST")"
APP_SRC="$SRC/app"

MODE=copy
case "${1:-}" in
  --check) MODE=check ;;
  --adopt) MODE=adopt ;;
  --force) MODE=force ;;
  '') ;;
  *) echo "usage: $0 [--check|--adopt|--force]" >&2; exit 2 ;;
esac

# The app files that live in BOTH places. Anything not listed here is either
# generated (node_modules, public/) or owned by the platform scaffold and must
# never be written from this side:
#   .manifest.json.aix.lock / .package.json.aix.lock — empty sentinels marking
#   manifest.json and package.json as scaffold-managed. They carry no content,
#   so there is nothing to mirror.
#   README.md — the app dir's copy is untouched starter boilerplate ("Your
#   aix-proto app", pointing at examples/_template). arcade/app/README.md is a
#   DIFFERENT document explaining this mirror, so the two must not overwrite
#   each other. Leave the app-side one to the template.
APP_FILES=(
  server.js db.js blob.js app.test.js
  manifest.json package.json package-lock.json
  Dockerfile .dockerignore
)

# Things that belong to the source repo but must not ship in the image.
EXCLUDES=(
  --exclude 'shots/'          # generated test screenshots
  --exclude 'smoketest.js'    # dev-only harness, needs playwright
  --exclude '.gitignore'
  --exclude 'tools/'          # this script
  --exclude 'app/'            # the app mirror — server source, NOT web content
  --exclude '*.md'
)

if [[ ! -d "$SRC" ]]; then
  echo "error: arcade source not found at $SRC" >&2
  exit 2
fi
if [[ ! -d "$APP_DIR" ]]; then
  echo "error: aix-proto app not found at $APP_DIR" >&2
  echo "       scaffold it first, or set ARCADE_DEST" >&2
  exit 2
fi
if [[ ! -d "$APP_SRC" ]]; then
  echo "error: app mirror not found at $APP_SRC" >&2
  exit 2
fi

echo "source : $SRC"
echo "dest   : $DEST"
echo "app    : $APP_DIR"
echo

# ---------------------------------------------------------------------------
# the app files — content-compared, and guarded because these are hand-written
# ---------------------------------------------------------------------------
DIFFERS=()
MISSING=()
for f in "${APP_FILES[@]}"; do
  if [[ ! -f "$APP_SRC/$f" ]]; then
    echo "error: $APP_SRC/$f is missing from the mirror" >&2
    exit 2
  fi
  if [[ ! -f "$APP_DIR/$f" ]]; then
    MISSING+=("$f")
  elif ! cmp -s "$APP_SRC/$f" "$APP_DIR/$f"; then
    DIFFERS+=("$f")
  fi
done

report_app_drift() {
  local f plus minus
  for f in "${DIFFERS[@]:-}"; do
    [[ -n "$f" ]] || continue
    # +N/-N so the size and direction of an unexpected change is visible at a glance
    plus="$(diff "$APP_SRC/$f" "$APP_DIR/$f" | grep -c '^>' || true)"
    minus="$(diff "$APP_SRC/$f" "$APP_DIR/$f" | grep -c '^<' || true)"
    printf '  DIFFERS  app/%-20s app-side +%s/-%s lines vs the mirror\n' "$f" "$plus" "$minus"
  done
  for f in "${MISSING[@]:-}"; do
    [[ -n "$f" ]] || continue
    printf '  ABSENT   app/%-20s not in the app dir yet\n' "$f"
  done
}

case "$MODE" in
  adopt)
    if [[ ${#DIFFERS[@]} -eq 0 ]]; then
      echo "app    : nothing to adopt, the mirror already matches"
    else
      for f in "${DIFFERS[@]}"; do
        cp -p "$APP_DIR/$f" "$APP_SRC/$f"
        echo "  adopted app/$f  <- $APP_DIR/$f"
      done
      echo
      echo "app    : ${#DIFFERS[@]} file(s) pulled back into the mirror — commit them"
    fi
    exit 0
    ;;
  check)
    if [[ ${#DIFFERS[@]} -gt 0 || ${#MISSING[@]} -gt 0 ]]; then
      echo "app    : DRIFTED"
      report_app_drift
      echo
    else
      echo "app    : in sync ✅"
    fi
    ;;
  copy)
    if [[ ${#DIFFERS[@]} -gt 0 ]]; then
      echo "app    : REFUSING to overwrite — the app dir has changes the mirror does not"
      report_app_drift
      cat <<'MSG'

  Those edits exist only in the app dir. Overwriting them is how work gets lost,
  so pick one deliberately:

    ./sync-to-app.sh --adopt    keep them: copy them back into arcade/app/
    ./sync-to-app.sh --force    discard them: overwrite from arcade/app/
MSG
      exit 1
    fi
    ;;
esac

if [[ "$MODE" == copy || "$MODE" == force ]]; then
  COPIED=0
  for f in "${APP_FILES[@]}"; do
    if [[ ! -f "$APP_DIR/$f" ]] || ! cmp -s "$APP_SRC/$f" "$APP_DIR/$f"; then
      cp -p "$APP_SRC/$f" "$APP_DIR/$f"
      echo "  app/$f -> $APP_DIR/$f"
      COPIED=$((COPIED + 1))
    fi
  done
  if [[ $COPIED -eq 0 ]]; then
    echo "app    : already in sync, nothing copied"
  else
    echo "app    : $COPIED file(s) copied"
  fi
  echo
fi

# ---------------------------------------------------------------------------
# public/ — generated, so never guarded
# --delete so a file removed from the source is removed from the app copy too;
# without it a deleted asset would linger in the image forever.
# ---------------------------------------------------------------------------
RSYNC_ARGS=(-a --delete "${EXCLUDES[@]}" "$SRC/" "$DEST/")

if [[ "$MODE" == check ]]; then
  # -c compares CONTENT, not size+mtime. A git checkout rewrites every mtime, so
  # without this a freshly cloned tree reports wall-to-wall drift that is not real.
  # Then drop the itemize lines whose first character is '.', meaning "no transfer
  # needed, attributes only" — a directory or file whose bytes already match.
  DRIFT="$(rsync -n -i -c "${RSYNC_ARGS[@]}" | grep -v '^$' | grep -v '^\.' || true)"
  if [[ -z "$DRIFT" ]]; then
    echo "public : in sync ✅"
    [[ ${#DIFFERS[@]} -eq 0 && ${#MISSING[@]} -eq 0 ]] && exit 0
    exit 1
  fi
  echo "public : DRIFTED — the app copy differs from source"
  echo "$DRIFT" | sed 's/^/  /'
  echo
  echo "run without --check to bring them back in line"
  exit 1
fi

CHANGED="$(rsync -i "${RSYNC_ARGS[@]}" | grep -v '^$' || true)"
if [[ -z "$CHANGED" ]]; then
  echo "public : already in sync, nothing copied"
else
  echo "public : synced"
  echo "$CHANGED" | sed 's/^/  /'
fi

# The app mirror is SERVER source. If it ever lands in public/ it ships in the
# image and is served at /a/<slug>/app/ to every authenticated user — so this is
# asserted rather than trusted to the exclude list above surviving future edits.
if [[ -e "$DEST/app" ]]; then
  echo "error: $DEST/app exists — the app mirror leaked into web-served content" >&2
  echo "       restore the --exclude 'app/' rule above, then delete it" >&2
  exit 1
fi

# Guard the failure that actually bit us: a file the Dockerfile COPYs going missing.
MISSING_COPY=0
while read -r line; do
  for tok in $line; do
    case "$tok" in
      ./*|/app/*|--from=*) continue ;;
      examples/*)
        [[ -e "$HOME/aix-proto/$tok" ]] || { echo "  MISSING Dockerfile source: $tok"; MISSING_COPY=1; } ;;
    esac
  done
done < <(grep '^COPY' "$APP_DIR/Dockerfile" 2>/dev/null | sed 's/^COPY //')
[[ $MISSING_COPY -eq 1 ]] && { echo "error: the image build will fail on the paths above" >&2; exit 1; }

echo "files  : $(find "$DEST" -type f | wc -l)   size: $(du -sh "$DEST" | cut -f1)"
echo "docker : every COPY source resolves ✅"
