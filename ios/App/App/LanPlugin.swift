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

/// The remote on the home network (src/sync/lan.ts): a WebSocket to Oni on the PC, whose address
/// and key are in Oni's folder on Yandex Disk. Native, not the page's own WebSocket: the page's
/// origin (capacitor://) may not open a plain ws:// one, and iOS keeps this one going while Oni
/// plays in the background. JS: registerPlugin('OniLan').
@objc(LanPlugin)
public class LanPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionWebSocketDelegate {
    public let identifier = "LanPlugin"
    public let jsName = "OniLan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "serve", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "serveSend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "serveStop", returnType: CAPPluginReturnPromise),
    ]

    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    /// The connections, by the id of the device at the other end.
    private var sockets: [String: URLSessionWebSocketTask] = [:]
    private var pings: [String: Timer] = [:]
    /// What a connection says first (its hello), by task, said once it is open: sent before that, it
    /// was lost now and then (the stand-in PC in the cloud check saw connections and never a hello,
    /// 25.10.2026), and the link was given up for Disk.
    private var hellos: [Int: () -> Void] = [:]

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        DispatchQueue.main.async { self.hellos.removeValue(forKey: webSocketTask.taskIdentifier)?() }
    }

    /// { id, url, hello, timeout (ms) }: resolves once the other side answers the hello (its first
    /// message, "welcome"); rejects if it does not in time or closes.
    @objc func open(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let raw = call.getString("url"), let url = URL(string: raw), let hello = call.getString("hello") else {
            return call.reject("id, url and hello")
        }
        let timeout = (call.getDouble("timeout") ?? 2500) / 1000
        DispatchQueue.main.async {
            self.drop(id)
            let task = self.session.webSocketTask(with: url)
            task.maximumMessageSize = 4 * 1024 * 1024
            self.sockets[id] = task
            var settled = false
            let settle: (String?) -> Void = { error in
                DispatchQueue.main.async {
                    guard !settled else { return }
                    settled = true
                    self.hellos[task.taskIdentifier] = nil
                    if let error = error {
                        self.drop(id, task)
                        call.reject(error)
                    } else {
                        call.resolve()
                    }
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { settle("no answer") }
            self.hellos[task.taskIdentifier] = {
                task.send(.string(hello)) { error in if let error = error { settle(error.localizedDescription) } }
            }
            task.resume()
            task.receive { result in
                switch result {
                case .success(.string(let text)) where text.contains("\"welcome\""):
                    settle(nil)
                    self.listen(id, task)
                    DispatchQueue.main.async { self.keepAlive(id, task) }
                case .success:
                    settle("unexpected answer")
                case .failure(let error):
                    settle(error.localizedDescription)
                }
            }
        }
    }

    /// { id, text }
    @objc func send(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        let text = call.getString("text") ?? ""
        DispatchQueue.main.async {
            guard let task = self.sockets[id] else { return call.reject("not connected") }
            task.send(.string(text)) { error in
                if let error = error {
                    DispatchQueue.main.async { self.drop(id, task) }
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve()
                }
            }
        }
    }

    /// { id }
    @objc func close(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        DispatchQueue.main.async {
            self.drop(id)
            call.resolve()
        }
    }

    private func listen(_ id: String, _ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(.string(let text)):
                self.notifyListeners("message", data: ["id": id, "text": text])
                self.listen(id, task)
            case .success:
                self.listen(id, task)
            case .failure:
                DispatchQueue.main.async { self.drop(id, task) }
            }
        }
    }

    /// A connection gone quiet (the PC asleep, another network) is noticed within half a minute.
    private func keepAlive(_ id: String, _ task: URLSessionWebSocketTask) {
        pings[id]?.invalidate()
        pings[id] = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            task.sendPing { error in
                if error != nil { DispatchQueue.main.async { self?.drop(id, task) } }
            }
        }
    }

    /// Closes the connection to `id` (only `task`, if given: a newer one stays) and tells the page.
    private func drop(_ id: String, _ task: URLSessionWebSocketTask? = nil) {
        guard let current = sockets[id], task == nil || current === task else { return }
        sockets[id] = nil
        pings[id]?.invalidate()
        pings[id] = nil
        current.cancel(with: .goingAway, reason: nil)
        notifyListeners("closed", data: ["id": id])
    }

    // ------------------------------------------------ listening together: this iPhone listens

    // The one who started a room on the iPhone (src/together/, docs/together.md): the guests on his
    // network connect here, as to the PC's electron/together.cjs; the room's number is the key.
    private var listener: NWListener?
    private var serveKey = ""
    private var welcome = ""
    /// The guests, by device id.
    private var guests: [String: NWConnection] = [:]

    /// { key, welcome } — resolves { port, hosts } once listening.
    @objc func serve(_ call: CAPPluginCall) {
        let key = call.getString("key") ?? ""
        let welcome = call.getString("welcome") ?? ""
        DispatchQueue.main.async {
            if self.listener != nil && self.serveKey != key { self.stopServing() }
            self.serveKey = key
            self.welcome = welcome
            if let port = self.listener?.port?.rawValue {
                return call.resolve(["port": Int(port), "hosts": LanPlugin.addresses()])
            }
            let ws = NWProtocolWebSocket.Options()
            ws.autoReplyPing = true
            ws.maximumMessageSize = 4 * 1024 * 1024
            let params = NWParameters.tcp
            params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
            guard let listener = try? NWListener(using: params, on: .any) else { return call.reject("cannot listen") }
            self.listener = listener
            var settled = false
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    guard !settled else { return }
                    settled = true
                    call.resolve(["port": Int(listener.port?.rawValue ?? 0), "hosts": LanPlugin.addresses()])
                case .failed(let error):
                    if !settled {
                        settled = true
                        call.reject(error.localizedDescription)
                    }
                    if self?.listener === listener { self?.stopServing() }
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
            listener.start(queue: .main)
        }
    }

    /// { to (none: all), text }
    @objc func serveSend(_ call: CAPPluginCall) {
        let to = call.getString("to")
        let text = call.getString("text") ?? ""
        DispatchQueue.main.async {
            for (id, conn) in self.guests where to == nil || to == id { LanPlugin.sendText(conn, text) }
            call.resolve()
        }
    }

    @objc func serveStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopServing()
            call.resolve()
        }
    }

    private func stopServing() {
        for conn in guests.values { conn.cancel() }
        guests = [:]
        listener?.cancel()
        listener = nil
        notifyListeners("guests", data: ["ids": [String]()])
    }

    private func accept(_ conn: NWConnection) {
        var id: String?
        conn.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled:
                guard let self = self, let gone = id, self.guests[gone] === conn else { return }
                self.guests[gone] = nil
                self.notifyListeners("guests", data: ["ids": Array(self.guests.keys)])
            default:
                break
            }
        }
        conn.start(queue: .main)
        // A connection that has not said the key in 5 s is closed.
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { if id == nil { conn.cancel() } }
        func receive() {
            conn.receiveMessage { [weak self] data, _, _, error in
                guard let self = self, error == nil else { return conn.cancel() }
                if let data = data, let text = String(data: data, encoding: .utf8) {
                    if let known = id {
                        self.notifyListeners("guestMessage", data: ["id": known, "text": text])
                    } else {
                        let hello = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                        let device = hello?["device"] as? [String: Any]
                        guard hello?["t"] as? String == "hello", !self.serveKey.isEmpty, hello?["key"] as? String == self.serveKey, let who = device?["id"] as? String else {
                            return conn.cancel()
                        }
                        id = who
                        self.guests[who]?.cancel()
                        self.guests[who] = conn
                        LanPlugin.sendText(conn, self.welcome)
                        self.notifyListeners("guests", data: ["ids": Array(self.guests.keys)])
                    }
                }
                receive()
            }
        }
        receive()
    }

    private static func sendText(_ conn: NWConnection, _ text: String) {
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "text", metadata: [meta])
        conn.send(content: text.data(using: .utf8), contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
    }

    /// The iPhone's addresses on its Wi-Fi (a simulator's: the Mac's), the likeliest first.
    private static func addresses() -> [String] {
        var out: [(String, Int)] = []
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return [] }
        defer { freeifaddrs(list) }
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let p = cursor {
            cursor = p.pointee.ifa_next
            guard let addr = p.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            let name = String(cString: p.pointee.ifa_name)
            guard name.hasPrefix("en") || name.hasPrefix("bridge") || name == "lo0" else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let ip = String(cString: host)
            let parts = ip.split(separator: ".").compactMap { Int($0) }
            let rank = ip.hasPrefix("192.168.") ? 0 : (parts.count == 4 && parts[0] == 172 && (16...31).contains(parts[1])) ? 1 : ip.hasPrefix("10.") ? 2 : name == "lo0" ? 9 : -1
            if rank >= 0 { out.append((ip, rank)) }
        }
        return out.sorted { $0.1 < $1.1 }.map { $0.0 }
    }
}
