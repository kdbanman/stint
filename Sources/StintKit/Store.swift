import Foundation
import GRDB

/// The shared core's single entry point to persistent state. Both `tt` and the
/// menu-bar app talk to one SQLite file through a `Store`; neither holds a
/// privileged copy of the logic (prd.html §04).
///
/// This slice implements the running-timer keystone — `start`, `stop`,
/// `status` — and enforces the cardinal invariant **at most one open entry**
/// both transactionally (close-then-open in one write) and structurally (a
/// unique index, below), so it holds no matter which surface writes.
public final class Store {
    private let writer: any DatabaseWriter

    /// Opens the on-disk database in WAL mode (concurrent readers, single
    /// writer) at `path`, creating the parent directory and schema if needed.
    public convenience init(path: String) throws {
        let url = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        // DatabasePool puts the file in WAL mode, which is what lets the running
        // app and a `tt` invocation read/write the same file cooperatively.
        let pool = try DatabasePool(path: path, configuration: Self.configuration)
        try self.init(writer: pool)
    }

    /// An ephemeral in-memory database — used by the test suite.
    public static func inMemory() throws -> Store {
        let queue = try DatabaseQueue(configuration: Self.configuration)
        return try Store(writer: queue)
    }

    private init(writer: any DatabaseWriter) throws {
        self.writer = writer
        try migrate()
    }

    private static var configuration: Configuration {
        var config = Configuration()
        // Cooperate with a concurrent writer (the other surface) instead of
        // failing fast with SQLITE_BUSY, and take the write lock up front so a
        // close-then-open transition can't deadlock on a lock upgrade.
        config.busyMode = .timeout(5)
        config.defaultTransactionKind = .immediate
        return config
    }

    // MARK: - Schema

    private func migrate() throws {
        try writer.write { db in
            // `open_marker` is a stored generated column that is 1 exactly while
            // the entry is open and NULL once closed. A UNIQUE index over it lets
            // SQLite itself guarantee at most one open entry: NULLs are distinct
            // (any number of closed entries), but only one row may carry the 1.
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS entry (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    description TEXT,
                    start_utc   TEXT NOT NULL,
                    end_utc     TEXT,
                    billable    INTEGER NOT NULL DEFAULT 1,
                    open_marker INTEGER GENERATED ALWAYS AS
                                (CASE WHEN end_utc IS NULL THEN 1 ELSE NULL END) STORED
                );
                """)
            try db.execute(sql: """
                CREATE UNIQUE INDEX IF NOT EXISTS one_open_entry ON entry(open_marker);
                """)
        }
    }

    // MARK: - Timer transitions

    /// Starts a new entry, atomically closing any currently open one first
    /// (prd.html §05 R1, §16 "start while running"). The whole transition is a
    /// single immediate transaction, so "start while running" is safe no matter
    /// which surface triggers it.
    ///
    /// - Returns: the newly opened entry.
    @discardableResult
    public func start(
        description: String? = nil,
        billable: Bool = true,
        at instant: Date = Date()
    ) throws -> Entry {
        let startString = ISO8601.string(from: instant)
        return try writer.write { db in
            // Close the open entry, if any, at this instant.
            try db.execute(
                sql: "UPDATE entry SET end_utc = ? WHERE end_utc IS NULL",
                arguments: [startString]
            )
            try db.execute(
                sql: """
                    INSERT INTO entry (description, start_utc, end_utc, billable)
                    VALUES (?, ?, NULL, ?)
                    """,
                arguments: [description, startString, billable]
            )
            let id = db.lastInsertedRowID
            // Round-trip the start through storage so the returned value matches
            // exactly what a subsequent read will see (whole-second precision).
            return Entry(
                id: id,
                description: description,
                start: ISO8601.date(from: startString)!,
                end: nil,
                billable: billable
            )
        }
    }

    /// Stops the open entry by setting its `end`, if one is running.
    ///
    /// - Returns: the entry that was stopped, or `nil` if nothing was running.
    @discardableResult
    public func stop(at instant: Date = Date()) throws -> Entry? {
        let endString = ISO8601.string(from: instant)
        return try writer.write { db -> Entry? in
            guard let row = try Row.fetchOne(db, sql: "SELECT * FROM entry WHERE end_utc IS NULL")
            else { return nil }
            var entry = Entry(row: row)
            try db.execute(
                sql: "UPDATE entry SET end_utc = ? WHERE id = ?",
                arguments: [endString, entry.id]
            )
            entry.end = ISO8601.date(from: endString)
            return entry
        }
    }

    // MARK: - Reads

    /// The currently open entry, or `nil` if nothing is running.
    public func openEntry() throws -> Entry? {
        try writer.read { db in
            try Row.fetchOne(db, sql: "SELECT * FROM entry WHERE end_utc IS NULL")
                .map(Entry.init(row:))
        }
    }

    /// Count of open entries — should never exceed 1. Used by the invariant
    /// tests to assert the keystone holds.
    public func openEntryCount() throws -> Int {
        try writer.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM entry WHERE end_utc IS NULL") ?? 0
        }
    }

    /// All entries, most recent start first. Small helper for tests/inspection.
    public func allEntries() throws -> [Entry] {
        try writer.read { db in
            try Row.fetchAll(db, sql: "SELECT * FROM entry ORDER BY start_utc DESC, id DESC")
                .map(Entry.init(row:))
        }
    }

    // MARK: - Test support

    /// Attempts to insert a second open entry while bypassing `start`'s
    /// close-then-open transition. The structural invariant (the `one_open_entry`
    /// unique index) must reject it. Internal — reached only via `@testable`.
    func attemptRawOpenInsert(at instant: Date) throws {
        try writer.write { db in
            try db.execute(
                sql: """
                    INSERT INTO entry (description, start_utc, end_utc, billable)
                    VALUES ('raw', ?, NULL, 1)
                    """,
                arguments: [ISO8601.string(from: instant)]
            )
        }
    }
}
