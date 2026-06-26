/**
 * Unit — the timer-toggle decision (PRD §12 R2). The OS-global hotkey and the tray
 * click both fire `toggleTimer`, whose decision is `nextTimerAction`. We can't press
 * a real global hotkey or click a real tray icon in CI (those stay under MANUAL),
 * but the decision they carry out is pure and is proven here, plus end-to-end on the
 * core surface so the stop/resume/start outcomes are real, not just the labels.
 */
import { describe, it, expect } from 'vitest';
import { Store } from '@stint/core';
import { nextTimerAction } from '../src/toggle.js';

const NOW = '2026-06-24T18:00:00Z';
const mem = () => Store.openMemory(() => new Date(NOW));

describe('nextTimerAction — the one toggle decision', () => {
  it('stops when a timer is running', () => {
    expect(nextTimerAction(true, true)).toBe('stop');
    expect(nextTimerAction(true, false)).toBe('stop');
  });

  it('resumes the last entry when idle with history', () => {
    expect(nextTimerAction(false, true)).toBe('resume');
  });

  it('starts fresh when idle with no history to resume', () => {
    expect(nextTimerAction(false, false)).toBe('start');
  });
});

describe('the decision drives the real store the way the tray/hotkey would', () => {
  /** Mirror main.ts toggleTimer against the core surface — no Electron needed. */
  function toggle(store: Store): void {
    const action = nextTimerAction(!!store.openEntry(), store.listEntries().length > 0);
    if (action === 'stop') store.stop({});
    else if (action === 'resume') store.resume();
    else store.start({});
  }

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
});
