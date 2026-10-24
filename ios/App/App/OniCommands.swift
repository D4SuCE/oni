import AppIntents

/// Oni's actions (stage 7–8): My Wave, play and pause, next and previous, like. Built into the app
/// and into the OniActivity extension: the Home Screen widget and the Control Center buttons
/// (OniActivity.swift) need them there, while iOS runs them in the app (they are audio playback
/// intents), which goes the lock screen's way (RemotePlugin.press: play and pause by the player
/// itself, the rest by the page). Siri's phrases are the app's own (OniIntents.swift).
enum OniCommands {
    /// Set by the app at launch (AppDelegate); never in the extension, where the actions are only shown.
    @MainActor static var send: ((String) -> Void)?
}

@available(iOS 17.0, *)
struct PlayWaveIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Моя волна"
    static var description = IntentDescription("Включает «Мою волну» в Oni.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        OniCommands.send?("wave")
        NowPlayingShare.mark(OniCommands.send == nil ? "press wave (в виджете, без Oni)" : "press wave (в Oni)")
        return .result()
    }
}

@available(iOS 17.0, *)
struct PauseIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Пауза"
    static var description = IntentDescription("Ставит музыку в Oni на паузу.")

    @MainActor
    func perform() async throws -> some IntentResult {
        OniCommands.send?("pause")
        NowPlayingShare.mark(OniCommands.send == nil ? "press pause (в виджете, без Oni)" : "press pause (в Oni)")
        return .result()
    }
}

@available(iOS 17.0, *)
struct ResumeIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Продолжить"
    static var description = IntentDescription("Продолжает музыку в Oni с того же места.")

    @MainActor
    func perform() async throws -> some IntentResult {
        OniCommands.send?("play")
        NowPlayingShare.mark(OniCommands.send == nil ? "press play (в виджете, без Oni)" : "press play (в Oni)")
        return .result()
    }
}

@available(iOS 17.0, *)
struct TogglePlaybackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Пауза / продолжить"
    static var description = IntentDescription("Ставит Oni на паузу или продолжает.")

    @MainActor
    func perform() async throws -> some IntentResult {
        OniCommands.send?("toggle")
        NowPlayingShare.mark(OniCommands.send == nil ? "press toggle (в виджете, без Oni)" : "press toggle (в Oni)")
        return .result()
    }
}

@available(iOS 17.0, *)
struct NextTrackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Следующий трек"
    static var description = IntentDescription("Переключает Oni на следующий трек.")

    @MainActor
    func perform() async throws -> some IntentResult {
        OniCommands.send?("next")
        NowPlayingShare.mark(OniCommands.send == nil ? "press next (в виджете, без Oni)" : "press next (в Oni)")
        return .result()
    }
}

@available(iOS 17.0, *)
struct PreviousTrackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Предыдущий трек"
    static var description = IntentDescription("Возвращает Oni к предыдущему треку.")

    @MainActor
    func perform() async throws -> some IntentResult {
        OniCommands.send?("prev")
        NowPlayingShare.mark(OniCommands.send == nil ? "press prev (в виджете, без Oni)" : "press prev (в Oni)")
        return .result()
    }
}

@available(iOS 17.0, *)
struct LikeIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Мне нравится"
    static var description = IntentDescription("Отмечает играющий в Oni трек «Мне нравится» (повторно — снимает отметку).")

    @MainActor
    func perform() async throws -> some IntentResult {
        OniCommands.send?("like")
        NowPlayingShare.mark(OniCommands.send == nil ? "press like (в виджете, без Oni)" : "press like (в Oni)")
        return .result()
    }
}
