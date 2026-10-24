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

/// The widget's own buttons while Oni plays: done in the extension, which only rings the app
/// (NowPlayingShare.sendCommand) — iOS is not asked to run anything in Oni, so it opens nothing.
@available(iOS 17.0, *)
struct WidgetCommandIntent: AppIntent {
    static var title: LocalizedStringResource = "Oni"
    static var isDiscoverable = false

    @Parameter(title: "Команда") var name: String

    init() {}
    init(_ name: String) { self.name = name }

    func perform() async throws -> some IntentResult {
        NowPlayingShare.sendCommand(name)
        return .result()
    }
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

/// Tinted and clear Home screens (iOS 18) paint the whole widget in one colour: a filled shape and
/// the words on it came out as one white patch (the user: "My Wave" white, no words). There the
/// buttons are outlined instead, and take the accent colour.
@available(iOS 17.0, *)
private extension WidgetRenderingMode {
    var inColor: Bool { self == .fullColor }
}

/// A pressed button dims until the widget is drawn again (iOS reloads it after the action ran):
/// the press is seen, the widget is not a picture.
@available(iOS 17.0, *)
private struct RoundButton<I: AppIntent>: View {
    @Environment(\.widgetRenderingMode) private var mode
    let intent: I
    let symbol: String
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
                .widgetAccentable()
                .invalidatableContent()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }

    private var label: String {
        switch symbol {
        case "playpause.fill", "pause.fill", "play.fill": return "Пауза / продолжить"
        case "forward.fill": return "Следующий трек"
        case "heart.fill": return "Мне нравится"
        default: return symbol
        }
    }
}

@available(iOS 17.0, *)
private struct WaveButton: View {
    @Environment(\.widgetRenderingMode) private var mode
    var compact = false

    var body: some View {
        Button(intent: PlayWaveIntent()) {
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
            .widgetAccentable()
            .invalidatableContent()
        }
        .buttonStyle(.plain)
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

    /// Play/pause, next and like: straight to Oni while it plays; paused (Oni may be asleep) through
    /// iOS, which wakes it (and on SideStore opens it).
    @ViewBuilder private func button(_ name: String, size: CGFloat, tint: Color = Palette.text) -> some View {
        let symbol = name == "toggle" ? (playing ? "pause.fill" : "play.fill") : name == "next" ? "forward.fill" : "heart.fill"
        if playing {
            RoundButton(intent: WidgetCommandIntent(name), symbol: symbol, size: size, tint: tint)
        } else if name == "toggle" {
            RoundButton(intent: TogglePlaybackIntent(), symbol: symbol, size: size, tint: tint)
        } else if name == "next" {
            RoundButton(intent: NextTrackIntent(), symbol: symbol, size: size, tint: tint)
        } else {
            RoundButton(intent: LikeIntent(), symbol: symbol, size: size, tint: tint)
        }
    }

    /// The track playing, or the brand before anything played.
    @ViewBuilder private func top(compact: Bool) -> some View {
        if let track = entry.track, !track.title.isEmpty {
            Playing(track: track, cover: entry.cover, compact: compact)
        } else {
            Brand()
        }
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            Button(intent: PlayWaveIntent()) {
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: "waveform").font(.system(size: 20, weight: .bold))
                }
            }
            .buttonStyle(.plain)
        case .accessoryRectangular:
            HStack(spacing: 8) {
                Button(intent: PlayWaveIntent()) {
                    Label("Волна", systemImage: "waveform").font(.system(size: 13, weight: .semibold))
                }
                .buttonStyle(.plain)
                Spacer(minLength: 0)
                Button(intent: TogglePlaybackIntent()) { Image(systemName: "playpause.fill") }.buttonStyle(.plain)
                Button(intent: NextTrackIntent()) { Image(systemName: "forward.fill") }.buttonStyle(.plain)
            }
        case .systemMedium:
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    top(compact: false)
                    Spacer(minLength: 0)
                    WaveButton()
                }
                HStack(spacing: 10) {
                    button("toggle", size: 46)
                    button("next", size: 46)
                    button("like", size: 46, tint: Palette.red)
                }
            }
            .padding(16)
        default:
            VStack(alignment: .leading, spacing: 10) {
                top(compact: true)
                Spacer(minLength: 0)
                WaveButton(compact: true)
                HStack(spacing: 0) {
                    button("toggle", size: 36)
                    Spacer(minLength: 0)
                    button("next", size: 36)
                    Spacer(minLength: 0)
                    button("like", size: 36, tint: Palette.red)
                }
            }
            .padding(14)
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
        .description("«Моя волна», пауза, следующий трек и «Мне нравится» одним нажатием.")
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
