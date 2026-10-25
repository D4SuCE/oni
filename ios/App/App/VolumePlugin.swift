import UIKit
import Capacitor
import Security
import WebKit
import MediaPlayer
import AVFoundation
import AudioToolbox
import UserNotifications
import CryptoKit
import ActivityKit
import WidgetKit
import Network
import Accelerate

/// The phone's own volume for the slider on Now Playing (iOS ignores audio.volume, and a gain of
/// our own is not what the volume buttons move). iOS lets an app set it only through its system
/// slider, MPVolumeView: one sits off screen while a change is under way. Changes from the
/// buttons come back as "change". JS: registerPlugin('OniVolume') in src/player/volume.ts.
@objc(VolumePlugin)
public class VolumePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VolumePlugin"
    public let jsName = "OniVolume"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
    ]

    private let volumeView = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 10, height: 10))
    private var observation: NSKeyValueObservation?
    private var detach: DispatchWorkItem?

    override public func load() {
        // The music plays in WebKit's own process: without a session active here, iOS neither
        // reports the volume buttons to this process nor keeps outputVolume current in it.
        try? AVAudioSession.sharedInstance().setActive(true)
        observation = AVAudioSession.sharedInstance().observe(\.outputVolume, options: [.new]) { [weak self] _, change in
            if let value = change.newValue { self?.notifyListeners("change", data: ["value": value]) }
        }
    }

    @objc func get(_ call: CAPPluginCall) {
        call.resolve(["value": AVAudioSession.sharedInstance().outputVolume])
    }

    /// { value: 0…1 }
    @objc func set(_ call: CAPPluginCall) {
        let value = Float(max(0, min(1, call.getDouble("value") ?? 0)))
        DispatchQueue.main.async {
            // In the window only while it is in use: there it also hides the system's volume
            // overlay, which the hardware buttons should keep showing the rest of the time.
            if self.volumeView.superview == nil { self.bridge?.viewController?.view.addSubview(self.volumeView) }
            self.volumeView.subviews.compactMap { $0 as? UISlider }.first?.value = value
            self.detach?.cancel()
            let detach = DispatchWorkItem { [weak self] in self?.volumeView.removeFromSuperview() }
            self.detach = detach
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: detach)
            call.resolve()
        }
    }
}
