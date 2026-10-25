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

    /// The plugin, for Siri and Shortcuts (OniIntents.swift); what they asked before it loaded.
    private static weak var shared: RemotePlugin?
    private static var pending: [String] = []

    override public func load() {
        RemotePlugin.shared = self
        DispatchQueue.main.async {
            self.setUpCommands()
            let waiting = RemotePlugin.pending
            RemotePlugin.pending = []
            waiting.forEach { self.handle($0) }
        }
    }

    /// A command from Siri or Shortcuts, as if its lock-screen button was pressed (main thread):
    /// play, pause, toggle, next, prev, like, and wave (My Wave, the page starts it).
    static func press(_ name: String) {
        if let plugin = shared { plugin.handle(name) } else { pending.append(name) }
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
            // The Home screen widget shows what plays (NowPlayingShare.swift).
            let shared = NowPlayingShare.State(title: title, artist: artist, playing: playing, cover: artworkURL, coverSaved: NowPlayingShare.read()?.coverSaved)
            if NowPlayingShare.write(shared) { WidgetCenter.shared.reloadTimelines(ofKind: "OniRemote") }
            call.resolve()
        }
    }

    private func loadArtwork(_ address: String?) {
        artworkURL = address
        artwork = nil
        guard let address = address, let url = URL(string: address) else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data = data, let image = UIImage(data: data) else { return }
            if NowPlayingShare.saveCover(image, for: address) { WidgetCenter.shared.reloadTimelines(ofKind: "OniRemote") }
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
        // Kept awake after a pause, iOS shows "pause" on the lock screen still: pressed, it plays.
        case "pause": done = player?.isAwake == true ? player?.resume() ?? false : player?.pauseNow() ?? false
        case "toggle": done = (player?.isPlaying ?? false) ? player?.pauseNow() ?? false : player?.resume() ?? false
        default: done = false
        }
        // Kept until the page listens: a command that opened the app comes before the page is up.
        guard done, let player = player else { return notifyListeners("command", data: ["name": name], retainUntilConsumed: true) }
        // The lock screen shows it at once, the page asleep or not.
        showOnLockScreen(playing: player.isPlaying, at: player.currentTime)
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

/// Playing or paused, and where, on the lock screen and in the widget, by the player itself (main
/// thread): the page may be frozen by iOS with the phone locked, and a pause iOS made (a call,
/// headphones out, another app's sound) left "pause" on the lock screen with nothing playing (a user's
/// screenshots, 25.10.2026).
func showOnLockScreen(playing: Bool, at time: Double) {
    var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = time
    info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
    if var shared = NowPlayingShare.read(), shared.playing != playing {
        shared.playing = playing
        if NowPlayingShare.write(shared) { WidgetCenter.shared.reloadTimelines(ofKind: "OniRemote") }
    }
}
