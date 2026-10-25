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

/// Yandex sign-in in the app's own browser sheet. Yandex redirects to
/// music.yandex.ru/#access_token=…, and iOS hands that address to the official Yandex Music app
/// when it is installed, so a plain in-app browser lost the token. This sheet cancels that
/// navigation before iOS can, and takes the token from it, like the desktop sign-in window.
/// JS: registerPlugin('OniLogin') in src/api/capacitor.ts; resolves { token } or {} when closed.
@objc(LoginPlugin)
public class LoginPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {
    public let identifier = "LoginPlugin"
    public let jsName = "OniLogin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]

    private var call: CAPPluginCall?
    private var sheet: UINavigationController?

    /// The token in a redirect URL (fragment or query), as tokenFromUrl in src/api/capacitor.ts.
    static func token(in url: URL) -> String? {
        let text = url.absoluteString
        guard let start = text.range(of: #"[#&?]access_token="#, options: .regularExpression) else { return nil }
        let value = text[start.upperBound...].prefix { $0 != "&" }
        return value.isEmpty ? nil : String(value).removingPercentEncoding
    }

    /// Opens { url } (with Accept-Language from { lang }); a fresh, non-persistent session, so
    /// signing out and in again can pick another account, as on the desktop.
    @objc func open(_ call: CAPPluginCall) {
        guard let address = call.getString("url"), let url = URL(string: address) else {
            call.reject("url is required")
            return
        }
        DispatchQueue.main.async {
            self.finish(nil)
            self.call = call
            let config = WKWebViewConfiguration()
            config.websiteDataStore = .nonPersistent()
            let web = WKWebView(frame: .zero, configuration: config)
            web.navigationDelegate = self
            var request = URLRequest(url: url)
            if let lang = call.getString("lang") { request.setValue(lang, forHTTPHeaderField: "Accept-Language") }
            web.load(request)

            let page = UIViewController()
            page.view = web
            page.navigationItem.title = "Яндекс"
            page.navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(self.close))
            let sheet = UINavigationController(rootViewController: page)
            sheet.modalPresentationStyle = .fullScreen
            self.sheet = sheet
            self.bridge?.viewController?.present(sheet, animated: true)
        }
    }

    @objc private func close() {
        finish(nil)
    }

    private func finish(_ token: String?) {
        sheet?.dismiss(animated: true)
        sheet = nil
        guard let call = call else { return }
        self.call = nil
        call.resolve(token.map { ["token": $0] } ?? [:])
    }

    public func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if let token = LoginPlugin.token(in: url) {
            decisionHandler(.cancel)
            finish(token)
        } else if url.host == "music.yandex.ru" {
            // Without a token (sign-in declined): still not a reason to leave for Yandex's app.
            decisionHandler(.cancel)
            finish(nil)
        } else {
            decisionHandler(.allow)
        }
    }
}
