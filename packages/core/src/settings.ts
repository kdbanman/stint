/**
 * Settings and their defaults (PRD §14). Stored as key/value text rows; this module
 * gives them a typed, defaulted interface.
 */
import type { Db } from './db.js';

export type WeekStart = 'monday' | 'sunday';

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
}

export const DEFAULT_SETTINGS: Settings = {
  rounding: false,
  roundingIncrementMin: 15,
  weekStart: 'monday',
  firstCheckinMin: 60,
  checkinIntervalMin: 30,
  globalHotkey: 'CommandOrControl+Alt+T',
};

const KEYS: Record<keyof Settings, string> = {
  rounding: 'rounding',
  roundingIncrementMin: 'rounding_increment_min',
  weekStart: 'week_start',
  firstCheckinMin: 'first_checkin_min',
  checkinIntervalMin: 'checkin_interval_min',
  globalHotkey: 'global_hotkey',
};

const ALLOWED_INCREMENTS = [6, 10, 15, 30];

function rawGet(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function readSettings(db: Db): Settings {
  const out = { ...DEFAULT_SETTINGS };
  const rounding = rawGet(db, KEYS.rounding);
  if (rounding !== undefined) out.rounding = rounding === 'true';
  const inc = rawGet(db, KEYS.roundingIncrementMin);
  if (inc !== undefined) out.roundingIncrementMin = Number(inc);
  const ws = rawGet(db, KEYS.weekStart);
  if (ws === 'monday' || ws === 'sunday') out.weekStart = ws;
  const fc = rawGet(db, KEYS.firstCheckinMin);
  if (fc !== undefined) out.firstCheckinMin = Number(fc);
  const ci = rawGet(db, KEYS.checkinIntervalMin);
  if (ci !== undefined) out.checkinIntervalMin = Number(ci);
  const hk = rawGet(db, KEYS.globalHotkey);
  if (hk !== undefined) out.globalHotkey = hk;
  return out;
}

export function writeSetting<K extends keyof Settings>(
  db: Db,
  key: K,
  value: Settings[K],
): void {
  if (key === 'roundingIncrementMin' && !ALLOWED_INCREMENTS.includes(value as number)) {
    throw new Error(
      `rounding increment must be one of ${ALLOWED_INCREMENTS.join(', ')} minutes`,
    );
  }
  const str = typeof value === 'boolean' ? String(value) : String(value);
  db.prepare(
    'INSERT INTO setting(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(KEYS[key], str);
}
