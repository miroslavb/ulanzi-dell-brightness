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
- The full MDI catalogue (@mdi/js 7.4.47, ~7,400 icons, ~2.7 MB) lives only in
  the Node plugin as `plugin/data/mdi-icons.json`. Only the Node main service
  reads it, lazily and at most once (`plugin/mdiCatalog.js`). Never load,
  embed, fetch, or `<script>`-include it in any webview: the keypad Property
  Inspector, the HTML encoder companion (main service or PI), or `libs/`
  (`pack.sh` copies `libs/` into the companion). Historical reason: a 2.7 MB
  MDI JS literal loaded by a synchronous `<script>` in the Property Inspector
  stopped icons rendering on the device. The PI searches through
  `sendToPlugin` `{op: 'searchIcons' | 'getIcon'}` and receives at most 60
  paths per `sendToPropertyInspector` reply. The curated `BRIGHTNESS_ICONS`
  stay the default quick picks and resolve without loading the catalogue.
- Keypad key images are D200H-safe SVG: only `rect`, `g`, `path` and `text`;
  no clip-path, stroke-dasharray, gradients, filters, opacity tricks or
  viewBox offset. Brightness Display encodes brightness by pre-mixing the icon
  colour toward the tile background (30% floor at 0%, linear to full at 100%);
  an unknown reading is neutral grey, never dim-as-zero. Brighter/Darker paint
  a selected icon in the full colour and never encode intensity, because they
  do not poll and would show stale levels.
- Validate `iconColor` as `#rrggbb` and icon names against the MDI name
  pattern in the Node backend; unknown input falls back (`#facc15`; Display
  -> `brightness-7`; Brighter/Darker -> no paint). Never use a plain object
  lookup for icon names (`constructor` and `__proto__` are inherited keys).
- All DDC operations remain serialized and rapid adjustments remain coalesced.
- Browser main services and Property Inspectors must use the `$UD` singleton
  supplied by the browser SDK (`UlanziStreamDeck`), not the Node-only
  `UlanziApi` constructor. Load the real packaged SDK scripts in regression
  tests; a fabricated constructor stub can hide a fatal startup error.
- Keep Brightness Display as a separate read-only keypad action. Poll only
  while visible, cancel its timer on removal, and never change brightness when
  this tile is pressed. Preserve Brighter/Darker UUIDs and no-paint defaults.
- Verify the encoder through actual Studio-shaped dial events and the
  authenticated bridge, including late backend startup and token rotation.
  Report injected-event checks separately from physical knob confirmation.
- Run `node test/test-controller.mjs`, `node test/test-bridge.mjs`,
  `node test/test-sidecar.mjs`, `node test/test-inspector.mjs`,
  `node test/test-sdk-runtime.mjs`, `node test/test-display.mjs`,
  `node test/test-unavailable-feedback.mjs`, `node test/test-icons.mjs`,
  `node test/test-keypad-inspector.mjs`, and `bash test/test-package.sh` after
  action, renderer, icon, controller, PI, or packaging changes.
