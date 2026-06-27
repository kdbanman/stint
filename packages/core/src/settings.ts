/**
 * Settings and their defaults (PRD §14). Stored as key/value text rows; this module
 * gives them a typed, defaulted interface.
 */
import type { Db } from './db.js';

export type WeekStart = 'monday' | 'sunday';
/** Accent usage (PRD §12 R11, §15): the system accent on the primary action, or fully monochrome. */
export type AccentMode = 'system' | 'monochrome';
/** Date format (PRD §12 R11): the runner's locale, or an unambiguous ISO rendering. */
export type DateFormat = 'system' | 'iso';

export interface Settings {
  /** Rounding off by default; stored time is always exact (PRD §09 R4). */
  rounding: boolean;
  /** Increment in minutes when rounding is on: 6 | 10 | 15 | 30. */
  roundingIncrementMin: number;
  weekStart: WeekStart;
  /** Minutes after start for the first check-in (PRD §10b). */
  firstCheckinMin: number;
  /** Minutes between subsequent check-ins. */
  checkinIntervalMin: number;
  /** Global hotkey, in Electron accelerator form. */
  globalHotkey: string;
  /**
   * §12 R11 — accent usage. 'system' lets the GUI paint the system accent on the primary
   * action / running state; 'monochrome' suppresses it entirely (the chrome stays inked).
   */
  accent: AccentMode;
  /**
   * §12 R11 — date/number rendering. 'system' uses the runner's locale; 'iso' renders an
   * unambiguous ISO time. A pure display preference — stored instants are always UTC ISO.
   */
  dateFormat: DateFormat;
  /**
   * §20 R04 — how many automatic timestamped backups to keep beside the database. On launch
   * the store writes a fresh backup if the DB changed since the last one, then prunes the
   * oldest so at most this many remain. Default 5; 0 disables retention pruning entirely.
   */
  backupRetention: number;
}

export const DEFAULT_SETTINGS: Settings = {
  rounding: false,
  roundingIncrementMin: 15,
  weekStart: 'monday',
  firstCheckinMin: 60,
  checkinIntervalMin: 30,
  globalHotkey: 'CommandOrControl+Alt+T',
  accent: 'system',
  dateFormat: 'system',
  backupRetention: 5,
};

const ALLOWED_INCREMENTS = [6, 10, 15, 30];

function requirePositiveMinutes(name: string, v: number): void {
  if (!Number.isInteger(v) || v <= 0) {
    throw new Error(`${name} must be a positive whole number of minutes`);
  }
}

/**
 * One descriptor per setting — the single source of the snake_case key, how a stored
 * string parses to a typed value, and how a new value is validated. `readSettings`,
 * the `config ls` table, and `config set` all derive from this, so adding a setting is
 * one row here instead of edits scattered across the CLI, GUI, and this module.
 */
type SettingDescriptor = {
  [K in keyof Settings]: {
    key: K;
    snake: string;
    /** Parse a stored/typed-in string; return undefined to reject (keep default). */
    parse: (raw: string) => Settings[K] | undefined;
    validate?: (value: Settings[K]) => void;
  };
}[keyof Settings];

export const SETTING_DESCRIPTORS: SettingDescriptor[] = [
  { key: 'rounding', snake: 'rounding', parse: (r) => r === 'true' || r === 'on' || r === '1' },
  {
    key: 'roundingIncrementMin',
    snake: 'rounding_increment_min',
    parse: (r) => Number(r),
    validate: (v) => {
      if (!ALLOWED_INCREMENTS.includes(v)) {
        throw new Error(`rounding increment must be one of ${ALLOWED_INCREMENTS.join(', ')} minutes`);
      }
    },
  },
  {
    key: 'weekStart',
    snake: 'week_start',
    parse: (r) => (r === 'monday' || r === 'sunday' ? r : undefined),
    validate: (v) => {
      if (v !== 'monday' && v !== 'sunday') throw new Error('week_start must be monday or sunday');
    },
  },
  {
    key: 'firstCheckinMin',
    snake: 'first_checkin_min',
    parse: (r) => Number(r),
    validate: (v) => requirePositiveMinutes('first_checkin_min', v),
  },
  {
    key: 'checkinIntervalMin',
    snake: 'checkin_interval_min',
    parse: (r) => Number(r),
    validate: (v) => requirePositiveMinutes('checkin_interval_min', v),
  },
  { key: 'globalHotkey', snake: 'global_hotkey', parse: (r) => r },
  {
    key: 'accent',
    snake: 'accent',
    parse: (r) => (r === 'system' || r === 'monochrome' ? r : undefined),
    validate: (v) => {
      if (v !== 'system' && v !== 'monochrome') throw new Error('accent must be system or monochrome');
    },
  },
  {
    key: 'dateFormat',
    snake: 'date_format',
    parse: (r) => (r === 'system' || r === 'iso' ? r : undefined),
    validate: (v) => {
      if (v !== 'system' && v !== 'iso') throw new Error('date_format must be system or iso');
    },
  },
  {
    key: 'backupRetention',
    snake: 'backup_retention',
    parse: (r) => Number(r),
    validate: (v) => {
      if (!Number.isInteger(v) || v < 0) {
        throw new Error('backup_retention must be a whole number of backups to keep (0 or more)');
      }
    },
  },
];

/** Look a descriptor up by its snake_case key (for `config set`). */
export function settingDescriptor(snake: string): SettingDescriptor | undefined {
  return SETTING_DESCRIPTORS.find((d) => d.snake === snake);
}

function rawGet(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function readSettings(db: Db): Settings {
  const out = { ...DEFAULT_SETTINGS };
  for (const d of SETTING_DESCRIPTORS) {
    const raw = rawGet(db, d.snake);
    if (raw === undefined) continue;
    const parsed = d.parse(raw);
    if (parsed === undefined) continue;
    // Reads are as strict as writes: a hand-corrupted stored value (e.g. a NaN
    // rounding increment) fails validation and falls back to the default rather than
    // leaking through.
    try {
      d.validate?.(parsed as never);
    } catch {
      continue;
    }
    // Each descriptor's key/parse are correlated, but the union loses that across the
    // loop; the assignment is sound by construction.
    (out as Record<string, unknown>)[d.key] = parsed;
  }
  return out;
}

export function writeSetting<K extends keyof Settings>(db: Db, key: K, value: Settings[K]): void {
  const d = SETTING_DESCRIPTORS.find((x) => x.key === key);
  if (!d) throw new Error(`unknown setting "${key}"`);
  d.validate?.(value as never);
  db.prepare(
    'INSERT INTO setting(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(d.snake, String(value));
}
