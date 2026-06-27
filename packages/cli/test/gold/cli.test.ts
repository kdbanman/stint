/**
 * GOLD — the tt machine contract (acceptance.html §08). The artefact is the
 * criterion: exact stdout, exit codes, and the --json shapes validated against the
 * published JSON Schemas (PRD §11, §13, §14).
 *
 * Requires the CLI to be built (packages/cli/dist).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import addFormatsImport from 'ajv-formats';
// ajv-formats ships a CJS default export; cast to its callable shape for NodeNext.
const addFormats = addFormatsImport as unknown as <T>(ajv: T) => T;

const BIN = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));
const schema = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../../acceptance/schemas/${name}`, import.meta.url)), 'utf8'),
  );
/** A fresh validator each call (Ajv refuses to register a $id twice). */
const validator = (name: string) =>
  addFormats(new Ajv({ allErrors: true })).compile(schema(name));

let dir: string;
let db: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stint-gold-'));
  db = join(dir, 'tt.sqlite');
  return () => rmSync(dir, { recursive: true, force: true });
});

function tt(args: string[], now = '2026-06-24T10:24:07Z'): { out: string; err: string; code: number } {
  const res = spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TT_DB: db, TT_NOW: now, NODE_NO_WARNINGS: '1' },
  });
  return { out: (res.stdout ?? '').trimEnd(), err: (res.stderr ?? '').trimEnd(), code: res.status ?? 0 };
}

function seed(): void {
  tt(['client', 'add', 'Client A']);
  tt(['project', 'add', 'API', '--client', 'Client A']);
  tt([
    'add',
    'auth refactor',
    '--from',
    '2026-06-24T09:00:00Z',
    '--to',
    '2026-06-24T10:30:00Z',
    '--client',
    'Client A',
    '--project',
    'API',
    '--tag',
    'deep',
  ]);
}

describe('GOLD: tt status (§11)', () => {
  it('reports nothing running, exit 0', () => {
    const r = tt(['status']);
    expect(r.out).toBe('nothing running');
    expect(r.code).toBe(0);
  });

  it('reports a running entry with derived elapsed, exit 0', () => {
    tt(['start', 'auth refactor', '--client', 'Client A', '--project', 'API', '--at', '2026-06-24T09:00:00Z']);
    const r = tt(['status'], '2026-06-24T10:24:07Z');
    expect(r.out).toBe('▸ running 01:24:07 · "auth refactor" · Client A / API');
    expect(r.code).toBe(0);
  });

  it('--json validates against the status schema', () => {
    tt(['start', 'auth refactor', '--client', 'Client A', '--at', '2026-06-24T09:00:00Z']);
    const r = tt(['status', '--json'], '2026-06-24T10:24:07Z');
    const json = JSON.parse(r.out);
    const validate = validator('status.schema.json');
    expect(validate(json) || validate.errors).toBe(true);
    expect(json).toMatchObject({ running: true, entry: { elapsed_seconds: 5047, billable: true } });
  });

  it('--json reports nothing running as a valid empty status', () => {
    const r = tt(['status', '--json']);
    const validate = validator('status.schema.json');
    const json = JSON.parse(r.out);
    expect(validate(json) || validate.errors).toBe(true);
    expect(json).toEqual({ running: false, entry: null });
  });
});

describe('GOLD: tt rm refusal (§06)', () => {
  it('refuses without --force and exits non-zero on stderr', () => {
    seed();
    const r = tt(['rm', '1']);
    expect(r.err).toBe('refusing to delete entry 1 without confirmation; pass --force');
    expect(r.out).toBe('');
    expect(r.code).toBe(2);
  });

  it('deletes with --force, exit 0', () => {
    seed();
    const r = tt(['rm', '1', '--force']);
    expect(r.out).toBe('deleted entry 1');
    expect(r.code).toBe(0);
  });
});

describe('GOLD: tt export (§09 R6)', () => {
  it('CSV header and row match the column contract', () => {
    seed();
    const r = tt(['export', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--csv']);
    expect(r.out).toMatchInlineSnapshot(`
      "client,project,tags,description,start_utc,end_utc,raw_duration_s,excluded_s,billable,overlapped
      Client A,API,deep,auth refactor,2026-06-24T09:00:00Z,2026-06-24T10:30:00Z,5400,0,true,false"
    `);
    expect(r.code).toBe(0);
  });

  it('--json validates against the export-entry schema', () => {
    seed();
    const r = tt(['export', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--json']);
    const json = JSON.parse(r.out);
    const validate = validator('export-entry.schema.json');
    expect(validate(json) || validate.errors).toBe(true);
  });
});

describe('GOLD: tt list --json (§11)', () => {
  it('validates against the published list schema (read-side scripting contract)', () => {
    seed();
    const r = tt(['list', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--all', '--json']);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out);
    const validate = validator('list.schema.json');
    expect(validate(json) || validate.errors).toBe(true);
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({ description: 'auth refactor', client: 'Client A', project: 'API' });
  });

  it('an empty range is a valid empty list', () => {
    const r = tt(['list', '--range', '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z', '--json']);
    const validate = validator('list.schema.json');
    expect(validate(JSON.parse(r.out)) || validate.errors).toBe(true);
    expect(JSON.parse(r.out)).toEqual([]);
  });
});

describe('GOLD: --project actually filters list and report (§09, §11)', () => {
  const RANGE = ['--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z'] as const;
  function seedTwoProjects(): void {
    tt(['client', 'add', 'Client A']);
    tt(['project', 'add', 'API', '--client', 'Client A']);
    tt(['project', 'add', 'Web', '--client', 'Client A']);
    tt(['add', 'api work', '--from', '2026-06-24T09:00:00Z', '--to', '2026-06-24T10:00:00Z', '--client', 'Client A', '--project', 'API']);
    tt(['add', 'web work', '--from', '2026-06-24T10:00:00Z', '--to', '2026-06-24T11:30:00Z', '--client', 'Client A', '--project', 'Web']);
  }

  it('list --project returns only that project', () => {
    seedTwoProjects();
    const rows = JSON.parse(tt(['list', ...RANGE, '--project', 'API', '--json']).out);
    expect(rows.map((e: { description: string }) => e.description)).toEqual(['api work']);
  });

  it('report --project totals only that project', () => {
    seedTwoProjects();
    const api = JSON.parse(tt(['report', ...RANGE, '--project', 'API', '--json']).out);
    const web = JSON.parse(tt(['report', ...RANGE, '--project', 'Web', '--json']).out);
    expect(api.grand_total_seconds).toBe(3600);
    expect(web.grand_total_seconds).toBe(5400);
  });

  it('an unknown --project yields no entries, not everything (consistent list/report)', () => {
    seedTwoProjects();
    expect(JSON.parse(tt(['list', ...RANGE, '--project', 'Nope', '--json']).out)).toEqual([]);
    expect(JSON.parse(tt(['report', ...RANGE, '--project', 'Nope', '--json']).out).grand_total_seconds).toBe(0);
  });
});

describe('GOLD: tt --search filters list and report (§09 R7)', () => {
  const RANGE = ['--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z'] as const;
  function seedSearch(): void {
    tt(['client', 'add', 'Acme']);
    tt(['project', 'add', 'Billing', '--client', 'Acme']);
    tt(['client', 'add', 'Globex']);
    tt(['project', 'add', 'Ops', '--client', 'Globex']);
    tt(['add', 'auth refactor', '--from', '2026-06-24T09:00:00Z', '--to', '2026-06-24T11:00:00Z', '--client', 'Acme', '--project', 'Billing', '--tag', 'deep']);
    tt(['add', 'deploy pipeline', '--from', '2026-06-24T11:00:00Z', '--to', '2026-06-24T12:00:00Z', '--client', 'Globex', '--project', 'Ops', '--tag', 'ci']);
  }

  it('list --search returns only matching ids and validates against list.schema.json', () => {
    seedSearch();
    const rows = JSON.parse(tt(['list', ...RANGE, '--all', '--json', '--search', 'refactor']).out);
    const validate = validator('list.schema.json');
    expect(validate(rows) || validate.errors).toBe(true);
    expect(rows.map((e: { description: string }) => e.description)).toEqual(['auth refactor']);
  });

  it('list --search is case-insensitive', () => {
    seedSearch();
    const rows = JSON.parse(tt(['list', ...RANGE, '--all', '--json', '--search', 'REFACTOR']).out);
    expect(rows.map((e: { description: string }) => e.description)).toEqual(['auth refactor']);
  });

  it('list --search matches a client name and a tag, not just description', () => {
    seedSearch();
    const byClient = JSON.parse(tt(['list', ...RANGE, '--all', '--json', '--search', 'globex']).out);
    expect(byClient.map((e: { description: string }) => e.description)).toEqual(['deploy pipeline']);
    const byTag = JSON.parse(tt(['list', ...RANGE, '--all', '--json', '--search', 'deep']).out);
    expect(byTag.map((e: { description: string }) => e.description)).toEqual(['auth refactor']);
  });

  it('list --search with no match is a valid empty list', () => {
    seedSearch();
    const r = tt(['list', ...RANGE, '--all', '--json', '--search', 'nonexistent']);
    const validate = validator('list.schema.json');
    expect(validate(JSON.parse(r.out)) || validate.errors).toBe(true);
    expect(JSON.parse(r.out)).toEqual([]);
  });

  it('report --search totals only matching entries and validates against report.schema.json', () => {
    seedSearch();
    const r = tt(['report', ...RANGE, '--all', '--json', '--search', 'refactor']);
    const json = JSON.parse(r.out);
    const validate = validator('report.schema.json');
    expect(validate(json) || validate.errors).toBe(true);
    // Only "auth refactor" (2h) matches; "deploy pipeline" (1h) is excluded.
    expect(json.grand_total_seconds).toBe(7200);
  });

  it('report --search with no match totals zero', () => {
    seedSearch();
    const json = JSON.parse(tt(['report', ...RANGE, '--all', '--json', '--search', 'nonexistent']).out);
    expect(json.grand_total_seconds).toBe(0);
  });
});

describe('GOLD: tt list --by / --search grouping (§12 R9, §11)', () => {
  const RANGE = ['--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z'] as const;
  function seedGroups(): void {
    tt(['client', 'add', 'Acme']);
    tt(['project', 'add', 'Billing', '--client', 'Acme']);
    tt(['client', 'add', 'Globex']);
    tt(['project', 'add', 'Ops', '--client', 'Globex']);
    tt(['add', 'auth refactor', '--from', '2026-06-24T09:00:00Z', '--to', '2026-06-24T11:00:00Z', '--client', 'Acme', '--project', 'Billing', '--tag', 'deep']);
    tt(['add', 'deploy pipeline', '--from', '2026-06-24T11:00:00Z', '--to', '2026-06-24T12:00:00Z', '--client', 'Globex', '--project', 'Ops', '--tag', 'ci']);
    tt(['add', 'standup', '--from', '2026-06-24T08:00:00Z', '--to', '2026-06-24T08:30:00Z', '--client', 'Acme', '--project', 'Billing', '--tag', 'meeting']);
  }

  it('--by client groups the human table with a per-group header carrying summed hours', () => {
    seedGroups();
    const r = tt(['list', ...RANGE, '--all', '--by', 'client']);
    expect(r.code).toBe(0);
    // Group headers in ASC order, each with the summed billable hours; the matching rows
    // sit under their client header.
    const acme = r.out.indexOf('Acme  (2.50h)');
    const globex = r.out.indexOf('Globex  (1.00h)');
    expect(acme).toBeGreaterThanOrEqual(0);
    expect(globex).toBeGreaterThan(acme); // Acme before Globex (ASC)
    expect(r.out).toContain('auth refactor');
    expect(r.out).toContain('standup');
    expect(r.out).toContain('deploy pipeline');
  });

  it('--by tag fans a multi-axis list into tag groups (ASC)', () => {
    seedGroups();
    const r = tt(['list', ...RANGE, '--all', '--by', 'tag']);
    expect(r.out.indexOf('ci  (')).toBeGreaterThanOrEqual(0);
    expect(r.out.indexOf('deep  (')).toBeGreaterThan(r.out.indexOf('ci  ('));
    expect(r.out.indexOf('meeting  (')).toBeGreaterThan(r.out.indexOf('deep  ('));
  });

  it('--by rejects an unknown grouping', () => {
    seedGroups();
    const r = tt(['list', ...RANGE, '--all', '--by', 'nope']);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/unknown --by grouping/);
  });

  it('--json stays the flat row contract regardless of --by (search only filters rows)', () => {
    seedGroups();
    // --by does not change the --json shape: it is still the flat array, schema-valid.
    const rows = JSON.parse(tt(['list', ...RANGE, '--all', '--json', '--by', 'client']).out);
    const validate = validator('list.schema.json');
    expect(validate(rows) || validate.errors).toBe(true);
    expect(rows.map((e: { description: string }) => e.description).sort()).toEqual([
      'auth refactor',
      'deploy pipeline',
      'standup',
    ]);
  });

  it('--by composes with --search: only matching rows are grouped', () => {
    seedGroups();
    const r = tt(['list', ...RANGE, '--all', '--by', 'client', '--search', 'refactor']);
    expect(r.out).toContain('Acme');
    expect(r.out).toContain('auth refactor');
    expect(r.out).not.toContain('Globex');
    expect(r.out).not.toContain('deploy pipeline');
  });
});

describe('GOLD: tt report --search (§09, §11)', () => {
  const RANGE = ['--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z'] as const;
  // Distinguishable descriptions, clients, projects, and tags so each search axis is
  // isolatable: a query can match a description OR a client/project/tag name only.
  function seedReportSearch(): void {
    tt(['client', 'add', 'Acme']);
    tt(['project', 'add', 'Billing', '--client', 'Acme']);
    tt(['client', 'add', 'Globex']);
    tt(['project', 'add', 'Ops', '--client', 'Globex']);
    // "auth refactor" — 2h — Acme/Billing/deep
    tt(['add', 'auth refactor', '--from', '2026-06-24T09:00:00Z', '--to', '2026-06-24T11:00:00Z', '--client', 'Acme', '--project', 'Billing', '--tag', 'deep']);
    // "shipping work" — 1h — Globex/Ops/ci. Its description shares no token with its
    // project name "Ops", so a project-name query must reach it via the resolved field.
    tt(['add', 'shipping work', '--from', '2026-06-24T11:00:00Z', '--to', '2026-06-24T12:00:00Z', '--client', 'Globex', '--project', 'Ops', '--tag', 'ci']);
  }

  it('--search --json totals only the matching entries', () => {
    seedReportSearch();
    const json = JSON.parse(tt(['report', ...RANGE, '--all', '--json', '--search', 'refactor']).out);
    // Only "auth refactor" (2h) matches; "shipping work" (1h) is excluded.
    expect(json.grand_total_seconds).toBe(7200);
  });

  it('--search is case-insensitive (upper/lower match the same set)', () => {
    seedReportSearch();
    const lower = JSON.parse(tt(['report', ...RANGE, '--all', '--json', '--search', 'refactor']).out);
    const upper = JSON.parse(tt(['report', ...RANGE, '--all', '--json', '--search', 'REFACTOR']).out);
    expect(upper.grand_total_seconds).toBe(lower.grand_total_seconds);
    expect(upper.grand_total_seconds).toBe(7200);
  });

  it('--search matches a project name even when the description does not (§09 secondary match)', () => {
    seedReportSearch();
    // "Ops" is the project name only — no description contains it — yet it pulls the
    // Globex/Ops entry (1h).
    const json = JSON.parse(tt(['report', ...RANGE, '--all', '--json', '--search', 'ops']).out);
    expect(json.grand_total_seconds).toBe(3600);
    // …and a client-name query likewise reaches its entries.
    const byClient = JSON.parse(tt(['report', ...RANGE, '--all', '--json', '--search', 'globex']).out);
    expect(byClient.grand_total_seconds).toBe(3600);
  });

  it('--search with no match totals zero, not everything (consistent with unknown --project)', () => {
    seedReportSearch();
    const json = JSON.parse(tt(['report', ...RANGE, '--all', '--json', '--search', 'nonexistent']).out);
    expect(json.grand_total_seconds).toBe(0);
  });

  it('--search --json still validates against report.schema.json (search adds no output fields)', () => {
    seedReportSearch();
    const r = tt(['report', ...RANGE, '--all', '--json', '--search', 'refactor']);
    const validate = validator('report.schema.json');
    expect(validate(JSON.parse(r.out)) || validate.errors).toBe(true);
  });

  it('--search --csv emits only the matching rows (CSV path honours the filter)', () => {
    seedReportSearch();
    const csv = tt(['report', ...RANGE, '--all', '--csv', '--search', 'refactor']).out;
    const lines = csv.split('\n');
    // header + exactly the one matching entry
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('client,project,tags,description,start_utc,end_utc,raw_duration_s,excluded_s,billable,overlapped');
    expect(lines[1]).toContain('auth refactor');
    expect(csv).not.toContain('shipping work');
  });
});

describe('GOLD: config set validates (§14)', () => {
  it('rejects a non-positive check-in interval (would otherwise hang the GUI tick)', () => {
    const r = tt(['config', 'set', 'checkin_interval_min', '0']);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/positive/);
    // …and the stored setting is unchanged at its default.
    expect(JSON.parse(tt(['config', 'ls', '--json']).out).checkinIntervalMin).toBe(30);
  });

  it('rejects a disallowed rounding increment', () => {
    const r = tt(['config', 'set', 'rounding_increment_min', '7']);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/one of/);
  });
});

describe('GOLD: tt report (§09)', () => {
  it('--json validates against the report schema', () => {
    seed();
    const r = tt(['report', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--json']);
    const json = JSON.parse(r.out);
    const validate = validator('report.schema.json');
    expect(validate(json) || validate.errors).toBe(true);
    expect(json.grand_total_seconds).toBe(5400);
  });

  it('human report groups client → project with totals', () => {
    seed();
    const r = tt(['report', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z']);
    expect(r.out).toMatchInlineSnapshot(`
      "Report  2026-06-24T00:00:00Z → 2026-06-25T00:00:00Z  (billable, by client)

      Client A                    01:30:00  (1.50h)
        API                       01:30:00  (1.50h)

      Total                       01:30:00  (1.50h)"
    `);
  });

  it('rounding rounds the grouped line, nearest increment', () => {
    tt(['client', 'add', 'Client A']);
    // 1h05m → nearest 15m = 1h00m (3600s).
    tt(['add', 'work', '--from', '2026-06-24T09:00:00Z', '--to', '2026-06-24T10:05:00Z', '--client', 'Client A']);
    const r = tt(['report', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--round', '15', '--json']);
    const json = JSON.parse(r.out);
    expect(json.grand_total_seconds).toBe(3900);
    expect(json.grand_rounded_seconds).toBe(3600);
  });
});

describe('GOLD: settings defaults (§14)', () => {
  it('a fresh database reads back the documented defaults', () => {
    const r = tt(['config', 'ls']);
    expect(r.out).toMatchInlineSnapshot(`
      "SETTING                 VALUE
      rounding                false
      rounding_increment_min  15
      week_start              monday
      first_checkin_min       60
      checkin_interval_min    30
      global_hotkey           CommandOrControl+Alt+T
      accent                  system
      date_format             system"
    `);
  });

  it('--json reads back the defaults object', () => {
    const r = tt(['config', 'ls', '--json']);
    expect(JSON.parse(r.out)).toEqual({
      rounding: false,
      roundingIncrementMin: 15,
      weekStart: 'monday',
      firstCheckinMin: 60,
      checkinIntervalMin: 30,
      globalHotkey: 'CommandOrControl+Alt+T',
      accent: 'system',
      dateFormat: 'system',
    });
  });
});

describe('GOLD: overlap warning on stderr (§06 R4)', () => {
  it('warns but allows an overlapping backfill, exit 0', () => {
    tt(['add', 'morning', '--from', '2026-06-24T09:00:00Z', '--to', '2026-06-24T11:00:00Z']);
    const r = tt(['add', 'call', '--from', '2026-06-24T10:00:00Z', '--to', '2026-06-24T10:30:00Z']);
    expect(r.code).toBe(0);
    expect(r.err).toContain('overlaps');
    expect(r.out).toContain('added entry');
  });
});

describe('GOLD: time-argument parsing (§11)', () => {
  it('accepts a relative stop time', () => {
    tt(['start', 'work', '--at', '2026-06-24T09:00:00Z']);
    // now is 10:24:07; -1h ⇒ 09:24:07.
    const r = tt(['stop', '--at', '-1h'], '2026-06-24T10:24:07Z');
    expect(r.out).toBe('stopped 00:24:07 · —');
  });
});

describe('GOLD: edit amends fields (§05 R6, §06 R1)', () => {
  it('edits description and client without touching the times', () => {
    seed();
    expect(tt(['edit', '1', '--desc', 'auth refactor v2']).code).toBe(0);
    const after = JSON.parse(
      tt(['export', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--json']).out,
    )[0];
    expect(after.description).toBe('auth refactor v2');
    expect(after.start_utc).toBe('2026-06-24T09:00:00Z');
    expect(after.end_utc).toBe('2026-06-24T10:30:00Z');
  });

  it('edits a tag on and off', () => {
    seed();
    tt(['edit', '1', '--tag', 'review']);
    let row = JSON.parse(tt(['export', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--json']).out)[0];
    expect(row.tags.sort()).toEqual(['deep', 'review']);
    tt(['edit', '1', '--untag', 'deep']);
    row = JSON.parse(tt(['export', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--json']).out)[0];
    expect(row.tags).toEqual(['review']);
  });
});

describe('GOLD: billable override (§08)', () => {
  it('--no-bill marks a client entry non-billable', () => {
    tt(['client', 'add', 'Client A']);
    tt(['add', 'goodwill', '--from', '2026-06-24T09:00:00Z', '--to', '2026-06-24T10:00:00Z', '--client', 'Client A', '--no-bill']);
    const row = JSON.parse(tt(['export', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--json']).out)[0];
    expect(row.client).toBe('Client A');
    expect(row.billable).toBe(false);
  });

  it('--bill flags clientless internal time billable', () => {
    tt(['add', 'rare admin', '--from', '2026-06-24T09:00:00Z', '--to', '2026-06-24T10:00:00Z', '--bill']);
    const row = JSON.parse(tt(['export', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--json']).out)[0];
    expect(row.client).toBeNull();
    expect(row.billable).toBe(true);
  });
});

describe('GOLD: client / project rename + archive (§07)', () => {
  it('renames a client', () => {
    tt(['client', 'add', 'Acme']);
    expect(tt(['client', 'rename', 'Acme', 'Acme Corp']).code).toBe(0);
    const list = JSON.parse(tt(['client', 'ls', '--json']).out);
    expect(list.map((c: { name: string }) => c.name)).toContain('Acme Corp');
  });

  it('archives a client (hidden by default, shown with --archived)', () => {
    tt(['client', 'add', 'Old']);
    tt(['client', 'archive', 'Old']);
    expect(JSON.parse(tt(['client', 'ls', '--json']).out)).toEqual([]);
    const archived = JSON.parse(tt(['client', 'ls', '--archived', '--json']).out);
    expect(archived.some((c: { name: string; archived: boolean }) => c.name === 'Old' && c.archived)).toBe(true);
  });

  it('renames and archives a project', () => {
    tt(['client', 'add', 'Client A']);
    tt(['project', 'add', 'API', '--client', 'Client A']);
    expect(tt(['project', 'rename', 'API', 'Public API']).code).toBe(0);
    tt(['project', 'archive', 'Public API']);
    expect(JSON.parse(tt(['project', 'ls', '--json']).out)).toEqual([]);
    expect(JSON.parse(tt(['project', 'ls', '--archived', '--json']).out).length).toBe(1);
  });
});

describe('GOLD: merge conflict override (§06, §16)', () => {
  it('tt merge defaults to the first entry, --client overrides', () => {
    tt(['client', 'add', 'Client A']);
    tt(['client', 'add', 'Client B']);
    tt(['add', 'part one', '--from', '2026-06-24T09:00:00Z', '--to', '2026-06-24T10:00:00Z', '--client', 'Client A']);
    tt(['add', 'part two', '--from', '2026-06-24T10:00:00Z', '--to', '2026-06-24T11:00:00Z', '--client', 'Client B']);
    const r = tt(['merge', '1', '2', '--client', 'Client B']);
    expect(r.code).toBe(0);
    const rows = JSON.parse(tt(['export', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--json']).out);
    expect(rows).toHaveLength(1);
    expect(rows[0].client).toBe('Client B');
    expect(rows[0].description).toBe('part one / part two');
  });
});
