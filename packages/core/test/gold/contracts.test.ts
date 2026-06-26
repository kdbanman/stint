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
} from '@stint/core';

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
        "checkinIntervalMin": 30,
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
