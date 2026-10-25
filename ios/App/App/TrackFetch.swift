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

/// A track on its way from the network into the player's cache, written as it arrives
/// (`<id>.<ext>.part`, renamed to `<id>.<ext>` once whole) with its MP3 frames counted as they
/// come (AudioFileStream), so the player can start it after a few seconds of audio instead of the
/// whole file (the user's wish after 1.7.0) and give it more as more arrives.
final class TrackFetch {
    let id: String
    let target: URL
    let url: URL
    /// Times the connection broke and the download went on from where it stopped (a server drops a
    /// slow reader; a weak network drops anyone): bytes already there are not asked for again.
    var retries = 0
    /// Bytes to drop from a response that ignored the range asked for (it starts from the top).
    var skip: Int64 = 0
    var began: Bool { handle != nil }
    /// For the simulator run's slow network (on the fetch queue only): bytes that came, let
    /// through at the throttle's pace, and how the download ended if it ended meanwhile.
    var held = Data()
    var heldEnd: Error?? = nil
    var part: URL { target.appendingPathExtension("part") }
    var task: URLSessionDataTask?
    /// Called once it is whole (or failed): the prefetch and those who wait for the whole file.
    var waiters: [(Result<URL, Error>) -> Void] = []

    private let lock = NSLock()
    private var handle: FileHandle?
    private var parser: AudioFileStreamID?
    // Written by the parser's callbacks (on the session's queue, inside parse), read under the lock.
    fileprivate var packetsRaw: Int64 = 0
    fileprivate var framesPerPacketRaw: UInt32 = 1152
    fileprivate var sampleRateRaw: Double = 0

    private var _received: Int64 = 0
    private var _expected: Int64 = -1
    private var _done = false
    private var _failed: Error?

    init(id: String, target: URL, url: URL) {
        self.id = id
        self.target = target
        self.url = url
    }

    struct State {
        var received: Int64
        var expected: Int64
        var done: Bool
        var failed: Error?
        /// Frames of audio arrived whole, and their rate (0 until the first frame is seen).
        var frames: AVAudioFramePosition
        var sampleRate: Double
    }

    var state: State {
        lock.lock()
        defer { lock.unlock() }
        return State(received: _received, expected: _expected, done: _done, failed: _failed, frames: AVAudioFramePosition(packetsRaw) * AVAudioFramePosition(framesPerPacketRaw), sampleRate: sampleRateRaw)
    }

    /// The response came: the file is started, the parser opened (MP3 only: other codecs are not counted).
    func begin(expected: Int64, mp3: Bool) throws {
        try? FileManager.default.removeItem(at: part)
        FileManager.default.createFile(atPath: part.path, contents: nil)
        handle = try FileHandle(forWritingTo: part)
        lock.lock()
        _expected = expected
        lock.unlock()
        guard mp3 else { return }
        let me = Unmanaged.passUnretained(self).toOpaque()
        AudioFileStreamOpen(me, { client, stream, property, _ in
            guard property == kAudioFileStreamProperty_DataFormat else { return }
            let fetch = Unmanaged<TrackFetch>.fromOpaque(client).takeUnretainedValue()
            var format = AudioStreamBasicDescription()
            var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            if AudioFileStreamGetProperty(stream, property, &size, &format) == noErr {
                fetch.sampleRateRaw = format.mSampleRate
                if format.mFramesPerPacket > 0 { fetch.framesPerPacketRaw = format.mFramesPerPacket }
            }
        }, { client, _, packets, _, _ in
            let fetch = Unmanaged<TrackFetch>.fromOpaque(client).takeUnretainedValue()
            fetch.packetsRaw += Int64(packets)
        }, kAudioFileMP3Type, &parser)
    }

    /// More bytes: written, counted. Throws when the file cannot be written (it was trimmed away).
    func append(_ data: Data) throws {
        var data = data
        if skip > 0 {
            let drop = min(skip, Int64(data.count))
            skip -= drop
            data = data.subdata(in: Int(drop)..<data.count)
            if data.isEmpty { return }
        }
        try handle?.write(contentsOf: data)
        lock.lock()
        if let parser = parser {
            data.withUnsafeBytes { raw in
                _ = AudioFileStreamParseBytes(parser, UInt32(raw.count), raw.baseAddress, [])
            }
        }
        _received += Int64(data.count)
        lock.unlock()
    }

    /// The download is over: whole (renamed into place) or failed.
    func finish(_ error: Error?) {
        try? handle?.close()
        handle = nil
        lock.lock()
        if let parser = parser { AudioFileStreamClose(parser) }
        parser = nil
        if let error = error {
            _failed = error
            try? FileManager.default.removeItem(at: part)
        } else {
            try? FileManager.default.removeItem(at: target)
            do {
                try FileManager.default.moveItem(at: part, to: target)
                _done = true
            } catch {
                _failed = error
            }
        }
        lock.unlock()
    }
}
