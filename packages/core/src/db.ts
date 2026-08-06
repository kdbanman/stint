/**
 * SQLite connection and schema (PRD §13, §15).
 *
 * Persistence is `node:sqlite` (Node 22.5+), WAL mode for concurrent readers and a
 * single writer, with a busy timeout so the CLI cooperates with the running app.
 * No native build step.
 *
 * SCHEMA_VERSION 3 adds the saved-report `report` table, the pinned-timer-template
 * `favorite` / `favorite_tag` tables, and the §20 R02 partial unique index that gives
 * the one-open-entry invariant DB-level teeth alongside the existing triggers.
 * SCHEMA_VERSION 4 constrains `sleep_span.source` to SleepSource's value list (#180).
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  checkIntegrity,
  quarantineAndRecover,
  type RecoveryResult,
} from './backup.js';

export type Db = DatabaseSync;

/** The current schema version; bumped when migrations are added. */
export const SCHEMA_VERSION = 4;

// One source for the sleep_span column set: the fresh-DB CREATE in SCHEMA_SQL and the
// v3→v4 rebuild in migrate() must agree, or a migrated database diverges from a fresh one.
// The CHECK mirrors types.ts's SleepSource the way report's CHECKed columns mirror theirs —
// it is the proof behind the store's `source as SleepSource` cast (#180).
const SLEEP_SPAN_COLUMNS_SQL = `
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id  INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  sleep_utc TEXT NOT NULL,
  wake_utc  TEXT NOT NULL,
  source    TEXT NOT NULL CHECK(source IN ('event', 'gap', 'unknown'))
`;

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

-- Pinned timer template (PRD §05 R09, §13): a named preset of the attributes a timer
-- starts with — description, client, project, billable, and (via favorite_tag) tags.
-- Resuming from a favorite starts a fresh entry from this template; it is NOT itself a
-- timer. The tag link mirrors entry_tag so a favorite's tags share the one tag table.
CREATE TABLE IF NOT EXISTS favorite (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  client_id   INTEGER REFERENCES client(id),
  project_id  INTEGER REFERENCES project(id),
  billable    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS favorite_tag (
  favorite_id INTEGER NOT NULL REFERENCES favorite(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tag(id),
  PRIMARY KEY (favorite_id, tag_id)
);

CREATE TABLE IF NOT EXISTS sleep_span (${SLEEP_SPAN_COLUMNS_SQL});

CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Internal application state owned by the running app (check-in schedule under
-- \`checkin_state\`, last-seen heartbeat under \`last_seen_utc\`) — kept in its own table so
-- the user-facing \`setting\` table that \`config ls\` enumerates is not polluted with private
-- keys (PRD §04, §10). DURABILITY CONTRACT (§20 R07): the schedule/last-seen rows are written
-- INSIDE the same transaction as the entry write that changes them (start seeds the schedule,
-- stop clears it — both atomically with the entry row), so a crash can never leave the open
-- entry and its schedule state divergent. The canonical key names live in @stint/core
-- (\`checkin.ts\` CHECKIN_STATE_KEY / LAST_SEEN_KEY); this is a key/value table, no DDL change.
CREATE TABLE IF NOT EXISTS app_state (
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

-- DB-level teeth for the one-open-entry invariant (PRD §20 R02), defense in depth
-- alongside the triggers above: a partial UNIQUE index over the CONSTANT expression (1),
-- restricted to open rows (WHERE end_utc IS NULL), makes a second open row impossible at the
-- storage layer. Indexing the constant — NOT end_utc — is deliberate: every open row has
-- end_utc = NULL, and SQLite treats NULLs as DISTINCT in a unique index, so a unique index on
-- entry(end_utc) would permit unlimited NULLs (multiple open rows). All open rows collide on
-- the value 1 instead, so the second open row is rejected with
-- "UNIQUE constraint failed: index 'one_open_entry_idx'". Closed rows (end_utc NOT NULL) are
-- excluded from the partial index entirely, so unlimited closed rows and reopen-after-close
-- both remain free. It takes effect from SCHEMA_VERSION 3; an existing v2 DB held at most one
-- open row under the triggers, so CREATE UNIQUE INDEX never fails on existing data and the
-- additive v2→v3 upgrade needs no data fix-up.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_entry_idx ON entry((1)) WHERE end_utc IS NULL;

-- Saved report definition (PRD §09 R08, §13): a named, persistent preset of
-- {range-spec, group-by, filters, rounding}. The range is stored EITHER as a relative
-- preset (range_preset, re-resolved against current data on each run) OR as an absolute
-- UTC window (range_from_utc / range_to_utc), discriminated by range_kind — so a saved
-- report and an ad-hoc report can never diverge on how a range resolves. The name is the
-- handle both surfaces use (\`tt report show <name>\` / the GUI list), unique case-insensitively.
CREATE TABLE IF NOT EXISTS report (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  range_kind             TEXT NOT NULL CHECK(range_kind IN ('preset', 'absolute')),
  range_preset           TEXT CHECK(range_preset IN ('today', 'week', 'last-week', 'month', 'last-month')),
  range_from_utc         TEXT,
  range_to_utc           TEXT,
  group_by               TEXT NOT NULL CHECK(group_by IN ('client', 'project', 'day', 'tag')),
  billable_filter        TEXT NOT NULL CHECK(billable_filter IN ('billable', 'all', 'non-billable')),
  client_id              INTEGER REFERENCES client(id),
  project_id             INTEGER REFERENCES project(id),
  tag                    TEXT,
  search                 TEXT,
  rounding               INTEGER NOT NULL DEFAULT 0,
  rounding_increment_min INTEGER NOT NULL DEFAULT 0,
  created_utc            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS entry_start_idx ON entry(start_utc);
CREATE INDEX IF NOT EXISTS entry_client_idx ON entry(client_id);
`;

/**
 * A DB-open durability pragma could not be brought to its required value (PRD §20 R01).
 *
 * Thrown by {@link assertOpenPragmas} after a set-then-verify-then-retry cycle fails — i.e.
 * the open is *refused before any write or migration runs*, which is the §20 R01 "corrected
 * or refused before any write" done-when. Naming it lets tests and callers catch it precisely.
 */
export class DbOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbOpenError';
  }
}

/**
 * The database's `user_version` exceeds this binary's {@link SCHEMA_VERSION} (PRD §20 R09).
 *
 * Thrown by {@link openDb} as the FIRST post-open action — only the database header's version
 * stamp is read before the refusal — and again by `migrate()` as the backstop. R08's
 * additive-only migration policy is a policy, not a fence, and a stale binary reading or
 * writing under an outdated schema understanding could silently corrupt billing data, so
 * the open is refused entirely. The message carries the offending file's path (with `TT_DB`
 * overrides the user must be able to see WHICH file was refused). Naming the error lets both
 * surfaces catch it precisely.
 */
export class SchemaTooNewError extends Error {
  readonly foundVersion: number;
  readonly supportedVersion: number;
  readonly path: string;
  constructor(foundVersion: number, supportedVersion: number, path: string) {
    super(
      `database schema version ${foundVersion} is newer than this binary's supported ` +
        `version ${supportedVersion}: this database was written by a newer version of Stint; ` +
        `run the newer binary (database: ${path})`,
    );
    this.name = 'SchemaTooNewError';
    this.foundVersion = foundVersion;
    this.supportedVersion = supportedVersion;
    this.path = path;
  }
}

/** Close a handle on a refusal path, swallowing errors — the handle may already be unusable. */
function closeQuietly(db: Db): void {
  try {
    db.close();
  } catch {
    /* a refused or corrupt handle may already be unusable */
  }
}

/** `PRAGMA synchronous` numeric levels — FULL is the §20 R01 durability target on disk. */
const SYNCHRONOUS_FULL = 2;

/**
 * Set the DB-open durability pragmas (PRD §20 R01) in dependency order.
 *
 * Order matters: busy_timeout first (so every later lock wait cooperates), then journal_mode
 * (WAL), then foreign_keys, then synchronous. The read-back assertion is {@link assertOpenPragmas}.
 *
 * On disk we choose `synchronous = FULL` rather than `NORMAL`: FULL adds one extra fsync per
 * commit so a committed write survives even a power loss (under WAL it fsyncs the WAL on commit
 * and the main file on checkpoint). NORMAL would be safe against application crashes but can lose
 * the tail of the WAL on power loss. Stint is a single-user, low-write-rate tracker, so the extra
 * fsync cost is irrelevant while durability is the whole point of §20 — FULL is the right trade.
 * `:memory:` has no journal or durability concept, so WAL + synchronous are skipped there.
 */
function setPragmas(db: Db, path: string, busyTimeoutMs: number): void {
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA synchronous = FULL');
  } else {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/** Read back a single pragma value (first column of the one-row result). */
function readPragma(db: Db, name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  return row ? Object.values(row)[0] : undefined;
}

/** True when every §20 R01 durability pragma already holds its required value. */
function pragmasOk(db: Db, path: string, busyTimeoutMs: number): boolean {
  if (Number(readPragma(db, 'foreign_keys')) !== 1) return false;
  if (Number(readPragma(db, 'busy_timeout')) !== busyTimeoutMs) return false;
  if (path === ':memory:') return true;
  if (String(readPragma(db, 'journal_mode')).toLowerCase() !== 'wal') return false;
  if (Number(readPragma(db, 'synchronous')) !== SYNCHRONOUS_FULL) return false;
  return true;
}

/**
 * Apply AND verify the DB-open durability invariants (PRD §20 R01) before any write/migration.
 *
 * On every open we both SET the pragmas and READ THEM BACK: `journal_mode = wal`,
 * `foreign_keys = 1`, `busy_timeout > 0` (the requested value), and — on disk — `synchronous = 2`
 * (FULL). If any pragma is not at its required value (e.g. a stuck journal_mode that refuses WAL),
 * we retry the full set once; if it still does not hold we throw {@link DbOpenError} so the open is
 * *refused before migrate() runs*. This is the §20 R01 "corrected or refused before any write".
 */
export function assertOpenPragmas(db: Db, path: string, busyTimeoutMs: number): void {
  setPragmas(db, path, busyTimeoutMs);
  if (!pragmasOk(db, path, busyTimeoutMs)) {
    // Retry once — a transient locked WAL switch may clear on a second attempt.
    setPragmas(db, path, busyTimeoutMs);
    if (!pragmasOk(db, path, busyTimeoutMs)) {
      throw new DbOpenError(
        `durability pragmas could not be enforced on open (${path}): ` +
          `journal_mode=${String(readPragma(db, 'journal_mode'))} ` +
          `foreign_keys=${String(readPragma(db, 'foreign_keys'))} ` +
          `busy_timeout=${String(readPragma(db, 'busy_timeout'))} ` +
          `synchronous=${String(readPragma(db, 'synchronous'))} ` +
          `(required wal / 1 / ${busyTimeoutMs} / ${SYNCHRONOUS_FULL})`,
      );
    }
  }
}

/**
 * Open (and if needed create) the database at `path`, set pragmas, and migrate.
 * Pass `:memory:` for an ephemeral in-memory database (used heavily in tests).
 *
 * §20 R03/R05 — on a file-backed open, the database is integrity-checked (`PRAGMA
 * quick_check`) BEFORE any write; on failure the handle is closed, the corrupt file is
 * quarantined and the latest good backup restored (RecoveryError if there is none — we
 * never start fresh on an empty DB), and the restored file is reopened. When a recovery
 * happened, `opts.onRecovered` is invoked with its result so the caller (the GUI) can
 * inform the user that nothing was lost.
 *
 * §20 R09 — a database stamped with a `user_version` NEWER than this binary's
 * {@link SCHEMA_VERSION} is refused with {@link SchemaTooNewError} as the first post-open
 * action: nothing beyond the database header is read before the refusal, and nothing is
 * ever written.
 */
export function openDb(
  path: string,
  opts: { busyTimeoutMs?: number; onRecovered?: (r: RecoveryResult) => void } = {},
): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const busyTimeoutMs = opts.busyTimeoutMs ?? 5000;

  if (path === ':memory:') {
    const mem = new DatabaseSync(path);
    assertOpenPragmas(mem, path, busyTimeoutMs);
    migrate(mem, ':memory:');
    return mem;
  }

  let db = new DatabaseSync(path);

  // §20 R09 — the version-skew fence is the FIRST post-open action, BEFORE the pragmas
  // (whose WAL switch can rewrite the journal-mode header), BEFORE the integrity scan
  // (a full-file read), and BEFORE the corrupt→quarantine routing below: a stale binary
  // must never route a merely-NEWER database into quarantine/restore — that would replace
  // newer data with an older backup, the exact hazard R09 forecloses. Only the database
  // header's version stamp is read before the refusal. If the header itself is unreadable,
  // the read throws and we fall through to the existing corrupt-handling flow unchanged.
  let foundVersion: number | null = null;
  try {
    foundVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
  } catch {
    /* header unreadable — let the R03 corruption gate below classify it */
  }
  if (foundVersion !== null && foundVersion > SCHEMA_VERSION) {
    closeQuietly(db);
    throw new SchemaTooNewError(foundVersion, SCHEMA_VERSION, path);
  }

  // §20 R03/R05 — integrity gate on a real file: open it, set the durability pragmas, and run
  // quick_check BEFORE any write. Corruption can surface either as a failed quick_check OR as a
  // throw from the pragmas/open themselves (a clobbered header makes even `journal_mode=WAL`
  // raise "file is not a database"); BOTH are treated as corruption. On corruption we close the
  // handle, quarantine the corrupt file and restore the latest backup (RecoveryError if none —
  // never an empty start), reopen the restored file, and notify the caller.
  let corrupt = false;
  try {
    assertOpenPragmas(db, path, busyTimeoutMs);
    corrupt = !checkIntegrity(db).ok;
  } catch (e) {
    // A DbOpenError means the pragmas themselves could not be enforced — that is a refusal,
    // not corruption, so it must propagate (§20 R01: refused before any write). Any other
    // throw from the pragmas/open (e.g. a clobbered header that makes WAL raise "file is not
    // a database") IS corruption and routes to recovery below.
    if (e instanceof DbOpenError) {
      closeQuietly(db);
      throw e;
    }
    corrupt = true;
  }
  if (corrupt) {
    closeQuietly(db);
    const recovery = quarantineAndRecover(path); // throws RecoveryError if no backup
    db = new DatabaseSync(path); // reopen the restored file
    try {
      assertOpenPragmas(db, path, busyTimeoutMs);
    } catch (e) {
      // A refusal on the recovery-reopen must not leak the fresh handle either.
      closeQuietly(db);
      throw e;
    }
    opts.onRecovered?.(recovery);
  }

  try {
    migrate(db, path);
  } catch (e) {
    // A refused open (§20 R09 backstop, or any migration failure) must not leak the
    // handle — close it so the file is left exactly as found before propagating.
    closeQuietly(db);
    throw e;
  }
  return db;
}

// v3→v4: give sleep_span.source the CHECK its report-table siblings already have. SQLite's
// ALTER TABLE cannot add a CHECK, so an existing table is rebuilt — create with the
// constraint, copy, drop, rename — in one transaction. The copy coerces an out-of-union
// value to 'unknown' (the literal that exists for exactly this "provenance lost" semantic)
// rather than refusing it: the realistic carrier is a §20 R05 restore of a pre-v4 backup,
// and a constraint that rejects a database the recovery path should be repairing would
// break the restore. No row is lost either way (#180).
function constrainSleepSource(db: Db): void {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sleep_span'")
    .get();
  if (table === undefined) return; // fresh DB: SCHEMA_SQL creates the table already CHECKed
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE sleep_span_v4 (${SLEEP_SPAN_COLUMNS_SQL});
    INSERT INTO sleep_span_v4 (id, entry_id, sleep_utc, wake_utc, source)
      SELECT id, entry_id, sleep_utc, wake_utc,
        CASE WHEN source IN ('event', 'gap', 'unknown') THEN source ELSE 'unknown' END
      FROM sleep_span;
    DROP TABLE sleep_span;
    ALTER TABLE sleep_span_v4 RENAME TO sleep_span;
    COMMIT;
  `);
}

function migrate(db: Db, path: string): void {
  // Only touch the schema when it is actually behind: an up-to-date database skips all
  // DDL, so concurrent opens don't each take a write lock just to re-assert the schema.
  // Every statement in SCHEMA_SQL is IF NOT EXISTS, so the additive bumps (v2→v3: the
  // favorite / favorite_tag / report tables and the one_open_entry_idx partial unique
  // index) simply re-run the idempotent DDL; the v3→v4 sleep_span rebuild is the one
  // step IF NOT EXISTS cannot express, and runs first so SCHEMA_SQL's CREATE is a no-op.
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  // §20 R09 backstop — openDb's header read is the PRIMARY fence (first post-open action);
  // this check is defense-in-depth guarding the post-recovery reopen and any other migrate
  // caller. A database stamped AHEAD of this binary is refused before any DDL or write:
  // there are no down-migrations, so this binary cannot know what a future schema means
  // and must not read or write under it.
  if (row.user_version > SCHEMA_VERSION) {
    throw new SchemaTooNewError(row.user_version, SCHEMA_VERSION, path);
  }
  if (row.user_version >= SCHEMA_VERSION) return;
  constrainSleepSource(db);
  db.exec(SCHEMA_SQL);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
