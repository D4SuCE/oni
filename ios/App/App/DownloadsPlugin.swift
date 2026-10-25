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
        CAPPluginMethod(name: "network", returnType: CAPPluginReturnPromise),
    ]

    /// The network as iOS sees it now: "Keep mine offline" downloads over Wi-Fi only, not on mobile
    /// data or a phone's hotspot (expensive), nor in Low Data Mode (constrained).
    private static let paths: NWPathMonitor = {
        let monitor = NWPathMonitor()
        monitor.start(queue: DispatchQueue(label: "oni.network"))
        return monitor
    }()

    @objc func network(_ call: CAPPluginCall) {
        let path = DownloadsPlugin.paths.currentPath
        call.resolve(["satisfied": path.status == .satisfied, "expensive": path.isExpensive, "constrained": path.isConstrained])
    }

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
        _ = DownloadsPlugin.paths // watching from the start: its first answer takes a moment
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
