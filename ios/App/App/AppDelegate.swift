import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Music: keeps playing in the background, on the lock screen and with the silent switch on.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        // Oni's actions (Siri, Shortcuts, the widget, Control Center) go the lock screen's way.
        OniCommands.send = { RemotePlugin.press($0) }
        // The widget's buttons while Oni is awake (NowPlayingShare.sendCommand).
        CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), nil, { _, _, _, _, _ in
            DispatchQueue.main.async {
                NowPlayingShare.mark("звонок в Oni")
                if let name = NowPlayingShare.takeCommand() {
                    NowPlayingShare.mark("Oni выполняет \(name)")
                    OniCommands.send?(name)
                }
            }
        }, NowPlayingShare.ring as CFString, nil, .deliverImmediately)
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    /// Background downloads (DownloadsPlugin in OniBridge.swift) finished while the app was away:
    /// iOS wakes it to deliver them and waits for this to be called back.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        DownloadsPlugin.backgroundCompletion = completionHandler
        // The session and the queue kept on disk: what finishes starts the next ones, page or not.
        DownloadsPlugin.shared.restore()
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
