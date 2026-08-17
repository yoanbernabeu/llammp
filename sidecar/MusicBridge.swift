import AppKit
import Foundation

/// Bridge to Music.app: compiles the scripts once, runs them, parses the results.
///
/// Everything runs on the main thread — `NSAppleScript` is not thread-safe — so the
/// stdin reader always hops back to `DispatchQueue.main`.
final class MusicBridge {

    static let musicBundleId = "com.apple.Music"

    private var compiled: [String: NSAppleScript] = [:]

    // MARK: - Availability

    /// **Never query Music.app without this guard.** A `tell application "Music"` LAUNCHES
    /// the app when it is closed, which is unacceptable for a remote control.
    var isMusicRunning: Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: Self.musicBundleId).isEmpty
    }

    // MARK: - Execution

    /// Runs a pre-compiled script, compiling it on first use.
    @discardableResult
    func run(_ source: String, cacheKey: String? = nil) -> NSAppleEventDescriptor? {
        guard isMusicRunning else { return nil }

        let key = cacheKey ?? source
        let script: NSAppleScript
        if let cached = compiled[key] {
            script = cached
        } else {
            guard let fresh = NSAppleScript(source: source) else {
                Emitter.log("error", "cannot compile script: \(key)")
                return nil
            }
            var compileError: NSDictionary?
            fresh.compileAndReturnError(&compileError)
            if let e = compileError {
                Emitter.log("error", "script compilation failed (\(key)): \(e)")
                return nil
            }
            compiled[key] = fresh
            script = fresh
        }

        var runError: NSDictionary?
        let result = script.executeAndReturnError(&runError)
        if let e = runError {
            let code = (e[NSAppleScript.errorNumber] as? Int) ?? 0
            // -600 / -609: Music.app vanished between the guard and the call.
            if code == -600 || code == -609 {
                return nil
            }
            // -1743: Apple Events permission denied, or not granted yet. That is a state
            // worth showing, not a failure to swallow.
            if code == -1743 {
                Emitter.emit(["type": "unavailable", "reason": "no_permission"])
                return nil
            }
            Emitter.log("warn", "script execution failed (\(key)) code=\(code)")
            return nil
        }
        return result
    }

    private func runString(_ source: String, cacheKey: String) -> String? {
        run(source, cacheKey: cacheKey)?.stringValue
    }

    // MARK: - Reads

    struct State {
        var playerState: String
        var volume: Int
        var shuffle: Bool
        var repeatMode: String
        var muted: Bool
    }

    func readState() -> State? {
        guard let raw = runString(Scripts.state, cacheKey: "state") else { return nil }
        let f = raw.components(separatedBy: Scripts.fieldSep)
        guard f.count >= 5 else { return nil }
        return State(
            playerState: normalizePlayerState(f[0]),
            volume: Int(f[1]) ?? 0,
            shuffle: f[2] == "true",
            repeatMode: f[3],
            muted: f[4] == "true"
        )
    }

    struct Track {
        var kind: String
        var name: String
        var artist: String
        var album: String
        var duration: Double
        var bitRate: Int?
        var sampleRate: Int?
        var persistentId: String
        var isStreaming: Bool
    }

    func readTrack() -> Track? {
        guard let raw = runString(Scripts.track, cacheKey: "track") else { return nil }
        if raw == "NOTRACK" { return nil }
        let f = raw.components(separatedBy: Scripts.fieldSep)
        guard f.count >= 8 else { return nil }

        let kind = normalizeKind(f[0])
        return Track(
            kind: kind,
            name: f[1],
            artist: f[2],
            album: f[3],
            duration: Self.parseNumber(f[4]) ?? 0,
            bitRate: Self.parseInt(f[5]),
            sampleRate: Self.parseInt(f[6]),
            persistentId: f[7],
            isStreaming: kind == "url"
        )
    }

    func readPosition() -> Double? {
        guard let desc = run(Scripts.position, cacheKey: "position") else { return nil }
        // The descriptor carries a real number: reading it as a Double avoids going
        // through text, and therefore avoids the decimal-comma problem entirely.
        if desc.descriptorType == typeIEEE64BitFloatingPoint || desc.doubleValue != 0 {
            return desc.doubleValue
        }
        return Self.parseNumber(desc.stringValue ?? "")
    }

    struct QueueTrack {
        var index: Int
        var name: String
        var artist: String
        var duration: Double
    }

    enum QueueResult {
        case available(playlistName: String, playlistId: String, trackCount: Int,
                       currentIndex: Int, windowStart: Int, shuffle: Bool, tracks: [QueueTrack])
        case unavailable(reason: String)
    }

    func readQueue() -> QueueResult? {
        guard let raw = runString(Scripts.queue, cacheKey: "queue") else { return nil }

        let records = raw.components(separatedBy: Scripts.recordSep)
        guard let header = records.first else { return nil }
        let h = header.components(separatedBy: Scripts.fieldSep)

        if h.first == "UNAVAILABLE" {
            let code = h.count > 1 ? h[1] : ""
            // -1731 "unknown object type": playback comes from the streaming catalog or
            // the radio. A documented state, not a failure.
            return .unavailable(reason: code == "-1731" ? "streaming_source" : "no_playlist")
        }
        guard h.first == "OK", h.count >= 7 else { return nil }

        var tracks: [QueueTrack] = []
        let windowStart = Int(h[5]) ?? 1
        for (offset, record) in records.dropFirst().enumerated() {
            let t = record.components(separatedBy: Scripts.fieldSep)
            guard t.count >= 3 else { continue }
            tracks.append(QueueTrack(
                index: windowStart + offset,
                name: t[0],
                artist: t[1],
                duration: Self.parseNumber(t[2]) ?? 0
            ))
        }

        return .available(
            playlistName: h[1],
            playlistId: h[2],
            trackCount: Int(h[3]) ?? tracks.count,
            currentIndex: Int(h[4]) ?? 0,
            windowStart: windowStart,
            shuffle: h[6] == "true",
            tracks: tracks
        )
    }

    func readArtwork() -> Data? {
        guard let desc = run(Scripts.artwork, cacheKey: "artwork") else { return nil }
        guard let data = desc.data as Data?, !data.isEmpty else { return nil }
        return data
    }

    // MARK: - Normalization

    /// `player state` can be playing / paused / stopped / fast forwarding / rewinding.
    /// The last two collapse to `playing`: the Winamp UI has no state for them.
    private func normalizePlayerState(_ raw: String) -> String {
        switch raw {
        case "playing", "fast forwarding", "rewinding": return "playing"
        case "paused": return "paused"
        default: return "stopped"
        }
    }

    private func normalizeKind(_ raw: String) -> String {
        if raw.contains("URL") { return "url" }
        if raw.contains("shared") { return "shared" }
        if raw.contains("file") { return "file" }
        return raw
    }

    /// AppleScript formats reals using the system locale: on a French machine `duration`
    /// comes out as `245,466995`. A plain `Double(...)` would return nil, silently
    /// becoming 0 — hence the comma normalization.
    static func parseNumber(_ raw: String) -> Double? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty || trimmed == "missing value" { return nil }
        return Double(trimmed.replacingOccurrences(of: ",", with: "."))
    }

    /// `bit rate` and `sample rate` are `missing value` on `URL track`: return nil and let
    /// the UI leave the field empty. Never invent a value.
    static func parseInt(_ raw: String) -> Int? {
        guard let d = parseNumber(raw) else { return nil }
        let i = Int(d)
        return i > 0 ? i : nil
    }

    /// The notification carries a signed `NSNumber` (-9187149409109156126) where
    /// ScriptingBridge returns a hex string (8080B049BB9BDEE2). Without this conversion no
    /// `persistentId` cache would ever hit.
    static func hexPersistentId(from number: NSNumber) -> String {
        String(format: "%016llX", UInt64(bitPattern: number.int64Value))
    }
}
