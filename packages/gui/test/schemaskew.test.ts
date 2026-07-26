/**
 * GOLD — the GUI's version-skew refusal on launch (§20 R09; issue #129).
 *
 * Core proves the refusal itself (`core/test/gold/migration.test.ts`: a future-stamped DB is
 * refused before any write, no byte touched, no sibling left behind) and the CLI proves its
 * surface (`cli/test/gold/cli.test.ts`: exit 1, both versions + remedy on stderr). The GUI's
 * surface — a native error box naming both versions, the remedy and the refused file, then a
 * non-zero exit — was the one side only the MANUAL runbook covered. It does not need a real
 * desktop: the *decision* is Electron-free in `src/schemaskew.ts`, and main.ts only performs
 * it, so a manual check for it was a §05 process defect. This drives the decision against a
 * REAL SchemaTooNewError raised by a REAL future-stamped database — the error is produced by
 * core meeting the file, not hand-constructed — and source-guards the two lines main performs.
 *
 * The second half matters as much as the first: every other open failure must stay unswallowed.
 * A friendly dialog over a corrupt-DB failure is how data gets lost quietly.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDb, SCHEMA_VERSION, SchemaTooNewError, DbOpenError } from '@stint/core';
import { schemaSkewRefusal } from '../src/schemaskew.js';

const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

/** Stamp a real database as a future Stint would, then let core meet it and hand back the throw. */
function realSkewError(dir: string, futureVersion: number): { err: unknown; dbPath: string } {
  const dbPath = join(dir, 'timetracker.sqlite');
  openDb(dbPath).close();
  const raw = new DatabaseSync(dbPath);
  raw.exec(`PRAGMA user_version = ${futureVersion}`);
  raw.close();
  try {
    openDb(dbPath);
  } catch (err) {
    return { err, dbPath };
  }
  throw new Error('the future-stamped open was not refused');
}

describe('GOLD — a newer-schema DB is refused with a named error box (§20 R09)', () => {
  it('turns the real refusal into a dialog naming both versions, the remedy, and the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-skew-'));
    try {
      const futureVersion = SCHEMA_VERSION + 5;
      const { err, dbPath } = realSkewError(dir, futureVersion);
      expect(err).toBeInstanceOf(SchemaTooNewError);

      const refusal = schemaSkewRefusal(err);
      expect(refusal).not.toBeNull();
      // The title says which failure this is, in the user's words, not the class name.
      expect(refusal?.title).toBe('Database is newer than this version of Stint');
      // The detail carries everything the user needs to act: the database's version, the
      // binary's version, the remedy, and WHICH file was refused (TT_DB may point anywhere).
      const detail = refusal?.detail ?? '';
      expect(detail).toContain(String(futureVersion));
      expect(detail).toContain(String(SCHEMA_VERSION));
      expect(detail).toContain('run the newer binary');
      expect(detail).toContain(dbPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('claims NOTHING else — every other open failure stays unswallowed', () => {
    // A corrupt-DB failure, a missing-directory failure, a bug: none is presentable, so each
    // returns null and main rethrows it as loudly as before. This is the half that keeps the
    // §20 R03 recovery path from being hidden behind a version-skew dialog.
    expect(schemaSkewRefusal(new DbOpenError('integrity check failed'))).toBeNull();
    expect(schemaSkewRefusal(new Error('anything else'))).toBeNull();
    expect(schemaSkewRefusal(new TypeError('a bug'))).toBeNull();
    expect(schemaSkewRefusal(undefined)).toBeNull();
    expect(schemaSkewRefusal('a thrown string')).toBeNull();
  });

  it('main performs exactly that: the error box, then a non-zero exit, then no launch', () => {
    // The two Electron calls have no host here (that is why the decision was lifted out), so
    // the performance is frozen as source — the tray.test.ts pattern. What is pinned is
    // behaviour, not style: the refusal routes through the decision, both of its fields reach
    // the box, the exit code is non-zero, and init() returns instead of building a window.
    const start = main.indexOf('function init(');
    expect(start, 'init must exist').toBeGreaterThanOrEqual(0);
    const body = main.slice(start, main.indexOf('\n}\n', start));
    expect(body).toMatch(/const refusal = schemaSkewRefusal\(err\)/);
    expect(body).toMatch(/dialog\.showErrorBox\(refusal\.title, refusal\.detail\)/);
    expect(body).toMatch(/app\.exit\(1\)/);
    // …and the non-refusal branch rethrows rather than continuing on a failed open.
    expect(body).toMatch(/throw err;/);
  });
});
