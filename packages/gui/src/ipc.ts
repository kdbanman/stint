/**
 * IPC channel names shared by the main process and the preload bridge. The renderer
 * is an equal surface to tt; every channel maps to a capability that also exists as
 * a tt command (PRD §17 R8 — parity).
 */
// Type-only imports (erased at compile — the renderer/preload bundle stays core-free,
// PRD §15). They name the shapes that genuinely cross the seam — an edit patch, a
// settings key/value, a report request — so the per-channel IpcContract below can be
// exact instead of the old per-handler `as` casts (issue #87).
import type { StartPayload } from './start.js';
import type { ReportViewRequest, ExportRequest } from './reportview.js';
import type { Client, Project, Tag, Report, EditPatch, Settings, GroupBy } from '@stint/core';

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
  // §09 R06/R09: the Reports view's exports — the report's own Export CSV/JSON (scope
  // 'filtered', parity with `tt report run <name> --csv|--json`) and Export All Data (scope
  // 'all' — the whole record, every raw entry ever, parity with no-flag `tt export`). The
  // renderer cannot touch Node/fs, so the export round-trips through main: it lists the
  // scoped entries, renders the bytes via core's toCsv/toJsonEntries, and writes the file
  // through Electron's save dialog.
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
  // §12 R13: un-archive a client / project — the reverse of archive, the Clients view's Restore
  // button, at parity with tt's `client restore` / `project restore`. listClients/listProjects
  // take an optional includeArchived so the view's "show archived" affordance can reveal the
  // hidden records the Restore buttons act on (parity with `client ls --archived` etc.).
  'restoreClient',
  'renameProject',
  'archiveProject',
  'restoreProject',
  'listProjects',
  // §12 R10: the Clients view's tag-management strip — list/create/rename/archive/restore tags at
  // parity with tt's `tag` subcommands. Tags are otherwise born on the fly when applied;
  // these are the explicit manage-them-first capabilities the view exposes.
  'listTags',
  'addTag',
  'renameTag',
  'archiveTag',
  'restoreTag',
  'setSetting',
  // §20 R04–R05 / §17 R12: automatic backups + restore — the Settings → Backups section. CRUD
  // over the SAME @stint/core Store the tt `backup ls|restore` verbs drive, so backups/recovery
  // are reachable from both surfaces (PRD §17 R8). listBackups is a read; restoreBackup quarantines
  // the current file and re-points the store at the chosen backup, then refreshes all windows.
  'listBackups',
  'restoreBackup',
  // §12 R25 / §13: the Settings Storage group's read side — the three effective storage paths
  // (database, backup directory, config file), each with the ladder rung that set it, through
  // core's ONE resolveStoragePaths, so the rows can never disagree with `tt paths` (its parity
  // twin). Also carries the §20 R14 backup-directory probe (the Backups/Storage error state)
  // and the default-rung paths the Reset-to-default flow targets. READ ONLY — the write side
  // (the §12 R26 change flow) rides the separate storage:* namespace OFF the parity matrix
  // (architecture.html §08 — its CLI counterpart is the documented config-file procedure, not
  // a verb), the update:* precedent.
  'getStoragePaths',
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
  /**
   * §09 R7: the resolved client and project names, carried SEPARATELY from the joined
   * display `clientLabel` so the live search matches each field on its own (parity with
   * core's `matchesQuery` / `tt list --search`) — a query spanning the " / " join must
   * not match (issue #84).
   */
  clientName: string | null;
  projectName: string | null;
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
 * core's resolveRange, the same rule the report picker drives) OR an explicit custom
 * range as a PAIR OF PLAIN DATES (§09 R01 / G3: `YYYY-MM-DD`, no time component — the
 * raw values of the toolbar's two date fields). Main resolves the pair to the half-open
 * local window [from 00:00, day-after-to 00:00) via core's resolveDateRange —
 * the renderer derives no window. The grouping + client/project/tag/billable + free-text
 * search mirror what the control bar offers; every narrowing field is optional ("no
 * filter" when omitted).
 */
export interface ListEntriesQuery {
  preset?: 'today' | 'week' | 'last-week' | 'month' | 'last-month';
  fromDate?: string;
  toDate?: string;
  /**
   * Optional — main defaults to 'day' (issue #50). The Entries calendar always lays by
   * day and its toolbar sends no `by` (grouped breakdowns live in Reports, G11). Core's
   * one grouping vocabulary, not a restatement of it (issue #170).
   */
  by?: GroupBy;
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
  /**
   * §14 — the settings snapshot, core's `Settings` ITSELF rather than a renderer restatement
   * of it. Every row was respelled here once and hand-copied again in `buildUiState`, so core
   * and the GUI drifted in silence: adding a row to core's interface produced no error at
   * either site, and `showWeekend` shipped to core and `tt` while the GUI snapshot simply did
   * not carry it. Naming the type binds the three homes to one, and the restatement's widened
   * spellings (`weekStart: string` for a `WeekStart`) go with it — a plain data interface of
   * primitives, so it stays structured-clone-safe across the IPC seam unchanged. Core owns
   * each row's meaning and validation; settings.ts is where they are documented.
   */
  settings: Settings;
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
 * page): either a relative preset (re-resolved on each run) or an absolute custom range
 * as a PAIR OF PLAIN DATES (§09 R01 / G3: `YYYY-MM-DD`, no time component — exactly what
 * the builder's two date fields hold). Core's RangeSpec keeps absolute UTC instants;
 * reportview.ts's rangeSpecFromView/ToView convert through resolveDateRange /
 * utcWindowToDatePair, so the renderer never sees (or derives) an instant.
 */
export type SavedReportRangeView =
  | { kind: 'preset'; preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month' }
  | { kind: 'absolute'; fromDate: string; toDate: string };

/**
 * §09 R08 — the renderer-safe projection of a saved report definition the Reports view's
 * saved-definitions list paints (mirrors core's SavedReport with no core import in the page).
 */
export interface SavedReportView {
  id: number;
  name: string;
  rangeSpec: SavedReportRangeView;
  by: GroupBy;
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
  by: GroupBy;
  billableFilter: 'billable' | 'all' | 'non-billable';
  clientId?: number;
  projectId?: number;
  tag?: string;
  search?: string;
  rounding: boolean;
  roundingIncrementMin: number;
}

/**
 * §19 R04 — the renderer-safe progress value the Settings → Software Update panel paints as a
 * live progress bar + numbered guided steps. The main process pushes it over the dedicated
 * `update-progress` broadcast (mirroring the existing `changed` broadcast), exposed to the
 * renderer via preload's `onUpdateProgress`. No core import in the page (renderer-safe shape).
 *
 *  - `phase`        — 'downloading' while bytes stream, 'ready' once the artifact is on disk
 *                     (and revealable), 'error' on failure.
 *  - `percent`      — clamped [0,100] download progress for the `.bar`.
 *  - `version`      — the version being installed (the guided-install header).
 *  - `steps`        — the ordered, platform-specific guided-install plan (numbered steps:
 *                     download → replace the app in /Applications → approve once at first launch
 *                     with the one-time Gatekeeper note — macOS, no Developer ID).
 *  - `artifactPath` — the on-disk path of the downloaded artifact once `phase === 'ready'`
 *                     (under the OS temp dir, NEVER beside the database — §19 R04), else null.
 *  - `message`      — a graceful message when `phase === 'error'`, else null.
 */
export interface UpdateProgress {
  phase: 'downloading' | 'ready' | 'error';
  percent: number;
  version: string;
  steps: string[];
  artifactPath: string | null;
  message: string | null;
}

/**
 * §19 R03/R04 (issue 138) — what a failed update check or download READS AS, whatever the
 * transport called it. Both cross this seam as the `message` above (or `UpdateCheck`'s), and
 * both were once a forwarded `err.message`: Settings reported `net::ERR_NAME_NOT_RESOLVED`, a
 * Chromium error code, to a user who can only try again. update.ts applies them
 * (`updateFailureMessage`); they live HERE, beside the shapes that carry them, because they
 * are renderer-facing values and this module is the seam's electron-free home — so the JUDGE
 * fixtures can read the shipping strings instead of re-typing them (the copy would drift the
 * first time it was reworded, and the scene would still pass).
 */
export const UPDATE_CHECK_FAILED =
  'Could not check for updates — GitHub could not be reached. Check your connection and try again.';

export const UPDATE_DOWNLOAD_FAILED =
  'Could not download the update — the transfer did not finish. Check your connection and try again.';

// ------------------------------------------------------------- typed IPC seam
//
// The one seam Electron forces (renderer ↔ main) is the only place a payload used to
// cross as `unknown` and get hand-cast per handler (issue #87). IpcContract is the single
// per-channel payload/result map: main.ts's shipping handler map is typed `IpcHandlers`
// (derived from it), so a reshaped payload or a CHANNELS entry without a handler stops
// compiling — the compile-time equivalent of the runtime guard the QA-driver port already
// carries (test/qa-driver.test.ts), now on the original too. Runtime validation at the
// seam is deliberately out: both ends are in-repo and typed against this one map.

/** The renderer identifies an entry by id — remove / subtractSleep. */
export interface EntryIdPayload {
  id: number;
}

/**
 * §12 R7 / §05 R5 — what the renderer's backfill form sends over `add`: two local datetime
 * strings plus the optional attributes, mirroring `tt add` (main resolves names + converts
 * to UTC through core's one rule).
 */
export interface AddEntryPayload {
  description?: string | null;
  fromLocal: string;
  toLocal: string;
  client?: string;
  project?: string;
  tags?: string[];
  billable?: boolean;
}

/** What the edit form sends over `edit`: the entry id and a core EditPatch. */
export interface EditEntryPayload {
  id: number;
  patch: EditPatch;
}

/** §06 — cut an entry at an instant (`split`). */
export interface SplitPayload {
  id: number;
  atUtc: string;
}

/**
 * §06 R3 — fold a contiguous selection into one entry (`merge`). `winnerId` names the entry
 * whose client/project win when the selection disagrees; `billable` the chosen flag.
 * `allowGap` acknowledges a non-contiguous selection (core refuses the fold otherwise) — the
 * renderer sets it only after the user confirms the gapped-span gate (§12 R13).
 */
export interface MergePayload {
  ids: number[];
  winnerId?: number;
  billable?: boolean;
  allowGap?: boolean;
}

/**
 * §12 R11 / §14 — the Settings view persists any one §14 setting over `setSetting` (parity
 * with `tt config set`). The distributed form ties each key to its own value type, so a
 * wrong-typed value for a key stops compiling.
 */
export type SetSettingPayload = {
  [K in keyof Settings]: { key: K; value: Settings[K] };
}[keyof Settings];

/** §09 R6 — the ack `exportEntries` returns: canceled at the save dialog, or bytes written. */
export type ExportResult = { canceled: true } | { written: number; path: string };

/** §20 R05 — what `restoreBackup` reports back (mirrors core's RecoveryResult, renderer-safe). */
export interface RestoreResult {
  recoveredFrom: string;
  quarantinedTo: string;
}

/** §13 — one effective storage path + the ladder rung that set it (mirrors core's EffectivePath). */
export interface EffectivePathView {
  path: string;
  source: 'env' | 'config' | 'default';
}

/**
 * §12 R25 / §13 / §20 R14 — what `getStoragePaths` returns: the renderer-safe projection the
 * Settings Storage group paints (no core import in the page). `db`/`backupDir`/`configFile`
 * are the SAME three effective paths + sources `tt paths` prints (core's one resolver serves
 * both, so they can never disagree); `defaults` names the ladder's default-rung locations the
 * §12 R25 Reset-to-default flow targets (the database default is the GUI's `userData`-derived
 * path; the backup default is beside the effective database); `backupDirState` is the §20 R14
 * probe — a dead backup directory renders the Storage row and the Backups section in the error
 * state rather than hiding the failure.
 */
export interface StoragePathsView {
  db: EffectivePathView;
  backupDir: EffectivePathView;
  configFile: EffectivePathView;
  defaults: { dbPath: string; backupDir: string };
  backupDirState: { ok: boolean; problem: string | null };
}

/**
 * §12 R26 — what a `storage:changeDb` / `storage:changeBackupDir` call resolves to. A REFUSAL
 * is a value, not a rejection: core's StorageChangeError messages are written for in-dialog
 * rendering (§12 R21's inline grammar), so main catches the typed refusal and returns its
 * message as `{ ok: false }` — the dialog stays open, the config untouched, the old location
 * active. `{ ok: true }` means the pipeline ran and the config committed; main relaunches the
 * app right after resolving, so the renderer at most paints the success message briefly.
 */
export type StorageChangeResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * The per-channel payload/result contract — one entry per CHANNELS name. `payload` is what
 * the renderer sends (`void` for the parameterless reads/toggles); `result` is what main
 * returns. Span-writing channels return WriteAck (PRD §06 R4 overlap warnings); the other
 * mutators return `void`, or the renderer-safe view of the record they wrote where the renderer
 * cannot re-derive it; reads return the renderer-safe views defined above (or the core shapes
 * that already cross the seam).
 */
export interface IpcContract {
  getState: { payload: void; result: UiState };
  search: { payload: { query?: string } | undefined; result: UiState };
  listEntries: { payload: ListEntriesQuery; result: EntryListView };
  toggle: { payload: void; result: WriteAck };
  start: { payload: StartPayload | undefined; result: WriteAck };
  stop: { payload: void; result: WriteAck };
  resume: { payload: void; result: WriteAck };
  add: { payload: AddEntryPayload; result: WriteAck };
  edit: { payload: EditEntryPayload; result: WriteAck };
  split: { payload: SplitPayload; result: WriteAck };
  merge: { payload: MergePayload; result: WriteAck };
  remove: { payload: EntryIdPayload; result: void };
  subtractSleep: { payload: EntryIdPayload; result: void };
  report: { payload: ReportViewRequest; result: Report };
  saveReport: { payload: SavedReportInputView; result: SavedReportView };
  listReports: { payload: void; result: SavedReportView[] };
  showReport: { payload: { name: string }; result: SavedReportView | null };
  renameReport: { payload: { name: string; newName: string }; result: SavedReportView };
  editReport: {
    payload: { name: string; patch: Partial<SavedReportInputView> };
    result: SavedReportView;
  };
  removeReport: { payload: { name: string }; result: void };
  runReport: { payload: { ref: string | number }; result: Report };
  pinFavorite: { payload: FavoriteInputView; result: FavoriteView };
  listFavorites: { payload: void; result: FavoriteView[] };
  renameFavorite: { payload: { ref: string | number; name: string }; result: FavoriteView };
  unpinFavorite: { payload: { ref: string | number }; result: void };
  startFavorite: { payload: { name: string }; result: WriteAck };
  exportEntries: { payload: ExportRequest; result: ExportResult };
  addClient: { payload: { name: string }; result: Client };
  addProject: { payload: { name: string; clientId: number }; result: Project };
  listClients: { payload: { includeArchived?: boolean } | undefined; result: Client[] };
  renameClient: { payload: { id: number; name: string }; result: void };
  archiveClient: { payload: { id: number }; result: void };
  restoreClient: { payload: { id: number }; result: void };
  renameProject: { payload: { id: number; name: string }; result: void };
  archiveProject: { payload: { id: number }; result: void };
  restoreProject: { payload: { id: number }; result: void };
  listProjects: { payload: { clientId?: number; includeArchived?: boolean } | undefined; result: Project[] };
  listTags: { payload: { includeArchived?: boolean } | undefined; result: Tag[] };
  addTag: { payload: { name: string }; result: Tag };
  renameTag: { payload: { id: number; name: string }; result: void };
  archiveTag: { payload: { id: number }; result: void };
  restoreTag: { payload: { id: number }; result: void };
  setSetting: { payload: SetSettingPayload; result: void };
  listBackups: { payload: void; result: BackupInfoView[] };
  restoreBackup: { payload: { name: string }; result: RestoreResult };
  getStoragePaths: { payload: void; result: StoragePathsView };
}

// Compile-time exhaustiveness, both directions: a CHANNELS name missing from IpcContract
// (the mapped IpcHandlers below cannot resolve IpcContract[C]) OR a stray IpcContract key
// that is not a channel (_NoStrayContractKeys) fails to compile.
type Assert<T extends true> = T;
type _ContractCoversChannels = Assert<Channel extends keyof IpcContract ? true : false>;
type _NoStrayContractKeys = Assert<keyof IpcContract extends Channel ? true : false>;

/**
 * The shipping handler map's type: one handler per channel, its typed payload in, its typed
 * result out. main.ts's `createIpcHandlers` returns this, so the whole map is checked against
 * IpcContract at compile time. Because it is a total map over Channel, the runtime bind needs
 * no non-null assertion (issue #87).
 */
export type IpcHandlers = {
  [C in Channel]: (payload: IpcContract[C]['payload']) => IpcContract[C]['result'];
};
