/**
 * Settings and their defaults (PRD §14). Stored as key/value text rows; this module
 * gives them a typed, defaulted interface.
 */
import type { Db } from './db.js';
import { isSupportedTimeZone } from './time.js';

export type WeekStart = 'monday' | 'sunday';
/** Date format (PRD §12 R11): the runner's locale, or an unambiguous ISO rendering. */
export type DateFormat = 'system' | 'iso';
/**
 * §14 — which default viewport the interval picker opens to (G16): the configured working
 * hours, or a window centered on now. A display preference, not core (§03); the entries
 * calendar always defaults to working hours regardless of this mode (§12 R16).
 */
export type PickerWindowMode = 'working_hours' | 'around_now';

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
   * §12 R11 — date/number rendering. 'system' uses the runner's locale; 'iso' renders an
   * unambiguous ISO time. A pure display preference — stored instants are always UTC ISO.
   */
  dateFormat: DateFormat;
  /**
   * §04 R06 / §14 — the zone display, wall-clock parsing, day buckets, and range presets
   * resolve in: the literal sentinel `'system'` (resolved against the OS at read time, so
   * it follows OS zone changes) or an explicit IANA zone (e.g. `America/Edmonton`), which
   * pins it. Validated against the platform zone list. A display/derivation preference —
   * stored instants are always UTC ISO (§04 R06).
   */
  timeZone: string;
  /**
   * §14 — the working-hours pair shaping the default timeline viewport (G15/G16): strict
   * zero-padded HH:MM, start strictly before end. The interval picker (§12 R15) opens to
   * this window when pickerWindowMode is 'working_hours'; the entries calendar (§12 R16)
   * always does. A scroll window over the full 24-hour track, never a clipped one.
   */
  workingHoursStart: string;
  workingHoursEnd: string;
  /** §14 — which default viewport the picker opens to: working hours, or around now. */
  pickerWindowMode: PickerWindowMode;
  /**
   * §14 — the total hours of the around-now window (centered on now), a whole number
   * from 1 to 24. Only consulted when pickerWindowMode is 'around_now'.
   */
  pickerAroundHours: number;
  /**
   * §14 / §12 R23 — the two drag-snap resolutions every time-surface drag lands on: fine
   * (with the ephemeral fine-snap toggle on) and coarse (the default on every open). Whole
   * minutes from 1 to 30 with fine ≤ coarse. Input preferences, not core (§03): the snap
   * never rewrites a value that isn't actively dragged.
   */
  snapFineMinutes: number;
  snapCoarseMinutes: number;
  /**
   * §14 / §12 R09 — whether the Entries week grid shows Saturday/Sunday. One row driven by
   * BOTH the Entries-toolbar toggle and the Settings-view control. A display preference,
   * not core (§03): a hidden weekend day changes nothing stored or reported.
   */
  showWeekend: boolean;
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
  dateFormat: 'system',
  timeZone: 'system',
  workingHoursStart: '07:00',
  workingHoursEnd: '18:00',
  pickerWindowMode: 'working_hours',
  pickerAroundHours: 8,
  snapFineMinutes: 5,
  snapCoarseMinutes: 15,
  showWeekend: false,
  backupRetention: 5,
};

const ALLOWED_INCREMENTS = [6, 10, 15, 30];

/** §14 — strict zero-padded 24h HH:MM ('07:00', '23:59'; never '7:00' or '25:00'). */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function requireHhmm(name: string, v: string): void {
  if (!HHMM_RE.test(v)) {
    throw new Error(`${name} must be a zero-padded 24h HH:MM time (e.g. 07:00)`);
  }
}

function requirePositiveMinutes(name: string, v: number): void {
  if (!Number.isInteger(v) || v <= 0) {
    throw new Error(`${name} must be a positive whole number of minutes`);
  }
}

/** §14 — a snap resolution: whole minutes from 1 to 30 (a fraction or 0/31 is rejected). */
function requireSnapMinutes(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 1 || v > 30) {
    throw new Error(`${name} must be a whole number of minutes from 1 to 30`);
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
    key: 'dateFormat',
    snake: 'date_format',
    parse: (r) => (r === 'system' || r === 'iso' ? r : undefined),
    validate: (v) => {
      if (v !== 'system' && v !== 'iso') throw new Error('date_format must be system or iso');
    },
  },
  {
    key: 'timeZone',
    snake: 'time_zone',
    // §14 — 'system' (follow the OS at read time) or a platform-supported IANA zone; any
    // other value is rejected rather than stored (validate below carries the descriptive
    // message, so a mistyped `tt config set` names the fix), and reads are as strict as
    // writes (readSettings re-validates, so a hand-corrupted zone falls back to 'system').
    parse: (r) => r,
    validate: (v) => {
      if (v !== 'system' && !isSupportedTimeZone(v)) {
        throw new Error(
          `time_zone must be "system" or an IANA time zone the platform supports (e.g. America/Edmonton)`,
        );
      }
    },
  },
  // §14 — the timeline-window settings (G15). Key-value rows in the existing `setting`
  // table (no schema migration); the descriptor list is what puts them on `tt config
  // ls/set` and the GUI setSetting channel automatically. The start<end pair rule is
  // cross-field, so it lives in writeSetting/readSettings, not a single descriptor.
  {
    key: 'workingHoursStart',
    snake: 'working_hours_start',
    parse: (r) => (HHMM_RE.test(r) ? r : undefined),
    validate: (v) => requireHhmm('working_hours_start', v),
  },
  {
    key: 'workingHoursEnd',
    snake: 'working_hours_end',
    parse: (r) => (HHMM_RE.test(r) ? r : undefined),
    validate: (v) => requireHhmm('working_hours_end', v),
  },
  {
    key: 'pickerWindowMode',
    snake: 'picker_window_mode',
    parse: (r) => (r === 'working_hours' || r === 'around_now' ? r : undefined),
    validate: (v) => {
      if (v !== 'working_hours' && v !== 'around_now') {
        throw new Error('picker_window_mode must be working_hours or around_now');
      }
    },
  },
  {
    key: 'pickerAroundHours',
    snake: 'picker_around_hours',
    parse: (r) => Number(r),
    validate: (v) => {
      if (!Number.isInteger(v) || v < 1 || v > 24) {
        throw new Error('picker_around_hours must be a whole number of hours from 1 to 24');
      }
    },
  },
  // §14 / §12 R09/R23 — the Entries-calendar settings: the two drag-snap resolutions and
  // show_weekend. Key-value rows in the existing `setting` table (no schema migration); the
  // descriptor list is what puts them on `tt config ls/set` and the GUI setSetting channel
  // automatically. The fine ≤ coarse pair rule is cross-field, so it lives in
  // writeSetting/readSettings, not a single descriptor.
  {
    key: 'snapFineMinutes',
    snake: 'snap_fine_minutes',
    parse: (r) => Number(r),
    validate: (v) => requireSnapMinutes('snap_fine_minutes', v),
  },
  {
    key: 'snapCoarseMinutes',
    snake: 'snap_coarse_minutes',
    parse: (r) => Number(r),
    validate: (v) => requireSnapMinutes('snap_coarse_minutes', v),
  },
  {
    key: 'showWeekend',
    snake: 'show_weekend',
    // §14 — a strict boolean: a value outside the recognized true/false tokens is rejected
    // rather than stored (unlike `rounding`, whose looser coercion predates the rule), so
    // `tt config set show_weekend banana` diagnoses instead of silently meaning "off".
    parse: (r) =>
      r === 'true' || r === 'on' || r === '1'
        ? true
        : r === 'false' || r === 'off' || r === '0'
          ? false
          : undefined,
    validate: (v) => {
      if (typeof v !== 'boolean') throw new Error('show_weekend must be a boolean (on or off)');
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
  // §14 — the working-hours pair rule (start strictly before end) is cross-field, so it
  // runs after the per-key loop. Reads are as strict as writes: a hand-corrupted stored
  // pair that violates start<end resets BOTH keys to their documented defaults rather
  // than leaking an inverted window through. Plain string compare is sound on the
  // zero-padded HH:MM values the per-key validation guarantees.
  if (out.workingHoursStart >= out.workingHoursEnd) {
    out.workingHoursStart = DEFAULT_SETTINGS.workingHoursStart;
    out.workingHoursEnd = DEFAULT_SETTINGS.workingHoursEnd;
  }
  // §14 — the snap pair rule (fine ≤ coarse) is likewise cross-field: a hand-corrupted
  // stored pair with fine above coarse resets BOTH keys to their documented defaults
  // rather than leaking an inverted pair through.
  if (out.snapFineMinutes > out.snapCoarseMinutes) {
    out.snapFineMinutes = DEFAULT_SETTINGS.snapFineMinutes;
    out.snapCoarseMinutes = DEFAULT_SETTINGS.snapCoarseMinutes;
  }
  return out;
}

export function writeSetting<K extends keyof Settings>(db: Db, key: K, value: Settings[K]): void {
  const d = SETTING_DESCRIPTORS.find((x) => x.key === key);
  if (!d) throw new Error(`unknown setting "${key}"`);
  d.validate?.(value as never);
  // §14 — cross-field start<end: writing either working-hours key checks the resulting
  // pair against the stored counterpart (readSettings already sanitizes what it reads),
  // so an inverted window is rejected rather than stored. Zero-padded HH:MM strings
  // compare correctly as plain strings.
  if (key === 'workingHoursStart' || key === 'workingHoursEnd') {
    const current = readSettings(db);
    const start = key === 'workingHoursStart' ? (value as string) : current.workingHoursStart;
    const end = key === 'workingHoursEnd' ? (value as string) : current.workingHoursEnd;
    if (start >= end) throw new Error('working hours start must be before end');
  }
  // §14 — cross-field fine ≤ coarse: writing either snap key checks the resulting pair
  // against the stored counterpart, so a pair with fine above coarse is rejected rather
  // than stored (readSettings already sanitizes what it reads).
  if (key === 'snapFineMinutes' || key === 'snapCoarseMinutes') {
    const current = readSettings(db);
    const fine = key === 'snapFineMinutes' ? (value as number) : current.snapFineMinutes;
    const coarse = key === 'snapCoarseMinutes' ? (value as number) : current.snapCoarseMinutes;
    if (fine > coarse) throw new Error('snap_fine_minutes must be at most snap_coarse_minutes');
  }
  db.prepare(
    'INSERT INTO setting(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(d.snake, String(value));
}
