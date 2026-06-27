/**
 * PROP — invariants over generated inputs (acceptance.html §07).
 *
 * These are the criteria guarding the numbers that reach an invoice. Where a BDD
 * scenario pins one path, a property asserts a law over thousands.
 *
 *   PRD §03 / §17 R2 — at most one open entry under ANY interleaving
 *   PRD §03 / §09 R04 / §17 R4 — stored truth immutable under rounding & subtract;
 *                                rounding is display/export-only, to the nearest increment
 *   PRD §03         — billable = max(0, raw - excluded)
 *   PRD §06         — split @t then merge restores the original span
 *   PRD §04 / §16   — duration is UTC math, so DST-/zone-safe
 */
import { describe, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import {
  Store,
  openDb,
  roundSeconds,
  secondsBetween,
  renderLocal,
  type Clock,
} from '@stint/core';

/** A clock whose "now" can be advanced, for deterministic op sequences. */
function mutableClock(startMs: number): { clock: Clock; advance: (ms: number) => void } {
  let nowMs = startMs;
  return { clock: () => new Date(nowMs), advance: (ms) => (nowMs += ms) };
}

const BASE = Date.parse('2026-01-01T00:00:00Z');

type Op =
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'resume' }
  | { kind: 'add'; durationS: number }
  | { kind: 'gap'; ms: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.constant<Op>({ kind: 'start' }),
  fc.constant<Op>({ kind: 'stop' }),
  fc.constant<Op>({ kind: 'resume' }),
  fc.integer({ min: 1, max: 7200 }).map((s): Op => ({ kind: 'add', durationS: s })),
  fc.integer({ min: 1000, max: 3_600_000 }).map((ms): Op => ({ kind: 'gap', ms })),
);

// §05 R01 Start is classified `core` (data integrity / core-entry per §03): this
// property is the PROP evidence that the at-most-one-open invariant holds under the
// `start` op in opArb — the badge labels behaviour this law already pins, unchanged.
describe('PROP: one open entry under any op sequence (§03, §05 R01, §17 R2)', () => {
  test.prop([fc.array(opArb, { maxLength: 40 })])(
    'at most one open entry after every operation',
    (ops) => {
      const { clock, advance } = mutableClock(BASE);
      const store = Store.openMemory(clock);
      try {
        for (const op of ops) {
          try {
            switch (op.kind) {
              case 'start':
                store.start({});
                break;
              case 'stop':
                store.stop({});
                break;
              case 'resume':
                store.resume();
                break;
              case 'add': {
                const now = clock().getTime();
                store.add({
                  fromUtc: new Date(now - op.durationS * 1000).toISOString(),
                  toUtc: new Date(now).toISOString(),
                });
                break;
              }
              case 'gap':
                advance(op.ms);
                break;
            }
          } catch (err) {
            // Expected domain errors (e.g. "nothing is running") are fine; the
            // invariant must hold regardless of which ops succeed.
            if (!(err as Error).name.includes('StoreError')) throw err;
          }
          // The law: never more than one open entry, whatever happened.
          expect(store.listEntries().filter((e) => e.endUtc === null).length).toBeLessThanOrEqual(1);
        }
      } finally {
        store.close();
      }
    },
  );
});

// §20 R02 — the at-most-one-open invariant given DB-level teeth. The property above proves the
// invariant holds along the TRANSACTIONAL core path (start/stop under BEGIN IMMEDIATE). This one
// proves the storage-layer backstop INDEPENDENTLY of the human-readable triggers: with the
// one_open_entry_* triggers dropped (so the partial unique index alone is under test), a RAW
// second INSERT that bypasses core logic entirely is still rejected by `one_open_entry_idx`, for
// arbitrary generated entry attributes — and unlimited CLOSED rows (excluded from the partial
// index) never collide. This is what fails if the index ever regresses to indexing end_utc
// instead of the constant (1): SQLite treats NULLs as distinct, so end_utc would permit a second
// open row and this property would catch it. openDb runs migrate(), so the index is present.
describe('PROP: a raw second open INSERT is rejected by the DB index (§20 R02)', () => {
  const attrsArb = fc.record({
    startMs: fc.integer({ min: BASE, max: BASE + 365 * 24 * 3_600_000 }),
    billable: fc.constantFrom(0, 1),
    excludedSeconds: fc.integer({ min: 0, max: 86_400 }),
  });

  test.prop([attrsArb, fc.array(attrsArb, { maxLength: 12 })])(
    'with triggers dropped, a second RAW open INSERT throws a UNIQUE error while closed rows never do',
    (open, closed) => {
      const db = openDb(':memory:');
      try {
        // Seed exactly one open row (end_utc NULL) — the single permitted open entry.
        db.prepare(
          'INSERT INTO entry(start_utc, end_utc, billable, excluded_seconds) VALUES(?, NULL, ?, ?)',
        ).run(new Date(open.startMs).toISOString(), open.billable, open.excludedSeconds);

        // Drop the BEFORE INSERT/UPDATE triggers so the partial unique index is the SOLE remaining
        // defense — otherwise the trigger would abort first with 'an entry is already open' and we
        // would never exercise the index. This isolates the storage-layer backstop §20 R02 promises.
        db.exec('DROP TRIGGER IF EXISTS one_open_entry_insert');
        db.exec('DROP TRIGGER IF EXISTS one_open_entry_update');

        // A RAW second open INSERT (end_utc NULL) bypassing the transactional core path must be
        // rejected by the partial unique index alone, whatever the generated attributes.
        expect(() =>
          db
            .prepare(
              'INSERT INTO entry(start_utc, end_utc, billable, excluded_seconds) VALUES(?, NULL, ?, ?)',
            )
            .run(new Date(open.startMs + 1000).toISOString(), open.billable, open.excludedSeconds),
        ).toThrow(/UNIQUE constraint failed: index 'one_open_entry_idx'/);

        // Closed rows (end_utc NOT NULL) are excluded from the partial index — unlimited closed
        // rows coexist with the single open row and never collide.
        for (const c of closed) {
          const start = new Date(c.startMs).toISOString();
          const end = new Date(c.startMs + 60_000).toISOString();
          expect(() =>
            db
              .prepare(
                'INSERT INTO entry(start_utc, end_utc, billable, excluded_seconds) VALUES(?, ?, ?, ?)',
              )
              .run(start, end, c.billable, c.excludedSeconds),
          ).not.toThrow();
        }

        // Exactly one open row survives the whole sequence.
        const openCount = (
          db.prepare('SELECT COUNT(*) AS n FROM entry WHERE end_utc IS NULL').get() as { n: number }
        ).n;
        expect(openCount).toBe(1);
      } finally {
        db.close();
      }
    },
  );
});

describe('PROP: stored truth is immutable under the rounding lens (§03/§09 R04/§17 R4)', () => {
  test.prop([
    fc.integer({ min: 60, max: 86_400 }),
    fc.constantFrom(6, 10, 15, 30),
    fc.integer({ min: 0, max: 3600 }),
  ])('rounding and subtract never mutate start/end (the "stored time exact" half of §09 R04)', (durationS, inc, sleptS) => {
    const fixedNow = Date.parse('2026-03-15T18:00:00Z');
    const store = Store.openMemory(() => new Date(fixedNow));
    try {
      const fromUtc = new Date(fixedNow - durationS * 1000).toISOString();
      const toUtc = new Date(fixedNow).toISOString();
      const { value: entry } = store.add({ fromUtc, toUtc, billable: true });
      // A sleep span no longer than the entry, so subtract is meaningful.
      const span = Math.min(sleptS, durationS);
      store.recordSleepSpan(
        entry.id,
        fromUtc,
        new Date(Date.parse(fromUtc) + span * 1000).toISOString(),
        'event',
      );

      const before = store.getEntry(entry.id)!;
      // Apply the display lens (rounding). Rounding is display/export-only: the
      // derived report line may round, but the stored entry — start/end AND the
      // stored raw/billable seconds — must come back byte-identical.
      const report = store.report({
        fromUtc: new Date(fixedNow - 2 * durationS * 1000).toISOString(),
        toUtc: new Date(fixedNow + 1000).toISOString(),
        by: 'client',
        billableFilter: 'all',
        rounding: true,
        roundingIncrementMin: inc,
      });

      const afterRound = store.getEntry(entry.id)!;
      // The stored truth is untouched by the rounding lens.
      expect(afterRound.startUtc).toBe(before.startUtc);
      expect(afterRound.endUtc).toBe(before.endUtc);
      expect(afterRound.rawSeconds).toBe(before.rawSeconds);
      expect(afterRound.billableSeconds).toBe(before.billableSeconds);
      // The rounded total is a derived multiple of the increment, distinct from
      // the exact total only in the report — never written back to the entry.
      const step = inc * 60;
      expect(report.grandRoundedSeconds % step).toBe(0);

      // The subtract is likewise display-deriving on excluded, not on start/end.
      store.subtractSleep(entry.id);
      const after = store.getEntry(entry.id)!;
      expect(after.startUtc).toBe(before.startUtc);
      expect(after.endUtc).toBe(before.endUtc);
    } finally {
      store.close();
    }
  });
});

describe('PROP: billable duration arithmetic (§03)', () => {
  test.prop([fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 0, max: 200_000 })])(
    'billable = max(0, raw - excluded), never negative',
    (durationS, excludedS) => {
      const fixedNow = Date.parse('2026-03-15T18:00:00Z');
      const store = Store.openMemory(() => new Date(fixedNow));
      try {
        const fromUtc = new Date(fixedNow - durationS * 1000).toISOString();
        const toUtc = new Date(fixedNow).toISOString();
        const { value: entry } = store.add({ fromUtc, toUtc });
        // Drive excluded_seconds through the real API: a recorded sleep span of
        // exactly excludedS seconds, then subtractSleep moves it to excluded.
        const spanEnd = new Date(Date.parse(fromUtc) + excludedS * 1000).toISOString();
        store.recordSleepSpan(entry.id, fromUtc, spanEnd, 'event');
        store.subtractSleep(entry.id);
        const v = store.getEntry(entry.id)!;
        expect(v.excludedSeconds).toBe(excludedS);
        expect(v.billableSeconds).toBe(Math.max(0, v.rawSeconds - excludedS));
        expect(v.billableSeconds).toBeGreaterThanOrEqual(0);
      } finally {
        store.close();
      }
    },
  );
});

describe('PROP: split then merge is identity on the span (§06)', () => {
  const spanArb = fc
    .integer({ min: 120, max: 86_400 })
    .chain((d) => fc.record({ durationS: fc.constant(d), offsetS: fc.integer({ min: 1, max: d - 1 }) }));
  test.prop([spanArb])('split @t then merge restores [start, end]', ({ durationS, offsetS }) => {
      const fixedNow = Date.parse('2026-03-15T18:00:00Z');
      const store = Store.openMemory(() => new Date(fixedNow));
      try {
        const start = fixedNow - durationS * 1000;
        const end = fixedNow;
        const fromUtc = new Date(start).toISOString();
        const toUtc = new Date(end).toISOString();
        const { value: entry } = store.add({ fromUtc, toUtc });
        const at = new Date(start + offsetS * 1000).toISOString();
        const [a, b] = store.split(entry.id, at);
        const { value: merged } = store.merge([a.id, b.id]);
        expect(merged.startUtc).toBe(fromUtc);
        expect(merged.endUtc).toBe(toUtc);
      } finally {
        store.close();
      }
    },
  );
});

describe('PROP: duration is UTC math, zone-/DST-safe (§04, §16)', () => {
  test.prop([
    fc.integer({ min: 1, max: 1_000_000 }),
    fc.constantFrom('UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland', 'Europe/Berlin'),
  ])('raw duration is invariant across the zone it is rendered in', (durationS, tz) => {
    const start = '2026-03-08T05:00:00Z'; // straddles a US DST change in local zones
    const end = new Date(Date.parse(start) + durationS * 1000).toISOString();
    // Rendering in any zone is display only; the duration is fixed UTC math.
    renderLocal(start, { timeZone: tz });
    expect(secondsBetween(start, end)).toBe(durationS);
  });
});

describe('PROP: rounding is display/export-only and to the nearest increment (§09 R04)', () => {
  test.prop([fc.integer({ min: 0, max: 1_000_000 }), fc.constantFrom(6, 10, 15, 30)])(
    'rounded value is the nearest multiple of the increment (the "rounding display/export-only" half of §09 R04)',
    (seconds, inc) => {
      const step = inc * 60;
      const rounded = roundSeconds(seconds, inc);
      expect(rounded % step).toBe(0);
      // No other multiple is strictly closer.
      expect(Math.abs(rounded - seconds)).toBeLessThanOrEqual(step / 2);
    },
  );
});
