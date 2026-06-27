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
import { Store, resolveRange, toCsv, toJsonEntries } from '@stint/core';
import {
  buildReportView,
  resolveExportRange,
  exportPayload,
  exportFileName,
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

describe('exportFileName — a dated default for the save dialog', () => {
  it('names the file after the range start day and the chosen format', () => {
    expect(exportFileName('2026-06-22T00:00:00.000Z', 'csv')).toBe('stint-export-2026-06-22.csv');
    expect(exportFileName('2026-06-22T00:00:00.000Z', 'json')).toBe('stint-export-2026-06-22.json');
  });
});
