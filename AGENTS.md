# Dell brightness plugin operating notes

- Preserve the existing keypad default: when `icon` is empty, Brighter/Darker
  actions must never paint the key, so Ulanzi Studio custom icons survive.
- Windows Ulanzi Studio 3.3.6 loads the Node plugin and parses its `$UA1`
  layout, but does not list its Node-backed encoder action in the knob tree.
  Keep the D200X action in the separate HTML-main-service companion plugin;
  do not move it back into the Node manifest without newer host evidence.
- The release archive must contain both top-level plugin folders. The Node
  plugin owns DDC/CI and keypad actions; the HTML companion owns the dedicated
  `Controllers: ["Encoder"]` action and must omit `Devices` entirely.
- The companion bridge must bind only to `127.0.0.1`, expose only list/get/
  bounded-adjust operations, require the per-process token written into the
  installed sidecar, reject non-local browser origins, enforce payload limits
  at the WebSocket layer, and never accept commands, scripts, or paths.
- D200X encoder feedback must show current DDC/CI brightness after a successful
  adjustment and must support a true transparent-PNG disabled state without
  disabling the dial.
- Do not add a top-level `Software.MinVersion` gate. On the tested Studio build,
  `3.0.11` left the plugin enabled in Settings but hid its entire action list.
  Document the recommended Studio version without gating discovery.
- Match the proven HTML encoder entry: dedicated `Encoder`, `$UA1`, no
  `Devices`, and `DisableAutomaticStates: true`.
- Keep the icon catalogue curated and local; do not add the multi-megabyte full
  MDI bundle to this Node plugin.
- All DDC operations remain serialized and rapid adjustments remain coalesced.
- Run `node test/test-controller.mjs`, `node test/test-bridge.mjs`,
  `node test/test-sidecar.mjs`, `node test/test-inspector.mjs`, and
  `bash test/test-package.sh` after action, renderer, controller, PI, or
  packaging changes.
