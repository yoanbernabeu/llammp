import Foundation

/// AppleScript sources, compiled once at startup (see `MusicBridge`).
///
/// Measured: a pre-compiled `NSAppleScript` costs 0.75 ms for the player position and
/// 1.75 ms for full state, against ~50 ms for an `osascript` that pays process startup
/// every time.
///
/// Return values use ASCII 31 (unit separator) between fields and ASCII 30 (record
/// separator) between records. Neither byte ever appears in a track title or artist
/// name, unlike `|` or `;`, so nothing needs escaping.
enum Scripts {

    static let fieldSep = "\u{001F}"
    static let recordSep = "\u{001E}"

    /// Playlist window size. Measured: 200 tracks take 0.19 s, while enumerating a
    /// 6051-track playlist takes 10.6 s — hence the window.
    static let queueWindow = 200

    // MARK: - Reads

    /// Short identifiers collide with Music.app's terminology inside a `tell` block:
    /// `st` raises "expected expression but found \"st\"" (-2741), just as `window`
    /// raises -10003. Use explicit names.
    static let state = """
    set sep to (ASCII character 31)
    tell application "Music"
        set curState to player state as text
        set curVolume to sound volume
        set shufOn to shuffle enabled as text
        set repMode to song repeat as text
        set muteOn to mute as text
        return curState & sep & curVolume & sep & shufOn & sep & repMode & sep & muteOn
    end tell
    """

    /// `kind` tells the three track classes apart. Every measurement must be qualified by
    /// it: a property missing on a `URL track` is present on a `shared track`.
    static let track = """
    set sep to (ASCII character 31)
    tell application "Music"
        try
            set t to current track
        on error
            return "NOTRACK"
        end try
        set cls to (class of t) as text
        set nm to name of t
        set ar to ""
        set al to ""
        set dur to 0
        set br to ""
        set sr to ""
        set pid to ""
        try
            set ar to artist of t
        end try
        try
            set al to album of t
        end try
        try
            set dur to duration of t
        end try
        -- On `URL track` (streaming) both bit rate and sample rate are `missing value`:
        -- the kbps/kHz fields stay empty rather than showing invented numbers.
        try
            set br to (bit rate of t) as text
        end try
        try
            set sr to (sample rate of t) as text
        end try
        try
            set pid to persistent ID of t
        end try
        return cls & sep & nm & sep & ar & sep & al & sep & dur & sep & br & sep & sr & sep & pid
    end tell
    """

    static let position = """
    tell application "Music" to return player position
    """

    /// Returns "NOTRACK", or "UNAVAILABLE" plus an error code (typically -1731 on a
    /// streaming source, which is a state and not a failure), or "OK" plus the window.
    static let queue = """
    set sep to (ASCII character 31)
    set rsep to (ASCII character 30)
    set maxRows to \(queueWindow)

    tell application "Music"
        set cp to missing value
        try
            set cp to current playlist
        on error errMsg number errNum
            return "UNAVAILABLE" & sep & errNum
        end try

        set n to count of tracks of cp
        if n is 0 then return "UNAVAILABLE" & sep & "0"

        set plName to name of cp
        set plId to ""
        try
            set plId to persistent ID of cp
        end try
        set sh to shuffle enabled as text

        set idx to 0
        try
            set idx to index of current track
        end try

        -- Window centered on the current track.
        set lo to 1
        if idx > 0 and n > maxRows then
            set lo to idx - (maxRows div 2)
            if lo < 1 then set lo to 1
        end if
        set hi to lo + maxRows - 1
        if hi > n then set hi to n

        -- Batched reads: one request per property, not one per track. This is the
        -- difference between 0.19 s and several minutes.
        set nms to name of tracks lo thru hi of cp
        set arts to artist of tracks lo thru hi of cp
        set durs to duration of tracks lo thru hi of cp

        set out to "OK" & sep & plName & sep & plId & sep & n & sep & idx & sep & lo & sep & sh
        repeat with i from 1 to count of nms
            set out to out & rsep & (item i of nms) & sep & (item i of arts) & sep & (item i of durs)
        end repeat
        return out
    end tell
    """

    /// Artwork is often assumed expensive; measured at 0.16 s including the whole script.
    /// Raw bytes are returned directly through `NSAppleEventDescriptor.data`, with no
    /// intermediate encoding on the AppleScript side.
    static let artwork = """
    tell application "Music"
        try
            set t to current track
            if (count of artworks of t) is 0 then return missing value
            return raw data of artwork 1 of t
        on error
            return missing value
        end try
    end tell
    """

    // MARK: - Parameterless commands

    static let play = "tell application \"Music\" to play"
    static let pause = "tell application \"Music\" to pause"
    static let playpause = "tell application \"Music\" to playpause"
    static let stop = "tell application \"Music\" to stop"
    static let next = "tell application \"Music\" to next track"
    static let previous = "tell application \"Music\" to previous track"

    // MARK: - Parameterized commands

    /// Built on the fly: compiling costs ~1 ms and these commands are rare compared to
    /// polling. Values are numeric or escaped, never concatenated from free input.
    static func seek(_ seconds: Double) -> String {
        "tell application \"Music\" to set player position to \(fmt(seconds))"
    }

    static func setVolume(_ volume: Int) -> String {
        "tell application \"Music\" to set sound volume to \(clamp(volume, 0, 100))"
    }

    static func setMute(_ enabled: Bool) -> String {
        "tell application \"Music\" to set mute to \(enabled)"
    }

    static func setShuffle(_ enabled: Bool) -> String {
        "tell application \"Music\" to set shuffle enabled to \(enabled)"
    }

    /// `song repeat` accepts off / one / all.
    static func setRepeat(_ mode: String) -> String {
        let allowed = ["off", "one", "all"]
        let safe = allowed.contains(mode) ? mode : "off"
        return "tell application \"Music\" to set song repeat to \(safe)"
    }

    /// The Winamp double-click equivalent. `play track i of playlist …` is undocumented
    /// but works.
    static func playTrackAt(playlistPersistentId: String, index: Int) -> String {
        let pid = escape(playlistPersistentId)
        return """
        tell application "Music"
            set target to missing value
            repeat with p in playlists
                if (persistent ID of p) is "\(pid)" then
                    set target to p
                    exit repeat
                end if
            end repeat
            if target is missing value then return "NOPLAYLIST"
            play track \(max(1, index)) of target
            return "OK"
        end tell
        """
    }

    // MARK: - Helpers

    /// Force a decimal point. AppleScript writes numbers using the system locale but
    /// accepts a point on input; without this a French machine would emit
    /// `set player position to 12,5`.
    private static func fmt(_ value: Double) -> String {
        String(format: "%.3f", value)
    }

    private static func clamp(_ v: Int, _ lo: Int, _ hi: Int) -> Int {
        min(max(v, lo), hi)
    }

    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
    }
}
