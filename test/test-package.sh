#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_OUT="$(mktemp -d)"
trap 'rm -rf "$TEST_OUT"' EXIT

ULANZI_DIST_DIR="$TEST_OUT" "$ROOT/pack.sh" >/dev/null
ZIP="$TEST_OUT/ulanzi-dell-brightness-1.3.0.zip"
test -f "$ZIP"
unzip -t "$ZIP" >/dev/null

ENTRIES="$(unzip -Z1 "$ZIP")"
for required in \
  'com.ulanzi.dellbrightness.ulanziPlugin/manifest.json' \
  'com.ulanzi.dellbrightness.ulanziPlugin/plugin/ddc/DdcBridgeServer.js' \
  'com.ulanzi.dellbrightness.ulanziPlugin/plugin/actions/BrightnessDisplayAction.js' \
  'com.ulanzi.dellbrightness.ulanziPlugin/plugin/mdiCatalog.js' \
  'com.ulanzi.dellbrightness.ulanziPlugin/plugin/inspectorMessages.js' \
  'com.ulanzi.dellbrightness.ulanziPlugin/plugin/data/mdi-icons.json' \
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

# The full MDI catalogue ships once, inside the Node plugin only; the HTML
# companion (a webview) must never receive it.
if grep -E '^com\.ulanzi\.dellbrightnessencoder\.ulanziPlugin/.*mdi-icons' <<<"$ENTRIES"; then
  echo 'HTML encoder companion must not contain the MDI catalogue' >&2
  exit 1
fi
test "$(grep -c 'mdi-icons\.json$' <<<"$ENTRIES")" = 1

python3 - "$ZIP" <<'PY'
import json
import re
import sys
import zipfile

auth_path = 'com.ulanzi.dellbrightnessencoder.ulanziPlugin/plugin/bridge-auth.js'
with zipfile.ZipFile(sys.argv[1]) as archive:
    auth = archive.read(auth_path).decode('utf-8')
assert 'window.DELL_BRIGHTNESS_BRIDGE = window.DELL_BRIGHTNESS_BRIDGE || {};' in auth
assert re.search(r'"token"\s*:\s*"[a-f0-9]{64}"', auth) is None

with zipfile.ZipFile(sys.argv[1]) as archive:
    catalog = json.loads(archive.read('com.ulanzi.dellbrightness.ulanziPlugin/plugin/data/mdi-icons.json'))
    versions = {
        json.loads(archive.read(f'{folder}/manifest.json'))['Version']
        for folder in ('com.ulanzi.dellbrightness.ulanziPlugin', 'com.ulanzi.dellbrightnessencoder.ulanziPlugin')
    }
assert catalog['source'] == '@mdi/js 7.4.47' and len(catalog['icons']) == catalog['count'] >= 7000
assert versions == {'1.3.0'}, versions
PY

echo 'two-plugin release archive contract passed'
