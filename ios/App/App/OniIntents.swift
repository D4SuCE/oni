import AppIntents

/// Siri and Shortcuts (stage 7, accepted by the user): My Wave, pause and play, next and previous,
/// like. They go the way the lock screen's buttons go (RemotePlugin.press): pause and play are
/// the player's own, so they work with the app in the background, its page asleep; the rest is the
/// page's (the queue and the wave live there), which gets them even when it only starts now
/// (Capacitor keeps the event until the page listens). My Wave opens the app. Siri has no Russian:
/// it hears the English phrases; in Shortcuts the actions have Russian names and work in any
/// automation.
@available(iOS 16.0, *)
struct PlayWaveIntent: AppIntent {
    static var title: LocalizedStringResource = "Моя волна"
    static var description = IntentDescription("Включает «Мою волну» в Oni.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        RemotePlugin.press("wave")
        return .result()
    }
}

@available(iOS 16.0, *)
struct PauseIntent: AppIntent {
    static var title: LocalizedStringResource = "Пауза"
    static var description = IntentDescription("Ставит музыку в Oni на паузу.")

    @MainActor
    func perform() async throws -> some IntentResult {
        RemotePlugin.press("pause")
        return .result()
    }
}

@available(iOS 16.0, *)
struct ResumeIntent: AppIntent {
    static var title: LocalizedStringResource = "Продолжить"
    static var description = IntentDescription("Продолжает музыку в Oni с того же места.")

    @MainActor
    func perform() async throws -> some IntentResult {
        RemotePlugin.press("play")
        return .result()
    }
}

@available(iOS 16.0, *)
struct NextTrackIntent: AppIntent {
    static var title: LocalizedStringResource = "Следующий трек"
    static var description = IntentDescription("Переключает Oni на следующий трек.")

    @MainActor
    func perform() async throws -> some IntentResult {
        RemotePlugin.press("next")
        return .result()
    }
}

@available(iOS 16.0, *)
struct PreviousTrackIntent: AppIntent {
    static var title: LocalizedStringResource = "Предыдущий трек"
    static var description = IntentDescription("Возвращает Oni к предыдущему треку.")

    @MainActor
    func perform() async throws -> some IntentResult {
        RemotePlugin.press("prev")
        return .result()
    }
}

@available(iOS 16.0, *)
struct LikeIntent: AppIntent {
    static var title: LocalizedStringResource = "Мне нравится"
    static var description = IntentDescription("Отмечает играющий в Oni трек «Мне нравится» (повторно — снимает отметку).")

    @MainActor
    func perform() async throws -> some IntentResult {
        RemotePlugin.press("like")
        return .result()
    }
}

/// The phrases Siri knows without any setup (each must name the app).
@available(iOS 16.0, *)
struct OniShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: PlayWaveIntent(), phrases: ["Play My Wave in \(.applicationName)", "Start \(.applicationName)"], shortTitle: "Моя волна", systemImageName: "waveform")
        AppShortcut(intent: PauseIntent(), phrases: ["Pause \(.applicationName)"], shortTitle: "Пауза", systemImageName: "pause.fill")
        AppShortcut(intent: ResumeIntent(), phrases: ["Resume \(.applicationName)"], shortTitle: "Продолжить", systemImageName: "play.fill")
        AppShortcut(intent: NextTrackIntent(), phrases: ["Next track in \(.applicationName)", "Skip in \(.applicationName)"], shortTitle: "Следующий трек", systemImageName: "forward.fill")
        AppShortcut(intent: PreviousTrackIntent(), phrases: ["Previous track in \(.applicationName)"], shortTitle: "Предыдущий трек", systemImageName: "backward.fill")
        AppShortcut(intent: LikeIntent(), phrases: ["Like this in \(.applicationName)"], shortTitle: "Мне нравится", systemImageName: "heart.fill")
    }
}
