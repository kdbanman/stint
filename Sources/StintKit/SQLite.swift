import CSQLite
import Foundation

/// A minimal, well-contained wrapper over the system SQLite C API — just enough
/// for the running-timer slice. It is intentionally small: parameterised
/// statements, immediate transactions, and typed column reads. Everything the
/// rest of the core needs goes through `Store`, so this layer can be swapped
/// for a fuller toolkit without touching callers.

/// SQLite tells bindings to copy text rather than borrow it (the value may be
/// freed after the call returns).
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

public struct SQLiteError: Error, CustomStringConvertible {
    public let code: Int32
    public let message: String
    public var description: String { "SQLite error \(code): \(message)" }
}

/// One open connection to a SQLite database.
final class Connection {
    private var handle: OpaquePointer?

    /// Opens (creating if needed) the database at `path`. Pass `":memory:"` for
    /// an ephemeral database. `FULLMUTEX` makes the handle safe to touch from
    /// more than one thread (the GUI's display tick and its actions).
    init(path: String) throws {
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(path, &handle, flags, nil) == SQLITE_OK else {
            defer { sqlite3_close(handle) }
            throw lastError(code: SQLITE_CANTOPEN)
        }
        // Cooperate with a concurrent writer (the other surface) instead of
        // failing fast with SQLITE_BUSY.
        sqlite3_busy_timeout(handle, 5_000)
    }

    deinit { sqlite3_close(handle) }

    /// Runs one or more statements with no bindings and no results (DDL, PRAGMA,
    /// BEGIN/COMMIT).
    func execute(_ sql: String) throws {
        var errorPointer: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(handle, sql, nil, nil, &errorPointer) == SQLITE_OK else {
            let message = errorPointer.map { String(cString: $0) } ?? "unknown error"
            sqlite3_free(errorPointer)
            throw SQLiteError(code: sqlite3_errcode(handle), message: message)
        }
    }

    /// Wraps `body` in an immediate transaction so a close-then-open transition
    /// takes the write lock up front and either commits whole or rolls back.
    func transaction<T>(_ body: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do {
            let result = try body()
            try execute("COMMIT")
            return result
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    func prepare(_ sql: String) throws -> Statement {
        try Statement(connection: handle, sql: sql)
    }

    var lastInsertRowID: Int64 { sqlite3_last_insert_rowid(handle) }

    private func lastError(code: Int32) -> SQLiteError {
        SQLiteError(code: sqlite3_errcode(handle),
                    message: String(cString: sqlite3_errmsg(handle)))
    }
}

/// A prepared statement. Bind 1-based parameters, then either `run()` it or
/// `step()` through result rows reading columns by 0-based index.
final class Statement {
    private var handle: OpaquePointer?
    private let connection: OpaquePointer?

    init(connection: OpaquePointer?, sql: String) throws {
        self.connection = connection
        guard sqlite3_prepare_v2(connection, sql, -1, &handle, nil) == SQLITE_OK else {
            throw SQLiteError(code: sqlite3_errcode(connection),
                              message: String(cString: sqlite3_errmsg(connection)))
        }
    }

    deinit { sqlite3_finalize(handle) }

    @discardableResult
    func bind(_ index: Int32, _ value: String?) -> Statement {
        if let value {
            sqlite3_bind_text(handle, index, value, -1, SQLITE_TRANSIENT)
        } else {
            sqlite3_bind_null(handle, index)
        }
        return self
    }

    @discardableResult
    func bind(_ index: Int32, _ value: Int64) -> Statement {
        sqlite3_bind_int64(handle, index, value)
        return self
    }

    /// Executes a statement expected to return no rows.
    func run() throws {
        let code = sqlite3_step(handle)
        guard code == SQLITE_DONE else {
            throw SQLiteError(code: code, message: String(cString: sqlite3_errmsg(connection)))
        }
    }

    /// Advances to the next row. Returns `true` if a row is available.
    func step() throws -> Bool {
        let code = sqlite3_step(handle)
        switch code {
        case SQLITE_ROW: return true
        case SQLITE_DONE: return false
        default: throw SQLiteError(code: code, message: String(cString: sqlite3_errmsg(connection)))
        }
    }

    func isNull(_ column: Int32) -> Bool {
        sqlite3_column_type(handle, column) == SQLITE_NULL
    }

    func int64(_ column: Int32) -> Int64 {
        sqlite3_column_int64(handle, column)
    }

    func text(_ column: Int32) -> String? {
        guard let cString = sqlite3_column_text(handle, column) else { return nil }
        return String(cString: cString)
    }
}
