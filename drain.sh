#!/usr/bin/env bash
# Continuously drain the "micbridge" source so PulseAudio's pipe-source keeps
# reading the FIFO in real time even when /voice isn't capturing. Without this
# the FIFO only drains while a recorder is attached, so browser audio backs up
# and arecord later plays out stale backlog ("No speech detected").
set -euo pipefail

BRIDGE_DIR="${BRIDGE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
export XDG_RUNTIME_DIR="$BRIDGE_DIR/run"
export HOME="${HOME:-/home/$(id -un)}"

exec parec \
  --server="unix:$BRIDGE_DIR/run/pulse/native" \
  --device=micbridge \
  --rate=16000 --channels=1 --format=s16le --raw \
  > /dev/null
