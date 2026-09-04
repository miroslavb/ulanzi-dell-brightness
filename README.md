# ulanzi-dell-brightness

An **Ulanzi Deck** plugin that controls the brightness of a **Dell U2720Q** (or any
DDC/CI monitor) from your deck — a lightweight replacement for the brightness slider in
*Dell Display Manager*. Use **Brighter** / **Darker** keys or the D200X
**Brightness Encoder**; the step (1 / 3 / 5 / 10 %) and an optional MDI icon are
chosen in the action settings.

Brightness is changed over **DDC/CI** (VCP `0x10`) via the built-in Windows `dxva2.dll`
(`Get/SetMonitorBrightness`) — no third-party tools required.

> The plugin itself lives in [`com.ulanzi.dellbrightness.ulanziPlugin/`](com.ulanzi.dellbrightness.ulanziPlugin/).
> See its [README](com.ulanzi.dellbrightness.ulanziPlugin/README.md) for full usage,
> settings, and troubleshooting.

## Install (Windows)

Grab the ready-built zip from the [**Releases**](../../releases) page, then:

1. Fully quit Ulanzi Studio (tray → *Exit*).
2. Unzip so that `com.ulanzi.dellbrightness.ulanziPlugin\` lands in
   `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`.
3. Start Ulanzi Studio. Drag **Brighter** / **Darker** onto keys and/or
   **Brightness Encoder** onto a D200X knob, then set the step and monitor.

Requires Windows 10+, Ulanzi Studio 3.0.11+, and
DDC/CI enabled in the monitor's OSD.

## Build from source

```bash
./pack.sh        # vendors `ws`, zips the plugin into dist/
```

## Tests (any OS, no monitor needed)

```bash
node test/test-controller.mjs    # protocol, coalescing, clamping, action logic
node test/test-real-pwsh.mjs     # drives the real brightness.ps1 (needs pwsh)
```

## Repo layout

```
com.ulanzi.dellbrightness.ulanziPlugin/   the plugin (manifest, actions, PI, DDC engine)
test/                                     Node test suites + mock DDC worker
pack.sh                                   build a distributable zip
```

Built with the [UlanziDeck Plugin SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK). Apache-2.0.
