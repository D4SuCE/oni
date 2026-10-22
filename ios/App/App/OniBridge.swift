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

    /// The stored string, or nil.
    static func read(key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Resolves { value } with the stored string, or {} when there is none.
    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("key is required")
            return
        }
        if let value = KeychainPlugin.read(key: key) {
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

/// The lock screen and Control Center player, run natively. WebKit's own (from the Media Session
/// API) showed -10 s / +10 s instead of previous / next whatever the page asked for, and has no
/// like. This one disables the skip-interval commands, offers previous / next / seek / like, and
/// sends every command to the page: JS registerPlugin('OniRemote') in src/player/remote.ts.
@objc(RemotePlugin)
public class RemotePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RemotePlugin"
    public let jsName = "OniRemote"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setNowPlaying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "state", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "press", returnType: CAPPluginReturnPromise),
    ]

    private var artworkURL: String?
    private var artwork: MPMediaItemArtwork?

    override public func load() {
        DispatchQueue.main.async { self.setUpCommands() }
    }

    private func setUpCommands() {
        let center = MPRemoteCommandCenter.shared()
        for command in [center.skipForwardCommand, center.skipBackwardCommand, center.seekForwardCommand, center.seekBackwardCommand] {
            command.isEnabled = false
        }
        let named: [(MPRemoteCommand, String)] = [
            (center.playCommand, "play"),
            (center.pauseCommand, "pause"),
            (center.togglePlayPauseCommand, "toggle"),
            (center.nextTrackCommand, "next"),
            (center.previousTrackCommand, "prev"),
            (center.likeCommand, "like"),
        ]
        for (command, name) in named {
            command.isEnabled = true
            command.addTarget { [weak self] _ in
                self?.handle(name)
                return .success
            }
        }
        center.likeCommand.localizedTitle = "Мне нравится"
        center.likeCommand.localizedShortTitle = "Мне нравится"
        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.notifyListeners("command", data: ["name": "seek", "position": event.positionTime])
            return .success
        }
    }

    /// { title, artist, album, artwork (URL), duration, position, playing, liked }
    @objc func setNowPlaying(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let artist = call.getString("artist") ?? ""
        let album = call.getString("album") ?? ""
        let duration = call.getDouble("duration") ?? 0
        let position = call.getDouble("position") ?? 0
        let playing = call.getBool("playing") ?? false
        let liked = call.getBool("liked") ?? false
        let artworkURL = call.getString("artwork")
        DispatchQueue.main.async {
            var info: [String: Any] = [
                MPMediaItemPropertyTitle: title,
                MPMediaItemPropertyArtist: artist,
                MPMediaItemPropertyAlbumTitle: album,
                MPMediaItemPropertyPlaybackDuration: duration,
                MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
                MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
                MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
                MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            ]
            if artworkURL == self.artworkURL, let artwork = self.artwork { info[MPMediaItemPropertyArtwork] = artwork }
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
            MPRemoteCommandCenter.shared().likeCommand.isActive = liked
            if artworkURL != self.artworkURL { self.loadArtwork(artworkURL) }
            call.resolve()
        }
    }

    private func loadArtwork(_ address: String?) {
        artworkURL = address
        artwork = nil
        guard let address = address, let url = URL(string: address) else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data = data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self = self, self.artworkURL == address else { return }
                let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.artwork = artwork
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }.resume()
    }

    /// Play and pause are done here, by the player itself: after a few minutes paused with the
    /// screen locked iOS freezes the page, and a "play" sent there went nowhere (the user on
    /// 1.6.1). The page catches up from the player's clock when it wakes (nativeAudio.ts). The
    /// rest (next, like, seek) and a play with nothing open go to the page.
    private func handle(_ name: String) {
        let player = PlayerPlugin.shared
        let done: Bool
        switch name {
        case "play": done = player?.resume() ?? false
        case "pause": done = player?.pauseNow() ?? false
        case "toggle": done = (player?.isPlaying ?? false) ? player?.pauseNow() ?? false : player?.resume() ?? false
        default: done = false
        }
        guard done, let player = player else { return notifyListeners("command", data: ["name": name]) }
        // The lock screen shows it at once, the page asleep or not.
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = player.currentTime
        info[MPNowPlayingInfoPropertyPlaybackRate] = player.isPlaying ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = player.isPlaying ? .playing : .paused
    }

    /// For the simulator run: a lock-screen button pressed ({ name }), handled as iOS would hand it
    /// over; resolves whether the player plays right after, before the page could do a thing.
    @objc func press(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? ""
        DispatchQueue.main.async {
            self.handle(name)
            call.resolve(["playing": PlayerPlugin.shared?.isPlaying ?? false])
        }
    }

    /// For the simulator run: what the system was told, and which commands are on.
    @objc func state(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let center = MPRemoteCommandCenter.shared()
            let info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
            call.resolve([
                "title": info[MPMediaItemPropertyTitle] as? String ?? "",
                "next": center.nextTrackCommand.isEnabled,
                "prev": center.previousTrackCommand.isEnabled,
                "skip": center.skipForwardCommand.isEnabled || center.skipBackwardCommand.isEnabled,
                "like": center.likeCommand.isEnabled,
            ])
        }
    }
}

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

/// The downloads' key (src/player/offline.ts): AES-256-GCM, and a file is the 12-byte nonce, the
/// ciphertext and the 16-byte tag (CryptoKit's "combined", the page's Web Crypto layout too). The
/// page hands it over; it is kept in the Keychain for launches in the background, when no page runs.
/// Sealing and opening here keeps the audio off the bridge: as base64 text through the page it
/// froze the iPhone's interface on every downloaded track.
enum Vault {
    static let keychainKey = "offline-key"
    private static var cached: SymmetricKey?
    private static let lock = NSLock()

    static func set(base64: String) {
        guard let data = Data(base64Encoded: base64), data.count == 32 else { return }
        lock.lock()
        cached = SymmetricKey(data: data)
        lock.unlock()
        if KeychainPlugin.read(key: keychainKey) != base64 { _ = KeychainPlugin.store(key: keychainKey, value: base64) }
    }

    static var key: SymmetricKey? {
        lock.lock()
        defer { lock.unlock() }
        if cached == nil, let b64 = KeychainPlugin.read(key: keychainKey), let data = Data(base64Encoded: b64), data.count == 32 {
            cached = SymmetricKey(data: data)
        }
        return cached
    }

    static func seal(_ data: Data, with key: SymmetricKey) throws -> Data {
        guard let combined = try AES.GCM.seal(data, using: key).combined else { throw CryptoKitError.incorrectParameterSize }
        return combined
    }

    static func open(_ data: Data, with key: SymmetricKey) throws -> Data {
        return try AES.GCM.open(try AES.GCM.SealedBox(combined: data), using: key)
    }
}

/// Downloads that go on while Oni is in the background or the screen is locked: a background
/// URLSession, run by iOS itself (it cancels them only if the app is swiped away). They go a few at
/// a time in the order the page gives (a list top first, as in Yandex's app: iOS left alone took
/// hundreds at once in an order of its own). Each finished file is sealed with the key into
/// Library/oni-sealed/<id>.oni, which the page moves into the library; without the key it lands as
/// it is in Library/oni-incoming/<id> for the page to seal (src/player/backgroundDownloads.ts).
/// The count shows in the Dynamic Island and on the lock screen (a Live Activity, OniActivity), or
/// as a quiet notification where those are off. JS: registerPlugin('OniDownloads').
@objc(DownloadsPlugin)
public class DownloadsPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDownloadDelegate {
    public let identifier = "DownloadsPlugin"
    public let jsName = "OniDownloads"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "enqueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "running", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "progress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "state", returnType: CAPPluginReturnPromise),
    ]

    /// Files fetched at once.
    static let parallel = 4
    private static let waitingKey = "oni.downloads.waiting"

    /// One instance for the app's whole life: iOS hands the session's events to whoever made it.
    static var shared = DownloadsPlugin()
    static var backgroundCompletion: (() -> Void)?

    static func folder(_ name: String) -> URL {
        let dir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent(name, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
    static var incoming: URL { folder("oni-incoming") }
    static var sealed: URL { folder("oni-sealed") }

    lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "oni.downloads")
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        // Once the whole queue is with iOS (the app left the screen), still a few at a time.
        config.httpMaximumConnectionsPerHost = DownloadsPlugin.parallel
        return URLSession(configuration: config, delegate: DownloadsPlugin.shared, delegateQueue: nil)
    }()

    /// The queue and what iOS is fetching, touched on `ledger` only. The queue is kept on disk too,
    /// so a relaunch in the background goes on with it while no page runs.
    private let ledger = DispatchQueue(label: "oni.downloads.ledger")
    private var waiting: [[String: String]] = []
    private var active = Set<String>()
    private var restored = false
    /// On screen. Off it, iOS treats a transfer started then as discretionary (it may wait for
    /// Wi-Fi and a charger): the user saw downloads stop once Oni was put away, because the next
    /// ones were started from the background. So leaving the screen hands iOS the whole queue.
    private var onScreen = true
    /// The screen notifications are subscribed to (on main; restore may be called twice).
    private var observing = false

    /// The count (from the page; moved on here for each file while the page sleeps) and its texts.
    private var labels: [String: String] = [:]
    private var title = ""
    private var done = 0
    private var total = 0
    private var shownAt = Date.distantPast
    /// The Live Activity (Activity<DownloadAttributes>, iOS 16.2+), kept untyped for iOS 15.
    private var activity: Any?

    private var lastProgress: [String: Date] = [:]
    private weak var page: DownloadsPlugin?

    override public func load() {
        // Capacitor makes this instance; events go out through it, the session lives in `shared`.
        DownloadsPlugin.shared.page = self
        DownloadsPlugin.shared.restore()
    }

    /// The queue from disk and what iOS still fetches from before (a relaunch).
    func restore() {
        _ = session // made here, on the main thread, before any other thread asks for it
        if !observing {
            observing = true
            let center = NotificationCenter.default
            center.addObserver(self, selector: #selector(leaving), name: UIApplication.willResignActiveNotification, object: nil)
            center.addObserver(self, selector: #selector(leaving), name: UIApplication.didEnterBackgroundNotification, object: nil)
            center.addObserver(self, selector: #selector(returning), name: UIApplication.didBecomeActiveNotification, object: nil)
            onScreen = UIApplication.shared.applicationState == .active
        }
        ledger.async {
            guard !self.restored else { return }
            self.restored = true
            self.waiting = (UserDefaults.standard.array(forKey: DownloadsPlugin.waitingKey) as? [[String: String]]) ?? []
            self.session.getAllTasks { tasks in
                self.ledger.async {
                    for task in tasks where task.state == .running || task.state == .suspended {
                        if let id = task.taskDescription { self.active.insert(id) }
                    }
                    self.pump()
                }
            }
        }
        DispatchQueue.main.async {
            if #available(iOS 16.2, *), let running = Activity<DownloadAttributes>.activities.first {
                self.activity = running
                self.title = running.attributes.title
                self.done = running.content.state.done
                self.total = running.content.state.total
            }
        }
    }

    private func emit(_ event: String, _ data: [String: Any]) {
        (page ?? DownloadsPlugin.shared.page)?.notifyListeners(event, data: data)
    }

    // MARK: the queue

    /// Starts the next ones while fewer than `parallel` are fetched; off screen, all of them
    /// (`leaving`). On `ledger`.
    private func pump() {
        let all = !onScreenNow
        let count = waiting.count
        var n = 0
        while (all || active.count < DownloadsPlugin.parallel), !waiting.isEmpty {
            let item = waiting.removeFirst()
            guard let id = item["id"], let address = item["url"], let url = URL(string: address), !active.contains(id) else { continue }
            let task = session.downloadTask(with: url)
            task.taskDescription = id
            // The list's order as a hint to iOS, which picks among what it holds: the top first.
            if all { task.priority = max(0.05, 0.9 - 0.85 * Float(n) / Float(max(count, 1))) }
            n += 1
            active.insert(id)
            task.resume()
        }
        UserDefaults.standard.set(waiting, forKey: DownloadsPlugin.waitingKey)
    }

    /// `onScreen` as seen from `ledger` (set on main, read here).
    private var onScreenNow: Bool {
        screenLock.lock()
        defer { screenLock.unlock() }
        return onScreen
    }
    private let screenLock = NSLock()

    /// Off the screen: everything queued goes to iOS now, while the app may still start transfers
    /// that are not discretionary. A short background task covers the hand-over.
    @objc private func leaving() {
        screenLock.lock()
        onScreen = false
        screenLock.unlock()
        var task: UIBackgroundTaskIdentifier = .invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "oni.downloads") {
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
        ledger.async {
            self.pump()
            DispatchQueue.main.async {
                guard task != .invalid else { return }
                UIApplication.shared.endBackgroundTask(task)
                task = .invalid
            }
        }
    }

    @objc private func returning() {
        screenLock.lock()
        onScreen = true
        screenLock.unlock()
    }

    /// { items: [{ id, url }] } — queued in this order behind what is queued already.
    @objc func enqueue(_ call: CAPPluginCall) {
        let items = (call.getArray("items", JSObject.self) ?? []).compactMap { item -> [String: String]? in
            guard let id = item["id"] as? String, let url = item["url"] as? String else { return nil }
            return ["id": id, "url": url]
        }
        let me = DownloadsPlugin.shared
        me.ledger.async {
            let known = Set(me.waiting.compactMap { $0["id"] }).union(me.active)
            me.waiting += items.filter { !known.contains($0["id"]!) }
            me.pump()
            call.resolve()
        }
    }

    /// The ids iOS is fetching or that wait their turn.
    @objc func running(_ call: CAPPluginCall) {
        let me = DownloadsPlugin.shared
        me.ledger.async {
            call.resolve(["ids": Array(me.active) + me.waiting.compactMap { $0["id"] }])
        }
    }

    /// { ids?: [String] } — those, or all.
    @objc func cancel(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self).map(Set.init)
        let me = DownloadsPlugin.shared
        me.ledger.async {
            me.waiting.removeAll { ids == nil || ids!.contains($0["id"] ?? "") }
            UserDefaults.standard.set(me.waiting, forKey: DownloadsPlugin.waitingKey)
            me.session.getAllTasks { tasks in
                for task in tasks where ids == nil || ids!.contains(task.taskDescription ?? "") { task.cancel() }
                call.resolve()
            }
        }
    }

    /// { key } — the library's key, base64.
    @objc func setKey(_ call: CAPPluginCall) {
        Vault.set(base64: call.getString("key") ?? "")
        call.resolve()
    }

    // MARK: the session

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let id = downloadTask.taskDescription else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            emit("failed", ["id": id, "status": status])
            return
        }
        // The file at `location` is gone once this returns: sealed or moved now.
        do {
            if let key = Vault.key {
                let target = DownloadsPlugin.sealed.appendingPathComponent(id + ".oni")
                try Vault.seal(try Data(contentsOf: location), with: key).write(to: target, options: .atomic)
            } else {
                let target = DownloadsPlugin.incoming.appendingPathComponent(id)
                try? FileManager.default.removeItem(at: target)
                try FileManager.default.moveItem(at: location, to: target)
            }
            emit("done", ["id": id])
            DispatchQueue.main.async { self.advance() }
        } catch {
            emit("failed", ["id": id, "status": 0])
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let id = task.taskDescription ?? ""
        ledger.async {
            self.active.remove(id)
            self.pump()
        }
        if let error = error, (error as NSError).code == NSURLErrorCancelled { return }
        guard error != nil, !id.isEmpty else { return }
        emit("failed", ["id": id, "status": 0])
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let id = downloadTask.taskDescription else { return }
        let now = Date()
        if let last = lastProgress[id], now.timeIntervalSince(last) < 0.5 { return }
        lastProgress[id] = now
        emit("progress", ["id": id, "written": totalBytesWritten, "total": totalBytesExpectedToWrite])
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            DownloadsPlugin.backgroundCompletion?()
            DownloadsPlugin.backgroundCompletion = nil
        }
    }

    // MARK: the count outside the app

    /// { progress, done, title } — the texts ({done}, {total}) and the permission for notifications.
    @objc func notifications(_ call: CAPPluginCall) {
        let me = DownloadsPlugin.shared
        DispatchQueue.main.async {
            me.labels = ["progress": call.getString("progress") ?? "", "done": call.getString("done") ?? "", "stale": call.getString("stale") ?? ""]
            if me.title.isEmpty { me.title = call.getString("title") ?? "" }
        }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { granted, _ in
            call.resolve(["granted": granted])
        }
    }

    /// { done, total, title } — the lists' count, as their buttons show it; a total of 0 (all
    /// cancelled) takes the Live Activity and the notification away.
    @objc func progress(_ call: CAPPluginCall) {
        let me = DownloadsPlugin.shared
        DispatchQueue.main.async {
            me.done = call.getInt("done") ?? me.done
            me.total = call.getInt("total") ?? me.total
            me.title = call.getString("title") ?? me.title
            if me.total > 0 { me.show() } else { me.clear() }
            call.resolve()
        }
    }

    /// Nothing to download any more (cancelled): the count goes from the island, the lock screen
    /// and the shade at once (the user: they kept the old numbers). On main.
    private func clear() {
        done = 0
        shownAt = .distantPast
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["oni-downloads"])
        if #available(iOS 16.2, *), let running = activity as? Activity<DownloadAttributes> {
            activity = nil
            Task { await running.end(nil, dismissalPolicy: .immediate) }
        }
    }

    /// For the smoke test.
    @objc func state(_ call: CAPPluginCall) {
        let me = DownloadsPlugin.shared
        DispatchQueue.main.async {
            var live = false
            if #available(iOS 16.2, *) { live = me.activity is Activity<DownloadAttributes> }
            me.ledger.async {
                call.resolve(["activity": live, "done": me.done, "total": me.total, "queued": me.waiting.count, "running": me.active.count])
            }
        }
    }

    /// One more file is in while the page may sleep: the count moves on by itself (the page's
    /// next count replaces it).
    private func advance() {
        guard total > 0, done < total else { return }
        done += 1
        show()
    }

    private func line(_ through: Bool) -> String {
        let template = labels[through ? "done" : "progress"] ?? ""
        let text = template.isEmpty ? "\(done) / \(total)" : template
        return text.replacingOccurrences(of: "{done}", with: String(done)).replacingOccurrences(of: "{total}", with: String(total))
    }

    /// Shows the count: about once a second while files come, and at the end. On main.
    private func show() {
        guard total > 0 else { return }
        let through = done >= total
        if !through && Date().timeIntervalSince(shownAt) < 1 { return }
        shownAt = Date()
        if #available(iOS 16.2, *), showActivity(through) { return }
        notify(through)
    }

    /// The Live Activity: started with the first count (the app is on screen then: iOS starts
    /// one only from the foreground), updated, and ended a minute after the last file.
    @available(iOS 16.2, *)
    private func showActivity(_ through: Bool) -> Bool {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
        let state = DownloadAttributes.ContentState(done: done, total: total, line: line(through), finished: through, staleLine: labels["stale"] ?? "")
        // Not moved for a minute: the app is frozen in the background (iOS wakes it only at the
        // end), and the island says so instead of showing an old count as current (the user).
        let content = ActivityContent(state: state, staleDate: through ? nil : Date().addingTimeInterval(60))
        if let running = activity as? Activity<DownloadAttributes> {
            if through {
                activity = nil
                Task { await running.end(content, dismissalPolicy: .after(Date().addingTimeInterval(60))) }
            } else {
                Task { await running.update(content) }
            }
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["oni-downloads"])
            return true
        }
        guard !through, let started = try? Activity<DownloadAttributes>.request(attributes: DownloadAttributes(title: title), content: content, pushType: nil) else { return false }
        activity = started
        return true
    }

    /// Where there is no Live Activity: a quiet notification, replaced in place.
    private func notify(_ through: Bool) {
        let content = UNMutableNotificationContent()
        content.title = title.isEmpty ? "Oni" : title
        content.body = line(through)
        if #available(iOS 15.0, *) { content.interruptionLevel = .passive }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "oni-downloads", content: content, trigger: nil))
    }
}

/// A track on its way from the network into the player's cache, written as it arrives
/// (`<id>.<ext>.part`, renamed to `<id>.<ext>` once whole) with its MP3 frames counted as they
/// come (AudioFileStream), so the player can start it after a few seconds of audio instead of the
/// whole file (the user's wish after 1.7.0) and give it more as more arrives.
final class TrackFetch {
    let id: String
    let target: URL
    var part: URL { target.appendingPathExtension("part") }
    var task: URLSessionDataTask?
    /// Called once it is whole (or failed): the prefetch and those who wait for the whole file.
    var waiters: [(Result<URL, Error>) -> Void] = []

    private let lock = NSLock()
    private var handle: FileHandle?
    private var parser: AudioFileStreamID?
    // Written by the parser's callbacks (on the session's queue, inside parse), read under the lock.
    fileprivate var packetsRaw: Int64 = 0
    fileprivate var framesPerPacketRaw: UInt32 = 1152
    fileprivate var sampleRateRaw: Double = 0

    private var _received: Int64 = 0
    private var _expected: Int64 = -1
    private var _done = false
    private var _failed: Error?

    init(id: String, target: URL) {
        self.id = id
        self.target = target
    }

    struct State {
        var received: Int64
        var expected: Int64
        var done: Bool
        var failed: Error?
        /// Frames of audio arrived whole, and their rate (0 until the first frame is seen).
        var frames: AVAudioFramePosition
        var sampleRate: Double
    }

    var state: State {
        lock.lock()
        defer { lock.unlock() }
        return State(received: _received, expected: _expected, done: _done, failed: _failed, frames: AVAudioFramePosition(packetsRaw) * AVAudioFramePosition(framesPerPacketRaw), sampleRate: sampleRateRaw)
    }

    /// The response came: the file is started, the parser opened (MP3 only: other codecs are not counted).
    func begin(expected: Int64, mp3: Bool) throws {
        try? FileManager.default.removeItem(at: part)
        FileManager.default.createFile(atPath: part.path, contents: nil)
        handle = try FileHandle(forWritingTo: part)
        lock.lock()
        _expected = expected
        lock.unlock()
        guard mp3 else { return }
        let me = Unmanaged.passUnretained(self).toOpaque()
        AudioFileStreamOpen(me, { client, stream, property, _ in
            guard property == kAudioFileStreamProperty_DataFormat else { return }
            let fetch = Unmanaged<TrackFetch>.fromOpaque(client).takeUnretainedValue()
            var format = AudioStreamBasicDescription()
            var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            if AudioFileStreamGetProperty(stream, property, &size, &format) == noErr {
                fetch.sampleRateRaw = format.mSampleRate
                if format.mFramesPerPacket > 0 { fetch.framesPerPacketRaw = format.mFramesPerPacket }
            }
        }, { client, _, packets, _, _ in
            let fetch = Unmanaged<TrackFetch>.fromOpaque(client).takeUnretainedValue()
            fetch.packetsRaw += Int64(packets)
        }, kAudioFileMP3Type, &parser)
    }

    /// More bytes: written, counted. Throws when the file cannot be written (it was trimmed away).
    func append(_ data: Data) throws {
        try handle?.write(contentsOf: data)
        lock.lock()
        if let parser = parser {
            data.withUnsafeBytes { raw in
                _ = AudioFileStreamParseBytes(parser, UInt32(raw.count), raw.baseAddress, [])
            }
        }
        _received += Int64(data.count)
        lock.unlock()
    }

    /// The download is over: whole (renamed into place) or failed.
    func finish(_ error: Error?) {
        try? handle?.close()
        handle = nil
        lock.lock()
        if let parser = parser { AudioFileStreamClose(parser) }
        parser = nil
        if let error = error {
            _failed = error
            try? FileManager.default.removeItem(at: part)
        } else {
            try? FileManager.default.removeItem(at: target)
            do {
                try FileManager.default.moveItem(at: part, to: target)
                _done = true
            } catch {
                _failed = error
            }
        }
        lock.unlock()
    }
}

/// The iPhone's music player. WebKit's own (an <audio> element) took the lock screen with
/// -10 s / +10 s, and its Web Audio equalizer lagged a second or two behind every seek and went
/// silent when the screen locked. This plays in the app itself: AVAudioEngine, a player node and
/// the system's 10-band equalizer. A track is fetched whole into Caches/oni-play first (the next
/// ones ahead of time); downloaded tracks are written there decrypted by the page. The page sees
/// it as an audio element: src/player/nativeAudio.ts. JS: registerPlugin('OniPlayer').
/// Two player nodes into one mixer, for crossfades: the next track starts on the other node while
/// this one fades out (`open` with `fade`), and from then on the other is the one.
@objc(PlayerPlugin)
public class PlayerPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDataDelegate {
    public let identifier = "PlayerPlugin"
    public let jsName = "OniPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEq", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setGain", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "state", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testThrottle", returnType: CAPPluginReturnPromise),
    ]

    /// The equalizer's bands, as on the desktop (src/player/eq.ts).
    static let bands: [Float] = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000]

    private let engine = AVAudioEngine()
    private let nodes = [AVAudioPlayerNode(), AVAudioPlayerNode()]
    /// Which of `nodes` plays the track now.
    private var active = 0
    private var node: AVAudioPlayerNode { nodes[active] }
    /// Both nodes meet here (each on a bus of its own), before the equalizer.
    private let mix = AVAudioMixerNode()
    private let eq = AVAudioUnitEQ(numberOfBands: 10)
    private var file: AVAudioFile?
    /// The format each node is connected with (its file's).
    private var formats: [AVAudioFormat?] = [nil, nil]
    private var format: AVAudioFormat? { formats[active] }
    /// A crossfade under way: the old track's node, fading out, and the clock of the fade.
    private var tail: AVAudioPlayerNode?
    private var crossing: Timer?
    /// Where the current schedule starts, in frames; position = this + what the node has played.
    private var startFrame: AVAudioFramePosition = 0
    /// Bumped on every new schedule: the completion of an older one (stopped, replaced) is ignored.
    private var generation = 0
    private var playing = false
    private var pausedAt: Double = 0
    private var timer: Timer?
    private let lock = NSLock()

    // Fast start: a track plays once START seconds of it have come; the rest is given to the node
    // in pieces as it arrives (`extend`). Running short, the node stops and waits ("stalled",
    // shown as loading) rather than play silence that would move the clock on.
    private static let START: Double = 8
    /// Frames kept back from the newest end (a frame being written), and the smallest piece given.
    private static let MARGIN: AVAudioFramePosition = 4608
    private static let PIECE: AVAudioFramePosition = 44100
    /// Downloads under way by track id (written under `lock`), on a session of their own.
    private var fetching: [String: TrackFetch] = [:]
    private var byTask: [Int: TrackFetch] = [:]
    private lazy var session: URLSession = {
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        return URLSession(configuration: .default, delegate: self, delegateQueue: queue)
    }()
    /// Those waiting to start a track as soon as enough of it is in (main thread).
    private var starters: [String: [() -> Void]] = [:]
    /// Bumped by every open: a track that comes in after a newer one was asked for is not played
    /// (quick skips: the old one, arriving last, began over the new).
    private var opens = 0
    /// The track playing, while it is still arriving (nil once whole, or for a file from disk).
    private var stream: TrackFetch?
    /// Its length as the page knows it (the file's own is only known once whole).
    private var durationHint: Double = 0
    /// Frames handed to the node so far, pieces not yet played, and whether it waits for data.
    private var scheduledEnd: AVAudioFramePosition = 0
    private var outstanding = 0
    private var stalled = false
    /// For the simulator run: downloads held to this many bytes a second (0: as fast as they come).
    static var throttle: Double = 0

    /// The one player, for the lock screen's play and pause (RemotePlugin).
    static weak var shared: PlayerPlugin?

    static var folder: URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("oni-play", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    override public func load() {
        PlayerPlugin.shared = self
        for (i, band) in eq.bands.enumerated() {
            band.frequency = PlayerPlugin.bands[i]
            band.filterType = i == 0 ? .lowShelf : (i == PlayerPlugin.bands.count - 1 ? .highShelf : .parametric)
            band.bandwidth = 1.0
            band.gain = 0
            band.bypass = false
        }
        eq.bypass = true
        for n in nodes { engine.attach(n) }
        engine.attach(mix)
        engine.attach(eq)
        engine.connect(mix, to: eq, format: nil)
        engine.connect(eq, to: engine.mainMixerNode, format: nil)
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        center.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        center.addObserver(self, selector: #selector(configurationChanged(_:)), name: .AVAudioEngineConfigurationChange, object: engine)
    }

    // MARK: files

    /// { id, url, ext } — fetches a track into the cache ahead of time (no-op if it is there).
    @objc func fetch(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let url = call.getString("url") else {
            call.reject("id and url are required")
            return
        }
        localFile(id: id, url: url, ext: call.getString("ext") ?? "mp3") { result in
            switch result {
            case .success: call.resolve()
            case .failure(let error): call.reject(error.localizedDescription)
            }
        }
    }

    private func cached(_ id: String, _ ext: String) -> URL {
        return PlayerPlugin.folder.appendingPathComponent(id + "." + ext)
    }

    /// The track's file, whole: from the cache, or once its download is over (however many ask).
    private func localFile(id: String, url: String, ext: String, done: @escaping (Result<URL, Error>) -> Void) {
        let target = cached(id, ext)
        if FileManager.default.fileExists(atPath: target.path) {
            done(.success(target))
            return
        }
        guard let fetch = fetchFor(id: id, url: url, ext: ext) else {
            done(.failure(URLError(.badURL)))
            return
        }
        lock.lock()
        fetch.waiters.append(done)
        lock.unlock()
    }

    /// The download of a track: the one under way, or a new one.
    private func fetchFor(id: String, url: String, ext: String) -> TrackFetch? {
        lock.lock()
        defer { lock.unlock() }
        if let running = fetching[id] { return running }
        guard let remote = URL(string: url) else { return nil }
        let fetch = TrackFetch(id: id, target: cached(id, ext))
        let task = session.dataTask(with: remote)
        fetch.task = task
        fetching[id] = fetch
        byTask[task.taskIdentifier] = fetch
        task.resume()
        return fetch
    }

    private func fetchOf(_ task: URLSessionTask) -> TrackFetch? {
        lock.lock()
        defer { lock.unlock() }
        return byTask[task.taskIdentifier]
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard let fetch = fetchOf(dataTask), (200..<300).contains(status) else { return completionHandler(.cancel) }
        do {
            try fetch.begin(expected: response.expectedContentLength, mp3: fetch.target.pathExtension == "mp3")
            completionHandler(.allow)
        } catch {
            completionHandler(.cancel)
        }
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let fetch = fetchOf(dataTask) else { return }
        if PlayerPlugin.throttle > 0 { Thread.sleep(forTimeInterval: Double(data.count) / PlayerPlugin.throttle) }
        do {
            try fetch.append(data)
        } catch {
            return dataTask.cancel()
        }
        DispatchQueue.main.async { self.arrived(fetch) }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let fetch = fetchOf(task) else { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        fetch.finish(error ?? ((200..<300).contains(status) ? nil : URLError(.badServerResponse)))
        lock.lock()
        fetching.removeValue(forKey: fetch.id)
        byTask.removeValue(forKey: task.taskIdentifier)
        let waiting = fetch.waiters
        fetch.waiters = []
        lock.unlock()
        let result: Result<URL, Error> = fetch.state.done ? .success(fetch.target) : .failure(fetch.state.failed ?? URLError(.unknown))
        waiting.forEach { $0(result) }
        DispatchQueue.main.async { self.arrived(fetch) }
    }

    /// More of a track came (main thread): a start waiting for it goes, the one playing gets more.
    private func arrived(_ fetch: TrackFetch) {
        let st = fetch.state
        let enough = st.done || st.failed != nil || (st.sampleRate > 0 && Double(st.frames) >= PlayerPlugin.START * st.sampleRate)
        if enough, let waiting = starters.removeValue(forKey: fetch.id) { waiting.forEach { $0() } }
        if stream === fetch { extend() }
    }

    /// Keeps the cache to the tracks the page still needs (the playing one and those ahead).
    private func trim(keeping ids: [String]) {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: PlayerPlugin.folder.path)) ?? []
        for name in names where !ids.contains(where: { name.hasPrefix($0 + ".") }) {
            try? FileManager.default.removeItem(at: PlayerPlugin.folder.appendingPathComponent(name))
        }
    }

    // MARK: playback

    /// { id, url?, file?, ext, keep: [ids], fade? } — opens a track (from a URL, or a file the page
    /// wrote into the cache folder) at its start, paused; resolves { duration }. With `fade` (ms) and
    /// music playing, it starts at once and the playing track fades out into it (a crossfade).
    @objc func open(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("id is required")
            return
        }
        let ext = call.getString("ext") ?? "mp3"
        let keep = call.getArray("keep", String.self) ?? [id]
        let fade = call.getDouble("fade") ?? 0
        let hint = call.getDouble("duration") ?? 0
        lock.lock()
        opens += 1
        let mine = opens
        lock.unlock()
        /// Plays `file`; `fetch` while it is still arriving (main thread).
        let play: (AVAudioFile, TrackFetch?) -> Void = { file, fetch in
            self.lock.lock()
            let newest = self.opens == mine
            self.lock.unlock()
            guard newest else { return call.reject("superseded") }
            self.stream = fetch
            self.durationHint = hint
            if fade > 0 && self.playing { self.cross(into: file, seconds: fade / 1000) } else { self.begin(file) }
            self.trim(keeping: keep)
            call.resolve(["duration": self.duration])
        }
        let opened: (Result<URL, Error>) -> Void = { [weak self] result in
            DispatchQueue.main.async {
                guard self != nil else { return }
                switch result {
                case .failure(let error):
                    call.reject(error.localizedDescription)
                case .success(let url):
                    do {
                        play(try AVAudioFile(forReading: url), nil)
                    } catch {
                        call.reject("cannot open: " + error.localizedDescription)
                    }
                }
            }
        }
        if let b64 = call.getString("sealed") {
            // A downloaded track: its sealed file from the library, opened here into the cache the
            // player reads (the page used to decrypt it and send it over as text, a freeze each time).
            Vault.set(base64: b64)
            DispatchQueue.global(qos: .userInitiated).async {
                let source = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("offline/\(id).oni")
                let target = self.cached(id, ext)
                do {
                    guard let key = Vault.key else { throw CryptoKitError.incorrectKeySize }
                    try Vault.open(try Data(contentsOf: source), with: key).write(to: target, options: .atomic)
                    opened(.success(target))
                } catch {
                    opened(.failure(error))
                }
            }
        } else if let name = call.getString("file") {
            opened(.success(PlayerPlugin.folder.appendingPathComponent(name)))
        } else if let url = call.getString("url"), ext == "mp3", !FileManager.default.fileExists(atPath: cached(id, ext).path), let fetch = fetchFor(id: id, url: url, ext: ext) {
            // Fast start: once a few seconds of it are in, it plays from what has come so far.
            let go = { [weak self] in
                guard let self = self else { return }
                let st = fetch.state
                if let error = st.failed { return call.reject(error.localizedDescription) }
                if st.done { return opened(.success(fetch.target)) }
                guard let file = try? AVAudioFile(forReading: fetch.part) else { return opened(.failure(URLError(.cannotDecodeContentData))) }
                play(file, fetch)
            }
            DispatchQueue.main.async {
                // Only the newest open waits to start (an older one, of any track, is dropped).
                self.starters = [id: [go]]
                self.arrived(fetch)
            }
        } else if let url = call.getString("url") {
            localFile(id: id, url: url, ext: ext, done: opened)
        } else {
            call.reject("url or file is required")
        }
    }

    private func begin(_ file: AVAudioFile) {
        // A new track: a fade of the old one (another app's sound) is over, and so is a crossfade.
        endCross()
        fading?.invalidate()
        fading = nil
        node.volume = 1
        generation += 1
        node.stop()
        stopTimer()
        playing = false
        pausedAt = 0
        connect(file)
        self.file = file
        schedule(from: 0)
    }

    /// The active node, connected with this file's format.
    private func connect(_ file: AVAudioFile) {
        guard formats[active] != file.processingFormat else { return }
        engine.disconnectNodeOutput(node)
        engine.connect(node, to: mix, fromBus: 0, toBus: active, format: file.processingFormat)
        formats[active] = file.processingFormat
    }

    /// The crossfade: `file` starts on the other node at silence and rises while the playing one
    /// falls (equal power: as loud through the middle), then the old node stops.
    private func cross(into file: AVAudioFile, seconds: Double) {
        endCross()
        fading?.invalidate()
        fading = nil
        let old = node
        // The old track's end is no longer the end of what plays.
        generation += 1
        active = 1 - active
        node.stop()
        node.volume = 0
        connect(file)
        self.file = file
        pausedAt = 0
        schedule(from: 0)
        if !stalled { node.play() }
        tail = old
        let start = Date()
        crossing = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let p = min(1, Date().timeIntervalSince(start) / max(0.1, seconds))
            old.volume = Float(cos(p * .pi / 2))
            self.node.volume = Float(sin(p * .pi / 2))
            if p >= 1 { self.endCross() }
        }
        tick()
    }

    /// A crossfade still running is done now: the old track stops, the new one at full volume.
    private func endCross() {
        crossing?.invalidate()
        crossing = nil
        guard let old = tail else { return }
        tail = nil
        old.stop()
        old.volume = 1
        node.volume = 1
    }

    /// Hands the node the track from `frame`: all of it, or (still arriving) what has come so far.
    private func schedule(from frame: AVAudioFramePosition) {
        guard let file = file else { return }
        let from = max(0, frame)
        startFrame = from
        scheduledEnd = from
        outstanding = 0
        stalled = false
        guard stream != nil else {
            let end = file.length
            guard end > from else { return }
            give(file, upTo: end)
            return
        }
        // Nothing there yet (a seek ahead of the download): it waits, and plays once it comes.
        stalled = true
        extend()
    }

    /// A piece of the track to the node, `scheduledEnd` up to `end`.
    private func give(_ file: AVAudioFile, upTo end: AVAudioFramePosition) {
        let from = scheduledEnd
        scheduledEnd = end
        outstanding += 1
        let gen = generation
        node.scheduleSegment(file, startingFrame: from, frameCount: AVAudioFrameCount(end - from), at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self, self.generation == gen else { return }
                self.outstanding -= 1
                if self.outstanding == 0 { self.drained() }
            }
        }
    }

    /// More of the track arriving: what has come since is given to the node (a second or more at
    /// a time); once whole, the rest, and the whole file becomes the one to seek in.
    private func extend() {
        guard let fetch = stream, file != nil else { return }
        let st = fetch.state
        if st.failed != nil { return }
        // The newest view of it: what has arrived so far, or the whole file.
        guard let view = try? AVAudioFile(forReading: st.done ? fetch.target : fetch.part) else { return }
        let available = st.done ? view.length : min(view.length, st.frames) - PlayerPlugin.MARGIN
        if available > scheduledEnd && (st.done || outstanding == 0 || available - scheduledEnd >= PlayerPlugin.PIECE) {
            give(view, upTo: available)
            file = view
            if stalled {
                stalled = false
                if playing { node.play() }
                tick()
            }
        }
        if st.done {
            file = view
            stream = nil
        }
    }

    /// Everything given has played: the end, or (still arriving) a wait for more.
    private func drained() {
        if stream == nil {
            playing = false
            pausedAt = duration
            stopTimer()
            notifyListeners("ended", data: [:])
            return
        }
        // Ran short: the node stops (its clock with it) and starts again from here when more comes.
        pausedAt = Double(scheduledEnd) / (format?.sampleRate ?? 44100)
        generation += 1
        node.stop()
        startFrame = scheduledEnd
        outstanding = 0
        stalled = true
        tick()
        extend()
    }

    private var duration: Double {
        guard let file = file else { return 0 }
        let rate = file.processingFormat.sampleRate
        // Still arriving: the page's length (the file's own counts only what has come).
        if let fetch = stream {
            if durationHint > 0 { return durationHint }
            let st = fetch.state
            if st.expected > 0 && st.received > 0 { return Double(st.frames) * Double(st.expected) / Double(st.received) / rate }
        }
        return Double(file.length) / rate
    }

    private var position: Double {
        guard let file = file else { return 0 }
        guard playing, !stalled, let last = node.lastRenderTime, let time = node.playerTime(forNodeTime: last) else { return pausedAt }
        return min(duration, Double(startFrame + time.sampleTime) / file.processingFormat.sampleRate)
    }

    @objc func play(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.file != nil else {
                call.reject("nothing open")
                return
            }
            do {
                try self.start()
                call.resolve()
            } catch {
                call.reject("cannot start: " + error.localizedDescription)
            }
        }
    }

    private func start() throws {
        try AVAudioSession.sharedInstance().setActive(true)
        if !engine.isRunning { try engine.start() }
        // A fade under way (another app's sound) gives way to the user's play; a crossfade goes on.
        fading?.invalidate()
        fading = nil
        if tail == nil { node.volume = 1 }
        // What plays elsewhere already (a sound kept on by some app) is not a reason to stop.
        othersPlaying = AVAudioSession.sharedInstance().isOtherAudioPlaying
        // Waiting for more of the track: it plays once that comes (extend).
        if !stalled { node.play() }
        playing = true
        startTimer()
        tick()
    }

    var isPlaying: Bool { playing }
    var currentTime: Double { position }

    /// The lock screen's play (main thread): false when there is nothing open to play (or the
    /// track has ended), so the page is asked instead.
    func resume() -> Bool {
        guard file != nil, playing || pausedAt < duration - 0.05 else { return false }
        if playing { return true }
        return (try? start()) != nil
    }

    /// The lock screen's pause (main thread).
    func pauseNow() -> Bool {
        halt()
        return true
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.halt()
            call.resolve()
        }
    }

    private func halt() {
        guard playing else { return }
        // A pause mid-crossfade ends it: what comes back is the new track alone.
        endCross()
        pausedAt = position
        node.pause()
        // The engine too: running, it fed the output silence, and iOS took the app for playing, so
        // the lock screen and the shade kept "pause" up after a pause in Oni (the user). Play
        // starts it again; the node keeps its place.
        engine.pause()
        playing = false
        stopTimer()
        tick()
    }

    /// { time } in seconds; keeps playing if it was.
    @objc func seek(_ call: CAPPluginCall) {
        let time = call.getDouble("time") ?? 0
        DispatchQueue.main.async {
            guard let file = self.file else {
                call.resolve()
                return
            }
            let was = self.playing
            self.generation += 1
            self.node.stop()
            self.schedule(from: AVAudioFramePosition(max(0, time) * file.processingFormat.sampleRate))
            self.pausedAt = Double(self.startFrame) / file.processingFormat.sampleRate
            if was && !self.stalled { self.node.play() }
            self.tick()
            call.resolve()
        }
    }

    /// { enabled, preamp, gains: [dB] } — the desktop's settings, on the system equalizer.
    @objc func setEq(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        let preamp = Float(call.getDouble("preamp") ?? 0)
        let gains = call.getArray("gains", Double.self) ?? []
        DispatchQueue.main.async {
            self.eq.bypass = !enabled
            self.eq.globalGain = enabled ? preamp : 0
            for (i, band) in self.eq.bands.enumerated() {
                band.gain = enabled && i < gains.count ? Float(gains[i]) : 0
            }
            call.resolve()
        }
    }

    /// { value: 0…1 } — the loudness levelling; the volume itself is the phone's (OniVolume).
    @objc func setGain(_ call: CAPPluginCall) {
        let value = Float(call.getDouble("value") ?? 1)
        DispatchQueue.main.async {
            self.engine.mainMixerNode.outputVolume = value
            call.resolve()
        }
    }

    @objc func state(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let st = self.stream?.state
            call.resolve([
                "time": self.position, "duration": self.duration, "playing": self.playing, "eq": !self.eq.bypass, "engine": self.engine.isRunning,
                "crossing": self.tail != nil, "streaming": self.stream != nil, "waiting": self.stalled,
                "received": st?.received ?? 0, "expected": st?.expected ?? 0,
            ])
        }
    }

    /// { bytesPerSecond } — for the simulator run: downloads held to a slow network's pace (0: off).
    @objc func testThrottle(_ call: CAPPluginCall) {
        PlayerPlugin.throttle = call.getDouble("bytesPerSecond") ?? 0
        call.resolve()
    }

    // MARK: clock and the system

    private func startTimer() {
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private func tick() {
        notifyListeners("time", data: ["time": position, "duration": duration, "playing": playing, "waiting": playing && stalled])
        if playing && fading == nil && tail == nil { watchOthers() }
    }

    /// Whether another app played the last time the clock looked.
    private var othersPlaying = false
    private var fading: Timer?

    /// Another app's sound started over the music without taking it (Instagram's videos mix with
    /// others, so iOS says nothing and both played): the music fades out over a second and
    /// pauses, as the user expects when a video starts. Apps that take the sound (YouTube) are an
    /// interruption instead: iOS silences the music at once, before telling us, so no fade there.
    private func watchOthers() {
        let others = AVAudioSession.sharedInstance().isOtherAudioPlaying
        defer { othersPlaying = others }
        guard others, !othersPlaying else { return }
        let from = node.volume
        var step = 0
        let steps = 12
        fading = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] timer in
            guard let self = self else { return timer.invalidate() }
            step += 1
            self.node.volume = from * Float(max(0, steps - step)) / Float(steps)
            guard step >= steps else { return }
            timer.invalidate()
            self.fading = nil
            self.halt()
            self.node.volume = 1
        }
    }

    /// A call or another app took the sound: paused, and the page told (it shows paused).
    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        DispatchQueue.main.async { self.halt() }
    }

    /// Headphones pulled out: pause, as every music app does.
    @objc private func routeChanged(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        DispatchQueue.main.async { self.halt() }
    }

    /// The output changed under the engine (a route, a sample rate): restart it where it was.
    @objc private func configurationChanged(_ note: Notification) {
        DispatchQueue.main.async {
            self.endCross()
            let at = self.position
            let was = self.playing
            self.generation += 1
            self.node.stop()
            if let format = self.format { self.engine.connect(self.node, to: self.mix, fromBus: 0, toBus: self.active, format: format) }
            self.schedule(from: AVAudioFramePosition(at * (self.format?.sampleRate ?? 44100)))
            self.pausedAt = at
            if was, (try? self.engine.start()) != nil {
                if !self.stalled { self.node.play() }
            } else {
                self.playing = false
            }
            self.tick()
        }
    }
}
