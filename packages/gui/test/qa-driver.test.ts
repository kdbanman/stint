/**
 * GOLD — QA-driver bridge parity (process.html — QA discovery; R05 "protect the guard").
 *
 * The QA discovery driver (qa/driver.mjs) bridges a real renderer in headless Chromium to a
 * real core store, and a finding it produces is only as trustworthy as that bridge. A bridge
 * can rot two ways: a channel in ipc.ts with no handler makes the renderer's call reject
 * during a sweep and read as a (false) finding, and — worse — a handler that is not the app's
 * makes a sweep repro against logic the app no longer runs.
 *
 * Until issue #165 the driver hand-copied main.ts's handler map and this guard compared only
 * channel-NAME sets, which cannot see a body: two behaviours had drifted under a green test
 * (the Entries row dropped the clientName/projectName §09 R7's live search reads — issue #84 —
 * and `merge` dropped `allowGap`, §12 R13). The copy is gone; the driver now imports
 * createIpcHandlers, so this binds both failure modes:
 *
 *   1. every CHANNELS entry is served by the bridge (the coverage half, unchanged), and
 *   2. every one of those handlers is the SHIPPING map's own function body — reintroducing a
 *      driver-local re-implementation, or wrapping one, fails here. (Identity is per-call:
 *      each createIpcHandlers call closes over its own deps, so the bind compares the
 *      function each channel resolves to, which differs the instant a body is re-typed.)
 *
 * The driver is plain-JS apparatus importing the BUILT map, so this needs `npm run build`
 * first — the same precondition the driver itself has, and CI's order (build, then test).
 */
import { describe, it, expect } from 'vitest';
import { CHANNELS } from '../src/ipc.js';
import { createIpcHandlers, type IpcHandlerDeps } from '../dist/ipc-handlers.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS apparatus module, no type declarations on purpose.
import { createHandlers } from '../qa/driver.mjs';

// Building either map only creates closures — no dep is invoked, no store is touched — so
// stubs suffice on both sides.
const shippingDeps: IpcHandlerDeps = {
  store: {} as unknown as IpcHandlerDeps['store'],
  refreshAll: () => {},
  showSaveDialog: () => undefined,
  rebindGlobalHotkey: () => {},
};

describe('QA driver bridge parity (process.html QA discovery)', () => {
  const { handlers, updateHandlers } = createHandlers({}, {});
  const shipping = createIpcHandlers(shippingDeps);

  it('covers every IPC channel the renderer can invoke — no missing handler', () => {
    const missing = CHANNELS.filter((ch) => typeof handlers[ch] !== 'function');
    expect(missing).toEqual([]);
  });

  it('carries no stray channel main.ts does not register — no stale handler', () => {
    const channelSet = new Set<string>(CHANNELS);
    const stray = Object.keys(handlers).filter((ch) => !channelSet.has(ch));
    expect(stray).toEqual([]);
  });

  it('serves each channel with the SHIPPING handler, not a driver-local copy (issue #165)', () => {
    const reimplemented = CHANNELS.filter(
      (ch) => String(handlers[ch]) !== String(shipping[ch]),
    );
    expect(reimplemented, 'channels the QA bridge re-implements instead of importing').toEqual([]);
  });

  it('keeps the GUI-only update bridge off the parity-asserted channel set', () => {
    const keys = Object.keys(updateHandlers);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith('update:'))).toBe(true);
    const channelSet = new Set<string>(CHANNELS);
    expect(keys.some((k) => channelSet.has(k))).toBe(false);
  });
});
