# ulanzi-dell-brightness

An **Ulanzi Deck** plugin that controls the brightness of a **Dell U2720Q** (or any
DDC/CI monitor) from your deck — a lightweight replacement for the brightness slider in
*Dell Display Manager*. Use **Brighter** / **Darker** keys, the read-only
**Brightness Display** keypad tile, or the D200X **Brightness Encoder**. The
control step (1 / 3 / 5 / 10 %) and monitor are selected per action. The display
tile polls every two seconds while visible and pressing it only refreshes the
reading; it never changes monitor brightness. The release contains two cooperating plugin
folders because Ulanzi Studio 3.3.6 does not list encoder actions served by a
Node main service, even though it loads their layouts successfully.

Brightness is changed over **DDC/CI** (VCP `0x10`) via the built-in Windows `dxva2.dll`
(`Get/SetMonitorBrightness`) — no third-party tools required.

> The DDC backend and keys live in
> [`com.ulanzi.dellbrightness.ulanziPlugin/`](com.ulanzi.dellbrightness.ulanziPlugin/),
> while the discoverable HTML encoder lives in
> [`com.ulanzi.dellbrightnessencoder.ulanziPlugin/`](com.ulanzi.dellbrightnessencoder.ulanziPlugin/).

## Install (Windows)

Grab the ready-built zip from the [**Releases**](../../releases) page, then:

1. Fully quit Ulanzi Studio (tray → *Exit*).
2. Unzip both `com.ulanzi.dellbrightness.ulanziPlugin\` and
   `com.ulanzi.dellbrightnessencoder.ulanziPlugin\` into
   `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`.
3. Start Ulanzi Studio. Drag **Brighter** / **Darker** or the live, read-only
   **Brightness Display** onto keys. Drag **Brightness Encoder** onto a D200X
   knob, then select the monitor and (for controls) the step.

Requires Windows 10+ and a current Ulanzi Studio 3.x release; 3.0.11+ is recommended. Also requires
DDC/CI enabled in the monitor's OSD.

## Build from source

```bash
./pack.sh        # vendors `ws`, stages shared SDK files, zips both plugins
```

## Tests (any OS, no monitor needed)

```bash
node test/test-controller.mjs    # protocol, coalescing, clamping, manifests
node test/test-bridge.mjs        # real loopback WebSocket bridge
node test/test-sidecar.mjs       # HTML sidecar, cold startup, token rotation
node test/test-sdk-runtime.mjs    # real HTML SDK startup + actual dial envelope
node test/test-display.mjs        # live keypad display polling + no-adjust press
node test/test-inspector.mjs      # Property Inspector settings round-trip
bash test/test-package.sh        # two-plugin release archive contents
node test/test-real-pwsh.mjs     # drives the real brightness.ps1 (needs pwsh)
```

## Repo layout

```
com.ulanzi.dellbrightness.ulanziPlugin/   Node DDC backend + keypad actions
com.ulanzi.dellbrightnessencoder.ulanziPlugin/   HTML D200X encoder action
test/                                     Node test suites + mock DDC worker
pack.sh                                   build a distributable zip
```

## D200X hardware acceptance checklist

Software tests do not prove physical-device behavior. After installing both
v1.2.1 folders and fully restarting Studio, verify independently:

- Encoder: action is listed and placeable; its Inspector opens; both rotation
  directions adjust the selected monitor; press refreshes; feedback updates.
- Brightness Display: tile is listed and placeable; percentage updates after an
  external brightness change; pressing it does not change brightness.
- Persistence: switch pages, restart Studio, and re-check settings and behavior.
- Legacy keys: Brighter/Darker still work and custom Studio icons remain intact
  when **Keep Studio icon** is selected.

Physical D200X validation is pending until this checklist is run on the target
Windows/Ulanzi Studio 3.3.6 installation.

Built with the [UlanziDeck Plugin SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK). Apache-2.0.
