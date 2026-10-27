import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// Oni's extension: the downloads' progress in the Dynamic Island and on the lock screen (started
/// and updated by the app, DownloadsPlugin), a remote on the Home and lock screens (My Wave, play
/// and pause, next, like), and Control Center buttons, which also go on the lock screen and the
/// Action button. The buttons run Oni's actions (OniCommands.swift) in the app.
@main
struct OniActivityBundle: WidgetBundle {
    var body: some Widget {
        DownloadActivity()
        if #available(iOS 17.0, *) {
            RemoteWidget()
        }
        if #available(iOS 18.0, *) {
            WaveControl()
            ToggleControl()
            NextControl()
            LikeControl()
        }
    }
}

private enum Palette {
    static let panel = Color(red: 0x17 / 255, green: 0x15 / 255, blue: 0x14 / 255)
    static let red = Color(red: 0xD9 / 255, green: 0x27 / 255, blue: 0x2E / 255)
    static let gold = Color(red: 0xC7 / 255, green: 0x9A / 255, blue: 0x54 / 255)
    static let text = Color(red: 0xF2 / 255, green: 0xEE / 255, blue: 0xE8 / 255)
    static let muted = Color(red: 0xA7 / 255, green: 0xA3 / 255, blue: 0xA0 / 255)
    static let line = Color(red: 0x49 / 255, green: 0x40 / 255, blue: 0x3D / 255)
    static let glass = Color(red: 0x21 / 255, green: 0x18 / 255, blue: 0x16 / 255)
}

private extension DownloadAttributes.ContentState {
    var fraction: Double { total > 0 ? min(1, Double(done) / Double(total)) : 0 }
    var percent: Int { Int((fraction * 100).rounded(.down)) }
    /// "57/502", or "57+/502" when stale: at least that many, the rest came while the app slept.
    func count(stale: Bool) -> String { "\(done)\(stale ? "+" : "")/\(total)" }
    func text(stale: Bool) -> String { stale && !staleLine.isEmpty ? staleLine : line }
}

/// A ring that fills as the files come, an arrow inside (a check at the end).
private struct Ring: View {
    let state: DownloadAttributes.ContentState
    var size: CGFloat = 36
    var width: CGFloat = 3.5

    var body: some View {
        ZStack {
            Circle().stroke(Palette.line, lineWidth: width)
            Circle()
                .trim(from: 0, to: state.fraction)
                .stroke(Palette.red, style: StrokeStyle(lineWidth: width, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Image(systemName: state.finished ? "checkmark" : "arrow.down")
                .font(.system(size: size * 0.38, weight: .bold))
                .foregroundColor(Palette.gold)
        }
        .frame(width: size, height: size)
    }
}

struct DownloadActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DownloadAttributes.self) { context in
            // The lock screen (and the banner on phones without the island).
            HStack(spacing: 14) {
                Ring(state: context.state, size: 44, width: 4)
                VStack(alignment: .leading, spacing: 5) {
                    Text(context.attributes.title)
                        .font(.headline)
                        .foregroundColor(Palette.text)
                        .lineLimit(1)
                    Text(context.state.text(stale: context.isStale))
                        .font(.subheadline)
                        .foregroundColor(Palette.muted)
                        .lineLimit(1)
                    ProgressView(value: context.state.fraction)
                        .tint(Palette.red)
                }
            }
            .padding(16)
            .activityBackgroundTint(Palette.panel)
            .activitySystemActionForegroundColor(Palette.text)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Ring(state: context.state, size: 40)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(context.state.percent)%")
                        .font(.title3.monospacedDigit())
                        .foregroundColor(Palette.gold)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title)
                        .font(.headline)
                        .foregroundColor(Palette.text)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(value: context.state.fraction)
                            .tint(Palette.red)
                        Text(context.state.text(stale: context.isStale))
                            .font(.caption)
                            .foregroundColor(Palette.muted)
                    }
                }
            } compactLeading: {
                Ring(state: context.state, size: 22, width: 2.5)
            } compactTrailing: {
                // How many of how many, as the user asked: "57/502".
                Text(context.state.count(stale: context.isStale))
                    .font(.system(size: 13, weight: .semibold).monospacedDigit())
                    .foregroundColor(Palette.gold)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            } minimal: {
                // Shared with another activity (music playing): a small circle, so the count of
                // those in sits inside the ring.
                ZStack {
                    Circle().stroke(Palette.line, lineWidth: 2.5)
                    Circle()
                        .trim(from: 0, to: context.state.fraction)
                        .stroke(Palette.red, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    Text(context.state.finished ? "✓" : "\(context.state.done)")
                        .font(.system(size: 9, weight: .bold).monospacedDigit())
                        .foregroundColor(Palette.gold)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                        .padding(3)
                }
                .frame(width: 24, height: 24)
            }
            .keylineTint(Palette.red)
        }
    }
}


// MARK: - The remote (Home and lock screens)

struct RemoteEntry: TimelineEntry {
    let date: Date
    /// What plays, as the app last wrote it (NowPlayingShare.swift); nil before anything played or
    /// in a build signed without the app group.
    var track: NowPlayingShare.State? = nil
    var cover: UIImage? = nil
}

/// One entry, drawn again when the app says the track changed (WidgetCenter.reloadTimelines).
struct RemoteProvider: TimelineProvider {
    private func entry() -> RemoteEntry {
        let track = NowPlayingShare.read()
        return RemoteEntry(date: Date(), track: track, cover: track.flatMap(NowPlayingShare.cover))
    }
    func placeholder(in context: Context) -> RemoteEntry { RemoteEntry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (RemoteEntry) -> Void) { completion(entry()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<RemoteEntry>) -> Void) {
        completion(Timeline(entries: [entry()], policy: .never))
    }
}

/// The track playing: its cover and names, where the brand stood.
@available(iOS 17.0, *)
private struct Playing: View {
    @Environment(\.widgetRenderingMode) private var mode
    let track: NowPlayingShare.State
    let cover: UIImage?
    var compact = false

    var body: some View {
        HStack(spacing: 8) {
            if let cover = cover, !compact {
                Image(uiImage: cover)
                    .resizable()
                    .coverInColor()
                    .frame(width: 40, height: 40)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(track.title)
                    .font(.system(size: compact ? 13 : 14, weight: .semibold))
                    .foregroundColor(mode.inColor ? Palette.text : .primary)
                    .lineLimit(1)
                Text(track.artist)
                    .font(.system(size: compact ? 11 : 12))
                    .foregroundColor(mode.inColor ? Palette.muted : .secondary)
                    .lineLimit(1)
            }
        }
    }
}

/// On tinted and clear Home screens iOS paints a picture in one colour: the cover came out a white
/// square (the user, 24.10.2026). It keeps its own colours there.
private extension Image {
    @ViewBuilder func coverInColor() -> some View {
        if #available(iOS 18.0, *) {
            self.widgetAccentedRenderingMode(.fullColor)
        } else {
            self
        }
    }
}

/// Tinted and clear Home screens (iOS 18) paint the whole widget in one colour: a filled shape and
/// the words on it came out as one white patch (the user: "My Wave" white, no words). There the
/// buttons are outlined instead, and take the accent colour.
@available(iOS 17.0, *)
private extension WidgetRenderingMode {
    var inColor: Bool { self == .fullColor }
}

/// The buttons ask iOS to run Oni's actions (OniCommands.swift), as the Control Center's do: the
/// music is paused or moved on, Oni stays where it is. Bare `Button(intent:)` with a plain style, as
/// tried on the user's phone (trial 5); the 1.12 buttons, the same intents with
/// `.invalidatableContent()` and accent marks on the label, only opened Oni there.
@available(iOS 17.0, *)
private struct RoundButton<I: AppIntent>: View {
    @Environment(\.widgetRenderingMode) private var mode
    let intent: I
    let symbol: String
    let label: String
    var size: CGFloat = 40
    var tint: Color = Palette.text

    var body: some View {
        Button(intent: intent) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundColor(mode.inColor ? tint : .primary)
                .frame(width: size, height: size)
                .background {
                    if mode.inColor {
                        Circle().fill(Palette.line.opacity(0.55))
                    } else {
                        Circle().strokeBorder(.primary.opacity(0.6), lineWidth: 1.2)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }
}

/// My Wave: Oni opens for it (PlayWaveIntent.openAppWhenRun), the wave starts there.
@available(iOS 17.0, *)
private struct WaveButton: View {
    var compact = false

    var body: some View {
        Button(intent: PlayWaveIntent()) {
            WaveLabel(compact: compact)
        }
        .buttonStyle(.plain)
    }
}

/// "My Wave" on its red capsule (outlined on tinted Home screens).
@available(iOS 17.0, *)
private struct WaveLabel: View {
    @Environment(\.widgetRenderingMode) private var mode
    var compact = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "waveform")
                .font(.system(size: compact ? 13 : 15, weight: .bold))
            Text("Моя волна")
                .font(.system(size: compact ? 13 : 15, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .foregroundColor(mode.inColor ? Palette.text : .primary)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, minHeight: compact ? 34 : 40)
        .background {
            if mode.inColor {
                Capsule().fill(Palette.red)
            } else {
                Capsule().strokeBorder(.primary, lineWidth: 1.5)
            }
        }
    }
}

/// The medium widget with a track: laid out like the Control Center's player (the user's screenshot,
/// 27.10.2026) in Oni's colours: a big cover, the names and the like where Apple keeps AirPlay (a
/// widget may not show it), back / play / next, and the bar with the times, moved by iOS itself.
@available(iOS 17.0, *)
private struct PlayerCard: View {
    let track: NowPlayingShare.State
    let cover: UIImage?

    var body: some View {
        VStack(spacing: 8) {
            HStack(alignment: .top, spacing: 14) {
                CoverArt(cover: cover, corner: 12)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top, spacing: 8) {
                        Names(track: track, size: 15)
                        Spacer(minLength: 0)
                        LikeButton(liked: track.liked == true, size: 34)
                    }
                    Spacer(minLength: 0)
                    Controls(playing: track.playing, play: 46, skip: 40)
                }
            }
            .frame(maxHeight: .infinity)
            TimeBar(track: track)
        }
        .padding(14)
    }
}

/// The small widget with a track (the user, 27.10.2026: back and next there too, the like at the top
/// right): the cover and the like, the names, back / play / next.
@available(iOS 17.0, *)
private struct SmallCard: View {
    let track: NowPlayingShare.State
    let cover: UIImage?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 0) {
                CoverArt(cover: cover, corner: 10).frame(width: 48, height: 48)
                Spacer(minLength: 0)
                LikeButton(liked: track.liked == true, size: 30)
            }
            Spacer(minLength: 0)
            Names(track: track, size: 13)
            Controls(playing: track.playing, play: 40, skip: 34)
        }
        .padding(12)
    }
}

/// The like, filled when the track is liked; red on its plate, plain on tinted and clear screens.
@available(iOS 17.0, *)
private struct LikeButton: View {
    @Environment(\.widgetRenderingMode) private var mode
    let liked: Bool
    let size: CGFloat

    var body: some View {
        Button(intent: LikeIntent()) {
            Image(systemName: liked ? "heart.fill" : "heart")
                .font(.system(size: size * 0.5, weight: .semibold))
                .foregroundColor(mode.inColor ? Palette.red : .primary)
                .frame(width: size, height: size)
                .background(Circle().fill(mode.inColor ? Palette.line.opacity(0.45) : .clear))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Мне нравится"))
    }
}

/// The cover, square (the kanji on a plate while it has not come).
private struct CoverArt: View {
    let cover: UIImage?
    let corner: CGFloat

    var body: some View {
        Group {
            if let cover = cover {
                Image(uiImage: cover).resizable().coverInColor()
            } else {
                ZStack {
                    Palette.line.opacity(0.5)
                    Text("鬼").font(.system(size: 30, weight: .bold, design: .serif)).foregroundColor(Palette.red)
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: corner))
    }
}

@available(iOS 17.0, *)
private struct Names: View {
    @Environment(\.widgetRenderingMode) private var mode
    let track: NowPlayingShare.State
    let size: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(track.title)
                .font(.system(size: size, weight: .semibold))
                .foregroundColor(mode.inColor ? Palette.text : .primary)
                .lineLimit(1)
            Text(track.artist)
                .font(.system(size: size - 2))
                .foregroundColor(mode.inColor ? Palette.muted : .secondary)
                .lineLimit(1)
        }
    }
}

/// Back / play / next. On tinted and clear Home screens iOS paints all in one colour: a filled circle
/// came out a white disc with no sign on it (the user's video, 27.10.2026), so there it is outlined.
@available(iOS 17.0, *)
private struct Controls: View {
    @Environment(\.widgetRenderingMode) private var mode
    let playing: Bool
    let play: CGFloat
    let skip: CGFloat

    var body: some View {
        HStack(spacing: 0) {
            button(PreviousTrackIntent(), "backward.fill", "Предыдущий трек")
            Button(intent: TogglePlaybackIntent()) {
                Image(systemName: playing ? "pause.fill" : "play.fill")
                    .font(.system(size: play * 0.43, weight: .bold))
                    .foregroundColor(mode.inColor ? Palette.text : .primary)
                    .frame(width: play, height: play)
                    .background {
                        if mode.inColor {
                            Circle().fill(Palette.red)
                        } else {
                            Circle().strokeBorder(.primary.opacity(0.6), lineWidth: 1.2)
                        }
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Пауза / продолжить"))
            .frame(maxWidth: .infinity)
            button(NextTrackIntent(), "forward.fill", "Следующий трек")
        }
    }

    private func button<I: AppIntent>(_ intent: I, _ symbol: String, _ label: String) -> some View {
        Button(intent: intent) {
            Image(systemName: symbol)
                .font(.system(size: skip * 0.5, weight: .semibold))
                .foregroundColor(mode.inColor ? Palette.text : .primary)
                .frame(width: skip, height: skip)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .frame(maxWidth: .infinity)
    }
}

/// The bar and the times. Playing, iOS moves them from the start to the end; paused, they stand.
/// Each part has a set height: the moving ones came out a little taller, and pressing play shrank
/// the cover and moved the whole widget (the user's video, 27.10.2026).
@available(iOS 17.0, *)
private struct TimeBar: View {
    @Environment(\.widgetRenderingMode) private var mode
    let track: NowPlayingShare.State

    var body: some View {
        let duration = track.duration ?? 0
        let tint = mode.inColor ? Palette.red : Color.primary
        VStack(spacing: 3) {
            Group {
                if let start = track.started, duration > 0 {
                    ProgressView(timerInterval: start...start.addingTimeInterval(duration), countsDown: false) {
                        EmptyView()
                    } currentValueLabel: {
                        EmptyView()
                    }
                    .labelsHidden()
                } else {
                    ProgressView(value: duration > 0 ? min(track.elapsed ?? 0, duration) / duration : 0)
                        .labelsHidden()
                }
            }
            .progressViewStyle(.linear)
            .tint(tint)
            .frame(height: 4)
            HStack(spacing: 0) {
                if let start = track.started, duration > 0 {
                    let span = start...start.addingTimeInterval(duration)
                    Text(timerInterval: span, countsDown: false)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    (Text("-") + Text(timerInterval: span, countsDown: true))
                        .multilineTextAlignment(.trailing)
                } else {
                    let at = min(track.elapsed ?? 0, duration)
                    Text(duration > 0 ? clock(at) : "--:--")
                    Spacer(minLength: 0)
                    Text(duration > 0 ? "-" + clock(duration - at) : "--:--")
                }
            }
            .font(.system(size: 11, weight: .medium).monospacedDigit())
            .foregroundColor(mode.inColor ? Palette.muted : .secondary)
            .lineLimit(1)
            .frame(height: 13)
        }
        .frame(height: 20)
    }

    private func clock(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.rounded()))
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}

/// The mask's kanji and the name, as in the app's sidebar.
private struct Brand: View {
    var body: some View {
        HStack(spacing: 6) {
            Text("鬼")
                .font(.system(size: 20, weight: .bold, design: .serif))
                .foregroundColor(Palette.red)
            Text("ONI")
                .font(.system(size: 13, weight: .heavy))
                .tracking(3)
                .foregroundColor(Palette.text)
        }
    }
}

@available(iOS 17.0, *)
struct RemoteView: View {
    @Environment(\.widgetFamily) private var family
    var entry = RemoteEntry(date: Date())

    private var playing: Bool { entry.track?.playing ?? false }
    private var hasTrack: Bool { !(entry.track?.title ?? "").isEmpty }
    private var toggleSymbol: String { playing ? "pause.fill" : "play.fill" }

    /// The track playing, or the brand before anything played.
    @ViewBuilder private func top(compact: Bool) -> some View {
        if let track = entry.track, hasTrack {
            Playing(track: track, cover: entry.cover, compact: compact)
        } else {
            Brand()
        }
    }

    /// A small widget and the lock screen's have one place to touch: play or pause what plays, or
    /// My Wave before anything played.
    @ViewBuilder private func oneTouch<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        if hasTrack {
            Button(intent: TogglePlaybackIntent(), label: content).buttonStyle(.plain)
        } else {
            Button(intent: PlayWaveIntent(), label: content).buttonStyle(.plain)
        }
    }

    /// The medium widget before anything played: the brand, My Wave and the round buttons.
    private var medium: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 10) {
                top(compact: false)
                Spacer(minLength: 0)
                WaveButton()
            }
            HStack(spacing: 10) {
                RoundButton(intent: TogglePlaybackIntent(), symbol: toggleSymbol, label: "Пауза / продолжить", size: 46)
                RoundButton(intent: NextTrackIntent(), symbol: "forward.fill", label: "Следующий трек", size: 46)
                RoundButton(intent: LikeIntent(), symbol: "heart.fill", label: "Мне нравится", size: 46, tint: Palette.red)
            }
        }
        .padding(16)
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            oneTouch {
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: hasTrack ? toggleSymbol : "waveform").font(.system(size: 20, weight: .bold))
                }
            }
        case .accessoryRectangular:
            oneTouch {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(hasTrack ? entry.track!.title : "Моя волна").font(.system(size: 14, weight: .semibold)).lineLimit(1)
                        Text(hasTrack ? entry.track!.artist : "Oni").font(.system(size: 12)).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: hasTrack ? toggleSymbol : "waveform").font(.system(size: 18, weight: .bold))
                }
            }
        case .systemMedium:
            if let track = entry.track, hasTrack {
                PlayerCard(track: track, cover: entry.cover)
            } else {
                medium
            }
        default:
            // What plays with back / play / next, or My Wave.
            if let track = entry.track, hasTrack {
                SmallCard(track: track, cover: entry.cover)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Brand()
                    Spacer(minLength: 0)
                    WaveButton(compact: true)
                }
                .padding(14)
            }
        }
    }
}

@available(iOS 17.0, *)
struct RemoteWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OniRemote", provider: RemoteProvider()) { entry in
            RemoteView(entry: entry)
                .containerBackground(for: .widget) {
                    LinearGradient(colors: [Palette.panel, Palette.glass], startPoint: .topLeading, endPoint: .bottomTrailing)
                }
        }
        .configurationDisplayName("Oni")
        .description("Что играет, с полоской времени; назад, пауза, вперёд и «Мне нравится» одним нажатием, «Моя волна» — пока ничего не играло.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
        .contentMarginsDisabled()
    }
}

// MARK: - Control Center (and the lock screen, the Action button)

@available(iOS 18.0, *)
struct WaveControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "local.wave.player.control.wave") {
            ControlWidgetButton(action: PlayWaveIntent()) {
                Label("Моя волна", systemImage: "waveform")
            }
        }
        .displayName("Моя волна")
        .description("Включает «Мою волну» в Oni.")
    }
}

@available(iOS 18.0, *)
struct ToggleControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "local.wave.player.control.toggle") {
            ControlWidgetButton(action: TogglePlaybackIntent()) {
                Label("Пауза / продолжить", systemImage: "playpause.fill")
            }
        }
        .displayName("Oni: пауза / продолжить")
        .description("Ставит Oni на паузу или продолжает.")
    }
}

@available(iOS 18.0, *)
struct NextControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "local.wave.player.control.next") {
            ControlWidgetButton(action: NextTrackIntent()) {
                Label("Следующий трек", systemImage: "forward.fill")
            }
        }
        .displayName("Oni: следующий трек")
        .description("Переключает Oni на следующий трек.")
    }
}

@available(iOS 18.0, *)
struct LikeControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "local.wave.player.control.like") {
            ControlWidgetButton(action: LikeIntent()) {
                Label("Мне нравится", systemImage: "heart.fill")
            }
        }
        .displayName("Oni: мне нравится")
        .description("Отмечает играющий трек «Мне нравится».")
    }
}
