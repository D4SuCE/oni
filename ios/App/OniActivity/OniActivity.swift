import ActivityKit
import SwiftUI
import WidgetKit

/// The downloads' progress in the Dynamic Island and on the lock screen, in Oni's colors: started
/// and updated by the app (DownloadsPlugin), drawn here. Nothing else lives in this extension.
@main
struct OniActivityBundle: WidgetBundle {
    var body: some Widget {
        DownloadActivity()
    }
}

private enum Palette {
    static let panel = Color(red: 0x17 / 255, green: 0x15 / 255, blue: 0x14 / 255)
    static let red = Color(red: 0xD9 / 255, green: 0x27 / 255, blue: 0x2E / 255)
    static let gold = Color(red: 0xC7 / 255, green: 0x9A / 255, blue: 0x54 / 255)
    static let text = Color(red: 0xF2 / 255, green: 0xEE / 255, blue: 0xE8 / 255)
    static let muted = Color(red: 0xA7 / 255, green: 0xA3 / 255, blue: 0xA0 / 255)
    static let line = Color(red: 0x49 / 255, green: 0x40 / 255, blue: 0x3D / 255)
}

private extension DownloadAttributes.ContentState {
    var fraction: Double { total > 0 ? min(1, Double(done) / Double(total)) : 0 }
    var percent: Int { Int((fraction * 100).rounded(.down)) }
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
                    Text(context.state.line)
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
                        Text(context.state.line)
                            .font(.caption)
                            .foregroundColor(Palette.muted)
                    }
                }
            } compactLeading: {
                Image(systemName: context.state.finished ? "checkmark.circle.fill" : "arrow.down.circle.fill")
                    .foregroundColor(Palette.red)
            } compactTrailing: {
                Text("\(context.state.done)/\(context.state.total)")
                    .font(.caption2.monospacedDigit())
                    .foregroundColor(Palette.gold)
            } minimal: {
                Ring(state: context.state, size: 22, width: 2.5)
            }
            .keylineTint(Palette.red)
        }
    }
}
