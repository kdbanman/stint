/**
 * PROP + scenarios — sleep spans, reconciliation, subtract (PRD §10a, §17 R5).
 *
 * A sleep through a running timer produces a flagged entry with second-accurate
 * spans and a working, reversible one-tap subtract that only ever touches
 * excluded_seconds — never the stored start/end.
 */
import { describe, it, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { Store } from '@stint/core';

const NOW = '2026-05-10T12:00:00Z';
function memStore() {
  return Store.openMemory(() => new Date(NOW));
}

describe('PROP: subtract is exact and reversible (§17 R5)', () => {
  test.prop([fc.integer({ min: 1, max: 7200 }), fc.integer({ min: 1, max: 7200 })])(
    'subtract excludes exactly the slept seconds; raw unchanged; reversible',
    (sleepStartOffsetS, sleepLenS) => {
      const store = memStore();
      try {
        const start = '2026-05-10T09:00:00Z';
        const end = '2026-05-10T11:00:00Z';
        const { value: e } = store.add({ fromUtc: start, toUtc: end, billable: true });
        // A sleep span inside the entry.
        const sleepAt = new Date(Date.parse(start) + (sleepStartOffsetS % 3600) * 1000).toISOString();
        const wakeAt = new Date(Date.parse(sleepAt) + sleepLenS * 1000).toISOString();
        store.recordSleepSpan(e.id, sleepAt, wakeAt, 'event');

        const before = store.getEntry(e.id)!;
        expect(before.sleptThrough).toBe(true);
        const rawBefore = before.rawSeconds;

        const sub = store.subtractSleep(e.id);
        const afterSub = store.getEntry(e.id)!;
        // Excluded equals the slept seconds exactly; raw duration unchanged.
        expect(afterSub.excludedSeconds).toBe(sleepLenS);
        expect(afterSub.rawSeconds).toBe(rawBefore);
        expect(afterSub.billableSeconds).toBe(rawBefore - sleepLenS);
        expect(sub.after).toBe(sleepLenS);

        // Reversible: running subtract again restores the prior excluded_seconds.
        store.subtractSleep(e.id);
        expect(store.getEntry(e.id)!.excludedSeconds).toBe(0);
      } finally {
        store.close();
      }
    },
  );
});

describe('sleep scenarios', () => {
  it('records a live suspend→resume cycle as a flagged span (source=event)', () => {
    const store = memStore();
    const { value: e } = store.start({ description: 'deep work', atUtc: '2026-05-10T11:00:00Z' });
    store.recordSleepSpan(e.id, '2026-05-10T11:20:00Z', '2026-05-10T11:22:00Z', 'event');
    const v = store.getEntry(e.id)!;
    expect(v.sleptThrough).toBe(true);
    expect(v.sleepSpans).toHaveLength(1);
    expect(v.sleepSpans[0]!.source).toBe('event');
    // 2 minutes = 120 s, second-accurate.
    expect(store.subtractSleep(e.id).sleptSeconds).toBe(120);
    store.close();
  });

  it('multiple sleep cycles in one timer are all captured', () => {
    const store = memStore();
    const { value: e } = store.start({ atUtc: '2026-05-10T08:00:00Z' });
    store.recordSleepSpan(e.id, '2026-05-10T08:30:00Z', '2026-05-10T08:40:00Z', 'event');
    store.recordSleepSpan(e.id, '2026-05-10T09:30:00Z', '2026-05-10T09:35:00Z', 'event');
    expect(store.getEntry(e.id)!.sleepSpans).toHaveLength(2);
    expect(store.subtractSleep(e.id).sleptSeconds).toBe(900); // 10m + 5m
    store.close();
  });

  it('reconciles a wall-clock gap on launch as a source=gap suspicion, never auto-subtracted', () => {
    const store = memStore();
    const { value: e } = store.start({ atUtc: '2026-05-10T10:00:00Z' });
    // App last saw the world at 11:00; now is 12:00 — a 1h gap while closed.
    const span = store.reconcileGap('2026-05-10T11:00:00Z', NOW);
    expect(span).not.toBeNull();
    expect(span!.source).toBe('gap');
    const v = store.getEntry(e.id)!;
    expect(v.sleptThrough).toBe(true);
    // Flagged for review only — excluded_seconds is untouched until the operator decides.
    expect(v.excludedSeconds).toBe(0);
    store.close();
  });

  it('does not reconcile a small gap or when nothing is running', () => {
    const store = memStore();
    // Nothing running.
    expect(store.reconcileGap('2026-05-10T11:00:00Z', NOW)).toBeNull();
    store.start({ atUtc: '2026-05-10T11:59:00Z' });
    // 30 s gap < 90 s threshold.
    expect(store.reconcileGap('2026-05-10T11:59:30Z', NOW)).toBeNull();
    store.close();
  });

  it('subtract leaves stored start/end exactly as written (§17 R4)', () => {
    const store = memStore();
    const { value: e } = store.add({
      fromUtc: '2026-05-10T09:00:00Z',
      toUtc: '2026-05-10T11:00:00Z',
    });
    store.recordSleepSpan(e.id, '2026-05-10T10:00:00Z', '2026-05-10T10:30:00Z', 'event');
    store.subtractSleep(e.id);
    const v = store.getEntry(e.id)!;
    expect(v.startUtc).toBe('2026-05-10T09:00:00Z');
    expect(v.endUtc).toBe('2026-05-10T11:00:00Z');
    store.close();
  });
});
