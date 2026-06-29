#!/usr/bin/env bash
# One-shot installer for the Sprite Voice Bridge.
#
# Run this inside a Fly.io Sprite (it uses `sprite-env` to register services and
# `sudo apt-get` to install PulseAudio/ALSA). Idempotent — safe to re-run.
set -euo pipefail

BRIDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUN="$(command -v bun || true)"
[ -n "$BUN" ] || { echo "✗ bun not found on PATH — install it from https://bun.sh"; exit 1; }
command -v sprite-env >/dev/null || { echo "✗ sprite-env not found — run this inside a Fly.io Sprite"; exit 1; }

# How you reach the bridge from your browser:
#   http   (default) — the sprite proxy exposes it at the public sprite URL.
#                      Consumes the sprite's single --http-port slot.
#   proxy           — no public port. Reach it with `sprite proxy 8080` from
#                      your laptop and open http://localhost:8080 (localhost is
#                      a secure context, so the mic works over plain http).
MODE="${1:-http}"
case "$MODE" in
  http|proxy) ;;
  *) echo "Usage: ./setup.sh [http|proxy]"; exit 1 ;;
esac

echo "==> Bridge directory: $BRIDGE_DIR  (mode: $MODE)"

echo "==> Installing system packages (PulseAudio + ALSA)…"
sudo apt-get update -qq || echo "    (apt-get update failed; continuing with cached indexes)"
sudo apt-get install -y pulseaudio pulseaudio-utils alsa-utils libasound2-plugins libsox-fmt-pulse sox

echo "==> Routing the default ALSA capture device into the bridge (~/.asoundrc)…"
ASOUND="$HOME/.asoundrc"
if [ -f "$ASOUND" ] && ! grep -q "voice-bridge" "$ASOUND"; then
  [ -e "$ASOUND.bak" ] || cp "$ASOUND" "$ASOUND.bak"
  echo "    (backed up existing ~/.asoundrc to ~/.asoundrc.bak)"
fi
cat > "$ASOUND" <<EOF
# voice-bridge: send the default ALSA capture device to the bridge PulseAudio
# instance, whose "micbridge" source is fed by your browser over WebSocket.
pcm.!default {
    type pulse
    server "unix:$BRIDGE_DIR/run/pulse/native"
}
ctl.!default {
    type pulse
    server "unix:$BRIDGE_DIR/run/pulse/native"
}
EOF

echo "==> Installing server dependencies…"
( cd "$BRIDGE_DIR" && bun install )

echo "==> Building the web UI…"
( cd "$BRIDGE_DIR/web" && bun install && bun run build )

echo "==> Registering sprite services…"
for s in voice-bridge voice-drain voice-pulse; do
  sprite-env services delete "$s" >/dev/null 2>&1 || true
done
sprite-env services create voice-pulse \
  --cmd "$BRIDGE_DIR/start-pulse.sh" \
  --env "BRIDGE_DIR=$BRIDGE_DIR" --no-stream
sprite-env services create voice-drain \
  --cmd "$BRIDGE_DIR/drain.sh" \
  --env "BRIDGE_DIR=$BRIDGE_DIR" --needs voice-pulse --no-stream
# Only "http" mode claims the sprite's single public --http-port slot.
HTTP_PORT_FLAG=()
[ "$MODE" = "http" ] && HTTP_PORT_FLAG=(--http-port 8080)
sprite-env services create voice-bridge \
  --cmd "$BUN" --args server.js --dir "$BRIDGE_DIR" \
  "${HTTP_PORT_FLAG[@]}" \
  --env "BRIDGE_DIR=$BRIDGE_DIR,PORT=8080" --needs voice-pulse --no-stream

echo
echo "✅ Done."
if [ "$MODE" = "http" ]; then
  URL="$(sprite-env info 2>/dev/null | sed -n 's/.*"sprite_url":"\([^"]*\)".*/\1/p' || true)"
  echo "   1. Open  ${URL:-<your sprite URL>}/  in a browser and click \"Start microphone\"."
  echo "   2. In your Claude Code terminal run /voice and use push-to-talk."
else
  echo "   1. On your local machine:  sprite proxy 8080"
  echo "   2. Open  http://localhost:8080/  and click \"Start microphone\"."
  echo "   3. In your Claude Code terminal run /voice and use push-to-talk."
  echo
  echo "   (proxy mode leaves your sprite's public --http-port slot free.)"
fi
