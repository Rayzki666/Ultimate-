import AVFoundation
import Capacitor

@objc(FrameCameraPlugin)
public class FrameCameraPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FrameCameraPlugin"
    public let jsName = "FrameCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAvailability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorizationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise)
    ]

    @objc public func getAvailability(_ call: CAPPluginCall) {
        call.resolve([
            "platform": "ios",
            "pluginAvailable": true,
            "videoInputAvailable": AVCaptureDevice.default(for: .video) != nil,
            "previewImplemented": false,
            "captureImplemented": false,
            "simulator": isSimulator
        ])
    }

    @objc public func authorizationStatus(_ call: CAPPluginCall) {
        call.resolve(permissionPayload())
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        guard status == .notDetermined else {
            call.resolve(permissionPayload(status))
            return
        }

        AVCaptureDevice.requestAccess(for: .video) { [weak self] _ in
            guard let self else {
                call.reject("FrameCamera permission check became unavailable.")
                return
            }
            call.resolve(self.permissionPayload())
        }
    }

    private func permissionPayload(
        _ status: AVAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    ) -> [String: Any] {
        return [
            "camera": permissionName(status),
            "canRequest": status == .notDetermined
        ]
    }

    private func permissionName(_ status: AVAuthorizationStatus) -> String {
        switch status {
        case .notDetermined:
            return "prompt"
        case .restricted:
            return "restricted"
        case .denied:
            return "denied"
        case .authorized:
            return "granted"
        @unknown default:
            return "unknown"
        }
    }

    private var isSimulator: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }
}
