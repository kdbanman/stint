/**
 * Regression — issue #50 (§12 R04 / §12 R9). The Entries-toolbar `listEntries` query must
 * not REJECT when the query carries no `by`: the renderer never sends one (the Entries
 * calendar always lays by day; grouped breakdowns moved to Reports, G11), and the pre-fix
 * handler passed the undefined grouping straight into core's `buildEntryList`, whose
 * `keysOf` returned nothing iterable — so every toolbar-filtered query threw the moment
 * one entry matched. The rejection then propagated through the renderer's `load()`, which
 * starved `render()` and froze the Timer view's Active-Timer card on stale idle data.
 *
 * Driven through the SHIPPING handler map (src/ipc-handlers.ts) over a real in-memory core
 * store, so reverting the fix fails here. It used to drive the QA driver's copy of that
 * handler, which carried its own `?? 'day'` default — the copy was guarded, the original
 * was not (issue #87's defect class, re-found as #165).
 */
import { describe, it, expect } from 'vitest';
import { Store } from '@stint/core';
import { createIpcHandlers, type IpcHandlerDeps } from '../src/ipc-handlers.js';

// The handler under test reads and groups; the OS-bound seams are never reached.
function handlersOver(store: Store): ReturnType<typeof createIpcHandlers> {
  const deps: IpcHandlerDeps = {
    store,
    refreshAll: () => {},
    showSaveDialog: () => undefined,
    rebindGlobalHotkey: () => {},
  };
  return createIpcHandlers(deps);
}

// A fixed LOCAL wall-clock afternoon — local, so the day the entry falls on is 2026-03-05
// in every runner timezone, and fixed, so the assertion never rides the system clock.
const FROM = new Date(2026, 2, 5, 13, 0, 0).toISOString();
const TO = new Date(2026, 2, 5, 14, 0, 0).toISOString();

describe('listEntries grouping default (issue #50)', () => {
  it('a toolbar query with NO `by` returns day-laid groups instead of rejecting', () => {
    const store = Store.openMemory();
    // One closed entry — the pre-fix throw only fired once at least one entry matched the
    // query, so an empty window would not exercise the regression.
    store.add({ description: 'seeded work', fromUtc: FROM, toUtc: TO, tags: [] });

    // The exact query shape app.js's Entries toolbar sends — range + billable, no `by`.
    const view = handlersOver(store).listEntries({
      fromDate: '2026-03-04',
      toDate: '2026-03-06',
      billable: 'all',
    });

    // Day-laid groups: one group, keyed by the entry's local day, carrying the entry.
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]!.key).toBe('2026-03-05');
    expect(view.groups[0]!.entries.map((e) => e.description)).toEqual(['seeded work']);
  });

  it('an explicit `by` still wins over the default', () => {
    const store = Store.openMemory();
    store.add({ description: 'client work', fromUtc: FROM, toUtc: TO, tags: [] });

    const view = handlersOver(store).listEntries({
      fromDate: '2026-03-04',
      toDate: '2026-03-06',
      billable: 'all',
      by: 'client',
    });

    expect(view.groups.map((g) => g.key)).toEqual(['(no client)']);
  });
});
