/**
 * GOLD — the GUI report/export plumbing (PRD §09 R6, §12 R8). The report builder paints
 * the core `Report` and the Export buttons must write bytes the user can hand to the same
 * invoice tooling `tt export` feeds. This drives the Electron-free helpers (the units
 * main.ts's `report` / `exportEntries` handlers delegate to) against an in-memory Store and
 * proves: the export bytes are byte-identical to core's toCsv/toJsonEntries (so the GUI and
 * `tt export` agree for the same entries), the two export scopes cover exactly their honest
 * sets (the report's filtered rows; the whole record), and buildReportView is a faithful
 * preset-resolving pass-through to store.report.
 */
import { describe, it, expect } from 'vitest';
import {
  Store,
  resolveRange,
  resolveDateRange,
  utcWindowToDatePair,
  toCsv,
  toJsonEntries,
  toUtc,
} from '@stint/core';
import {
  buildReportView,
  resolveExportDefinition,
  exportPayload,
  exportFileName,
  savedReportToView,
  savedReportInputFromView,
} from '../src/reportview.js';

const NOW = new Date('2026-06-24T18:00:00Z'); // a Wednesday
const mem = () => Store.openMemory(() => NOW);

/** Seed one billable Acme entry this week so a report/export over the week is non-empty. */
function seed(store: Store): void {
  // Resolve names to ids the same way the surfaces do (AddOptions takes ids, not names).
  const { clientId, projectId } = store.resolveClientProjectByName({ client: 'Acme', project: 'API' });
  store.add({
    description: 'auth refactor',
    clientId,
    projectId,
    fromUtc: '2026-06-22T09:00:00Z',
    toUtc: '2026-06-22T12:00:00Z',
    tags: ['deep'],
    billable: true,
  });
  // A second, non-billable entry — export carries it too (billable='all', like tt export).
  store.add({
    description: 'admin',
    fromUtc: '2026-06-23T09:00:00Z',
    toUtc: '2026-06-23T09:30:00Z',
    billable: false,
  });
}

// §09 R01 — a custom range is a PAIR OF PLAIN DATES, no time component (G3). The GUI-side
// resolveDateRange is the ONE home of the plain-date → window rule: [from 00:00 local,
// day-after-to 00:00 local) — inclusive end day, half-open — the same convention core's
// resolveRange presets produce. utcWindowToDatePair is its inverse (painting a stored
// absolute spec back into the two date fields, tolerant of legacy arbitrary instants).
describe('resolveDateRange / utcWindowToDatePair — plain-date custom ranges (§09 R01)', () => {
  it('resolves the pair to local midnights: from 00:00 on the from-day, 00:00 the day AFTER the to-day', () => {
    const r = resolveDateRange('2026-06-22', '2026-06-23');
    // Local Date(y, m-1, d) construction — the expected bounds are true local midnights
    // in whatever timezone the test host runs, so the assertion is TZ-independent.
    expect(r.fromUtc).toBe(toUtc(new Date(2026, 5, 22)));
    expect(r.toUtc).toBe(toUtc(new Date(2026, 5, 24))); // inclusive end day → next midnight
  });

  it('a single-day pair (from == to) covers exactly that local calendar day', () => {
    const r = resolveDateRange('2026-06-23', '2026-06-23');
    expect(r.fromUtc).toBe(toUtc(new Date(2026, 5, 23)));
    expect(r.toUtc).toBe(toUtc(new Date(2026, 5, 24)));
  });

  it('rolls the day-after across month/year boundaries by calendar arithmetic', () => {
    expect(resolveDateRange('2026-06-01', '2026-06-30').toUtc).toBe(toUtc(new Date(2026, 6, 1)));
    expect(resolveDateRange('2026-12-15', '2026-12-31').toUtc).toBe(toUtc(new Date(2027, 0, 1)));
  });

  it('a DST-transition to-day still ends at the true next local midnight (calendar day-after, never +24h)', () => {
    // 2026-03-08 / 2026-10-25 are DST-change days in the US / EU respectively; on such a
    // 23- or 25-hour day a naive `+ 24h` lands an hour off local midnight. The expected
    // value is the local-Date construction itself, so this holds in ANY host timezone —
    // and on a DST host it differs from the +24h result, pinning the calendar arithmetic.
    for (const [y, m, d] of [[2026, 2, 8], [2026, 9, 25]] as const) {
      const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      expect(resolveDateRange(date, date).toUtc).toBe(toUtc(new Date(y, m, d + 1)));
    }
  });

  it('the window is half-open: the to-day is included IN FULL, the next day excluded (store.report proof)', () => {
    const store = mem();
    const { clientId } = store.resolveClientProjectByName({ client: 'Acme' });
    const add = (fromLocal: Date, toLocal: Date, description: string) =>
      store.add({
        description,
        clientId,
        fromUtc: toUtc(fromLocal),
        toUtc: toUtc(toLocal),
        billable: true,
      });
    // 2h on Mon local, 30 min ENDING 23:30 LOCAL on Tue (the to-day's late evening), and
    // 1h in the small hours of Wed local (all safely before the pinned NOW).
    add(new Date(2026, 5, 22, 10, 0), new Date(2026, 5, 22, 12, 0), 'monday build');
    add(new Date(2026, 5, 23, 23, 0), new Date(2026, 5, 23, 23, 30), 'late tuesday call');
    add(new Date(2026, 5, 24, 1, 0), new Date(2026, 5, 24, 2, 0), 'wednesday sync');
    const range = resolveDateRange('2026-06-22', '2026-06-23');
    const report = store.report({
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
      fromUtc: range.fromUtc,
      toUtc: range.toUtc,
    });
    // 2h + 0.5h — the late-evening entry on the to-date IS in; the day-after entry is NOT.
    expect(report.grandTotalSeconds).toBe(2.5 * 3600);
    store.close();
  });

  it('utcWindowToDatePair inverts resolveDateRange (the two date fields round-trip)', () => {
    const r = resolveDateRange('2026-06-22', '2026-06-23');
    expect(utcWindowToDatePair(r.fromUtc, r.toUtc)).toEqual({
      fromDate: '2026-06-22',
      toDate: '2026-06-23',
    });
    const single = resolveDateRange('2026-02-28', '2026-02-28');
    expect(utcWindowToDatePair(single.fromUtc, single.toUtc)).toEqual({
      fromDate: '2026-02-28',
      toDate: '2026-02-28',
    });
  });

  it('a LEGACY arbitrary-instant window rounds OUTWARD to its covering day pair', () => {
    // A pre-transition saved def could carry mid-day bounds; the pair must still cover the
    // whole stored window so nothing silently drops out of a repainted/re-saved def.
    const pair = utcWindowToDatePair(
      toUtc(new Date(2026, 5, 22, 9, 0)),
      toUtc(new Date(2026, 5, 24, 15, 30)),
    );
    expect(pair).toEqual({ fromDate: '2026-06-22', toDate: '2026-06-24' });
  });

  it('rejects a malformed plain date loudly (never a silent NaN window)', () => {
    expect(() => resolveDateRange('22/06/2026', '2026-06-23')).toThrow(/invalid plain date/);
    expect(() => resolveDateRange('2026-06-22', '2026-06-23T00:00')).toThrow(/invalid plain date/);
  });
});

// §09 R01 / R08 — the saved-report range-spec view speaks PLAIN DATES while core's
// RangeSpec keeps UTC instants; the two conversions must round-trip through the one
// resolveDateRange rule so a saved custom def re-opens with the same two dates.
describe('saved-report rangeSpec ⇄ view — plain-date absolute arm (§09 R01/R08)', () => {
  it('savedReportInputFromView resolves the date pair to the half-open local window', () => {
    const input = savedReportInputFromView({
      name: 'June window',
      rangeSpec: { kind: 'absolute', fromDate: '2026-06-01', toDate: '2026-06-07' },
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
    });
    expect(input.rangeSpec).toEqual({
      kind: 'absolute',
      ...resolveDateRange('2026-06-01', '2026-06-07'),
    });
  });

  it('a saved custom def paints back the SAME plain date pair (store round-trip)', () => {
    const store = mem();
    const def = store.saveReport(
      savedReportInputFromView({
        name: 'June window',
        rangeSpec: { kind: 'absolute', fromDate: '2026-06-01', toDate: '2026-06-07' },
        by: 'client',
        billableFilter: 'billable',
        rounding: false,
        roundingIncrementMin: 15,
      }),
    );
    const view = savedReportToView(def);
    expect(view.rangeSpec).toEqual({ kind: 'absolute', fromDate: '2026-06-01', toDate: '2026-06-07' });
    store.close();
  });

  it('the preset arm is untouched by the plain-date conversion', () => {
    const input = savedReportInputFromView({
      name: 'Weekly',
      rangeSpec: { kind: 'preset', preset: 'week' },
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
    });
    expect(input.rangeSpec).toEqual({ kind: 'preset', preset: 'week' });
  });
});

describe('exportPayload — bytes identical to tt export', () => {
  it('CSV matches core toCsv for the same entries (the bytes tt export writes)', () => {
    const store = mem();
    seed(store);
    const range = resolveRange('week', store.settings().weekStart, NOW);
    const entries = store.listEntries({ fromUtc: range.fromUtc, toUtc: range.toUtc, billable: 'all' });

    const expected = toCsv(entries, NOW);
    const payload = exportPayload(entries, 'csv', NOW);
    // toCsv already ends in a newline, so the payload is byte-identical to it…
    expect(payload).toBe(expected);
    // …and carries both entries (billable + non-billable) under the exact column contract.
    expect(payload.split('\n')[0]).toBe(
      'client,project,tags,description,start_utc,end_utc,raw_duration_s,excluded_s,billable,overlapped',
    );
    expect(payload).toMatch(/Acme,API,deep,auth refactor/);
    expect(payload).toMatch(/,admin,/);
    store.close();
  });

  it('JSON matches core toJsonEntries (pretty-printed, trailing newline) for the same range', () => {
    const store = mem();
    seed(store);
    const range = resolveRange('week', store.settings().weekStart, NOW);
    const entries = store.listEntries({ fromUtc: range.fromUtc, toUtc: range.toUtc, billable: 'all' });

    const payload = exportPayload(entries, 'json', NOW);
    expect(payload.endsWith('\n')).toBe(true);
    // Parsing back yields exactly the core JSON-entries shape (no GUI-side reshaping).
    expect(JSON.parse(payload)).toEqual(toJsonEntries(entries, NOW));
    store.close();
  });

  it('an empty record exports just the CSV header (a valid, header-only file)', () => {
    const store = mem();
    const entries = store.listEntries({ billable: 'all' });
    expect(entries).toEqual([]);
    expect(exportPayload(entries, 'csv', NOW)).toBe(toCsv([], NOW));
    store.close();
  });
});

describe('resolveExportDefinition — the two export scopes (§09 R06/R09)', () => {
  function withWeeklyReport(): Store {
    const store = mem();
    seed(store);
    // A billable-only Weekly report: on screen (and in its filtered export) it shows the
    // billable "auth refactor" and drops the non-billable "admin".
    store.saveReport({
      name: 'Weekly',
      rangeSpec: { kind: 'preset', preset: 'week' },
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
    });
    return store;
  }

  it("scope 'filtered' exports the rows the report shows (byte-identical to `tt report run --csv`)", () => {
    const store = withWeeklyReport();
    const { fileDayUtc, entries } = resolveExportDefinition(
      { format: 'csv', scope: 'filtered', savedReportRef: 'Weekly' },
      store,
      NOW,
    );
    // The billable "auth refactor" only — the non-billable "admin" is filtered out.
    expect(entries.map((e) => e.description)).toEqual(['auth refactor']);
    // Byte-identical to the core exporter the CLI `report run <name> --csv` drives.
    expect(exportPayload(entries, 'csv', NOW)).toBe(store.exportSavedReport('Weekly', 'csv', NOW));
    // The file is named for the resolved this-week window's start day.
    expect(fileDayUtc).toBe(store.resolveReportRange('Weekly', NOW).fromUtc);
    store.close();
  });

  it("scope 'all' exports the WHOLE RECORD — every raw entry ever (byte-identical to no-flag `tt export`)", () => {
    const store = withWeeklyReport();
    // An entry months OUTSIDE the report's week — the whole-record export must keep it.
    store.add({
      description: 'january audit',
      fromUtc: '2026-01-05T09:00:00Z',
      toUtc: '2026-01-05T10:00:00Z',
      billable: true,
    });
    const { fileDayUtc, entries } = resolveExportDefinition({ format: 'csv', scope: 'all' }, store, NOW);
    // Every entry ever: both this-week rows (the non-billable "admin" too) AND January.
    expect(entries.map((e) => e.description).sort()).toEqual(['admin', 'auth refactor', 'january audit']);
    const raw = store.listEntries({ billable: 'all' });
    expect(exportPayload(entries, 'csv', NOW)).toBe(toCsv(raw, NOW));
    // The file is named for the export day (no range to name it after).
    expect(fileDayUtc).toBe(NOW.toISOString());
    store.close();
  });

  it("scope 'all' ignores a saved ref — no report bounds or filters the whole record", () => {
    const store = withWeeklyReport();
    store.add({
      description: 'january audit',
      fromUtc: '2026-01-05T09:00:00Z',
      toUtc: '2026-01-05T10:00:00Z',
      billable: true,
    });
    const withRef = resolveExportDefinition(
      { format: 'csv', scope: 'all', savedReportRef: 'Weekly' },
      store,
      NOW,
    );
    const without = resolveExportDefinition({ format: 'csv', scope: 'all' }, store, NOW);
    expect(exportPayload(withRef.entries, 'csv', NOW)).toBe(exportPayload(without.entries, 'csv', NOW));
    expect(withRef.entries.map((e) => e.description).sort()).toEqual(['admin', 'auth refactor', 'january audit']);
    store.close();
  });

  it("scope 'filtered' without a saved ref is rejected (a filtered export belongs to a report)", () => {
    const store = mem();
    expect(() =>
      resolveExportDefinition({ format: 'csv', scope: 'filtered' }, store, NOW),
    ).toThrow(/filtered export requires/);
    store.close();
  });
});

describe('buildReportView — preset-resolving pass-through to store.report', () => {
  it('a preset request resolves to the same Report as a direct store.report over absolute bounds', () => {
    const store = mem();
    seed(store);
    const ws = store.settings().weekStart;
    const range = resolveRange('week', ws, NOW);
    const direct = store.report({
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
      fromUtc: range.fromUtc,
      toUtc: range.toUtc,
    });
    const view = buildReportView(
      store,
      { by: 'client', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15, preset: 'week' },
      NOW,
    );
    expect(view).toEqual(direct);
    // The billable-only week report has the one Acme line (the non-billable entry drops out).
    expect(view.lines.map((l) => l.key)).toEqual(['Acme']);
    expect(view.grandTotalSeconds).toBe(3 * 3600);
    store.close();
  });

  it('a custom from/to request passes straight through to store.report', () => {
    const store = mem();
    seed(store);
    const view = buildReportView(
      store,
      {
        by: 'client',
        billableFilter: 'all',
        rounding: false,
        roundingIncrementMin: 15,
        fromUtc: '2026-06-22T00:00:00Z',
        toUtc: '2026-06-24T00:00:00Z',
      },
      NOW,
    );
    expect(view.rangeFromUtc).toBe('2026-06-22T00:00:00Z');
    expect(view.rangeToUtc).toBe('2026-06-24T00:00:00Z');
    // billable='all' keeps both entries: 3h Acme + 0.5h (no client).
    expect(view.grandTotalSeconds).toBe(3 * 3600 + 30 * 60);
    store.close();
  });
});

describe('exportFileName — a dated default for the save dialog', () => {
  it('names the file after the day stamp (range start / export day) and the chosen format', () => {
    expect(exportFileName('2026-06-22T00:00:00.000Z', 'csv')).toBe('stint-export-2026-06-22.csv');
    expect(exportFileName('2026-06-22T00:00:00.000Z', 'json')).toBe('stint-export-2026-06-22.json');
  });
});
