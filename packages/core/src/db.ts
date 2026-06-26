/**
 * SQLite connection and schema (PRD §13, §15).
 *
 * Persistence is `node:sqlite` (Node 22.5+), WAL mode for concurrent readers and a
 * single writer, with a busy timeout so the CLI cooperates with the running app.
 * No native build step.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

/** The current schema version; bumped when migrations are added. */
export const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS client (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES client(id),
  name      TEXT NOT NULL,
  archived  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entry (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id        INTEGER REFERENCES client(id),
  project_id       INTEGER REFERENCES project(id),
  description      TEXT,
  start_utc        TEXT NOT NULL,
  end_utc          TEXT,
  billable         INTEGER NOT NULL DEFAULT 1,
  excluded_seconds INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tag (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL UNIQUE,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entry_tag (
  entry_id INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tag(id),
  PRIMARY KEY (entry_id, tag_id)
);

CREATE TABLE IF NOT EXISTS sleep_span (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id  INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  sleep_utc TEXT NOT NULL,
  wake_utc  TEXT NOT NULL,
  source    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The one-open-entry invariant (PRD §03) is given teeth at the storage layer by
-- triggers: an INSERT or UPDATE that would leave two rows with end_utc IS NULL is
-- aborted. @stint/core also performs every transition transactionally under
-- BEGIN IMMEDIATE, but these make a violating write impossible even by hand.
CREATE TRIGGER IF NOT EXISTS one_open_entry_insert
  BEFORE INSERT ON entry
  WHEN NEW.end_utc IS NULL
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM entry WHERE end_utc IS NULL) > 0
    THEN RAISE(ABORT, 'an entry is already open') END;
END;

CREATE TRIGGER IF NOT EXISTS one_open_entry_update
  BEFORE UPDATE ON entry
  WHEN NEW.end_utc IS NULL AND OLD.end_utc IS NOT NULL
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM entry WHERE end_utc IS NULL AND id <> NEW.id) > 0
    THEN RAISE(ABORT, 'an entry is already open') END;
END;

CREATE INDEX IF NOT EXISTS entry_start_idx ON entry(start_utc);
CREATE INDEX IF NOT EXISTS entry_client_idx ON entry(client_id);
`;

/**
 * Open (and if needed create) the database at `path`, set pragmas, and migrate.
 * Pass `:memory:` for an ephemeral in-memory database (used heavily in tests).
 */
export function openDb(path: string, opts: { busyTimeoutMs?: number } = {}): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  // WAL: concurrent readers, single writer (PRD §04). In-memory has no WAL.
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`PRAGMA busy_timeout = ${opts.busyTimeoutMs ?? 5000}`);
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(SCHEMA_SQL);
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (row.user_version < SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}
