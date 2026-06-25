import Foundation

/// Canonical conversion between `Date` and the ISO-8601 UTC strings stored in
/// the database (prd.html §13: `start_utc`/`end_utc` are "ISO-8601 UTC" TEXT).
///
/// Stint stores instants to the second. Times are always persisted in UTC and
/// rendered in the local zone elsewhere, which keeps durations DST-safe (they
/// are pure UTC arithmetic).
public enum ISO8601 {
    private static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime] // e.g. 2026-06-24T09:00:00Z
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    /// Formats an instant as an ISO-8601 UTC string, truncated to the second.
    public static func string(from date: Date) -> String {
        formatter.string(from: date)
    }

    /// Parses an ISO-8601 UTC string back into an instant, or `nil` if malformed.
    public static func date(from string: String) -> Date? {
        formatter.date(from: string)
    }
}
