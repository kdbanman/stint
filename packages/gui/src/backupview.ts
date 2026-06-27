/**
 * The GUI's backups plumbing (PRD §20 R04/R05, §17 R12) — Electron-free so it is unit-testable
 * without a main process, mirroring favorites.ts/reportview.ts. All backup LOGIC lives in
 * @stint/core (store.listBackups / backupNow / restoreFromBackup over the file-level backup
 * module); these are the pure pieces the Settings → Backups IPC handlers wrap: project a core
 * BackupInfo to the renderer-safe view shape (no core import in the page), list the backups the
 * restore picker paints, format a row for display, and resolve the restore selection (a chosen
 * backup name, or the newest when the user asks for "latest") to the name core restores by.
 */
import type { Store, BackupInfo } from '@stint/core';
import type { BackupInfoView } from './ipc.js';

/** Core BackupInfo → the renderer-safe projection the Settings → Backups restore list paints. */
export function backupToView(b: BackupInfo): BackupInfoView {
  return {
    name: b.name,
    path: b.path,
    createdUtc: b.createdUtc,
    sizeBytes: b.sizeBytes,
  };
}

/** List backups (newest-first) in the renderer-safe shape (PRD §20 R04). A read — no refresh. */
export function listBackups(store: Store): BackupInfoView[] {
  return store.listBackups().map(backupToView);
}

/**
 * A human size for a backup row (bytes → B/KB/MB), so the restore list shows a readable size
 * beside each backup. Pure formatting — the byte count is the core truth; this is display only.
 */
export function formatBackupSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Resolve which backup the Settings → Restore… action restores by name. The picker carries a
 * chosen backup name; the "Restore latest" shortcut passes `'latest'`, resolved here to the
 * newest backup's name against the same newest-first list core lists (so the GUI restore matches
 * `tt backup restore --latest`). Returns null when there is no such backup (nothing to restore).
 */
export function resolveRestoreSelection(
  backups: BackupInfoView[],
  selection: string | 'latest',
): string | null {
  if (backups.length === 0) return null;
  if (selection === 'latest') return backups[0]!.name;
  return backups.find((b) => b.name === selection)?.name ?? null;
}
