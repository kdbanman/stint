/**
 * GOLD — the GUI report/export plumbing (PRD §09 R6, §12 R8). The report builder paints
 * the core `Report` and the Export buttons must write bytes the user can hand to the same
 * invoice tooling `tt export` feeds. This drives the Electron-free helpers (the units
 * main.ts's `report` / `exportEntries` handlers delegate to) against an in-memory Store and
 * proves: the export bytes are byte-identical to core's toCsv/toJsonEntries (so the GUI and
 * `tt export` agree for the same range), the range resolves through core's resolveRange (no
 * renderer-side date math), and buildReportView is a faithful preset-resolving pass-through
 * to store.report.
 */
import { describe, it, expect } from 'vitest';
import { Store, resolveRange, toCsv, toJsonEntries, toUtc } from '@stint/core';
import {
  buildReportView,
  buildSavedReportView,
  resolveDateRange,
  utcWindowToDatePair,
  resolveExportRange,
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

describe('resolveExportRange — preset/custom range resolution', () => {
  it('resolves a named preset through core (no renderer date math)', () => {
    const store = mem();
    const ws = store.settings().weekStart;
    expect(resolveExportRange({ preset: 'week' }, ws, NOW)).toEqual(resolveRange('week', ws, NOW));
    expect(resolveExportRange({ preset: 'today' }, ws, NOW)).toEqual(resolveRange('today', ws, NOW));
    store.close();
  });

  it('passes an explicit custom from/to straight through', () => {
    const r = resolveExportRange(
      { fromUtc: '2026-06-10T00:00:00Z', toUtc: '2026-06-13T00:00:00Z' },
      'monday',
      NOW,
    );
    expect(r).toEqual({ fromUtc: '2026-06-10T00:00:00Z', toUtc: '2026-06-13T00:00:00Z' });
  });

  it('a preset takes precedence over a custom from/to when both are present', () => {
    const r = resolveExportRange(
      { preset: 'today', fromUtc: '2026-01-01T00:00:00Z', toUtc: '2026-01-02T00:00:00Z' },
      'monday',
      NOW,
    );
    expect(r).toEqual(resolveRange('today', 'monday', NOW));
  });

  it('defaults to This week when neither preset nor custom range is given', () => {
    const r = resolveExportRange({}, 'monday', NOW);
    expect(r).toEqual(resolveRange('week', 'monday', NOW));
  });
});

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
    const range = resolveExportRange({ preset: 'week' }, store.settings().weekStart, NOW);
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
    const range = resolveExportRange({ preset: 'week' }, store.settings().weekStart, NOW);
    const entries = store.listEntries({ fromUtc: range.fromUtc, toUtc: range.toUtc, billable: 'all' });

    const payload = exportPayload(entries, 'json', NOW);
    expect(payload.endsWith('\n')).toBe(true);
    // Parsing back yields exactly the core JSON-entries shape (no GUI-side reshaping).
    expect(JSON.parse(payload)).toEqual(toJsonEntries(entries, NOW));
    store.close();
  });

  it('an empty range exports just the CSV header (a valid, header-only file)', () => {
    const store = mem();
    const range = resolveExportRange(
      { fromUtc: '2030-01-01T00:00:00Z', toUtc: '2030-01-02T00:00:00Z' },
      'monday',
      NOW,
    );
    const entries = store.listEntries({ fromUtc: range.fromUtc, toUtc: range.toUtc, billable: 'all' });
    expect(entries).toEqual([]);
    expect(exportPayload(entries, 'csv', NOW)).toBe(toCsv([], NOW));
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

describe('buildSavedReportView — run a saved report through core (§09 R09)', () => {
  it('is a faithful pass-through to store.runReport (same core Report)', () => {
    const store = mem();
    seed(store);
    store.saveReport({
      name: 'Weekly',
      rangeSpec: { kind: 'preset', preset: 'week' },
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
    });
    const view = buildSavedReportView(store, 'Weekly', NOW);
    // It equals store.runReport directly (no renderer-side range/grouping/rounding math)…
    expect(view).toEqual(store.runReport('Weekly', NOW));
    // …and the saved this-week billable report has the one Acme line (3h), the non-billable
    // admin entry dropping out — proving the stored range-spec re-resolves at run time.
    expect(view.lines.map((l) => l.key)).toEqual(['Acme']);
    expect(view.grandTotalSeconds).toBe(3 * 3600);
    const week = resolveRange('week', store.settings().weekStart, NOW);
    expect(view.rangeFromUtc).toBe(week.fromUtc);
    expect(view.rangeToUtc).toBe(week.toUtc);
    store.close();
  });

  it('runs by id ref too (the Reports view may hold an id)', () => {
    const store = mem();
    seed(store);
    const def = store.saveReport({
      name: 'Weekly',
      rangeSpec: { kind: 'preset', preset: 'week' },
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
    });
    expect(buildSavedReportView(store, def.id, NOW)).toEqual(buildSavedReportView(store, 'Weekly', NOW));
    store.close();
  });

  it('a RELATIVE range-spec resolves through core to the SAME Report a direct store.report over the resolved bounds returns', () => {
    const store = mem();
    seed(store);
    // The GUI runReport plumbing is a faithful pass-through to core: a saved this-week
    // definition runs to byte/shape-identically what a direct store.report over the
    // resolveRange('week') absolute bounds returns — the renderer/main re-derive nothing.
    store.saveReport({
      name: 'ThisWeek',
      rangeSpec: { kind: 'preset', preset: 'week' },
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
    });
    const week = resolveRange('week', store.settings().weekStart, NOW);
    const direct = store.report({
      by: 'client',
      billableFilter: 'billable',
      rounding: false,
      roundingIncrementMin: 15,
      fromUtc: week.fromUtc,
      toUtc: week.toUtc,
    });
    expect(buildSavedReportView(store, 'ThisWeek', NOW)).toEqual(direct);
    store.close();
  });

  it('an ABSOLUTE range-spec passes straight through (no preset re-resolution)', () => {
    const store = mem();
    seed(store);
    // A saved def with an absolute from/to carries its own window verbatim; running it must
    // total exactly what a direct store.report over those bounds returns, with the group-by /
    // billable / rounding honoured verbatim (no renderer/main re-derivation).
    store.saveReport({
      name: 'FixedWindow',
      rangeSpec: { kind: 'absolute', fromUtc: '2026-06-22T00:00:00Z', toUtc: '2026-06-24T00:00:00Z' },
      by: 'client',
      billableFilter: 'all',
      rounding: false,
      roundingIncrementMin: 15,
    });
    const direct = store.report({
      by: 'client',
      billableFilter: 'all',
      rounding: false,
      roundingIncrementMin: 15,
      fromUtc: '2026-06-22T00:00:00Z',
      toUtc: '2026-06-24T00:00:00Z',
    });
    const view = buildSavedReportView(store, 'FixedWindow', NOW);
    expect(view).toEqual(direct);
    expect(view.rangeFromUtc).toBe('2026-06-22T00:00:00Z');
    expect(view.rangeToUtc).toBe('2026-06-24T00:00:00Z');
    // billable='all' keeps both seeded entries: 3h Acme + 0.5h (no client).
    expect(view.grandTotalSeconds).toBe(3 * 3600 + 30 * 60);
    store.close();
  });

  it('honours the saved def group-by / rounding verbatim (no renderer re-derivation)', () => {
    const store = mem();
    seed(store);
    // A by:'day' def with rounding on must run to the SAME Report a direct store.report with
    // those exact options over the resolved week returns — the plumbing changes nothing.
    store.saveReport({
      name: 'ByDayRounded',
      rangeSpec: { kind: 'preset', preset: 'week' },
      by: 'day',
      billableFilter: 'all',
      rounding: true,
      roundingIncrementMin: 30,
    });
    const week = resolveRange('week', store.settings().weekStart, NOW);
    const direct = store.report({
      by: 'day',
      billableFilter: 'all',
      rounding: true,
      roundingIncrementMin: 30,
      fromUtc: week.fromUtc,
      toUtc: week.toUtc,
    });
    const view = buildSavedReportView(store, 'ByDayRounded', NOW);
    expect(view).toEqual(direct);
    expect(view.options.by).toBe('day');
    expect(view.options.rounding).toBe(true);
    expect(view.options.roundingIncrementMin).toBe(30);
    store.close();
  });
});

describe('exportFileName — a dated default for the save dialog', () => {
  it('names the file after the range start day and the chosen format', () => {
    expect(exportFileName('2026-06-22T00:00:00.000Z', 'csv')).toBe('stint-export-2026-06-22.csv');
    expect(exportFileName('2026-06-22T00:00:00.000Z', 'json')).toBe('stint-export-2026-06-22.json');
  });
});
