/**
 * Build the renderer's UiState snapshot from the shared core. Pure read; the
 * renderer paints exactly what tt would show, just visually (PRD §12).
 */
import { Store, describeOverlaps, buildEntryList, joinClientProject, APP_VERSION } from '@stint/core';
import type { UiState } from './ipc.js';

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
    entries: g.entries.map((e) => {
      const overlap = overlaps.get(e.id);
      return {
        id: e.id,
        description: e.description,
        clientLabel: joinClientProject(e.clientName, e.projectName),
        startUtc: e.startUtc,
        endUtc: e.endUtc,
        billableSeconds: e.billableSeconds,
        billable: e.billable,
        overlapped: overlap !== undefined,
        // §12 R9: the detailed overlap banner reads minutes + which neighbour (previous/
        // next); rounded from the core-owned overlap seconds so it cannot drift.
        overlapMinutes: overlap ? Math.round(overlap.overlapSeconds / 60) : 0,
        overlapRelation: overlap ? overlap.relation : null,
        sleptThrough: e.sleptThrough,
        excludedSeconds: e.excludedSeconds,
        // §12 R9: the un-trimmed wall-clock duration, so a slept entry whose billable was
        // trimmed can paint the raw duration struck through beside the live billable one.
        rawSeconds: e.rawSeconds,
        tags: e.tags,
      };
    }),
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
    settings: {
      rounding: settings.rounding,
      roundingIncrementMin: settings.roundingIncrementMin,
      weekStart: settings.weekStart,
      firstCheckinMin: settings.firstCheckinMin,
      checkinIntervalMin: settings.checkinIntervalMin,
      globalHotkey: settings.globalHotkey,
      // §12 R11: the editable date-format mode the Settings view edits.
      dateFormat: settings.dateFormat,
      // §20 R04: the current backup-retention count the Settings → Backups picker paints; it
      // changes over the same setSetting channel `tt config set backup_retention` drives.
      backupRetention: settings.backupRetention,
    },
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
