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
        return .result()
    }
}
