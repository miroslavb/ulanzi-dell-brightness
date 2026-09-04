import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENCODER_PLUGIN_DIR = 'com.ulanzi.dellbrightnessencoder.ulanziPlugin';

export function resolveBridgeAuthPath(mainServiceUrl) {
  const pluginsDir = resolve(dirname(fileURLToPath(mainServiceUrl)), '..', '..');
  return resolve(pluginsDir, ENCODER_PLUGIN_DIR, 'plugin', 'bridge-auth.js');
}

export function publishBridgeConfig({ mainServiceUrl, port, token }) {
  const authPath = resolveBridgeAuthPath(mainServiceUrl);
  const config = { url: `ws://127.0.0.1:${port}`, token };
  writeFileSync(authPath, `window.DELL_BRIGHTNESS_BRIDGE = ${JSON.stringify(config)};\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  return authPath;
}
