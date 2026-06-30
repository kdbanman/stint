/**
 * GOLD — backup retention semantics (PRD §14, §20 R04). The artefact is the criterion:
 * retention is the cap on how many timestamped backups are kept beside the database.
 *
 * §14 fixes the edge the default-of-5 coverage never pinned: a retention of 0 means "keep
 * all" (pruning is disabled), and a negative value behaves as 0. Only the default (5) was
 * tested before, so a regression that made 0 prune everything — or made a negative value
 * throw / wrap — would not have been caught. These guards nail both ends.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupDb, pruneBackups, listBackups, backupStamp, openDb } from '@stint/core';

/** Plant N empty backup files beside `dbPath` with distinct, ordered timestamps. */
function plantBackups(dbPath: string, count: number): void {
  for (let i = 0; i < count; i++) {
    // Distinct days keep the stamps unique and chronologically ordered.
    const at = new Date(`2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`);
    writeFileSync(`${dbPath}.bak-${backupStamp(at)}`, `backup ${i}`);
  }
}

describe('GOLD: backup retention 0 keeps all, negative behaves as 0 (§14, §20 R04)', () => {
  it('pruneBackups(0) disables pruning — every backup is kept', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-retain0-'));
    try {
      const dbPath = join(dir, 'timetracker.sqlite');
      plantBackups(dbPath, 7);
      expect(listBackups(dbPath)).toHaveLength(7);
      pruneBackups(dbPath, 0);
      // Retention 0 ⇒ keep all: nothing pruned.
      expect(listBackups(dbPath)).toHaveLength(7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a negative retention behaves as 0 — every backup is kept', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-retainneg-'));
    try {
      const dbPath = join(dir, 'timetracker.sqlite');
      plantBackups(dbPath, 6);
      pruneBackups(dbPath, -3);
      // A negative value must not prune (and must never wrap into a positive cap).
      expect(listBackups(dbPath)).toHaveLength(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a positive retention still prunes to N newest (the control)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-retainN-'));
    try {
      const dbPath = join(dir, 'timetracker.sqlite');
      plantBackups(dbPath, 7);
      pruneBackups(dbPath, 3);
      const kept = listBackups(dbPath); // newest-first
      expect(kept).toHaveLength(3);
      // The three KEPT are the newest (latest day stamps), proving prune drops the oldest.
      expect(kept.map((b) => b.name)).toEqual([
        `timetracker.sqlite.bak-${backupStamp(new Date('2026-06-07T00:00:00Z'))}`,
        `timetracker.sqlite.bak-${backupStamp(new Date('2026-06-06T00:00:00Z'))}`,
        `timetracker.sqlite.bak-${backupStamp(new Date('2026-06-05T00:00:00Z'))}`,
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backupDb forwards retention 0 end-to-end — repeated backups pile up, none pruned', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-gold-retain0-e2e-'));
    try {
      const dbPath = join(dir, 'timetracker.sqlite');
      const db = openDb(dbPath);
      // Each iteration changes the DB content (so backupDb's hash-compare writes a fresh
      // backup) and stamps a distinct instant; with retention 0, all are retained.
      for (let i = 0; i < 6; i++) {
        db.prepare('INSERT INTO client(name) VALUES(?)').run(`client ${i}`);
        const at = new Date(`2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`);
        const info = backupDb(dbPath, db, { retention: 0, at });
        expect(info, `backup ${i} should be written (content changed)`).not.toBeNull();
      }
      db.close();
      expect(listBackups(dbPath)).toHaveLength(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
