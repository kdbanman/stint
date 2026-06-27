/**
 * GOLD — the GUI backups plumbing (PRD §20 R04/R05, §17 R12). The Settings → Backups section's
 * restore list + "Last backup" status all delegate to @stint/core (store.listBackups /
 * restoreFromBackup over the file-level backup module); this drives the Electron-free helpers
 * (the units main.ts's listBackups / restoreBackup IPC handlers wrap) against a FILE-BACKED
 * Store (backups live on disk beside the DB — `:memory:` has none) and proves: listBackups is a
 * faithful newest-first projection of the core BackupInfo, the size formatter is display-only,
 * and the restore selection resolves a chosen name or "latest" to the name core restores by — so
 * the rail reaches nothing `tt backup ls|restore` cannot.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@stint/core';
import {
  backupToView,
  listBackups,
  formatBackupSize,
  resolveRestoreSelection,
} from '../src/backupview.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stint-gui-backup-'));
  dbPath = join(dir, 'timetracker.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Open a file-backed store at a fixed clock, seed one entry, and force a backup beside the DB. */
function seededWithBackup(now: Date): Store {
  const store = Store.open({ path: dbPath, clock: () => now });
  const { clientId, projectId } = store.resolveClientProjectByName({ client: 'Acme', project: 'API' });
  store.add({
    description: 'auth refactor',
    clientId,
    projectId,
    fromUtc: '2026-06-22T09:00:00Z',
    toUtc: '2026-06-22T12:00:00Z',
    billable: true,
  });
  store.backupNow();
  return store;
}

describe('listBackups — newest-first renderer projection (§20 R04)', () => {
  it('projects the core BackupInfo to the renderer-safe view shape', () => {
    const store = seededWithBackup(new Date('2026-06-24T18:00:00Z'));
    const views = listBackups(store);
    expect(views.length).toBeGreaterThanOrEqual(1);
    const v = views[0]!;
    // The view mirrors core's BackupInfo exactly (no core import in the page).
    expect(Object.keys(v).sort()).toEqual(['createdUtc', 'name', 'path', 'sizeBytes']);
    expect(v.name).toMatch(/\.bak-/);
    expect(v.path).toContain(dir);
    expect(v.sizeBytes).toBeGreaterThan(0);
    store.close();
  });

  it('backupToView is a faithful projection of a single BackupInfo', () => {
    const store = seededWithBackup(new Date('2026-06-24T18:00:00Z'));
    const core = store.listBackups()[0]!;
    expect(backupToView(core)).toEqual({
      name: core.name,
      path: core.path,
      createdUtc: core.createdUtc,
      sizeBytes: core.sizeBytes,
    });
    store.close();
  });
});

describe('formatBackupSize — display-only humanizer (§20 R04)', () => {
  it('renders bytes, KB, and MB', () => {
    expect(formatBackupSize(512)).toBe('512 B');
    expect(formatBackupSize(2048)).toBe('2.0 KB');
    expect(formatBackupSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('resolveRestoreSelection — pick the name core restores by (§20 R05)', () => {
  it('resolves "latest" to the newest backup name', () => {
    const store = seededWithBackup(new Date('2026-06-24T18:00:00Z'));
    const views = listBackups(store);
    expect(resolveRestoreSelection(views, 'latest')).toBe(views[0]!.name);
    store.close();
  });

  it('resolves a chosen name to itself, and an unknown name to null', () => {
    const store = seededWithBackup(new Date('2026-06-24T18:00:00Z'));
    const views = listBackups(store);
    expect(resolveRestoreSelection(views, views[0]!.name)).toBe(views[0]!.name);
    expect(resolveRestoreSelection(views, 'no-such-backup')).toBeNull();
    store.close();
  });

  it('returns null when there are no backups', () => {
    expect(resolveRestoreSelection([], 'latest')).toBeNull();
    expect(resolveRestoreSelection([], 'anything')).toBeNull();
  });
});
