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
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
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
  describeOverlaps,
  resolveRange,
  resolveSavedRange,
  resolveReportDef,
  defaultDataDir,
  DB_FILENAME,
  APP_VERSION,
  DEV_VERSION,
  VERSION_RE,
  isReleaseVersion,
} from '@stint/core';
import type { EntryView, Db } from '@stint/core';

const ajv = addFormats(new Ajv({ allErrors: true }));
const schema = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../../acceptance/criteria/schemas/${name}`, import.meta.url)),
      'utf8',
    ),
  );

const FIXED_NOW = '2026-06-24T12:00:00Z';
function fixtureStore() {
  const store = Store.openMemory(() => new Date(FIXED_NOW));
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
        "rounding": false,
        "roundingIncrementMin": 15,
        "weekStart": "monday",
      }
    `);
    expect(store.settings()).toEqual(DEFAULT_SETTINGS);
    store.close();
  });

  it('schema version is pinned', () => {
    expect(SCHEMA_VERSION).toBe(3);
  });

  it('a corrupt stored value falls back to the default on read (reads as strict as writes)', () => {
    const db = openDb(':memory:');
    // Inject values the write path would have rejected, straight into the table.
    db.prepare("INSERT INTO setting(key, value) VALUES('rounding_increment_min', '999')").run();
    db.prepare("INSERT INTO setting(key, value) VALUES('checkin_interval_min', 'NaN')").run();
    const s = readSettings(db);
    expect(s.roundingIncrementMin).toBe(DEFAULT_SETTINGS.roundingIncrementMin);
    expect(s.checkinIntervalMin).toBe(DEFAULT_SETTINGS.checkinIntervalMin);
    db.close();
  });
});

describe('GOLD: schema shape (§13)', () => {
  // Artefact-is-criterion: the v3 schema IS the contract. A fresh in-memory DB must carry
  // the new favorite / favorite_tag / report tables with the exact §13 column sets and the
  // §20 R02 partial unique index over the constant (1) WHERE end_utc IS NULL — and open with
  // foreign_keys ON. A regression (missing table/column/index, or a stale version) fails here.
  const objects = (db: Db, type: 'table' | 'index') =>
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name")
        .all(type) as { name: string }[]
    ).map((r) => r.name);
  const columns = (db: Db, table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);

  it('SCHEMA_VERSION is pinned to 3 and a fresh DB stamps user_version = 3', () => {
    expect(SCHEMA_VERSION).toBe(3);
    const db = openDb(':memory:');
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(3);
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
      const store = Store.open({ path: join(dir, 'stint.db'), clock: () => new Date(FIXED_NOW) });
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
    const csv = toCsv(store.listEntries(), new Date(FIXED_NOW));
    expect(csv).toMatchInlineSnapshot(`
      "client,project,tags,description,start_utc,end_utc,raw_duration_s,excluded_s,billable,overlapped
      Client A,API,deep;meeting,auth refactor,2026-06-24T09:00:00Z,2026-06-24T10:30:00Z,5400,0,true,false
      "
    `);
    store.close();
  });

  it('quotes cells containing commas, quotes, or newlines', () => {
    const store = Store.openMemory(() => new Date(FIXED_NOW));
    store.add({
      description: 'wrote "the, report"',
      fromUtc: '2026-06-24T09:00:00Z',
      toUtc: '2026-06-24T09:30:00Z',
    });
    const csv = toCsv(store.listEntries(), new Date(FIXED_NOW));
    expect(csv.split('\n')[1]).toContain('"wrote ""the, report"""');
    store.close();
  });
});

describe('GOLD: free-text search query contract (§09 R7)', () => {
  function searchStore() {
    const store = Store.openMemory(() => new Date(FIXED_NOW));
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

describe('GOLD: saved report range round-trip (§09 R08–R09)', () => {
  // The artefact-is-criterion contract: a saved report's RELATIVE preset spec re-resolves
  // to the SAME {fromUtc,toUtc} as the ad-hoc resolveRange (so a saved and an ad-hoc report
  // over the same window can never diverge), and an ABSOLUTE spec round-trips its exact
  // bounds. Fails if the preset/absolute discrimination or the resolution drifts.
  it('a stored this-week preset resolves to the same window as resolveRange("week")', () => {
    const now = new Date(FIXED_NOW);
    const store = Store.openMemory(() => now);
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
    const resolved = resolveSavedRange(def.rangeSpec, store.settings().weekStart, now);
    expect(resolved).toEqual(resolveRange('week', store.settings().weekStart, now));
    store.close();
  });

  it('an absolute-range definition round-trips its exact bounds', () => {
    const now = new Date(FIXED_NOW);
    const store = Store.openMemory(() => now);
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
    expect(resolveSavedRange(def.rangeSpec, store.settings().weekStart, now)).toEqual({
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
    const now = new Date(FIXED_NOW);
    const store = Store.openMemory(() => now);
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
    const range = resolveRange('week', store.settings().weekStart, now);
    const adhoc = store.report({
      fromUtc: range.fromUtc,
      toUtc: range.toUtc,
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
    });
    const run = store.runReport('Weekly', now);
    expect(run.grandTotalSeconds).toBe(adhoc.grandTotalSeconds);
    expect(run.grandTotalSeconds).toBe(3600);
    expect(run.rangeFromUtc).toBe(range.fromUtc);
    expect(run.rangeToUtc).toBe(range.toUtc);
    store.close();
  });

  it('resolveReportDef folds a def into the absolute request store.report runs', () => {
    // §09 R09 — the def's RangeSpec re-resolves through the same resolveRange the ad-hoc path
    // uses, and its grouping / billable filter / rounding / narrowing fold alongside, so the
    // resolved request IS what store.report consumes. Fails if the fold drops or alters a field.
    const now = new Date(FIXED_NOW);
    const store = Store.openMemory(() => now);
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
    const resolved = resolveReportDef(def, ws, now);
    const range = resolveRange('week', ws, now);
    expect(resolved).toEqual({
      fromUtc: range.fromUtc,
      toUtc: range.toUtc,
      by: 'project',
      billableFilter: 'all',
      rounding: true,
      roundingIncrementMin: 30,
      clientId: acme.id,
    });
    // …and store.report over that resolved request equals what runReport(name) returns.
    expect(store.runReport('Filtered', now)).toEqual(store.report(resolved));
    store.close();
  });

  it('runReport resolves by id ref to the same Report as by name', () => {
    // §09 R09 — runReport(ref) accepts a name OR a numeric id; both reach the same definition.
    const now = new Date(FIXED_NOW);
    const store = Store.openMemory(() => now);
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
    expect(store.runReport(def.id, now)).toEqual(store.runReport('Weekly', now));
    store.close();
  });

  it('exportSavedReport equals toCsv/toJsonEntries over the resolved range raw entries', () => {
    // §09 R09 — export-from-saved is the durability path: the RAW entries for the resolved
    // window (billable='all', no narrowing), byte-identical to the core exporters `tt export`
    // and the GUI Export buttons use. The saved report's billable filter must NOT narrow the
    // export (it shapes the on-screen totals only), so a non-billable entry is still exported.
    const now = new Date(FIXED_NOW);
    const store = Store.openMemory(() => now);
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
      billableFilter: 'billable', // billable-only on screen…
      rounding: false,
      roundingIncrementMin: 15,
    });
    const range = resolveSavedRange(
      store.getReport('Weekly')!.rangeSpec,
      store.settings().weekStart,
      now,
    );
    const raw = store.listEntries({ fromUtc: range.fromUtc, toUtc: range.toUtc, billable: 'all' });
    expect(store.exportSavedReport('Weekly', 'csv', now)).toBe(toCsv(raw, now));
    expect(store.exportSavedReport('Weekly', 'json', now)).toEqual(toJsonEntries(raw, now));
    // …but the export carries BOTH entries (the non-billable admin too — billable='all').
    expect(store.exportSavedReport('Weekly', 'json', now)).toHaveLength(2);
    store.close();
  });

  it('runReport / exportSavedReport throw a clear error for an unknown name', () => {
    const store = Store.openMemory(() => new Date(FIXED_NOW));
    expect(() => store.runReport('Nope')).toThrow(/no saved report named "Nope"/);
    expect(() => store.exportSavedReport('Nope', 'csv')).toThrow(/no saved report named "Nope"/);
    store.close();
  });

  it('rejects a duplicate name (case-insensitive)', () => {
    const store = Store.openMemory(() => new Date(FIXED_NOW));
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
    const now = new Date(FIXED_NOW);
    const store = Store.openMemory(() => now);
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
    const now = new Date(FIXED_NOW);
    const store = Store.openMemory(() => now);
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
    const store = Store.openMemory(() => new Date(FIXED_NOW));
    store.pinFavorite({ name: 'Deep', billable: false, tags: ['focus'] });
    expect(() => store.pinFavorite({ name: 'deep', billable: false })).toThrow(/already exists/);
    expect(() => store.renameFavorite('Nope', 'X')).toThrow(/no favorite named "Nope"/);
    expect(() => store.unpinFavorite('Nope')).toThrow(/no favorite named "Nope"/);
    store.close();
  });

  it('the serialized fav-ls payload validates against favorite.schema.json', () => {
    const now = new Date(FIXED_NOW);
    const store = Store.openMemory(() => now);
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
  // Stored ends are core's `toUtc` form (Z, no milliseconds), matching FIXED_NOW exactly.
  const DAY_END = '2026-06-24T23:59:00Z'; // the boundary a clamp would (wrongly) produce
  const NOON = '2026-06-24T12:00:00Z'; // === FIXED_NOW — the real `now`

  it('resume-from-favorite closes the previously open entry at now (not the day boundary)', () => {
    const store = Store.openMemory(() => new Date(FIXED_NOW));
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
    const store = Store.openMemory(() => new Date(FIXED_NOW));
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
    const json = toJsonEntries(store.listEntries(), new Date(FIXED_NOW));
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
