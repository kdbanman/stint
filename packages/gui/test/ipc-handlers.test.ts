/**
 * GOLD — shipping IPC handler-map parity (PRD §12/§15; issue #87 "the copy is guarded, the
 * original isn't").
 *
 * The renderer↔main seam is the one seam Electron forces. Its shipping handler map lives in
 * createIpcHandlers (src/ipc-handlers.ts); the QA-driver's PORT of that map (qa/driver.mjs)
 * was already bind-tested to CHANNELS (test/qa-driver.test.ts), but the original was not — the
 * copy was safer than the source it ports. This binds the original the same way, both
 * directions: createIpcHandlers()'s channel set must equal CHANNELS exactly.
 *
 * A channel added to CHANNELS without a handler (or a handler with no channel) fails here — the
 * runtime twin of the compile-time guarantee ipc.ts's IpcContract/IpcHandlers now gives (a
 * reshaped payload or a missing handler stops `tsc`). createIpcHandlers is dependency-injected
 * and side-effect-free — building the map invokes no handler — so this needs no Electron, no
 * browser, and no real database; the stub deps are never called.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, toCsv, toJsonEntries } from '@stint/core';
import { CHANNELS } from '../src/ipc.js';
import { createIpcHandlers, type IpcHandlerDeps } from '../src/ipc-handlers.js';

// Building the handler map only creates closures — no dep is invoked — so no-op stubs suffice.
const deps: IpcHandlerDeps = {
  store: {} as unknown as IpcHandlerDeps['store'],
  refreshAll: () => {},
  showSaveDialog: () => undefined,
  rebindGlobalHotkey: () => {},
};

describe('shipping IPC handler-map parity (issue #87)', () => {
  const handlers = createIpcHandlers(deps);

  it('covers every IPC channel the renderer can invoke — no missing handler', () => {
    const missing = CHANNELS.filter((ch) => typeof handlers[ch] !== 'function');
    expect(missing).toEqual([]);
  });

  it('carries no stray channel CHANNELS does not name — no orphan handler', () => {
    const channelSet = new Set<string>(CHANNELS);
    const stray = Object.keys(handlers).filter((ch) => !channelSet.has(ch));
    expect(stray).toEqual([]);
  });
});

/**
 * GOLD — the `exportEntries` handler's write path (§09 R06/R09; issue #129).
 *
 * `reportview.test.ts` proves the export BYTES (both scopes byte-identical to `tt report run`
 * and `tt export`), and JUDGE `REPORTS_VIEW` proves the renderer's two Export controls invoke
 * the channel with the right scope. Between them sat the main-side half nobody asserted: the
 * handler resolving the scope, asking for a save target, and writing those exact bytes to the
 * chosen path — the step the MANUAL runbook used to cover by hand because "the native save
 * dialog has no Playwright host". The dialog is an injected dep (`deps.showSaveDialog`), so the
 * whole path IS reachable headlessly and a manual check for it was a §05 process defect. This
 * drives the shipping handler over a real core Store and a real temp directory, with the dialog
 * stubbed at its seam — the honest boundary, since only the OS widget itself needs a desktop.
 *
 * What it pins: each scope writes the file its `tt` twin would write; the suggested filename
 * and format reach the dialog; a canceled dialog writes NOTHING and says so.
 */
describe('GOLD — exportEntries writes the chosen scope to the save target (§09 R06/R09)', () => {
  const NOW = new Date('2026-06-24T18:00:00Z');

  /**
   * A real store with one billable and one non-billable closed entry this week, plus one
   * months earlier — the row a whole-record 'all' export keeps and any window would drop.
   */
  function seeded(): Store {
    const store = Store.openMemory(() => NOW);
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
    store.add({
      description: 'admin',
      fromUtc: '2026-06-23T09:00:00Z',
      toUtc: '2026-06-23T09:30:00Z',
      billable: false,
    });
    store.add({
      description: 'january audit',
      fromUtc: '2026-01-05T09:00:00Z',
      toUtc: '2026-01-05T10:00:00Z',
      billable: true,
    });
    return store;
  }

  /** Build the shipping handler map over a real store, recording what the dialog was asked. */
  function harness(store: Store, target: string | undefined) {
    const asked: { format: string; suggested: string }[] = [];
    const handlers = createIpcHandlers({
      store,
      refreshAll: () => {},
      showSaveDialog: (format, suggested) => {
        asked.push({ format, suggested });
        return target;
      },
      rebindGlobalHotkey: () => {},
    });
    return { handlers, asked };
  }

  /** Every raw entry ever — what no-flag `tt export` writes — the scope-'all' expectation. */
  function wholeRecord(store: Store) {
    return store.listEntries({ billable: 'all' });
  }

  it("scope 'all' writes the whole-record `tt export` CSV bytes to the path the dialog returned", () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-export-'));
    const store = seeded();
    try {
      const target = join(dir, 'picked.csv');
      const { handlers, asked } = harness(store, target);

      const res = handlers.exportEntries({ format: 'csv', scope: 'all' });

      // The ack reports the row count and the path actually written…
      expect(res).toEqual({ written: wholeRecord(store).length, path: target });
      // …the file exists with the same bytes core's toCsv produces for those entries (so the
      // file the GUI lands and no-flag `tt export --csv` are the same bytes)…
      const written = readFileSync(target, 'utf8');
      expect(written).toBe(toCsv(wholeRecord(store), NOW));
      // …including the non-billable row ('all' does not narrow by billable) AND the January
      // row months outside any current window ('all' is the whole record, not a range).
      expect(written).toMatch(/,admin,/);
      expect(written).toMatch(/,january audit,/);
      // The dialog was asked once, for the right format, with a dated default name.
      expect(asked).toHaveLength(1);
      expect(asked[0]?.format).toBe('csv');
      expect(asked[0]?.suggested).toMatch(/^stint-export-\d{4}-\d{2}-\d{2}\.csv$/);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scope 'all' writes the whole-record `tt export` JSON bytes verbatim", () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-export-'));
    const store = seeded();
    try {
      const target = join(dir, 'picked.json');
      const { handlers } = harness(store, target);

      const res = handlers.exportEntries({ format: 'json', scope: 'all' });

      expect(res).toEqual({ written: wholeRecord(store).length, path: target });
      const written = readFileSync(target, 'utf8');
      expect(written.endsWith('\n')).toBe(true);
      expect(JSON.parse(written)).toEqual(toJsonEntries(wholeRecord(store), NOW));
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scope 'filtered' writes the report's OWN rows — the off-filter entry is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-export-'));
    const store = seeded();
    try {
      // A billable-only saved report over this week: `admin` (clientless ⇒ non-billable) fails
      // its filter and `january audit` falls outside its window, so the filtered file must
      // drop both rows the whole-record file keeps.
      store.saveReport({
        name: 'This week',
        rangeSpec: { kind: 'absolute', fromUtc: '2026-06-22T00:00:00Z', toUtc: '2026-06-29T00:00:00Z' },
        by: 'client',
        billableFilter: 'billable',
        rounding: false,
        roundingIncrementMin: 15,
      });
      const target = join(dir, 'filtered.csv');
      const { handlers } = harness(store, target);

      const res = handlers.exportEntries({
        format: 'csv',
        scope: 'filtered',
        savedReportRef: 'This week',
      });

      const written = readFileSync(target, 'utf8');
      expect(written).toMatch(/Acme,API,deep,auth refactor/);
      expect(written).not.toMatch(/,admin,/);
      expect(written).not.toMatch(/,january audit,/);
      expect(res).toEqual({ written: 1, path: target });
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a canceled save dialog writes no file and reports the cancel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-export-'));
    const store = seeded();
    try {
      const { handlers, asked } = harness(store, undefined);

      const res = handlers.exportEntries({ format: 'csv', scope: 'all' });

      // Cancel is non-destructive: the ack says so and NOTHING landed on disk anywhere.
      expect(res).toEqual({ canceled: true });
      expect(asked).toHaveLength(1);
      expect(readdirSync(dir)).toEqual([]);
      expect(existsSync(join(dir, asked[0]?.suggested ?? 'x'))).toBe(false);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
