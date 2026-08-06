/**
 * INTEGRATION — restoring a pre-v4 backup survives the sleep_span source CHECK (§20 R05 + #180).
 *
 * The v3→v4 migration adds `CHECK(source IN ('event','gap','unknown'))` to sleep_span. A
 * constraint that refused a database carrying an out-of-union `source` would break the one
 * recovery path §20 R05 promises — restore from an older backup — for a value the app itself
 * may have written pre-v4. The migration therefore coerces such a value to 'unknown' during
 * the table rebuild, and this suite is the behavioral proof: a genuinely v3-shaped backup
 * (sleep_span WITHOUT the CHECK, holding one out-of-union row) is restored through the real
 * `Store.restoreFromBackup` seam, and comes out a working v4 database — version stamped
 * forward, in-union rows byte-identical, the out-of-union row coerced (never lost), and the
 * CHECK live for subsequent writes.
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, Store } from '@stint/core';

const NOW = new Date('2026-06-24T12:00:00Z');
const clock = () => NOW;

describe('INTEGRATION: restoring a pre-v4 backup (§20 R05, #180)', () => {
  it('a v3 backup with an out-of-union sleep source restores, migrates, and coerces it to unknown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-restore-v3-'));
    try {
      const dbPath = join(dir, 'timetracker.sqlite');

      // Build the v3-shaped backup: a current DB rolled back to v3 — sleep_span rebuilt
      // WITHOUT the CHECK so it can hold 'powerd', an out-of-union source no v4 binary
      // could write, exactly what a restore from an old backup can carry in.
      const seedPath = join(dir, 'seed.sqlite');
      const seed = openDb(seedPath);
      seed.exec("INSERT INTO client(name) VALUES('Acme')");
      seed.exec(
        "INSERT INTO entry(client_id, description, start_utc, end_utc) " +
          "VALUES(1, 'deep work', '2026-06-23T09:00:00Z', '2026-06-23T11:00:00Z')",
      );
      seed.exec(
        'CREATE TABLE sleep_span_old (id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
          'entry_id INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE, ' +
          'sleep_utc TEXT NOT NULL, wake_utc TEXT NOT NULL, source TEXT NOT NULL)',
      );
      seed.exec('INSERT INTO sleep_span_old SELECT * FROM sleep_span');
      seed.exec('DROP TABLE sleep_span');
      seed.exec('ALTER TABLE sleep_span_old RENAME TO sleep_span');
      seed.exec(
        "INSERT INTO sleep_span(entry_id, sleep_utc, wake_utc, source) VALUES" +
          "(1, '2026-06-23T09:30:00Z', '2026-06-23T09:45:00Z', 'event')," +
          "(1, '2026-06-23T10:00:00Z', '2026-06-23T10:10:00Z', 'powerd')",
      );
      seed.exec('PRAGMA user_version = 3');
      seed.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      seed.close();
      const backupName = 'timetracker.sqlite.bak-20260101T000000Z';
      copyFileSync(seedPath, join(dir, backupName));

      // A live v4 store beside that backup — the user's current database.
      const store = Store.open({ path: dbPath, clock });

      // The §20 R05 seam: restore the old backup by name. This must NOT throw — the
      // reopen migrates the restored file to v4 instead of rejecting it.
      store.restoreFromBackup(backupName);

      // The restored store serves the old data: the in-union span is untouched, the
      // out-of-union one is coerced to 'unknown' — no row lost.
      const spans = store.sleepSpansFor(1);
      expect(spans.map((s) => ({ id: s.id, source: s.source }))).toEqual([
        { id: 1, source: 'event' },
        { id: 2, source: 'unknown' },
      ]);
      store.close();

      // And the restored file is a real v4 database: version stamped forward, CHECK live.
      const raw = new DatabaseSync(dbPath);
      const v = raw.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(v.user_version).toBe(4);
      expect(() =>
        raw.exec(
          "INSERT INTO sleep_span(entry_id, sleep_utc, wake_utc, source) " +
            "VALUES(1, '2026-06-23T10:20:00Z', '2026-06-23T10:25:00Z', 'powerd')",
        ),
      ).toThrow(/CHECK/);
      raw.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
