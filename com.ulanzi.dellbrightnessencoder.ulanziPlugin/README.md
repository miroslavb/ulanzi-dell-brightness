# Dell Monitor Brightness Encoder

This is the HTML companion for the Node-based **Dell Monitor Brightness**
plugin. Install both plugin folders from the release archive. The Node plugin
owns DDC/CI access and the existing Brighter/Darker keys; this companion makes
the D200X encoder discoverable in Ulanzi Studio and forwards only brightness
operations to the backend.

The plugins communicate through a WebSocket bound exclusively to
`127.0.0.1:9236`. The bridge accepts only monitor list/read and bounded
brightness-adjust requests. It is not exposed to the network.

If the encoder shows an error, confirm that both plugin folders are installed,
restart Ulanzi Studio completely, and verify that DDC/CI is enabled in the
monitor OSD.
