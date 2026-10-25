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

/// The app's own bridge controller: registers the plugins that live in this project.
class OniViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(KeychainPlugin())
        bridge?.registerPluginInstance(LoginPlugin())
        bridge?.registerPluginInstance(RemotePlugin())
        bridge?.registerPluginInstance(VolumePlugin())
        bridge?.registerPluginInstance(DownloadsPlugin())
        bridge?.registerPluginInstance(PlayerPlugin())
        bridge?.registerPluginInstance(HapticsPlugin())
        bridge?.registerPluginInstance(LanPlugin())
        #if DEBUG
        // Automated runs on the simulator (.github/workflows/ios.yml): sign in with the token the
        // runner passes, and tell the page it is a test (no listening signals to the account,
        // the smoke run in src/ios-smoke.ts). Debug builds only: the phone IPA is Release.
        if let token = ProcessInfo.processInfo.environment["ONI_TEST_TOKEN"], !token.isEmpty {
            _ = KeychainPlugin.store(key: KeychainPlugin.tokenKey, value: token)
            let flag = WKUserScript(source: "window.__oniTest = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true)
            webView?.configuration.userContentController.addUserScript(flag)
        }
        #endif
        // On coming to the front (paired with didEnterBackground; didBecomeActive did not come on
        // the simulator), once the page has had a moment to wake.
        NotificationCenter.default.addObserver(self, selector: #selector(foreground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    private var checking = false

    @objc private func foreground() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.checkPage() }
    }

    /// Back from the background: is the page still there? The user found a black screen in the
    /// morning after a night of music (the native player went on, the page did not show), and had
    /// to close Oni for good. A page that does not answer within a few seconds, or answers that it
    /// shows nothing, is loaded anew; the new one picks up the native player that kept playing (its
    /// clock says it plays, its end moves the restored queue on). A page still loading (no check
    /// of its own yet) is left alone.
    @objc private func checkPage() {
        guard let webView = webView, webView.url != nil, !checking else { return }
        checking = true
        var answered = false
        webView.evaluateJavaScript("typeof window.__oniAlive === 'function' ? window.__oniAlive() : null") { result, error in
            guard !answered else { return }
            answered = true
            self.checking = false
            if error != nil { self.revive("error: \(error!.localizedDescription)") }
            else if let alive = result as? Bool, !alive { self.revive("empty") }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            guard !answered else { return }
            answered = true
            self.checking = false
            self.revive("no answer")
        }
    }

    private func revive(_ why: String) {
        CAPLog.print("⚡️  Oni: the page is gone (\(why)), loading it anew")
        webView?.reload()
    }
}
