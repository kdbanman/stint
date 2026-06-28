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
    readFileSync(fileURLToPath(new URL(`../../../../acceptance/criteria/schemas/${name}`, import.meta.url)), 'utf8'),
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

describe('GOLD: tt add backfill — the core-entry contract (§05 R05)', () => {
  // §05 R05 is classified `core` (core data entry — manual backfill). The contract: a
  // backfill from explicit --from/--to is a COMPLETED (closed) entry carrying those exact
  // instants, with a billable duration computed from the span; afterward NOTHING is open.
  // It is the CLI half of the surface-neutral BDD "Backfill creates a completed entry";
  // this pins the serialized --json shape against the published schemas. It would fail if
  // the add contract dropped from/to, left the entry open, or miscomputed the duration.
  const RANGE = ['--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z'] as const;

  it('--json emits one closed entry with the exact from/to and computed billable duration', () => {
    tt(['client', 'add', 'Client A']);
    tt(['project', 'add', 'API', '--client', 'Client A']);
    const r = tt([
      'add',
      'spec review',
      '--from',
      '2026-06-24T13:00:00Z',
      '--to',
      '2026-06-24T14:30:00Z',
      '--client',
      'Client A',
      '--project',
      'API',
      '--tag',
      'deep',
    ]);
    expect(r.code).toBe(0);

    // The serialized list/export shape validates against the published per-entry schema…
    const rows = JSON.parse(tt(['list', ...RANGE, '--all', '--json']).out);
    const validateList = validator('list.schema.json');
    const validateExport = validator('export-entry.schema.json');
    expect(validateList(rows) || validateList.errors).toBe(true);
    expect(validateExport(rows) || validateExport.errors).toBe(true);
    expect(rows).toHaveLength(1);
    // …carrying the EXACT from/to instants (closed entry — end_utc is non-null)…
    expect(rows[0]).toMatchObject({
      description: 'spec review',
      client: 'Client A',
      project: 'API',
      start_utc: '2026-06-24T13:00:00Z',
      end_utc: '2026-06-24T14:30:00Z',
      billable: true,
      raw_duration_s: 5400, // 90 minutes — the span computed from from→to
    });
    expect(rows[0].end_utc).not.toBeNull();
  });

  it('leaves nothing open afterward — a backfill is completed, not running', () => {
    tt(['add', 'spec review', '--from', '2026-06-24T13:00:00Z', '--to', '2026-06-24T14:30:00Z']);
    const status = JSON.parse(tt(['status', '--json']).out);
    expect(status).toEqual({ running: false, entry: null });
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

describe('GOLD: tt export (§09 R06)', () => {
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
      date_format             system
      backup_retention        5"
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
      backupRetention: 5,
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

describe('GOLD: §11 CLI table core badges (§11, §C)', () => {
  // The artefact is the criterion: the §C relabel renamed the four core-entry /
  // data-out subcommands "core" in the §11 table. This contract parses prd.html and
  // asserts each of those four rows carries <span class="core">core</span> in its
  // "Does" cell, and that no other §11 row does. It fails iff a badge is dropped or
  // wrongly added.
  const prd = readFileSync(fileURLToPath(new URL('../../../../context/prd.html', import.meta.url)), 'utf8');
  const section = (() => {
    const m = prd.match(/<section id="s11">([\s\S]*?)<\/section>/);
    if (!m) throw new Error('§11 <section id="s11"> not found in prd.html');
    return m[1] ?? '';
  })();

  /** Map each §11 table row's Command cell text → its Does cell HTML. */
  function rowsByCommand(): Map<string, string> {
    const rows = new Map<string, string>();
    const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(section))) {
      const cells = [...(rm[1] ?? '').matchAll(/<td[^>]*data-l="([^"]+)"[^>]*>([\s\S]*?)<\/td>/g)];
      const cmd = cells.find((c) => c[1] === 'Command')?.[2];
      const does = cells.find((c) => c[1] === 'Does')?.[2];
      if (cmd === undefined || does === undefined) continue; // header row
      // Strip tags and decode the entities used in the table to get a plain-text key.
      const key = cmd
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
      rows.set(key, does);
    }
    return rows;
  }

  const CORE = ['tt start [desc]', 'tt stop', 'tt add <desc>', 'tt export'];
  const hasCoreBadge = (does: string) => /<span class="core">core<\/span>/.test(does);

  it('parses the §11 table into rows keyed by command', () => {
    const rows = rowsByCommand();
    for (const cmd of CORE) expect(rows.has(cmd), `missing §11 row: ${cmd}`).toBe(true);
    // Sanity: a few known non-core rows are present too.
    for (const cmd of ['tt status', 'tt list', 'tt config …']) {
      expect(rows.has(cmd), `missing §11 row: ${cmd}`).toBe(true);
    }
  });

  it('the four core-entry / data-out subcommands each carry a core badge', () => {
    const rows = rowsByCommand();
    for (const cmd of CORE) {
      expect(hasCoreBadge(rows.get(cmd)!), `${cmd} should be badged core`).toBe(true);
    }
  });

  it('no other §11 row carries a core badge', () => {
    const rows = rowsByCommand();
    const core = new Set(CORE);
    for (const [cmd, does] of rows) {
      if (core.has(cmd)) continue;
      expect(hasCoreBadge(does), `${cmd} should NOT be badged core`).toBe(false);
    }
  });

  it('the report-save / fav rows stay new-only, never core (§09, §05 parity rows)', () => {
    const rows = rowsByCommand();
    for (const cmd of ['tt report save <name>', 'tt report ls / show <name> / rm <name>', 'tt report run <name>', 'tt fav …']) {
      const does = rows.get(cmd);
      expect(does, `missing §11 row: ${cmd}`).toBeDefined();
      expect(hasCoreBadge(does!), `${cmd} should NOT be badged core`).toBe(false);
      expect(/<span class="new">new<\/span>/.test(does!), `${cmd} should stay new`).toBe(true);
    }
  });
});

describe('GOLD: tt report save / show / ls / run (§09 R08–R09)', () => {
  it('save then show --json validates against report-def.schema.json and round-trips the def', () => {
    seed();
    expect(tt(['report', 'save', 'Weekly', '--week', '--by', 'project', '--client', 'Client A', '--round', '15']).code).toBe(0);
    const r = tt(['report', 'show', 'Weekly', '--json']);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out);
    const validate = validator('report-def.schema.json');
    expect(validate(json) || validate.errors).toBe(true);
    expect(json).toMatchObject({
      name: 'Weekly',
      range_kind: 'preset',
      range_preset: 'week',
      range_from_utc: null,
      range_to_utc: null,
      group_by: 'project',
      billable_filter: 'billable',
      tag: null,
      search: null,
      rounding: true,
      rounding_increment_min: 15,
    });
    // The --client filter resolved to a real client id (the seeded Client A is id 1).
    expect(typeof json.client_id).toBe('number');
  });

  it('ls --json validates against report-def-list.schema.json', () => {
    seed();
    tt(['report', 'save', 'Weekly', '--week', '--by', 'client']);
    tt(['report', 'save', 'Monthly', '--month', '--by', 'project']);
    const r = tt(['report', 'ls', '--json']);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out);
    const validate = validator('report-def-list.schema.json');
    expect(validate(json) || validate.errors).toBe(true);
    expect(json.map((d: { name: string }) => d.name).sort()).toEqual(['Monthly', 'Weekly']);
  });

  it('run --json validates against report.schema.json and its range matches resolveRange(week)', () => {
    seed();
    tt(['report', 'save', 'Weekly', '--week', '--by', 'client']);
    // The seeded entry is on 2026-06-24 (Wednesday); the default now keeps it in this week.
    const r = tt(['report', 'run', 'Weekly', '--json']);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out);
    const validate = validator('report.schema.json');
    expect(validate(json) || validate.errors).toBe(true);
    // An ad-hoc `report --week --json` over the same clock resolves the same window.
    const adhoc = JSON.parse(tt(['report', '--week', '--by', 'client', '--json']).out);
    expect(json.range).toEqual(adhoc.range);
    expect(json.grand_total_seconds).toBe(adhoc.grand_total_seconds);
    expect(json.grand_total_seconds).toBe(5400);
  });

  it('run --csv emits export bytes byte-identical to `tt export` for the resolved range', () => {
    seed();
    tt(['report', 'save', 'Weekly', '--week', '--by', 'client']);
    // The saved report resolves the same this-week window the run-json test proved; its CSV
    // export must be byte-identical to `tt export` over that window (raw entries, billable=all).
    const run = tt(['report', 'run', 'Weekly', '--csv']);
    expect(run.code).toBe(0);
    const adhocRange = JSON.parse(tt(['report', 'run', 'Weekly', '--json']).out).range;
    const direct = tt(['export', '--range', adhocRange.from_utc, adhocRange.to_utc, '--csv']);
    expect(run.out).toBe(direct.out);
    // …and the export carries the one seeded entry under the exact column contract.
    expect(run.out.split('\n')[0]).toBe(
      'client,project,tags,description,start_utc,end_utc,raw_duration_s,excluded_s,billable,overlapped',
    );
    expect(run.out).toMatch(/Client A,API,deep,auth refactor/);
  });

  it('run (human) prints the renderReport totals with the saved grouping', () => {
    seed();
    tt(['report', 'save', 'Weekly', '--week', '--by', 'client']);
    const r = tt(['report', 'run', 'Weekly']);
    expect(r.code).toBe(0);
    // The human view is the same renderReport the ad-hoc `report` prints: a header, the
    // grouped client line, and a Total — 5400s = 1h 30m of the seeded billable entry.
    expect(r.out).toMatch(/Report/);
    expect(r.out).toMatch(/Client A/);
    expect(r.out).toMatch(/Total/);
    expect(r.out).toMatch(/01:30:00/);
  });

  it('running an unknown report name exits non-zero with a clear error', () => {
    const r = tt(['report', 'run', 'Nonexistent']);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/no saved report named "Nonexistent"/);
  });

  it('saving a duplicate name exits non-zero', () => {
    seed();
    expect(tt(['report', 'save', 'Weekly', '--week']).code).toBe(0);
    const r = tt(['report', 'save', 'Weekly', '--month']);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/already exists/);
  });

  it('an absolute --range saves as range_kind=absolute and round-trips its bounds', () => {
    seed();
    tt(['report', 'save', 'Custom', '--range', '2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z', '--by', 'day']);
    const json = JSON.parse(tt(['report', 'show', 'Custom', '--json']).out);
    expect(json.range_kind).toBe('absolute');
    expect(json.range_preset).toBeNull();
    expect(json.range_from_utc).toBe('2026-06-01T00:00:00Z');
    expect(json.range_to_utc).toBe('2026-06-08T00:00:00Z');
  });

  it('edit changes the range and re-run re-resolves the totals', () => {
    // A this-week entry (1h) and a last-week entry (2h); the saved report's range edit flips
    // which one its run totals reflect — the relative spec re-resolves on each run.
    tt(['client', 'add', 'Acme']);
    tt(['add', 'review', '--from', '2026-06-24T09:00:00Z', '--to', '2026-06-24T10:00:00Z', '--client', 'Acme']);
    tt(['add', 'ops sync', '--from', '2026-06-17T09:00:00Z', '--to', '2026-06-17T11:00:00Z', '--client', 'Acme']);
    tt(['report', 'save', 'Flexible', '--week', '--by', 'client']);
    expect(JSON.parse(tt(['report', 'run', 'Flexible', '--json']).out).grand_total_seconds).toBe(3600);
    tt(['report', 'edit', 'Flexible', '--last-week']);
    expect(JSON.parse(tt(['report', 'run', 'Flexible', '--json']).out).grand_total_seconds).toBe(7200);
  });

  it('rename then rm removes it from ls', () => {
    seed();
    tt(['report', 'save', 'Draft', '--week']);
    tt(['report', 'rename', 'Draft', 'Final']);
    expect(JSON.parse(tt(['report', 'ls', '--json']).out).map((d: { name: string }) => d.name)).toEqual(['Final']);
    expect(tt(['report', 'rm', 'Final']).code).toBe(0);
    expect(JSON.parse(tt(['report', 'ls', '--json']).out)).toEqual([]);
  });

  it('the ad-hoc `report --week` query form still works alongside the saved verbs', () => {
    seed();
    const r = tt(['report', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).grand_total_seconds).toBe(5400);
  });

  it('ls on a fresh DB prints `no saved reports` (human) and `[]` (valid empty list --json)', () => {
    // No saves on a fresh database: the human form is the empty-state line; the --json form
    // is the empty array, which still validates against the published list schema.
    expect(tt(['report', 'ls']).out).toBe('no saved reports');
    const r = tt(['report', 'ls', '--json']);
    expect(r.code).toBe(0);
    expect(r.out).toBe('[]');
    const validate = validator('report-def-list.schema.json');
    expect(validate(JSON.parse(r.out)) || validate.errors).toBe(true);
  });

  it('save rejects an unknown --by grouping with a clear error, non-zero (no def written)', () => {
    seed();
    const r = tt(['report', 'save', 'Bogus', '--week', '--by', 'bogus']);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/unknown --by grouping/);
    // …and nothing was persisted.
    expect(JSON.parse(tt(['report', 'ls', '--json']).out)).toEqual([]);
  });

  it('rm then run is a clean round trip: rm exits 0, ls is empty, run is unknown-name', () => {
    seed();
    tt(['report', 'save', 'Weekly', '--week', '--by', 'project', '--round', '15', '--client', 'Client A']);
    expect(tt(['report', 'rm', 'Weekly']).code).toBe(0);
    expect(JSON.parse(tt(['report', 'ls', '--json']).out)).toEqual([]);
    const run = tt(['report', 'run', 'Weekly']);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/no saved report named "Weekly"/);
  });
});

describe('GOLD: tt fav add / ls / rename / rm (§05 R09)', () => {
  it('fav add --running prints the confirmation, exit 0', () => {
    seed();
    tt(['start', 'standup', '--client', 'Client A', '--project', 'API', '--at', '2026-06-24T09:00:00Z']);
    const r = tt(['fav', 'add', 'Standup', '--running']);
    expect(r.code).toBe(0);
    expect(r.out).toBe('pinned favorite "Standup"');
  });

  it('fav add --from-entry captures a closed entry, ls --json validates and shows the template', () => {
    seed();
    // The seeded entry is id 1 (auth refactor for Client A / API, tagged deep, billable).
    expect(tt(['fav', 'add', 'Auth', '--from-entry', '1']).code).toBe(0);
    const r = tt(['fav', 'ls', '--json']);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out);
    const validate = validator('favorite.schema.json');
    expect(validate(json) || validate.errors).toBe(true);
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({
      name: 'Auth',
      description: 'auth refactor',
      billable: true,
      tags: ['deep'],
    });
    // The captured client/project resolved to real ids (Client A / API).
    expect(typeof json[0].client_id).toBe('number');
    expect(typeof json[0].project_id).toBe('number');
  });

  it('fav add from explicit attributes captures client/project/tags/billable', () => {
    seed();
    expect(
      tt(['fav', 'add', 'Deep work', '--client', 'Client A', '--project', 'API', '--tag', 'deep', '--tag', 'focus', '--bill']).code,
    ).toBe(0);
    const json = JSON.parse(tt(['fav', 'ls', '--json']).out);
    expect(json[0]).toMatchObject({
      name: 'Deep work',
      billable: true,
      tags: ['deep', 'focus'],
    });
    const validate = validator('favorite.schema.json');
    expect(validate(json) || validate.errors).toBe(true);
  });

  it('fav rename and fav rm emit their fixed stdout, exit 0', () => {
    seed();
    tt(['fav', 'add', 'Draft', '--from-entry', '1']);
    const ren = tt(['fav', 'rename', 'Draft', 'Final']);
    expect(ren.code).toBe(0);
    expect(ren.out).toBe('renamed favorite to "Final"');
    expect(JSON.parse(tt(['fav', 'ls', '--json']).out).map((f: { name: string }) => f.name)).toEqual(['Final']);
    const rm = tt(['fav', 'rm', 'Final']);
    expect(rm.code).toBe(0);
    expect(rm.out).toBe('unpinned');
    expect(JSON.parse(tt(['fav', 'ls', '--json']).out)).toEqual([]);
  });

  it('fav add of a duplicate name exits non-zero on stderr (no second favorite written)', () => {
    seed();
    expect(tt(['fav', 'add', 'Auth', '--from-entry', '1']).code).toBe(0);
    const dup = tt(['fav', 'add', 'auth', '--from-entry', '1']); // case-insensitive clash
    expect(dup.code).not.toBe(0);
    expect(dup.err).toMatch(/already exists/);
    expect(JSON.parse(tt(['fav', 'ls', '--json']).out)).toHaveLength(1);
  });

  it('ls on a fresh DB prints `no favorites` (human) and `[]` (valid empty list --json)', () => {
    expect(tt(['fav', 'ls']).out).toBe('no favorites');
    const r = tt(['fav', 'ls', '--json']);
    expect(r.code).toBe(0);
    expect(r.out).toBe('[]');
    const validate = validator('favorite.schema.json');
    expect(validate(JSON.parse(r.out)) || validate.errors).toBe(true);
  });
});

describe('GOLD: tt fav start / tt start --fav (§05 R10, §11)', () => {
  // §11 parity for the §05 R10 resume slice. Both routes (`tt fav start <name>` and
  // `tt start --fav <name>`) reach the SAME core action (store.startFromFavorite): a FRESH
  // entry seeded from the favorite's template, the favorite never mutated, inheriting the
  // atomic stop-then-start and the ≤1-open invariant. The artefact is the criterion: the
  // running statusLine, and `status --json` carrying the template's attributes.
  it('fav start opens a running entry seeded from the favorite template', () => {
    seed();
    // Pin a favorite from the seeded closed entry (Client A / API, tagged deep, billable).
    expect(tt(['fav', 'add', 'Auth', '--from-entry', '1']).code).toBe(0);
    const start = tt(['fav', 'start', 'Auth'], '2026-06-24T11:00:00Z');
    expect(start.code).toBe(0);
    // The running statusLine carries the template's description + client/project.
    expect(start.out).toMatch(/running .* "auth refactor" .* Client A \/ API/);
    // status --json proves the new entry inherited the whole template.
    const status = JSON.parse(tt(['status', '--json'], '2026-06-24T11:00:00Z').out);
    expect(status).toMatchObject({
      running: true,
      entry: { client: 'Client A', project: 'API', tags: ['deep'], billable: true },
    });
  });

  it('tt start --fav is at parity with fav start and explicit flags override the template', () => {
    seed();
    expect(tt(['fav', 'add', 'Auth', '--from-entry', '1']).code).toBe(0);
    // The bare --fav route seeds the same template as `fav start`.
    expect(tt(['start', '--fav', 'Auth'], '2026-06-24T11:00:00Z').code).toBe(0);
    const base = JSON.parse(tt(['status', '--json'], '2026-06-24T11:00:00Z').out);
    expect(base.entry).toMatchObject({ client: 'Client A', project: 'API', tags: ['deep'], billable: true });
    // A flag passed alongside --fav layers over the template (tags replace, billable flips).
    expect(tt(['start', '--fav', 'Auth', '--tag', 'urgent', '--no-bill'], '2026-06-24T12:00:00Z').code).toBe(0);
    const overridden = JSON.parse(tt(['status', '--json'], '2026-06-24T12:00:00Z').out);
    expect(overridden.entry).toMatchObject({ client: 'Client A', project: 'API', tags: ['urgent'], billable: false });
  });

  it('resuming from an unknown favorite exits non-zero with a clear error, nothing running', () => {
    seed();
    const r = tt(['fav', 'start', 'Nonexistent']);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/no favorite "Nonexistent"/);
    // …and an unknown --fav on `start` is rejected the same way, leaving nothing open.
    const viaStart = tt(['start', '--fav', 'Nonexistent']);
    expect(viaStart.code).not.toBe(0);
    expect(viaStart.err).toMatch(/no favorite "Nonexistent"/);
    expect(JSON.parse(tt(['status', '--json']).out)).toEqual({ running: false, entry: null });
  });
});

describe('GOLD: tt backup ls / now / restore (§20 R04/R05, §17 R12)', () => {
  it('ls --json validates against backup.schema.json and lists launch backups newest-first', () => {
    // Each `tt` write opens the store, which writes a launch backup when the DB changed since the
    // last one (§20 R04). After seeding (several writes) at least one backup exists beside the DB.
    seed();
    const r = tt(['backup', 'ls', '--json']);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out);
    const validate = validator('backup.schema.json');
    expect(validate(json) || validate.errors).toBe(true);
    expect(json.length).toBeGreaterThanOrEqual(1);
    // Newest-first: the name-encoded UTC stamps are non-increasing down the list.
    const names = json.map((b: { name: string }) => b.name);
    expect([...names].sort().reverse()).toEqual(names);
    // Every backup names a real `.bak-` file beside the database.
    for (const b of json) {
      expect(b.name).toMatch(/\.bak-\d{8}T\d{6}Z$/);
      expect(b.size_bytes).toBeGreaterThan(0);
    }
  });

  it('ls on a fresh DB is a valid empty list (no writes yet, nothing to back up)', () => {
    // A pure read on a brand-new DB creates the schema but writes no backup until the content
    // changes; `backup ls --json` is the empty array, still schema-valid.
    const r = tt(['backup', 'ls', '--json']);
    expect(r.code).toBe(0);
    const validate = validator('backup.schema.json');
    expect(validate(JSON.parse(r.out)) || validate.errors).toBe(true);
  });

  it('now forces a backup; an immediate repeat is a no-op (unchanged)', () => {
    seed();
    const first = tt(['backup', 'now']);
    expect(first.code).toBe(0);
    // The just-forced backup matches the current DB, so a second `now` finds nothing changed.
    const again = tt(['backup', 'now']);
    expect(again.code).toBe(0);
    expect(again.out).toBe('unchanged — no new backup needed');
  });

  it('restore refuses without --force (the destructive-action gate), exits non-zero', () => {
    seed();
    const name = JSON.parse(tt(['backup', 'ls', '--json']).out)[0].name;
    const r = tt(['backup', 'restore', name]);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/refusing to restore/);
  });

  it('restore --force replaces the live DB with the chosen backup and sets the old one aside', () => {
    seed();
    // The seeded entry is present; capture the oldest backup name to restore from.
    const before = JSON.parse(tt(['list', '--range', '2026-06-24T00:00:00Z', '2026-06-25T00:00:00Z', '--all', '--json']).out);
    expect(before.length).toBe(1);
    const name = JSON.parse(tt(['backup', 'ls', '--json']).out).slice(-1)[0].name;
    const r = tt(['backup', 'restore', name, '--force']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/restored from .*; previous file set aside at .*\.replaced-/);
  });

  it('restore of an unknown backup name exits non-zero with a clear error', () => {
    seed();
    const r = tt(['backup', 'restore', 'tt.sqlite.bak-20000101T000000Z', '--force']);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/no backup named/);
  });
});

describe('GOLD: tt --version date/build stamping (§19 R06)', () => {
  // §19 R06 — the version `tt --version` prints is the shared @stint/core APP_VERSION constant,
  // stamped to the date/build `YYYY.M.D[.N]` by scripts/stamp-version.mjs. The artefact is the
  // criterion: with STINT_VERSION set the CLI prints exactly that release string; with no
  // override the output is a valid release version OR the deterministic dev sentinel — never a
  // non-date value (the old hardcoded 1.0.0 would fail). Validated against version.schema.json.
  function ttEnv(args: string[], extraEnv: Record<string, string>): { out: string; code: number } {
    const res = spawnSync('node', [BIN, ...args], {
      encoding: 'utf8',
      env: { ...process.env, TT_DB: db, NODE_NO_WARNINGS: '1', ...extraEnv },
    });
    return { out: (res.stdout ?? '').trimEnd(), code: res.status ?? 0 };
  }

  it('with STINT_VERSION set, --version prints exactly the stamped YYYY.M.D[.N] string', () => {
    const r = ttEnv(['--version'], { STINT_VERSION: '2026.6.27.2' });
    expect(r.out).toBe('2026.6.27.2');
    expect(r.code).toBe(0);
    // The printed line validates against the published version contract.
    const validate = validator('version.schema.json');
    expect(validate(r.out) || validate.errors).toBe(true);
  });

  it('a bare YYYY.M.D (no same-day suffix) round-trips through --version', () => {
    const r = ttEnv(['--version'], { STINT_VERSION: '2026.6.27' });
    expect(r.out).toBe('2026.6.27');
    const validate = validator('version.schema.json');
    expect(validate(r.out) || validate.errors).toBe(true);
  });

  it('without an override the default version is a release version or the dev sentinel, never 1.0.0', () => {
    // No STINT_VERSION: the committed literal (or whatever the build stamped). It must match the
    // §19 R06 date pattern OR be the dev sentinel, and must NOT be the old hardcoded 1.0.0.
    const res = spawnSync('node', [BIN, '--version'], {
      encoding: 'utf8',
      env: Object.fromEntries(
        Object.entries({ ...process.env, TT_DB: db, NODE_NO_WARNINGS: '1' }).filter(
          ([k]) => k !== 'STINT_VERSION',
        ),
      ),
    });
    const out = (res.stdout ?? '').trimEnd();
    expect(out).not.toBe('1.0.0');
    expect(/^\d{4}\.\d{1,2}\.\d{1,2}(\.\d+)?$/.test(out) || out === '0.0.0-dev').toBe(true);
    const validate = validator('version.schema.json');
    expect(validate(out) || validate.errors).toBe(true);
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
