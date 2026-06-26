/**
 * IPC channel names shared by the main process and the preload bridge. The renderer
 * is an equal surface to tt; every channel maps to a capability that also exists as
 * a tt command (PRD §17 R8 — parity).
 */
export const CHANNELS = [
  'getState',
  'toggle',
  'start',
  'stop',
  'resume',
  'edit',
  'split',
  'merge',
  'remove',
  'subtractSleep',
  'report',
  'addClient',
  'addProject',
  'listClients',
  'setSetting',
] as const;

export type Channel = (typeof CHANNELS)[number];

/** The snapshot the renderer paints from. */
export interface UiState {
  status: {
    running: boolean;
    entry: {
      id: number;
      description: string | null;
      clientLabel: string | null;
      startUtc: string;
      billableSeconds: number;
      billable: boolean;
      sleptThrough: boolean;
    } | null;
  };
  days: {
    day: string;
    entries: {
      id: number;
      description: string | null;
      clientLabel: string | null;
      startUtc: string;
      endUtc: string | null;
      billableSeconds: number;
      billable: boolean;
      overlapped: boolean;
      sleptThrough: boolean;
      excludedSeconds: number;
    }[];
  }[];
  sleepFlaggedIds: number[];
  settings: {
    rounding: boolean;
    roundingIncrementMin: number;
    weekStart: string;
    firstCheckinMin: number;
    checkinIntervalMin: number;
    globalHotkey: string;
  };
  accent: string;
}
