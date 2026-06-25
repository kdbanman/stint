import Foundation
import StintKit

/// Process-level concerns shared by the `tt` subcommands: where the database
/// lives, what "now" is, and how durations/instants render for humans.
enum Environment {
    /// Resolves the database path: `TT_DB` if set, else the platform default
    /// (prd.html §13). The directory is created lazily by `Store`.
    static func databasePath() -> String {
        if let override = ProcessInfo.processInfo.environment["TT_DB"], !override.isEmpty {
            return override
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        #if os(macOS)
        return home
            .appendingPathComponent("Library/Application Support/Stint/timetracker.sqlite")
            .path
        #else
        let base = ProcessInfo.processInfo.environment["XDG_DATA_HOME"].map(URL.init(fileURLWithPath:))
            ?? home.appendingPathComponent(".local/share")
        return base.appendingPathComponent("stint/timetracker.sqlite").path
        #endif
    }

    /// "Now", honoring the `TT_NOW` testing seam (an ISO-8601 UTC instant) so
    /// the golden suite can pin the clock; otherwise the wall clock.
    static func now() -> Date {
        if let raw = ProcessInfo.processInfo.environment["TT_NOW"],
           let parsed = ISO8601.date(from: raw) {
            return parsed
        }
        return Date()
    }

    static func openStore() throws -> Store {
        try Store(path: databasePath())
    }
}

/// Human-facing formatting. Kept here so the CLI's exact output — which the
/// golden tests pin byte-for-byte — lives in one place.
enum Format {
    /// `HH:MM:SS`, hours unbounded (e.g. `01:30:00`, `123:04:05`).
    static func clock(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded(.down))
        return String(format: "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }

    /// Compact spoken duration: `1h 30m`, `30m`, `45s`.
    static func duration(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        if h > 0 { return "\(h)h \(m)m" }
        if m > 0 { return "\(m)m" }
        return "\(s)s"
    }
}

/// `--json` payloads. Shapes match the scripting contract in acceptance.html §08.
struct StatusPayload: Encodable {
    let running: Bool
    let entry: EntryPayload?
}

struct EntryPayload: Encodable {
    let id: Int64
    let description: String?
    let start_utc: String
    let elapsed_seconds: Int
    let billable: Bool
}

enum JSON {
    static func string<T: Encodable>(_ value: T) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
        let data = (try? encoder.encode(value)) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }
}

/// Writes a line to stderr (notes, warnings, refusals).
func printError(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}
