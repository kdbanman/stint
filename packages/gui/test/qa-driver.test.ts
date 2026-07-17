/**
 * GOLD — QA-driver bridge parity (process.html — QA discovery; R05 "protect the guard").
 *
 * The QA discovery driver (qa/driver.mjs) ports main.ts's IPC handler map so a sweep
 * drives the real renderer over a real core store. A port can rot: a channel added to
 * ipc.ts without a driver handler would make the renderer's calls reject during a sweep
 * and read as a (false) finding — or worse, a stale handler would repro against logic
 * the app no longer runs. This binds the two: createHandlers()'s channel set must equal
 * CHANNELS exactly, both directions, and the GUI-only update bridge must stay off the
 * parity-asserted set (mirroring main.ts, which registers update:* outside the CHANNELS
 * loop). createHandlers is dependency-injected and side-effect-free, so this needs no
 * build, no browser, and no database.
 */
import { describe, it, expect } from 'vitest';
import { CHANNELS } from '../src/ipc.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS apparatus module, no type declarations on purpose.
import { createHandlers } from '../qa/driver.mjs';

describe('QA driver bridge parity (process.html QA discovery)', () => {
  const { handlers, updateHandlers } = createHandlers(null, {});

  it('covers every IPC channel the renderer can invoke — no missing handler', () => {
    const missing = CHANNELS.filter((ch) => typeof handlers[ch] !== 'function');
    expect(missing).toEqual([]);
  });

  it('carries no stray channel main.ts does not register — no stale handler', () => {
    const channelSet = new Set<string>(CHANNELS);
    const stray = Object.keys(handlers).filter((ch) => !channelSet.has(ch));
    expect(stray).toEqual([]);
  });

  it('keeps the GUI-only update bridge off the parity-asserted channel set', () => {
    const keys = Object.keys(updateHandlers);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith('update:'))).toBe(true);
    const channelSet = new Set<string>(CHANNELS);
    expect(keys.some((k) => channelSet.has(k))).toBe(false);
  });
});
