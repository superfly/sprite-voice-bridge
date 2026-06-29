#!/usr/bin/env bash
# Sprite Voice Bridge — one-line installer. Run it INSIDE a Fly.io Sprite:
#
#   curl -fsSL https://raw.githubusercontent.com/superfly/sprite-voice-bridge/main/install.sh | bash
#
# Proxy mode (no public --http-port slot; reach via `sprite proxy 8080`):
#
#   curl -fsSL https://raw.githubusercontent.com/superfly/sprite-voice-bridge/main/install.sh | bash -s -- proxy
#
# Clones (or updates) the repo and runs setup.sh. Overridable env vars:
#   VOICE_BRIDGE_REPO  (default: the superfly repo)
#   VOICE_BRIDGE_DIR   (default: $HOME/sprite-voice-bridge)
#   VOICE_BRIDGE_MODE  (default: http; or pass the mode as an argument)
set -euo pipefail

REPO="${VOICE_BRIDGE_REPO:-https://github.com/superfly/sprite-voice-bridge.git}"
DIR="${VOICE_BRIDGE_DIR:-$HOME/sprite-voice-bridge}"
MODE="${1:-${VOICE_BRIDGE_MODE:-http}}"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git is required but was not found on PATH."
command -v sprite-env >/dev/null || die "sprite-env not found — run this inside a Fly.io Sprite."

case "$MODE" in
  http|proxy) ;;
  *) die "Unknown mode '$MODE' (use 'http' or 'proxy')." ;;
esac

if [ -d "$DIR/.git" ]; then
  say "Updating existing checkout in $DIR"
  git -C "$DIR" fetch --depth 1 origin main
  git -C "$DIR" reset --hard origin/main
else
  say "Cloning $REPO → $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

say "Running setup ($MODE mode)…"
cd "$DIR"
exec ./setup.sh "$MODE"
