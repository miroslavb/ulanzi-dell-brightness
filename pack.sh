#!/usr/bin/env bash
# Build a distributable zip of both cooperating Ulanzi plugins.
# The zip's top-level entries are the two plugin folders, so the user unzips into
#   Windows: %APPDATA%\Ulanzi\UlanziDeck\Plugins\
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="com.ulanzi.dellbrightness.ulanziPlugin"
ENCODER="com.ulanzi.dellbrightnessencoder.ulanziPlugin"
OUT="${ULANZI_DIST_DIR:-$ROOT/dist}"

cd "$ROOT/$BACKEND"

# Ensure the single runtime dependency (ws) is vendored.
if [ ! -d node_modules/ws ]; then
  echo "installing ws…"
  npm install --omit=dev --no-audit --no-fund
fi

mkdir -p "$OUT"
VERSION="$(node -p "require('./package.json').version")"
ZIP="$OUT/ulanzi-dell-brightness-${VERSION}.zip"
rm -f "$ZIP"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -a "$ROOT/$BACKEND" "$STAGE/$BACKEND"
cp -a "$ROOT/$ENCODER" "$STAGE/$ENCODER"
cp -a "$ROOT/$BACKEND/libs" "$STAGE/$ENCODER/libs"

cd "$STAGE"
zip -r -q "$ZIP" "$BACKEND" "$ENCODER" \
  -x "*/.DS_Store" "*/node_modules/.package-lock.json" "*/npm-debug.log"

echo "built: $ZIP"
unzip -l "$ZIP" | sed -n '4,23p'
