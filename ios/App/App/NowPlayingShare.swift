import Foundation
import UIKit
import WidgetKit

/// What plays, for the Home screen widget (OniActivity.swift): the app writes the track and its
/// cover into the app group it shares with the extension, then asks the widget to draw again.
/// Built into the app and into the OniActivity extension. Without the group (a build signed without
/// it) nothing is written or read, and the widget stays the plain remote it was.
enum NowPlayingShare {
    static let group = "group.local.wave.player"

    /// The group's name as signed: SideStore, like AltStore, signs Oni under the user's own team and
    /// renames the group, listing the names it gave in ALTAppGroups in the app's Info.plist (an
    /// extension reads its app's, two folders up).
    static var groupID: String {
        let app = Bundle(url: Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent())
        for bundle in [Bundle.main, app].compactMap({ $0 }) {
            if let groups = bundle.object(forInfoDictionaryKey: "ALTAppGroups") as? [String], !groups.isEmpty {
                return groups.first(where: { $0.hasPrefix(group) }) ?? groups[0]
            }
        }
        return group
    }

    private static var folder: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID) }
    private static var defaults: UserDefaults? { folder == nil ? nil : UserDefaults(suiteName: groupID) }
    static var coverFile: URL? { folder?.appendingPathComponent("cover.jpg") }

    struct State: Codable, Equatable {
        var title: String
        var artist: String
        /// Playing: the app is awake (iOS keeps a playing app running), so the widget's buttons
        /// reach it directly (sendCommand) and show pause; paused, they show play.
        var playing: Bool = false
        /// The cover's address, so a cover saved for an earlier track is not shown with this one.
        var cover: String?
        var coverSaved: String?
    }

    static func read() -> State? {
        guard let data = defaults?.data(forKey: "nowPlaying") else { return nil }
        return try? JSONDecoder().decode(State.self, from: data)
    }

    /// True when it changed (the widget is then drawn again).
    @discardableResult
    static func write(_ state: State) -> Bool {
        guard let defaults = defaults, read() != state, let data = try? JSONEncoder().encode(state) else { return false }
        defaults.set(data, forKey: "nowPlaying")
        return true
    }

    /// The cover, small, for the widget (it has little memory); marks it as the one for `address`.
    @discardableResult
    static func saveCover(_ image: UIImage, for address: String) -> Bool {
        guard var state = read(), state.cover == address, let file = coverFile else { return false }
        let side: CGFloat = 240
        let small = UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { _ in
            image.draw(in: CGRect(x: 0, y: 0, width: side, height: side))
        }
        guard let jpeg = small.jpegData(compressionQuality: 0.8), (try? jpeg.write(to: file, options: .atomic)) != nil else { return false }
        state.coverSaved = address
        return write(state)
    }

    // MARK: - The widget's buttons, straight to the app

    /// iOS opened Oni for every button of the widget, whatever the intent (the user, on a phone
    /// signed by SideStore with a free Apple ID): while Oni is awake the buttons do not go through
    /// iOS at all. The extension writes the command into the group and rings the app (a Darwin
    /// notification); the app, playing and so running, takes it and does it.
    static let ring = "local.wave.player.widget-command"

    static func sendCommand(_ name: String) {
        mark("press \(name) (виджет)")
        guard let defaults = defaults else { return }
        defaults.set(["name": name, "at": Date().timeIntervalSince1970], forKey: "command")
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(ring as CFString), nil, nil, true)
    }

    /// The command waiting, once: a fresh one only (one left from before the app slept is not done
    /// later out of the blue).
    static func takeCommand() -> String? {
        guard let defaults = defaults, let command = defaults.dictionary(forKey: "command") else { return nil }
        defaults.removeObject(forKey: "command")
        guard let name = command["name"] as? String, let at = command["at"] as? Double, Date().timeIntervalSince1970 - at < 5 else { return nil }
        return name
    }

    // MARK: - Trial: where a widget press gets to (shown on the widget itself)

    /// "toggle: widget 21:58:03 · app 21:58:03": the extension ran the button's action, the app got it.
    static func mark(_ step: String) {
        guard let defaults = defaults else { return }
        let time = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        var line = defaults.string(forKey: "trace") ?? ""
        if step.hasPrefix("press ") { line = "" }
        line += (line.isEmpty ? "" : " · ") + "\(step) \(time)"
        defaults.set(String(line.suffix(90)), forKey: "trace")
        WidgetCenter.shared.reloadTimelines(ofKind: "OniRemote")
    }

    static var trace: String { defaults?.string(forKey: "trace") ?? "" }

    /// The cover of the track in `state`, when it is saved.
    static func cover(_ state: State) -> UIImage? {
        guard state.coverSaved != nil, state.coverSaved == state.cover, let file = coverFile else { return nil }
        return UIImage(contentsOfFile: file.path)
    }
}
