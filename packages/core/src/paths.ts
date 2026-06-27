/**
 * Database path resolution (PRD §13).
 *
 * macOS + Linux only — Windows is dropped everywhere (no win32 / %APPDATA% branch).
 * Both surfaces resolve the same path: `TT_DB` if set, else the OS's standard
 * per-user app-data directory holding `timetracker.sqlite`. The GUI may pass
 * Electron's `app.getPath('userData')` as `userDataDir` to match its own default.
 */
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export const DB_FILENAME = 'timetracker.sqlite';
export const APP_DIRNAME = 'stint';

/** The per-OS default data directory for Stint (without the filename). macOS + Linux only. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP_DIRNAME);
  }
  // Linux / other: XDG. (No Windows branch — Windows is unsupported.)
  const xdg = env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(xdg, APP_DIRNAME);
}

/**
 * Resolve the SQLite file path.
 * @param userDataDir If provided (e.g. Electron `userData`), used instead of the
 *   per-OS default — but `TT_DB` always wins so both surfaces agree.
 */
export function resolveDbPath(
  env: NodeJS.ProcessEnv = process.env,
  userDataDir?: string,
): string {
  if (env.TT_DB && env.TT_DB.trim() !== '') return env.TT_DB;
  const dir = userDataDir ?? defaultDataDir(env);
  return join(dir, DB_FILENAME);
}
