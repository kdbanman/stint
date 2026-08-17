/**
 * @stint/core — the shared core for Stint.
 *
 * Owns the schema, every state transition, all invariants, reporting, rounding, and
 * the check-in cadence. The tt CLI and the Electron GUI both import it; there is no
 * duplicated logic and no privileged surface (PRD §04, §15).
 */
export * from './types.js';
export * from './time.js';
export * from './paths.js';
export * from './config.js';
export * from './settings.js';
export * from './report.js';
export * from './savedreport.js';
export * from './entrylist.js';
export * from './label.js';
export * from './export.js';
export * from './checkin.js';
export * from './version.js';
export { Store, StoreError } from './store.js';
export type { ListFilter, ReportRequest } from './store.js';
export { SCHEMA_VERSION, openDb, assertOpenPragmas, DbOpenError, SchemaTooNewError } from './db.js';
export type { Db } from './db.js';
export {
  backupDb,
  backupDirState,
  backupCollisions,
  copyBackupsVerified,
  deleteBackupOriginals,
  listBackups,
  latestBackup,
  pruneBackups,
  checkIntegrity,
  quarantineAndRecover,
  restoreFromBackup,
  backupStamp,
  RecoveryError,
} from './backup.js';
export type { BackupDirState, BackupInfo, RecoveryResult } from './backup.js';
export { StorageChangeError, changeBackupDir } from './storagechange.js';
export type {
  BackupDirChange,
  BackupDirChangeOutcome,
  DbChangeMode,
  DbChangeOutcome,
  DbLocationChange,
  StorageChangeMode,
} from './storagechange.js';
