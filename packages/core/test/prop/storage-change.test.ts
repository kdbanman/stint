/**
 * PROP — the §20 R12 database-location-change and §20 R13 backup-directory-change
 * pipelines' loss-protection invariants (acceptance.html §07), over generated
 * {seeded entries × mode × destination state} and
 * {backup set × mode × destination state × injected fault}.
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
  appendFileSync,
  closeSync,
  constants,
  copyFileSync,
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
  backupStamp,
  changeBackupDir,
  openDb,
  checkIntegrity,
  writeConfig,
  SCHEMA_VERSION,
  type BackupDirChangeOutcome,
  type DbChangeMode,
  type DbChangeOutcome,
  type StorageChangeMode,
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

// ---------------------------------------------------------------- §20 R13 backup move

/** The generated destination-directory states — each drives a different gate. */
type BackupDestState = 'live' | 'missing' | 'not-a-dir' | 'collision';

/** The injected mid-move faults — the failures the verify step exists to catch. */
type MoveFault = 'none' | 'copy-throws' | 'torn-copy';

/**
 * What §20 R13 says must happen for {mode × destination × set × fault} — the property's
 * oracle. Gate refusals (a dead destination, a same-name collision) fire before anything
 * is written; a fault aborts the move only when there are backups to move.
 */
function expectedBackupOutcome(
  mode: StorageChangeMode,
  dest: BackupDestState,
  count: number,
  fault: MoveFault,
): BackupDirChangeOutcome | 'refused' {
  if (dest === 'missing' || dest === 'not-a-dir') return 'refused';
  if (mode === 'start-fresh') return 'started-fresh';
  if (dest === 'collision' && count > 0) return 'refused';
  if (fault !== 'none' && count > 0) return 'refused';
  return 'moved';
}

describe('PROP: the §20 R13 backup move never loses a backup, after ANY outcome', () => {
  test.prop(
    [
      fc.constantFrom<StorageChangeMode>('migrate', 'start-fresh'),
      fc.constantFrom<BackupDestState>('live', 'missing', 'not-a-dir', 'collision'),
      // Whether the destination is the DEFAULT rung (beside the database) — the commit
      // that must DELETE the key instead of writing a resolved default (§13).
      fc.boolean(),
      // 0–3 existing backups with generated (distinct-by-construction) contents.
      fc.array(fc.string(), { minLength: 0, maxLength: 3 }),
      fc.constantFrom<MoveFault>('none', 'copy-throws', 'torn-copy'),
      // Which copy the fault strikes (clamped to the set).
      fc.integer({ min: 0, max: 2 }),
    ],
    { numRuns: FS_PROP_RUNS },
  )(
    'for any {mode × destination × set × fault}: every original backup survives, content-identical, in exactly one directory',
    (mode, destRaw, toDefault, contents, fault, faultAtRaw) => {
      const home = mkdtempSync(join(tmpdir(), 'stint-prop-bkmove-'));
      let db: ReturnType<typeof openDb> | undefined;
      try {
        // The default rung's directory (the db's own) always exists, so those destination
        // states cannot arise there; a collision needs a name to collide with.
        const dest: BackupDestState =
          (toDefault && (destRaw === 'missing' || destRaw === 'not-a-dir')) ||
          (destRaw === 'collision' && contents.length === 0)
            ? 'live'
            : destRaw;

        mkdirSync(join(home, 'db'));
        const dbPath = join(home, 'db', 'tt.sqlite');
        db = openDb(dbPath);
        const oldDir = join(home, 'bk-old');
        mkdirSync(oldDir);
        // Distinct fixed stamps (never the fresh backup's NOW stamp), generated contents
        // made distinct by index so byte-identity tracking is per-file.
        const originals = new Map<string, Buffer>(
          contents.map((c, i) => [
            `tt.sqlite.bak-2026062${i}T090000Z`,
            Buffer.from(`${i}:${c}`),
          ]),
        );
        for (const [name, bytes] of originals) writeFileSync(join(oldDir, name), bytes);

        const newDir = toDefault ? join(home, 'db') : join(home, 'bk-new');
        if (!toDefault) {
          if (dest === 'not-a-dir') writeFileSync(newDir, 'a file where a directory should be');
          else if (dest !== 'missing') mkdirSync(newDir);
        }
        const collisionName = [...originals.keys()][0];
        if (dest === 'collision') {
          writeFileSync(join(newDir, collisionName!), 'already here — different bytes');
        }

        const configFile = join(home, 'config.json');
        writeConfig(configFile, { dbPath, backupDir: oldDir });
        const configBefore = readFileSync(configFile, 'utf8');

        const faultAt = Math.min(faultAtRaw, Math.max(contents.length - 1, 0));
        let copyCalls = 0;
        const copyFile = (src: string, dst: string): void => {
          const i = copyCalls++;
          if (fault === 'copy-throws' && i === faultAt) throw new Error('injected copy failure');
          copyFileSync(src, dst, constants.COPYFILE_EXCL);
          if (fault === 'torn-copy' && i === faultAt) appendFileSync(dst, 'torn');
        };

        let outcome: BackupDirChangeOutcome | 'refused';
        try {
          outcome = changeBackupDir(db, {
            dbPath,
            oldBackupDir: oldDir,
            newBackupDir: newDir,
            mode,
            configFile,
            at: NOW,
            ...(fault === 'none' ? {} : { copyFile }),
          }).outcome;
        } catch (err) {
          // Only the typed refusal is a legal failure; anything else fails the property.
          expect(err).toBeInstanceOf(StorageChangeError);
          outcome = 'refused';
        }

        // The oracle half: the outcome is exactly what the gates and the fault dictate.
        expect(outcome).toBe(expectedBackupOutcome(mode, dest, contents.length, fault));

        // THE NO-BACKUP-EVER-LOST INVARIANT: after ANY outcome, every original backup
        // exists, content-identical, in EXACTLY ONE of the old or new directory —
        // moved ⇒ the new one; anything else ⇒ the old one (an aborted run's own copies
        // are rolled back; a collision twin at the destination holds different bytes).
        for (const [name, bytes] of originals) {
          const inOld = existsSync(join(oldDir, name)) && readFileSync(join(oldDir, name)).equals(bytes);
          const inNew = existsSync(join(newDir, name)) && readFileSync(join(newDir, name)).equals(bytes);
          if (outcome === 'moved') {
            expect(inNew).toBe(true);
            expect(existsSync(join(oldDir, name))).toBe(false);
          } else {
            expect(inOld).toBe(true);
            expect(inNew).toBe(false);
          }
        }

        // The fresh backup-before-change: on any outcome where the move phase was
        // reached (success, or a mid-move abort), the checkpointed database's bytes are
        // in the NEW directory under a name outside the original set; a gate refusal
        // wrote nothing at all.
        const freshName = `tt.sqlite.bak-${backupStamp(NOW)}`;
        const gateRefused = outcome === 'refused' && !(fault !== 'none' && dest === 'live');
        if (!gateRefused) {
          expect(readFileSync(join(newDir, freshName)).equals(readFileSync(dbPath))).toBe(true);
        } else if (dest !== 'not-a-dir' && existsSync(newDir)) {
          expect(existsSync(join(newDir, freshName))).toBe(false);
        }
        if (dest === 'missing') expect(existsSync(newDir)).toBe(false); // no auto-mkdir

        // The config commit: byte-untouched on any failure; on success `backupDir`
        // points at the destination — or the key is DELETED when the destination is the
        // default rung — with the unrelated `dbPath` key preserved either way.
        const configAfter = readFileSync(configFile, 'utf8');
        if (outcome === 'refused') {
          expect(configAfter).toBe(configBefore);
        } else {
          const config = JSON.parse(configAfter) as { dbPath?: string; backupDir?: string };
          expect(config.dbPath).toBe(dbPath);
          if (toDefault) expect(config.backupDir).toBeUndefined();
          else expect(config.backupDir).toBe(newDir);
        }
      } finally {
        db?.close();
        rmSync(home, { recursive: true, force: true });
      }
    },
    FS_PROP_TIMEOUT_MS,
  );
});
