/**
 * Integration — cross-surface agreement and concurrency (§17 R1, R2; PRD §04).
 *
 * These exercise the real WAL database file shared by tt processes and a direct
 * @stint/core reader, proving the two surfaces never disagree and that at most one
 * entry is ever open even under rapid, concurrent start/stop from many processes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '@stint/core';

const execFileP = promisify(execFile);
const BIN = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));

let dir: string;
let db: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stint-int-'));
  db = join(dir, 'tt.sqlite');
  return () => rmSync(dir, { recursive: true, force: true });
});

function tt(args: string[]): { out: string; code: number } {
  const res = spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TT_DB: db, NODE_NO_WARNINGS: '1' },
  });
  return { out: (res.stdout ?? '').trim(), code: res.status ?? 0 };
}

describe('§17 R1: a timer started in tt is visible to a core reader, no disagreement', () => {
  it('tt status and a direct Store.open agree on the open entry', () => {
    tt(['start', 'auth refactor', '--client', 'Client A', '--at', '2026-06-24T09:00:00Z']);

    // The other surface opens the same file and sees the same truth.
    const store = Store.open({ path: db });
    const open = store.openEntry();
    expect(open).not.toBeNull();
    expect(open!.description).toBe('auth refactor');
    expect(open!.clientName).toBe('Client A');

    // And tt --json reports the same id.
    const status = JSON.parse(tt(['status', '--json']).out) as { entry: { id: number } };
    expect(status.entry.id).toBe(open!.id);
    store.close();
  });

  it('a write through core is immediately visible to tt', () => {
    const store = Store.open({ path: db });
    const { value } = store.start({ description: 'from core', atUtc: '2026-06-24T09:00:00Z' });
    store.close();

    const status = JSON.parse(tt(['status', '--json']).out) as {
      running: boolean;
      entry: { id: number; description: string };
    };
    expect(status.running).toBe(true);
    expect(status.entry.id).toBe(value.id);
    expect(status.entry.description).toBe('from core');
  });
});

describe('§17 R2: at most one entry open under concurrent start/stop from many processes', () => {
  it('20 concurrent tt starts all succeed, cooperating via busy-timeout (no SQLITE_BUSY)', async () => {
    // Establish the database first so all racers share a ready WAL file.
    tt(['client', 'add', 'Client A']);

    // The cooperation mechanism is the SQLite busy timeout: under BEGIN IMMEDIATE a
    // contended writer *waits its turn* (up to the timeout) instead of erroring. Give
    // the racers a generous timeout so the queue of 20 always drains before it — this
    // is what makes "everyone succeeds" a guarantee rather than a timing accident
    // (the default 5 s can be exhausted on a heavily oversubscribed CI runner).
    const raceEnv = { ...process.env, TT_DB: db, NODE_NO_WARNINGS: '1', TT_BUSY_TIMEOUT_MS: '30000' };
    const launches = Array.from({ length: 20 }, (_, i) =>
      execFileP('node', [BIN, 'start', `race ${i}`, '--client', 'Client A'], { env: raceEnv }).then(
        () => ({ ok: true as const, err: '' }),
        (e: { stderr?: string; message?: string }) => ({
          ok: false as const,
          err: e.stderr || e.message || 'unknown',
        }),
      ),
    );
    const results = await Promise.all(launches);
    const failures = results.filter((r) => !r.ok);

    // Given an adequate busy timeout, every one of the 20 succeeds and none bounces
    // with SQLITE_BUSY / "database is locked".
    expect(failures.map((f) => f.err)).toEqual([]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => /SQLITE_BUSY|database is locked/.test(r.err))).toEqual([]);

    // And the invariant holds: exactly one open entry, DB readable, all 20 recorded
    // (each start closes the prior open one before opening its own).
    const store = Store.open({ path: db });
    const openCount = store.listEntries().filter((e) => e.endUtc === null).length;
    expect(openCount).toBe(1);
    expect(store.listEntries().length).toBe(20);
    store.close();
  });

  it('interleaved start/stop never opens a second entry', async () => {
    tt(['client', 'add', 'Client A']);
    const ops: Promise<string>[] = [];
    for (let i = 0; i < 10; i++) {
      ops.push(
        execFileP('node', [BIN, 'start', `t${i}`], { env: { ...process.env, TT_DB: db, NODE_NO_WARNINGS: '1' } }).then(
          () => 'ok',
          () => 'err',
        ),
      );
      ops.push(
        execFileP('node', [BIN, 'stop'], { env: { ...process.env, TT_DB: db, NODE_NO_WARNINGS: '1' } }).then(
          () => 'ok',
          () => 'err',
        ),
      );
    }
    await Promise.all(ops);
    const store = Store.open({ path: db });
    expect(store.listEntries().filter((e) => e.endUtc === null).length).toBeLessThanOrEqual(1);
    store.close();
  });
});
