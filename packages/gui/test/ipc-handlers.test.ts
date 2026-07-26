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
