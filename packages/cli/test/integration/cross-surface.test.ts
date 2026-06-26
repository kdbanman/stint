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
  it('20 concurrent tt starts leave exactly one open entry, no corruption', async () => {
    // Establish the database first so all racers share a ready WAL file.
    tt(['client', 'add', 'Client A']);

    const launches = Array.from({ length: 20 }, (_, i) =>
      execFileP('node', [BIN, 'start', `race ${i}`, '--client', 'Client A'], {
        env: { ...process.env, TT_DB: db, NODE_NO_WARNINGS: '1' },
      }).then(
        () => 'ok',
        () => 'err',
      ),
    );
    const results = await Promise.all(launches);
    const ok = results.filter((r) => r === 'ok').length;
    expect(ok).toBeGreaterThan(0);

    // The invariant: never more than one open entry, and the DB is readable.
    const store = Store.open({ path: db });
    const openCount = store.listEntries().filter((e) => e.endUtc === null).length;
    expect(openCount).toBe(1);
    // Every successful start added exactly one entry (each closes the prior open one).
    expect(store.listEntries().length).toBe(ok);
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
