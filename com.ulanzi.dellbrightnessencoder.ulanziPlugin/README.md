# Dell Monitor Brightness Encoder

This is the HTML companion for the Node-based **Dell Monitor Brightness**
plugin. Install both plugin folders from the release archive. The Node plugin
owns DDC/CI access and the existing Brighter/Darker keys; this companion makes
the D200X encoder discoverable in Ulanzi Studio and forwards only brightness
operations to the backend.

v1.2.1 uses the `$UD` singleton created by the bundled browser SDK. v1.2.0
called a nonexistent `UlanziApi` constructor and stopped before encoder event
registration, even while the independent Node bridge remained healthy.

The plugins communicate through a WebSocket bound exclusively to
`127.0.0.1:9236`. On every backend start, the Node plugin generates a random
token and writes it to this companion's local `plugin/bridge-auth.js`; the
WebSocket handshake requires that token and rejects remote web origins. The
bridge accepts only monitor list/read and bounded brightness-adjust requests.
It is not exposed to the network.

If the encoder shows an error, confirm that both plugin folders are installed,
restart Ulanzi Studio completely, and verify that DDC/CI is enabled in the
monitor OSD.
