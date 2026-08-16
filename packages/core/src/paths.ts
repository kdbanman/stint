/**
 * Storage path resolution (PRD §13) — the three ladders, first rung wins:
 *
 *   database          TT_DB          → config `dbPath`     → per-OS app-data default
 *   backup directory  TT_BACKUP_DIR  → config `backupDir`  → beside the resolved database
 *   config file       TT_CONFIG      → per-OS config location
 *
 * One shared resolver serves both surfaces, with nothing passed extra, so their effective
 * paths can never disagree — what `tt paths` prints and the Settings Storage group shows.
 * macOS + Linux only — Windows is dropped everywhere (no win32 / %APPDATA% branch).
 * The GUI may pass Electron's `app.getPath('userData')` as `userDataDir` for the
 * database's DEFAULT rung; the env and config rungs always outrank it.
 */
import { accessSync, existsSync, statSync, constants } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { CONFIG_FILENAME, defaultConfigDir, readConfig } from './config.js';

export const DB_FILENAME = 'timetracker.sqlite';
const APP_DIRNAME = 'stint';

/** The rung of a §13 ladder that set an effective path. */
export type PathSource = 'env' | 'config' | 'default';

/** An effective path: the path a surface actually uses, plus the rung that set it. */
export interface EffectivePath {
  path: string;
  source: PathSource;
}

/** The three effective storage paths (§13) — the whole read side of `tt paths` / §12 R25. */
export interface StoragePaths {
  db: EffectivePath;
  backupDir: EffectivePath;
  /** The config file's own effective path; its ladder has no config rung (`env` or `default`). */
  configFile: EffectivePath;
}

/**
 * §20 R11 — the configured database path cannot be used. The message names the configured
 * path AND the config file that set it (the done-when); the typed class lets each surface
 * catch it precisely for its fatal-open surfacing (tt: non-zero exit; GUI: the R10 dialog).
 */
export class StoragePathError extends Error {
  readonly path: string;
  readonly configFile: string;
  constructor(message: string, path: string, configFile: string) {
    super(message);
    this.name = 'StoragePathError';
    this.path = path;
    this.configFile = configFile;
  }
}

/** The per-OS default data directory for Stint (without the filename). macOS + Linux only. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP_DIRNAME);
  }
  // Linux / other: XDG. (No Windows branch — Windows is unsupported.)
  const xdg = env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(xdg, APP_DIRNAME);
}

/** A set, non-blank env var — the shape of an occupied env rung. */
function envRung(value: string | undefined): string | undefined {
  return value && value.trim() !== '' ? value : undefined;
}

/** The config file's own effective path: `TT_CONFIG`, else the per-OS config location. */
export function resolveConfigPath(env: NodeJS.ProcessEnv = process.env): EffectivePath {
  const fromEnv = envRung(env.TT_CONFIG);
  if (fromEnv !== undefined) return { path: fromEnv, source: 'env' };
  return { path: join(defaultConfigDir(env), CONFIG_FILENAME), source: 'default' };
}

/**
 * §13 — resolve all three effective paths. Reads and validates the config file, so an
 * untrusted config refuses HERE, before anything opens (§20 R10 — the ConfigError
 * propagates; no rung is ever guessed around a bad file, even when env vars would cover
 * every value). The R11 use-the-path gate is separate ({@link assertDbPathUsable}):
 * resolution stays pure so the read side (`tt paths`) can report a configured-but-broken
 * path instead of refusing to display it.
 */
export function resolveStoragePaths(
  env: NodeJS.ProcessEnv = process.env,
  userDataDir?: string,
): StoragePaths {
  const configFile = resolveConfigPath(env);
  const config = readConfig(configFile.path);

  const dbEnv = envRung(env.TT_DB);
  const db: EffectivePath =
    dbEnv !== undefined
      ? { path: dbEnv, source: 'env' }
      : config.dbPath !== undefined
        ? { path: config.dbPath, source: 'config' }
        : { path: join(userDataDir ?? defaultDataDir(env), DB_FILENAME), source: 'default' };

  const backupEnv = envRung(env.TT_BACKUP_DIR);
  const backupDir: EffectivePath =
    backupEnv !== undefined
      ? { path: backupEnv, source: 'env' }
      : config.backupDir !== undefined
        ? { path: config.backupDir, source: 'config' }
        : { path: dirname(db.path), source: 'default' };

  return { db, backupDir, configFile };
}

/**
 * §20 R11 — the launch gate over a CONFIG-set database path. An absent file whose parent
 * directory exists and is writable is first-run semantics (create there, exactly as TT_DB
 * behaves); a missing or unusable parent refuses loudly, naming the configured path and
 * the config file that set it. NO auto-mkdir — a missing parent is the signature of an
 * unmounted volume or a moved directory, and creating it would strand data on the wrong
 * filesystem. Never a silent fallback to the default path (the phantom-empty-tracker
 * failure, §20 R10). The env and default rungs keep their existing semantics: the default
 * app-data directory is ours to create, and TT_DB is the caller's explicit choice.
 */
export function assertDbPathUsable(paths: StoragePaths): void {
  const { db, configFile } = paths;
  if (db.source !== 'config') return;
  if (existsSync(db.path)) return; // an existing file at the configured path simply opens
  const parent = dirname(db.path);
  const refuse = (why: string): never => {
    throw new StoragePathError(
      `cannot open database at ${db.path}: its parent directory ${parent} ${why} ` +
        `(path set by config file ${configFile.path}); the directory is not created ` +
        `automatically — restore it or edit the config file`,
      db.path,
      configFile.path,
    );
  };
  if (!existsSync(parent)) refuse('does not exist');
  if (!statSync(parent).isDirectory()) refuse('is not a directory');
  try {
    accessSync(parent, constants.W_OK);
  } catch {
    refuse('is not writable');
  }
}

/**
 * Resolve the SQLite file path through the §13 ladder (the database row of
 * {@link resolveStoragePaths}). Reads the config file, so an untrusted config throws
 * ConfigError here (§20 R10).
 * @param userDataDir If provided (e.g. Electron `userData`), used for the DEFAULT rung —
 *   `TT_DB` and the config file's `dbPath` always outrank it so both surfaces agree.
 */
export function resolveDbPath(
  env: NodeJS.ProcessEnv = process.env,
  userDataDir?: string,
): string {
  return resolveStoragePaths(env, userDataDir).db.path;
}
