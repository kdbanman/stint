/**
 * Unit — the destructive-action confirm decision (PRD §12 R13 / §17 R11). The real
 * inline `.confirm` affordance / OS dialog has no host in CI (it stays under MANUAL),
 * but the rule it enforces — "no destroy on a single stray click" — is pure and is
 * proven here: destructive actions require an explicit confirm before they may run,
 * non-destructive actions pass straight through, and an unconfirmed delete is blocked.
 */
import { describe, it, expect } from 'vitest';
import {
  isDestructive,
  requestAction,
  confirmAction,
  mayProceed,
} from '../src/confirm.js';

describe('isDestructive — which actions need a confirm', () => {
  it('delete and archive-when-referenced are destructive', () => {
    expect(isDestructive('delete')).toBe(true);
    expect(isDestructive('archive-referenced')).toBe(true);
  });

  it('reversible edits are not destructive', () => {
    expect(isDestructive('edit')).toBe(false);
    expect(isDestructive('split')).toBe(false);
    expect(isDestructive('merge')).toBe(false);
    expect(isDestructive('subtract-sleep')).toBe(false);
  });
});

describe('the confirm gate — a destructive op may never run from a bare request', () => {
  it('a destructive action is armed (requested), not yet permitted, on the first click', () => {
    const gate = requestAction('delete');
    expect(gate.stage).toBe('requested');
    // The stray first click destroys nothing — the op may NOT proceed yet.
    expect(mayProceed(gate)).toBe(false);
  });

  it('an unconfirmed delete is blocked; only the explicit confirm permits it', () => {
    const requested = requestAction('delete');
    expect(mayProceed(requested)).toBe(false); // blocked

    const confirmed = confirmAction(requested);
    expect(confirmed.stage).toBe('confirmed');
    expect(mayProceed(confirmed)).toBe(true); // the explicit confirm proceeds
  });

  it('archive-when-referenced takes the same two-step gate', () => {
    const requested = requestAction('archive-referenced');
    expect(mayProceed(requested)).toBe(false);
    expect(mayProceed(confirmAction(requested))).toBe(true);
  });

  it('a non-destructive action is confirmed immediately — nothing to gate', () => {
    for (const a of ['edit', 'split', 'merge', 'subtract-sleep'] as const) {
      const gate = requestAction(a);
      expect(gate.stage).toBe('confirmed');
      expect(mayProceed(gate)).toBe(true);
    }
  });
});
