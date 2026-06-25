import Foundation

/// The shared core's single entry point to persistent state. Both `tt` and the
/// menu-bar app talk to one SQLite file through a `Store`; neither holds a
/// privileged copy of the logic (prd.html §04).
///
/// This slice implements the running-timer keystone — `start`, `stop`,
/// `status` — and enforces the cardinal invariant **at most one open entry**
/// both transactionally (close-then-open in one immediate transaction) and
/// structurally (a unique index, below), so it holds no matter which surface
/// writes.
public final class Store {
    private let connection: Connection

    /// Columns selected by `entrySelect`, in order, mapped by `readEntry`.
    private static let entrySelect = "SELECT id, description, start_utc, end_utc, billable FROM entry"

    /// Opens the on-disk database in WAL mode (concurrent readers, single
    /// writer) at `path`, creating the parent directory and schema if needed.
    public convenience init(path: String) throws {
        let url = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try self.init(connection: Connection(path: path), wal: true)
    }

    /// An ephemeral in-memory database — used by the test suite.
    public static func inMemory() throws -> Store {
        try Store(connection: Connection(path: ":memory:"), wal: false)
    }

    private init(connection: Connection, wal: Bool) throws {
        self.connection = connection
        if wal {
            // WAL is what lets the running app and a `tt` invocation read/write
            // the same file cooperatively.
            try connection.execute("PRAGMA journal_mode = WAL;")
        }
        try migrate()
    }

    // MARK: - Schema

    private func migrate() throws {
        // `open_marker` is a stored generated column that is 1 exactly while the
        // entry is open and NULL once closed. A UNIQUE index over it lets SQLite
        // itself guarantee at most one open entry: NULLs are distinct (any
        // number of closed entries), but only one row may carry the 1.
        try connection.execute("""
            CREATE TABLE IF NOT EXISTS entry (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT,
                start_utc   TEXT NOT NULL,
                end_utc     TEXT,
                billable    INTEGER NOT NULL DEFAULT 1,
                open_marker INTEGER GENERATED ALWAYS AS
                            (CASE WHEN end_utc IS NULL THEN 1 ELSE NULL END) STORED
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_open_entry ON entry(open_marker);
            """)
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
        return try connection.transaction {
            // Close the open entry, if any, at this instant.
            try connection.prepare("UPDATE entry SET end_utc = ?1 WHERE end_utc IS NULL")
                .bind(1, startString)
                .run()
            try connection.prepare("""
                INSERT INTO entry (description, start_utc, end_utc, billable)
                VALUES (?1, ?2, NULL, ?3)
                """)
                .bind(1, description)
                .bind(2, startString)
                .bind(3, billable ? 1 : 0)
                .run()
            return Entry(
                id: connection.lastInsertRowID,
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
        return try connection.transaction {
            guard var entry = try readEntry(where: "end_utc IS NULL") else { return nil }
            try connection.prepare("UPDATE entry SET end_utc = ?1 WHERE id = ?2")
                .bind(1, endString)
                .bind(2, entry.id)
                .run()
            entry.end = ISO8601.date(from: endString)
            return entry
        }
    }

    // MARK: - Reads

    /// The currently open entry, or `nil` if nothing is running.
    public func openEntry() throws -> Entry? {
        try readEntry(where: "end_utc IS NULL")
    }

    /// Count of open entries — should never exceed 1. Used by the invariant
    /// tests to assert the keystone holds.
    public func openEntryCount() throws -> Int {
        let statement = try connection.prepare("SELECT COUNT(*) FROM entry WHERE end_utc IS NULL")
        guard try statement.step() else { return 0 }
        return Int(statement.int64(0))
    }

    /// All entries, most recent start first. Small helper for tests/inspection.
    public func allEntries() throws -> [Entry] {
        let statement = try connection.prepare(Self.entrySelect + " ORDER BY start_utc DESC, id DESC")
        var entries: [Entry] = []
        while try statement.step() {
            entries.append(Self.map(statement))
        }
        return entries
    }

    // MARK: - Row mapping

    private func readEntry(where clause: String) throws -> Entry? {
        let statement = try connection.prepare(Self.entrySelect + " WHERE \(clause) LIMIT 1")
        guard try statement.step() else { return nil }
        return Self.map(statement)
    }

    private static func map(_ statement: Statement) -> Entry {
        Entry(
            id: statement.int64(0),
            description: statement.text(1),
            start: ISO8601.date(from: statement.text(2)!)!,
            end: statement.isNull(3) ? nil : ISO8601.date(from: statement.text(3)!),
            billable: statement.int64(4) != 0
        )
    }

    // MARK: - Test support

    /// Attempts to insert a second open entry while bypassing `start`'s
    /// close-then-open transition. The structural invariant (the `one_open_entry`
    /// unique index) must reject it. Internal — reached only via `@testable`.
    func attemptRawOpenInsert(at instant: Date) throws {
        try connection.prepare("""
            INSERT INTO entry (description, start_utc, end_utc, billable)
            VALUES ('raw', ?1, NULL, 1)
            """)
            .bind(1, ISO8601.string(from: instant))
            .run()
    }
}
