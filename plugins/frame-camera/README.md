# @frame/camera

Internal Capacitor 8 iOS plugin shell for Frame.

It exposes native camera capability and permission probes only. Native preview and capture are deliberately reported as unimplemented. The web app keeps `WebCameraBackend` as its default camera.

The JavaScript adapter in `js/native-camera.js` is intentionally not imported by the active camera controller. Its default instance is disabled; a later native-camera integration must opt in explicitly.
