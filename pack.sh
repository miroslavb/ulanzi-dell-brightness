#!/usr/bin/env bash
# Build a distributable zip of the Ulanzi plugin.
# The zip's top-level entry is the plugin folder, so the user just unzips it into
#   Windows: %APPDATA%\Ulanzi\UlanziDeck\Plugins\
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PLUG="com.ulanzi.dellbrightness.ulanziPlugin"
OUT="$ROOT/dist"

cd "$ROOT/$PLUG"

# Ensure the single runtime dependency (ws) is vendored.
if [ ! -d node_modules/ws ]; then
  echo "installing ws…"
  npm install --omit=dev --no-audit --no-fund
fi

mkdir -p "$OUT"
ZIP="$OUT/${PLUG}-$(node -p "require('./package.json').version").zip"
rm -f "$ZIP"

cd "$ROOT"
zip -r -q "$ZIP" "$PLUG" \
  -x "*/.DS_Store" "*/node_modules/.package-lock.json" "*/npm-debug.log"

echo "built: $ZIP"
unzip -l "$ZIP" | tail -n +4 | head -n 20
