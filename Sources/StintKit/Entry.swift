import Foundation
import GRDB

/// A *time entry* — one bounded spell of tracked work (the product's "stint").
///
/// The conceptual keystone (concept.html §02, prd.html §03): **a running timer
/// is simply the one entry whose `end` is still empty.** "Running" is a row
/// state, not a separate object, and elapsed time is *derived* (`now − start`),
/// never stored or incremented.
public struct Entry: Equatable, Sendable {
    public var id: Int64
    public var description: String?
    /// Start instant (UTC).
    public var start: Date
    /// End instant (UTC), or `nil` while the entry is open/running.
    public var end: Date?
    public var billable: Bool

    public init(id: Int64, description: String?, start: Date, end: Date?, billable: Bool) {
        self.id = id
        self.description = description
        self.start = start
        self.end = end
        self.billable = billable
    }

    /// True while this is the running timer (its `end` is empty).
    public var isOpen: Bool { end == nil }

    /// Derived elapsed time. For a closed entry this is `end − start`; for the
    /// open entry it is `now − start`, computed by whoever is looking. Clamped
    /// to be non-negative so a backdated edit can never produce negative time.
    public func elapsed(asOf now: Date) -> TimeInterval {
        max(0, (end ?? now).timeIntervalSince(start))
    }
}

extension Entry {
    /// Maps a database row (`SELECT * FROM entry`) onto an `Entry`. Stored
    /// timestamps are always well-formed ISO-8601, so parsing them is safe.
    init(row: Row) {
        self.id = row["id"]
        self.description = row["description"]
        let startString: String = row["start_utc"]
        self.start = ISO8601.date(from: startString)!
        if let endString: String = row["end_utc"] {
            self.end = ISO8601.date(from: endString)
        } else {
            self.end = nil
        }
        self.billable = row["billable"]
    }
}
