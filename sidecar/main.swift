import AppKit
import Foundation

/// Llammp sidecar — JSON bridge between the Electron app and Music.app.
///
/// Split of duties, established by measurement: distributed notifications carry state
/// changes, polling carries the position. Music.app emits NO progress notification at all
/// (verified over 5 minutes of continuous playback), so there is no event-based
/// alternative.

final class Sidecar {

    private let bridge = MusicBridge()
    private var positionTimer: Timer?

    /// `com.apple.Music.playerInfo` and `com.apple.iTunes.playerInfo` are both emitted for
    /// the SAME event, ~10 ms apart, with identical `userInfo`.
    private var lastNotificationKey: String?
    private var lastNotificationAt: Date = .distantPast
    private static let dedupWindow: TimeInterval = 0.1

    private var lastPlayerState: String = "stopped"
    private var lastTrackId: String?
    private var announcedUnavailable = false

    // MARK: - Startup

    func start() {
        observeMusicNotifications()
        observeWorkspace()
        readCommands()

        Emitter.log("info", "sidecar started")

        // Authorization is checked, and reported, before anything is asked of Music.app.
        // Any scripting call made while consent is still pending blocks silently until
        // the user answers a dialog they may never see.
        emitPermission()

        if !bridge.isMusicRunning {
            emitUnavailable(reason: "not_running")
        } else if bridge.appleEventsPermission() == "granted" {
            emitFullState(includeQueue: true)
        } else {
            emitUnavailable(reason: "no_permission")
        }

        startPositionTimer()
    }

    private func emitPermission() {
        Emitter.emit(["type": "permission", "appleEvents": bridge.appleEventsPermission()])
    }

    // MARK: - Music.app notifications

    private func observeMusicNotifications() {
        let center = DistributedNotificationCenter.default()
        for name in ["com.apple.Music.playerInfo", "com.apple.iTunes.playerInfo"] {
            center.addObserver(
                forName: Notification.Name(name),
                object: nil,
                queue: .main
            ) { [weak self] note in
                self?.handlePlayerInfo(note)
            }
        }
    }

    private func handlePlayerInfo(_ note: Notification) {
        let info = note.userInfo ?? [:]

        // Dedup key: (track, state). Two identical notifications within 100 ms are the
        // same event broadcast twice.
        var trackKey = ""
        if let pid = info["PersistentID"] as? NSNumber {
            trackKey = MusicBridge.hexPersistentId(from: pid)
        } else if let name = info["Name"] as? String {
            trackKey = name
        }
        let stateKey = (info["Player State"] as? String) ?? ""
        let key = "\(trackKey)|\(stateKey)"

        let now = Date()
        if key == lastNotificationKey, now.timeIntervalSince(lastNotificationAt) < Self.dedupWindow {
            return
        }
        lastNotificationKey = key
        lastNotificationAt = now

        let trackChanged = !trackKey.isEmpty && trackKey != lastTrackId
        emitFullState(includeQueue: trackChanged)
    }

    /// Music.app can be launched or quit at any time; the UI must fall back gracefully
    /// without showing an error.
    private func observeWorkspace() {
        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(forName: NSWorkspace.didLaunchApplicationNotification,
                           object: nil, queue: .main) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  app.bundleIdentifier == MusicBridge.musicBundleId else { return }
            self?.announcedUnavailable = false
            self?.emitFullState(includeQueue: true)
        }
        center.addObserver(forName: NSWorkspace.didTerminateApplicationNotification,
                           object: nil, queue: .main) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  app.bundleIdentifier == MusicBridge.musicBundleId else { return }
            self?.emitUnavailable(reason: "not_running")
        }
    }

    // MARK: - Emission

    private func emitUnavailable(reason: String) {
        guard !announcedUnavailable else { return }
        announcedUnavailable = true
        lastPlayerState = "stopped"
        lastTrackId = nil
        Emitter.emit(["type": "unavailable", "reason": reason])
    }

    private func emitFullState(includeQueue: Bool) {
        guard bridge.isMusicRunning else {
            emitUnavailable(reason: "not_running")
            return
        }
        announcedUnavailable = false

        if let state = bridge.readState() {
            lastPlayerState = state.playerState
            Emitter.emit([
                "type": "state",
                "playerState": state.playerState,
                "volume": state.volume,
                "shuffle": state.shuffle,
                "repeat": state.repeatMode,
                "muted": state.muted,
            ])
        }

        if let track = bridge.readTrack() {
            lastTrackId = track.persistentId
            var payload: [String: Any] = [
                "type": "track",
                "persistentId": track.persistentId,
                "name": track.name,
                "artist": track.artist,
                "album": track.album,
                "duration": track.duration,
                "kind": track.kind,
                "streaming": track.isStreaming,
            ]
            // Absent on `URL track`: the key is omitted rather than zeroed, so the UI
            // leaves the field blank instead of showing "0 kbps".
            if let br = track.bitRate { payload["bitRate"] = br }
            if let sr = track.sampleRate { payload["sampleRate"] = sr }
            Emitter.emit(payload)
        } else {
            lastTrackId = nil
        }

        if includeQueue {
            emitQueue()
        }
    }

    private func emitQueue() {
        guard let result = bridge.readQueue() else { return }
        switch result {
        case .unavailable(let reason):
            Emitter.emit(["type": "queue", "available": false, "reason": reason])
        case .available(let name, let id, let count, let index, let start, let shuffle, let tracks):
            Emitter.emit([
                "type": "queue",
                "available": true,
                "playlistName": name,
                "playlistPersistentId": id,
                "trackCount": count,
                "currentIndex": index,
                "windowStart": start,
                "shuffle": shuffle,
                // With shuffle on, indices reflect playlist order, never playback order
                // (measured). The UI must not advertise what plays next.
                "orderIsPlayback": !shuffle,
                "tracks": tracks.map { [
                    "index": $0.index,
                    "name": $0.name,
                    "artist": $0.artist,
                    "duration": $0.duration,
                ] },
            ])
        }
    }

    // MARK: - Position polling

    private func startPositionTimer() {
        positionTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let self else { return }
            // Ask for nothing while stopped: useless, and it would wake Music.app.
            guard self.lastPlayerState == "playing", self.bridge.isMusicRunning else { return }
            guard let pos = self.bridge.readPosition() else { return }
            Emitter.emit(["type": "position", "position": pos])
        }
        RunLoop.main.add(positionTimer!, forMode: .common)
    }

    // MARK: - Incoming commands

    private func readCommands() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            while let line = readLine(strippingNewline: true) {
                guard !line.isEmpty else { continue }
                DispatchQueue.main.async { self?.handleCommand(line) }
            }
            // stdin closed: the host app is gone, so is any reason to keep running.
            DispatchQueue.main.async { NSApplication.shared.terminate(nil) }
        }
    }

    private func handleCommand(_ line: String) {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cmd = obj["cmd"] as? String else {
            Emitter.log("warn", "unreadable command")
            return
        }

        // Authorization commands are answered even when Music.app is closed or consent is
        // still pending: they are precisely what the onboarding screen uses to get out of
        // that state.
        switch cmd {
        case "checkPermission":
            emitPermission()
            if bridge.hasAppleEventsPermission && bridge.isMusicRunning {
                emitFullState(includeQueue: true)
            }
            return
        case "requestPermission":
            // Blocks until the user answers, which is acceptable here: it is a direct
            // response to them clicking "Allow".
            let result = bridge.requestAppleEventsPermission()
            Emitter.emit(["type": "permission", "appleEvents": result])
            if result == "granted" { emitFullState(includeQueue: true) }
            return
        default:
            break
        }

        guard bridge.isMusicRunning else {
            emitUnavailable(reason: "not_running")
            return
        }
        guard bridge.hasAppleEventsPermission else {
            emitUnavailable(reason: "no_permission")
            return
        }

        switch cmd {
        case "play":      bridge.run(Scripts.play, cacheKey: "play")
        case "pause":     bridge.run(Scripts.pause, cacheKey: "pause")
        case "playpause": bridge.run(Scripts.playpause, cacheKey: "playpause")
        case "stop":      bridge.run(Scripts.stop, cacheKey: "stop")
        case "next":      bridge.run(Scripts.next, cacheKey: "next")
        case "previous":  bridge.run(Scripts.previous, cacheKey: "previous")

        case "seek":
            guard let p = obj["position"] as? Double else { return }
            bridge.run(Scripts.seek(p), cacheKey: nil)
            Emitter.emit(["type": "position", "position": p])
            return

        case "setVolume":
            guard let v = obj["volume"] as? Int else { return }
            bridge.run(Scripts.setVolume(v), cacheKey: nil)

        case "setMute":
            guard let e = obj["enabled"] as? Bool else { return }
            bridge.run(Scripts.setMute(e), cacheKey: nil)

        case "setShuffle":
            guard let e = obj["enabled"] as? Bool else { return }
            bridge.run(Scripts.setShuffle(e), cacheKey: nil)

        case "setRepeat":
            guard let m = obj["mode"] as? String else { return }
            bridge.run(Scripts.setRepeat(m), cacheKey: nil)

        case "playTrackAt":
            guard let pid = obj["playlistPersistentId"] as? String,
                  let idx = obj["index"] as? Int else { return }
            bridge.run(Scripts.playTrackAt(playlistPersistentId: pid, index: idx), cacheKey: nil)

        case "getArtwork":
            emitArtwork(requestedId: obj["persistentId"] as? String)
            return

        case "refresh":
            emitFullState(includeQueue: true)
            return

        default:
            Emitter.log("warn", "unknown command: \(cmd)")
            return
        }

        // Every command changes state: re-reading it immediately keeps the UI in sync
        // without waiting for the notification.
        emitFullState(includeQueue: false)
    }

    private func emitArtwork(requestedId: String?) {
        guard let data = bridge.readArtwork() else {
            Emitter.emit(["type": "artwork", "persistentId": requestedId ?? "", "data": ""])
            return
        }
        Emitter.emit([
            "type": "artwork",
            "persistentId": requestedId ?? lastTrackId ?? "",
            "format": "image/jpeg",
            "data": data.base64EncodedString(),
        ])
    }
}

// An `NSApplication` is required: DistributedNotificationCenter and NSWorkspace both need
// a live AppKit run loop. `.accessory` keeps the process out of the Dock.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let sidecar = Sidecar()
sidecar.start()

app.run()
