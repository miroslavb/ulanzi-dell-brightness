# Dell Monitor Brightness — Ulanzi Deck plugin

Control the brightness of a **Dell U2720Q** (or any DDC/CI monitor) straight from your
**Ulanzi Deck D200H/D200X** — a lightweight replacement for the brightness slider in
*Dell Display Manager (DDM)*.

Add three keys to your deck:

| Key | Default icon | Action |
|-----|--------------|--------|
| **Brighter** | sun with **long** rays ☀ | increase brightness by *step* |
| **Darker**  | sun with **short** rays 🔅 | decrease brightness by *step* |
| **Brightness Display** | live icon + percentage | poll and show current brightness without changing it |

The display tile polls every two seconds while visible. Pressing it refreshes
its reading and never changes monitor brightness. Its icon colour intensity
follows the brightness: full colour at 100%, dimmed toward the tile background
down to a 30% floor at 0%, and neutral grey when the reading is unavailable
(`--`).

On D200X you can instead place **Brightness Encoder** from the separately listed
**Dell Brightness Encoder** group on a knob: rotate left/right to dim/brighten and
read the current percentage on the knob's feedback tile.

The brightness **step (1 / 3 / 5 / 10 %)** is chosen in each key's settings (Property
Inspector), along with which monitor to control, an optional icon from the full
Material Design Icons library, and the icon colour. With **Keep Studio icon** (the
default), Brighter/Darker never draw over the key, so any custom icon you set in
Ulanzi Studio is kept.

---

## Requirements

- **Windows 10 or newer** (the brightness backend uses the built-in `dxva2.dll`).
- A current **Ulanzi Studio 3.x** release (3.0.11+ recommended) with an Ulanzi Deck
  (D200 / **D200H** / D200X / Dial).
- The monitor must have **DDC/CI enabled** in its OSD menu
  (Dell U2720Q: *Menu → Others → DDC/CI → On* — it is On by default).
- Connect the monitor over the cable you normally use with DDM (DP / HDMI / USB-C).

No third-party tools (ControlMyMonitor, nircmd, …) and no Node install are required —
`ws` is bundled and Ulanzi Studio runs the plugin with its own Node runtime.

## Install

1. **Fully quit** Ulanzi Studio (system tray → *Exit*, not just close the window).
2. Copy both `com.ulanzi.dellbrightness.ulanziPlugin` and
   `com.ulanzi.dellbrightnessencoder.ulanziPlugin` from the release archive into
   the Ulanzi plugins directory:
   - **Windows:** `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`
     (paste `%APPDATA%\Ulanzi\UlanziDeck\Plugins\` into Explorer's address bar)
3. **Start Ulanzi Studio.** *Dell Monitor Brightness* now appears in the plugin list.
4. Drag **Brighter**, **Darker**, or the live read-only **Brightness Display**
   onto keys. Open the knob tab and drag **Brightness Encoder** from
   **Dell Brightness Encoder** onto a D200X knob.
5. Select an action and choose the **Brightness step**, **Monitor**, and icon.

> Tip: put *Brighter* and *Darker* next to each other for a natural ＋ / − pair.

## Settings (Property Inspector)

- **Brightness step** — how many percentage points each press changes: `1`, `3`, `5`, `10`.
- **Monitor** — `Auto (first responsive monitor)` or a specific monitor from the list.
  Click **Refresh monitors** after plugging/unplugging a display. The list shows the
  current % of each DDC/CI-capable monitor; non-capable panels are marked `— no DDC/CI`.
- **Icon** — on Brighter/Darker, **Keep Studio icon** (default) never paints the
  key; picking an icon makes the plugin draw it. On Brightness Display the
  default is `mdi:brightness-7`. The curated quick picks are shown first.
- **Icon colour** — any colour (default `#facc15`). Brightness Display dims this
  colour with the monitor brightness; Brighter/Darker use it at full strength.
- **Find icon** — searches all ~7,400 Material Design Icons by name (prefix,
  word and substring matches, up to 40 previews). Click a preview to use it, or
  type an exact name such as `mdi:lightbulb-on` and press Enter.
- The D200X encoder (separate companion plugin) keeps its own small curated
  icon list for its feedback.
- **Wide-screen feedback** — disable to keep the D200X LCD area transparent while
  the encoder continues to control brightness.

> The Brighter/Darker controls intentionally do not draw a value when **Keep
> Studio icon** is selected. Painting those keys would overwrite a custom icon
> (the SDK gives no way to read it back). The dedicated **Brightness Display**
> is the opt-in tile that the plugin owns and repaints with the live percentage.

## How it works

```
Deck key ──run──▶ app.js (main service, Node)
                     │  BrightnessAction(+step / −step)
                     ▼
                 DdcController  ──JSON over stdin/stdout──▶  brightness.ps1 (serve mode)
                     │  • serializes commands (DDC/CI is not concurrency-safe)             │
                     │  • coalesces rapid presses into one adjust call                     ▼
                     │                                              dxva2.dll Get/SetMonitorBrightness
                     ◀──── { ok, current, min, max } ──────────────  (VCP 0x10, same as DDM)

D200X knob ──▶ HTML encoder main service ──authenticated WS 127.0.0.1:9236──▶ DdcController
```

- A single long-lived PowerShell process is started once (so the P/Invoke layer is
  compiled a single time). If it can't start, the controller transparently falls back to
  one-shot `powershell` invocations.
- Mashing a key fires one combined adjustment (e.g. five quick `+5` presses → one `+25`),
  which is both snappier and gentler on the monitor's DDC/CI channel.
- The bridge is loopback-only. Each backend start rotates a random handshake
  token stored in the installed companion folder; remote browser origins are
  rejected and frames larger than 4 KiB are refused before allocation.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Key shows an error / nothing happens | Enable **DDC/CI** in the monitor's OSD menu. Some KVMs, docks and DisplayPort-MST chains block DDC/CI — try a direct cable. |
| Encoder group is missing | Confirm that the second `com.ulanzi.dellbrightnessencoder.ulanziPlugin` folder is installed, then fully exit and restart Studio. |
| Encoder shows BACKEND | Confirm that both folders are installed. The keypad/Node plugin owns the local DDC bridge. |
| Wrong monitor changes | Open the key settings, set **Monitor** to the specific Dell entry instead of *Auto*, then **Refresh monitors**. |
| Works but feels slow on the very first press | The first call compiles the native layer; subsequent presses are instant. |
| Brightness jumps in big chunks | Lower the **Brightness step**. |
| Laptop's built-in panel won't change | Internal laptop displays usually use a different (WMI) API and aren't DDC/CI — control an external monitor instead. |

Logs: `%APPDATA%\Ulanzi\UlanziStudio\logs\com.ulanzi.ulanzistudio.dellbrightness.log`.

## Manual test of the backend (on Windows)

You can drive the engine directly without the deck:

```powershell
cd "%APPDATA%\Ulanzi\UlanziDeck\Plugins\com.ulanzi.dellbrightness.ulanziPlugin\plugin\ddc"
powershell -ExecutionPolicy Bypass -File brightness.ps1 -Op list
powershell -ExecutionPolicy Bypass -File brightness.ps1 -Op get    -Index 0
powershell -ExecutionPolicy Bypass -File brightness.ps1 -Op set    -Index 0 -Value 50
powershell -ExecutionPolicy Bypass -File brightness.ps1 -Op adjust -Index 0 -Delta 5
```

`-Index -1` targets the first DDC/CI-capable monitor (same as *Auto*).

## Developing / debugging

- Launch Ulanzi Studio with `--nodeRemoteDebug` and open `chrome://inspect` to debug the
  Node main service; use `--log` for verbose logs.
- Tests (run on any OS, no monitor needed): from the repo root run
  `node test/test-controller.mjs`, `node test/test-bridge.mjs`,
  `node test/test-sidecar.mjs`, `node test/test-sdk-runtime.mjs`,
  `node test/test-display.mjs`, `node test/test-inspector.mjs`,
  `node test/test-unavailable-feedback.mjs`, `node test/test-icons.mjs`,
  `node test/test-keypad-inspector.mjs`, `bash test/test-package.sh`, and (if
  `pwsh` is installed) `node test/test-real-pwsh.mjs`.
- The full icon catalogue is loaded only by the Node main service. Keep it out
  of every webview (Property Inspector and the HTML companion); the Property
  Inspector asks the main service for search results instead.

## File layout

```
com.ulanzi.dellbrightness.ulanziPlugin/
├── manifest.json              # plugin + 3 keypad actions
├── en.json ru_RU.json de_DE.json zh_CN.json   # localization
├── assets/icons/              # brighter/darker (long/short-ray suns) + store icons
├── libs/                      # vendored common-html SDK (Property Inspector)
├── property-inspector/        # keypad settings UI (step / monitor / icon / colour)
├── node_modules/ws/           # bundled WebSocket dependency
└── plugin/
    ├── app.js                 # main service entry
    ├── common-node/           # vendored common-node SDK
    ├── icons.js               # SVG key renderer, colour + intensity, quick picks
    ├── mdiCatalog.js          # lazy Node-only MDI catalogue + search
    ├── inspectorMessages.js   # Property Inspector request handling
    ├── data/mdi-icons.json    # @mdi/js 7.4.47 paths (Apache-2.0), Node only
    ├── actions/BrightnessAction.js
    ├── actions/BrightnessDisplayAction.js
    └── ddc/
        ├── BridgeAuth.js        # token publication into the installed companion
        ├── DdcController.js    # worker mgmt, queue, coalescing
        ├── DdcBridgeServer.js  # loopback-only API for HTML encoder companion
        └── brightness.ps1     # DDC/CI engine (dxva2 P/Invoke)
```

## License

Apache-2.0 (matches the Ulanzi SDK). Built with the
[UlanziDeck Plugin SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK).
Icon paths come from [Material Design Icons](https://pictogrammers.com/library/mdi/)
(`@mdi/js` 7.4.47, Pictogrammers, Apache-2.0).
