import Foundation

/// Sidecar output: one JSON object per line on stdout.
///
/// Every write goes through a serial queue. The position timer, the distributed
/// notifications and command replies all write from different contexts, and two
/// interleaved lines would break parsing on the app side.
enum Emitter {
    private static let queue = DispatchQueue(label: "llammp.emitter")

    static func emit(_ payload: [String: Any]) {
        queue.async {
            guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
                  var line = String(data: data, encoding: .utf8) else {
                logRaw(level: "error", message: "JSON serialization failed")
                return
            }
            line.append("\n")
            FileHandle.standardOutput.write(Data(line.utf8))
        }
    }

    static func log(_ level: String, _ message: String) {
        emit(["type": "log", "level": level, "message": message])
    }

    /// Last resort: bypasses the serialization that just failed.
    private static func logRaw(level: String, message: String) {
        let line = "{\"type\":\"log\",\"level\":\"\(level)\",\"message\":\"\(message)\"}\n"
        FileHandle.standardOutput.write(Data(line.utf8))
    }
}
