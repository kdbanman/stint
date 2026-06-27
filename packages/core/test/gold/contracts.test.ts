/**
 * GOLD — the data-shape contracts where the artefact is the criterion
 * (acceptance.html §08): settings defaults (§14), schema version (§13), the CSV
 * column contract and a fixed-fixture row (§09 R6), and the JSON export shape
 * validated against its published JSON Schema.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
} from '@stint/core';
import type { EntryView } from '@stint/core';

const ajv = addFormats(new Ajv({ allErrors: true }));
const schema = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../../acceptance/schemas/${name}`, import.meta.url)),
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
        "accent": "system",
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
    expect(SCHEMA_VERSION).toBe(2);
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

describe('GOLD: CSV export contract (§09 R6)', () => {
  it('header is the exact column contract', () => {
    expect(CSV_COLUMNS.join(',')).toMatchInlineSnapshot(
      `"client,project,tags,description,start_utc,end_utc,raw_duration_s,excluded_s,billable,overlapped"`,
    );
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

describe('GOLD: JSON export shape (§09 R6)', () => {
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
