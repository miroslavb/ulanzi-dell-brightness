# Dell Monitor Brightness — Ulanzi Deck plugin

Control the brightness of a **Dell U2720Q** (or any DDC/CI monitor) straight from your
**Ulanzi Deck D200H/D200X** — a lightweight replacement for the brightness slider in
*Dell Display Manager (DDM)*.

Add two keys to your deck:

| Key | Default icon | Action |
|-----|--------------|--------|
| **Brighter** | sun with **long** rays ☀ | increase brightness by *step* |
| **Darker**  | sun with **short** rays 🔅 | decrease brightness by *step* |

On D200X you can instead place **Brightness Encoder** from the separately listed
**Dell Brightness Encoder** group on a knob: rotate left/right to dim/brighten and
read the current percentage on the knob's feedback tile.

The brightness **step (1 / 3 / 5 / 10 %)** is chosen in each key's settings (Property
Inspector), along with which monitor to control and an optional compact MDI icon.
With **Keep Studio icon** (the default), keypad actions never draw over the key, so
any custom icon you set in Ulanzi Studio is kept.

---

## Как это работает (RU, кратко)

Плагин меняет яркость по **DDC/CI** (VCP-код `0x10`) — это тот же канал, что использует
Dell Display Manager. На Windows он вызывает системный `dxva2.dll`
(`GetMonitorBrightness` / `SetMonitorBrightness`), **без сторонних программ**. Добавьте на
деку кнопки «Ярче» и «Темнее», в настройках кнопки выберите шаг (1/3/5/10 %) и нужный
монитор. Установка — скопировать папку плагина в каталог плагинов Ulanzi (см. ниже) и
перезапустить Ulanzi Studio.

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
4. Drag **Brighter** and **Darker** onto keys, or open the knob tab and drag
   **Brightness Encoder** from **Dell Brightness Encoder** onto a D200X knob.
5. Select an action and choose the **Brightness step**, **Monitor**, and icon.

> Tip: put *Brighter* and *Darker* next to each other for a natural ＋ / − pair.

## Settings (Property Inspector)

- **Brightness step** — how many percentage points each press changes: `1`, `3`, `5`, `10`.
- **Monitor** — `Auto (first responsive monitor)` or a specific monitor from the list.
  Click **Refresh monitors** after plugging/unplugging a display. The list shows the
  current % of each DDC/CI-capable monitor; non-capable panels are marked `— no DDC/CI`.
- **Icon** — keep the Studio/manifest icon on keypad actions, or opt into a
  bundled MDI glyph. The encoder uses a selected MDI glyph in its feedback.
- **Wide-screen feedback** — disable to keep the D200X LCD area transparent while
  the encoder continues to control brightness.

> The plugin intentionally does not draw a value on the key. Painting on the key
> would overwrite a custom icon you set in Ulanzi Studio (the SDK gives no way to
> read that icon back to restore it), so your chosen icon is always preserved. The
> brightness change is visible on the monitor itself.

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

D200X knob ──▶ HTML encoder main service ──WebSocket 127.0.0.1:9236──▶ DdcController
```

- A single long-lived PowerShell process is started once (so the P/Invoke layer is
  compiled a single time). If it can't start, the controller transparently falls back to
  one-shot `powershell` invocations.
- Mashing a key fires one combined adjustment (e.g. five quick `+5` presses → one `+25`),
  which is both snappier and gentler on the monitor's DDC/CI channel.

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
  `node test/test-sidecar.mjs`, and (if `pwsh` is installed)
  `node test/test-real-pwsh.mjs`.

## File layout

```
com.ulanzi.dellbrightness.ulanziPlugin/
├── manifest.json              # plugin + 2 actions (Brighter / Darker)
├── en.json ru_RU.json de_DE.json zh_CN.json   # localization
├── assets/icons/              # brighter/darker (long/short-ray suns) + store icons
├── libs/                      # vendored common-html SDK (Property Inspector)
├── property-inspector/        # keypad settings UI (step / monitor / icon)
├── node_modules/ws/           # bundled WebSocket dependency
└── plugin/
    ├── app.js                 # main service entry
    ├── common-node/           # vendored common-node SDK
    ├── actions/BrightnessAction.js
    └── ddc/
        ├── DdcController.js    # worker mgmt, queue, coalescing
        ├── DdcBridgeServer.js  # loopback-only API for HTML encoder companion
        └── brightness.ps1     # DDC/CI engine (dxva2 P/Invoke)
```

## License

Apache-2.0 (matches the Ulanzi SDK). Built with the
[UlanziDeck Plugin SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK).
