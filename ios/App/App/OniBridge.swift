import UIKit
import Capacitor
import Security
import WebKit

/// The app's own bridge controller: registers the plugins that live in this project.
class OniViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(KeychainPlugin())
        bridge?.registerPluginInstance(LoginPlugin())
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
    }
}

/// Keeps the Yandex OAuth token in the Keychain, as safeStorage does on the desktop.
/// JS: registerPlugin('OniKeychain') in src/api/capacitor.ts.
@objc(KeychainPlugin)
public class KeychainPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeychainPlugin"
    public let jsName = "OniKeychain"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
    ]

    /// The key src/api/capacitor.ts keeps the OAuth token under.
    static let tokenKey = "yandex-oauth-token"
    private static let service = "local.wave.player"

    private static func query(_ key: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }

    /// Replaces the entry; nil deletes it. Returns the Keychain status.
    static func store(key: String, value: String?) -> OSStatus {
        SecItemDelete(query(key) as CFDictionary)
        guard let value = value else { return errSecSuccess }
        var q = query(key)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(q as CFDictionary, nil)
    }

    /// Resolves { value } with the stored string, or {} when there is none.
    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("key is required")
            return
        }
        var q = KeychainPlugin.query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) {
            call.resolve(["value": value])
        } else {
            call.resolve([:])
        }
    }

    /// Stores { key, value }; a missing or null value deletes the entry.
    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("key is required")
            return
        }
        let status = KeychainPlugin.store(key: key, value: call.getString("value"))
        if status != errSecSuccess {
            call.reject("keychain error \(status)")
            return
        }
        call.resolve()
    }
}

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
