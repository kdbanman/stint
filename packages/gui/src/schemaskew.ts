/**
 * §20 R09 — how a refused database open is presented on launch (PRD §20 R09, §12).
 *
 * A database stamped by a NEWER Stint is refused by core before any write. The GUI has no
 * window yet when that happens, so the only surface left is a native error box, and the app
 * must exit non-zero rather than proceed. The *decision* — which failure gets that treatment
 * and what it says — lives here, Electron-free, the way toggle.ts and confirm.ts hold their
 * decisions; main.ts only performs it (`dialog.showErrorBox` + `app.exit(1)`).
 *
 * The narrowness is the point. Exactly one open failure is presentable: every other one
 * (DbOpenError, RecoveryError, a bug) must stay as loud as it was, because swallowing a
 * corrupt-DB failure behind a friendly dialog is how data gets lost quietly. A `null` return
 * means "not mine — rethrow".
 */
import { SchemaTooNewError } from '@stint/core';

/** What main paints in the native error box before exiting non-zero. */
export interface SchemaSkewRefusal {
  title: string;
  /** Core's message: both versions, the remedy, and WHICH file was refused. */
  detail: string;
}

/**
 * The §20 R09 refusal, or `null` when this failure is not one — in which case main rethrows
 * and the failure surfaces unchanged.
 */
export function schemaSkewRefusal(err: unknown): SchemaSkewRefusal | null {
  if (!(err instanceof SchemaTooNewError)) return null;
  return { title: 'Database is newer than this version of Stint', detail: err.message };
}
