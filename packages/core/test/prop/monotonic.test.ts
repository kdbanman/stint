/**
 * PROP — monotonic-time guard for derived elapsed (PRD §20 R06; acceptance.html §07).
 *
 * Wall clocks are not monotonic: NTP corrections and manual clock changes can move "now"
 * *behind* a running entry's start. The live count-up of an open entry must never report
 * negative, NaN, or garbage seconds when that happens — it clamps to 0 until the clock
 * catches back up. These properties pin that law two ways:
 *
 *   1. On the pure `elapsedSeconds(start, now)` helper — over ANY start and ANY skew
 *      offset (now strictly before, equal, and far ahead): the result is always a finite
 *      integer >= 0; equals round((now - start) / 1000) when now >= start; is exactly 0
 *      when now < start or either timestamp is unparseable.
 *   2. At the store level — an OPEN entry's rawSeconds / billableSeconds, derived through
 *      that guard in `toView`, can never go negative when the injected clock jumps behind
 *      start, while a forward-skewed clock yields the expected positive clamped elapsed.
 */
import { describe, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { Store, elapsedSeconds, toUtc, type Clock } from '@stint/core';

/** A clock whose "now" can be repointed, for deterministic skew. */
function settableClock(startMs: number): { clock: Clock; set: (ms: number) => void } {
  let nowMs = startMs;
  return { clock: () => new Date(nowMs), set: (ms) => (nowMs = ms) };
}

const BASE = Date.parse('2026-01-01T00:00:00Z');

describe('PROP: elapsedSeconds is a never-negative, finite, monotonic-tolerant guard (§20 R06)', () => {
  test.prop([
    fc.integer({ min: 0, max: 4_102_444_800_000 }), // start epoch ms (1970 .. 2100)
    fc.integer({ min: -10_000_000_000, max: 10_000_000_000 }), // skew ms (behind, equal, ahead)
  ])('always >= 0, finite, integer; round() when ahead, exactly 0 when behind', (startMs, skewMs) => {
    const startUtc = toUtc(new Date(startMs));
    const nowUtc = toUtc(new Date(startMs + skewMs));
    const out = elapsedSeconds(startUtc, nowUtc);

    expect(Number.isFinite(out)).toBe(true);
    expect(Number.isNaN(out)).toBe(false);
    expect(Number.isInteger(out)).toBe(true);
    expect(out).toBeGreaterThanOrEqual(0);

    const startSec = Date.parse(startUtc);
    const nowSec = Date.parse(nowUtc);
    if (nowSec >= startSec) {
      expect(out).toBe(Math.round((nowSec - startSec) / 1000));
    } else {
      expect(out).toBe(0);
    }
  });

  test.prop([fc.integer({ min: 1, max: 10_000_000_000 })])(
    'now strictly before start is exactly 0',
    (behindMs) => {
      const startUtc = toUtc(new Date(BASE));
      const nowUtc = toUtc(new Date(BASE - behindMs));
      expect(elapsedSeconds(startUtc, nowUtc)).toBe(0);
    },
  );

  test.prop([fc.string()])('unparseable timestamps yield 0, never NaN', (garbage) => {
    const good = toUtc(new Date(BASE));
    expect(elapsedSeconds(garbage, good)).toBe(0);
    expect(elapsedSeconds(good, garbage)).toBe(0);
    expect(elapsedSeconds(garbage, garbage)).toBe(0);
  });
});

describe('PROP: an open entry never reports negative derived elapsed under clock skew (§20 R06)', () => {
  test.prop([
    fc.integer({ min: 1, max: 10_000_000_000 }), // backward skew ms (now strictly before start)
  ])('a backward clock jump clamps rawSeconds / billableSeconds to 0', (backwardMs) => {
    const { clock, set } = settableClock(BASE);
    const store = Store.openMemory(clock);
    try {
      // Open an entry at the fixed BASE start.
      const id = store.start().value.id;
      // Simulate an NTP / manual backward jump: now is strictly before start.
      set(BASE - backwardMs);
      const view = store.getEntry(id)!;
      expect(view.endUtc).toBeNull(); // still open — derived elapsed, not stored
      expect(view.rawSeconds).toBe(0);
      expect(view.billableSeconds).toBe(0);
      expect(Number.isNaN(view.rawSeconds)).toBe(false);
      expect(Number.isNaN(view.billableSeconds)).toBe(false);
    } finally {
      store.close();
    }
  });

  test.prop([
    fc.integer({ min: 0, max: 10_000_000 }), // forward skew ms
  ])('a forward clock yields the expected positive clamped elapsed', (forwardMs) => {
    const { clock, set } = settableClock(BASE);
    const store = Store.openMemory(clock);
    try {
      const id = store.start().value.id;
      set(BASE + forwardMs);
      const view = store.getEntry(id)!;
      expect(view.rawSeconds).toBe(Math.round(forwardMs / 1000));
      expect(view.rawSeconds).toBeGreaterThanOrEqual(0);
      // No excluded time on a fresh entry: billable tracks raw.
      expect(view.billableSeconds).toBe(view.rawSeconds);
    } finally {
      store.close();
    }
  });
});
