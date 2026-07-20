/**
 * GOLD — additive, idempotent migrations (PRD §20 R08). The artefact is the criterion:
 * the database carries a schema version; opening one already at/beyond the current version
 * makes NO change, and opening an older one applies only additive structures and stamps the
 * version forward, never rewriting or dropping existing rows. There are no down-migrations.
 *
 * Prior coverage pinned only the fresh-DB stamp (SCHEMA_VERSION === 3, user_version === 3 on a
 * new DB). These guards close §20 R08's two unproven halves: (a) opening a planted OLDER DB
 * preserves every existing row byte-for-byte while adding the new v3 structures and stamping the
 * version forward; (b) re-opening an up-to-date DB mutates neither schema nor data.
 *
 * §20 R09 is the max-version fence, hoisted to openDb's FIRST post-open action (nothing beyond
 * the database header is read; migrate()'s check remains as backstop): a DB stamped AHEAD of this
 * binary's SCHEMA_VERSION is refused outright (SchemaTooNewError naming both versions, the
 * remedy, and the refused file's path), and the refused open — through openDb AND through
 * Store.open — leaves the file byte-identical and the directory listing unchanged: no write,
 * no journal/quarantine/backup sibling, ever.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, SCHEMA_VERSION, SchemaTooNewError, Store } from '@stint/core';
import type { Db } from '@stint/core';

const userVersion = (db: Db) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

const tableNames = (db: Db) =>
  (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);

/** A full LOGICAL snapshot: schema version, every object's DDL, and every user row. */
function snapshot(db: Db): unknown {
  const objects = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();
  const rows: Record<string, unknown[]> = {};
  for (const t of tableNames(db)) {
    rows[t] = db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
  }
  return { version: userVersion(db), objects, rows };
}

describe('GOLD: additive, idempotent migrations (§20 R08)', () => {
  it('opening an older DB preserves every existing row and stamps the version forward', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-migrate-'));
    try {
      const dbPath = join(dir, 'timetracker.sqlite');
      // Build a current DB, seed known rows across the pre-v3 tables…
      let db = openDb(dbPath);
      db.exec("INSERT INTO client(name) VALUES('Acme')");
      db.exec("INSERT INTO project(client_id, name) VALUES(1, 'API')");
      db.exec(
        "INSERT INTO entry(client_id, project_id, description, start_utc, end_utc, billable, excluded_seconds) " +
          "VALUES(1, 1, 'auth refactor', '2026-06-24T09:00:00Z', '2026-06-24T10:00:00Z', 1, 0)",
      );
      db.exec("INSERT INTO tag(name) VALUES('deep')");
      db.exec('INSERT INTO entry_tag(entry_id, tag_id) VALUES(1, 1)');
      db.exec("INSERT INTO setting(key, value) VALUES('weekStart', 'monday')");
      // Capture the existing rows BEFORE rolling the schema back to an older shape.
      const before = {
        client: db.prepare('SELECT * FROM client ORDER BY id').all(),
        project: db.prepare('SELECT * FROM project ORDER BY id').all(),
        entry: db.prepare('SELECT * FROM entry ORDER BY id').all(),
        tag: db.prepare('SELECT * FROM tag ORDER BY id').all(),
        entry_tag: db.prepare('SELECT * FROM entry_tag ORDER BY entry_id, tag_id').all(),
        setting: db.prepare('SELECT * FROM setting ORDER BY key').all(),
      };

      // …then plant a genuinely OLDER (pre-v3) database: drop the v3-only structures (the
      // favorite / favorite_tag / report tables + the one_open_entry_idx partial unique index)
      // and roll user_version back to 2. favorite_tag references favorite, so drop it first.
      db.exec('DROP TABLE IF EXISTS favorite_tag');
      db.exec('DROP TABLE IF EXISTS favorite');
      db.exec('DROP TABLE IF EXISTS report');
      db.exec('DROP INDEX IF EXISTS one_open_entry_idx');
      db.exec('PRAGMA user_version = 2');
      db.close();

      // Re-open: the additive v2→v3 migration runs.
      db = openDb(dbPath);

      // The version stamped forward to the current schema version…
      expect(userVersion(db)).toBe(SCHEMA_VERSION);
      expect(userVersion(db)).toBe(3);
      // …the new v3 structures were ADDED…
      const tables = tableNames(db);
      expect(tables).toContain('favorite');
      expect(tables).toContain('favorite_tag');
      expect(tables).toContain('report');
      const indexes = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
          .all() as { name: string }[]
      ).map((r) => r.name);
      expect(indexes).toContain('one_open_entry_idx');
      // …and every pre-existing row is preserved byte-for-byte (nothing rewritten or dropped).
      expect(db.prepare('SELECT * FROM client ORDER BY id').all()).toEqual(before.client);
      expect(db.prepare('SELECT * FROM project ORDER BY id').all()).toEqual(before.project);
      expect(db.prepare('SELECT * FROM entry ORDER BY id').all()).toEqual(before.entry);
      expect(db.prepare('SELECT * FROM tag ORDER BY id').all()).toEqual(before.tag);
      expect(db.prepare('SELECT * FROM entry_tag ORDER BY entry_id, tag_id').all()).toEqual(
        before.entry_tag,
      );
      expect(db.prepare('SELECT * FROM setting ORDER BY key').all()).toEqual(before.setting);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('re-opening an up-to-date DB mutates neither schema nor data (a no-op migration)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-migrate-noop-'));
    try {
      const dbPath = join(dir, 'timetracker.sqlite');
      let db = openDb(dbPath); // fresh ⇒ stamped at the current version
      db.exec("INSERT INTO client(name) VALUES('Globex')");
      db.exec(
        "INSERT INTO entry(description, start_utc, end_utc, billable, excluded_seconds) " +
          "VALUES('ops sync', '2026-06-24T11:00:00Z', '2026-06-24T12:00:00Z', 0, 0)",
      );
      const before = snapshot(db);
      expect((before as { version: number }).version).toBe(SCHEMA_VERSION);
      db.close();

      // Open again: user_version is already current, so migrate() must early-return — no DDL,
      // no version re-stamp, no row touched.
      db = openDb(dbPath);
      const after = snapshot(db);
      expect(after).toEqual(before);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to open a DB from a NEWER schema, naming both versions and the remedy, without touching a byte (§20 R09)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-migrate-newer-'));
    try {
      const dbPath = join(dir, 'timetracker.sqlite');
      // Build a current DB with real data, then stamp it as if a FUTURE binary wrote it.
      // The stamp goes through raw node:sqlite — not the code under test — so the gate is
      // exercised from the outside, exactly as a stale binary would meet the file.
      const db = openDb(dbPath);
      db.exec("INSERT INTO client(name) VALUES('Initech')");
      db.close();
      const futureVersion = SCHEMA_VERSION + 5;
      const raw = new DatabaseSync(dbPath);
      raw.exec(`PRAGMA user_version = ${futureVersion}`);
      raw.close();
      const bytesBefore = readFileSync(dbPath);
      const listingBefore = readdirSync(dir).sort();

      // The open is refused with the typed error…
      let thrown: unknown;
      try {
        openDb(dbPath);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SchemaTooNewError);
      // …whose message names the database's version, the binary's version, the remedy, and
      // WHICH file was refused (with TT_DB overrides the user must be able to see the path)…
      const message = (thrown as Error).message;
      expect(message).toContain(String(futureVersion));
      expect(message).toContain(String(SCHEMA_VERSION));
      expect(message).toContain('newer version of Stint');
      expect(message).toContain('run the newer binary');
      expect(message).toContain(dbPath);
      // …and the refused open wrote NOTHING: the file bytes are identical…
      const bytesAfter = readFileSync(dbPath);
      expect(bytesAfter.equals(bytesBefore)).toBe(true);
      // …and NO sibling file was left behind — no -wal/-shm journal, no .corrupted-*
      // quarantine, no .bak-* backup. A stale binary must never route a merely-newer DB
      // into quarantine/restore (that would replace newer data with an older backup).
      expect(readdirSync(dir).sort()).toEqual(listingBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Store.open refuses the same future-stamped DB with the same typed error and writes no launch backup (§20 R09)', () => {
    // The Store-level gate: Store.open wraps openDb and then writes a §20 R04 launch
    // backup — this pins that NO launch backup (or any other write) precedes the refusal,
    // so the directory listing is unchanged after the refused open.
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-migrate-newer-store-'));
    try {
      const dbPath = join(dir, 'timetracker.sqlite');
      const db = openDb(dbPath);
      db.exec("INSERT INTO client(name) VALUES('Initech')");
      db.close();
      const futureVersion = SCHEMA_VERSION + 5;
      const raw = new DatabaseSync(dbPath);
      raw.exec(`PRAGMA user_version = ${futureVersion}`);
      raw.close();
      const listingBefore = readdirSync(dir).sort();

      let thrown: unknown;
      try {
        Store.open({ path: dbPath });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SchemaTooNewError);
      expect((thrown as Error).message).toContain(dbPath);
      // The refused open left the directory listing unchanged: no launch backup, no
      // journal siblings, no quarantine file.
      expect(readdirSync(dir).sort()).toEqual(listingBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
