/**
 * Build the renderer's UiState snapshot from the shared core. Pure read; the
 * renderer paints exactly what tt would show, just visually (PRD §12).
 */
import { Store, describeOverlaps, buildEntryList, joinClientProject, APP_VERSION } from '@stint/core';
import type { UiState } from './ipc.js';
import { toEntryRowView } from './entryrow.js';

/**
 * How far back the main window shows day-grouped history. A long-lived tracker would
 * otherwise re-scan and re-join its entire history on every ~second refresh; this
 * bounds that to a useful window (older time is still reachable via `tt`/reports).
 */
const WINDOW_DAYS = 60;

export function buildUiState(
  store: Store,
  opts: { search?: string } = {},
): UiState {
  const now = new Date();
  const fromUtc = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // §09 R7: an optional free-text query narrows only the visible day-grouped history list
  // (status / sleep-flagged / settings stay whole-database), matching the list semantics.
  const all = store.listEntries({
    fromUtc,
    ...(opts.search !== undefined ? { search: opts.search } : {}),
  });
  // §12 R9: the per-entry overlap detail (worst-neighbour span + previous/next relation),
  // built on the one core overlap rule, so the renderer's in-context banner amount can
  // never drift from the report flag. `overlapped` stays the compact-badge boolean.
  const overlaps = describeOverlaps(all, now);

  // §12 R9: the default day grouping shares the one core grouping (buildEntryList by
  // 'day', newest day first) the Entries-view query path uses, so the renderer and the
  // query path can never drift on how a day bucket is keyed or ordered.
  const days = buildEntryList(all, { by: 'day' }).groups.map((g) => ({
    day: g.key,
    // The row projection itself is entryrow.ts's one job (issue #166) — the Entries-view
    // query path builds its rows through the same function, so the two can never drift.
    entries: g.entries.map((e) => toEntryRowView(e, overlaps.get(e.id))),
  }));

  const status = store.status();
  const settings = store.settings();

  return {
    status: {
      running: status.running,
      entry: status.entry
        ? {
            id: status.entry.id,
            description: status.entry.description,
            clientLabel: joinClientProject(status.entry.clientName, status.entry.projectName),
            startUtc: status.entry.startUtc,
            billableSeconds: status.entry.billableSeconds,
            billable: status.entry.billable,
            sleptThrough: status.entry.sleptThrough,
            tags: status.entry.tags,
          }
        : null,
    },
    days,
    sleepFlaggedIds: store.listSleepFlagged().map((e) => e.id),
    // §14: the whole settings row, not a field-by-field re-copy. Every row used to be named
    // three times — core's interface, UiState's restatement, and this projection — with
    // nothing binding them, which is how `showWeekend` reached core and `tt` while the GUI
    // snapshot silently lacked it. UiState.settings IS core's Settings now, so a new row
    // reaches the renderer with no edit here and none is possible to forget.
    settings,
    // §19 R06 — the date/build version (the shared @stint/core APP_VERSION constant, the SAME
    // one `tt --version` prints). Carried on getState so the Settings → Software Update view
    // shows it without a new round-trip; read-only display (the check/download flow is R03/R04).
    appVersion: APP_VERSION,
    // §20 R04 — "Last backup <ts>" in the Settings → Backups section, off the newest backup file.
    lastBackupUtc: store.listBackups()[0]?.createdUtc ?? null,
    // §20 R05 — a one-shot recovery notice (corrupt DB recovered from a backup on this launch).
    recoveryNotice: (() => {
      const r = store.lastRecovery();
      return r ? { recoveredFrom: r.recoveredFrom, quarantinedTo: r.quarantinedTo } : null;
    })(),
  };
}
