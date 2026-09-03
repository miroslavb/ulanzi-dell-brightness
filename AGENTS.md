# Dell brightness plugin operating notes

- Preserve the existing keypad default: when `icon` is empty, Brighter/Darker
  actions must never paint the key, so Ulanzi Studio custom icons survive.
- D200X encoder feedback is action-rendered and must show the current DDC/CI
  brightness after a successful adjustment.
- Encoder actions must use `Controllers: ["Encoder"]` with an empty/omitted
  `Devices` filter; the D200X Studio encoder surface otherwise drops them from
  its action list.
- Keep the icon catalogue curated and local; do not add the multi-megabyte full
  MDI bundle to this Node plugin.
- All DDC operations remain serialized and rapid adjustments remain coalesced.
- Run `node test/test-controller.mjs` after action, renderer, or controller changes.
