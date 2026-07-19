/**
 * INTEGRATION — the cross-connection lock-contention behaviour behind the busy-timeout
 * cooperation claim (README.md "each write is one BEGIN IMMEDIATE transaction with a busy
 * timeout, so the CLI and the running app cooperate"; architecture.html §04).
 *
 * Everywhere else that claim is only INSPECTED, never RACED: `open-invariants.test.ts` and
 * `contracts.test.ts` assert `busy_timeout` is *configured*, and the one-open-entry index
 * enforces the money invariant regardless of races — but no test ever puts TWO connections in
 * contention over one file, so a refactor that dropped `BEGIN IMMEDIATE` or shrank the busy
 * timeout to zero would ship green and only surface later as a raw "database is locked" in the
 * middle of real use. This suite is the missing behavioral evidence: a SECOND in-process
 * connection deterministically HOLDS the write lock (held-lock injection — no timing luck, no
 * spawned helper process) while the store's own `BEGIN IMMEDIATE` write path contends for it.
 * The cross-process story is verified at the SQLite-file level: two connections, one file,
 * identical lock semantics whether the second connection lives in another thread or another OS
 * process (owner decision on issue #89).
 *
 * Two halves, one per direction of the cooperation contract:
 *
 *   (a) WAITS-AND-SUCCEEDS within busy_timeout — a concurrent write blocks while the holder has
 *       the lock and then COMMITS on its own once the holder releases, provided the release
 *       lands inside the busy-timeout window. Proven with a worker-thread holder that takes
 *       BEGIN IMMEDIATE, signals readiness over a SharedArrayBuffer (the handshake is the
 *       synchronisation — never a sleep), holds for a bounded HOLD_MS < busy_timeout, then
 *       commits. This is the half that would REGRESS if busy_timeout were set to 0.
 *
 *   (b) PAST-TIMEOUT hold surfaces the intended error path — when the hold OUTLIVES the busy
 *       timeout, the write fails with the SQLITE_BUSY shape a user would see (`code`
 *       ERR_SQLITE_ERROR, `errcode` 5, message "database is locked") rather than hanging or
 *       crashing some other way; and once the holder commits, a retry succeeds. Proven fully
 *       single-threaded: the holder is a raw second connection on THIS thread, so it cannot
 *       possibly release during the store's synchronous wait — the busy failure is guaranteed,
 *       not raced. This half PINS the error shape so a refactor cannot silently change what
 *       SQLITE_BUSY looks like to a user.
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@stint/core';

const FIXED_NOW = '2026-06-24T12:00:00Z';
const clock = () => new Date(FIXED_NOW);

/** SQLITE_BUSY primary result code — what a past-timeout lock wait resolves to. */
const SQLITE_BUSY = 5;

function tempDbPath(prefix: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, path: join(dir, 'stint.db') };
}

/**
 * The held-lock injection for half (a): a worker thread that opens a SECOND connection to the
 * same file, takes BEGIN IMMEDIATE (materialised with a real INSERT so the write lock is
 * unambiguously held), publishes readiness by storing 1 into the shared flag and notifying, then
 * holds the lock for exactly `holdMs` before committing and closing. The hold is a bounded
 * Atomics.wait timeout on a slot nobody else writes — a deterministic lock-hold DURATION under
 * test, distinct from the readiness HANDSHAKE (the flag store/notify) the main thread waits on.
 */
const HOLDER_WORKER_SRC = `
const { workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const { path, sab, holdMs } = workerData;
const flags = new Int32Array(sab);
const db = new DatabaseSync(path);
db.exec('PRAGMA busy_timeout = 1000');
db.exec('BEGIN IMMEDIATE');
db.exec("INSERT INTO setting(key, value) VALUES('__lock_holder__', '1')");
// Handshake: tell the main thread the write lock is now held.
Atomics.store(flags, 0, 1);
Atomics.notify(flags, 0);
// Hold the lock for a bounded, deterministic duration, then release. Nothing ever changes
// flags[0] back to a value other than 1, so this wait always runs its full timeout — the lock
// is provably held for holdMs, not for a racy "roughly holdMs".
Atomics.wait(flags, 0, 1, holdMs);
db.exec('COMMIT');
db.close();
`;

describe('INTEGRATION: cross-connection busy-timeout cooperation over one SQLite file (README / architecture §04)', () => {
  it('(a) a concurrent write WAITS while a second connection holds the lock, then SUCCEEDS once it commits within busy_timeout', async () => {
    const { dir, path } = tempDbPath('stint-lock-wait-');
    // Generous busy timeout: the holder releases well inside it, so the store's write must
    // cooperate (wait, then commit). If busy_timeout were 0 this half would fail — the write
    // would refuse instantly instead of waiting — which is exactly the regression it guards.
    const BUSY_TIMEOUT_MS = 5000;
    const HOLD_MS = 250;
    const store = Store.open({ path, clock, busyTimeoutMs: BUSY_TIMEOUT_MS });
    let worker: Worker | undefined;
    try {
      // Create the file + schema and leave no lock held (the seed write commits).
      store.add({
        description: 'seed',
        fromUtc: '2026-06-24T09:00:00Z',
        toUtc: '2026-06-24T10:00:00Z',
      });

      const flags = new Int32Array(new SharedArrayBuffer(4)); // slot 0 = holder-has-lock flag
      worker = new Worker(HOLDER_WORKER_SRC, {
        eval: true,
        workerData: { path, sab: flags.buffer, holdMs: HOLD_MS },
      });
      const workerExit = new Promise<void>((resolve, reject) => {
        worker!.on('exit', () => resolve());
        worker!.on('error', reject);
      });

      // Block until the worker has actually acquired the write lock (the handshake — not a
      // sleep). Only then does the store attempt its write, so the lock is GUARANTEED held at
      // the moment contention begins; the wait that follows is real, not luck.
      Atomics.wait(flags, 0, 0);

      const startedAt = Date.now();
      const { value: entry } = store.add({
        description: 'contended write',
        fromUtc: '2026-06-24T10:00:00Z',
        toUtc: '2026-06-24T11:00:00Z',
      });
      const waitedMs = Date.now() - startedAt;

      // It SUCCEEDED (cooperated) rather than throwing SQLITE_BUSY...
      expect(entry.id).toBeGreaterThan(0);
      expect(store.getEntry(entry.id)?.description).toBe('contended write');
      // ...and it genuinely WAITED for the holder: the write cannot return before the holder's
      // COMMIT, which is >= HOLD_MS after readiness. The lower bound is causally guaranteed (the
      // slack only absorbs sub-millisecond wake latency), so this is not a timing gamble.
      expect(waitedMs).toBeGreaterThanOrEqual(HOLD_MS - 100);
      // ...and it finished inside the cooperation window.
      expect(waitedMs).toBeLessThan(BUSY_TIMEOUT_MS);

      await workerExit;
    } finally {
      await worker?.terminate();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(b) a hold that OUTLIVES busy_timeout surfaces the SQLITE_BUSY error path, and a retry SUCCEEDS once the holder commits', () => {
    const { dir, path } = tempDbPath('stint-lock-busy-');
    // Tiny busy timeout so the wait — and thus the whole test — is fast. The failure is
    // guaranteed regardless of the exact value: the holder is on THIS thread and cannot release
    // during the store's synchronous wait, so the timeout always elapses with the lock held.
    const BUSY_TIMEOUT_MS = 50;
    const store = Store.open({ path, clock, busyTimeoutMs: BUSY_TIMEOUT_MS });
    // A second in-process connection is the held-lock injection.
    const holder = new DatabaseSync(path);
    try {
      store.add({
        description: 'seed',
        fromUtc: '2026-06-24T09:00:00Z',
        toUtc: '2026-06-24T10:00:00Z',
      });

      holder.exec('PRAGMA busy_timeout = 50');
      holder.exec('BEGIN IMMEDIATE');
      holder.exec("INSERT INTO setting(key, value) VALUES('__lock_holder__', '1')");

      // The store's BEGIN IMMEDIATE write contends for the lock, exhausts busy_timeout, and
      // surfaces the SQLITE_BUSY shape — the exact error a user hits when a write cannot get the
      // lock in time. Pinning it here means a refactor cannot silently change that shape.
      let thrown: (Error & { code?: string; errcode?: number; errstr?: string }) | undefined;
      try {
        store.add({
          description: 'blocked write',
          fromUtc: '2026-06-24T10:00:00Z',
          toUtc: '2026-06-24T11:00:00Z',
        });
      } catch (err) {
        thrown = err as typeof thrown;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown!.code).toBe('ERR_SQLITE_ERROR');
      expect(thrown!.errcode).toBe(SQLITE_BUSY);
      expect(thrown!.message).toMatch(/database is locked/i);

      // The failed write left nothing behind (the transaction never committed).
      expect(store.status().running).toBe(false);
      expect(store.listEntries()).toHaveLength(1); // just the seed

      // Once the holder commits and releases, the very same write cooperates and succeeds —
      // the busy failure was transient contention, not a poisoned store.
      holder.exec('COMMIT');
      const { value: entry } = store.add({
        description: 'retried write',
        fromUtc: '2026-06-24T10:00:00Z',
        toUtc: '2026-06-24T11:00:00Z',
      });
      expect(entry.id).toBeGreaterThan(0);
      expect(store.listEntries()).toHaveLength(2);
    } finally {
      try {
        holder.close();
      } catch {
        /* already closed / committed */
      }
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
