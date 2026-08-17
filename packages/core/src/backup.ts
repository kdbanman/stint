/**
 * Automatic backups, integrity checks, and corruption recovery (PRD §20 R03/R04/R05,
 * §17 R12). The CORE data-loss-protection layer.
 *
 * A backup is a checkpointed plain copy of the SQLite main file, written into the
 * ACTIVE backup directory (§13's ladder — default: beside the database) as
 * `<dbfilename>.bak-<YYYYMMDDTHHMMSSZ>` — the filename keeps that shape wherever the
 * directory lives (§20 R04). Backups are files, not a table: they must survive even a
 * corrupt main file, and recovery must find them BEFORE the database opens (§20 R05),
 * which is why the directory resolves through the config file, never a settings row.
 * Every function takes the directory as an optional trailing parameter defaulting to
 * beside-the-DB, so the default rung stays byte-compatible with the pre-ladder behavior.
 *
 * Everything here is pure `node:fs` over the local filesystem — NO network, ever
 * (PRD §17 R9). All copies are checkpoint-then-`copyFileSync`, so a backup is a single,
 * self-contained file with no dependent WAL.
 */
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { Db } from './db.js';

/** One backup file in the active backup directory, newest-first when listed. */
export interface BackupInfo {
  /** The backup file's base name (e.g. `timetracker.sqlite.bak-20260627T101500Z`). */
  name: string;
  /** The absolute path to the backup file. */
  path: string;
  /** The UTC instant encoded in the name (ISO 8601), or the file mtime if unparseable. */
  createdUtc: string;
  /** The backup file's size in bytes. */
  sizeBytes: number;
}

/** The outcome of a corruption recovery (PRD §20 R05) — what was lost-to-quarantine and restored. */
export interface RecoveryResult {
  /** The backup file the restored database was copied from. */
  recoveredFrom: string;
  /** Where the corrupt main file was moved (a `.corrupted-<ts>` sibling). */
  quarantinedTo: string;
}

/**
 * §20 R05 — recovery could not proceed because there was no good backup to restore from.
 * We never silently lose data: the corrupt file is LEFT IN PLACE (not quarantined) and this
 * is thrown so the caller can surface it, rather than starting on an empty database.
 */
export class RecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryError';
  }
}

const BAK_INFIX = '.bak-';
const TS_RE = /\.bak-(\d{8}T\d{6}Z)$/;

/** A filename-safe `YYYYMMDDTHHMMSSZ` UTC stamp from a Date (default now). */
export function backupStamp(at: Date = new Date()): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Decode a `.bak-YYYYMMDDTHHMMSSZ` suffix back to an ISO instant, or null if it doesn't match. */
function stampToIso(name: string): string | null {
  const m = TS_RE.exec(name);
  if (!m) return null;
  const s = m[1]!; // YYYYMMDDTHHMMSSZ
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
}

/**
 * §20 R14 — whether the backup directory can actually receive a backup, as a value: the
 * directory plus the problem (or null when healthy). A dead durability net must be
 * surfaced everywhere backups speak — `tt backup ls|now`, the Settings Backups section —
 * never silently rendered as "no backups". Core states the fact; each surface phrases it.
 */
export interface BackupDirState {
  path: string;
  ok: boolean;
  /** The plain problem ("does not exist" / "is not a directory" / "is not writable"), or null when ok. */
  problem: string | null;
}

/** §20 R14 — probe the active backup directory (exists, is a directory, is writable). */
export function backupDirState(dir: string): BackupDirState {
  if (!existsSync(dir)) return { path: dir, ok: false, problem: 'does not exist' };
  if (!statSync(dir).isDirectory()) return { path: dir, ok: false, problem: 'is not a directory' };
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    return { path: dir, ok: false, problem: 'is not writable' };
  }
  return { path: dir, ok: true, problem: null };
}

/**
 * All backups of `dbPath` in the active backup directory (default: beside the DB),
 * newest-first. Sorted by the timestamp encoded in the name (stable, since the name's UTC
 * stamp is the truth of when the snapshot was taken), with the file mtime as a tiebreaker
 * for same-second names.
 */
export function listBackups(dbPath: string, backupDir: string = dirname(dbPath)): BackupInfo[] {
  const dir = backupDir;
  const prefix = basename(dbPath) + BAK_INFIX;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const path = join(dir, name);
    let sizeBytes = 0;
    let mtimeMs = 0;
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      sizeBytes = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      continue;
    }
    out.push({
      name,
      path,
      createdUtc: stampToIso(name) ?? new Date(mtimeMs).toISOString(),
      sizeBytes,
    });
  }
  // Newest-first: the name's stamp is the primary key (lexicographic == chronological for the
  // fixed-width stamp), mtime breaks ties for any same-second names.
  return out.sort((a, b) => (b.name < a.name ? -1 : b.name > a.name ? 1 : 0));
}

/** The newest backup in the active backup directory, or null when none exist. */
export function latestBackup(dbPath: string, backupDir: string = dirname(dbPath)): BackupInfo | null {
  return listBackups(dbPath, backupDir)[0] ?? null;
}

/**
 * §20 R03 — run `PRAGMA quick_check` and report the result. `quick_check` is the fast
 * structural check SQLite recommends at startup (it skips the exhaustive `integrity_check`
 * UNIQUE/row-count pass) — enough to detect a corrupt page/header, which is what recovery
 * keys off. Returns `{ ok: true }` when the database reports `ok`, otherwise the detail.
 */
export function checkIntegrity(db: Db): { ok: boolean; detail: string } {
  try {
    const rows = db.prepare('PRAGMA quick_check').all() as { quick_check?: string }[];
    const messages = rows
      .map((r) => r.quick_check ?? Object.values(r)[0])
      .filter((v): v is string => typeof v === 'string');
    const ok = messages.length === 1 && messages[0] === 'ok';
    return { ok, detail: ok ? 'ok' : messages.join('; ') || 'integrity check failed' };
  } catch (err) {
    // A throw here (the handle cannot even run the pragma) is itself a corruption signal.
    return { ok: false, detail: (err as Error).message };
  }
}

/** The WAL/SHM sidecar paths SQLite keeps beside a WAL-mode main file. */
function siblings(dbPath: string): string[] {
  return [`${dbPath}-wal`, `${dbPath}-shm`];
}

/** A cheap content fingerprint of a file's bytes (SHA-256), for change detection. */
function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * §20 R04 — write a fresh timestamped backup into the active backup directory IF the DB
 * content changed since the latest existing backup; otherwise no-op (so an idempotent
 * relaunch never piles up identical copies). Always checkpoints the WAL first
 * (`wal_checkpoint(TRUNCATE)`) so the main file is self-contained before it is copied.
 * After a write, prunes the oldest so at most `retention` remain (0 ⇒ no pruning).
 * Returns the new BackupInfo, or null when unchanged.
 *
 * "Changed" is judged by a content HASH of the checkpointed main file, not its size: under WAL
 * the main file can stay the same size across edits (pages are rewritten in place / via the WAL
 * that the checkpoint folds back), so a size compare would miss real changes. We compare the
 * current main-file hash to the latest backup's hash and skip the copy only when they match.
 */
export function backupDb(
  dbPath: string,
  db: Db,
  opts: { retention?: number; at?: Date; backupDir?: string } = {},
): BackupInfo | null {
  if (dbPath === ':memory:') return null;
  const backupDir = opts.backupDir ?? dirname(dbPath);
  // Fold the WAL back into the main file so the copy is a complete, dependency-free snapshot.
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* a fresh/empty WAL or a non-WAL handle is fine — the main file is still copyable */
  }
  if (!existsSync(dbPath)) return null;
  const latest = latestBackup(dbPath, backupDir);
  // Idempotent relaunch: if the newest backup is byte-for-byte identical to the current main
  // file, the DB has not changed since it was taken — skip the duplicate copy.
  if (latest && fileHash(dbPath) === fileHash(latest.path)) return null;

  const name = `${basename(dbPath)}${BAK_INFIX}${backupStamp(opts.at ?? new Date())}`;
  const path = join(backupDir, name);
  copyFileSync(dbPath, path);

  pruneBackups(dbPath, opts.retention ?? 5, backupDir);
  const st = statSync(path);
  return {
    name,
    path,
    createdUtc: stampToIso(name) ?? new Date(st.mtimeMs).toISOString(),
    sizeBytes: st.size,
  };
}

/** Keep at most `retention` newest backups in the active directory; delete the rest. 0 ⇒ keep all. */
export function pruneBackups(
  dbPath: string,
  retention: number,
  backupDir: string = dirname(dbPath),
): void {
  if (retention <= 0) return;
  const all = listBackups(dbPath, backupDir); // newest-first
  for (const old of all.slice(retention)) {
    try {
      unlinkSync(old.path);
    } catch {
      /* best-effort prune; a locked/already-gone file must not abort the backup */
    }
  }
}

/**
 * §20 R05 — quarantine a corrupt main file and restore from the latest good backup in the
 * ACTIVE backup directory (§13 — resolved before the database opens), never silently losing
 * data. Moves the corrupt main file (and any WAL/SHM siblings) aside to
 * `<dbPath>.corrupted-<ts>` and copies the newest backup into `<dbPath>`. Throws RecoveryError
 * — WITHOUT quarantining — when there is no backup to restore from, so the caller can surface
 * the failure rather than start fresh on an empty database.
 *
 * The DB handle MUST be closed before calling this (the file is renamed/replaced on disk).
 */
export function quarantineAndRecover(
  dbPath: string,
  at: Date = new Date(),
  backupDir: string = dirname(dbPath),
): RecoveryResult {
  const latest = latestBackup(dbPath, backupDir);
  if (!latest) {
    // No good copy: leave the corrupt file in place (do not destroy it) and signal up.
    throw new RecoveryError(
      `database at ${dbPath} failed its integrity check and no backup exists to recover from`,
    );
  }
  const stamp = backupStamp(at);
  const quarantinedTo = `${dbPath}.corrupted-${stamp}`;
  // Move the corrupt main file aside, then its WAL/SHM siblings (suffixed to stay grouped).
  renameSync(dbPath, quarantinedTo);
  for (const sib of siblings(dbPath)) {
    if (existsSync(sib)) {
      try {
        renameSync(sib, `${quarantinedTo}${sib.slice(dbPath.length)}`);
      } catch {
        try {
          unlinkSync(sib);
        } catch {
          /* a stale sidecar must not block recovery */
        }
      }
    }
  }
  copyFileSync(latest.path, dbPath);
  return { recoveredFrom: latest.name, quarantinedTo };
}

/**
 * §20 R05 / §17 R12 — restore the database from a named backup on demand (the GUI Restore…
 * button and `tt backup restore <name>`). Quarantines the CURRENT main file (and its WAL/SHM
 * siblings) to a `.replaced-<ts>` sibling first — so the live data is never destroyed, only
 * set aside — then copies the chosen backup into place. Throws when the named backup is
 * unknown. The DB handle MUST be closed before calling this.
 */
export function restoreFromBackup(
  dbPath: string,
  backupName: string,
  at: Date = new Date(),
  backupDir: string = dirname(dbPath),
): RecoveryResult {
  const chosen = listBackups(dbPath, backupDir).find((b) => b.name === backupName);
  if (!chosen) throw new RecoveryError(`no backup named "${backupName}" in ${backupDir}`);
  const stamp = backupStamp(at);
  const quarantinedTo = `${dbPath}.replaced-${stamp}`;
  if (existsSync(dbPath)) {
    renameSync(dbPath, quarantinedTo);
    for (const sib of siblings(dbPath)) {
      if (existsSync(sib)) {
        try {
          renameSync(sib, `${quarantinedTo}${sib.slice(dbPath.length)}`);
        } catch {
          try {
            unlinkSync(sib);
          } catch {
            /* a stale sidecar must not block the restore */
          }
        }
      }
    }
  }
  copyFileSync(chosen.path, dbPath);
  return { recoveredFrom: chosen.name, quarantinedTo };
}
