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

/// A tap of the Taptic Engine at the fine moments of a touch: a track picked up to be dragged, put
/// down, a menu opened by a long press (the user's idea; navigator.vibrate does nothing on iOS).
/// JS: registerPlugin('OniHaptics') in src/ui/haptics.ts.
@objc(HapticsPlugin)
public class HapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HapticsPlugin"
    public let jsName = "OniHaptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "tap", returnType: CAPPluginReturnPromise),
    ]

    private lazy var pick = UIImpactFeedbackGenerator(style: .medium)
    private lazy var drop = UIImpactFeedbackGenerator(style: .light)
    private lazy var tick = UISelectionFeedbackGenerator()

    /// { kind: 'pick' | 'drop' | 'tick' }
    @objc func tap(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "tick"
        DispatchQueue.main.async {
            switch kind {
            case "pick": self.pick.impactOccurred()
            case "drop": self.drop.impactOccurred()
            default: self.tick.selectionChanged()
            }
            call.resolve()
        }
    }
}
