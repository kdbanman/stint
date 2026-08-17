/**
 * Database location change — migrate / start fresh / adopt (PRD §20 R12, driving §12 R26).
 *
 * Relocating the database is a core pipeline that can only ADD copies: pre-change backup
 * at the old home → copy → verify → atomic config commit — and the old file is always
 * left in place, untouched (copy, never delete). Every refusal happens BEFORE anything is
 * written, and a failure at any later stage stops with the config file untouched and the
 * old path still active, so a partially-copied destination can never become live. The
 * caller (the GUI — §12 R26 is the pipeline's only driver; the CLI's write interface is
 * deliberately the config file itself, architecture.html §08) relaunches onto the new
 * location after a success.
 *
 * The §13 atomic `writeConfig` rename is the single commit point; everything before it is
 * additive and everything after it is the relaunch.
 */
import { accessSync, constants, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupDb, backupDirState, checkIntegrity, latestBackup, type BackupInfo } from './backup.js';
import { readConfig, writeConfig } from './config.js';
import { SCHEMA_VERSION, type Db } from './db.js';

/** The §12 R26 choice: copy the data over, or start the destination on its own terms. */
export type DbChangeMode = 'migrate' | 'start-fresh';

/**
 * What actually happened: `start-fresh` splits into first-run semantics at an empty
 * destination (`started-fresh`) and ADOPTING a file already there (`adopted`) — adoption
 * is what makes "point at my moved file" possible from Settings (§20 R12).
 */
export type DbChangeOutcome = 'migrated' | 'started-fresh' | 'adopted';

/** A completed §20 R12 change. The config is committed; the caller relaunches. */
export interface DbLocationChange {
  outcome: DbChangeOutcome;
  /** The old database file — always kept in place, untouched (§20 R12). */
  oldDbPath: string;
  /** The destination the committed config now points at. */
  newDbPath: string;
  /** The pre-change backup at the old home (fresh, or the byte-identical latest). */
  backup: BackupInfo;
  /** The config file the change was committed to. */
  configFile: string;
  /** The surface-neutral success line — names the old file kept in place (§20 R12's done-when). */
  message: string;
}

/**
 * §20 R12 — the pipeline refused or failed. The message states what stopped it AND that
 * nothing became live (config untouched, old path active); the typed class + destination
 * let the GUI render the refusal inside the change dialog (§12 R26) rather than fatally.
 */
export class StorageChangeError extends Error {
  /** The destination path the refused change was aimed at. */
  readonly destination: string;
  constructor(message: string, destination: string) {
    super(message);
    this.name = 'StorageChangeError';
    this.destination = destination;
  }
}

/** The refusal-order gate over the destination: cheap, read-only, before anything is written. */
function assertDestinationUsable(mode: DbChangeMode, oldDbPath: string, newDbPath: string): void {
  if (resolve(newDbPath) === resolve(oldDbPath)) {
    throw new StorageChangeError(
      `${newDbPath} is already the live database — nothing to change`,
      newDbPath,
    );
  }
  const parent = dirname(newDbPath);
  const refuseParent = (why: string): never => {
    throw new StorageChangeError(
      `cannot use ${newDbPath}: its parent directory ${parent} ${why} — the directory is ` +
        `not created automatically (restore it or pick another location); nothing has changed`,
      newDbPath,
    );
  };
  // No auto-mkdir, same stance as §20 R11: a missing parent is the unmounted-volume /
  // moved-directory signature, and creating it would strand data on the wrong filesystem.
  if (!existsSync(parent)) refuseParent('does not exist');
  if (!statSync(parent).isDirectory()) refuseParent('is not a directory');
  try {
    accessSync(parent, constants.W_OK);
  } catch {
    refuseParent('is not writable');
  }
  if (mode === 'migrate' && existsSync(newDbPath)) {
    // The wording matches the §12 R26 dialog's refusal copy (mockups/storage-change.html).
    throw new StorageChangeError(
      `a file already exists at ${newDbPath} — migrate never overwrites; pick a different ` +
        `location, or choose start fresh to adopt the existing file (it must pass the ` +
        `integrity and version checks); nothing has changed`,
      newDbPath,
    );
  }
}

/**
 * §20 R12 adoption gate: the existing destination file becomes the live database iff it
 * passes the integrity check and the §20 R08/R09 schema-version gate; refused loudly
 * otherwise. Read-only — the version stamp is read first (the R09 discipline: never scan
 * a file whose schema this binary cannot know), then `quick_check`; nothing is written.
 */
function assertAdoptable(dest: string): void {
  let db: DatabaseSync | undefined;
  try {
    let foundVersion: number;
    try {
      db = new DatabaseSync(dest);
      foundVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number })
        .user_version;
    } catch (err) {
      // Not a database at all (or an unreadable header) — the integrity refusal.
      throw new StorageChangeError(
        `cannot adopt ${dest}: it failed the integrity check (${(err as Error).message}); ` +
          `the config file is untouched and the old database is still active`,
        dest,
      );
    }
    if (foundVersion > SCHEMA_VERSION) {
      throw new StorageChangeError(
        `cannot adopt ${dest}: its schema version ${foundVersion} is newer than this ` +
          `binary's supported version ${SCHEMA_VERSION} — run the newer binary to use it; ` +
          `the config file is untouched and the old database is still active`,
        dest,
      );
    }
    const integrity = checkIntegrity(db);
    if (!integrity.ok) {
      throw new StorageChangeError(
        `cannot adopt ${dest}: it failed the integrity check (${integrity.detail}); ` +
          `the config file is untouched and the old database is still active`,
        dest,
      );
    }
  } finally {
    try {
      db?.close();
    } catch {
      /* a refused handle may already be unusable */
    }
  }
}

/**
 * §20 R12 — change the database location. Runs the whole pipeline against the LIVE handle
 * of the old database and returns only after the config commit; the old file stays the
 * active database for this process — the caller relaunches onto the new location.
 *
 * Stages, in order (each stage's failure stops the pipeline with the config untouched):
 *
 *   1. Gates — read-only refusals: a same-path no-op, a dead destination parent (no
 *      auto-mkdir), an existing file under migrate (never overwrites), and the adoption
 *      gates (integrity + version) for start-fresh over an existing file.
 *   2. Pre-change backup at the OLD home — `backupDb` checkpoints the WAL (so the old
 *      main file is self-contained) and writes a timestamped copy into the active backup
 *      directory, or keeps the byte-identical latest. A backup directory that cannot
 *      receive it refuses here — the change proceeds only after a pre-change backup
 *      exists (§17 R15).
 *   3. Migrate only: copy old → new (`COPYFILE_EXCL` — the exists gate, race-proof), then
 *      integrity-check the copy. A failed verify leaves the copy in place for inspection
 *      (this pipeline deletes nothing, ever) — it never becomes live.
 *   4. Commit — read + rewrite the config file through the §13 atomic write. The rename
 *      is the single commit point; a crash before it leaves the old config intact.
 *
 * Start fresh at an empty destination commits WITHOUT creating the file: the relaunch
 * finds an absent file with a live parent — exactly the §20 R11 first-run semantics.
 */
export function changeDbLocation(
  db: Db,
  opts: {
    oldDbPath: string;
    newDbPath: string;
    mode: DbChangeMode;
    /** The §13 config file the change commits `dbPath` into. */
    configFile: string;
    /** The ACTIVE backup directory the pre-change backup is written to (§13's ladder). */
    backupDir: string;
    /** The §14 retention the pre-change backup prunes to. */
    retention: number;
    at?: Date;
  },
): DbLocationChange {
  const { oldDbPath, newDbPath, mode, configFile, backupDir } = opts;

  assertDestinationUsable(mode, oldDbPath, newDbPath);
  const adopting = mode === 'start-fresh' && existsSync(newDbPath);
  if (adopting) assertAdoptable(newDbPath);

  // Stage 2 — the pre-change backup at the old home. Probe first for a plain refusal
  // (the same wording seam as Store.backupNow); a null backupDb means the latest existing
  // backup is already byte-identical to the checkpointed database, so it IS the pre-change
  // backup. Unlike the best-effort launch backup, a failure here STOPS the change.
  const dirState = backupDirState(backupDir);
  if (!dirState.ok) {
    throw new StorageChangeError(
      `no pre-change backup could be written: backup directory ${dirState.path} ` +
        `${dirState.problem} — nothing has changed`,
      newDbPath,
    );
  }
  let backup: BackupInfo | null;
  try {
    backup =
      backupDb(oldDbPath, db, {
        retention: opts.retention,
        backupDir,
        ...(opts.at !== undefined ? { at: opts.at } : {}),
      }) ?? latestBackup(oldDbPath, backupDir);
  } catch (err) {
    throw new StorageChangeError(
      `no pre-change backup could be written: ${(err as Error).message} — nothing has changed`,
      newDbPath,
    );
  }
  if (backup === null) {
    // Unreachable while the old database exists on disk; refuse rather than proceed unbacked.
    throw new StorageChangeError(
      `no pre-change backup could be written to ${backupDir} — nothing has changed`,
      newDbPath,
    );
  }

  // Stage 3 — migrate's copy + verify. The WAL was checkpointed by the backup stage, so
  // the main file is a complete, dependency-free snapshot to copy.
  if (mode === 'migrate') {
    try {
      copyFileSync(oldDbPath, newDbPath, constants.COPYFILE_EXCL);
    } catch (err) {
      throw new StorageChangeError(
        `the copy to ${newDbPath} failed: ${(err as Error).message}; the config file is ` +
          `untouched and the old database at ${oldDbPath} is still active (the pre-change ` +
          `backup ${backup.name} stays)`,
        newDbPath,
      );
    }
    let copy: DatabaseSync | undefined;
    let integrity: { ok: boolean; detail: string };
    try {
      copy = new DatabaseSync(newDbPath);
      integrity = checkIntegrity(copy);
    } catch (err) {
      integrity = { ok: false, detail: (err as Error).message };
    } finally {
      try {
        copy?.close();
      } catch {
        /* a failed copy's handle may already be unusable */
      }
    }
    if (!integrity.ok) {
      throw new StorageChangeError(
        `the copied database at ${newDbPath} failed its integrity check ` +
          `(${integrity.detail}) and was not made live; the config file is untouched and ` +
          `the old database at ${oldDbPath} is still active — the failed copy is left at ` +
          `${newDbPath} for inspection`,
        newDbPath,
      );
    }
  }

  // Stage 4 — the atomic commit (§13). ConfigError from a config file that turned
  // untrusted mid-run propagates typed; either way a throw here leaves the file intact.
  const config = readConfig(configFile);
  config.dbPath = newDbPath;
  writeConfig(configFile, config);

  const outcome: DbChangeOutcome =
    mode === 'migrate' ? 'migrated' : adopting ? 'adopted' : 'started-fresh';
  const did =
    outcome === 'migrated'
      ? `migrated the database to ${newDbPath}`
      : outcome === 'adopted'
        ? `adopted the existing database at ${newDbPath}`
        : `starting fresh at ${newDbPath}`;
  return {
    outcome,
    oldDbPath,
    newDbPath,
    backup,
    configFile,
    message: `${did}; the old database is kept in place, untouched, at ${oldDbPath}`,
  };
}
