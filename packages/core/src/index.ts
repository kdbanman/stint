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
export * from './settings.js';
export * from './report.js';
export * from './label.js';
export * from './export.js';
export * from './checkin.js';
export { Store, StoreError } from './store.js';
export type { ListFilter, ReportRequest } from './store.js';
export { SCHEMA_VERSION, openDb } from './db.js';
export type { Db } from './db.js';
