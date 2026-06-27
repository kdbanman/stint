/**
 * GOLD — the GUI's per-notification check-in interval picker (PRD §10b R4).
 *
 * An OS-native Notification cannot host a real <select>, so the canonical Electron
 * representation of the inline "interval dropdown" is a fixed set of labelled action
 * buttons: Stop, Keep going, then one button per interval choice. This pins the pure
 * selection logic — the action layout and the index→choice map — that `main.ts` wires
 * into the real Notification. The end-to-end OS-notification firing (the part that needs
 * a real desktop) is covered by MANUAL (`acceptance/manual/runbook.md`).
 *
 * `evaluateCheckin(state, interval, now, overrideNextMin)` — the core that consumes the
 * picked minutes for the next gap only, then reverts — is PROP-proven in
 * `packages/core/test/prop/checkin.test.ts` ("a custom dropdown pick applies to the next
 * gap only, then reverts").
 */
import { describe, it, expect } from 'vitest';
import { checkinActions } from '../src/checkin-actions.js';

describe('checkinActions — the GUI per-notification interval picker', () => {
  it('lays out Stop, Keep going, then the interval choices in order', () => {
    const { actions } = checkinActions();
    expect(actions.map((a) => a.text)).toEqual(['Stop', 'Keep going', '+15m', '+30m', '+60m', '+120m']);
    for (const a of actions) expect(a.type).toBe('button');
  });

  it('maps index 0 → stop and index 1 → keepDefault', () => {
    const { intervalForIndex } = checkinActions();
    expect(intervalForIndex(0)).toBe('stop');
    expect(intervalForIndex(1)).toBe('keepDefault');
  });

  it('maps each interval-choice index to its override minutes', () => {
    const { intervalForIndex } = checkinActions();
    expect(intervalForIndex(2)).toBe(15);
    expect(intervalForIndex(3)).toBe(30);
    expect(intervalForIndex(4)).toBe(60);
    expect(intervalForIndex(5)).toBe(120);
  });

  it('an out-of-range index falls back to keepDefault (no override)', () => {
    const { intervalForIndex } = checkinActions();
    expect(intervalForIndex(99)).toBe('keepDefault');
  });
});
