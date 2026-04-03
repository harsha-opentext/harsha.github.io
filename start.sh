#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NG_DIR="$SCRIPT_DIR/calorie-tracker-ng"
PORT="${1:-4200}"

echo "==> Starting Angular dev server on http://0.0.0.0:$PORT ..."
cd "$NG_DIR"
# bind to all interfaces so mobile devices on the LAN can connect
npx ng serve --host 0.0.0.0 --port "$PORT" --open
