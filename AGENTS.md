# Dell brightness plugin operating notes

- Preserve the existing keypad default: when `icon` is empty, Brighter/Darker
  actions must never paint the key, so Ulanzi Studio custom icons survive.
- D200X encoder feedback is action-rendered and must show the current DDC/CI
  brightness after a successful adjustment.
- Encoder actions must use a dedicated `Controllers: ["Encoder"]` entry and
  omit `Devices` entirely. Despite the public SDK treating omission and `[]`
  as equivalent, the tested D200X Studio hid the action when either a model
  filter or an explicit empty `Devices` field was present.
- Do not add a top-level `Software.MinVersion` gate. On the tested Studio build,
  `3.0.11` left the plugin enabled in Settings but hid its entire action list.
  Document the recommended Studio version without gating discovery.
- Match the official Node encoder entry: dedicated `Encoder`, `$UA1`, no
  `Devices`, and `DisableAutomaticStates: true`.
- Keep the icon catalogue curated and local; do not add the multi-megabyte full
  MDI bundle to this Node plugin.
- All DDC operations remain serialized and rapid adjustments remain coalesced.
- Run `node test/test-controller.mjs` after action, renderer, or controller changes.
