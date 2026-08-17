/**
 * GOLD — the data-shape contracts where the artefact is the criterion
 * (acceptance.html §08): settings defaults (§14), schema version (§13), the CSV
 * column contract and a fixed-fixture row (§09 R06), and the JSON export shape
 * validated against its published JSON Schema. §09 R06 (export) is classified
 * `core` — export is the durability / data-out escape hatch that puts the record
 * in the user's hands (§C(b)), so this GOLD is the byte contract protecting that
 * path: it fails if any export column, ordering, escaping, or JSON field regresses.
 */
import { describe, it, expect } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import addFormatsImport from 'ajv-formats';
// ajv-formats ships a CJS default export; cast to its callable shape for NodeNext.
const addFormats = addFormatsImport as unknown as <T>(ajv: T) => T;
import {
  Store,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  toCsv,
  toJsonEntries,
  CSV_COLUMNS,
  openDb,
  readSettings,
  writeSetting,
  describeOverlaps,
  resolveRange,
  resolveSavedRange,
  resolveReportDef,
  parseTime,
  formatStamp,
  localDay,
  groupKeyLabel,
  defaultDataDir,
  defaultConfigDir,
  resolveConfigPath,
  resolveStoragePaths,
  assertDbPathUsable,
  readConfig,
  writeConfig,
  resetConfigKey,
  ConfigError,
  StoragePathError,
  StorageChangeError,
  DB_FILENAME,
  CONFIG_FILENAME,
  APP_VERSION,
  DEV_VERSION,
  VERSION_RE,
  isReleaseVersion,
} from '@stint/core';
import type { EntryView, Db, StintConfig } from '@stint/core';

const ajv = addFormats(new Ajv({ allErrors: true }));
const schema = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../../acceptance/criteria/schemas/${name}`, import.meta.url)),
      'utf8',
    ),
  );

// The pinned clock (Wed 2026-06-24, noon UTC).
const NOW = new Date('2026-06-24T12:00:00Z');
function fixtureStore() {
  const store = Store.openMemory(() => NOW);
  const ca = store.addClient('Client A');
  const api = store.addProject('API', ca.id);
  store.add({
    description: 'auth refactor',
    clientId: ca.id,
    projectId: api.id,
    billable: true,
    tags: ['meeting', 'deep'],
    fromUtc: '2026-06-24T09:00:00Z',
    toUtc: '2026-06-24T10:30:00Z',
  });
  return store;
}

describe('GOLD: settings defaults (§14)', () => {
  it('a fresh database reads back the documented defaults', () => {
    const store = Store.openMemory();
    expect(store.settings()).toMatchInlineSnapshot(`
      {
        "backupRetention": 5,
        "checkinIntervalMin": 30,
        "dateFormat": "system",
        "firstCheckinMin": 60,
        "globalHotkey": "CommandOrControl+Alt+T",
        "pickerAroundHours": 8,
        "pickerWindowMode": "working_hours",
        "rounding": false,
        "roundingIncrementMin": 15,
        "showWeekend": false,
        "snapCoarseMinutes": 15,
        "snapFineMinutes": 5,
        "timeZone": "system",
        "weekStart": "monday",
        "workingHoursEnd": "18:00",
        "workingHoursStart": "07:00",
      }
    `);
    expect(store.settings()).toEqual(DEFAULT_SETTINGS);
    store.close();
  });

  it('schema version is pinned', () => {
    expect(SCHEMA_VERSION).toBe(5);
  });

  it('a corrupt stored value falls back to the default on read (reads as strict as writes)', () => {
    const db = openDb(':memory:');
    // Inject values the write path would have rejected, straight into the table.
    db.prepare("INSERT INTO setting(key, value) VALUES('rounding_increment_min', '999')").run();
    db.prepare("INSERT INTO setting(key, value) VALUES('checkin_interval_min', 'NaN')").run();
    // §14 — a malformed HH:MM start (never a valid write) likewise falls back on read.
    db.prepare("INSERT INTO setting(key, value) VALUES('working_hours_start', '99:99')").run();
    const s = readSettings(db);
    expect(s.roundingIncrementMin).toBe(DEFAULT_SETTINGS.roundingIncrementMin);
    expect(s.checkinIntervalMin).toBe(DEFAULT_SETTINGS.checkinIntervalMin);
    expect(s.workingHoursStart).toBe(DEFAULT_SETTINGS.workingHoursStart);
    db.close();
  });

  // §14 — the timeline-window keys (G15): writeSetting is exactly as strict as the CLI's
  // `config set` because both run the SAME descriptor validation; each rejection leaves the
  // stored value at its documented default. These fail if a key, a default, or any
  // validation rule (HH:MM shape, the cross-field start<end pair, the 1–24 around span,
  // the two-mode enum) regresses.
  it('writeSetting rejects malformed HH:MM working-hours values, keeping the defaults', () => {
    const db = openDb(':memory:');
    expect(() => writeSetting(db, 'workingHoursStart', '7:00')).toThrow(/HH:MM/);
    expect(() => writeSetting(db, 'workingHoursStart', '25:00')).toThrow(/HH:MM/);
    expect(() => writeSetting(db, 'workingHoursEnd', '18:60')).toThrow(/HH:MM/);
    const s = readSettings(db);
    expect(s.workingHoursStart).toBe('07:00');
    expect(s.workingHoursEnd).toBe('18:00');
    db.close();
  });

  it('writeSetting rejects a start>=end working-hours pair (cross-field, either key)', () => {
    const db = openDb(':memory:');
    // Against the default start 07:00, an earlier (or equal) end inverts the pair.
    expect(() => writeSetting(db, 'workingHoursEnd', '06:00')).toThrow(/start must be before end/);
    expect(() => writeSetting(db, 'workingHoursEnd', '07:00')).toThrow(/start must be before end/);
    // Against the default end 18:00, a later (or equal) start inverts it too.
    expect(() => writeSetting(db, 'workingHoursStart', '19:00')).toThrow(/start must be before end/);
    const s = readSettings(db);
    expect(s.workingHoursStart).toBe('07:00');
    expect(s.workingHoursEnd).toBe('18:00');
    // A valid re-narrowing still writes (the rule is start<end, not immutability).
    writeSetting(db, 'workingHoursStart', '09:00');
    writeSetting(db, 'workingHoursEnd', '15:00');
    expect(readSettings(db)).toMatchObject({ workingHoursStart: '09:00', workingHoursEnd: '15:00' });
    db.close();
  });

  it('writeSetting rejects out-of-domain picker_around_hours and an unknown mode', () => {
    const db = openDb(':memory:');
    expect(() => writeSetting(db, 'pickerAroundHours', 0)).toThrow(/1 to 24/);
    expect(() => writeSetting(db, 'pickerAroundHours', 25)).toThrow(/1 to 24/);
    expect(() => writeSetting(db, 'pickerAroundHours', 2.5)).toThrow(/whole number/);
    expect(() => writeSetting(db, 'pickerWindowMode', 'sometimes' as never)).toThrow(
      /working_hours or around_now/,
    );
    const s = readSettings(db);
    expect(s.pickerAroundHours).toBe(DEFAULT_SETTINGS.pickerAroundHours);
    expect(s.pickerWindowMode).toBe(DEFAULT_SETTINGS.pickerWindowMode);
    // The valid domain round-trips.
    writeSetting(db, 'pickerWindowMode', 'around_now');
    writeSetting(db, 'pickerAroundHours', 12);
    expect(readSettings(db)).toMatchObject({ pickerWindowMode: 'around_now', pickerAroundHours: 12 });
    db.close();
  });

  // §14 / §12 R09/R23 — the Entries-calendar keys: writeSetting is exactly as strict as the
  // CLI's `config set` because both run the SAME descriptor validation; each rejection
  // leaves the stored value at its documented default. These fail if a key, a default, or
  // any validation rule (the 1–30 whole-minute snap domain, the cross-field fine ≤ coarse
  // pair, the strict show_weekend boolean) regresses.
  it('writeSetting rejects out-of-range and fractional snap values, keeping the defaults', () => {
    const db = openDb(':memory:');
    expect(() => writeSetting(db, 'snapFineMinutes', 0)).toThrow(/1 to 30/);
    expect(() => writeSetting(db, 'snapCoarseMinutes', 31)).toThrow(/1 to 30/);
    expect(() => writeSetting(db, 'snapFineMinutes', 7.5)).toThrow(/whole number/);
    const s = readSettings(db);
    expect(s.snapFineMinutes).toBe(DEFAULT_SETTINGS.snapFineMinutes);
    expect(s.snapCoarseMinutes).toBe(DEFAULT_SETTINGS.snapCoarseMinutes);
    db.close();
  });

  it('writeSetting rejects a fine>coarse snap pair (cross-field, either key)', () => {
    const db = openDb(':memory:');
    // Against the default coarse 15, a larger fine inverts the pair.
    expect(() => writeSetting(db, 'snapFineMinutes', 20)).toThrow(/at most snap_coarse_minutes/);
    // Against the default fine 5, a smaller coarse inverts it too.
    expect(() => writeSetting(db, 'snapCoarseMinutes', 3)).toThrow(/at most snap_coarse_minutes/);
    const s = readSettings(db);
    expect(s.snapFineMinutes).toBe(DEFAULT_SETTINGS.snapFineMinutes);
    expect(s.snapCoarseMinutes).toBe(DEFAULT_SETTINGS.snapCoarseMinutes);
    // A valid pair still writes — and fine == coarse is legal (the rule is ≤, not <).
    writeSetting(db, 'snapCoarseMinutes', 10);
    writeSetting(db, 'snapFineMinutes', 10);
    expect(readSettings(db)).toMatchObject({ snapFineMinutes: 10, snapCoarseMinutes: 10 });
    db.close();
  });

  it('show_weekend is a strict boolean: non-boolean writes and corrupt stored values reject/fall back', () => {
    const db = openDb(':memory:');
    // The write layer rejects a non-boolean outright (the IPC channel is untyped at runtime).
    expect(() => writeSetting(db, 'showWeekend', 'banana' as never)).toThrow(/boolean/);
    // A hand-corrupted stored token parses to nothing and falls back to the default (off).
    db.prepare("INSERT INTO setting(key, value) VALUES('show_weekend', 'banana')").run();
    expect(readSettings(db).showWeekend).toBe(false);
    // The valid domain round-trips.
    writeSetting(db, 'showWeekend', true);
    expect(readSettings(db).showWeekend).toBe(true);
    db.close();
  });

  it('an inconsistent stored snap pair (fine > coarse) falls back to BOTH defaults on read', () => {
    const db = openDb(':memory:');
    // Individually valid values that violate the cross-field fine ≤ coarse rule, injected
    // straight into the table (the write path would have rejected the pair).
    db.prepare("INSERT INTO setting(key, value) VALUES('snap_fine_minutes', '20')").run();
    db.prepare("INSERT INTO setting(key, value) VALUES('snap_coarse_minutes', '10')").run();
    const s = readSettings(db);
    expect(s.snapFineMinutes).toBe(DEFAULT_SETTINGS.snapFineMinutes);
    expect(s.snapCoarseMinutes).toBe(DEFAULT_SETTINGS.snapCoarseMinutes);
    db.close();
  });

  it('an inverted stored working-hours pair falls back to BOTH defaults on read', () => {
    const db = openDb(':memory:');
    // Individually valid HH:MM values that violate the cross-field start<end rule,
    // injected straight into the table (the write path would have rejected the pair).
    db.prepare("INSERT INTO setting(key, value) VALUES('working_hours_start', '18:00')").run();
    db.prepare("INSERT INTO setting(key, value) VALUES('working_hours_end', '07:00')").run();
    const s = readSettings(db);
    expect(s.workingHoursStart).toBe(DEFAULT_SETTINGS.workingHoursStart);
    expect(s.workingHoursEnd).toBe(DEFAULT_SETTINGS.workingHoursEnd);
    db.close();
  });
});

describe('GOLD: range-ordering contracts (§05 R5, §09 R01/R08)', () => {
  // Two sibling rules that live only in code elsewhere — pin both so a regression cannot silently
  // drop either. Entries use a STRICT < (a backfill needs a positive duration); saved reports use
  // ≤ (a same-day from == to window is a legitimate, non-empty request). The asymmetry is the
  // ratified rule (§05 R5 vs §09 R01), guarded here at the core boundary both surfaces inherit.
  const REPORT_BASE = {
    by: 'client' as const,
    billableFilter: 'billable' as const,
    rounding: false,
    roundingIncrementMin: 15,
  };

  it('add() rejects a backfill whose to is not strictly after its from (entries: strict <)', () => {
    const store = Store.openMemory(() => NOW);
    // Inverted: to before from.
    expect(() =>
      store.add({ description: 'x', fromUtc: '2026-06-24T10:00:00Z', toUtc: '2026-06-24T09:00:00Z' }),
    ).toThrow(/stop time must be after start time/);
    // Zero-length: to == from is ALSO rejected for entries (the rule is strict <, not ≤).
    expect(() =>
      store.add({ description: 'x', fromUtc: '2026-06-24T09:00:00Z', toUtc: '2026-06-24T09:00:00Z' }),
    ).toThrow(/stop time must be after start time/);
  });

  /**
   * Issue 138 — core's refusals are SURFACE-NEUTRAL. This one named `tt`'s own flags
   * (`--to must be after --from`) and the GUI painted it verbatim in the add form, telling a
   * user to fix controls that exist nowhere in the GUI. Core states the fact; each surface
   * owns its phrasing (the CLI layer, program.ts, is where "pass --force" belongs). Swept
   * over every message core can throw, so the next one cannot reintroduce the leak.
   */
  it('no core refusal names a CLI flag — the words work on both surfaces', () => {
    const store = Store.openMemory(() => NOW);
    const entry = store.add({
      description: 'seed',
      fromUtc: '2026-06-24T09:00:00Z',
      toUtc: '2026-06-24T10:00:00Z',
    }).value;
    const refusals: (() => unknown)[] = [
      // The three the GUI surfaces in its message regions, plus the reference-data and
      // saved-report refusals — every family of message that can reach a user.
      () => store.add({ description: 'x', fromUtc: '2026-06-24T10:00:00Z', toUtc: '2026-06-24T09:00:00Z' }),
      () => store.edit(entry.id, { endUtc: '2026-06-24T08:00:00Z' }),
      () => store.split(entry.id, '2026-06-24T12:00:00Z'),
      () => store.stop(),
      () => store.startFromFavorite('nope'),
      () => store.merge([entry.id]),
      () => store.remove(999),
      () => store.runReport('nope'),
      () => store.renameReport('nope', 'x'),
      () => store.unpinFavorite('nope'),
      () =>
        store.saveReport({
          name: 'Backwards',
          rangeSpec: { kind: 'absolute', fromUtc: '2026-07-15T00:00:00Z', toUtc: '2026-07-01T00:00:00Z' },
          ...REPORT_BASE,
        }),
    ];
    for (const attempt of refusals) {
      let message = '';
      try {
        attempt();
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message, 'a refusal that never fired proves nothing').not.toBe('');
      expect(message, `core refusal names a CLI flag: ${message}`).not.toMatch(/(^|\s)--[a-z]/);
    }
  });

  it('saveReport rejects an inverted absolute range but ACCEPTS same-day from == to (reports: ≤)', () => {
    const store = Store.openMemory(() => NOW);
    // Inverted from > to → rejected, nothing stored.
    expect(() =>
      store.saveReport({
        name: 'Backwards',
        rangeSpec: { kind: 'absolute', fromUtc: '2026-07-15T00:00:00Z', toUtc: '2026-07-01T00:00:00Z' },
        ...REPORT_BASE,
      }),
    ).toThrow(/must not be before/);
    expect(store.listReports().map((d) => d.name)).not.toContain('Backwards');
    // Same-day from == to → accepted (≤), unlike the entry rule's strict <.
    const def = store.saveReport({
      name: 'SameDay',
      rangeSpec: { kind: 'absolute', fromUtc: '2026-06-24T00:00:00Z', toUtc: '2026-06-24T00:00:00Z' },
      ...REPORT_BASE,
    });
    expect(def.name).toBe('SameDay');
    expect(store.listReports().map((d) => d.name)).toContain('SameDay');
  });

  it('editReport rejects amending a stored report into an inverted absolute range, leaving it untouched', () => {
    const store = Store.openMemory(() => NOW);
    store.saveReport({ name: 'Weekly', rangeSpec: { kind: 'preset', preset: 'week' }, ...REPORT_BASE });
    expect(() =>
      store.editReport('Weekly', {
        rangeSpec: { kind: 'absolute', fromUtc: '2026-07-15T00:00:00Z', toUtc: '2026-07-01T00:00:00Z' },
      }),
    ).toThrow(/must not be before/);
    // The original preset definition is intact — the refused amendment persisted nothing.
    expect(store.getReport('Weekly')?.rangeSpec).toEqual({ kind: 'preset', preset: 'week' });
  });
});

describe('GOLD: schema shape (§13)', () => {
  // Artefact-is-criterion: the v4 schema IS the contract. A fresh in-memory DB must carry
  // the favorite / favorite_tag / report tables with the exact §13 column sets, the
  // §20 R02 partial unique index over the constant (1) WHERE end_utc IS NULL, and the
  // sleep_span.source CHECK — and open with foreign_keys ON. A regression (missing
  // table/column/index/constraint, or a stale version) fails here.
  const objects = (db: Db, type: 'table' | 'index') =>
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name")
        .all(type) as { name: string }[]
    ).map((r) => r.name);
  const columns = (db: Db, table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);

  it('SCHEMA_VERSION is pinned to 5 and a fresh DB stamps user_version = 5', () => {
    expect(SCHEMA_VERSION).toBe(5);
    const db = openDb(':memory:');
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(5);
    db.close();
  });

  it('opens with foreign_keys ON (the integrity defense the §13 FKs rely on)', () => {
    const db = openDb(':memory:');
    const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(fk.foreign_keys).toBe(1);
    db.close();
  });

  it('carries the favorite, favorite_tag, and report tables', () => {
    const db = openDb(':memory:');
    const tables = objects(db, 'table');
    expect(tables).toContain('favorite');
    expect(tables).toContain('favorite_tag');
    expect(tables).toContain('report');
    db.close();
  });

  it('favorite / favorite_tag / report columns match the §13 contract', () => {
    const db = openDb(':memory:');
    expect(columns(db, 'favorite')).toEqual([
      'id',
      'name',
      'description',
      'client_id',
      'project_id',
      'billable',
    ]);
    expect(columns(db, 'favorite_tag')).toEqual(['favorite_id', 'tag_id']);
    expect(columns(db, 'report')).toEqual([
      'id',
      'name',
      'range_kind',
      'range_preset',
      'range_from_utc',
      'range_to_utc',
      'group_by',
      'billable_filter',
      'client_id',
      'project_id',
      'tag',
      'search',
      'rounding',
      'rounding_increment_min',
      'created_utc',
    ]);
    db.close();
  });

  it('has the §20 R02 partial unique index on the open entry', () => {
    const db = openDb(':memory:');
    expect(objects(db, 'index')).toContain('one_open_entry_idx');
    const sql = (
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'one_open_entry_idx'")
        .get() as { sql: string }
    ).sql;
    // The index is PARTIAL (only open rows) and UNIQUE — the DB-level teeth for one-open-entry.
    expect(sql).toMatch(/UNIQUE/i);
    expect(sql).toMatch(/WHERE\s+end_utc\s+IS\s+NULL/i);
    // It indexes the CONSTANT expression (1), NOT end_utc: a unique index on end_utc would
    // permit unlimited open rows because SQLite treats NULLs as distinct. Pinning the constant
    // keeps the second-open-row collision (proven by prop/invariants.test.ts) load-bearing.
    expect(sql).toMatch(/\(\s*1\s*\)/);
    expect(sql).not.toMatch(/\(\s*end_utc\s*\)\s*WHERE/i);
    db.close();
  });

  it("sleep_span.source is CHECK-constrained to SleepSource's value list", () => {
    const db = openDb(':memory:');
    // The DDL carries the constraint — the schema-level proof behind the store's
    // `source as SleepSource` cast (#180)…
    const sql = (
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sleep_span'")
        .get() as { sql: string }
    ).sql;
    expect(sql).toMatch(/CHECK\s*\(\s*source\s+IN\s*\(\s*'event'\s*,\s*'gap'\s*,\s*'unknown'\s*\)\s*\)/i);
    // …and it has teeth: an out-of-union value is rejected at the storage layer, while
    // every SleepSource literal is accepted.
    db.exec(
      "INSERT INTO entry(start_utc, end_utc) VALUES('2026-06-24T09:00:00Z', '2026-06-24T10:00:00Z')",
    );
    db.exec(
      "INSERT INTO sleep_span(entry_id, sleep_utc, wake_utc, source) VALUES" +
        "(1, '2026-06-24T09:10:00Z', '2026-06-24T09:12:00Z', 'event')," +
        "(1, '2026-06-24T09:14:00Z', '2026-06-24T09:16:00Z', 'gap')," +
        "(1, '2026-06-24T09:18:00Z', '2026-06-24T09:20:00Z', 'unknown')",
    );
    expect(() =>
      db.exec(
        "INSERT INTO sleep_span(entry_id, sleep_utc, wake_utc, source) " +
          "VALUES(1, '2026-06-24T09:30:00Z', '2026-06-24T09:40:00Z', 'powerd')",
      ),
    ).toThrow(/CHECK/);
    db.close();
  });
});

describe('GOLD: data-dir path contract — macOS + Linux only (§13)', () => {
  // Windows is dropped everywhere: defaultDataDir resolves the macOS and Linux locations and
  // exposes NO win32 / %APPDATA% branch. Re-introducing a win32 path or changing the data-dir
  // suffix / DB filename fails here. We pin the env-driven Linux branch (testable on any host)
  // and the constant filename; the per-OS darwin/linux suffixes are pinned as documented constants.
  it('DB_FILENAME stays timetracker.sqlite', () => {
    expect(DB_FILENAME).toBe('timetracker.sqlite');
  });

  it('the Linux branch honours $XDG_DATA_HOME and ends in /stint', () => {
    // platform() === 'linux' on CI; if a host ever runs darwin this asserts the constant suffix.
    if (platform() === 'darwin') {
      expect(defaultDataDir({} as NodeJS.ProcessEnv)).toMatch(
        /Library\/Application Support\/stint$/,
      );
      return;
    }
    const dir = defaultDataDir({ XDG_DATA_HOME: '/custom/xdg' } as unknown as NodeJS.ProcessEnv);
    expect(dir).toBe('/custom/xdg/stint');
  });

  it('the Linux branch falls back to ~/.local/share/stint without XDG_DATA_HOME', () => {
    if (platform() === 'darwin') return; // covered by the macOS suffix assertion above
    const dir = defaultDataDir({} as NodeJS.ProcessEnv);
    expect(dir).toMatch(/\.local\/share\/stint$/);
  });

  it('exposes no Windows branch — %APPDATA% is never consulted', () => {
    if (platform() === 'win32') throw new Error('Windows is unsupported');
    // Even with APPDATA set, the resolved dir must not route through it (no win32 branch).
    const dir = defaultDataDir({
      APPDATA: 'C:\\\\Users\\\\x\\\\AppData\\\\Roaming',
    } as unknown as NodeJS.ProcessEnv);
    expect(dir).not.toContain('AppData');
    expect(dir.endsWith('stint')).toBe(true);
  });
});

describe('GOLD: config-home path contract — macOS + Linux only (§13)', () => {
  // The census the data-dir contract runs, extended to the CONFIG resolver: the config
  // file's own ladder is TT_CONFIG → the per-OS config location, with no win32 branch.
  it('CONFIG_FILENAME stays config.json', () => {
    expect(CONFIG_FILENAME).toBe('config.json');
  });

  it('the Linux branch honours $XDG_CONFIG_HOME and ends in /stint', () => {
    if (platform() === 'darwin') {
      expect(defaultConfigDir({} as NodeJS.ProcessEnv)).toMatch(/Library\/Application Support\/stint$/);
      return;
    }
    const dir = defaultConfigDir({ XDG_CONFIG_HOME: '/custom/cfg' } as unknown as NodeJS.ProcessEnv);
    expect(dir).toBe('/custom/cfg/stint');
  });

  it('the Linux branch falls back to ~/.config/stint without XDG_CONFIG_HOME', () => {
    if (platform() === 'darwin') return; // covered by the macOS suffix assertion above
    const dir = defaultConfigDir({} as NodeJS.ProcessEnv);
    expect(dir).toMatch(/\.config\/stint$/);
  });

  it('exposes no Windows branch — %APPDATA% is never consulted by the config resolver', () => {
    if (platform() === 'win32') throw new Error('Windows is unsupported');
    const resolved = resolveConfigPath({
      APPDATA: 'C:\\\\Users\\\\x\\\\AppData\\\\Roaming',
    } as unknown as NodeJS.ProcessEnv);
    expect(resolved.path).not.toContain('AppData');
    expect(resolved.path.endsWith(join('stint', 'config.json'))).toBe(true);
    expect(resolved.source).toBe('default');
  });

  it('TT_CONFIG overrides the config file location with source env', () => {
    const resolved = resolveConfigPath({ TT_CONFIG: '/elsewhere/config.json' } as NodeJS.ProcessEnv);
    expect(resolved).toEqual({ path: '/elsewhere/config.json', source: 'env' });
  });
});

describe('GOLD: storage config file contract (§13, §20 R10)', () => {
  // The artefact IS the criterion: acceptance/criteria/schemas/config.schema.json
  // (additionalProperties: false, absolute-path strings) and core's readConfig must agree
  // on every fixture — a config the schema admits is read, a config the schema rejects is
  // an untrusted file that refuses the launch. If validation and the published contract
  // drift, one of these fixtures fails.
  const validate = addFormats(new Ajv({ allErrors: true })).compile(schema('config.schema.json'));

  const readOf = (dir: string, value: unknown): (() => StintConfig) => {
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify(value));
    return () => readConfig(file);
  };

  it('schema and core validation agree on every fixture', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-config-'));
    try {
      const valid: unknown[] = [
        {},
        { dbPath: '/data/tt.sqlite' },
        { backupDir: '/backups' },
        { dbPath: '/data/tt.sqlite', backupDir: '/backups' },
      ];
      const invalid: unknown[] = [
        { unknown: true },
        { dbPath: 'relative/tt.sqlite' },
        { dbPath: 42 },
        { backupDir: '' },
        ['/data/tt.sqlite'],
        'just a string',
      ];
      for (const v of valid) {
        expect(validate(v), `schema should admit ${JSON.stringify(v)}`).toBe(true);
        expect(readOf(dir, v)()).toEqual(v);
      }
      for (const v of invalid) {
        expect(validate(v), `schema should reject ${JSON.stringify(v)}`).toBe(false);
        expect(readOf(dir, v)).toThrow(ConfigError);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an absent file is an empty config — every path takes the next rung (§13)', () => {
    expect(readConfig(join(tmpdir(), 'stint-gold-absent', 'config.json'))).toEqual({});
  });

  it('refusal messages name the file and the error (§20 R10)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-config-msg-'));
    const file = join(dir, 'config.json');
    try {
      writeFileSync(file, '{ nope');
      expect(() => readConfig(file)).toThrow(new RegExp(`config file ${file}: is not valid JSON`));
      writeFileSync(file, JSON.stringify({ mystery: '/x' }));
      expect(() => readConfig(file)).toThrow(/unknown key "mystery" \(allowed keys: dbPath, backupDir\)/);
      writeFileSync(file, JSON.stringify({ backupDir: 'rel/backups' }));
      expect(() => readConfig(file)).toThrow(/backupDir must be an absolute path \(got "rel\/backups"\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeConfig is atomic write-temp-then-rename, round-trips, and never produces an untrusted file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-config-write-'));
    const file = join(dir, 'nested', 'config.json');
    try {
      writeConfig(file, { dbPath: '/data/tt.sqlite', backupDir: '/backups' });
      expect(readConfig(file)).toEqual({ dbPath: '/data/tt.sqlite', backupDir: '/backups' });
      // No temp sibling left behind — the rename consumed it (the single commit point).
      expect(readdirSync(dirname(file))).toEqual(['config.json']);
      // Core can never produce a file its next launch would refuse (§20 R10): a relative
      // path is rejected BEFORE anything is written, the target left untouched.
      expect(() => writeConfig(file, { dbPath: 'relative/tt.sqlite' })).toThrow(ConfigError);
      expect(readConfig(file)).toEqual({ dbPath: '/data/tt.sqlite', backupDir: '/backups' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reset deletes the key — a resolved default is never written into the file (§13)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-config-reset-'));
    const file = join(dir, 'config.json');
    try {
      writeConfig(file, { dbPath: '/data/tt.sqlite', backupDir: '/backups' });
      resetConfigKey(file, 'backupDir');
      expect(readConfig(file)).toEqual({ dbPath: '/data/tt.sqlite' });
      expect(readFileSync(file, 'utf8')).not.toContain('backupDir');
      resetConfigKey(file, 'dbPath');
      expect(readConfig(file)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('GOLD: storage ladders (§13) + broken-path refusal shapes (§20 R11)', () => {
  // One shared resolver serves both surfaces (§13): env → config file → default, first
  // rung wins, each effective path carrying its source. The fixtures below pin the whole
  // precedence table and the beside-the-resolved-database default rung — byte-compatible
  // with the pre-ladder beside-the-DB behavior.
  const withConfig = (dir: string, config: StintConfig): string => {
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify(config));
    return file;
  };

  it('env outranks config outranks default, and each row carries its rung', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-ladder-'));
    try {
      const cfg = withConfig(dir, { dbPath: '/conf/db.sqlite', backupDir: '/conf/backups' });
      // All env rungs occupied — env wins everywhere.
      const allEnv = resolveStoragePaths({
        TT_CONFIG: cfg,
        TT_DB: '/env/db.sqlite',
        TT_BACKUP_DIR: '/env/backups',
      } as NodeJS.ProcessEnv);
      expect(allEnv.db).toEqual({ path: '/env/db.sqlite', source: 'env' });
      expect(allEnv.backupDir).toEqual({ path: '/env/backups', source: 'env' });
      expect(allEnv.configFile).toEqual({ path: cfg, source: 'env' });
      // Env silent — the config rung takes both paths.
      const conf = resolveStoragePaths({ TT_CONFIG: cfg } as NodeJS.ProcessEnv);
      expect(conf.db).toEqual({ path: '/conf/db.sqlite', source: 'config' });
      expect(conf.backupDir).toEqual({ path: '/conf/backups', source: 'config' });
      // Config silent too — the defaults: per-OS data dir (or userDataDir) + beside-the-DB.
      const empty = withConfig(dir, {});
      const dflt = resolveStoragePaths({ TT_CONFIG: empty } as NodeJS.ProcessEnv, '/electron/userData');
      expect(dflt.db).toEqual({ path: '/electron/userData/timetracker.sqlite', source: 'default' });
      expect(dflt.backupDir).toEqual({ path: '/electron/userData', source: 'default' });
      // The backup default follows the RESOLVED database — here the env rung's file.
      const beside = resolveStoragePaths({
        TT_CONFIG: empty,
        TT_DB: '/env/deep/db.sqlite',
      } as NodeJS.ProcessEnv);
      expect(beside.backupDir).toEqual({ path: '/env/deep', source: 'default' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an untrusted config refuses resolution even when env vars would cover every value (§20 R10)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-ladder-bad-'));
    try {
      const file = join(dir, 'config.json');
      writeFileSync(file, '{ nope');
      // Config integrity at launch is unconditional: no rung is guessed around a bad file.
      expect(() =>
        resolveStoragePaths({
          TT_CONFIG: file,
          TT_DB: '/env/db.sqlite',
          TT_BACKUP_DIR: '/env/backups',
        } as NodeJS.ProcessEnv),
      ).toThrow(ConfigError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a config-set db path with a missing parent refuses, naming path + config file, creating nothing (§20 R11)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-r11-'));
    try {
      const dbPath = join(dir, 'gone', 'tt.sqlite');
      const cfg = withConfig(dir, { dbPath });
      const paths = resolveStoragePaths({ TT_CONFIG: cfg } as NodeJS.ProcessEnv);
      let thrown: unknown;
      try {
        assertDbPathUsable(paths);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(StoragePathError);
      const message = (thrown as StoragePathError).message;
      // The done-when: BOTH names in the message, and the no-auto-mkdir stance stated.
      expect(message).toContain(dbPath);
      expect(message).toContain(cfg);
      expect(message).toContain('not created');
      expect(existsSync(join(dir, 'gone'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a config-set db path with a live parent, or an existing file, passes the gate (§20 R11 first-run/adopt)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-r11-live-'));
    try {
      mkdirSync(join(dir, 'data'));
      const cfg = withConfig(dir, { dbPath: join(dir, 'data', 'tt.sqlite') });
      const paths = resolveStoragePaths({ TT_CONFIG: cfg } as NodeJS.ProcessEnv);
      expect(() => assertDbPathUsable(paths)).not.toThrow();
      // An existing FILE at the configured path simply opens, parent state irrelevant.
      writeFileSync(join(dir, 'data', 'tt.sqlite'), '');
      expect(() => assertDbPathUsable(paths)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the gate covers only the config rung — env/default keep their existing semantics (§20 R11)', () => {
    // TT_DB keeps today's behavior (the caller's explicit choice; openDb creates the
    // parent), and the per-OS default dir is Stint's own to create — only a CONFIG-set
    // path refuses on a dead parent.
    expect(() =>
      assertDbPathUsable({
        db: { path: '/nowhere/at/all/tt.sqlite', source: 'env' },
        backupDir: { path: '/nowhere/at/all', source: 'default' },
        configFile: { path: '/tmp/none.json', source: 'env' },
      }),
    ).not.toThrow();
  });
});

describe('GOLD: database location change refusal shapes (§20 R12)', () => {
  // The §20 R12 pipeline's refusals are the loss-protection surface the GUI change dialog
  // (§12 R26) renders verbatim — mockups/storage-change.html shows the migrate refusal —
  // so the message shapes are pinned here: each names the destination, states WHY it
  // stopped, and states that nothing became live. The invariants behind the words (old DB
  // byte-identical, config untouched, gates decide liveness) are PROP
  // core/test/prop/storage-change.test.ts; the flows are BDD features/storage_change.feature.
  const NOW_AT = new Date('2026-06-24T12:00:00Z');

  /** A file-backed store in its own temp home, plus the §20 R12 call plumbing. */
  function changeFixture() {
    const home = mkdtempSync(join(tmpdir(), 'stint-gold-change-'));
    const oldDbPath = join(home, 'old', 'tt.sqlite');
    const store = Store.open({ path: oldDbPath, backupDir: join(home, 'old'), clock: () => NOW_AT });
    const configFile = join(home, 'config.json');
    mkdirSync(join(home, 'new-home'));
    const newDbPath = join(home, 'new-home', 'tt.sqlite');
    const change = (mode: 'migrate' | 'start-fresh', dest: string = newDbPath) =>
      store.changeDbLocation({ newDbPath: dest, mode, configFile });
    const dispose = () => {
      store.close();
      rmSync(home, { recursive: true, force: true });
    };
    return { home, oldDbPath, newDbPath, configFile, store, change, dispose };
  }

  const thrownBy = (fn: () => unknown): StorageChangeError => {
    let thrown: unknown;
    try {
      fn();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(StorageChangeError);
    return thrown as StorageChangeError;
  };

  it('migrate refuses an existing destination file, naming it and the adopt alternative', () => {
    const f = changeFixture();
    try {
      writeFileSync(f.newDbPath, 'already here');
      const err = thrownBy(() => f.change('migrate'));
      // The exact refusal grammar the §12 R26 dialog renders (mockups/storage-change.html).
      expect(err.message).toBe(
        `a file already exists at ${f.newDbPath} — migrate never overwrites; pick a ` +
          `different location, or choose start fresh to adopt the existing file (it must ` +
          `pass the integrity and version checks); nothing has changed`,
      );
      expect(err.destination).toBe(f.newDbPath);
      // Nothing has changed, literally: destination bytes intact, config never written.
      expect(readFileSync(f.newDbPath, 'utf8')).toBe('already here');
      expect(existsSync(f.configFile)).toBe(false);
    } finally {
      f.dispose();
    }
  });

  it('adoption refuses a file that fails the integrity check, naming it', () => {
    const f = changeFixture();
    try {
      writeFileSync(f.newDbPath, 'opaque bytes that are not a database');
      const err = thrownBy(() => f.change('start-fresh'));
      expect(err.message).toContain(`cannot adopt ${f.newDbPath}`);
      expect(err.message).toContain('failed the integrity check');
      expect(err.message).toContain('the config file is untouched and the old database is still active');
      expect(existsSync(f.configFile)).toBe(false);
    } finally {
      f.dispose();
    }
  });

  it('adoption refuses a newer-schema database, naming both versions and the remedy (§20 R08/R09)', () => {
    const f = changeFixture();
    try {
      const future = openDb(f.newDbPath);
      future.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
      future.close();
      const err = thrownBy(() => f.change('start-fresh'));
      expect(err.message).toBe(
        `cannot adopt ${f.newDbPath}: its schema version ${SCHEMA_VERSION + 1} is newer ` +
          `than this binary's supported version ${SCHEMA_VERSION} — run the newer binary ` +
          `to use it; the config file is untouched and the old database is still active`,
      );
      expect(existsSync(f.configFile)).toBe(false);
    } finally {
      f.dispose();
    }
  });

  it('a destination in a missing directory refuses naming the parent, creating nothing', () => {
    const f = changeFixture();
    try {
      const dest = join(f.home, 'gone', 'tt.sqlite');
      const err = thrownBy(() => f.change('migrate', dest));
      // The §20 R11 no-auto-mkdir stance, restated at the change gate.
      expect(err.message).toContain(`its parent directory ${join(f.home, 'gone')} does not exist`);
      expect(err.message).toContain('not created automatically');
      expect(err.message).toContain('nothing has changed');
      expect(existsSync(join(f.home, 'gone'))).toBe(false);
      expect(existsSync(f.configFile)).toBe(false);
    } finally {
      f.dispose();
    }
  });

  it('a same-path change refuses — the destination is already the live database', () => {
    const f = changeFixture();
    try {
      const err = thrownBy(() => f.change('migrate', f.oldDbPath));
      expect(err.message).toBe(`${f.oldDbPath} is already the live database — nothing to change`);
      expect(existsSync(f.configFile)).toBe(false);
    } finally {
      f.dispose();
    }
  });

  it('the success message names the old file kept in place, untouched (the R12 done-when)', () => {
    const f = changeFixture();
    try {
      const r = f.change('migrate');
      expect(r.message).toBe(
        `migrated the database to ${f.newDbPath}; the old database is kept in place, ` +
          `untouched, at ${f.oldDbPath}`,
      );
      expect(r.outcome).toBe('migrated');
      expect(r.oldDbPath).toBe(f.oldDbPath);
      expect(r.newDbPath).toBe(f.newDbPath);
      expect(r.configFile).toBe(f.configFile);
      // The pre-change backup at the old home is part of the result contract.
      expect(r.backup.name.startsWith('tt.sqlite.bak-')).toBe(true);
      expect(dirname(r.backup.path)).toBe(join(f.home, 'old'));
    } finally {
      f.dispose();
    }
  });
});

describe('GOLD: single-file WAL + UTC-storage contract (§04 R02, R06)', () => {
  // The contract the `core` badge on §04 R02 (single source of truth — one SQLite
  // file in WAL mode, all reads/writes through @stint/core) and §04 R06 (UTC
  // storage, local display) rests on. Open-time durability pragmas are further
  // hardened in §20 R01; this pins the baseline the badge labels today.
  it('opens a file-backed DB in WAL journal mode (§04 R02)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-wal-'));
    try {
      const db = openDb(join(dir, 'stint.db'));
      const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(row.journal_mode.toLowerCase()).toBe('wal');
      // foreign_keys is enforced on every open (defense the integrity badge relies on).
      const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(fk.foreign_keys).toBe(1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores timestamps as UTC and round-trips them unchanged (§04 R06)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-utc-'));
    try {
      const store = Store.open({ path: join(dir, 'stint.db'), clock: () => NOW });
      // Write a span whose local rendering would differ by zone; storage stays UTC.
      const fromUtc = '2026-06-24T09:00:00Z';
      const toUtc = '2026-06-24T10:30:00Z';
      const { value: entry } = store.add({ description: 'utc round-trip', fromUtc, toUtc });
      const got = store.getEntry(entry.id)!;
      // Stored truth is exactly the UTC instants written — byte-for-byte, Z-suffixed.
      expect(got.startUtc).toBe(fromUtc);
      expect(got.endUtc).toBe(toUtc);
      // Duration is UTC math: timezone-independent and DST-safe regardless of host TZ.
      expect(got.rawSeconds).toBe(5400);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('GOLD: DB open durability pragmas (§20 R01)', () => {
  // Artefact-is-criterion: openDb SETS and then VERIFIES the durability pragmas on EVERY open,
  // before any write/migration. The read-back surface IS the contract — an on-disk open must
  // report journal_mode === 'wal', foreign_keys === 1, busy_timeout > 0, and synchronous === 2
  // (FULL). This fails if synchronous is left at SQLite's default (NORMAL under WAL would read
  // back as 1, not 2) or if any other pragma drifts. A ':memory:' open has no journal/durability
  // concept, so WAL + synchronous are N/A there — only foreign_keys and busy_timeout are asserted.
  const pragma = (db: Db, name: string) => {
    const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
    return Object.values(row)[0];
  };

  it('an on-disk open yields the exact read-back pragma contract (wal / 1 / >0 / FULL)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-pragmas-'));
    try {
      const db = openDb(join(dir, 'stint.db'));
      expect(String(pragma(db, 'journal_mode')).toLowerCase()).toBe('wal');
      expect(Number(pragma(db, 'foreign_keys'))).toBe(1);
      expect(Number(pragma(db, 'busy_timeout'))).toBeGreaterThan(0);
      expect(Number(pragma(db, 'synchronous'))).toBe(2); // 2 === FULL — the §20 R01 durability target
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a ':memory:' open has foreign_keys === 1 and busy_timeout > 0 (WAL/synchronous N/A)", () => {
    const db = openDb(':memory:');
    expect(Number(pragma(db, 'foreign_keys'))).toBe(1);
    expect(Number(pragma(db, 'busy_timeout'))).toBeGreaterThan(0);
    db.close();
  });
});

describe('GOLD: CSV export contract (§09 R06)', () => {
  it('header is the exact column contract', () => {
    expect(CSV_COLUMNS.join(',')).toMatchInlineSnapshot(
      `"client,project,tags,description,start_utc,end_utc,raw_duration_s,excluded_s,billable,overlapped"`,
    );
    // Lock every column AND its ordinal position: the data-out escape hatch's shape
    // must not drift one field, so a reorder/rename/drop fails here, not silently.
    expect(CSV_COLUMNS).toEqual([
      'client',
      'project',
      'tags',
      'description',
      'start_utc',
      'end_utc',
      'raw_duration_s',
      'excluded_s',
      'billable',
      'overlapped',
    ]);
  });

  it('a fixed fixture renders the expected row', () => {
    const store = fixtureStore();
    const csv = toCsv(store.listEntries(), NOW);
    expect(csv).toMatchInlineSnapshot(`
      "client,project,tags,description,start_utc,end_utc,raw_duration_s,excluded_s,billable,overlapped
      Client A,API,deep;meeting,auth refactor,2026-06-24T09:00:00Z,2026-06-24T10:30:00Z,5400,0,true,false
      "
    `);
    store.close();
  });

  it('quotes cells containing commas, quotes, or newlines', () => {
    const store = Store.openMemory(() => NOW);
    store.add({
      description: 'wrote "the, report"',
      fromUtc: '2026-06-24T09:00:00Z',
      toUtc: '2026-06-24T09:30:00Z',
    });
    const csv = toCsv(store.listEntries(), NOW);
    expect(csv.split('\n')[1]).toContain('"wrote ""the, report"""');
    store.close();
  });

  it('a description with an embedded newline is quoted and round-trips byte-for-byte (§05 R10)', () => {
    // §05 R10 / §17 R8 — multiline descriptions are stored VERBATIM and the CSV escape hatch
    // must round-trip them: the embedded newline forces RFC-4180 quoting so the field survives
    // whole, and parsing the emitted cell back yields the original byte-for-byte. This fails if
    // csvCell stops quoting \n, or any surface flattens the stored text.
    const store = Store.openMemory(() => NOW);
    const original = 'line one\nline two';
    store.add({
      description: original,
      fromUtc: '2026-06-24T09:00:00Z',
      toUtc: '2026-06-24T09:30:00Z',
    });
    const csv = toCsv(store.listEntries(), NOW);
    // The interior newline is preserved inside a single quoted field — not split across rows.
    expect(csv).toContain('"line one\nline two"');
    // Parse the quoted description cell back out (unescaping doubled quotes) and prove it is
    // byte-identical to the stored value.
    const open = csv.indexOf('"');
    let roundTripped = '';
    for (let i = open + 1; i < csv.length; i++) {
      const ch = csv[i];
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          roundTripped += '"';
          i++;
          continue;
        }
        break;
      }
      roundTripped += ch;
    }
    expect(roundTripped).toBe(original);
    store.close();
  });
});

describe('GOLD: free-text search query contract (§09 R7)', () => {
  function searchStore() {
    const store = Store.openMemory(() => NOW);
    const acme = store.addClient('Acme');
    const billing = store.addProject('Billing', acme.id);
    const globex = store.addClient('Globex');
    const ops = store.addProject('Ops', globex.id);
    store.add({
      description: 'auth refactor',
      clientId: acme.id,
      projectId: billing.id,
      billable: true,
      tags: ['deep'],
      fromUtc: '2026-06-24T09:00:00Z',
      toUtc: '2026-06-24T11:00:00Z',
    });
    store.add({
      description: 'deploy pipeline',
      clientId: globex.id,
      projectId: ops.id,
      billable: false,
      tags: ['ci'],
      fromUtc: '2026-06-24T11:00:00Z',
      toUtc: '2026-06-24T12:00:00Z',
    });
    return store;
  }
  const descs = (store: Store, search: string) =>
    store.listEntries({ search }).map((e) => e.description);

  it('matches description / client / project / tag, case-insensitively', () => {
    const store = searchStore();
    expect(descs(store, 'REFACTOR')).toEqual(['auth refactor']); // description, case-insensitive
    expect(descs(store, 'globex')).toEqual(['deploy pipeline']); // client name
    expect(descs(store, 'billing')).toEqual(['auth refactor']); // project name
    expect(descs(store, 'ci')).toEqual(['deploy pipeline']); // tag
    expect(descs(store, 'nonexistent')).toEqual([]); // no match
    store.close();
  });

  it('composes with a range + billable filter (narrows within them)', () => {
    const store = searchStore();
    // billable filter already excludes "deploy pipeline" (non-billable); search for a term
    // only the non-billable entry carries → nothing survives the AND of the two predicates.
    expect(
      store
        .listEntries({
          fromUtc: '2026-06-24T00:00:00Z',
          toUtc: '2026-06-25T00:00:00Z',
          billable: 'billable',
          search: 'pipeline',
        })
        .map((e) => e.description),
    ).toEqual([]);
    // search for the billable entry's term, within the same range + billable filter → it stays.
    expect(
      store
        .listEntries({
          fromUtc: '2026-06-24T00:00:00Z',
          toUtc: '2026-06-25T00:00:00Z',
          billable: 'billable',
          search: 'refactor',
        })
        .map((e) => e.description),
    ).toEqual(['auth refactor']);
    store.close();
  });

  it('report({ search }) totals only matching entries', () => {
    const store = searchStore();
    const report = store.report({
      fromUtc: '2026-06-24T00:00:00Z',
      toUtc: '2026-06-25T00:00:00Z',
      by: 'client',
      billableFilter: 'all',
      rounding: false,
      roundingIncrementMin: 15,
      search: 'refactor',
    });
    expect(report.grandTotalSeconds).toBe(7200); // only the 2h "auth refactor"
    store.close();
  });
});

describe('GOLD: describeOverlaps detail (§12 R9)', () => {
  // A bare EntryView is all describeOverlaps reads (id/startUtc/endUtc); the rest is filled
  // so the shape type-checks. Two entries: 09:00–11:00 and 10:00–10:30 (the second nested
  // inside the first), sharing exactly 30 minutes.
  const entry = (id: number, startUtc: string, endUtc: string): EntryView => ({
    id,
    clientId: null,
    projectId: null,
    description: null,
    startUtc,
    endUtc,
    billable: true,
    excludedSeconds: 0,
    clientName: null,
    projectName: null,
    tags: [],
    sleepSpans: [],
    sleptThrough: false,
    rawSeconds: (Date.parse(endUtc) - Date.parse(startUtc)) / 1000,
    billableSeconds: (Date.parse(endUtc) - Date.parse(startUtc)) / 1000,
  });

  it('pins the overlap minutes + neighbour relation for a fixed overlapping pair', () => {
    const earlier = entry(1, '2026-06-24T09:00:00Z', '2026-06-24T11:00:00Z');
    const later = entry(2, '2026-06-24T10:00:00Z', '2026-06-24T10:30:00Z');
    const detail = describeOverlaps([earlier, later]);

    // Both entries are flagged; each shares the same 30-minute (1800s) span.
    expect([...detail.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(detail.get(1)).toEqual({ overlapSeconds: 1800, neighborId: 2, relation: 'next' });
    // From entry 2's vantage point its neighbour (entry 1) started earlier — 'previous'.
    expect(detail.get(2)).toEqual({ overlapSeconds: 1800, neighborId: 1, relation: 'previous' });
  });

  it('omits an entry that overlaps nothing', () => {
    const a = entry(1, '2026-06-24T09:00:00Z', '2026-06-24T10:00:00Z');
    const b = entry(2, '2026-06-24T10:00:00Z', '2026-06-24T11:00:00Z'); // touches, not overlap
    expect(describeOverlaps([a, b]).size).toBe(0);
  });
});

/**
 * Local midnight on a LITERAL calendar date, as the UTC instant a range bound carries.
 *
 * Range bounds are local-midnight instants, so a fully hard-coded `Z` string would only be
 * right in one timezone. A `new Date(y, monthIndex, day)` construction names the exact day
 * the boundary must land on while holding in whatever timezone the suite runs — the same
 * form `gui/test/reportview.test.ts` pins `resolveDateRange` with.
 */
const localMidnight = (year: number, monthIndex: number, day: number) =>
  new Date(year, monthIndex, day).toISOString();

describe('GOLD: resolveRange preset windows (§09 R01)', () => {
  // The five presets are the windows every report and export is measured over, so each
  // boundary is pinned to a literal calendar date read off a 2026 calendar — never to a
  // second call of resolveRange, which would only prove the function agrees with itself.
  // Flip the week-start offset, drop a day, or swap a month and the named day changes and
  // these redden. `now` is likewise built from local parts, so its local calendar day (and
  // weekday) is the same everywhere the suite runs.
  const WEDNESDAY = new Date(2026, 5, 24, 18, 0, 0); // 2026-06-24 18:00 local — a Wednesday

  it('this week runs from the Monday on or before now to the following Monday (weekStart=monday)', () => {
    expect(resolveRange('week', 'monday', WEDNESDAY)).toEqual({
      fromUtc: localMidnight(2026, 5, 22), // Mon 2026-06-22
      toUtc: localMidnight(2026, 5, 29), // Mon 2026-06-29
    });
  });

  it('this week runs from the Sunday on or before now to the following Sunday (weekStart=sunday)', () => {
    expect(resolveRange('week', 'sunday', WEDNESDAY)).toEqual({
      fromUtc: localMidnight(2026, 5, 21), // Sun 2026-06-21
      toUtc: localMidnight(2026, 5, 28), // Sun 2026-06-28
    });
  });

  it('a Sunday belongs to the week that started the PREVIOUS Monday (weekStart=monday)', () => {
    // The week-start offset's hardest day: Sunday is day 0, so a Monday-start week must
    // reach six days BACK, not zero. A mid-week `now` cannot tell the two rules apart.
    expect(resolveRange('week', 'monday', new Date(2026, 5, 28, 12, 0, 0))).toEqual({
      fromUtc: localMidnight(2026, 5, 22), // Mon 2026-06-22
      toUtc: localMidnight(2026, 5, 29), // Mon 2026-06-29
    });
  });

  it('a Monday belongs to the week that started the PREVIOUS Sunday (weekStart=sunday)', () => {
    // The mirror case: under a Sunday-start week a Monday `now` reaches one day back.
    expect(resolveRange('week', 'sunday', new Date(2026, 5, 22, 12, 0, 0))).toEqual({
      fromUtc: localMidnight(2026, 5, 21), // Sun 2026-06-21
      toUtc: localMidnight(2026, 5, 28), // Sun 2026-06-28
    });
  });

  it('last week is the seven days ending where this week begins (weekStart=monday)', () => {
    expect(resolveRange('last-week', 'monday', WEDNESDAY)).toEqual({
      fromUtc: localMidnight(2026, 5, 15), // Mon 2026-06-15
      toUtc: localMidnight(2026, 5, 22), // Mon 2026-06-22
    });
  });

  it('last week is the seven days ending where this week begins (weekStart=sunday)', () => {
    expect(resolveRange('last-week', 'sunday', WEDNESDAY)).toEqual({
      fromUtc: localMidnight(2026, 5, 14), // Sun 2026-06-14
      toUtc: localMidnight(2026, 5, 21), // Sun 2026-06-21
    });
  });

  it('a week spanning the year boundary keeps running into January', () => {
    // Thu 2026-12-31 sits in the week Mon 2026-12-28 … Mon 2027-01-04.
    expect(resolveRange('week', 'monday', new Date(2026, 11, 31, 9, 0, 0))).toEqual({
      fromUtc: localMidnight(2026, 11, 28), // Mon 2026-12-28
      toUtc: localMidnight(2027, 0, 4), // Mon 2027-01-04
    });
  });

  it('a week spanning a DST transition still runs local-midnight to local-midnight', () => {
    // 2026-03-08 is the US spring-forward. The week containing it is 167 or 169 hours long
    // on a US host, so `+ 7 × 24h` would land an hour off the Monday midnight; calendar
    // day arithmetic lands on it exactly. Wed 2026-03-11 sits in Mon 03-09 … Mon 03-16.
    expect(resolveRange('week', 'monday', new Date(2026, 2, 11, 12, 0, 0))).toEqual({
      fromUtc: localMidnight(2026, 2, 9), // Mon 2026-03-09
      toUtc: localMidnight(2026, 2, 16), // Mon 2026-03-16
    });
  });

  it('this month runs from the 1st to the 1st of the next month', () => {
    expect(resolveRange('month', 'monday', WEDNESDAY)).toEqual({
      fromUtc: localMidnight(2026, 5, 1), // 2026-06-01
      toUtc: localMidnight(2026, 6, 1), // 2026-07-01
    });
  });

  it('last month runs from the previous 1st to this month’s 1st', () => {
    expect(resolveRange('last-month', 'monday', WEDNESDAY)).toEqual({
      fromUtc: localMidnight(2026, 4, 1), // 2026-05-01
      toUtc: localMidnight(2026, 5, 1), // 2026-06-01
    });
  });

  it('last month from January reaches back into the previous year', () => {
    expect(resolveRange('last-month', 'monday', new Date(2026, 0, 15, 12, 0, 0))).toEqual({
      fromUtc: localMidnight(2025, 11, 1), // 2025-12-01
      toUtc: localMidnight(2026, 0, 1), // 2026-01-01
    });
  });

  it('the 31st of a month still resolves to whole-month bounds, and back to a short February', () => {
    // Day-of-month never leaks into the bounds: from the 31st of March, this month is
    // 03-01 … 04-01 and last month is 02-01 … 03-01 (February 2026 has 28 days).
    const lastDayOfMarch = new Date(2026, 2, 31, 23, 30, 0);
    expect(resolveRange('month', 'monday', lastDayOfMarch)).toEqual({
      fromUtc: localMidnight(2026, 2, 1), // 2026-03-01
      toUtc: localMidnight(2026, 3, 1), // 2026-04-01
    });
    expect(resolveRange('last-month', 'monday', lastDayOfMarch)).toEqual({
      fromUtc: localMidnight(2026, 1, 1), // 2026-02-01
      toUtc: localMidnight(2026, 2, 1), // 2026-03-01
    });
  });

  it('today is the local calendar day now falls on, to the next local midnight', () => {
    expect(resolveRange('today', 'monday', WEDNESDAY)).toEqual({
      fromUtc: localMidnight(2026, 5, 24), // 2026-06-24
      toUtc: localMidnight(2026, 5, 25), // 2026-06-25
    });
  });

  it('today on a DST-transition day ends at the true next local midnight, never +24h', () => {
    // A 23- or 25-hour local day (2026-03-08 in the US) — the day-after bound is calendar
    // arithmetic, so on such a host it differs from the naive `+ 24h` result.
    expect(resolveRange('today', 'monday', new Date(2026, 2, 8, 12, 0, 0))).toEqual({
      fromUtc: localMidnight(2026, 2, 8), // 2026-03-08
      toUtc: localMidnight(2026, 2, 9), // 2026-03-09
    });
  });
});

describe('GOLD: the configured time zone drives resolution and parsing (§04 R06, §14)', () => {
  // With an EXPLICIT zone the bounds pin to absolute `Z` literals valid on every host —
  // strictly stronger than the host-zone goldens above, which must float with the runner.
  // Every literal is read off a 2026 calendar + the zone's published offsets, never off a
  // second call of the code under test.
  const NOW = new Date('2026-06-24T17:30:00Z'); // Wed; 11:30 in Edmonton (MDT, UTC−6)

  it('today in a pinned zone is that zone’s calendar day, midnight to midnight', () => {
    expect(resolveRange('today', 'monday', NOW, 'America/Edmonton')).toEqual({
      fromUtc: '2026-06-24T06:00:00.000Z', // Wed 00:00 MDT
      toUtc: '2026-06-25T06:00:00.000Z', // Thu 00:00 MDT
    });
  });

  it('this week in a pinned zone runs Monday-midnight to Monday-midnight in THAT zone', () => {
    expect(resolveRange('week', 'monday', NOW, 'America/Edmonton')).toEqual({
      fromUtc: '2026-06-22T06:00:00.000Z', // Mon 2026-06-22 00:00 MDT
      toUtc: '2026-06-29T06:00:00.000Z', // Mon 2026-06-29 00:00 MDT
    });
  });

  it('the pinned zone decides WHICH day "today" is, not just its bounds', () => {
    // 2026-06-25T03:00Z is still Wed Jun 24 in Edmonton but already Thu Jun 25 in UTC —
    // the two zones disagree on the calendar day itself.
    const lateEvening = new Date('2026-06-25T03:00:00Z');
    expect(resolveRange('today', 'monday', lateEvening, 'America/Edmonton')).toEqual({
      fromUtc: '2026-06-24T06:00:00.000Z',
      toUtc: '2026-06-25T06:00:00.000Z',
    });
    expect(resolveRange('today', 'monday', lateEvening, 'UTC')).toEqual({
      fromUtc: '2026-06-25T00:00:00.000Z',
      toUtc: '2026-06-26T00:00:00.000Z',
    });
    expect(localDay('2026-06-25T03:00:00Z', 'America/Edmonton')).toBe('2026-06-24');
    expect(localDay('2026-06-25T03:00:00Z', 'UTC')).toBe('2026-06-25');
  });

  it('a DST-spanning week in a pinned zone bounds at true local midnights (167-hour week)', () => {
    // The week of Sun 2026-03-08 in America/New_York contains the spring-forward: it opens
    // at EST midnight (05:00Z) and closes at EDT midnight (04:00Z) — 167 hours, which a
    // naive `+ 7 × 24h` can never produce.
    const midWeek = new Date('2026-03-11T12:00:00Z');
    expect(resolveRange('week', 'sunday', midWeek, 'America/New_York')).toEqual({
      fromUtc: '2026-03-08T05:00:00.000Z', // Sun 00:00 EST
      toUtc: '2026-03-15T04:00:00.000Z', // Sun 00:00 EDT
    });
  });

  it('a month in a pinned zone runs 1st-midnight to 1st-midnight in that zone', () => {
    expect(resolveRange('month', 'monday', NOW, 'America/Edmonton')).toEqual({
      fromUtc: '2026-06-01T06:00:00.000Z',
      toUtc: '2026-07-01T06:00:00.000Z',
    });
  });

  it('a bare clock time parses as today-in-the-configured-zone (tt add 14:30)', () => {
    // 14:30 on the Edmonton calendar day of NOW (Wed Jun 24, MDT = UTC−6) → 20:30Z.
    expect(parseTime('14:30', NOW, 'America/Edmonton')).toBe('2026-06-24T20:30:00Z');
    expect(parseTime('14:30', NOW, 'UTC')).toBe('2026-06-24T14:30:00Z');
  });

  it('a zoneless datetime parses in the configured zone, DST-compatible (§04 R06)', () => {
    // Nonexistent (spring-forward gap): 02:30 never happens on 2026-03-08 in New York —
    // compatible mode shifts it forward past the gap to 03:30 EDT (07:30Z).
    expect(parseTime('2026-03-08T02:30', NOW, 'America/New_York')).toBe('2026-03-08T07:30:00Z');
    // Ambiguous (fall-back hour): 01:30 happens twice on 2026-11-01 — compatible mode takes
    // the EARLIER instant (EDT, 05:30Z), never the second pass (EST, 06:30Z).
    expect(parseTime('2026-11-01T01:30', NOW, 'America/New_York')).toBe('2026-11-01T05:30:00Z');
    // An explicit-zone instant is untouched by the configured zone.
    expect(parseTime('2026-06-24T14:30:00Z', NOW, 'America/New_York')).toBe('2026-06-24T14:30:00Z');
  });

  it('formatStamp renders the configured zone through the one display path', () => {
    const settings = { dateFormat: 'iso' as const, timeZone: 'America/Edmonton' };
    expect(formatStamp('2026-06-24T15:00:00Z', settings)).toBe('2026-06-24 09:00:00');
    expect(formatStamp(null, settings)).toBe('—');
    // 'system' resolves against the OS zone at read time — same wall clock as the host's.
    expect(formatStamp('2026-06-24T15:00:00Z', { dateFormat: 'iso', timeZone: 'system' })).toBe(
      formatStamp('2026-06-24T15:00:00Z', {
        dateFormat: 'iso',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    );
  });

  it('an unknown zone is rejected and stores nothing; UTC and IANA zones are accepted', () => {
    const store = Store.openMemory();
    try {
      expect(() => store.setSetting('timeZone', 'Mars/Olympus_Mons')).toThrow(/time_zone/);
      expect(store.settings().timeZone).toBe('system');
      store.setSetting('timeZone', 'America/Edmonton');
      expect(store.settings().timeZone).toBe('America/Edmonton');
      store.setSetting('timeZone', 'UTC');
      expect(store.settings().timeZone).toBe('UTC');
    } finally {
      store.close();
    }
  });
});

describe('GOLD: week/month grouping buckets (§09 R02)', () => {
  // The week/month group keys and their human labels: attribution is by the entry's START
  // day in the configured zone (the same rule as by-day, glossary "Group key"); a week
  // bucket is keyed by its start day under the configured week_start setting, a month
  // bucket by YYYY-MM. The store threads BOTH settings into the one groupKeysOf
  // derivation, so these run end-to-end through store.report.
  const WEEK_NOW = new Date('2026-07-31T12:00:00Z'); // Fri, mid-window
  const RANGE = { fromUtc: '2026-07-01T00:00:00Z', toUtc: '2026-08-01T00:00:00Z' };
  const OPTS = {
    ...RANGE,
    billableFilter: 'billable',
    rounding: false,
    roundingIncrementMin: 15,
  } as const;

  function weekStore() {
    const store = Store.openMemory(() => WEEK_NOW);
    store.setSetting('timeZone', 'UTC');
    // Wed Jul 29 and Thu Jul 30 — one configured week either way; a third entry the
    // PREVIOUS Saturday (Jul 25) splits differently under monday- vs sunday-start weeks.
    store.add({ billable: true, tags: [], fromUtc: '2026-07-29T09:00:00Z', toUtc: '2026-07-29T10:00:00Z' });
    store.add({ billable: true, tags: [], fromUtc: '2026-07-30T09:00:00Z', toUtc: '2026-07-30T11:00:00Z' });
    store.add({ billable: true, tags: [], fromUtc: '2026-07-25T09:00:00Z', toUtc: '2026-07-25T10:00:00Z' });
    return store;
  }

  it('week buckets key by the week start day of the entry start, per week_start', () => {
    const store = weekStore();
    // Default monday start: Sat Jul 25 → week of Mon Jul 20; Wed/Thu → week of Mon Jul 27.
    let r = store.report({ ...OPTS, by: 'week' });
    expect(r.lines.map((l) => [l.key, l.totalSeconds])).toEqual([
      ['2026-07-20', 3600],
      ['2026-07-27', 3 * 3600],
    ]);
    // Sunday start: Sat Jul 25 belongs to the week of Sun Jul 19; Wed/Thu to Sun Jul 26.
    store.setSetting('weekStart', 'sunday');
    r = store.report({ ...OPTS, by: 'week' });
    expect(r.lines.map((l) => l.key)).toEqual(['2026-07-19', '2026-07-26']);
    store.close();
  });

  it('a start near local midnight attributes to the CONFIGURED zone week', () => {
    const store = Store.openMemory(() => WEEK_NOW);
    store.setSetting('timeZone', 'America/Edmonton');
    // Mon Jul 27 03:00Z is still Sun Jul 26 in Edmonton (MDT, UTC−6) — under a
    // monday-start week it belongs to the week of Mon Jul 20, not Jul 27.
    store.add({ billable: true, tags: [], fromUtc: '2026-07-27T03:00:00Z', toUtc: '2026-07-27T04:00:00Z' });
    const r = store.report({ ...OPTS, by: 'week' });
    expect(r.lines.map((l) => l.key)).toEqual(['2026-07-20']);
    store.close();
  });

  it('month buckets key YYYY-MM of the start day in the configured zone', () => {
    const store = Store.openMemory(() => WEEK_NOW);
    store.setSetting('timeZone', 'America/Edmonton');
    // Aug 1 03:00Z is still Fri Jul 31 in Edmonton — it buckets under 2026-07.
    store.add({ billable: true, tags: [], fromUtc: '2026-08-01T03:00:00Z', toUtc: '2026-08-01T04:00:00Z' });
    store.add({ billable: true, tags: [], fromUtc: '2026-07-10T15:00:00Z', toUtc: '2026-07-10T16:00:00Z' });
    const r = store.report({ ...OPTS, toUtc: '2026-08-02T00:00:00Z', by: 'month' });
    expect(r.lines.map((l) => [l.key, l.totalSeconds])).toEqual([['2026-07', 2 * 3600]]);
    store.close();
  });

  it('the grand total is grouping-invariant across all six groupings', () => {
    const store = weekStore();
    const totals = (['client', 'project', 'day', 'week', 'month', 'tag'] as const).map(
      (by) => store.report({ ...OPTS, by }).grandTotalSeconds,
    );
    expect(new Set(totals).size).toBe(1);
    expect(totals[0]).toBe(4 * 3600);
    store.close();
  });

  it('groupKeyLabel renders "Week of Jul 27" / "Jul 2026" and leaves other keys raw', () => {
    expect(groupKeyLabel('2026-07-27', 'week')).toBe('Week of Jul 27');
    expect(groupKeyLabel('2026-01-05', 'week')).toBe('Week of Jan 5');
    expect(groupKeyLabel('2026-07', 'month')).toBe('Jul 2026');
    expect(groupKeyLabel('2026-12', 'month')).toBe('Dec 2026');
    expect(groupKeyLabel('2026-07-27', 'day')).toBe('2026-07-27');
    expect(groupKeyLabel('Acme', 'client')).toBe('Acme');
  });
});

describe('GOLD: saved report range round-trip (§09 R08–R09)', () => {
  // The artefact-is-criterion contract: a saved report's RELATIVE preset spec re-resolves
  // to the same {fromUtc,toUtc} the ad-hoc path produces (so a saved and an ad-hoc report
  // over the same window can never diverge), and an ABSOLUTE spec round-trips its exact
  // bounds. Fails if the preset/absolute discrimination or the resolution drifts.
  //
  // The re-resolved window is pinned to the literal week NOW falls in, not to a call
  // of resolveRange — comparing the two functions would pass just as happily if both were
  // wrong together, which is the whole failure mode a saved report can't afford.
  it('a stored this-week preset re-resolves to the literal week now falls in', () => {
    const store = Store.openMemory(() => NOW);
    store.saveReport({
      name: 'Weekly',
      rangeSpec: { kind: 'preset', preset: 'week' },
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
    });
    const def = store.getReport('Weekly')!;
    expect(def.rangeSpec).toEqual({ kind: 'preset', preset: 'week' });
    const resolved = resolveSavedRange(def.rangeSpec, store.settings().weekStart, NOW);
    // NOW is Wed 2026-06-24; the default weekStart is monday.
    expect(resolved).toEqual({
      fromUtc: localMidnight(2026, 5, 22), // Mon 2026-06-22
      toUtc: localMidnight(2026, 5, 29), // Mon 2026-06-29
    });
    store.close();
  });

  it('an absolute-range definition round-trips its exact bounds', () => {
    const store = Store.openMemory(() => NOW);
    const fromUtc = '2026-06-01T00:00:00.000Z';
    const toUtc = '2026-06-08T00:00:00.000Z';
    store.saveReport({
      name: 'June first week',
      rangeSpec: { kind: 'absolute', fromUtc, toUtc },
      by: 'project',
      billableFilter: 'all',
      rounding: true,
      roundingIncrementMin: 30,
    });
    const def = store.getReport('June first week')!;
    expect(def.rangeSpec).toEqual({ kind: 'absolute', fromUtc, toUtc });
    expect(resolveSavedRange(def.rangeSpec, store.settings().weekStart, NOW)).toEqual({
      fromUtc,
      toUtc,
    });
    // The rest of the definition round-trips too.
    expect(def.by).toBe('project');
    expect(def.billableFilter).toBe('all');
    expect(def.rounding).toBe(true);
    expect(def.roundingIncrementMin).toBe(30);
    store.close();
  });

  it('runReport resolves a stored this-week spec to the same totals as an ad-hoc report', () => {
    const store = Store.openMemory(() => NOW);
    const acme = store.addClient('Acme');
    store.add({
      description: 'review',
      clientId: acme.id,
      billable: true,
      fromUtc: '2026-06-24T09:00:00Z',
      toUtc: '2026-06-24T10:00:00Z',
    });
    store.saveReport({
      name: 'Weekly',
      rangeSpec: { kind: 'preset', preset: 'week' },
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
    });
    // The ad-hoc arm is driven from the literal week NOW (Wed 2026-06-24) falls in,
    // so "saved agrees with ad-hoc" is anchored to a known window rather than to whatever
    // resolveRange happens to return on both sides.
    const adhoc = store.report({
      fromUtc: localMidnight(2026, 5, 22), // Mon 2026-06-22
      toUtc: localMidnight(2026, 5, 29), // Mon 2026-06-29
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
    });
    const run = store.runReport('Weekly', NOW);
    expect(run.grandTotalSeconds).toBe(adhoc.grandTotalSeconds);
    expect(run.grandTotalSeconds).toBe(3600);
    expect(run.rangeFromUtc).toBe(localMidnight(2026, 5, 22));
    expect(run.rangeToUtc).toBe(localMidnight(2026, 5, 29));
    store.close();
  });

  it('resolveReportDef folds a def into the absolute request store.report runs', () => {
    // §09 R09 — the def's RangeSpec re-resolves through the same resolveRange the ad-hoc path
    // uses, and its grouping / billable filter / rounding / narrowing fold alongside, so the
    // resolved request IS what store.report consumes. Fails if the fold drops or alters a field.
    const store = Store.openMemory(() => NOW);
    const acme = store.addClient('Acme');
    store.saveReport({
      name: 'Filtered',
      rangeSpec: { kind: 'preset', preset: 'week' },
      by: 'project',
      billableFilter: 'all',
      clientId: acme.id,
      rounding: true,
      roundingIncrementMin: 30,
    });
    const def = store.getReport('Filtered')!;
    const ws = store.settings().weekStart;
    const resolved = resolveReportDef(def, ws, NOW);
    expect(resolved).toEqual({
      fromUtc: localMidnight(2026, 5, 22), // Mon 2026-06-22 — the week NOW falls in
      toUtc: localMidnight(2026, 5, 29), // Mon 2026-06-29
      by: 'project',
      billableFilter: 'all',
      rounding: true,
      roundingIncrementMin: 30,
      clientId: acme.id,
    });
    // …and store.report over that resolved request equals what runReport(name) returns.
    expect(store.runReport('Filtered', NOW)).toEqual(store.report(resolved));
    store.close();
  });

  it('runReport resolves by id ref to the same Report as by name', () => {
    // §09 R09 — runReport(ref) accepts a name OR a numeric id; both reach the same definition.
    const store = Store.openMemory(() => NOW);
    const acme = store.addClient('Acme');
    store.add({
      description: 'review',
      clientId: acme.id,
      billable: true,
      fromUtc: '2026-06-24T09:00:00Z',
      toUtc: '2026-06-24T10:00:00Z',
    });
    const def = store.saveReport({
      name: 'Weekly',
      rangeSpec: { kind: 'preset', preset: 'week' },
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
    });
    expect(store.runReport(def.id, NOW)).toEqual(store.runReport('Weekly', NOW));
    store.close();
  });

  it('exportSavedReport exports the FILTERED rows the report shows, not the raw range', () => {
    // §09 R06/R09 — export-from-saved is the report's OWN export: the FILTERED rows it shows
    // (its range narrowed by the def's client/project/tag/search + billable filter), byte-
    // identical to `tt report run <name> --csv|--json` and the GUI report's Export. The def's
    // billable-only filter DOES narrow the file, so the non-billable "admin" is dropped. The
    // RAW, whole-range escape hatch is a separate scope (`tt export` / "Export All Data").
    const store = Store.openMemory(() => NOW);
    const acme = store.addClient('Acme');
    store.add({
      description: 'review',
      clientId: acme.id,
      billable: true,
      fromUtc: '2026-06-24T09:00:00Z',
      toUtc: '2026-06-24T10:00:00Z',
    });
    store.add({
      description: 'admin',
      billable: false,
      fromUtc: '2026-06-23T09:00:00Z',
      toUtc: '2026-06-23T09:30:00Z',
    });
    store.saveReport({
      name: 'Weekly',
      rangeSpec: { kind: 'preset', preset: 'week' },
      by: 'client',
      billableFilter: 'billable', // billable-only, on screen AND in the filtered export…
      rounding: false,
      roundingIncrementMin: 15,
    });
    // The filtered export == the report's rows (billable-only): "review" alone, no "admin".
    const filtered = store.reportFilteredEntries('Weekly', NOW);
    expect(filtered.map((e) => e.description)).toEqual(['review']);
    expect(store.exportSavedReport('Weekly', 'csv', NOW)).toBe(toCsv(filtered, NOW));
    expect(store.exportSavedReport('Weekly', 'json', NOW)).toEqual(toJsonEntries(filtered, NOW));
    expect(store.exportSavedReport('Weekly', 'json', NOW)).toHaveLength(1);
    // …while the ALL-DATA scope over the SAME resolved range still carries BOTH entries (the
    // non-billable "admin" too) — the raw file `tt export --range …` / "Export All Data" writes.
    const range = store.resolveReportRange('Weekly', NOW);
    const raw = store.listEntries({ fromUtc: range.fromUtc, toUtc: range.toUtc, billable: 'all' });
    expect(raw).toHaveLength(2);
    expect(store.exportSavedReport('Weekly', 'json', NOW)).not.toEqual(toJsonEntries(raw, NOW));
    store.close();
  });

  it('runReport / exportSavedReport throw a clear error for an unknown name', () => {
    const store = Store.openMemory(() => NOW);
    expect(() => store.runReport('Nope')).toThrow(/no saved report named "Nope"/);
    expect(() => store.exportSavedReport('Nope', 'csv')).toThrow(/no saved report named "Nope"/);
    store.close();
  });

  it('rejects a duplicate name (case-insensitive)', () => {
    const store = Store.openMemory(() => NOW);
    const def = {
      rangeSpec: { kind: 'preset', preset: 'week' } as const,
      by: 'client' as const,
      billableFilter: 'billable' as const,
      rounding: false,
      roundingIncrementMin: 15,
    };
    store.saveReport({ name: 'Weekly', ...def });
    expect(() => store.saveReport({ name: 'weekly', ...def })).toThrow();
    store.close();
  });
});

describe('GOLD: favorite table + pinFavorite capture (§05 R09)', () => {
  // Artefact-is-criterion: a fresh store carries the favorite / favorite_tag tables (proven by
  // an insert round-trip), pinFavorite from an entry captures that entry's EXACT template
  // (client/project/billable/tags), and the serialized fav-ls payload matches favorite.schema.json.
  it('a freshly opened store round-trips a favorite + its tags through the tables', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO client(name) VALUES('Acme')").run();
    db.prepare(
      "INSERT INTO favorite(name, description, client_id, project_id, billable) VALUES('Standup', 'standup', 1, NULL, 1)",
    ).run();
    db.prepare("INSERT INTO tag(name) VALUES('deep')").run();
    db.prepare('INSERT INTO favorite_tag(favorite_id, tag_id) VALUES(1, 1)').run();
    const fav = db.prepare('SELECT * FROM favorite WHERE id = 1').get() as {
      name: string;
      description: string | null;
      client_id: number | null;
      billable: number;
    };
    expect(fav).toMatchObject({ name: 'Standup', description: 'standup', client_id: 1, billable: 1 });
    const tags = db.prepare('SELECT tag_id FROM favorite_tag WHERE favorite_id = 1').all();
    expect(tags).toHaveLength(1);
    db.close();
  });

  it('pinFavorite from an entry captures the entry template, listFavorites returns it', () => {
    const store = Store.openMemory(() => NOW);
    const acme = store.addClient('Acme');
    const api = store.addProject('API', acme.id);
    const { value: entry } = store.add({
      description: 'auth refactor',
      clientId: acme.id,
      projectId: api.id,
      billable: true,
      tags: ['deep', 'focus'],
      fromUtc: '2026-06-24T09:00:00Z',
      toUtc: '2026-06-24T10:30:00Z',
    });
    const created = store.pinFavorite({ name: 'Auth', fromEntryId: entry.id });
    expect(created).toMatchObject({
      name: 'Auth',
      description: 'auth refactor',
      clientId: acme.id,
      projectId: api.id,
      billable: true,
      tags: ['deep', 'focus'],
    });
    const favs = store.listFavorites();
    expect(favs).toHaveLength(1);
    expect(favs[0]).toEqual(created);
    store.close();
  });

  it("pinFavorite from the running entry ('open') captures the open entry's template", () => {
    const store = Store.openMemory(() => NOW);
    const acme = store.addClient('Acme');
    store.start({ description: 'standup', clientId: acme.id, billable: true, tags: ['daily'] });
    const created = store.pinFavorite({ name: 'Standup', fromEntryId: 'open' });
    expect(created).toMatchObject({
      name: 'Standup',
      description: 'standup',
      clientId: acme.id,
      projectId: null,
      billable: true,
      tags: ['daily'],
    });
    store.close();
  });

  it('rejects a duplicate favorite name (case-insensitive) and an unknown rename/unpin ref', () => {
    const store = Store.openMemory(() => NOW);
    store.pinFavorite({ name: 'Deep', billable: false, tags: ['focus'] });
    expect(() => store.pinFavorite({ name: 'deep', billable: false })).toThrow(/already exists/);
    expect(() => store.renameFavorite('Nope', 'X')).toThrow(/no favorite named "Nope"/);
    expect(() => store.unpinFavorite('Nope')).toThrow(/no favorite named "Nope"/);
    store.close();
  });

  it('the serialized fav-ls payload validates against favorite.schema.json', () => {
    const store = Store.openMemory(() => NOW);
    const acme = store.addClient('Acme');
    const api = store.addProject('API', acme.id);
    store.pinFavorite({
      name: 'Auth',
      description: 'auth refactor',
      clientId: acme.id,
      projectId: api.id,
      billable: true,
      tags: ['deep'],
    });
    // Mirror the CLI's favoriteJson projector (serialize.ts) — the published fav-ls shape.
    const payload = store.listFavorites().map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      client_id: f.clientId,
      project_id: f.projectId,
      billable: f.billable,
      tags: f.tags,
    }));
    const validate = ajv.compile(schema('favorite.schema.json'));
    expect(validate(payload) || validate.errors).toBe(true);
    store.close();
  });
});

describe('GOLD: resume closes the open entry at now, with no end-of-day clamp (§04 R04 / §05 R10 / §16)', () => {
  // §04 R04 / §16 — starting OR resuming closes any open entry at `now`, full stop: there is no
  // end-of-day (23:59) clamp on the close. The BDD favorites scenario runs on a clock fixed at
  // 23:59, so a close-at-now and a (wrong) clamp-to-day-end produce the SAME instant there and
  // cannot tell them apart. These guards pin the close to `now` on a NON-boundary clock (noon),
  // where the two behaviours diverge: the stopped entry must end at exactly 12:00, never 23:59.
  // Stored ends are core's `toUtc` form (Z, no milliseconds), matching NOW exactly.
  const DAY_END = '2026-06-24T23:59:00Z'; // the boundary a clamp would (wrongly) produce
  const NOON = '2026-06-24T12:00:00Z'; // === NOW — the real `now`

  it('resume-from-favorite closes the previously open entry at now (not the day boundary)', () => {
    const store = Store.openMemory(() => NOW);
    // An entry opened earlier in the day; `now` is noon, well before any day boundary.
    store.start({ description: 'earlier work', atUtc: '2026-06-24T09:00:00Z' });
    store.pinFavorite({ name: 'Deep', billable: false, tags: ['focus'] });
    // Resuming from the favorite atomically closes the open entry, then opens a fresh one.
    store.startFromFavorite('Deep');
    const earlier = store.listEntries().find((e) => e.description === 'earlier work')!;
    expect(earlier.endUtc).toBe(NOON);
    expect(earlier.endUtc).not.toBe(DAY_END);
    // …and exactly one entry is open afterwards (the favorite-seeded one).
    expect(store.listEntries().filter((e) => e.endUtc === null)).toHaveLength(1);
    store.close();
  });

  it('a plain start (Switch) and resume() likewise close the open entry at now', () => {
    const store = Store.openMemory(() => NOW);
    store.start({ description: 'first', atUtc: '2026-06-24T08:00:00Z' });
    // Switch: a bare start closes the open entry at now and opens a new one.
    store.start({ description: 'second' });
    expect(store.listEntries().find((e) => e.description === 'first')!.endUtc).toBe(NOON);
    // resume() copies the last entry's template and, like start, closes the open one at now.
    store.resume();
    expect(store.listEntries().find((e) => e.description === 'second')!.endUtc).toBe(NOON);
    store.close();
  });
});

describe('GOLD: date/build version constant (§19 R06)', () => {
  // §19 R06 — the single shared APP_VERSION constant BOTH surfaces read (the tt CLI's
  // `--version` and the GUI Settings → Software Update view) is the date/build release
  // version, not a placeholder. The artefact is the criterion: isReleaseVersion accepts the
  // `YYYY.M.D[.N]` shape (month/day NOT zero-padded, per the spec example `2026.6.27`) and
  // rejects a semver like the old hardcoded `1.0.0`; APP_VERSION, when overridden via
  // STINT_VERSION, equals exactly that stamped string.
  it('isReleaseVersion accepts YYYY.M.D and YYYY.M.D.N (not zero-padded)', () => {
    expect(isReleaseVersion('2026.6.27')).toBe(true);
    expect(isReleaseVersion('2026.6.27.2')).toBe(true);
    expect(isReleaseVersion('2026.12.1')).toBe(true);
    expect(isReleaseVersion('2026.06.27')).toBe(true); // zero-padded still matches the \d{1,2} shape
  });

  it('isReleaseVersion rejects a semver and other non-date strings (the old 1.0.0 fails)', () => {
    expect(isReleaseVersion('1.0.0')).toBe(false); // the old hardcoded CLI version
    expect(isReleaseVersion(DEV_VERSION)).toBe(false); // the dev sentinel is not a release
    expect(isReleaseVersion('')).toBe(false);
    expect(isReleaseVersion('2026.6')).toBe(false); // missing the day
    expect(isReleaseVersion('v2026.6.27')).toBe(false); // no leading prefix
    expect(VERSION_RE.test('2026.6.27.2')).toBe(true);
  });

  it('APP_VERSION is the env override when set, else a release version or the dev sentinel', () => {
    // The shared constant both surfaces read. When STINT_VERSION is set (the CI stamp / test
    // hook) APP_VERSION equals it exactly; otherwise it is a stamped release OR the deterministic
    // offline sentinel — and never the old hardcoded 1.0.0.
    if (process.env.STINT_VERSION) {
      expect(APP_VERSION).toBe(process.env.STINT_VERSION);
    } else {
      expect(APP_VERSION === DEV_VERSION || isReleaseVersion(APP_VERSION)).toBe(true);
      expect(APP_VERSION).not.toBe('1.0.0');
    }
  });
});

describe('GOLD: JSON export shape (§09 R06)', () => {
  it('validates against the published JSON Schema', () => {
    const store = fixtureStore();
    const json = toJsonEntries(store.listEntries(), NOW);
    const validate = ajv.compile(schema('export-entry.schema.json'));
    const ok = validate(json);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
    expect(json[0]).toMatchObject({
      client: 'Client A',
      project: 'API',
      tags: ['deep', 'meeting'],
      description: 'auth refactor',
      start_utc: '2026-06-24T09:00:00Z',
      end_utc: '2026-06-24T10:30:00Z',
      raw_duration_s: 5400,
      excluded_s: 0,
      billable: true,
      overlapped: false,
    });
    store.close();
  });
});

describe('GOLD: reference-data name uniqueness (§07 R03, #64)', () => {
  // The bug: client/project/tag names carried no uniqueness guard, so a duplicate client (added
  // or renamed-onto) slipped through and a by-client report merged the two into one line —
  // silently conflating billing. The guard now matches the favorites/saved-report contract:
  // unique case-insensitively, spanning archived records, with per-client project scope; the
  // on-the-fly tagging path keeps its case-insensitive REUSE (resolution, not an error).

  it('rejects a duplicate CLIENT name (case-insensitive) on add and rename', () => {
    const store = Store.openMemory(() => NOW);
    store.addClient('Acme Corp');
    // add: a case-variant duplicate is refused, so no second row can split Acme's billing.
    expect(() => store.addClient('acme corp')).toThrow(/already exists/i);
    const beta = store.addClient('Beta Labs');
    // rename onto a DIFFERENT client's name is refused…
    expect(() => store.renameClient(beta.id, 'ACME CORP')).toThrow(/already exists/i);
    // …but a case-only SELF-rename (same row) is allowed.
    expect(() => store.renameClient(beta.id, 'beta labs')).not.toThrow();
    expect(store.listClients().map((c) => c.name).sort()).toEqual(['Acme Corp', 'beta labs']);
    store.close();
  });

  it('scopes PROJECT uniqueness per client: dup under same client rejected, same name under another client allowed', () => {
    const store = Store.openMemory(() => NOW);
    const acme = store.addClient('Acme');
    const globex = store.addClient('Globex');
    store.addProject('Platform', acme.id);
    expect(() => store.addProject('platform', acme.id)).toThrow(/already exists/i);
    // The SAME name under a DIFFERENT client is fine — projects are unique per client.
    expect(() => store.addProject('Platform', globex.id)).not.toThrow();
    // rename onto a sibling under the same client is rejected; case-only self-rename allowed.
    const billing = store.addProject('Billing', acme.id);
    expect(() => store.renameProject(billing.id, 'PLATFORM')).toThrow(/already exists/i);
    expect(() => store.renameProject(billing.id, 'billing')).not.toThrow();
    store.close();
  });

  it('rejects a duplicate TAG name (case-insensitive) on explicit add and on rename', () => {
    const store = Store.openMemory(() => NOW);
    store.addTag('billing');
    // The tag table's own UNIQUE is binary-collated; the app-level guard is what catches a case
    // variant on the explicit manage-first path.
    expect(() => store.addTag('Billing')).toThrow(/already exists/i);
    const invoicing = store.addTag('invoicing');
    expect(() => store.renameTag(invoicing.id, 'BILLING')).toThrow(/already exists/i);
    expect(() => store.renameTag(invoicing.id, 'Invoicing')).not.toThrow(); // case-only self-rename
    store.close();
  });

  it('the ON-THE-FLY tagging path REUSES a case-variant tag (no new row, no error)', () => {
    const store = Store.openMemory(() => NOW);
    const { value: e } = store.add({
      description: 'a',
      billable: false,
      tags: ['deep'],
      fromUtc: '2026-06-24T09:00:00Z',
      toUtc: '2026-06-24T10:00:00Z',
    });
    // Applying a case-variant of an existing tag resolves to the same tag — §07 R03 resolution.
    expect(() => store.edit(e.id, { addTags: ['Deep'] })).not.toThrow();
    expect(store.listTags().map((t) => t.name)).toEqual(['deep']);
    store.close();
  });

  it('uniqueness spans ARCHIVED records and the message steers to Restore', () => {
    const store = Store.openMemory(() => NOW);
    const acme = store.addClient('Acme Corp');
    store.archiveClient(acme.id);
    // An archived record still holds its name: a fresh add of a case variant is rejected, and
    // the message points at the archived record (Restore it instead of minting a duplicate).
    expect(() => store.addClient('acme corp')).toThrow(/archived client .* already exists .* Restore/i);
    store.close();
  });
});
