/**
 * PROP — `app_state` durability (PRD §20 R07; acceptance.html §20 → PROP).
 *
 * The reconciliation/schedule state in `app_state` (the check-in schedule under
 * `checkin_state`, the last-seen heartbeat under `last_seen_utc`) MUST be written in the
 * SAME transaction as the entry write that changes it, so a crash can never leave the open
 * entry and its schedule state divergent. These properties pin that contract three ways,
 * all against a REAL on-disk temp database (a `:memory:` store would hide the cross-
 * connection durability the requirement is actually about):
 *
 *   1. CONSISTENCY after every committed op — over random start/stop/add/resume/gap
 *      sequences, after each op the persisted app_state agrees with the entry table: if an
 *      entry is open then `checkin_state` is present and anchored at the open entry's start;
 *      if nothing is open then `checkin_state` is absent. The schedule never drifts.
 *   2. ATOMICITY on a forced mid-transaction failure — when a transition throws inside its
 *      tx (an `add` with to<=from, a `stop` before start), the on-disk app_state is BYTE-
 *      IDENTICAL to before the failed call: the schedule write and the entry write commit-
 *      or-rollback as one unit, so a partial write is impossible.
 *   3. DURABILITY across connections (simulated relaunch) — reopening the Store on the same
 *      file yields exactly the `checkinState()` that was committed, proving the schedule
 *      survives the process boundary the GUI relaunch crosses.
 */
import { describe, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, openDb, toUtc, type Clock, type CheckinState } from '@stint/core';

const BASE = Date.parse('2026-04-01T09:00:00Z');

/** A clock whose "now" can be repointed, so a generated op-sequence advances time. */
function settableClock(startMs: number): { clock: Clock; set: (ms: number) => void } {
  let nowMs = startMs;
  return { clock: () => new Date(nowMs), set: (ms) => (nowMs = ms) };
}

/**
 * Run `fn` against a throwaway, FILE-backed Store on its own temp dir (a `:memory:` store
 * would hide the cross-connection durability §20 R07 is about), cleaning up the dir afterward.
 * Each property iteration owns its own database, so iterations never leak temp dirs into one
 * another — important because fast-check runs many iterations inside one test body.
 */
function withFreshStore(clock: Clock, fn: (store: Store, path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'stint-appstate-prop-'));
  const path = join(dir, 'tt.sqlite');
  const store = Store.open({ path, clock });
  try {
    fn(store, path);
  } finally {
    try {
      store.close();
    } catch {
      /* already closed */
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The op alphabet the sequence property draws from. */
type Op =
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'add' }
  | { kind: 'resume' }
  | { kind: 'gap'; minutes: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.constant<Op>({ kind: 'start' }),
  fc.constant<Op>({ kind: 'stop' }),
  fc.constant<Op>({ kind: 'add' }),
  fc.constant<Op>({ kind: 'resume' }),
  fc.integer({ min: 1, max: 600 }).map((minutes) => ({ kind: 'gap', minutes }) as Op),
);

/**
 * Read committed state through a FRESH raw connection on the same file (a `openDb`, NOT a
 * Store.open — we want the durable cross-connection bytes without the launch backup /
 * integrity overhead Store.open carries). Returns the open entry's start (or null) and the
 * persisted schedule (or null), straight off `entry` / `app_state`.
 */
function readCommitted(path: string): {
  openStartUtc: string | null;
  schedule: CheckinState | null;
} {
  const db = openDb(path);
  try {
    const open = db.prepare('SELECT start_utc FROM entry WHERE end_utc IS NULL').get() as
      | { start_utc: string }
      | undefined;
    const sched = db.prepare("SELECT value FROM app_state WHERE key = 'checkin_state'").get() as
      | { value: string }
      | undefined;
    return {
      openStartUtc: open?.start_utc ?? null,
      schedule: sched ? (JSON.parse(sched.value) as CheckinState) : null,
    };
  } finally {
    db.close();
  }
}

/**
 * The invariant under test: the persisted app_state is consistent with the entry table.
 * Read across the connection boundary (durability), not a cached in-process value.
 */
function assertConsistent(path: string): void {
  const { openStartUtc, schedule } = readCommitted(path);
  if (openStartUtc !== null) {
    // An entry is open: the schedule MUST be present and anchored at the open entry's start.
    expect(schedule, 'open entry must have a persisted check-in schedule').not.toBeNull();
    expect(schedule!.startUtc).toBe(openStartUtc);
  } else {
    // Nothing open: the schedule MUST be absent (a schedule with nothing running is stale).
    expect(schedule, 'no open entry must mean no persisted check-in schedule').toBeNull();
  }
}

describe('PROP: app_state stays consistent with the entry table after every committed op (§20 R07)', () => {
  test.prop([fc.array(opArb, { minLength: 1, maxLength: 25 })])(
    'open ⇒ schedule present & anchored at start; idle ⇒ schedule absent — across reopens',
    // Each fast-check iteration owns a fresh FILE-backed Store and reads back through a fresh
    // connection after every op (the integrity-checked openDb the durability contract requires).
    // That real disk I/O, multiplied across the run, legitimately overruns the 5s default on a
    // slower box — raise the budget so the property never flakes on machine speed. The
    // assertions are unchanged; only the time allowance is widened.
    (ops) => {
      const { clock, set } = settableClock(BASE);
      withFreshStore(clock, (store, path) => {
        let nowMs = BASE;
        for (const op of ops) {
          // Advance the clock a little before each op so successive starts/adds get distinct,
          // monotonically increasing instants (a stop is never before its own start).
          nowMs += 60_000;
          set(nowMs);
          switch (op.kind) {
            case 'start':
              store.start();
              break;
            case 'stop':
              // stop throws when nothing is running; that is not an op that changes state, so
              // swallow it — the consistency check after still holds (idle ⇒ no schedule).
              try {
                store.stop();
              } catch {
                /* nothing running */
              }
              break;
            case 'add': {
              // A closed backfill that does NOT touch the open schedule (a window in the past).
              const from = toUtc(new Date(nowMs - 120_000));
              const to = toUtc(new Date(nowMs - 60_000));
              store.add({ description: 'backfill', fromUtc: from, toUtc: to });
              break;
            }
            case 'resume':
              try {
                store.resume();
              } catch {
                /* no entry to resume yet */
              }
              break;
            case 'gap':
              // A pure wall-clock advance (no write): the schedule must remain valid as-is.
              nowMs += op.minutes * 60_000;
              set(nowMs);
              break;
          }
          // After EVERY committed op, the persisted state agrees with the entry table — read
          // back through a fresh connection so this also exercises cross-connection durability.
          assertConsistent(path);
        }
      });
    },
    30_000,
  );
});

describe('PROP: a transition that fails mid-tx leaves app_state byte-identical (§20 R07 atomicity)', () => {
  test.prop([fc.boolean()])(
    'add(to<=from) and stop-when-idle roll back the schedule write with the entry write',
    (startFirst) => {
      const { clock, set } = settableClock(BASE);
      withFreshStore(clock, (store, path) => {
        if (startFirst) {
          // Establish an open entry + its atomically-seeded schedule.
          set(BASE + 60_000);
          store.start();
        }
        // Snapshot the persisted app_state (the durable bytes) BEFORE the doomed call.
        const before = readAppState(path);

        // A doomed `add`: to <= from is rejected, the entry + any schedule write never land.
        const at = toUtc(new Date(BASE + 120_000));
        expect(() => store.add({ description: 'bad', fromUtc: at, toUtc: at })).toThrow();

        if (startFirst) {
          // A doomed backdated `stop` (at < the open entry's start) throws INSIDE the tx, after
          // BEGIN IMMEDIATE: the rollback must leave the seeded schedule exactly as it was.
          expect(() => store.stop({ atUtc: toUtc(new Date(BASE)) })).toThrow();
        } else {
          // A doomed `stop` with nothing running throws inside its tx; nothing must persist.
          expect(() => store.stop()).toThrow();
        }

        const after = readAppState(path);
        // Byte-for-byte identical: the failed transition wrote nothing durable (full rollback).
        expect(after).toEqual(before);
      });
    },
    // Real file-backed stores + fresh read-back connections per iteration: widen the budget past
    // the 5s default so disk speed can't flake the run. Assertions unchanged.
    30_000,
  );
});

describe('PROP: a reopened Store yields the committed checkinState (§20 R07 durability)', () => {
  test.prop([fc.integer({ min: 1, max: 100_000 })])(
    'start then relaunch sees the same schedule anchor that was committed',
    (offsetMs) => {
      const startMs = BASE + offsetMs;
      const { clock } = settableClock(startMs);
      withFreshStore(clock, (store, path) => {
        const view = store.start().value;
        const sched = store.checkinState();
        expect(sched).not.toBeNull();
        expect(sched!.startUtc).toBe(view.startUtc);
        const committed = sched!.startUtc;

        // Simulated relaunch: a brand-new connection on the same file sees the same schedule.
        // (The original handle stays open — node:sqlite WAL allows the second reader; the
        // committed schedule must be visible across the connection boundary regardless.)
        const reopened = Store.open({ path, clock });
        try {
          const after = reopened.checkinState();
          expect(after, 'committed schedule must survive relaunch').not.toBeNull();
          expect(after!.startUtc).toBe(committed);
          expect(reopened.openEntry()).not.toBeNull();
        } finally {
          reopened.close();
        }
      });
    },
    // A fresh file-backed Store plus a simulated-relaunch reopen per iteration is real disk I/O;
    // widen the budget past the 5s default so machine speed can't flake the run. Assertions unchanged.
    30_000,
  );
});

/**
 * Read the durable app_state rows (the schedule + last-seen) through a FRESH raw connection,
 * as a stable array — the byte-level snapshot the atomicity property compares.
 */
function readAppState(path: string): [string, string | null][] {
  const db = openDb(path);
  try {
    const get = (key: string): string | null =>
      (db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as
        | { value: string }
        | undefined)?.value ?? null;
    return [
      ['checkin_state', get('checkin_state')],
      ['last_seen_utc', get('last_seen_utc')],
    ];
  } finally {
    db.close();
  }
}
