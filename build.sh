#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NG_DIR="$SCRIPT_DIR/calorie-tracker-ng"

echo "==> Installing dependencies..."
cd "$NG_DIR"
npm ci

echo "==> Building Angular app (production)..."
npm run build

echo ""
echo "Build complete. Output: $NG_DIR/dist/calorie-tracker-ng/browser"
