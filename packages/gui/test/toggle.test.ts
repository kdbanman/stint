/**
 * Unit — the timer toggle (PRD §12 R2). The OS-global hotkey and the tray click both fire
 * `toggleTimer`. We can't press a real global hotkey or click a real tray icon in CI (those
 * stay under MANUAL), but what the press carries out is Electron-free and is proven here on
 * the real core surface, so the stop/resume/start outcomes — and the warnings the write hands
 * back — are real, not just the labels.
 */
import { describe, it, expect } from 'vitest';
import { Store } from '@stint/core';
import { toggleTimer } from '../src/toggle.js';

const NOW = '2026-06-24T18:00:00Z';
const mem = () => Store.openMemory(() => new Date(NOW));

describe('the decision drives the real store the way the hotkey/button would', () => {
  // The shipping toggle itself (issue #165 — no local mirror of it here): its one Electron
  // seam is the repaint, and a no-op repaint changes nothing it writes.
  const toggle = (store: Store): void => void toggleTimer(store, () => {});

  it('first toggle on an empty database starts a timer', () => {
    const store = mem();
    expect(store.openEntry()).toBeNull();
    toggle(store);
    expect(store.openEntry()).not.toBeNull();
    store.close();
  });

  it('a second toggle stops it, a third resumes its attributes as a new entry', () => {
    const store = mem();
    const ca = store.addClient('Client A');
    store.start({ description: 'auth refactor', clientId: ca.id, atUtc: '2026-06-24T09:00:00Z' });
    const firstId = store.openEntry()!.id;

    toggle(store); // stop
    expect(store.openEntry()).toBeNull();

    toggle(store); // resume
    const resumed = store.openEntry()!;
    expect(resumed.id).not.toBe(firstId); // resume is a new row, never a re-open
    expect(resumed.description).toBe('auth refactor');
    expect(resumed.clientId).toBe(ca.id);
    store.close();
  });

  it('hands an overlap warning from the write back to its caller (§06 R4 — never silent)', () => {
    const store = mem();
    // A closed entry spanning NOW, and a timer started inside it: the toggle's stop closes the
    // open row over ground the other entry already covers, so core warns (allowed, flagged).
    store.add({ fromUtc: '2026-06-24T17:00:00Z', toUtc: '2026-06-24T19:00:00Z' });
    store.start({ atUtc: '2026-06-24T17:30:00Z' });

    const ack = toggleTimer(store, () => {}); // stop
    expect(ack.warnings.map((w) => w.kind)).toEqual(['overlap']);
    expect(ack.warnings[0]?.message).toMatch(/overlaps 1 other entry/);
    store.close();
  });

  it('hands back no warning when the write raised none', () => {
    const store = mem();
    // The counterpart to the case above, so an always-empty `warnings` could not pass both:
    // a first toggle on an empty database overlaps nothing.
    expect(toggleTimer(store, () => {}).warnings).toEqual([]);
    store.close();
  });
});
