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
  // §09 R08–R09: saved report definitions — the Reports view's saved-definitions rail.
  // CRUD + run over the SAME @stint/core Store the tt `report save|ls|show|rm|run` verbs
  // drive, so favorites/saved-reports are reachable from both surfaces (PRD §17 R8/R14).
  // runReport returns the same core Report payload the ad-hoc `report` channel builds, so
  // the renderer paints saved-report output with the existing report renderer + export.
  'saveReport',
  'listReports',
  'showReport',
  'renameReport',
  'editReport',
  'removeReport',
  'runReport',
  // §09 R6: the report view's Export CSV / Export JSON. The renderer cannot touch
  // Node/fs, so the export round-trips through main: it resolves the same range, lists
  // the raw entries, renders the bytes via core's toCsv/toJsonEntries (parity with
  // `tt export --csv/--json`), and writes the file through Electron's save dialog.
  'exportEntries',
  // §05 R09: pinned timer favorites — the Timer view's favorites rail. CRUD over the SAME
  // @stint/core Store the tt `fav add|ls|rename|rm` verbs drive, so favorites are reachable
  // from both surfaces (PRD §17 R8/R14). pinFavorite captures a template (from the running
  // entry, a closed entry, or explicit attributes); listFavorites is a read; rename/unpin are
  // mutators. (Resume from a favorite — §05 R10 — is a separate slice.)
  'pinFavorite',
  'listFavorites',
  'renameFavorite',
  'unpinFavorite',
  // §05 R10: resume from a favorite — the favorites rail's one-click Resume. Starts a FRESH
  // timer from the favorite's template (core delegates to start: atomic stop-then-start,
  // overlap warned not blocked), the favorite itself unchanged. Parity with `tt fav start
  // <name>` / `tt start --fav <name>`.
  'startFavorite',
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
  // §20 R04–R05 / §17 R12: automatic backups + restore — the Settings → Backups section. CRUD
  // over the SAME @stint/core Store the tt `backup ls|restore` verbs drive, so backups/recovery
  // are reachable from both surfaces (PRD §17 R8). listBackups is a read; restoreBackup quarantines
  // the current file and re-points the store at the chosen backup, then refreshes all windows.
  'listBackups',
  'restoreBackup',
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
  /**
   * §19 R06 — the date/build version string (`YYYY.M.D[.N]`, or the `0.0.0-dev` sentinel on an
   * unstamped build) the Settings → Software Update view shows. The shared @stint/core
   * APP_VERSION constant — the SAME value `tt --version` prints, so the two surfaces report one
   * version. Read-only here; the check/download flow is §19 R03/R04. Not a new channel (it rides
   * on the existing getState snapshot), so no parity-matrix row is needed.
   */
  appVersion: string;
  /**
   * §20 R04 — the UTC instant of the most recent automatic backup, or null when none exist yet.
   * The Settings → Backups section paints "Last backup <ts>" + a verified pill from this.
   */
  lastBackupUtc: string | null;
  /**
   * §20 R05 — a one-shot notice that the database was recovered from a backup on this launch
   * (corrupt file quarantined, latest good backup restored, nothing lost), or null. Read once
   * after open so the Settings → Backups section can paint the "recovered" pill / a notice.
   */
  recoveryNotice: { recoveredFrom: string; quarantinedTo: string } | null;
}

/**
 * §20 R04 / §17 R12 — the renderer-safe projection of an automatic backup the Settings → Backups
 * restore list paints (mirrors core's BackupInfo with no core import in the page).
 */
export interface BackupInfoView {
  name: string;
  path: string;
  createdUtc: string;
  sizeBytes: number;
}

/**
 * §05 R09 — the renderer-safe projection of a favorite (a pinned timer template) the Timer
 * view's favorites rail paints (mirrors core's Favorite with no core import in the page).
 */
export interface FavoriteView {
  id: number;
  name: string;
  description: string | null;
  clientId: number | null;
  projectId: number | null;
  billable: boolean;
  tags: string[];
}

/**
 * §05 R09 — what the Timer view's Pin-as-favorite control sends over the `pinFavorite`
 * channel. EITHER a source entry (the running entry via fromEntryId='open', or a closed
 * entry's id) whose attributes are captured, OR explicit attributes (client/project resolved
 * by name in core). `name` is the handle; the rest is the template a resume copies.
 */
export interface FavoriteInputView {
  name: string;
  fromEntryId?: number | 'open';
  description?: string | null;
  client?: string;
  project?: string;
  billable?: boolean;
  tags?: string[];
}

/**
 * §09 R08 — a saved report's range spec in a renderer-safe shape (no core import in the
 * page): either a relative preset (re-resolved on each run) or an absolute UTC window.
 */
export type SavedReportRangeView =
  | { kind: 'preset'; preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month' }
  | { kind: 'absolute'; fromUtc: string; toUtc: string };

/**
 * §09 R08 — the renderer-safe projection of a saved report definition the Reports view's
 * saved-definitions list paints (mirrors core's SavedReport with no core import in the page).
 */
export interface SavedReportView {
  id: number;
  name: string;
  rangeSpec: SavedReportRangeView;
  by: 'client' | 'project' | 'day' | 'tag';
  billableFilter: 'billable' | 'all' | 'non-billable';
  clientId?: number;
  projectId?: number;
  tag?: string;
  search?: string;
  rounding: boolean;
  roundingIncrementMin: number;
  createdUtc: string;
}

/**
 * §09 R08 — what the Reports view's inline builder sends over the `saveReport`/`editReport`
 * channels (the create/amend payload; id/createdUtc are core-assigned). Mirrors core's
 * SavedReportInput. For editReport the renderer sends { name, patch } (see main.ts handler).
 */
export interface SavedReportInputView {
  name: string;
  rangeSpec: SavedReportRangeView;
  by: 'client' | 'project' | 'day' | 'tag';
  billableFilter: 'billable' | 'all' | 'non-billable';
  clientId?: number;
  projectId?: number;
  tag?: string;
  search?: string;
  rounding: boolean;
  roundingIncrementMin: number;
}
