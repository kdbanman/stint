/**
 * PROP — the §20 R12 database-location-change pipeline's loss-protection invariants
 * (acceptance.html §07), over generated {seeded entries × mode × destination state}.
 *
 * The pipeline may only ADD copies — checkpoint → backup at the old home → copy → verify
 * → atomic config commit — so three invariants must hold for EVERY generated run,
 * success or refusal:
 *
 *   1. THE OLD DATABASE IS PRESERVED after any outcome. On a refusal the old file is
 *      byte-identical to before the call (nothing ran, nothing wrote). On a success the
 *      only sanctioned mutation is the pipeline's own WAL fold, so the old file is
 *      byte-identical to the pre-change backup it just wrote (a true copy) AND reopening
 *      the old path independently reads back exactly the seeded entries.
 *   2. THE CONFIG FILE IS UNTOUCHED ON ANY FAILURE — byte-for-byte, absent stays absent
 *      — and on success it points `dbPath` at the destination with no other key changed.
 *   3. A DESTINATION NEVER BECOMES LIVE WITHOUT PASSING ITS GATES. The expected outcome
 *      is derivable from {mode × destination state} — migrate: only an absent file at a
 *      live parent succeeds; start fresh: absent starts fresh, a healthy current-or-older
 *      database is adopted, and a foreign/corrupt/future-stamped file or a dead parent
 *      refuses — and whenever the config commits, the committed destination actually
 *      passes the integrity + schema-version gates (or is the absent-with-live-parent
 *      first-run case).
 */
import { describe, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  Store,
  StorageChangeError,
  openDb,
  checkIntegrity,
  writeConfig,
  SCHEMA_VERSION,
  type DbChangeMode,
  type DbChangeOutcome,
} from '@stint/core';

const NOW = new Date('2026-06-24T12:00:00Z');

/** The generated destination states — each drives a different gate of the pipeline. */
type DestState = 'absent' | 'missing-parent' | 'foreign' | 'healthy' | 'corrupt' | 'future';

/** What §20 R12 says must happen for {mode × destination state} — the property's oracle. */
function expectedOutcome(mode: DbChangeMode, dest: DestState): DbChangeOutcome | 'refused' {
  if (dest === 'missing-parent') return 'refused';
  if (mode === 'migrate') return dest === 'absent' ? 'migrated' : 'refused';
  if (dest === 'absent') return 'started-fresh';
  return dest === 'healthy' ? 'adopted' : 'refused';
}

/** Seed the destination role file (inside `home` for the live-parent states). */
function seedDest(home: string, dest: DestState): string {
  // `gone/` is never created — that absence IS the missing-parent state.
  if (dest === 'missing-parent') return join(home, 'gone', 'tt.sqlite');
  mkdirSync(join(home, 'new-home'), { recursive: true });
  const path = join(home, 'new-home', 'tt.sqlite');
  if (dest === 'absent') return path;
  if (dest === 'foreign') {
    writeFileSync(path, 'opaque bytes that are not a database\n');
    return path;
  }
  // The remaining states start from a REAL database so the gates judge real headers.
  const db = openDb(path);
  db.exec(
    "INSERT INTO entry (description, start_utc, end_utc, billable) VALUES " +
      "('resident', '2026-06-23T09:00:00Z', '2026-06-23T10:00:00Z', 1)",
  );
  if (dest === 'future') db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  db.close();
  if (dest === 'corrupt') {
    // Clobber the 16-byte "SQLite format 3\0" magic — guaranteed-detectable damage.
    const fd = openSync(path, 'r+');
    try {
      writeSync(fd, Buffer.from('xxxxxxxxxxxxxxxx'), 0, 16, 0);
    } finally {
      closeSync(fd);
    }
  }
  return path;
}

/** The entry rows at a database path, read through an independent fresh handle. */
function entriesAt(path: string): unknown[] {
  const db = openDb(path);
  try {
    return db.prepare('SELECT description, start_utc, end_utc FROM entry ORDER BY id').all();
  } finally {
    db.close();
  }
}

// File-heavy like open-invariants: each run builds a real store + destination on disk.
const FS_PROP_RUNS = 30;
const FS_PROP_TIMEOUT_MS = 60_000;

describe('PROP: the §20 R12 change pipeline preserves the old database, the config, and the gates', () => {
  test.prop(
    [
      fc.constantFrom<DbChangeMode>('migrate', 'start-fresh'),
      fc.constantFrom<DestState>(
        'absent',
        'missing-parent',
        'foreign',
        'healthy',
        'corrupt',
        'future',
      ),
      // 0–3 seeded closed entries at generated hours — the data the old home must keep.
      fc.array(fc.integer({ min: 0, max: 11 }), { minLength: 0, maxLength: 3 }),
      // Whether the config file already existed (with an unrelated key to preserve).
      fc.boolean(),
    ],
    { numRuns: FS_PROP_RUNS },
  )(
    'for any {mode × destination × data}: old DB preserved, config atomic, gates decide liveness',
    (mode, dest, startHours, priorConfig) => {
      const home = mkdtempSync(join(tmpdir(), 'stint-prop-change-'));
      let store: Store | undefined;
      try {
        const oldDb = join(home, 'old', 'tt.sqlite');
        const backupDir = join(home, 'old'); // the default rung: beside the database
        const configFile = join(home, 'config.json');
        if (priorConfig) writeConfig(configFile, { backupDir });
        store = Store.open({ path: oldDb, backupDir, clock: () => NOW });
        for (const [i, h] of startHours.entries()) {
          store.add({
            description: `seed ${i}`,
            fromUtc: `2026-06-2${1 + (i % 3)}T${String(h).padStart(2, '0')}:00:00Z`,
            toUtc: `2026-06-2${1 + (i % 3)}T${String(h + 1).padStart(2, '0')}:00:00Z`,
          });
        }
        const newDb = seedDest(home, dest);
        const entriesBefore = entriesAt(oldDb);
        const oldBytesBefore = readFileSync(oldDb);
        const configBefore = existsSync(configFile) ? readFileSync(configFile, 'utf8') : null;

        let outcome: DbChangeOutcome | 'refused';
        try {
          outcome = store.changeDbLocation({ newDbPath: newDb, mode, configFile }).outcome;
        } catch (err) {
          // Only the typed refusal is a legal failure; anything else fails the property.
          expect(err).toBeInstanceOf(StorageChangeError);
          outcome = 'refused';
        }

        // Invariant 3 (oracle half): the outcome is exactly what the gates dictate.
        expect(outcome).toBe(expectedOutcome(mode, dest));

        const configAfter = existsSync(configFile) ? readFileSync(configFile, 'utf8') : null;
        if (outcome === 'refused') {
          // Invariant 1 (refusal): the old main file is byte-identical — the pipeline
          // refused before any stage ran, so not even its WAL fold happened.
          expect(readFileSync(oldDb).equals(oldBytesBefore)).toBe(true);
          // Invariant 2 (refusal): the config file byte-for-byte as before (absent stays absent).
          expect(configAfter).toBe(configBefore);
        } else {
          // Invariant 2 (success): dbPath now points at the destination; a pre-existing
          // unrelated key survives the atomic rewrite.
          const config = JSON.parse(configAfter!) as { dbPath?: string; backupDir?: string };
          expect(config.dbPath).toBe(newDb);
          if (priorConfig) expect(config.backupDir).toBe(backupDir);
          // Invariant 1 (success): the old file is byte-identical to the pre-change backup
          // it just wrote (copy-never-delete, and the backup is a true copy)…
          const latest = store.listBackups()[0]!;
          expect(latest).toBeDefined();
          expect(readFileSync(oldDb).equals(readFileSync(latest.path))).toBe(true);
          // …and an independent reopen of the old path reads back exactly the seeded rows.
          expect(entriesAt(oldDb)).toEqual(entriesBefore);
          // Invariant 3 (liveness half): whatever the config now points at passes its
          // gates — an existing file is a healthy database at or below this binary's
          // schema; the started-fresh case is the absent-file-with-live-parent first-run.
          if (outcome === 'started-fresh') {
            expect(existsSync(newDb)).toBe(false); // created by the relaunch, not the pipeline
          } else {
            const live = new DatabaseSync(newDb);
            try {
              const version = (live.prepare('PRAGMA user_version').get() as { user_version: number })
                .user_version;
              expect(version).toBeLessThanOrEqual(SCHEMA_VERSION);
              expect(checkIntegrity(live).ok).toBe(true);
            } finally {
              live.close();
            }
          }
          if (outcome === 'migrated') {
            // The copy carries the data: the migrated home reads back the same rows.
            expect(entriesAt(newDb)).toEqual(entriesBefore);
          }
        }
      } finally {
        store?.close();
        rmSync(home, { recursive: true, force: true });
      }
    },
    FS_PROP_TIMEOUT_MS,
  );
});
