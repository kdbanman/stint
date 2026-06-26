/**
 * Build the renderer's UiState snapshot from the shared core. Pure read; the
 * renderer paints exactly what tt would show, just visually (PRD §12).
 */
import { Store, detectOverlaps, groupInto, joinClientProject, localDay } from '@stint/core';
import type { UiState } from './ipc.js';

/**
 * How far back the main window shows day-grouped history. A long-lived tracker would
 * otherwise re-scan and re-join its entire history on every ~second refresh; this
 * bounds that to a useful window (older time is still reachable via `tt`/reports).
 */
const WINDOW_DAYS = 60;

export function buildUiState(store: Store, accent: string): UiState {
  const now = new Date();
  const fromUtc = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const all = store.listEntries({ fromUtc });
  const overlapped = detectOverlaps(all, now);

  const byDay = groupInto(all, (e) => [localDay(e.startUtc)]);
  const days = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, entries]) => ({
      day,
      entries: entries.map((e) => ({
        id: e.id,
        description: e.description,
        clientLabel: joinClientProject(e.clientName, e.projectName),
        startUtc: e.startUtc,
        endUtc: e.endUtc,
        billableSeconds: e.billableSeconds,
        billable: e.billable,
        overlapped: overlapped.has(e.id),
        sleptThrough: e.sleptThrough,
        excludedSeconds: e.excludedSeconds,
      })),
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
    },
    accent,
  };
}
