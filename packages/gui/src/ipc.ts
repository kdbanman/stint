/**
 * IPC channel names shared by the main process and the preload bridge. The renderer
 * is an equal surface to tt; every channel maps to a capability that also exists as
 * a tt command (PRD §17 R8 — parity).
 */
export const CHANNELS = [
  'getState',
  // §09 R7: free-text search over the day-grouped history list. Returns a UiState
  // filtered by the query (parity with `tt list --search` / `tt report --search`); the
  // renderer paints it exactly as it paints getState.
  'search',
  // §12 R9: the Entries view's control bar — a read-only query over the entry list that
  // resolves a range (preset/custom), narrows by client/project/tag/billable + free-text
  // search, and groups by day/client/project/tag through core's buildEntryList. Parity
  // with `tt list --range/--client/--project/--tag/--search --by`.
  'listEntries',
  'toggle',
  'start',
  'stop',
  'resume',
  'add',
  'edit',
  'split',
  'merge',
  'remove',
  'subtractSleep',
  'report',
  // §09 R6: the report view's Export CSV / Export JSON. The renderer cannot touch
  // Node/fs, so the export round-trips through main: it resolves the same range, lists
  // the raw entries, renders the bytes via core's toCsv/toJsonEntries (parity with
  // `tt export --csv/--json`), and writes the file through Electron's save dialog.
  'exportEntries',
  'addClient',
  'addProject',
  'listClients',
  // §07: the Clients view's create/rename/archive over the same reference-data
  // capabilities tt's `client`/`project` subcommands expose. listProjects backs the
  // per-client project sub-list; the rename/archive mutators mirror tt rename/archive.
  'renameClient',
  'archiveClient',
  'renameProject',
  'archiveProject',
  'listProjects',
  // §12 R10: the Clients view's tag-management strip — list/create/rename/archive tags at
  // parity with tt's `tag` subcommands. Tags are otherwise born on the fly when applied;
  // these are the explicit manage-them-first capabilities the view exposes.
  'listTags',
  'addTag',
  'renameTag',
  'archiveTag',
  'setSetting',
] as const;

export type Channel = (typeof CHANNELS)[number];

/**
 * The acknowledgement a write IPC channel returns to the renderer. It carries the
 * non-fatal warnings the underlying core write produced — chiefly the overlap
 * warning (PRD §06 R4: overlap is allowed but flagged) — so the renderer can surface
 * an inline banner at the moment of the edit, not only the durable per-row flag. It
 * mirrors core's `Warning` in a renderer-safe shape (no core import in the page).
 */
export interface WriteAck {
  warnings: { kind: string; message: string; overlapsWith: number[] }[];
}

/**
 * One painted entry row — the renderer-safe projection of an EntryView (no core import
 * in the page). The day-grouped UiState and the §12 R9 Entries-view query both paint
 * this same shape, so the renderer has one row renderer for either path.
 */
export interface EntryRowView {
  id: number;
  description: string | null;
  clientLabel: string | null;
  startUtc: string;
  endUtc: string | null;
  billableSeconds: number;
  billable: boolean;
  overlapped: boolean;
  /** §12 R9: minutes this entry shares with its worst-overlapping neighbour (0 if none). */
  overlapMinutes: number;
  /** §12 R9: whether that neighbour starts before (previous) or after (next); null if none. */
  overlapRelation: 'previous' | 'next' | null;
  sleptThrough: boolean;
  excludedSeconds: number;
  /** §12 R9: raw (un-trimmed) wall-clock seconds, for the struck-through slept duration. */
  rawSeconds: number;
  tags: string[];
}

/**
 * §12 R9 — a read-only Entries-view query. EITHER a named preset (resolved through
 * core's resolveRange, the same rule the report picker drives) OR explicit from/to.
 * The grouping + client/project/tag/billable + free-text search mirror what the
 * control bar offers; every narrowing field is optional ("no filter" when omitted).
 */
export interface ListEntriesQuery {
  preset?: 'today' | 'week' | 'last-week' | 'month' | 'last-month';
  fromUtc?: string;
  toUtc?: string;
  by: 'day' | 'client' | 'project' | 'tag';
  clientId?: number;
  projectId?: number;
  tag?: string;
  billable?: 'billable' | 'all' | 'non-billable';
  search?: string;
}

/** §12 R9 — the grouped result the Entries control bar paints (read-only, no writes). */
export interface EntryListView {
  groups: { key: string; billableSeconds: number; entries: EntryRowView[] }[];
  rangeFromUtc: string;
  rangeToUtc: string;
}

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
      tags: string[];
    } | null;
  };
  days: {
    day: string;
    entries: EntryRowView[];
  }[];
  sleepFlaggedIds: number[];
  settings: {
    rounding: boolean;
    roundingIncrementMin: number;
    weekStart: string;
    firstCheckinMin: number;
    checkinIntervalMin: number;
    globalHotkey: string;
    /** §12 R11 — accent usage mode ('system' | 'monochrome'); distinct from the top-level
     * `accent` colour string, which is the system accent the renderer paints when this is 'system'. */
    accent: string;
    /** §12 R11 — date rendering mode ('system' | 'iso'). */
    dateFormat: string;
  };
  /** The system accent colour string (e.g. '#2f6fed') for theming — see settings.accent for the mode. */
  accent: string;
}
