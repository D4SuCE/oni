import AppIntents

/// Siri's phrases for Oni's actions (the actions themselves: OniCommands.swift, shared with the
/// widget extension; this provider is the app's alone). Russian (the user's wish): the app's
/// development language is Russian, so Siri set to Russian knows them, and "Они" is the app's
/// spoken name (INAlternativeAppNames in Info.plist). Siri's own media commands ("Следующий трек",
/// "Пауза") reach Oni without its name anyway, as the now-playing app.
/// The phrases Siri knows without any setup (each must name the app).
@available(iOS 17.0, *)
struct OniShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: PlayWaveIntent(),
            phrases: ["Включи Мою волну в \(.applicationName)", "Моя волна в \(.applicationName)", "Включи \(.applicationName)", "Включи музыку в \(.applicationName)"],
            shortTitle: "Моя волна",
            systemImageName: "waveform"
        )
        AppShortcut(
            intent: PauseIntent(),
            phrases: ["Пауза в \(.applicationName)", "Поставь \(.applicationName) на паузу", "Останови \(.applicationName)"],
            shortTitle: "Пауза",
            systemImageName: "pause.fill"
        )
        AppShortcut(
            intent: ResumeIntent(),
            phrases: ["Продолжи \(.applicationName)", "Продолжить в \(.applicationName)", "Играй дальше в \(.applicationName)"],
            shortTitle: "Продолжить",
            systemImageName: "play.fill"
        )
        AppShortcut(
            intent: NextTrackIntent(),
            phrases: ["Следующий трек в \(.applicationName)", "Дальше в \(.applicationName)", "Переключи трек в \(.applicationName)"],
            shortTitle: "Следующий трек",
            systemImageName: "forward.fill"
        )
        AppShortcut(
            intent: PreviousTrackIntent(),
            phrases: ["Предыдущий трек в \(.applicationName)", "Назад в \(.applicationName)"],
            shortTitle: "Предыдущий трек",
            systemImageName: "backward.fill"
        )
        AppShortcut(
            intent: LikeIntent(),
            // Not "Мне нравится в …": Siri takes it for its own like (Apple Music's, SiriKit), which
            // a free signing cannot have, and answers it cannot (the user on 1.8.0). A plain "like
            // the track" without the app's name: a personal shortcut of that name (see ROADMAP).
            phrases: ["Лайкни трек в \(.applicationName)", "Поставь лайк в \(.applicationName)", "Лайк в \(.applicationName)", "Добавь трек в любимое в \(.applicationName)"],
            shortTitle: "Мне нравится",
            systemImageName: "heart.fill"
        )
    }
}
