/**
 * Build the renderer's UiState snapshot from the shared core. Pure read; the
 * renderer paints exactly what tt would show, just visually (PRD §12).
 */
import { Store, detectOverlaps, localDay } from '@stint/core';
import type { UiState } from './ipc.js';

function clientLabel(clientName: string | null, projectName: string | null): string | null {
  if (clientName && projectName) return `${clientName} / ${projectName}`;
  return clientName ?? projectName ?? null;
}

export function buildUiState(store: Store, accent: string): UiState {
  const all = store.listEntries();
  const now = new Date();
  const overlapped = detectOverlaps(all, now);

  const byDay = new Map<string, UiState['days'][number]['entries']>();
  for (const e of all) {
    const day = localDay(e.startUtc);
    const row = {
      id: e.id,
      description: e.description,
      clientLabel: clientLabel(e.clientName, e.projectName),
      startUtc: e.startUtc,
      endUtc: e.endUtc,
      billableSeconds: e.billableSeconds,
      billable: e.billable,
      overlapped: overlapped.has(e.id),
      sleptThrough: e.sleptThrough,
      excludedSeconds: e.excludedSeconds,
    };
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(row);
  }
  const days = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, entries]) => ({ day, entries }));

  const status = store.status();
  const settings = store.settings();

  return {
    status: {
      running: status.running,
      entry: status.entry
        ? {
            id: status.entry.id,
            description: status.entry.description,
            clientLabel: clientLabel(status.entry.clientName, status.entry.projectName),
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
