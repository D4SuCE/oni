import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = OniViewController()
        window?.makeKeyAndVisible()

        // Opened by a widget's button (oni://command?do=…): do it (the page ignores such a link).
        connectionOptions.urlContexts.forEach { _ = Self.runCommand($0.url) }
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        let links = URLContexts.filter { !Self.runCommand($0.url) }
        if !links.isEmpty { SceneDelegateProxy.shared.scene(scene, openURLContexts: links) }
    }

    /// A widget's button (OniActivity.swift): what it says, as the lock screen's buttons do it
    /// (RemotePlugin.press: play and pause by the player, the rest by the page once it listens).
    static func runCommand(_ url: URL) -> Bool {
        guard url.scheme == "oni", url.host == "command",
              let name = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "do" })?.value,
              ["toggle", "play", "pause", "next", "prev", "like", "wave"].contains(name) else { return false }
        DispatchQueue.main.async { OniCommands.send?(name) }
        return true
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
