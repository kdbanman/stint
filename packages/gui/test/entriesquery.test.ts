/**
 * Regression — issue #50 (§12 R04 / §12 R9). The Entries-toolbar `listEntries` query must
 * not REJECT when the query carries no `by`: the renderer never sends one (the Entries
 * calendar always lays by day; grouped breakdowns moved to Reports, G11), and the pre-fix
 * handler passed the undefined grouping straight into core's `buildEntryList`, whose
 * `keysOf` returned nothing iterable — so every toolbar-filtered query threw the moment
 * one entry matched. The rejection then propagated through the renderer's `load()`, which
 * starved `render()` and froze the Timer view's Active-Timer card on stale idle data.
 *
 * Driven through the QA driver's `createHandlers` port — the same handler body main.ts
 * runs, held at parity by qa-driver.test.ts — over a real in-memory core store, so the fix
 * (grouping defaults to 'day') is proven against the shipped query logic, not a stub.
 */
import { describe, it, expect } from 'vitest';
import {
  Store,
  toUtc,
  resolveRange,
  buildEntryList,
  describeOverlaps,
  joinClientProject,
} from '@stint/core';
import { resolveDateRange } from '../src/reportview.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS apparatus module, no type declarations on purpose.
import { createHandlers } from '../qa/driver.mjs';

// The entry's local day, the key core's day grouping produces (localDay is not exported;
// this mirrors its local-calendar-day rule for the assertion).
function localDayOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('listEntries grouping default (issue #50)', () => {
  it('a toolbar query with NO `by` returns day-laid groups instead of rejecting', () => {
    const store = Store.openMemory();
    // One closed entry ending an hour ago — the pre-fix throw only fired once at least one
    // entry matched the query, so an empty window would not exercise the regression.
    const now = Date.now();
    const startUtc = new Date(now - 2 * 3600_000).toISOString();
    store.add({
      description: 'seeded work',
      fromUtc: startUtc,
      toUtc: new Date(now - 1 * 3600_000).toISOString(),
      tags: [],
    });

    const { handlers } = createHandlers(store, {
      reportview: { resolveDateRange },
      core: { toUtc, resolveRange, buildEntryList, describeOverlaps, joinClientProject },
    });

    // The exact query shape app.js's Entries toolbar sends — range + billable, no `by`
    // (a custom plain-date pair spanning yesterday..tomorrow, so the seeded entry is in
    // range in every runner timezone).
    const view = handlers.listEntries({
      fromDate: localDayOf(new Date(now - 24 * 3600_000).toISOString()),
      toDate: localDayOf(new Date(now + 24 * 3600_000).toISOString()),
      billable: 'all',
    });

    // Day-laid groups: one group, keyed by the entry's local day, carrying the entry.
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].key).toBe(localDayOf(startUtc));
    expect(view.groups[0].entries.map((e: { description: string | null }) => e.description)).toEqual([
      'seeded work',
    ]);
  });

  it('an explicit `by` still wins over the default', () => {
    const store = Store.openMemory();
    const now = Date.now();
    store.add({
      description: 'client work',
      fromUtc: new Date(now - 2 * 3600_000).toISOString(),
      toUtc: new Date(now - 1 * 3600_000).toISOString(),
      tags: [],
    });
    const { handlers } = createHandlers(store, {
      reportview: { resolveDateRange },
      core: { toUtc, resolveRange, buildEntryList, describeOverlaps, joinClientProject },
    });
    const view = handlers.listEntries({
      fromDate: localDayOf(new Date(now - 24 * 3600_000).toISOString()),
      toDate: localDayOf(new Date(now + 24 * 3600_000).toISOString()),
      billable: 'all',
      by: 'client',
    });
    expect(view.groups.map((g: { key: string }) => g.key)).toEqual(['(no client)']);
  });
});
