import ActivityKit

/// What the downloads' Live Activity shows (the Dynamic Island and the lock screen): built into the
/// app, which starts and updates it (DownloadsPlugin in OniBridge.swift), and into the OniActivity
/// extension, which draws it.
@available(iOS 16.1, *)
struct DownloadAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var done: Int
        var total: Int
        /// "Скачано 57 из 502", in the app's language.
        var line: String
        var finished: Bool
    }

    /// The list's name, or "Скачивание" for several.
    var title: String
}
