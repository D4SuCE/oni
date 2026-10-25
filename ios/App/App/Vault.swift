import UIKit
import Capacitor
import Security
import WebKit
import MediaPlayer
import AVFoundation
import AudioToolbox
import UserNotifications
import CryptoKit
import ActivityKit
import WidgetKit
import Network
import Accelerate

/// The downloads' key (src/player/offline.ts): AES-256-GCM, and a file is the 12-byte nonce, the
/// ciphertext and the 16-byte tag (CryptoKit's "combined", the page's Web Crypto layout too). The
/// page hands it over; it is kept in the Keychain for launches in the background, when no page runs.
/// Sealing and opening here keeps the audio off the bridge: as base64 text through the page it
/// froze the iPhone's interface on every downloaded track.
enum Vault {
    static let keychainKey = "offline-key"
    private static var cached: SymmetricKey?
    private static let lock = NSLock()

    static func set(base64: String) {
        guard let data = Data(base64Encoded: base64), data.count == 32 else { return }
        lock.lock()
        cached = SymmetricKey(data: data)
        lock.unlock()
        if KeychainPlugin.read(key: keychainKey) != base64 { _ = KeychainPlugin.store(key: keychainKey, value: base64) }
    }

    static var key: SymmetricKey? {
        lock.lock()
        defer { lock.unlock() }
        if cached == nil, let b64 = KeychainPlugin.read(key: keychainKey), let data = Data(base64Encoded: b64), data.count == 32 {
            cached = SymmetricKey(data: data)
        }
        return cached
    }

    static func seal(_ data: Data, with key: SymmetricKey) throws -> Data {
        guard let combined = try AES.GCM.seal(data, using: key).combined else { throw CryptoKitError.incorrectParameterSize }
        return combined
    }

    static func open(_ data: Data, with key: SymmetricKey) throws -> Data {
        return try AES.GCM.open(try AES.GCM.SealedBox(combined: data), using: key)
    }
}
