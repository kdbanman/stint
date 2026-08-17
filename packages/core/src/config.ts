/**
 * The storage config file (PRD §13, §20 R10) — the one configuration that cannot be a
 * Setting: a database row cannot say where to find the database, and corruption recovery
 * must find the backup directory BEFORE the database opens (§20 R05). Both surfaces read
 * this small JSON file before anything opens.
 *
 * Location: `$XDG_CONFIG_HOME/stint/config.json` (default `~/.config/stint/config.json`)
 * on Linux, `~/Library/Application Support/stint/config.json` on macOS, with `TT_CONFIG`
 * overriding the file's own location (test isolation — the TT_DB pattern). It holds
 * exactly two OPTIONAL keys — `dbPath`, `backupDir` — absolute paths only. An absent key
 * (or an absent file) means the next rung of the §13 ladder; RESET means deleting the key
 * — a resolved default is never written into the file. A file that cannot be trusted —
 * unparseable JSON, an unknown key, a relative path — refuses the launch loudly, naming
 * the file and the error, and no guessed or fallback path is ever used (§20 R10: opening
 * the default while the user's config points elsewhere is the phantom-empty-tracker
 * failure). The published contract is acceptance/criteria/schemas/config.schema.json.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

export const CONFIG_FILENAME = 'config.json';
const APP_DIRNAME = 'stint';

/** The two optional absolute-path keys — the config file's whole vocabulary (§13). */
export const CONFIG_KEYS = ['dbPath', 'backupDir'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

/** The parsed, validated config file. Every field optional; every value an absolute path. */
export interface StintConfig {
  dbPath?: string;
  backupDir?: string;
}

/**
 * §20 R10 — the config file cannot be trusted. The message names the file and the error
 * (the done-when), and the typed class lets each surface catch it precisely for its own
 * fatal-open surfacing (tt: non-zero exit; GUI: the Reset-to-default / Quit dialog).
 */
export class ConfigError extends Error {
  /** The config file the error is about (already named in the message; typed for the GUI dialog). */
  readonly file: string;
  constructor(file: string, detail: string) {
    super(`config file ${file}: ${detail}`);
    this.name = 'ConfigError';
    this.file = file;
  }
}

/** The per-OS default config directory (without the filename). macOS + Linux only — no win32 branch. */
export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP_DIRNAME);
  }
  // Linux / other: XDG config home. (No Windows branch — Windows is unsupported.)
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() !== '' ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
  return join(xdg, APP_DIRNAME);
}

/**
 * §13/§20 R10 — validate an already-parsed config value. One rule for read AND write, so
 * core can never itself produce a file its next launch would refuse. Throws ConfigError
 * naming the file and the exact violation; returns the typed config on success.
 */
function validateConfig(file: string, value: unknown): StintConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(file, 'must be a JSON object holding only the optional keys dbPath and backupDir');
  }
  const out: StintConfig = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      throw new ConfigError(file, `unknown key "${key}" (allowed keys: ${CONFIG_KEYS.join(', ')})`);
    }
    if (typeof raw !== 'string') {
      throw new ConfigError(file, `${key} must be a string holding an absolute path`);
    }
    if (!isAbsolute(raw)) {
      throw new ConfigError(file, `${key} must be an absolute path (got "${raw}")`);
    }
    out[key as ConfigKey] = raw;
  }
  return out;
}

/**
 * §13 — read and validate the config file. An ABSENT file is an empty config (every path
 * takes the next rung down); anything present but untrusted throws ConfigError (§20 R10).
 */
export function readConfig(file: string): StintConfig {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    // Present but unreadable (permissions, a directory at the path) — untrusted, not absent.
    throw new ConfigError(file, `cannot be read: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(file, `is not valid JSON: ${(err as Error).message}`);
  }
  return validateConfig(file, parsed);
}

/**
 * §13 — the atomic write primitive: write a sibling temp file, then rename over the
 * target. The rename is the single commit point (a §12 R26 change commits here), so a
 * crash mid-write leaves the old config intact, never a half-written file the next
 * launch would refuse. Validates before writing — core never produces an untrusted file.
 * Creates the config DIRECTORY if needed (the config home is ours to make; the no-mkdir
 * rule of §20 R11 protects DATA paths, not the config file's own home).
 */
export function writeConfig(file: string, config: StintConfig): void {
  validateConfig(file, config);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * §13 — reset-to-default semantics: DELETE the key (a resolved default is never written
 * into the file), committed through the same atomic write. A missing file is already
 * fully reset, so it is a no-op.
 */
export function resetConfigKey(file: string, key: ConfigKey): void {
  const config = readConfig(file);
  if (config[key] === undefined) return;
  delete config[key];
  writeConfig(file, config);
}

/**
 * §20 R10 reset — repair an UNTRUSTED config file by §13's reset semantics: delete the
 * offending key(s), keep every valid one, commit through the atomic write. A file that
 * cannot even be parsed (invalid JSON, unreadable, not an object) has no reachable keys,
 * so it is set ASIDE to a timestamped `.invalid-*` sibling — the §13 absent-file state IS
 * the fully-reset config, and the user's bytes survive for inspection (never destroyed).
 * Lives HERE, not in a surface: which entries survive is knowledge of the config file's
 * shape, and only this module holds that shape (the GUI's R10 dialog is the one caller).
 */
export function resetUntrustedConfig(file: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    setAsideInvalid(file);
    return;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    setAsideInvalid(file);
    return;
  }
  // Keep exactly the entries readConfig would accept; every offending one is the reset's
  // delete-the-key. writeConfig re-validates, so this can never write an untrusted file.
  const repaired: StintConfig = {};
  for (const key of CONFIG_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === 'string' && isAbsolute(value)) repaired[key] = value;
  }
  writeConfig(file, repaired);
}

/** Move an unparseable config aside (never delete user bytes) so a relaunch starts reset. */
function setAsideInvalid(file: string): void {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  renameSync(file, `${file}.invalid-${stamp}`);
}
