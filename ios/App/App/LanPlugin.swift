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
}
