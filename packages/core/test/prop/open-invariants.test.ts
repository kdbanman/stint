/**
 * PROP — DB-open durability invariants over generated open options (acceptance.html §07).
 *
 * Where the GOLD contract pins one on-disk open, this property asserts the §20 R01 invariant
 * holds for ANY caller-supplied busy timeout: after `openDb(path, { busyTimeoutMs })` on a
 * file-backed database, the four durability pragmas are always enforced —
 *
 *   journal_mode === 'wal'        (concurrent readers, single writer; §04/§20 R01)
 *   foreign_keys === 1            (the integrity defense the §13 FKs rely on)
 *   busy_timeout === requested    (the cooperative lock wait, exactly as asked)
 *   synchronous === 2 (FULL)      (committed writes survive power loss; §20 R01)
 *
 * The point: the durability pragmas are set AND verified independent of the open option, so no
 * busyTimeoutMs value can leave a database opened without WAL / FK / FULL durability.
 */
import { describe, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '@stint/core';

const SYNCHRONOUS_FULL = 2; // PRAGMA synchronous numeric level for FULL

function pragma(db: Db, name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
  return Object.values(row)[0];
}

describe('PROP: DB-open durability pragmas are enforced for any busy timeout (§20 R01)', () => {
  test.prop([fc.integer({ min: 1, max: 600_000 })])(
    'every generated busyTimeoutMs yields wal / fk=1 / the requested busy_timeout / FULL',
    (busyTimeoutMs) => {
      const dir = mkdtempSync(join(tmpdir(), 'stint-prop-open-'));
      let db: Db | undefined;
      try {
        db = openDb(join(dir, 'stint.db'), { busyTimeoutMs });
        expect(String(pragma(db, 'journal_mode')).toLowerCase()).toBe('wal');
        expect(Number(pragma(db, 'foreign_keys'))).toBe(1);
        expect(Number(pragma(db, 'busy_timeout'))).toBe(busyTimeoutMs);
        expect(Number(pragma(db, 'synchronous'))).toBe(SYNCHRONOUS_FULL);
      } finally {
        db?.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
