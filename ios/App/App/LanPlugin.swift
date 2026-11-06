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
///
/// All of it on its own queue, with Network.framework (as the listening side below), not
/// URLSessionWebSocketTask on the main thread (6.11.2026): in the cloud check the PC saw a connection
/// and no hello for 10-20 s, a cancelled one closed only when the app quit and the next ones never
/// came (the task stuck), and whatever the link did waited for the main thread too: a busy moment
/// of the app held the hello past the 2.5 s the app allows, and the remote fell back to Disk.
@objc(LanPlugin)
public class LanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LanPlugin"
    public let jsName = "OniLan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "serve", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "serveSend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "serveStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testBusyMain", returnType: CAPPluginReturnPromise),
    ]

    /// Every connection's state and callbacks live here, off the main thread.
    private let queue = DispatchQueue(label: "oni.lan")
    /// The connections, by the id of the device at the other end.
    private var sockets: [String: NWConnection] = [:]
    private var pings: [String: DispatchSourceTimer] = [:]

    private static func webSocket() -> NWParameters {
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        ws.maximumMessageSize = 4 * 1024 * 1024
        let params = NWParameters.tcp
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        return params
    }

    /// { id, url, hello, timeout (ms) }: resolves once the other side answers the hello (its first
    /// message, "welcome"); rejects if it does not in time or closes.
    @objc func open(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let raw = call.getString("url"), let url = URL(string: raw), let hello = call.getString("hello") else {
            return call.reject("id, url and hello")
        }
        let timeout = (call.getDouble("timeout") ?? 2500) / 1000
        queue.async {
            self.drop(id)
            let conn = NWConnection(to: .url(url), using: LanPlugin.webSocket())
            self.sockets[id] = conn
            var settled = false
            let settle: (String?) -> Void = { error in
                guard !settled else { return }
                settled = true
                if let error = error {
                    self.drop(id, conn)
                    call.reject(error)
                } else {
                    call.resolve()
                }
            }
            self.queue.asyncAfter(deadline: .now() + timeout) { settle("no answer") }
            conn.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    // Said as soon as it is open, from here: nothing waits for the main thread.
                    LanPlugin.sendText(conn, hello)
                case .waiting(let error), .failed(let error):
                    // Refused or unreachable: not tried again and again in the background; broken
                    // later: gone, and the page told.
                    settle(error.localizedDescription)
                    self?.drop(id, conn)
                case .cancelled:
                    settle("closed")
                default:
                    break
                }
            }
            conn.receiveMessage { [weak self] data, context, _, error in
                guard let self = self else { return }
                if let text = LanPlugin.text(data, context), text.contains("\"welcome\"") {
                    settle(nil)
                    self.listen(id, conn)
                    self.keepAlive(id, conn)
                } else {
                    settle(error?.localizedDescription ?? (LanPlugin.closing(context) ? "closed by the other side" : "unexpected answer"))
                }
            }
            conn.start(queue: self.queue)
        }
    }

    /// { id, text }
    @objc func send(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        let text = call.getString("text") ?? ""
        queue.async {
            guard let conn = self.sockets[id] else { return call.reject("not connected") }
            LanPlugin.sendText(conn, text) { error in
                if let error = error {
                    self.drop(id, conn)
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
        queue.async {
            self.drop(id)
            call.resolve()
        }
    }

    /// The test build only: the main thread busy for { ms } (the cloud check: the link must not wait for it).
    @objc func testBusyMain(_ call: CAPPluginCall) {
        #if DEBUG
        let ms = call.getDouble("ms") ?? 0
        DispatchQueue.main.async {
            Thread.sleep(forTimeInterval: ms / 1000)
            call.resolve()
        }
        #else
        call.reject("test build only")
        #endif
    }

    private func listen(_ id: String, _ conn: NWConnection) {
        conn.receiveMessage { [weak self] data, context, _, error in
            guard let self = self else { return }
            if error != nil || LanPlugin.closing(context) { return self.drop(id, conn) }
            if let text = LanPlugin.text(data, context) { self.notifyListeners("message", data: ["id": id, "text": text]) }
            self.listen(id, conn)
        }
    }

    /// A connection gone quiet (the PC asleep, another network) is noticed within half a minute:
    /// a ping every 20 s, and no pong in 10 s closes it.
    private func keepAlive(_ id: String, _ conn: NWConnection) {
        pings[id]?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 20, repeating: 20)
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            var answered = false
            let meta = NWProtocolWebSocket.Metadata(opcode: .ping)
            meta.setPongHandler(self.queue) { error in if error == nil { answered = true } }
            let context = NWConnection.ContentContext(identifier: "ping", metadata: [meta])
            conn.send(content: Data(), contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
            self.queue.asyncAfter(deadline: .now() + 10) { if !answered { self.drop(id, conn) } }
        }
        pings[id] = timer
        timer.resume()
    }

    /// Closed (on the queue): this one, or whichever is open for `id`.
    private func drop(_ id: String, _ conn: NWConnection? = nil) {
        guard let current = sockets[id], conn == nil || current === conn else { return }
        sockets[id] = nil
        pings[id]?.cancel()
        pings[id] = nil
        // A goodbye first, so the other side knows at once (a bare close left the PC waiting).
        let meta = NWProtocolWebSocket.Metadata(opcode: .close)
        meta.closeCode = .protocolCode(.goingAway)
        let context = NWConnection.ContentContext(identifier: "close", metadata: [meta])
        current.send(content: nil, contentContext: context, isComplete: true, completion: .contentProcessed { _ in current.cancel() })
        queue.asyncAfter(deadline: .now() + 1) { current.cancel() }
        notifyListeners("closed", data: ["id": id])
    }

    /// A message's text (a text frame's), or nil.
    private static func text(_ data: Data?, _ context: NWConnection.ContentContext?) -> String? {
        guard let data = data, let meta = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata, meta.opcode == .text else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func closing(_ context: NWConnection.ContentContext?) -> Bool {
        (context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata)?.opcode == .close
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
        queue.async {
            if self.listener != nil && self.serveKey != key { self.stopServing() }
            self.serveKey = key
            self.welcome = welcome
            if let port = self.listener?.port?.rawValue {
                return call.resolve(["port": Int(port), "hosts": LanPlugin.addresses()])
            }
            guard let listener = try? NWListener(using: LanPlugin.webSocket(), on: .any) else { return call.reject("cannot listen") }
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
            listener.start(queue: self.queue)
        }
    }

    /// { to (none: all), text }
    @objc func serveSend(_ call: CAPPluginCall) {
        let to = call.getString("to")
        let text = call.getString("text") ?? ""
        queue.async {
            for (id, conn) in self.guests where to == nil || to == id { LanPlugin.sendText(conn, text) }
            call.resolve()
        }
    }

    @objc func serveStop(_ call: CAPPluginCall) {
        queue.async {
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
        conn.start(queue: queue)
        // A connection that has not said the key in 5 s is closed.
        queue.asyncAfter(deadline: .now() + 5) { if id == nil { conn.cancel() } }
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

    private static func sendText(_ conn: NWConnection, _ text: String, done: ((NWError?) -> Void)? = nil) {
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "text", metadata: [meta])
        conn.send(content: text.data(using: .utf8), contentContext: context, isComplete: true, completion: .contentProcessed { error in done?(error) })
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
