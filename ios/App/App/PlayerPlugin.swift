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

/// The iPhone's music player. WebKit's own (an <audio> element) took the lock screen with
/// -10 s / +10 s, and its Web Audio equalizer lagged a second or two behind every seek and went
/// silent when the screen locked. This plays in the app itself: AVAudioEngine, a player node and
/// the system's 10-band equalizer. A track is fetched whole into Caches/oni-play first (the next
/// ones ahead of time); downloaded tracks are written there decrypted by the page. The page sees
/// it as an audio element: src/player/nativeAudio.ts. JS: registerPlugin('OniPlayer').
/// Two player nodes into one mixer, for crossfades: the next track starts on the other node while
/// this one fades out (`open` with `fade`), and from then on the other is the one.
@objc(PlayerPlugin)
public class PlayerPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDataDelegate {
    public let identifier = "PlayerPlugin"
    public let jsName = "OniPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEq", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setGain", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "state", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testThrottle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pulse", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "eqResponse", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAwake", returnType: CAPPluginReturnPromise),
    ]

    /// After a pause the engine runs on, silent, this long (0: it stops at once): iOS keeps Oni
    /// awake then, so the PC can still play it as a remote with the phone locked (the user,
    /// 25.10.2026: 10 minutes; src/sync/elsewhere.ts sets it when the account has other devices).
    private var awakeFor: TimeInterval = 0
    private var sleepTimer: Timer?

    /// Paused, but still awake (the engine running silent).
    var isAwake: Bool { !playing && sleepTimer != nil && engine.isRunning }

    /// { seconds }
    @objc func setAwake(_ call: CAPPluginCall) {
        let seconds = call.getDouble("seconds") ?? 0
        DispatchQueue.main.async {
            self.awakeFor = max(0, seconds)
            if self.awakeFor == 0, !self.playing, self.sleepTimer != nil { self.fallAsleep() }
            call.resolve()
        }
    }

    private func fallAsleep() {
        sleepTimer?.invalidate()
        sleepTimer = nil
        if !playing { engine.pause() }
    }

    /// The equalizer's bands, as on the desktop (src/player/eqCurve.ts) and in the official app.
    static let bands: [Float] = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000]
    /// The middle bands' widths in octaves: what the official app's peaking bands (Web Audio, Q 1)
    /// really have at a 48 kHz PC, narrower towards the top (src/player/eqCurve.ts, digitalWidth);
    /// the system equalizer keeps a band the width it is given. One octave for all was too narrow
    /// below and too wide at 12k and 14k. The smoke run measures it against Yandex's curve.
    static func digitalWidth(_ frequency: Float, q: Double = 1, rate: Double = 48000) -> Float {
        let w = 2 * Double.pi * Double(frequency) / rate
        return Float(2 / log(2.0) * asinh(1 / (2 * q)) * sin(w) / w)
    }

    /// Sets an equalizer's bands up as Oni's: a low shelf, peaking bands, a high shelf. For the
    /// smoke run's comparisons: `bandwidth` one width for every peaking band instead of each its
    /// own, `widthRate` the PC rate those are worked out for.
    static func shape(_ eq: AVAudioUnitEQ, bandwidth: Float? = nil, widthRate: Double = 48000) {
        let last = bands.count - 1
        for (i, band) in eq.bands.enumerated() {
            band.frequency = bands[i]
            band.filterType = i == 0 ? .lowShelf : (i == last ? .highShelf : .parametric)
            band.bandwidth = i == 0 || i == last ? 1 : (bandwidth ?? digitalWidth(bands[i], rate: widthRate))
            band.gain = 0
            band.bypass = false
        }
    }

    private let engine = AVAudioEngine()
    private let nodes = [AVAudioPlayerNode(), AVAudioPlayerNode()]
    /// Which of `nodes` plays the track now.
    private var active = 0
    private var node: AVAudioPlayerNode { nodes[active] }
    /// Both nodes meet here (each on a bus of its own), before the equalizer.
    private let mix = AVAudioMixerNode()
    private let eq = AVAudioUnitEQ(numberOfBands: 10)
    /// The loudness levelling's lift above full volume (a mixer's volume stops at 1): a plain gain, no bands.
    private let lift = AVAudioUnitEQ(numberOfBands: 0)
    private var file: AVAudioFile?
    /// The format each node is connected with (its file's).
    private var formats: [AVAudioFormat?] = [nil, nil]
    private var format: AVAudioFormat? { formats[active] }
    /// A crossfade under way: the old track's node, fading out, and the clock of the fade.
    private var tail: AVAudioPlayerNode?
    private var crossing: Timer?
    /// Where the current schedule starts, in frames; position = this + what the node has played.
    private var startFrame: AVAudioFramePosition = 0
    /// Bumped on every new schedule: the completion of an older one (stopped, replaced) is ignored.
    private var generation = 0
    private var playing = false
    private var pausedAt: Double = 0
    private var timer: Timer?
    private let lock = NSLock()
    /// Oni is in the background: the clock goes to the page once a second, not four times, and the
    /// bass is not listened to (no pulse to show). A night of four a second plus the beat's ten
    /// was a flood of messages to a page nobody looked at (the user's black screen in the morning).
    private var away = false
    /// What the page last asked of the pulse, given back once Oni is in front again.
    private var pulseWanted = false

    // Fast start: a track plays once START seconds of it have come; the rest is given to the node
    // in pieces as it arrives (`extend`). Running short, the node stops and waits ("stalled",
    // shown as loading) rather than play silence that would move the clock on.
    private static let START: Double = 8
    /// Frames kept back from the newest end (a frame being written), and the smallest piece given.
    private static let MARGIN: AVAudioFramePosition = 4608
    private static let PIECE: AVAudioFramePosition = 44100
    /// Downloads under way by track id (written under `lock`), on a session of their own.
    private var fetching: [String: TrackFetch] = [:]
    private var byTask: [Int: TrackFetch] = [:]
    /// The downloads' callbacks, and the slow network's releases, one at a time.
    private let netQueue = DispatchQueue(label: "oni.fetch")
    private lazy var session: URLSession = {
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        queue.underlyingQueue = netQueue
        return URLSession(configuration: .default, delegate: self, delegateQueue: queue)
    }()
    /// The slow network (testThrottle): downloads holding bytes back, and the clock letting them through.
    private var holding: [TrackFetch] = []
    private var releaser: DispatchSourceTimer?
    /// Those waiting to start a track as soon as enough of it is in (main thread).
    private var starters: [String: [() -> Void]] = [:]
    /// Bumped by every open: a track that comes in after a newer one was asked for is not played
    /// (quick skips: the old one, arriving last, began over the new).
    private var opens = 0
    /// The track playing, while it is still arriving (nil once whole, or for a file from disk).
    private var stream: TrackFetch?
    /// Where the music ends in the track playing, its silence after it left out (the smart crossfade,
    /// src/player/silence.ts): looked for once its file is whole; `endOf` the track (`tracksOpened`) it is for
    /// (the file itself is opened anew as a track arrives).
    private var musicEnd: Double?
    private var endOf = -1
    /// Counts the tracks opened (not `generation`, which a seek moves on too).
    private var tracksOpened = 0
    private var endSearch = false
    /// Its length as the page knows it (the file's own is only known once whole).
    private var durationHint: Double = 0
    /// Frames handed to the node so far, pieces not yet played, and whether it waits for data.
    private var scheduledEnd: AVAudioFramePosition = 0
    private var outstanding = 0
    private var stalled = false
    /// For the simulator run: downloads held to this many bytes a second (0: as fast as they come).
    static var throttle: Double = 0
    /// For the simulator run: how the pieces went (extend calls, pieces given, the last view of the file).
    private var trace: [String: Any] = [:]

    /// The one player, for the lock screen's play and pause (RemotePlugin).
    static weak var shared: PlayerPlugin?

    static var folder: URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("oni-play", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    override public func load() {
        PlayerPlugin.shared = self
        PlayerPlugin.shape(eq)
        eq.bypass = true
        for n in nodes { engine.attach(n) }
        engine.attach(mix)
        engine.attach(eq)
        engine.attach(lift)
        engine.connect(mix, to: eq, format: nil)
        engine.connect(eq, to: lift, format: nil)
        engine.connect(lift, to: engine.mainMixerNode, format: nil)
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        center.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        center.addObserver(self, selector: #selector(configurationChanged(_:)), name: .AVAudioEngineConfigurationChange, object: engine)
        center.addObserver(self, selector: #selector(leaving), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(returning), name: UIApplication.willEnterForegroundNotification, object: nil)
        center.addObserver(self, selector: #selector(returning), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func leaving() {
        away = true
        if timer != nil { startTimer() }
        setPulse(false)
    }

    @objc private func returning() {
        guard away else { return }
        away = false
        if timer != nil {
            startTimer()
            tick()
        }
        setPulse(pulseWanted)
    }

    // MARK: files

    /// { id, url, ext } — fetches a track into the cache ahead of time (no-op if it is there).
    @objc func fetch(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let url = call.getString("url") else {
            call.reject("id and url are required")
            return
        }
        localFile(id: id, url: url, ext: call.getString("ext") ?? "mp3") { result in
            switch result {
            case .success: call.resolve()
            case .failure(let error): call.reject(error.localizedDescription)
            }
        }
    }

    /// The file's audio by the type its name says, or, when that does not open, by what it holds:
    /// Yandex says "aac" for uploads that are MP4 (M4A) inside, and the user's own tracks would not
    /// start ("cannot open", 25.10.2026).
    private func openAudio(_ url: URL) throws -> AVAudioFile {
        do {
            return try AVAudioFile(forReading: url)
        } catch {
            guard url.pathExtension != "m4a", let handle = try? FileHandle(forReadingFrom: url) else { throw error }
            let head = handle.readData(ofLength: 8)
            try? handle.close()
            guard head.count == 8, String(data: head.subdata(in: 4..<8), encoding: .ascii) == "ftyp" else { throw error }
            let m4a = url.deletingPathExtension().appendingPathExtension("m4a")
            try? FileManager.default.removeItem(at: m4a)
            try FileManager.default.copyItem(at: url, to: m4a)
            return try AVAudioFile(forReading: m4a)
        }
    }

    private func cached(_ id: String, _ ext: String) -> URL {
        return PlayerPlugin.folder.appendingPathComponent(id + "." + ext)
    }

    /// The track's file, whole: from the cache, or once its download is over (however many ask).
    private func localFile(id: String, url: String, ext: String, done: @escaping (Result<URL, Error>) -> Void) {
        let target = cached(id, ext)
        if FileManager.default.fileExists(atPath: target.path) {
            done(.success(target))
            return
        }
        guard let fetch = fetchFor(id: id, url: url, ext: ext) else {
            done(.failure(URLError(.badURL)))
            return
        }
        lock.lock()
        fetch.waiters.append(done)
        lock.unlock()
    }

    /// The download of a track: the one under way, or a new one.
    private func fetchFor(id: String, url: String, ext: String) -> TrackFetch? {
        lock.lock()
        defer { lock.unlock() }
        if let running = fetching[id] { return running }
        guard let remote = URL(string: url) else { return nil }
        let fetch = TrackFetch(id: id, target: cached(id, ext), url: remote)
        let task = session.dataTask(with: remote)
        fetch.task = task
        fetching[id] = fetch
        byTask[task.taskIdentifier] = fetch
        task.resume()
        return fetch
    }

    private func fetchOf(_ task: URLSessionTask) -> TrackFetch? {
        lock.lock()
        defer { lock.unlock() }
        return byTask[task.taskIdentifier]
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard let fetch = fetchOf(dataTask), (200..<300).contains(status) else { return completionHandler(.cancel) }
        // Going on after a break: the rest of it (206), or all of it again, its start dropped (200).
        if fetch.began {
            if status == 200 { fetch.skip = fetch.state.received }
            return completionHandler(.allow)
        }
        do {
            try fetch.begin(expected: response.expectedContentLength, mp3: fetch.target.pathExtension == "mp3")
            completionHandler(.allow)
        } catch {
            completionHandler(.cancel)
        }
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let fetch = fetchOf(dataTask) else { return }
        // The simulator run's slow network: read at full speed, let through at its pace (sleeping on
        // the reads instead shrank the connection, which every download from that server shares).
        if PlayerPlugin.throttle > 0 || !fetch.held.isEmpty {
            fetch.held.append(data)
            hold(fetch)
            return
        }
        deliver(fetch, data)
    }

    private func deliver(_ fetch: TrackFetch, _ data: Data) {
        do {
            try fetch.append(data)
        } catch {
            fetch.task?.cancel()
            return
        }
        DispatchQueue.main.async { self.arrived(fetch) }
    }

    private func hold(_ fetch: TrackFetch) {
        if !holding.contains(where: { $0 === fetch }) { holding.append(fetch) }
        guard releaser == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: netQueue)
        timer.schedule(deadline: .now() + 0.05, repeating: 0.05)
        timer.setEventHandler { [weak self] in self?.release() }
        releaser = timer
        timer.resume()
    }

    /// A twentieth of a second's worth of each held download (all of it once the throttle is off).
    private func release() {
        for fetch in holding {
            let n = PlayerPlugin.throttle > 0 ? max(1, Int(PlayerPlugin.throttle * 0.05)) : fetch.held.count
            let chunk = fetch.held.prefix(n)
            fetch.held.removeFirst(chunk.count)
            if !chunk.isEmpty { deliver(fetch, Data(chunk)) }
            if fetch.held.isEmpty, let end = fetch.heldEnd {
                fetch.heldEnd = nil
                complete(fetch, end)
            }
        }
        holding.removeAll { $0.held.isEmpty && $0.heldEnd == nil }
        if holding.isEmpty {
            releaser?.cancel()
            releaser = nil
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let fetch = fetchOf(task) else { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let failure = error ?? ((200..<300).contains(status) ? nil : URLError(.badServerResponse))
        // The connection broke midway (not cancelled here): on from the byte it stopped at.
        if let failure = failure, (failure as? URLError)?.code != .cancelled, fetch.began, fetch.retries < 4 {
            fetch.retries += 1
            var request = URLRequest(url: fetch.url)
            request.setValue("bytes=\(fetch.state.received + Int64(fetch.held.count))-", forHTTPHeaderField: "Range")
            let next = session.dataTask(with: request)
            lock.lock()
            byTask.removeValue(forKey: task.taskIdentifier)
            byTask[next.taskIdentifier] = fetch
            fetch.task = next
            lock.unlock()
            next.resume()
            return
        }
        // Bytes still held back (the slow network): it ends once they are through.
        if !fetch.held.isEmpty {
            fetch.heldEnd = .some(failure)
            return
        }
        complete(fetch, failure)
    }

    /// The download is over: whole or failed; those waiting for it are told.
    private func complete(_ fetch: TrackFetch, _ failure: Error?) {
        fetch.finish(failure)
        lock.lock()
        fetching.removeValue(forKey: fetch.id)
        if let task = fetch.task { byTask.removeValue(forKey: task.taskIdentifier) }
        let waiting = fetch.waiters
        fetch.waiters = []
        lock.unlock()
        let result: Result<URL, Error> = fetch.state.done ? .success(fetch.target) : .failure(fetch.state.failed ?? URLError(.unknown))
        waiting.forEach { $0(result) }
        DispatchQueue.main.async { self.arrived(fetch) }
    }

    /// More of a track came (main thread): a start waiting for it goes, the one playing gets more.
    private func arrived(_ fetch: TrackFetch) {
        let st = fetch.state
        let enough = st.done || st.failed != nil || (st.sampleRate > 0 && Double(st.frames) >= PlayerPlugin.START * st.sampleRate)
        if enough, let waiting = starters.removeValue(forKey: fetch.id) { waiting.forEach { $0() } }
        guard stream === fetch else { return }
        // It broke for good while playing: the page asks for it again (a fresh address) and seeks
        // back to where it was, instead of waiting for ever.
        if let error = st.failed {
            stream = nil
            trace["failed"] = String(describing: error)
            return notifyListeners("error", data: ["message": error.localizedDescription])
        }
        trace["retries"] = fetch.retries
        extend()
    }

    /// Keeps the cache to the tracks the page still needs (the playing one and those ahead).
    private func trim(keeping ids: [String]) {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: PlayerPlugin.folder.path)) ?? []
        for name in names where !ids.contains(where: { name.hasPrefix($0 + ".") }) {
            try? FileManager.default.removeItem(at: PlayerPlugin.folder.appendingPathComponent(name))
        }
    }

    // MARK: playback

    /// { id, url?, file?, ext, keep: [ids], fade? } — opens a track (from a URL, or a file the page
    /// wrote into the cache folder) at its start, paused; resolves { duration }. With `fade` (ms) and
    /// music playing, it starts at once and the playing track fades out into it (a crossfade).
    @objc func open(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("id is required")
            return
        }
        let ext = call.getString("ext") ?? "mp3"
        let keep = call.getArray("keep", String.self) ?? [id]
        let fade = call.getDouble("fade") ?? 0
        let hint = call.getDouble("duration") ?? 0
        lock.lock()
        opens += 1
        let mine = opens
        lock.unlock()
        /// Plays `file`; `fetch` while it is still arriving (main thread).
        let play: (AVAudioFile, TrackFetch?) -> Void = { file, fetch in
            self.lock.lock()
            let newest = self.opens == mine
            self.lock.unlock()
            guard newest else { return call.reject("superseded") }
            self.stream = fetch
            self.durationHint = hint
            if fade > 0 && self.playing { self.cross(into: file, seconds: fade / 1000) } else { self.begin(file) }
            self.trim(keeping: keep)
            call.resolve(["duration": self.duration])
        }
        let opened: (Result<URL, Error>) -> Void = { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self else { return }
                switch result {
                case .failure(let error):
                    call.reject(error.localizedDescription)
                case .success(let url):
                    do {
                        play(try self.openAudio(url), nil)
                    } catch {
                        call.reject("cannot open: " + error.localizedDescription)
                    }
                }
            }
        }
        if let b64 = call.getString("sealed") {
            // A downloaded track: its sealed file from the library, opened here into the cache the
            // player reads (the page used to decrypt it and send it over as text, a freeze each time).
            Vault.set(base64: b64)
            DispatchQueue.global(qos: .userInitiated).async {
                let source = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("offline/\(id).oni")
                let target = self.cached(id, ext)
                do {
                    guard let key = Vault.key else { throw CryptoKitError.incorrectKeySize }
                    try Vault.open(try Data(contentsOf: source), with: key).write(to: target, options: .atomic)
                    opened(.success(target))
                } catch {
                    opened(.failure(error))
                }
            }
        } else if let name = call.getString("file") {
            opened(.success(PlayerPlugin.folder.appendingPathComponent(name)))
        } else if let url = call.getString("url"), ext == "mp3", !FileManager.default.fileExists(atPath: cached(id, ext).path), let fetch = fetchFor(id: id, url: url, ext: ext) {
            // Fast start: once a few seconds of it are in, it plays from what has come so far.
            let go = { [weak self] in
                guard let self = self else { return }
                let st = fetch.state
                if let error = st.failed { return call.reject(error.localizedDescription) }
                if st.done { return opened(.success(fetch.target)) }
                guard let file = try? AVAudioFile(forReading: fetch.part) else { return opened(.failure(URLError(.cannotDecodeContentData))) }
                play(file, fetch)
            }
            DispatchQueue.main.async {
                // Only the newest open waits to start (an older one, of any track, is dropped).
                self.starters = [id: [go]]
                self.arrived(fetch)
            }
        } else if let url = call.getString("url") {
            localFile(id: id, url: url, ext: ext, done: opened)
        } else {
            call.reject("url or file is required")
        }
    }

    private func begin(_ file: AVAudioFile) {
        // A new track: a fade of the old one (another app's sound) is over, and so is a crossfade.
        endCross()
        fading?.invalidate()
        fading = nil
        node.volume = 1
        generation += 1
        node.stop()
        stopTimer()
        playing = false
        pausedAt = 0
        connect(file)
        self.file = file
        musicEnd = nil
        tracksOpened += 1
        endOf = tracksOpened
        schedule(from: 0)
    }

    /// The active node, connected with this file's format.
    private func connect(_ file: AVAudioFile) {
        guard formats[active] != file.processingFormat else { return }
        engine.disconnectNodeOutput(node)
        engine.connect(node, to: mix, fromBus: 0, toBus: active, format: file.processingFormat)
        formats[active] = file.processingFormat
    }

    /// The crossfade: `file` starts on the other node at silence and rises while the playing one
    /// falls (equal power: as loud through the middle), then the old node stops.
    private func cross(into file: AVAudioFile, seconds: Double) {
        endCross()
        fading?.invalidate()
        fading = nil
        let old = node
        // The old track's end is no longer the end of what plays.
        generation += 1
        active = 1 - active
        node.stop()
        node.volume = 0
        connect(file)
        self.file = file
        musicEnd = nil
        tracksOpened += 1
        endOf = tracksOpened
        // From its first sound, past the silence at its start (the smart crossfade).
        let lead = leadIn(file.url)
        pausedAt = lead
        schedule(from: AVAudioFramePosition(lead * file.processingFormat.sampleRate))
        if !stalled { node.play() }
        tail = old
        let start = Date()
        crossing = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let p = min(1, Date().timeIntervalSince(start) / max(0.1, seconds))
            old.volume = Float(cos(p * .pi / 2))
            self.node.volume = Float(sin(p * .pi / 2))
            if p >= 1 { self.endCross() }
        }
        tick()
    }

    /// A crossfade still running is done now: the old track stops, the new one at full volume.
    private func endCross() {
        crossing?.invalidate()
        crossing = nil
        guard let old = tail else { return }
        tail = nil
        old.stop()
        old.volume = 1
        node.volume = 1
    }

    /// Hands the node the track from `frame`: all of it, or (still arriving) what has come so far.
    private func schedule(from frame: AVAudioFramePosition) {
        guard let file = file else { return }
        let from = max(0, frame)
        startFrame = from
        scheduledEnd = from
        outstanding = 0
        stalled = false
        guard stream != nil else {
            let end = file.length
            guard end > from else { return }
            give(file, upTo: end)
            return
        }
        // Nothing there yet (a seek ahead of the download): it waits, and plays once it comes.
        stalled = true
        extend()
    }

    /// A piece of the track to the node, `scheduledEnd` up to `end`.
    private func give(_ file: AVAudioFile, upTo end: AVAudioFramePosition) {
        let from = scheduledEnd
        scheduledEnd = end
        outstanding += 1
        let gen = generation
        node.scheduleSegment(file, startingFrame: from, frameCount: AVAudioFrameCount(end - from), at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self, self.generation == gen else { return }
                self.outstanding -= 1
                if self.outstanding == 0 { self.drained() }
            }
        }
    }

    /// More of the track arriving: what has come since is given to the node (a second or more at
    /// a time); once whole, the rest, and the whole file becomes the one to seek in.
    private func extend() {
        guard let fetch = stream, file != nil else { return }
        let st = fetch.state
        trace["extends"] = (trace["extends"] as? Int ?? 0) + 1
        if st.failed != nil { return }
        // Less than a piece more, and the node still has some: the file is not opened again for it
        // (dozens of small arrivals a second, each an open: heat on the phone).
        if !st.done && outstanding > 0 && st.frames - PlayerPlugin.MARGIN - scheduledEnd < PlayerPlugin.PIECE { return }
        // The newest view of it: what has arrived so far, or the whole file.
        let view: AVAudioFile
        do {
            view = try AVAudioFile(forReading: st.done ? fetch.target : fetch.part)
        } catch {
            trace["openError"] = String(describing: error)
            return
        }
        let available = st.done ? view.length : min(view.length, st.frames) - PlayerPlugin.MARGIN
        trace["viewLength"] = view.length
        trace["frames"] = st.frames
        trace["received"] = st.received
        trace["scheduledEnd"] = scheduledEnd
        trace["outstanding"] = outstanding
        if available > scheduledEnd && (st.done || outstanding == 0 || available - scheduledEnd >= PlayerPlugin.PIECE) {
            give(view, upTo: available)
            trace["gives"] = (trace["gives"] as? Int ?? 0) + 1
            file = view
            if stalled {
                stalled = false
                if playing { node.play() }
                tick()
            }
        }
        if st.done {
            file = view
            stream = nil
        }
    }

    /// Everything given has played: the end, or (still arriving) a wait for more.
    private func drained() {
        if stream == nil {
            playing = false
            pausedAt = duration
            stopTimer()
            notifyListeners("ended", data: [:])
            return
        }
        // Ran short: the node stops (its clock with it) and starts again from here when more comes.
        pausedAt = Double(scheduledEnd) / (format?.sampleRate ?? 44100)
        generation += 1
        node.stop()
        startFrame = scheduledEnd
        outstanding = 0
        stalled = true
        tick()
        extend()
    }

    private var duration: Double {
        guard let file = file else { return 0 }
        let rate = file.processingFormat.sampleRate
        // Still arriving: the page's length (the file's own counts only what has come).
        if let fetch = stream {
            if durationHint > 0 { return durationHint }
            let st = fetch.state
            if st.expected > 0 && st.received > 0 { return Double(st.frames) * Double(st.expected) / Double(st.received) / rate }
        }
        return Double(file.length) / rate
    }

    private var position: Double {
        guard let file = file else { return 0 }
        guard playing, !stalled, let last = node.lastRenderTime, let time = node.playerTime(forNodeTime: last) else { return pausedAt }
        return min(duration, Double(startFrame + time.sampleTime) / file.processingFormat.sampleRate)
    }

    @objc func play(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.file != nil else {
                call.reject("nothing open")
                return
            }
            do {
                try self.start()
                call.resolve()
            } catch {
                call.reject("cannot start: " + error.localizedDescription)
            }
        }
    }

    private func start() throws {
        sleepTimer?.invalidate()
        sleepTimer = nil
        try AVAudioSession.sharedInstance().setActive(true)
        if !engine.isRunning { try engine.start() }
        // A fade under way (another app's sound) gives way to the user's play; a crossfade goes on.
        fading?.invalidate()
        fading = nil
        if tail == nil { node.volume = 1 }
        // What plays elsewhere already (a sound kept on by some app) is not a reason to stop.
        othersPlaying = AVAudioSession.sharedInstance().isOtherAudioPlaying
        // Waiting for more of the track: it plays once that comes (extend).
        if !stalled { node.play() }
        playing = true
        startTimer()
        tick()
    }

    var isPlaying: Bool { playing }
    var currentTime: Double { position }

    /// The lock screen's play (main thread): false when there is nothing open to play (or the
    /// track has ended), so the page is asked instead.
    func resume() -> Bool {
        guard file != nil, playing || pausedAt < duration - 0.05 else { return false }
        if playing { return true }
        return (try? start()) != nil
    }

    /// The lock screen's pause (main thread).
    func pauseNow() -> Bool {
        halt()
        return true
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.halt()
            call.resolve()
        }
    }

    private func halt() {
        guard playing else { return }
        // A pause mid-crossfade ends it: what comes back is the new track alone.
        endCross()
        pausedAt = position
        node.pause()
        // The engine too: running, it fed the output silence, and iOS took the app for playing, so
        // the lock screen and the shade kept "pause" up after a pause in Oni (the user). Play
        // starts it again; the node keeps its place. Kept awake (another device may play this one),
        // it stops only after a while; the lock screen's "pause" meanwhile plays (RemotePlugin).
        playing = false
        sleepTimer?.invalidate()
        sleepTimer = nil
        if awakeFor > 0 {
            sleepTimer = Timer.scheduledTimer(withTimeInterval: awakeFor, repeats: false) { [weak self] _ in self?.fallAsleep() }
        } else {
            engine.pause()
        }
        stopTimer()
        tick()
        // Whoever paused (the page, the lock screen, iOS for a call or the headphones), the lock screen
        // shows it now: the page may be frozen and never tell it.
        showOnLockScreen(playing: false, at: pausedAt)
    }

    /// { time } in seconds; keeps playing if it was.
    @objc func seek(_ call: CAPPluginCall) {
        let time = call.getDouble("time") ?? 0
        DispatchQueue.main.async {
            guard let file = self.file else {
                call.resolve()
                return
            }
            let was = self.playing
            self.generation += 1
            self.node.stop()
            self.schedule(from: AVAudioFramePosition(max(0, time) * file.processingFormat.sampleRate))
            self.pausedAt = Double(self.startFrame) / file.processingFormat.sampleRate
            if was && !self.stalled { self.node.play() }
            self.tick()
            call.resolve()
        }
    }

    /// { enabled, preamp, gains: [dB] } — the desktop's settings, on the system equalizer.
    @objc func setEq(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        let preamp = Float(call.getDouble("preamp") ?? 0)
        let gains = call.getArray("gains", Double.self) ?? []
        DispatchQueue.main.async {
            self.eq.bypass = !enabled
            self.eq.globalGain = enabled ? preamp : 0
            for (i, band) in self.eq.bands.enumerated() {
                band.gain = enabled && i < gains.count ? Float(gains[i]) : 0
            }
            call.resolve()
        }
    }

    /// { value } — the loudness levelling (above 1: a quiet track raised); the volume itself is the phone's (OniVolume).
    @objc func setGain(_ call: CAPPluginCall) {
        let value = max(0, Float(call.getDouble("value") ?? 1))
        DispatchQueue.main.async {
            self.engine.mainMixerNode.outputVolume = min(1, value)
            self.lift.globalGain = value > 1 ? min(24, 20 * log10(value)) : 0
            call.resolve()
        }
    }

    @objc func state(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let st = self.stream?.state
            call.resolve([
                "time": self.position, "duration": self.duration, "playing": self.playing, "eq": !self.eq.bypass, "engine": self.engine.isRunning,
                "crossing": self.tail != nil, "lift": self.lift.globalGain, "streaming": self.stream != nil, "waiting": self.stalled,
                "received": st?.received ?? 0, "expected": st?.expected ?? 0, "trace": self.trace,
                "musicEnd": self.musicEnd ?? -1, "endOf": self.endOf, "tracksOpened": self.tracksOpened, "endSearch": self.endSearch, "hasFile": self.file != nil,
            ])
        }
    }

    // MARK: the beat pulse

    /// The bass, listened to for the page's beat pulse (src/player/pulse.ts): the music after the
    /// two players meet, as the desktop's analyser hears it — the levels (dB) of its four lowest
    /// bins (≈47, 94, 141, 188 Hz: band-pass filters, a 1024-sample window, smoothed by half,
    /// about 60 times a second), each with the moment it will be heard (wall clock, ms). Sent to
    /// the page a few at a time; it finds the kicks (`bassFlux`, `KickDetector`). It used to be
    /// one low-pass loudness mapped over −100…−30 dB, where a loud song's bass stayed at the top
    /// and the cover hardly throbbed (tests/beat.test.ts, "a loud master").
    private var pulseOn = false
    private static let pulseBands = 4
    private static let pulseWindow = 1024
    /// Per band: the biquad's coefficients (b0, b2, a1, a2; b1 is 0) and state, the squares of the
    /// last window and their sum, and the smoothed level.
    private var bandCoeffs: [(b0: Float, b2: Float, a1: Float, a2: Float)] = []
    private var bandState: [(x1: Float, x2: Float, y1: Float, y2: Float)] = []
    private var bandSquares: [[Float]] = []
    private var bandSum: [Float] = []
    private var bandLevel: [Float] = []
    private var windowAt = 0
    private var hopFill = 0

    /// { on } — listen to the bass for the page's beat pulse, or stop (it costs a little power).
    @objc func pulse(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            self.pulseWanted = on
            self.setPulse(on && !self.away)
            call.resolve()
        }
    }

    private func setPulse(_ on: Bool) {
        guard on != pulseOn else { return }
        pulseOn = on
        if !on {
            mix.removeTap(onBus: 0)
            return
        }
        let format = mix.outputFormat(forBus: 0)
        let rate = Float(format.sampleRate > 0 ? format.sampleRate : 44100)
        // Band-pass biquads (RBJ's cookbook, 0 dB at the centre), Q 3, at the analyser's bins
        // (48 kHz / 1024 apart).
        bandCoeffs = (1...PlayerPlugin.pulseBands).map { k in
            let w = 2 * Float.pi * 46.875 * Float(k) / rate
            let alpha = sin(w) / (2 * 3)
            let a0 = 1 + alpha
            return (b0: alpha / a0, b2: -alpha / a0, a1: -2 * cos(w) / a0, a2: (1 - alpha) / a0)
        }
        bandState = Array(repeating: (0, 0, 0, 0), count: PlayerPlugin.pulseBands)
        bandSquares = Array(repeating: Array(repeating: 0, count: PlayerPlugin.pulseWindow), count: PlayerPlugin.pulseBands)
        bandSum = Array(repeating: 0, count: PlayerPlugin.pulseBands)
        bandLevel = Array(repeating: 0, count: PlayerPlugin.pulseBands)
        windowAt = 0
        hopFill = 0
        let hop = Int(rate / 60)
        mix.installTap(onBus: 0, bufferSize: 2048, format: nil) { [weak self] buffer, when in
            self?.listen(buffer, when: when, hop: hop, rate: Double(rate))
        }
    }

    /// One buffer of the music (the tap's thread): its low bands, hop by hop.
    private func listen(_ buffer: AVAudioPCMBuffer, when: AVAudioTime, hop: Int, rate: Double) {
        guard let data = buffer.floatChannelData else { return }
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        let bands = PlayerPlugin.pulseBands
        let size = PlayerPlugin.pulseWindow
        // When the buffer's first frame is heard, on the wall clock (ms).
        let session = AVAudioSession.sharedInstance()
        let lead = when.isHostTimeValid ? AVAudioTime.seconds(forHostTime: when.hostTime) - CACurrentMediaTime() : 0
        let start = Date().timeIntervalSince1970 * 1000 + (lead + session.outputLatency + session.ioBufferDuration) * 1000
        var at: [Double] = []
        var db: [Double] = []
        for i in 0..<frames {
            var x: Float = 0
            for ch in 0..<channels { x += data[ch][i] }
            x /= Float(max(1, channels))
            for b in 0..<bands {
                let c = bandCoeffs[b]
                let s = bandState[b]
                let y = c.b0 * x + c.b2 * s.x2 - c.a1 * s.y1 - c.a2 * s.y2
                bandState[b] = (x, s.x1, y, s.y1)
                let sq = y * y
                bandSum[b] += sq - bandSquares[b][windowAt]
                bandSquares[b][windowAt] = sq
            }
            windowAt = (windowAt + 1) % size
            hopFill += 1
            if hopFill >= hop {
                for b in 0..<bands {
                    let rms = (max(0, bandSum[b]) / Float(size)).squareRoot()
                    // smoothed by half, as the analyser smooths; × 0.297: a sine's level in a
                    // Blackman-windowed bin (|X| / N) against its RMS here
                    bandLevel[b] = 0.5 * bandLevel[b] + 0.5 * rms
                    db.append(Double(20 * log10(max(bandLevel[b] * 0.297, 1e-10))))
                }
                at.append(start + Double(i) / rate * 1000)
                hopFill = 0
            }
        }
        // Sent with each buffer (~20 a second): held back to ten a second, most came after they
        // were heard and the cover throbbed late (the simulator run's trace).
        DispatchQueue.main.async {
            guard self.pulseOn, !at.isEmpty else { return }
            self.notifyListeners("beat", data: ["at": at, "db": db])
        }
    }

    /// { gains, preamp, frequencies, bandwidth?, widthRate?, rate? } → { db: [...] } — for the
    /// simulator run: what the system equalizer, set up as Oni's, does to a pure tone at each
    /// frequency (rendered offline, against the same tone with the bands flat). The user asked
    /// whether it sounds as the official app's equalizer does.
    @objc func eqResponse(_ call: CAPPluginCall) {
        let gains = (call.getArray("gains", Double.self) ?? []).map { Float($0) }
        let preamp = Float(call.getDouble("preamp") ?? 0)
        let frequencies = call.getArray("frequencies", Double.self) ?? []
        let bandwidth = call.getDouble("bandwidth").map { Float($0) }
        let widthRate = call.getDouble("widthRate") ?? 48000
        let rate = call.getDouble("rate") ?? 48000
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                var out: [Double] = []
                for f in frequencies {
                    let shaped = try PlayerPlugin.toneLevel(f, gains: gains, preamp: preamp, bandwidth: bandwidth, widthRate: widthRate, rate: rate)
                    let flat = try PlayerPlugin.toneLevel(f, gains: [], preamp: 0, bandwidth: bandwidth, widthRate: widthRate, rate: rate)
                    out.append(20 * log10(shaped / flat))
                }
                call.resolve(["db": out])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    /// The RMS of a tone at `frequency` after an equalizer set up as Oni's (its last quarter second,
    /// once the filters have settled).
    private static func toneLevel(_ frequency: Double, gains: [Float], preamp: Float, bandwidth: Float?, widthRate: Double, rate: Double) throws -> Double {
        let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!
        let frames = AVAudioFrameCount(rate * 0.75)
        let tone = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        tone.frameLength = frames
        for i in 0..<Int(frames) { tone.floatChannelData![0][i] = 0.25 * Float(sin(2 * Double.pi * frequency * Double(i) / rate)) }
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        let eq = AVAudioUnitEQ(numberOfBands: bands.count)
        shape(eq, bandwidth: bandwidth, widthRate: widthRate)
        eq.globalGain = preamp
        for (i, band) in eq.bands.enumerated() { band.gain = i < gains.count ? gains[i] : 0 }
        eq.bypass = false
        engine.attach(player)
        engine.attach(eq)
        engine.connect(player, to: eq, format: format)
        engine.connect(eq, to: engine.mainMixerNode, format: format)
        try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
        try engine.start()
        player.scheduleBuffer(tone, at: nil)
        player.play()
        let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: 4096)!
        var samples: [Float] = []
        while samples.count < Int(frames) {
            guard try engine.renderOffline(4096, to: buffer) == .success else { break }
            let data = buffer.floatChannelData![0]
            samples.append(contentsOf: UnsafeBufferPointer(start: data, count: Int(buffer.frameLength)))
        }
        player.stop()
        engine.stop()
        let tail = samples.suffix(Int(rate * 0.25))
        return sqrt(tail.reduce(0.0) { $0 + Double($1 * $1) } / Double(max(1, tail.count)))
    }

    /// { bytesPerSecond } — for the simulator run: downloads held to a slow network's pace (0: off).
    @objc func testThrottle(_ call: CAPPluginCall) {
        PlayerPlugin.throttle = call.getDouble("bytesPerSecond") ?? 0
        call.resolve()
    }

    // MARK: clock and the system

    private func startTimer() {
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: away ? 1 : 0.25, repeats: true) { [weak self] _ in self?.tick() }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private func tick() {
        var data: [String: Any] = ["time": position, "duration": duration, "playing": playing, "waiting": playing && stalled]
        if let end = musicEnd { data["musicEnd"] = end }
        notifyListeners("time", data: data)
        findMusicEnd()
        if playing && fading == nil && tail == nil { watchOthers() }
    }

    /// The track's music end, looked for in the background once its file is whole (a track still
    /// arriving has no end to look at yet).
    private func findMusicEnd() {
        guard musicEnd == nil, !endSearch, let file = file, endOf == tracksOpened else { return }
        let track = tracksOpened
        if let fetch = stream, !fetch.state.done { return }
        let url = stream?.target ?? file.url
        endSearch = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let end = musicEndIn(url)
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.endSearch = false
                // Not readable: its file's end, once (not looked for again on every tick).
                if self.endOf == track { self.musicEnd = end ?? self.duration }
            }
        }
    }

    /// Whether another app played the last time the clock looked.
    private var othersPlaying = false
    private var fading: Timer?

    /// Another app's sound started over the music without taking it (Instagram's videos mix with
    /// others, so iOS says nothing and both played): the music fades out over a second and
    /// pauses, as the user expects when a video starts. Apps that take the sound (YouTube) are an
    /// interruption instead: iOS silences the music at once, before telling us, so no fade there.
    private func watchOthers() {
        let others = AVAudioSession.sharedInstance().isOtherAudioPlaying
        defer { othersPlaying = others }
        guard others, !othersPlaying else { return }
        let from = node.volume
        var step = 0
        let steps = 12
        fading = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] timer in
            guard let self = self else { return timer.invalidate() }
            step += 1
            self.node.volume = from * Float(max(0, steps - step)) / Float(steps)
            guard step >= steps else { return }
            timer.invalidate()
            self.fading = nil
            self.halt()
            self.node.volume = 1
        }
    }

    /// A call or another app took the sound: paused, and the page told (it shows paused).
    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        DispatchQueue.main.async { self.halt() }
    }

    /// Headphones pulled out: pause, as every music app does.
    @objc private func routeChanged(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        DispatchQueue.main.async { self.halt() }
    }

    /// The output changed under the engine (a route, a sample rate): restart it where it was.
    @objc private func configurationChanged(_ note: Notification) {
        DispatchQueue.main.async {
            self.endCross()
            let at = self.position
            let was = self.playing
            self.generation += 1
            self.node.stop()
            if let format = self.format { self.engine.connect(self.node, to: self.mix, fromBus: 0, toBus: self.active, format: format) }
            self.schedule(from: AVAudioFramePosition(at * (self.format?.sampleRate ?? 44100)))
            self.pausedAt = at
            if was, (try? self.engine.start()) != nil {
                if !self.stalled { self.node.play() }
            } else {
                self.playing = false
            }
            self.tick()
        }
    }
}

// The smart crossfade (src/player/silence.ts): where a track's music is, read from its file.

/// Quieter than this is silence: -50 dBFS.
private let silentLevel: Float = 0.00316

/// The loudest sample of a chunk, all channels (Accelerate: quick even where the build is not optimized).
private func peak(_ buffer: AVAudioPCMBuffer) -> Float {
    guard let data = buffer.floatChannelData else { return 0 }
    var top: Float = 0
    for c in 0..<Int(buffer.format.channelCount) {
        var m: Float = 0
        vDSP_maxmgv(data[c], 1, &m, vDSP_Length(buffer.frameLength))
        top = max(top, m)
    }
    return top
}

/// Reads `count` frames at `at` into `buffer`; false when nothing could be read.
private func readChunk(_ file: AVAudioFile, at: AVAudioFramePosition, count: AVAudioFrameCount, into buffer: AVAudioPCMBuffer) -> Bool {
    file.framePosition = at
    return (try? file.read(into: buffer, frameCount: count)) != nil && buffer.frameLength > 0
}

/// The frame of the first sound in [from, to) of a file, looked at chunk by chunk from the start.
private func firstSound(_ file: AVAudioFile, from: AVAudioFramePosition, to: AVAudioFramePosition) -> AVAudioFramePosition? {
    let chunk: AVAudioFrameCount = 4096
    guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: chunk) else { return nil }
    var at = from
    while at < to {
        guard readChunk(file, at: at, count: AVAudioFrameCount(min(AVAudioFramePosition(chunk), to - at)), into: buffer) else { return nil }
        if peak(buffer) > silentLevel, let data = buffer.floatChannelData {
            for i in 0..<Int(buffer.frameLength) {
                for c in 0..<Int(buffer.format.channelCount) where abs(data[c][i]) > silentLevel { return at + AVAudioFramePosition(i) }
            }
        }
        at += AVAudioFramePosition(buffer.frameLength)
    }
    return nil
}

/// The frame just after the last sound in [from, to) of a file, looked at chunk by chunk from the end
/// (a track's silence at its end is short: a few chunks are read, not the whole stretch).
private func lastSound(_ file: AVAudioFile, from: AVAudioFramePosition, to: AVAudioFramePosition) -> AVAudioFramePosition? {
    let chunk: AVAudioFrameCount = 8192
    guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: chunk) else { return nil }
    var end = to
    while end > from {
        let at = max(from, end - AVAudioFramePosition(chunk))
        guard readChunk(file, at: at, count: AVAudioFrameCount(end - at), into: buffer) else { return nil }
        if peak(buffer) > silentLevel, let data = buffer.floatChannelData {
            for i in stride(from: Int(buffer.frameLength) - 1, through: 0, by: -1) {
                for c in 0..<Int(buffer.format.channelCount) where abs(data[c][i]) > silentLevel { return at + AVAudioFramePosition(i) + 1 }
            }
        }
        end = at
    }
    return nil
}

/// Seconds into the file where its music ends (its last 30 s looked at); nil if it cannot be read.
private func musicEndIn(_ url: URL) -> Double? {
    guard let file = try? AVAudioFile(forReading: url) else { return nil }
    let rate = file.processingFormat.sampleRate
    let from = max(0, file.length - AVAudioFramePosition(30 * rate))
    return Double(lastSound(file, from: from, to: file.length) ?? from) / rate
}

/// Where to start a track in a crossfade: past its silence at the start (at least 0.25 s of it, at
/// most 8 s looked at); 0 when there is none, or it cannot be read.
private func leadIn(_ url: URL) -> Double {
    guard let file = try? AVAudioFile(forReading: url) else { return 0 }
    let rate = file.processingFormat.sampleRate
    let head = min(file.length, AVAudioFramePosition(8 * rate))
    guard let first = firstSound(file, from: 0, to: head) else { return 0 }
    let lead = Double(first) / rate
    return lead >= 0.25 ? lead : 0
}
