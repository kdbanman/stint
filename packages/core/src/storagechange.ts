/**
 * Storage location change — the database pipeline (PRD §20 R12) and the backup-directory
 * pipeline (PRD §20 R13), both driving §12 R26.
 *
 * Relocating the database is a core pipeline that can only ADD copies: pre-change backup
 * at the old home → copy → verify → atomic config commit — and the old file is always
 * left in place, untouched (copy, never delete). Every refusal happens BEFORE anything is
 * written, and a failure at any later stage stops with the config file untouched and the
 * old path still active, so a partially-copied destination can never become live. The
 * backup-directory pipeline is its move-shaped sibling: fresh backup into the NEW
 * directory first, per-file copy → verify, originals deleted only after every copy
 * verifies and the config commits. The caller (the GUI — §12 R26 is the pipelines' only
 * driver; the CLI's write interface is deliberately the config file itself,
 * architecture.html §08) relaunches onto the new location after a success.
 *
 * The §13 atomic `writeConfig` rename is the single commit point; everything before it is
 * additive and everything after it is the relaunch.
 */
import { accessSync, constants, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  backupCollisions,
  backupDb,
  backupDirState,
  checkIntegrity,
  copyBackupsVerified,
  deleteBackupOriginals,
  latestBackup,
  listBackups,
  type BackupInfo,
} from './backup.js';
import { readConfig, resetConfigKey, writeConfig } from './config.js';
import { SCHEMA_VERSION, type Db } from './db.js';

/** The §12 R26 choice: carry the data over, or start the destination on its own terms. */
export type StorageChangeMode = 'migrate' | 'start-fresh';

/** The database pipeline's name for the same §12 R26 choice (§20 R12). */
export type DbChangeMode = StorageChangeMode;

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
  /** True when the commit DELETED the `dbPath` key — the destination is the §13 default rung. */
  committedDefault: boolean;
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
    /**
     * §13 reset semantics — the caller's DEFAULT-rung database path (the GUI passes its
     * `userDataDir`-derived default; core cannot compute it alone). When the destination
     * IS this path, the commit DELETES the `dbPath` key instead of writing a resolved
     * default into the file — the §12 R25 Reset-to-default flow's commit, and the same
     * stance {@link changeBackupDir} already takes toward its own default rung.
     */
    defaultDbPath?: string;
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
  // Toward the caller-supplied default rung the commit DELETES the key — §13's reset
  // semantics; a resolved default is never written into the file (changeBackupDir's
  // committedDefault stance, which computes its own default from dirname(dbPath)).
  const committedDefault =
    opts.defaultDbPath !== undefined && resolve(newDbPath) === resolve(opts.defaultDbPath);
  if (committedDefault) {
    resetConfigKey(configFile, 'dbPath');
  } else {
    const config = readConfig(configFile);
    config.dbPath = newDbPath;
    writeConfig(configFile, config);
  }

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
    committedDefault,
    configFile,
    message: `${did}; the old database is kept in place, untouched, at ${oldDbPath}`,
  };
}

/**
 * What a §20 R13 backup-directory change did: `moved` (migrate — the verified move) or
 * `started-fresh` (old backups stay put, untouched).
 */
export type BackupDirChangeOutcome = 'moved' | 'started-fresh';

/** A completed §20 R13 change. The config is committed; the caller relaunches. */
export interface BackupDirChange {
  outcome: BackupDirChangeOutcome;
  /** The old backup directory — still this process's active directory until the relaunch. */
  oldBackupDir: string;
  /** The destination the committed config now points at. */
  newBackupDir: string;
  /** The fresh backup written into the NEW directory first (or the byte-identical latest there). */
  freshBackup: BackupInfo;
  /** The verified copies at their new paths (empty for start-fresh). */
  moved: BackupInfo[];
  /** True when the commit DELETED the `backupDir` key — the destination is the §13 default rung. */
  committedDefault: boolean;
  /** The config file the change was committed to. */
  configFile: string;
  /** The surface-neutral success line — names what moved (or stayed put) and where. */
  message: string;
}

/**
 * §20 R13 — change the backup directory. Migrate is a MOVE that can never lose a backup;
 * start fresh leaves old backups put. Runs against the LIVE handle of the database (the
 * fresh backup checkpoints its WAL) and returns only after the config commit; the old
 * directory stays this process's active one — the caller relaunches onto the new
 * resolution. Retention deliberately never runs here: pruning a directory that is not yet
 * (or no longer) active could destroy backups mid-change — it resumes with the next
 * backup written in the active directory (§20 R04).
 *
 * Stages, in order (each stage's failure stops the pipeline with the config untouched):
 *
 *   1. Gates — read-only refusals: a same-directory no-op, a destination that is missing
 *      (no auto-mkdir — the §20 R11 stance), not a directory, or not writable, and for
 *      migrate an old directory whose originals could not be removed and any same-name
 *      collision at the destination (migrate never overwrites).
 *   2. Fresh backup of the current database into the NEW directory — the writability
 *      probe and the backup-before-change in one step (§20 R13's done-when: it exists
 *      there before anything else happens), in BOTH modes. `backupDb` checkpoints the
 *      WAL and writes the timestamped copy, or keeps the byte-identical latest already
 *      there. A failure refuses — the change proceeds only over a live durability net.
 *   3. Migrate only: per original, copy → verify (size/hash) via `copyBackupsVerified`.
 *      A copy or verify failure aborts with BOTH SETS INTACT: originals untouched, the
 *      aborted run's own copies rolled back, the fresh backup kept.
 *   4. Commit — the §13 atomic write. A destination equal to the default rung (beside
 *      the database) commits by DELETING the `backupDir` key — §13's reset semantics; a
 *      resolved default is never written into the file — otherwise `backupDir` is set.
 *   5. Migrate only, after the commit: delete the originals. Every copy verified and the
 *      new directory is committed, so each original is a redundant duplicate — a crash
 *      or unlink failure here leaves extra copies, never a loss.
 */
export function changeBackupDir(
  db: Db,
  opts: {
    /** The live database file (the fresh backup's source and the default-rung anchor). */
    dbPath: string;
    /** The ACTIVE backup directory the change moves away from (§13's ladder). */
    oldBackupDir: string;
    newBackupDir: string;
    mode: StorageChangeMode;
    /** The §13 config file the change commits `backupDir` into (or deletes it from). */
    configFile: string;
    at?: Date;
    /** The per-file copy primitive (see {@link copyBackupsVerified} — fault-injectable). */
    copyFile?: (src: string, dest: string) => void;
  },
): BackupDirChange {
  const { dbPath, oldBackupDir, newBackupDir, mode, configFile } = opts;

  // Stage 1 — the read-only gates.
  if (resolve(newBackupDir) === resolve(oldBackupDir)) {
    throw new StorageChangeError(
      `${newBackupDir} is already the active backup directory — nothing to change`,
      newBackupDir,
    );
  }
  const destState = backupDirState(newBackupDir);
  if (!destState.ok) {
    // No auto-mkdir, the §20 R11 stance: a missing directory is the unmounted-volume /
    // moved-directory signature, and creating it would strand backups on the wrong filesystem.
    throw new StorageChangeError(
      `cannot use ${newBackupDir}: it ${destState.problem} — the directory is not created ` +
        `automatically (restore it or pick another location); nothing has changed`,
      newBackupDir,
    );
  }
  const originals = mode === 'migrate' ? listBackups(dbPath, oldBackupDir) : [];
  if (originals.length > 0) {
    try {
      accessSync(oldBackupDir, constants.W_OK);
    } catch {
      throw new StorageChangeError(
        `cannot move the existing backups out of ${oldBackupDir}: it is not writable — ` +
          `nothing has changed`,
        newBackupDir,
      );
    }
    const collisions = backupCollisions(originals, newBackupDir);
    if (collisions.length > 0) {
      // The wording matches the §12 R26 dialog's refusal grammar (mockups/storage-change.html).
      throw new StorageChangeError(
        `a backup named ${collisions[0]} already exists in ${newBackupDir} — migrate never ` +
          `overwrites; remove it or pick a different directory, or choose start fresh to ` +
          `leave existing backups put; nothing has changed`,
        newBackupDir,
      );
    }
  }

  // Stage 2 — the fresh backup into the NEW directory (both modes). Retention 0: this
  // pipeline never prunes (see the function comment); a null backupDb means the latest
  // backup already there is byte-identical to the checkpointed database, so it IS the
  // fresh backup. Unlike the best-effort launch backup, a failure here STOPS the change.
  let freshBackup: BackupInfo | null;
  try {
    freshBackup =
      backupDb(dbPath, db, {
        retention: 0,
        backupDir: newBackupDir,
        ...(opts.at !== undefined ? { at: opts.at } : {}),
      }) ?? latestBackup(dbPath, newBackupDir);
  } catch (err) {
    throw new StorageChangeError(
      `no fresh backup could be written to ${newBackupDir}: ${(err as Error).message} — ` +
        `nothing has changed`,
      newBackupDir,
    );
  }
  if (freshBackup === null) {
    // Unreachable while the database exists on disk; refuse rather than proceed unprobed.
    throw new StorageChangeError(
      `no fresh backup could be written to ${newBackupDir} — nothing has changed`,
      newBackupDir,
    );
  }

  // Stage 3 — migrate's verified copies, over the SAME listing the gates judged (the
  // fresh backup already lives in the new directory and is never part of the move).
  let moved: BackupInfo[] = [];
  if (mode === 'migrate') {
    try {
      moved = copyBackupsVerified(originals, newBackupDir, opts.copyFile);
    } catch (err) {
      throw new StorageChangeError(
        `the move to ${newBackupDir} was aborted: ${(err as Error).message}; both backup ` +
          `sets are intact — every original backup stays in ${oldBackupDir} and the fresh ` +
          `backup at ${newBackupDir} stays; the config file is untouched and ` +
          `${oldBackupDir} is still the active backup directory`,
        newBackupDir,
      );
    }
  }

  // Stage 4 — the atomic commit (§13). Toward the default rung (beside the database) the
  // commit DELETES the key — reset semantics; a resolved default is never written.
  const committedDefault = resolve(newBackupDir) === resolve(dirname(dbPath));
  if (committedDefault) {
    resetConfigKey(configFile, 'backupDir');
  } else {
    const config = readConfig(configFile);
    config.backupDir = newBackupDir;
    writeConfig(configFile, config);
  }

  // Stage 5 — post-commit, migrate deletes the (now redundant, verified) originals.
  if (mode === 'migrate') deleteBackupOriginals(originals);

  const did =
    mode === 'migrate'
      ? originals.length > 0
        ? `moved ${originals.length} backup${originals.length === 1 ? '' : 's'} to ` +
          `${newBackupDir} — every copy verified before the originals were removed from ` +
          `${oldBackupDir}`
        : `the backup directory is now ${newBackupDir} (no existing backups to move)`
      : `starting fresh at ${newBackupDir}; existing backups stay put, untouched, in ` +
        `${oldBackupDir}`;
  return {
    outcome: mode === 'migrate' ? 'moved' : 'started-fresh',
    oldBackupDir,
    newBackupDir,
    freshBackup,
    moved,
    committedDefault,
    configFile,
    message: `${did}; a fresh backup of the database was written to ${newBackupDir} first`,
  };
}
