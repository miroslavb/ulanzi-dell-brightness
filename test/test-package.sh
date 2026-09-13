#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_OUT="$(mktemp -d)"
trap 'rm -rf "$TEST_OUT"' EXIT

ULANZI_DIST_DIR="$TEST_OUT" "$ROOT/pack.sh" >/dev/null
ZIP="$TEST_OUT/ulanzi-dell-brightness-1.2.1.zip"
test -f "$ZIP"
unzip -t "$ZIP" >/dev/null

ENTRIES="$(unzip -Z1 "$ZIP")"
for required in \
  'com.ulanzi.dellbrightness.ulanziPlugin/manifest.json' \
  'com.ulanzi.dellbrightness.ulanziPlugin/plugin/ddc/DdcBridgeServer.js' \
  'com.ulanzi.dellbrightness.ulanziPlugin/plugin/actions/BrightnessDisplayAction.js' \
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

python3 - "$ZIP" <<'PY'
import re
import sys
import zipfile

auth_path = 'com.ulanzi.dellbrightnessencoder.ulanziPlugin/plugin/bridge-auth.js'
with zipfile.ZipFile(sys.argv[1]) as archive:
    auth = archive.read(auth_path).decode('utf-8')
assert 'window.DELL_BRIGHTNESS_BRIDGE = window.DELL_BRIGHTNESS_BRIDGE || {};' in auth
assert re.search(r'"token"\s*:\s*"[a-f0-9]{64}"', auth) is None
PY

echo 'two-plugin release archive contract passed'
