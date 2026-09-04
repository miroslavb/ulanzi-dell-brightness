#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_OUT="$(mktemp -d)"
trap 'rm -rf "$TEST_OUT"' EXIT

ULANZI_DIST_DIR="$TEST_OUT" "$ROOT/pack.sh" >/dev/null
ZIP="$TEST_OUT/ulanzi-dell-brightness-1.2.0.zip"
test -f "$ZIP"
unzip -t "$ZIP" >/dev/null

ENTRIES="$(unzip -Z1 "$ZIP")"
for required in \
  'com.ulanzi.dellbrightness.ulanziPlugin/manifest.json' \
  'com.ulanzi.dellbrightness.ulanziPlugin/plugin/ddc/DdcBridgeServer.js' \
  'com.ulanzi.dellbrightnessencoder.ulanziPlugin/manifest.json' \
  'com.ulanzi.dellbrightnessencoder.ulanziPlugin/plugin/app.html' \
  'com.ulanzi.dellbrightnessencoder.ulanziPlugin/plugin/bridge-auth.js' \
  'com.ulanzi.dellbrightnessencoder.ulanziPlugin/libs/js/ulanziApi.js' \
  'com.ulanzi.dellbrightnessencoder.ulanziPlugin/libs/css/uspi.css'
do
  grep -Fxq "$required" <<<"$ENTRIES"
done

if grep -Fq 'node_modules/.package-lock.json' <<<"$ENTRIES"; then
  echo 'archive contains excluded node_modules/.package-lock.json' >&2
  exit 1
fi

echo 'two-plugin release archive contract passed'
