/**
 * The BDD "world" — one interface, two implementations. Steps bind to this; the
 * same .feature files run against @stint/core directly (CoreWorld) and through the
 * tt executable (CliWorld), which is how the full-parity claim (§17 R8) is proven
 * without a second copy of the spec.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  openSync,
  writeSync,
  closeSync,
  readdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Store,
  StoreError,
  joinClientProject,
  resolveRange,
  openDb,
  RecoveryError,
  toCsv,
  toJsonEntries,
  settingDescriptor,
  formatStamp,
  type Clock,
} from '@stint/core';

export interface EntryRec {
  id: number;
  description: string | null;
  startUtc: string;
  endUtc: string | null;
  billableSeconds: number;
  billable: boolean;
  clientLabel: string | null;
}

export interface StatusRec {
  running: boolean;
  description: string | null;
  clientLabel: string | null;
}

/**
 * A grouped total line, surface-neutral. Carries BOTH the exact billable seconds and the
 * rounded seconds the report would display when rounding is on (§09 R4) — the GUI report
 * view paints `roundedSeconds` when its Rounding toggle is on, the exact `totalSeconds`
 * when off, and core owns the rounding either way.
 */
export interface ReportLineRec {
  key: string;
  totalSeconds: number;
  roundedSeconds: number;
}

/** The shape both surfaces return for a report-by-range query (§09 R1). */
export interface ReportRec {
  grandTotalSeconds: number;
  /** The grand total rounded — what the GUI grand shows when rounding is on (§09 R4). */
  grandRoundedSeconds: number;
  lines: ReportLineRec[];
  rangeFromUtc: string;
  rangeToUtc: string;
}

/**
 * §09 R1 — a report-by-range request. EITHER a named preset (resolved through core's
 * resolveRange — the same rule the GUI picker drives) OR an explicit custom from/to. The
 * grouping + billable filter mirror the report() options the GUI passes. Rounding (§09 R4)
 * is optional and OFF by default; when on it carries the increment the GUI picker chose.
 */
export interface ReportReq {
  preset?: 'today' | 'week' | 'last-week' | 'month' | 'last-month';
  fromUtc?: string;
  toUtc?: string;
  by: 'client' | 'project' | 'day' | 'tag';
  billableFilter: 'billable' | 'all' | 'non-billable';
  rounding?: boolean;
  roundingIncrementMin?: number;
}

/**
 * §09 R6 — one exported entry, surface-neutral. The fields below are the subset of the
 * CSV column / JSON-entries contract the export scenarios assert on (the GUI Export CSV /
 * Export JSON buttons write exactly these bytes via core's toCsv/toJsonEntries — byte-
 * identical to `tt export --csv/--json`). The export covers the RAW entries for a range
 * (billable='all', no grouping/rounding) — rounding is a display concern of the report.
 */
export interface ExportRowRec {
  description: string | null;
  client: string | null;
  rawSeconds: number;
  billable: boolean;
}

/**
 * §11 — an entry-list query. EITHER a named preset (resolved through core's resolveRange —
 * the same rule the GUI toolbar drives) OR explicit from/to, narrowed by client / project /
 * tag / billable and a free-text search; every narrowing field is optional. There is NO
 * grouping (grouping left the list entirely for Reports, G11). Surface-neutral: CoreWorld
 * store.listEntries, CliWorld `tt list --search/--range/--client/--project/--tag --json` —
 * so the two surfaces are compared on the identical FLAT, ungrouped set (§17 R8).
 */
export interface ListFilterReq {
  preset?: 'today' | 'week' | 'last-week' | 'month' | 'last-month';
  fromUtc?: string;
  toUtc?: string;
  client?: string;
  project?: string;
  tag?: string;
  search?: string;
  billable?: 'billable' | 'all' | 'non-billable';
}

/**
 * §05 R09 — a favorite (pinned timer template), surface-neutral. The fields a scenario
 * asserts on: the name (the handle), the captured description, the resolved client/project
 * label, the billable flag, and the tags. Surface-neutral so the SAME scenario proves the
 * template capture identical on @stint/core and tt (§17 R8/R14).
 */
export interface FavoriteRec {
  name: string;
  description: string | null;
  clientLabel: string | null;
  billable: boolean;
  tags: string[];
}

export interface World {
  readonly name: string;
  reset(): void;
  dispose(): void;
  ensureClientProject(client: string, project: string): void;
  start(o: {
    desc: string | null;
    client?: string;
    project?: string;
    billable?: boolean;
    atIso: string;
  }): { id: number };
  stop(atIso: string): void;
  /**
   * §05 R01 / §03 (issue #61) — attempt to Start a new entry at an explicit instant that may fall
   * BEFORE the currently-open entry's start, and report whether the surface REFUSED it. start()'s
   * atomic close obeys Stop's rule: closing the open row at an instant before it began would
   * persist an end < start, so the whole transaction is refused and rolls back. Surface-neutral:
   * CoreWorld calls store.start and catches the StoreError; CliWorld checks the non-zero exit of
   * `tt start --at`. Rejected identically on BOTH surfaces (§17 R8), the open row left intact.
   */
  attemptStart(o: { desc: string | null; client?: string; project?: string; atIso: string }): {
    rejected: boolean;
  };
  resume(): { id: number };
  backfill(o: { desc: string; from: string; to: string; client?: string; project?: string }): {
    id: number;
    warned: boolean;
  };
  /**
   * §09 R1 — backfill a completed entry at EXPLICIT UTC instants (full ISO), so a
   * scenario can place entries in this week vs last week relative to the fixed clock.
   * Surface-neutral over the same `add` capability `backfill` uses.
   */
  backfillAt(o: {
    desc: string;
    fromIso: string;
    toIso: string;
    client?: string;
    project?: string;
    tags?: string[];
    /** §08 R3 — force the billable flag (e.g. a non-billable entry under a client, so a
     *  report's billable filter has an off-filter row INSIDE its range to discriminate). */
    billable?: boolean;
  }): {
    id: number;
  };
  edit(id: number, patch: { desc?: string; startUtc?: string; billable?: boolean }): void;
  /**
   * §05 R06 / §03 / §16 (issue #61) — attempt to edit the running entry's start to a (possibly
   * FUTURE) instant and report whether the surface REJECTED it without storing anything. A future
   * start on the open row freezes the count-up and would brick Stop, so core refuses it (rejected
   * rather than stored, §14). Surface-neutral: CoreWorld calls store.edit and catches the
   * StoreError; CliWorld checks the non-zero exit of `tt edit --from`. Rejected identically on
   * BOTH surfaces (§17 R8) — the same guard the GUI live-edit region surfaces (§12 R21).
   */
  attemptEditStart(id: number, startIso: string): { rejected: boolean };
  /**
   * §06 R1 — delete an entry outright. Surface-neutral: CoreWorld calls store.remove(id);
   * CliWorld shells `tt rm <id> --force` (the confirmation gate is a surface concern, proven
   * at GOLD/JUDGE; this step exercises the underlying delete arithmetic on both surfaces).
   */
  remove(id: number): void;
  /**
   * §06 R1 — the confirm gate IS the loss-protection (a core requirement): a destructive
   * delete that is NOT confirmed must never destroy data. Surface-neutral: CoreWorld models
   * the gate by NOT calling store.remove (core never auto-confirms a destructive delete);
   * CliWorld shells `tt rm <id>` WITHOUT `--force`, which refuses on stderr with a non-zero
   * exit. Both return { refused: true } and leave the entry intact — the same gate the GUI
   * two-step confirm (§12 R13) reaches. Distinct from `remove`, which is the confirmed path.
   */
  removeUnconfirmed(id: number): { refused: boolean };
  split(id: number, atIso: string): { ids: [number, number] };
  merge(ids: number[], opts?: { client?: string; allowGap?: boolean }): { id: number; warned: boolean };
  /**
   * §06 R3 — a *contiguous* selection folds each entry's end into the next's start exactly;
   * any positive gap fabricates that gap as billable time, so a gapped merge must be refused
   * unless acknowledged. Surface-neutral: CoreWorld calls store.merge WITHOUT allowGap and
   * catches the StoreError; CliWorld shells `tt merge <ids>` WITHOUT `--allow-gap`, which
   * refuses on stderr with a non-zero exit. Both return { refused: true } and leave the
   * originals intact — the loss-protection the GUI gap confirm (§12 R13) reaches. The
   * acknowledged path stays reachable via merge(..., { allowGap: true }).
   */
  mergeUnacknowledged(ids: number[]): { refused: boolean };
  /**
   * §12 R10 / §05 R08 — seed a CLOSED entry that slept through: the backfilled span plus a
   * recorded sleep span inside it, so the reversible subtract has something to exclude. Core owns
   * the recording (store.recordSleepSpan); the CLI has no verb to record a span, so CliWorld opens
   * a transient Store on its own db file to seed it (like the backup helpers read the db directly).
   */
  seedSleptEntry(o: {
    desc: string;
    from: string;
    to: string;
    sleepFrom: string;
    sleepTo: string;
  }): { id: number };
  /**
   * §12 R10 / §05 R08 — subtract (exclude) an entry's recorded slept time from its billable
   * duration; calling it again RESTORES the time (core's store.subtractSleep toggles). The GUI's
   * unified editor reversible sleep control and `tt sleep subtract <id>` are the two surfaces —
   * both reach this one core toggle, so a subtract-then-subtract round-trips the billable duration.
   */
  subtractSleep(id: number): void;
  /**
   * §12 R10 — create a client / a project under a client, the Clients view's Add-client /
   * Add-project parity twins. Surface-neutral: CoreWorld store.addClient/addProject (the
   * project's owning client ensured first); CliWorld `tt client add` / `tt project add
   * --client`. Distinct from ensureClientProject (a test-setup convenience) — these ARE the
   * capability under test.
   */
  addClient(name: string): void;
  addProject(name: string, client: string): void;
  renameClient(name: string, to: string): void;
  archiveClient(name: string): void;
  activeClientNames(): string[];
  renameProject(name: string, to: string): void;
  archiveProject(name: string): void;
  activeProjectNames(): string[];
  /**
   * §12 R13 — restore (un-archive) reference data: the reverse of archive, returning the record
   * to every picker/filter. Surface-neutral: CoreWorld store.restoreClient/restoreProject/
   * restoreTag; CliWorld `tt client|project|tag restore`. attemptRestoreProject reports whether
   * the surface REFUSED the restore — the §12 R13 edge: a project whose owning client is still
   * archived cannot be restored (an active project under a hidden client is unselectable), and
   * both surfaces refuse it identically (§17 R8).
   */
  restoreClient(name: string): void;
  restoreProject(name: string): void;
  restoreTag(name: string): void;
  attemptRestoreProject(name: string): { rejected: boolean };
  /**
   * §12 R10 — tag management at parity with `tt tag` / the Clients view's tag strip.
   * Surface-neutral: CoreWorld calls store.addTag/renameTag/archiveTag/listTags directly;
   * CliWorld shells `tt tag add/rename/archive` and reads `tt tag ls --json`. addTag is the
   * explicit manage-it-first path (`tt tag add`), which REJECTS a case-variant duplicate
   * (§07 R03); the distinct on-the-fly tagging path instead resolves it to the existing tag.
   */
  addTag(name: string): void;
  renameTag(name: string, to: string): void;
  archiveTag(name: string): void;
  activeTagNames(): string[];
  /**
   * §07 R03 (#64) — attempt an "add" of reference data whose name may already be taken and
   * report whether the surface REJECTED it without creating a duplicate. Surface-neutral:
   * CoreWorld calls store.addClient/addProject/addTag and catches the StoreError; CliWorld
   * checks the non-zero exit of `tt client|project|tag add`. A duplicate name is rejected
   * identically on BOTH surfaces (§17 R8) — the fix for the silent by-client conflation (#64).
   */
  attemptAddClient(name: string): { rejected: boolean };
  attemptAddProject(name: string, client: string): { rejected: boolean };
  attemptAddTag(name: string): { rejected: boolean };
  /**
   * §07 R03 (#64) — attempt a RENAME of reference data onto a name that may collide; report
   * whether it was rejected. A rename onto a DIFFERENT record's name is rejected case-
   * insensitively (a case-only self-rename is allowed and rides the happy-path rename verbs).
   */
  attemptRenameClient(name: string, to: string): { rejected: boolean };
  attemptRenameProject(name: string, to: string): { rejected: boolean };
  attemptRenameTag(name: string, to: string): { rejected: boolean };
  /**
   * §12 R11 / §14 — the shared `config` capability the GUI Settings view edits. Surface-
   * neutral: CoreWorld calls store.setSetting / store.settings(); CliWorld shells
   * `tt config set <snake> <value>` and reads `tt config ls --json`. setConfig/getConfig take
   * the snake_case key the descriptor list owns (the same key both surfaces accept), so a
   * settings scenario proves the view's edits are real AND parity-preserving (§17 R8).
   */
  setConfig(key: string, value: string): void;
  getConfig(key: string): string;
  /**
   * §14 — attempt a config write that may be INVALID (a malformed HH:MM, an inverted
   * working-hours pair, an out-of-range around span) and report whether it was rejected
   * WITHOUT storing anything. Surface-neutral: CoreWorld runs the same descriptor parse +
   * store.setSetting the happy path uses and catches the validation throw; CliWorld checks
   * the non-zero exit of `tt config set`. Both leave the stored value untouched on a
   * rejection — the same strictness on BOTH surfaces (§17 R8).
   */
  attemptSetConfig(key: string, value: string): { rejected: boolean };
  /**
   * §04 R06 / §14 — the DISPLAYED start stamp of the entry named by `desc`, rendered in the
   * CONFIGURED time zone through core's one formatting path. Surface-neutral: CoreWorld
   * renders core's formatStamp over the store's own settings (exactly what the GUI stamp
   * labels paint); CliWorld reads the START cell off `tt list`'s human table — which is
   * what proves the CLI's human output renders the configured zone, not raw UTC. Scenarios
   * pin `date_format` to `iso` first so the stamp shape is host-independent.
   */
  renderedStart(desc: string): string;
  list(): EntryRec[];
  /**
   * §09 R7 — free-text search over the entries. Surface-neutral: CoreWorld drives
   * store.listEntries({ search }); CliWorld drives `tt list --all --json --search <query>`
   * and parses the rows — which is what proves the CLI flag is at full parity.
   */
  search(query: string): EntryRec[];
  /**
   * §11 — the filtered/searched entry list, FLAT and ungrouped. Surface-neutral: CoreWorld
   * lists via store.listEntries(filter); CliWorld lists via `tt list … --json` (no `--by`,
   * grouping moved to Reports) — so both surfaces are compared on the identical flat set of
   * entries. Returns the surviving entries in list order (the same shape `list` returns).
   */
  listFiltered(req: ListFilterReq): EntryRec[];
  status(): StatusRec;
  reportOverlaps(fromIso: string, toIso: string): number[];
  /**
   * §09 R1 — a grouped report over a date range. The preset path MUST resolve through
   * core's resolveRange (CoreWorld) or `tt report --<preset>` (CliWorld) — the same
   * resolution the GUI picker drives — so both surfaces agree on the window; the custom
   * path passes from/to straight through.
   */
  report(req: ReportReq): ReportRec;
  /**
   * §09 R6 — export the RAW entries for a range to CSV / JSON. Surface-neutral: CoreWorld
   * renders core's toCsv/toJsonEntries over store.listEntries (exactly what the GUI Export
   * buttons round through main); CliWorld shells `tt export --range … --csv|--json`. Both
   * return the parsed rows so a scenario can assert the export shape is identical — proving
   * the GUI export adds no tt-unreachable bytes (§17 R8).
   */
  exportRows(o: { fromUtc: string; toUtc: string; format: 'csv' | 'json' }): ExportRowRec[];
  /**
   * §09 R06 — the WHOLE-RECORD export: every raw entry ever, no range — the durability /
   * data-out escape hatch (the GUI "Export All Data" buttons / no-flag `tt export`).
   * Surface-neutral: CoreWorld renders core's toCsv/toJsonEntries over an unbounded
   * listEntries; CliWorld shells `tt export --csv|--json` with no range flag. Both return
   * the parsed rows so a scenario can assert the export covers everything — billable and
   * non-billable, inside and outside any current window.
   */
  exportAllRows(format: 'csv' | 'json'): ExportRowRec[];
  /**
   * §09 R08 — save a named report definition (relative preset spec + group-by + billable
   * filter + optional rounding). Surface-neutral: CoreWorld store.saveReport, CliWorld
   * `tt report save <name> --<preset> --by … [--all|--non-billable] [--round <min>]`. The
   * relative spec re-resolves on each run through the SAME core resolveRange both surfaces
   * share, so a saved report and an ad-hoc report over the same window can never diverge.
   */
  saveReport(o: {
    name: string;
    preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month';
    by: 'client' | 'project' | 'day' | 'tag';
    billableFilter: 'billable' | 'all' | 'non-billable';
    rounding?: boolean;
    roundingIncrementMin?: number;
  }): void;
  /**
   * §09 R08 / §13 — attempt to save a report and report whether core REFUSED it (a duplicate
   * name, UNIQUE COLLATE NOCASE). Surface-neutral: CoreWorld catches store.saveReport's throw,
   * CliWorld reads `tt report save`'s non-zero exit. The refusal is what the GUI builder's
   * duplicate-name feedback (§12 R21) surfaces; this proves the CONTRACT it surfaces holds on
   * both surfaces, and that a refused save persists nothing.
   */
  attemptSaveReport(o: {
    name: string;
    preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month';
    by: 'client' | 'project' | 'day' | 'tag';
    billableFilter: 'billable' | 'all' | 'non-billable';
  }): { rejected: boolean };
  /**
   * §09 R01/R08 — save a report with an ABSOLUTE custom range (fixed from/to bounds passed
   * straight through, no re-resolution). Surface-neutral: CoreWorld store.saveReport with a
   * `{kind:'absolute'}` spec, CliWorld `tt report save <name> --range FROM TO`. A same-day
   * from == to window is valid (the report rule is ≤, unlike the entry rule's strict <).
   */
  saveReportRange(o: {
    name: string;
    fromUtc: string;
    toUtc: string;
    by: 'client' | 'project' | 'day' | 'tag';
    billableFilter: 'billable' | 'all' | 'non-billable';
  }): void;
  /**
   * §09 R01/R08 — attempt to save a report with an absolute custom range and report whether
   * core REFUSED it (an inverted from > to window resolves to nothing, so it is rejected
   * rather than stored — the same guarantee §14 gives working hours). Surface-neutral:
   * CoreWorld catches store.saveReport's throw, CliWorld reads `tt report save`'s non-zero
   * exit. This is the refusal the GUI builder surfaces inline (§12 R21).
   */
  attemptSaveReportRange(o: {
    name: string;
    fromUtc: string;
    toUtc: string;
    by: 'client' | 'project' | 'day' | 'tag';
    billableFilter: 'billable' | 'all' | 'non-billable';
  }): { rejected: boolean };
  /**
   * §09 R01/R08 — attempt to amend a saved report's range to an absolute custom window and
   * report whether core REFUSED it (an inverted from > to amendment is rejected, mirroring
   * saveReport). CoreWorld catches store.editReport's throw, CliWorld reads `tt report edit`'s
   * non-zero exit.
   */
  attemptEditReportRange(name: string, o: { fromUtc: string; toUtc: string }): { rejected: boolean };
  /** §09 R08 — the names of the saved report definitions (CoreWorld store.listReports / CliWorld `tt report ls --json`). */
  listReportNames(): string[];
  /** §09 R08 — amend a saved report's range preset (CoreWorld store.editReport / CliWorld `tt report edit <name> --<preset>`). */
  editReportRange(name: string, preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month'): void;
  /** §09 R08 — amend a saved report's group-by (CoreWorld store.editReport / CliWorld `tt report edit <name> --by <by>`). */
  editReportBy(name: string, by: 'client' | 'project' | 'day' | 'tag'): void;
  /** §09 R08 — rename a saved report (CoreWorld store.renameReport / CliWorld `tt report rename`). */
  renameReport(name: string, to: string): void;
  /** §09 R08 — delete a saved report (CoreWorld store.removeReport / CliWorld `tt report rm`). */
  removeReport(name: string): void;
  /**
   * §09 R09 — run a saved report against current data and return its grand total seconds.
   * CoreWorld store.runReport(name).grandTotalSeconds; CliWorld sums the billable seconds of
   * the FILTERED entries `tt report run <name> --json` now exports (both yield the one grand
   * total). The total must equal an equivalent ad-hoc report over the same resolved range.
   */
  runReportTotalSeconds(name: string): number;
  /**
   * §09 R06/R09 — export FROM a saved report: the FILTERED entries the report SHOWS (its range
   * narrowed by the def's client/project/tag/search + billable filter), parsed back to the
   * surface-neutral row shape. CoreWorld store.exportSavedReport(name,'csv') → reportFiltered
   * Entries → toCsv; CliWorld `tt report run <name> --csv`. Both must equal each other — the
   * filtered export is byte-identical across surfaces. The RAW escape hatch is a separate
   * scope (`tt export` / "Export All Data" — the whole record), exercised via exportAllRows
   * (or exportRows when a range flag narrows).
   */
  exportSavedReportRows(name: string): ExportRowRec[];
  /**
   * §05 R09 — pin a favorite (a named timer template) from a SOURCE entry: the running entry
   * ('open') or a closed entry's id. The favorite captures that entry's description / client /
   * project / billable / tags. Surface-neutral: CoreWorld store.pinFavorite({ fromEntryId });
   * CliWorld `tt fav add <name> --running` or `tt fav add <name> --from-entry <id>`.
   */
  pinFavoriteFromEntry(name: string, source: number | 'open'): void;
  /**
   * §05 R09 — pin a favorite from EXPLICIT attributes (no source entry). CoreWorld
   * store.pinFavorite({ client/project/billable/tags }); CliWorld `tt fav add <name>
   * --client … --project … [--bill|--no-bill] --tag …`.
   */
  pinFavoriteFromAttrs(o: {
    name: string;
    description?: string;
    client?: string;
    project?: string;
    billable?: boolean;
    tags?: string[];
  }): void;
  /** §05 R09 — the favorites in the rail/list, as surface-neutral records (CoreWorld store.listFavorites / CliWorld `tt fav ls --json`). */
  listFavorites(): FavoriteRec[];
  /** §05 R09 — rename a favorite (CoreWorld store.renameFavorite / CliWorld `tt fav rename`). */
  renameFavorite(name: string, to: string): void;
  /** §05 R09 — unpin a favorite (CoreWorld store.unpinFavorite / CliWorld `tt fav rm`). */
  unpinFavorite(name: string): void;
  /**
   * §05 R10 — resume from a favorite: start a FRESH timer from the favorite's template (the
   * rail's one-click Resume / `tt fav start <name>`). Surface-neutral: CoreWorld
   * store.startFromFavorite(name); CliWorld `tt fav start <name>` then the open id. Returns the
   * new entry's id so a scenario can prove a fresh entry was created.
   */
  startFromFavorite(name: string): { id: number };
  /**
   * §05 R10 — the SECOND CLI entry point for the same core action: `tt start --fav <name>`.
   * Surface-neutral: CoreWorld store.startFromFavorite (the same core call the rail uses);
   * CliWorld `tt start --fav <name>`. Having both routes drive the one core action proves they
   * reach identical behavior at parity (§17 R8).
   */
  startWithFav(name: string): { id: number };
  /**
   * §05 R10 — attempt to resume from a (possibly unknown) favorite, capturing whether it was
   * rejected WITHOUT starting anything. CoreWorld catches the StoreError; CliWorld checks the
   * non-zero exit. Both leave nothing running on a miss (the clean-failure contract).
   */
  attemptStartFromFavorite(name: string): { rejected: boolean };
  /** §05 R10 — the running timer as a surface-neutral record (desc / client label / billable / tags), or null when idle. */
  running(): { description: string | null; clientLabel: string | null; billable: boolean; tags: string[] } | null;
  /**
   * §20 R07 — the persisted check-in schedule's anchor (`startUtc`) as committed durably on
   * disk, or null when no schedule is persisted. Surface-neutral: CoreWorld reads
   * store.checkinState(); CliWorld reads the committed `app_state` row off the SAME database
   * file the tt process wrote (process-per-command, so this proves the schedule was durably
   * committed across the process boundary). The SAME step asserts identical truth on both.
   */
  checkinScheduleAnchor(): string | null;
  /**
   * §20 R04 / §17 R12 — close and re-open the store on the SAME database (a fresh "launch").
   * Surface-neutral: CoreWorld closes the on-disk store and re-opens Store.open at its file (so
   * the launch backup + integrity gate run); CliWorld is process-per-command, so each `tt`
   * invocation already re-opens — this is the explicit relaunch the backup scenarios anchor on.
   * Requires a FILE-backed world (the backup scenarios run only against the file-backed worlds).
   */
  relaunch(): void;
  /**
   * §20 R04 — the number of automatic backups beside the database (store.listBackups().length /
   * `tt backup ls --json`). Non-zero after a launch that found the DB changed since the last copy.
   */
  backupCount(): number;
  /**
   * §20 R04 — the number of entries recorded in the LATEST backup, read independently of the live
   * database (CoreWorld opens the backup file read-only; CliWorld points `tt list` at the backup
   * copy). Proves the backup is a real, recoverable snapshot carrying the same data.
   */
  entriesInLatestBackup(): number;
  /**
   * §20 R03/R05 — corrupt the live main database file on disk (overwrite the SQLite header), as a
   * power-loss / bad-write would. The next relaunch must detect this on open and recover.
   */
  corruptDatabase(): void;
  /**
   * §20 R05 — whether a quarantined `.corrupted-*` sibling now sits beside the database (proof the
   * corrupt file was set aside, not destroyed, during recovery).
   */
  hasQuarantinedFile(): boolean;
  /**
   * §20 R05 / §17 R12 — the explicit named-restore path (the GUI Restore… button /
   * `tt backup restore <name> --force`), distinct from automatic corruption recovery: resolve the
   * newest backup to its NAME and restore the database by that name. The destructive-restore
   * contract sets the pre-restore file aside to a `.replaced-*` sibling (never destroyed). Surface-
   * neutral: CoreWorld store.restoreFromBackup(name) on the open store; CliWorld `tt backup restore
   * <name> --force` (process-per-command). Returns the chosen backup's entry count, read
   * independently of the live DB, so a scenario can prove the reopened database carries exactly that
   * snapshot. Requires a FILE-backed world (the backup scenarios run only against the file worlds).
   */
  restoreLatestBackup(): { chosenEntryCount: number };
  /**
   * §20 R05 — whether a `.replaced-*` sibling now sits beside the database: proof the destructive
   * named restore set the pre-restore file aside rather than destroying it (distinct from the
   * `.corrupted-*` sibling automatic recovery leaves — `hasQuarantinedFile`).
   */
  hasReplacedFile(): boolean;
  /**
   * §20 R03 — write garbage bytes to a FRESH on-disk database path that has NO backup beside it,
   * so the only possible outcome on open is detection + refusal (recovery is impossible without a
   * good copy). Isolated from the backup scenarios' database so this proves the bare detect-and-
   * refuse contract: no quarantine, no restore — just "corruption detected, do not write". Records
   * the exact bytes written so `openCorruptDatabase` can prove the file was not mutated.
   */
  corruptDatabaseFile(): void;
  /**
   * §20 R03 — attempt to open/use the corrupted (backup-less) database on this surface through the
   * NORMAL open path and report whether the open was REFUSED (no write could proceed) and whether
   * the corrupt file was MUTATED. `refused` is true when corruption was detected and the open did
   * not fall through to normal operation (core: an open error was thrown; tt: a non-zero exit with
   * an integrity/corruption error on stderr). `wrote` is true when the file's bytes changed versus
   * what `corruptDatabaseFile` wrote — it MUST be false, since R03 must not write to a corrupt file.
   */
  openCorruptDatabase(): { refused: boolean; wrote: boolean };
}

const label = joinClientProject;

/**
 * A fixed clock so derived elapsed is deterministic. NOW_UTC is the same instant in core's
 * stored form — the CLI world hands it to the `tt` subprocess as `TT_NOW`, which is a string
 * on the environment.
 */
const NOW_UTC = '2026-06-24T23:59:00Z';
const NOW = new Date(NOW_UTC);

// ----------------------------------------------------------------- CoreWorld

export class CoreWorld implements World {
  readonly name = 'core';
  private store!: Store;
  private clock: Clock = () => NOW;
  // §20 R04 — CoreWorld is FILE-backed (a temp dir + file), not in-memory, so the backup +
  // recovery scenarios exercise the real on-disk path (Store.open's launch backup + integrity
  // gate). Every other scenario is unaffected — the Store API is identical to the memory store.
  private dir!: string;
  private dbPath!: string;
  // §20 R03 — an isolated, lazily-created temp dir + db path for the bare detect-and-refuse
  // scenario (a corrupt file with NO backup beside it). Kept separate from the backup-feature
  // database (which always carries a launch backup) so this exercises the pure write-refusal
  // path: corruption detected, recovery impossible, the open refused, the file untouched.
  private integrityDir?: string;
  private integrityPath?: string;
  private integrityBytes?: Buffer;

  reset(): void {
    this.store?.close();
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
    this.dir = mkdtempSync(join(tmpdir(), 'stint-bdd-core-'));
    this.dbPath = join(this.dir, 'tt.sqlite');
    this.store = Store.open({ path: this.dbPath, clock: this.clock });
  }
  dispose(): void {
    this.store?.close();
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
    if (this.integrityDir) rmSync(this.integrityDir, { recursive: true, force: true });
  }
  ensureClientProject(client: string, project: string): void {
    const c = this.store.ensureClient(client);
    if (!this.store.findProjectByName(project, c.id)) this.store.addProject(project, c.id);
  }
  private ids(o: { client?: string; project?: string }): {
    clientId: number | null;
    projectId: number | null;
  } {
    // Use core's single name-resolution rule (no surface-specific re-derivation).
    return this.store.resolveClientProjectByName(o);
  }
  start(o: {
    desc: string | null;
    client?: string;
    project?: string;
    billable?: boolean;
    atIso: string;
  }): { id: number } {
    const { clientId, projectId } = this.ids(o);
    const r = this.store.start({
      description: o.desc,
      clientId,
      projectId,
      billable: o.billable,
      atUtc: o.atIso,
    });
    return { id: r.value.id };
  }
  attemptStart(o: { desc: string | null; client?: string; project?: string; atIso: string }): {
    rejected: boolean;
  } {
    try {
      const { clientId, projectId } = this.ids(o);
      this.store.start({ description: o.desc, clientId, projectId, atUtc: o.atIso });
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  stop(atIso: string): void {
    this.store.stop({ atUtc: atIso });
  }
  resume(): { id: number } {
    return { id: this.store.resume().value.id };
  }
  backfill(o: { desc: string; from: string; to: string; client?: string; project?: string }): {
    id: number;
    warned: boolean;
  } {
    const { clientId, projectId } = this.ids(o);
    const r = this.store.add({
      description: o.desc,
      fromUtc: o.from,
      toUtc: o.to,
      clientId,
      projectId,
    });
    return { id: r.value.id, warned: r.warnings.length > 0 };
  }
  backfillAt(o: {
    desc: string;
    fromIso: string;
    toIso: string;
    client?: string;
    project?: string;
    tags?: string[];
    billable?: boolean;
  }): { id: number } {
    const { clientId, projectId } = this.ids(o);
    const r = this.store.add({
      description: o.desc,
      fromUtc: o.fromIso,
      toUtc: o.toIso,
      clientId,
      projectId,
      ...(o.tags && o.tags.length ? { tags: o.tags } : {}),
      ...(o.billable !== undefined ? { billable: o.billable } : {}),
    });
    return { id: r.value.id };
  }
  edit(id: number, patch: { desc?: string; startUtc?: string; billable?: boolean }): void {
    this.store.edit(id, {
      ...(patch.desc !== undefined ? { description: patch.desc } : {}),
      ...(patch.startUtc !== undefined ? { startUtc: patch.startUtc } : {}),
      ...(patch.billable !== undefined ? { billable: patch.billable } : {}),
    });
  }
  attemptEditStart(id: number, startIso: string): { rejected: boolean } {
    try {
      this.store.edit(id, { startUtc: startIso });
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  remove(id: number): void {
    this.store.remove(id);
  }
  removeUnconfirmed(id: number): { refused: boolean } {
    // §06 R1: the destructive-action gate is the contract. An UNconfirmed delete must not
    // destroy data, so core never auto-confirms it — we refuse WITHOUT calling store.remove,
    // leaving the entry intact (the loss-protection the GUI two-step confirm / `tt rm` gate).
    void id;
    return { refused: true };
  }
  split(id: number, atIso: string): { ids: [number, number] } {
    const [a, b] = this.store.split(id, atIso);
    return { ids: [a.id, b.id] };
  }
  merge(ids: number[], opts?: { client?: string; allowGap?: boolean }): { id: number; warned: boolean } {
    const mergeOpts: Parameters<Store['merge']>[1] = opts?.client
      ? { clientId: this.store.ensureClient(opts.client).id }
      : {};
    if (opts?.allowGap) mergeOpts.allowGap = true;
    const r = this.store.merge(ids, mergeOpts);
    return { id: r.value.id, warned: r.warnings.length > 0 };
  }
  mergeUnacknowledged(ids: number[]): { refused: boolean } {
    // §06 R3: core refuses a gapped selection unless allowGap acknowledges it. We call merge
    // WITHOUT allowGap and treat the StoreError as the refusal — the originals are untouched
    // (the fold never ran), the same loss-protection the GUI gap confirm reaches.
    try {
      this.store.merge(ids);
      return { refused: false };
    } catch (err) {
      if (err instanceof StoreError && /not contiguous/.test(err.message)) return { refused: true };
      throw err;
    }
  }
  seedSleptEntry(o: {
    desc: string;
    from: string;
    to: string;
    sleepFrom: string;
    sleepTo: string;
  }): { id: number } {
    const r = this.store.add({ description: o.desc, fromUtc: o.from, toUtc: o.to });
    this.store.recordSleepSpan(r.value.id, o.sleepFrom, o.sleepTo, 'gap');
    return { id: r.value.id };
  }
  subtractSleep(id: number): void {
    this.store.subtractSleep(id);
  }
  addClient(name: string): void {
    this.store.ensureClient(name);
  }
  addProject(name: string, client: string): void {
    const c = this.store.ensureClient(client);
    this.store.addProject(name, c.id);
  }
  renameClient(name: string, to: string): void {
    const c = this.store.findClientByName(name);
    if (!c) throw new Error(`no client "${name}"`);
    this.store.renameClient(c.id, to);
  }
  archiveClient(name: string): void {
    const c = this.store.findClientByName(name);
    if (!c) throw new Error(`no client "${name}"`);
    this.store.archiveClient(c.id);
  }
  activeClientNames(): string[] {
    return this.store.listClients().map((c) => c.name);
  }
  renameProject(name: string, to: string): void {
    const p = this.store.findProjectByName(name);
    if (!p) throw new Error(`no project "${name}"`);
    this.store.renameProject(p.id, to);
  }
  archiveProject(name: string): void {
    const p = this.store.findProjectByName(name);
    if (!p) throw new Error(`no project "${name}"`);
    this.store.archiveProject(p.id);
  }
  activeProjectNames(): string[] {
    return this.store.listProjects().map((p) => p.name);
  }
  restoreClient(name: string): void {
    const c = this.store.findClientByName(name);
    if (!c) throw new Error(`no client "${name}"`);
    this.store.restoreClient(c.id);
  }
  restoreProject(name: string): void {
    const p = this.store.findProjectByName(name);
    if (!p) throw new Error(`no project "${name}"`);
    this.store.restoreProject(p.id);
  }
  restoreTag(name: string): void {
    const t = this.store.findTagByName(name);
    if (!t) throw new Error(`no tag "${name}"`);
    this.store.restoreTag(t.id);
  }
  attemptRestoreProject(name: string): { rejected: boolean } {
    try {
      this.restoreProject(name);
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  addTag(name: string): void {
    this.store.addTag(name);
  }
  renameTag(name: string, to: string): void {
    const t = this.store.findTagByName(name);
    if (!t) throw new Error(`no tag "${name}"`);
    this.store.renameTag(t.id, to);
  }
  archiveTag(name: string): void {
    const t = this.store.findTagByName(name);
    if (!t) throw new Error(`no tag "${name}"`);
    this.store.archiveTag(t.id);
  }
  activeTagNames(): string[] {
    return this.store.listTags().map((t) => t.name);
  }
  attemptAddClient(name: string): { rejected: boolean } {
    try {
      this.store.addClient(name);
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  attemptAddProject(name: string, client: string): { rejected: boolean } {
    try {
      const c = this.store.ensureClient(client);
      this.store.addProject(name, c.id);
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  attemptAddTag(name: string): { rejected: boolean } {
    try {
      this.store.addTag(name);
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  attemptRenameClient(name: string, to: string): { rejected: boolean } {
    try {
      const c = this.store.findClientByName(name);
      if (!c) throw new Error(`no client "${name}"`);
      this.store.renameClient(c.id, to);
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  attemptRenameProject(name: string, to: string): { rejected: boolean } {
    try {
      const p = this.store.findProjectByName(name);
      if (!p) throw new Error(`no project "${name}"`);
      this.store.renameProject(p.id, to);
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  attemptRenameTag(name: string, to: string): { rejected: boolean } {
    try {
      const t = this.store.findTagByName(name);
      if (!t) throw new Error(`no tag "${name}"`);
      this.store.renameTag(t.id, to);
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  setConfig(key: string, value: string): void {
    // §12 R11/§14: drive the SAME descriptor-based parse the CLI's `config set` uses, so the
    // snake_case key + raw string round-trip identically on both surfaces.
    const d = settingDescriptor(key);
    if (!d) throw new Error(`unknown setting "${key}"`);
    const parsed = d.parse(value);
    if (parsed === undefined) throw new Error(`invalid value for ${key}: "${value}"`);
    this.store.setSetting(d.key, parsed as never);
  }
  getConfig(key: string): string {
    const d = settingDescriptor(key);
    if (!d) throw new Error(`unknown setting "${key}"`);
    return String((this.store.settings() as unknown as Record<string, unknown>)[d.key]);
  }
  attemptSetConfig(key: string, value: string): { rejected: boolean } {
    // §14 — the same descriptor parse + store.setSetting the happy path uses; a parse miss
    // or a validation throw (including the cross-field start<end pair) IS the rejection,
    // and nothing was stored.
    try {
      this.setConfig(key, value);
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  renderedStart(desc: string): string {
    // §04 R06: core's ONE formatting path over the store's own settings — the same call the
    // GUI's stamp labels make (formatStamp honors time_zone + date_format).
    const entry = this.store.listEntries().find((e) => e.description === desc);
    if (!entry) throw new Error(`no entry "${desc}"`);
    return formatStamp(entry.startUtc, this.store.settings());
  }
  list(): EntryRec[] {
    return this.store.listEntries().map((e) => ({
      id: e.id,
      description: e.description,
      startUtc: e.startUtc,
      endUtc: e.endUtc,
      billableSeconds: e.billableSeconds,
      billable: e.billable,
      clientLabel: label(e.clientName, e.projectName),
    }));
  }
  search(query: string): EntryRec[] {
    // §09 R7: the same free-text filter the GUI search box drives — core narrows on
    // description / client / project / tag, the surface re-derives nothing.
    return this.store.listEntries({ search: query }).map((e) => ({
      id: e.id,
      description: e.description,
      startUtc: e.startUtc,
      endUtc: e.endUtc,
      billableSeconds: e.billableSeconds,
      billable: e.billable,
      clientLabel: label(e.clientName, e.projectName),
    }));
  }
  listFiltered(req: ListFilterReq): EntryRec[] {
    // §11: resolve the range (preset through core's resolveRange, or explicit), narrow through
    // store.listEntries (client/project/tag/billable/search all resolve there) — the SAME flat
    // set `tt list` returns below. No grouping: grouping left the list for Reports (G11).
    const bounds = req.preset
      ? resolveRange(req.preset, this.store.settings().weekStart, this.clock())
      : req.fromUtc && req.toUtc
        ? { fromUtc: req.fromUtc, toUtc: req.toUtc }
        : undefined;
    const filter: Parameters<Store['listEntries']>[0] = {
      billable: req.billable ?? 'all',
    };
    if (bounds) {
      filter.fromUtc = bounds.fromUtc;
      filter.toUtc = bounds.toUtc;
    }
    if (req.client) {
      const c = this.store.findClientByName(req.client);
      if (!c) return [];
      filter.clientId = c.id;
    }
    if (req.project) {
      const p = this.store.findProjectByName(req.project, filter.clientId);
      if (!p) return [];
      filter.projectId = p.id;
    }
    if (req.tag) filter.tag = req.tag;
    if (req.search) filter.search = req.search;
    return this.store.listEntries(filter).map((e) => ({
      id: e.id,
      description: e.description,
      startUtc: e.startUtc,
      endUtc: e.endUtc,
      billableSeconds: e.billableSeconds,
      billable: e.billable,
      clientLabel: label(e.clientName, e.projectName),
    }));
  }
  status(): StatusRec {
    const s = this.store.status();
    if (!s.entry) return { running: false, description: null, clientLabel: null };
    return {
      running: true,
      description: s.entry.description,
      clientLabel: label(s.entry.clientName, s.entry.projectName),
    };
  }
  reportOverlaps(fromIso: string, toIso: string): number[] {
    return this.store.report({
      fromUtc: fromIso,
      toUtc: toIso,
      by: 'client',
      billableFilter: 'all',
      rounding: false,
      roundingIncrementMin: 15,
    }).overlappedEntryIds;
  }
  report(req: ReportReq): ReportRec {
    // §09 R1: the preset resolves through core's resolveRange (the same rule the GUI
    // picker drives), against the fixed clock; the custom path passes from/to through.
    const bounds = req.preset
      ? resolveRange(req.preset, this.store.settings().weekStart, this.clock())
      : { fromUtc: req.fromUtc!, toUtc: req.toUtc! };
    const r = this.store.report({
      fromUtc: bounds.fromUtc,
      toUtc: bounds.toUtc,
      by: req.by,
      billableFilter: req.billableFilter,
      // §09 R4: rounding is OFF by default; when the request turns it on it carries the
      // increment the GUI Rounding picker chose. Core owns the nearest-increment math.
      rounding: req.rounding ?? false,
      roundingIncrementMin: req.roundingIncrementMin ?? 15,
    });
    return {
      grandTotalSeconds: r.grandTotalSeconds,
      grandRoundedSeconds: r.grandRoundedSeconds,
      lines: r.lines.map((l) => ({
        key: l.key,
        totalSeconds: l.totalSeconds,
        roundedSeconds: l.roundedSeconds,
      })),
      rangeFromUtc: r.rangeFromUtc,
      rangeToUtc: r.rangeToUtc,
    };
  }
  exportRows(o: { fromUtc: string; toUtc: string; format: 'csv' | 'json' }): ExportRowRec[] {
    // §09 R6: the RAW entries for the range (billable='all', no grouping/rounding) —
    // exactly what `tt export` lists and what the GUI Export buttons round through main —
    // rendered via the SAME core toCsv/toJsonEntries the CLI uses, then parsed back to the
    // surface-neutral row shape so the export contract can be asserted identical on both.
    const entries = this.store.listEntries({
      fromUtc: o.fromUtc,
      toUtc: o.toUtc,
      billable: 'all',
    });
    const now = this.clock();
    if (o.format === 'json') {
      return toJsonEntries(entries, now).map((e) => ({
        description: e.description,
        client: e.client,
        rawSeconds: e.raw_duration_s,
        billable: e.billable,
      }));
    }
    return parseCsvExport(toCsv(entries, now));
  }
  exportAllRows(format: 'csv' | 'json'): ExportRowRec[] {
    // §09 R06: the WHOLE RECORD — listEntries with no range keys (billable='all'), rendered
    // via the SAME core exporters — exactly what no-flag `tt export` and the GUI's always-on
    // "Export All Data" buttons write.
    const entries = this.store.listEntries({ billable: 'all' });
    const now = this.clock();
    if (format === 'json') {
      return toJsonEntries(entries, now).map((e) => ({
        description: e.description,
        client: e.client,
        rawSeconds: e.raw_duration_s,
        billable: e.billable,
      }));
    }
    return parseCsvExport(toCsv(entries, now));
  }
  saveReport(o: {
    name: string;
    preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month';
    by: 'client' | 'project' | 'day' | 'tag';
    billableFilter: 'billable' | 'all' | 'non-billable';
    rounding?: boolean;
    roundingIncrementMin?: number;
  }): void {
    // §09 R08: the saved range is the relative preset spec — re-resolved through core's
    // resolveRange on each run, the SAME rule the ad-hoc report path uses.
    this.store.saveReport({
      name: o.name,
      rangeSpec: { kind: 'preset', preset: o.preset },
      by: o.by,
      billableFilter: o.billableFilter,
      rounding: o.rounding ?? false,
      roundingIncrementMin: o.roundingIncrementMin ?? 15,
    });
  }
  attemptSaveReport(o: {
    name: string;
    preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month';
    by: 'client' | 'project' | 'day' | 'tag';
    billableFilter: 'billable' | 'all' | 'non-billable';
  }): { rejected: boolean } {
    // §13 — the SAME saveReport the happy path uses; core's assertNameFree throw on a duplicate
    // (UNIQUE COLLATE NOCASE) IS the rejection, and the transaction rolls back so nothing persists.
    try {
      this.saveReport(o);
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  saveReportRange(o: {
    name: string;
    fromUtc: string;
    toUtc: string;
    by: 'client' | 'project' | 'day' | 'tag';
    billableFilter: 'billable' | 'all' | 'non-billable';
  }): void {
    // §09 R01/R08: an ABSOLUTE spec freezes the exact from/to bounds (no re-resolution).
    this.store.saveReport({
      name: o.name,
      rangeSpec: { kind: 'absolute', fromUtc: o.fromUtc, toUtc: o.toUtc },
      by: o.by,
      billableFilter: o.billableFilter,
      rounding: false,
      roundingIncrementMin: 15,
    });
  }
  attemptSaveReportRange(o: {
    name: string;
    fromUtc: string;
    toUtc: string;
    by: 'client' | 'project' | 'day' | 'tag';
    billableFilter: 'billable' | 'all' | 'non-billable';
  }): { rejected: boolean } {
    // §09 R01/R08 — the SAME saveReport the happy path uses; core's from ≤ to guard throws on
    // an inverted window and the transaction rolls back, so nothing persists.
    try {
      this.saveReportRange(o);
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  attemptEditReportRange(name: string, o: { fromUtc: string; toUtc: string }): { rejected: boolean } {
    try {
      this.store.editReport(name, {
        rangeSpec: { kind: 'absolute', fromUtc: o.fromUtc, toUtc: o.toUtc },
      });
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  listReportNames(): string[] {
    return this.store.listReports().map((d) => d.name);
  }
  editReportRange(name: string, preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month'): void {
    this.store.editReport(name, { rangeSpec: { kind: 'preset', preset } });
  }
  editReportBy(name: string, by: 'client' | 'project' | 'day' | 'tag'): void {
    this.store.editReport(name, { by });
  }
  renameReport(name: string, to: string): void {
    this.store.renameReport(name, to);
  }
  removeReport(name: string): void {
    this.store.removeReport(name);
  }
  runReportTotalSeconds(name: string): number {
    return this.store.runReport(name, this.clock()).grandTotalSeconds;
  }
  exportSavedReportRows(name: string): ExportRowRec[] {
    // §09 R06/R09: the FILTERED rows the saved report shows — store.exportSavedReport renders
    // the SAME core toCsv `tt report run --csv` does (via reportFilteredEntries).
    return parseCsvExport(this.store.exportSavedReport(name, 'csv', this.clock()));
  }
  pinFavoriteFromEntry(name: string, source: number | 'open'): void {
    // §05 R09: capture the template off a source entry — core reads its description /
    // client / project / billable / tags into the favorite.
    this.store.pinFavorite({ name, fromEntryId: source });
  }
  pinFavoriteFromAttrs(o: {
    name: string;
    description?: string;
    client?: string;
    project?: string;
    billable?: boolean;
    tags?: string[];
  }): void {
    // §05 R09: explicit attributes — resolve client/project through core's single rule.
    const { clientId, projectId } = this.ids(o);
    this.store.pinFavorite({
      name: o.name,
      description: o.description ?? null,
      clientId,
      projectId,
      ...(o.billable !== undefined ? { billable: o.billable } : {}),
      ...(o.tags ? { tags: o.tags } : {}),
    });
  }
  listFavorites(): FavoriteRec[] {
    const clientNames = new Map(this.store.listClients(true).map((c) => [c.id, c.name]));
    const projectNames = new Map(this.store.listProjects(undefined, true).map((p) => [p.id, p.name]));
    return this.store.listFavorites().map((f) => ({
      name: f.name,
      description: f.description,
      clientLabel: label(
        f.clientId !== null ? clientNames.get(f.clientId) ?? null : null,
        f.projectId !== null ? projectNames.get(f.projectId) ?? null : null,
      ),
      billable: f.billable,
      tags: f.tags,
    }));
  }
  renameFavorite(name: string, to: string): void {
    this.store.renameFavorite(name, to);
  }
  unpinFavorite(name: string): void {
    this.store.unpinFavorite(name);
  }
  startFromFavorite(name: string): { id: number } {
    // §05 R10: a FRESH entry from the favorite's template — core delegates to start (atomic
    // stop-then-start), the favorite itself unchanged.
    return { id: this.store.startFromFavorite(name).value.id };
  }
  startWithFav(name: string): { id: number } {
    // §05 R10: the `tt start --fav` route reaches the SAME core action.
    return { id: this.store.startFromFavorite(name).value.id };
  }
  attemptStartFromFavorite(name: string): { rejected: boolean } {
    try {
      this.store.startFromFavorite(name);
      return { rejected: false };
    } catch {
      return { rejected: true };
    }
  }
  running(): { description: string | null; clientLabel: string | null; billable: boolean; tags: string[] } | null {
    const open = this.store.openEntry();
    if (!open) return null;
    return {
      description: open.description,
      clientLabel: label(open.clientName, open.projectName),
      billable: open.billable,
      tags: open.tags,
    };
  }
  checkinScheduleAnchor(): string | null {
    // §20 R07 — read the schedule the entry transitions committed atomically through the
    // typed core reader (the same one the GUI tick uses).
    return this.store.checkinState()?.startUtc ?? null;
  }
  relaunch(): void {
    // §20 R04 — close and re-open the store on the same file: a fresh launch, so Store.open's
    // launch backup (and the integrity gate + recovery, if the file is corrupt) run. Tolerate an
    // already-closed store (corruptDatabase leaves it closed) so the relaunch step is idempotent.
    try {
      this.store.close();
    } catch {
      /* already closed (post-corruption) */
    }
    this.store = Store.open({ path: this.dbPath, clock: this.clock });
  }
  backupCount(): number {
    return this.store.listBackups().length;
  }
  entriesInLatestBackup(): number {
    // §20 R04 — read the LATEST backup independently of the live DB (open it read-only-ish via a
    // fresh handle) and count its entries: the backup is a real, recoverable snapshot.
    const latest = this.store.listBackups()[0];
    if (!latest) return 0;
    const db = openDb(latest.path);
    try {
      return (db.prepare('SELECT COUNT(*) AS n FROM entry').get() as { n: number }).n;
    } finally {
      db.close();
    }
  }
  corruptDatabase(): void {
    // §20 R03 — overwrite the SQLite header so the next open's quick_check fails. Close the store
    // first (folding any WAL into the main file), then clobber the on-disk header. The world is
    // left WITHOUT a live store: the scenario's next step is the relaunch that detects + recovers.
    this.store.close();
    const fd = openSync(this.dbPath, 'r+');
    try {
      // Clobber the 16-byte "SQLite format 3\0" magic at offset 0 — guaranteed-detectable damage.
      writeSync(fd, Buffer.from('xxxxxxxxxxxxxxxx'), 0, 16, 0);
    } finally {
      closeSync(fd);
    }
  }
  hasQuarantinedFile(): boolean {
    return readdirSync(this.dir).some((f) => f.startsWith(`${basename(this.dbPath)}.corrupted-`));
  }
  restoreLatestBackup(): { chosenEntryCount: number } {
    // §20 R05 / §17 R12 — resolve the newest backup's NAME and restore the OPEN store by it (the
    // explicit Restore… path, not automatic recovery). Read the chosen backup's entry count first,
    // independently of the live DB (a fresh handle on the backup file), so the caller can prove the
    // reopened DB carries that snapshot. store.restoreFromBackup quarantines the current file to a
    // `.replaced-*` sibling, copies the chosen backup into place, and reopens.
    const chosen = this.store.listBackups()[0];
    if (!chosen) throw new Error('no backup to restore from');
    const db = openDb(chosen.path);
    let chosenEntryCount: number;
    try {
      chosenEntryCount = (db.prepare('SELECT COUNT(*) AS n FROM entry').get() as { n: number }).n;
    } finally {
      db.close();
    }
    this.store.restoreFromBackup(chosen.name);
    return { chosenEntryCount };
  }
  hasReplacedFile(): boolean {
    return readdirSync(this.dir).some((f) => f.startsWith(`${basename(this.dbPath)}.replaced-`));
  }
  corruptDatabaseFile(): void {
    // §20 R03 — a brand-new temp dir holding only a garbage "database" file: no `.bak-*` sibling
    // exists, so the open below cannot recover and the ONLY correct outcome is detect-and-refuse.
    this.integrityDir = mkdtempSync(join(tmpdir(), 'stint-bdd-core-integrity-'));
    this.integrityPath = join(this.integrityDir, 'tt.sqlite');
    this.integrityBytes = Buffer.from('this is not a sqlite database');
    writeFileSync(this.integrityPath, this.integrityBytes);
  }
  openCorruptDatabase(): { refused: boolean; wrote: boolean } {
    // §20 R03 — open the corrupt, backup-less file through the SAME openDb every launch uses.
    // quick_check fails (or the pragmas raise "file is not a database"), recovery finds no backup
    // and throws RecoveryError — the open is REFUSED before any write. Catching it proves the
    // refusal; re-reading the file proves the corrupt bytes were left exactly as written (no write).
    let refused = false;
    let db: ReturnType<typeof openDb> | undefined;
    try {
      db = openDb(this.integrityPath!);
    } catch (err) {
      // An open error (RecoveryError: corruption detected, no backup to recover from) is the
      // refusal — corruption was caught and the open did not fall through to normal operation.
      refused = err instanceof RecoveryError;
    } finally {
      try {
        db?.close();
      } catch {
        /* never opened a usable handle */
      }
    }
    const after = readFileSync(this.integrityPath!);
    const wrote = !after.equals(this.integrityBytes!);
    return { refused, wrote };
  }
}

/**
 * Parse the CSV export's column contract back to the surface-neutral row shape. Mirrors
 * how a billing tool consumes `tt export --csv`: header row, then one row per entry with
 * the CSV_COLUMNS order (client, project, tags, description, start, end, raw_s, …). Kept
 * minimal — it only pulls the columns the export scenarios assert on, and handles the one
 * quoting rule core's csvCell uses (a quoted cell may contain doubled quotes / commas).
 */
function parseCsvExport(csv: string): ExportRowRec[] {
  const lines = csv.replace(/\n$/, '').split('\n');
  const header = splitCsvRow(lines[0]!);
  const col = (name: string): number => header.indexOf(name);
  const iClient = col('client');
  const iDesc = col('description');
  const iRaw = col('raw_duration_s');
  const iBill = col('billable');
  return lines.slice(1).map((line) => {
    const cells = splitCsvRow(line);
    return {
      client: cells[iClient] === '' ? null : cells[iClient]!,
      description: cells[iDesc] === '' ? null : cells[iDesc]!,
      rawSeconds: Number(cells[iRaw]),
      billable: cells[iBill] === 'true',
    };
  });
}

/** Split one CSV row honoring double-quote escaping (the inverse of core's csvCell). */
function splitCsvRow(row: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

// ------------------------------------------------------------------ CliWorld

const BIN = fileURLToPath(new URL('../../../cli/dist/bin.js', import.meta.url));

export class CliWorld implements World {
  readonly name = 'cli';
  private dir!: string;
  private db!: string;

  reset(): void {
    this.dir = mkdtempSync(join(tmpdir(), 'stint-bdd-'));
    this.db = join(this.dir, 'tt.sqlite');
  }
  dispose(): void {
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
  }
  private tt(args: string[]): { out: string; err: string; code: number } {
    const res = spawnSync('node', [BIN, ...args], {
      encoding: 'utf8',
      env: { ...process.env, TT_DB: this.db, TT_NOW: NOW_UTC, NODE_NO_WARNINGS: '1' },
    });
    return { out: res.stdout ?? '', err: res.stderr ?? '', code: res.status ?? 0 };
  }
  ensureClientProject(client: string, project: string): void {
    this.tt(['client', 'add', client]);
    this.tt(['project', 'add', project, '--client', client]);
  }
  start(o: {
    desc: string | null;
    client?: string;
    project?: string;
    billable?: boolean;
    atIso: string;
  }): { id: number } {
    const args = ['start'];
    if (o.desc) args.push(o.desc);
    if (o.client) args.push('--client', o.client);
    if (o.project) args.push('--project', o.project);
    if (o.billable === true) args.push('--bill');
    if (o.billable === false) args.push('--no-bill');
    args.push('--at', o.atIso);
    this.tt(args);
    return { id: this.openId()! };
  }
  attemptStart(o: { desc: string | null; client?: string; project?: string; atIso: string }): {
    rejected: boolean;
  } {
    // §05 R01 / §16 (#61): `tt start --at <before-open-start>` exits non-zero with the StoreError
    // on stderr and stores nothing — the surface's rejection signal (the twin of CoreWorld's catch).
    const args = ['start'];
    if (o.desc) args.push(o.desc);
    if (o.client) args.push('--client', o.client);
    if (o.project) args.push('--project', o.project);
    args.push('--at', o.atIso);
    const r = this.tt(args);
    return { rejected: r.code !== 0 };
  }
  stop(atIso: string): void {
    this.tt(['stop', '--at', atIso]);
  }
  resume(): { id: number } {
    this.tt(['resume']);
    return { id: this.openId()! };
  }
  backfill(o: { desc: string; from: string; to: string; client?: string; project?: string }): {
    id: number;
    warned: boolean;
  } {
    const args = ['add', o.desc, '--from', o.from, '--to', o.to];
    if (o.client) args.push('--client', o.client);
    if (o.project) args.push('--project', o.project);
    const r = this.tt(args);
    const id = Number(/added entry (\d+)/.exec(r.out)?.[1]);
    return { id, warned: /warning/.test(r.err) };
  }
  backfillAt(o: {
    desc: string;
    fromIso: string;
    toIso: string;
    client?: string;
    project?: string;
    tags?: string[];
    billable?: boolean;
  }): { id: number } {
    const args = ['add', o.desc, '--from', o.fromIso, '--to', o.toIso];
    if (o.client) args.push('--client', o.client);
    if (o.project) args.push('--project', o.project);
    for (const t of o.tags ?? []) args.push('--tag', t);
    if (o.billable === true) args.push('--bill');
    if (o.billable === false) args.push('--no-bill');
    const r = this.tt(args);
    const id = Number(/added entry (\d+)/.exec(r.out)?.[1]);
    return { id };
  }
  edit(id: number, patch: { desc?: string; startUtc?: string; billable?: boolean }): void {
    const args = ['edit', String(id)];
    if (patch.desc !== undefined) args.push('--desc', patch.desc);
    if (patch.startUtc !== undefined) args.push('--from', patch.startUtc);
    if (patch.billable === true) args.push('--bill');
    if (patch.billable === false) args.push('--no-bill');
    this.tt(args);
  }
  attemptEditStart(id: number, startIso: string): { rejected: boolean } {
    // §05 R06 / §16 (#61): `tt edit --from <future>` on the running row exits non-zero with the
    // StoreError on stderr and stores nothing — that non-zero exit is the surface's rejection
    // signal (the twin of CoreWorld catching the throw).
    const r = this.tt(['edit', String(id), '--from', startIso]);
    return { rejected: r.code !== 0 };
  }
  remove(id: number): void {
    // §06 R1: `tt rm` refuses without confirmation (proven at GOLD); pass --force to delete,
    // exercising the same store.remove the GUI Delete-confirm dialog reaches.
    this.tt(['rm', String(id), '--force']);
  }
  removeUnconfirmed(id: number): { refused: boolean } {
    // §06 R1: `tt rm` WITHOUT --force is the unconfirmed path — it refuses on stderr with a
    // non-zero exit and does NOT delete (the same confirm gate the GUI two-step reaches). We
    // assert the refusal signal and do NOT delete, so the entry survives on this surface too.
    const r = this.tt(['rm', String(id)]);
    const refused = r.code !== 0 && /refusing to delete/.test(r.err);
    return { refused };
  }
  split(id: number, atIso: string): { ids: [number, number] } {
    const r = this.tt(['split', String(id), '--at', atIso]);
    const m = /into (\d+) and (\d+)/.exec(r.out)!;
    return { ids: [Number(m[1]), Number(m[2])] };
  }
  merge(ids: number[], opts?: { client?: string; allowGap?: boolean }): { id: number; warned: boolean } {
    const args = ['merge', ...ids.map(String)];
    if (opts?.client) args.push('--client', opts.client);
    if (opts?.allowGap) args.push('--allow-gap');
    const r = this.tt(args);
    const id = Number(/merged into entry (\d+)/.exec(r.out)?.[1]);
    return { id, warned: /warning/.test(r.err) };
  }
  mergeUnacknowledged(ids: number[]): { refused: boolean } {
    // §06 R3: `tt merge` WITHOUT --allow-gap is the unacknowledged path — it refuses a gapped
    // selection on stderr with a non-zero exit and folds nothing (the same gate the GUI gap
    // confirm reaches). We assert the refusal signal and leave the originals intact.
    const r = this.tt(['merge', ...ids.map(String)]);
    const refused = r.code !== 0 && /not contiguous/.test(r.err);
    return { refused };
  }
  seedSleptEntry(o: {
    desc: string;
    from: string;
    to: string;
    sleepFrom: string;
    sleepTo: string;
  }): { id: number } {
    const r = this.tt(['add', o.desc, '--from', o.from, '--to', o.to]);
    const id = Number(/added entry (\d+)/.exec(r.out)?.[1]);
    // No CLI verb records a sleep span — detection is GUI-resident, the CLI review-only (PRD §10a
    // item 7, "Detection residency") — so seed it by opening a transient Store on the same db
    // file — the same direct-db access the backup helpers use — then close it before the next
    // `tt` process runs (tt is process-per-command).
    const store = Store.open({ path: this.db, clock: () => NOW });
    try {
      store.recordSleepSpan(id, o.sleepFrom, o.sleepTo, 'gap');
    } finally {
      store.close();
    }
    return { id };
  }
  subtractSleep(id: number): void {
    this.tt(['sleep', 'subtract', String(id)]);
  }
  addClient(name: string): void {
    this.tt(['client', 'add', name]);
  }
  addProject(name: string, client: string): void {
    // `tt project add --client` ensures the owning client itself (the CLI handler calls
    // ensureClient), so no separate `client add` is needed — matching CoreWorld.addProject.
    this.tt(['project', 'add', name, '--client', client]);
  }
  renameClient(name: string, to: string): void {
    this.tt(['client', 'rename', name, to]);
  }
  archiveClient(name: string): void {
    this.tt(['client', 'archive', name]);
  }
  activeClientNames(): string[] {
    const r = this.tt(['client', 'ls', '--json']);
    return (JSON.parse(r.out || '[]') as { name: string }[]).map((c) => c.name);
  }
  renameProject(name: string, to: string): void {
    this.tt(['project', 'rename', name, to]);
  }
  archiveProject(name: string): void {
    this.tt(['project', 'archive', name]);
  }
  activeProjectNames(): string[] {
    const r = this.tt(['project', 'ls', '--json']);
    return (JSON.parse(r.out || '[]') as { name: string }[]).map((p) => p.name);
  }
  restoreClient(name: string): void {
    this.tt(['client', 'restore', name]);
  }
  restoreProject(name: string): void {
    this.tt(['project', 'restore', name]);
  }
  restoreTag(name: string): void {
    this.tt(['tag', 'restore', name]);
  }
  attemptRestoreProject(name: string): { rejected: boolean } {
    // §12 R13 edge — `tt project restore` exits non-zero when the owning client is still archived.
    return { rejected: this.tt(['project', 'restore', name]).code !== 0 };
  }
  addTag(name: string): void {
    this.tt(['tag', 'add', name]);
  }
  renameTag(name: string, to: string): void {
    this.tt(['tag', 'rename', name, to]);
  }
  archiveTag(name: string): void {
    this.tt(['tag', 'archive', name]);
  }
  activeTagNames(): string[] {
    const r = this.tt(['tag', 'ls', '--json']);
    return (JSON.parse(r.out || '[]') as { name: string }[]).map((t) => t.name);
  }
  attemptAddClient(name: string): { rejected: boolean } {
    // §07 R03 (#64) — `tt client add` exits non-zero on a duplicate; that IS the rejection.
    return { rejected: this.tt(['client', 'add', name]).code !== 0 };
  }
  attemptAddProject(name: string, client: string): { rejected: boolean } {
    return { rejected: this.tt(['project', 'add', name, '--client', client]).code !== 0 };
  }
  attemptAddTag(name: string): { rejected: boolean } {
    return { rejected: this.tt(['tag', 'add', name]).code !== 0 };
  }
  attemptRenameClient(name: string, to: string): { rejected: boolean } {
    return { rejected: this.tt(['client', 'rename', name, to]).code !== 0 };
  }
  attemptRenameProject(name: string, to: string): { rejected: boolean } {
    return { rejected: this.tt(['project', 'rename', name, to]).code !== 0 };
  }
  attemptRenameTag(name: string, to: string): { rejected: boolean } {
    return { rejected: this.tt(['tag', 'rename', name, to]).code !== 0 };
  }
  setConfig(key: string, value: string): void {
    // §12 R11/§14: the GUI Settings view's edit, reached from tt via `config set <snake>` —
    // the descriptor-driven CLI command both surfaces share.
    this.tt(['config', 'set', key, value]);
  }
  getConfig(key: string): string {
    // Read back through `config ls --json` (the camelCase Settings object), mapping the
    // snake_case key to its camelCase descriptor key.
    const d = settingDescriptor(key);
    if (!d) throw new Error(`unknown setting "${key}"`);
    const obj = JSON.parse(this.tt(['config', 'ls', '--json']).out || '{}') as Record<string, unknown>;
    return String(obj[d.key]);
  }
  attemptSetConfig(key: string, value: string): { rejected: boolean } {
    // §14 — an invalid `tt config set` exits non-zero with a diagnostic on stderr and
    // stores nothing; that non-zero exit is the surface's rejection signal.
    const r = this.tt(['config', 'set', key, value]);
    return { rejected: r.code !== 0 };
  }
  renderedStart(desc: string): string {
    // §04 R06: read the START cell off the HUMAN `tt list` table — the recorded behavior
    // change (no raw UTC ISO): the stamp is the configured zone's wall clock through core's
    // formatStamp. The scenario pins date_format=iso, so the cell is `YYYY-MM-DD HH:MM:SS`.
    const r = this.tt(['list', '--all']);
    const line = r.out.split('\n').find((l) => desc !== '' && l.includes(desc));
    if (!line) throw new Error(`no tt list row for "${desc}" in:\n${r.out}`);
    const m = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.exec(line);
    if (!m) throw new Error(`no rendered stamp on the row: ${line}`);
    return m[0];
  }
  list(): EntryRec[] {
    return this.listRows(['list', '--all', '--json']);
  }
  search(query: string): EntryRec[] {
    // §09 R7: full parity for the flag — the GUI search box's query is `tt list --search`.
    return this.listRows(['list', '--all', '--json', '--search', query]);
  }
  listFiltered(req: ListFilterReq): EntryRec[] {
    // §11: list through `tt list … --json` (range/client/project/tag/search/billable all narrow
    // there) — the flat row array, NO `--by` (grouping moved to `tt report`, G11). Parsed back to
    // the surface-neutral EntryRec so the flat set is compared identical to CoreWorld's (§17 R8).
    const PRESET_FLAG: Record<NonNullable<ListFilterReq['preset']>, string> = {
      today: '--today',
      week: '--week',
      'last-week': '--last-week',
      month: '--month',
      'last-month': '--last-month',
    };
    const args = ['list', '--json'];
    if (req.preset) args.push(PRESET_FLAG[req.preset]);
    else if (req.fromUtc && req.toUtc) args.push('--range', req.fromUtc, req.toUtc);
    if (req.billable === 'all' || req.billable === undefined) args.push('--all');
    else if (req.billable === 'non-billable') args.push('--non-billable');
    if (req.client) args.push('--client', req.client);
    if (req.project) args.push('--project', req.project);
    if (req.tag) args.push('--tag', req.tag);
    if (req.search) args.push('--search', req.search);
    return this.listRows(args);
  }
  private listRows(args: string[]): EntryRec[] {
    const r = this.tt(args);
    const rows = JSON.parse(r.out || '[]') as {
      id: number;
      client: string | null;
      project: string | null;
      description: string | null;
      start_utc: string;
      end_utc: string | null;
      raw_duration_s: number;
      excluded_s: number;
      billable: boolean;
    }[];
    return rows.map((e) => ({
      id: e.id,
      description: e.description,
      startUtc: e.start_utc,
      endUtc: e.end_utc,
      billableSeconds: e.raw_duration_s - e.excluded_s,
      billable: e.billable,
      clientLabel: label(e.client, e.project),
    }));
  }
  private openId(): number | null {
    const s = JSON.parse(this.tt(['status', '--json']).out) as {
      running: boolean;
      entry: { id: number } | null;
    };
    return s.entry?.id ?? null;
  }
  status(): StatusRec {
    const s = JSON.parse(this.tt(['status', '--json']).out) as {
      running: boolean;
      entry: { description: string | null; client: string | null; project: string | null } | null;
    };
    if (!s.running || !s.entry) return { running: false, description: null, clientLabel: null };
    return {
      running: true,
      description: s.entry.description,
      clientLabel: label(s.entry.client, s.entry.project),
    };
  }
  reportOverlaps(fromIso: string, toIso: string): number[] {
    const r = this.tt(['report', '--range', fromIso, toIso, '--all', '--json']);
    return (JSON.parse(r.out) as { overlapped_entry_ids: number[] }).overlapped_entry_ids;
  }
  report(req: ReportReq): ReportRec {
    // §09 R1: the preset maps to `tt report --<preset>` (which resolves through the same
    // core resolveRange); the custom path maps to `tt report --range FROM TO`. Both stay
    // at full parity with the GUI picker — the resolution lives in core, not the surface.
    const PRESET_FLAG: Record<NonNullable<ReportReq['preset']>, string> = {
      today: '--today',
      week: '--week',
      'last-week': '--last-week',
      month: '--month',
      'last-month': '--last-month',
    };
    const args = ['report', '--by', req.by, '--json'];
    if (req.preset) args.push(PRESET_FLAG[req.preset]);
    else args.push('--range', req.fromUtc!, req.toUtc!);
    if (req.billableFilter === 'all') args.push('--all');
    if (req.billableFilter === 'non-billable') args.push('--non-billable');
    // §09 R4: `tt report --round [minutes]` is the CLI twin of the GUI Rounding toggle +
    // increment picker — both turn on core's nearest-increment rounding of the grouped line.
    if (req.rounding) args.push('--round', String(req.roundingIncrementMin ?? 15));
    const r = this.tt(args);
    const out = JSON.parse(r.out) as {
      lines: { key: string; total_seconds: number; rounded_seconds: number }[];
      grand_total_seconds: number;
      grand_rounded_seconds: number;
      range: { from_utc: string; to_utc: string };
    };
    return {
      grandTotalSeconds: out.grand_total_seconds,
      grandRoundedSeconds: out.grand_rounded_seconds,
      lines: out.lines.map((l) => ({
        key: l.key,
        totalSeconds: l.total_seconds,
        roundedSeconds: l.rounded_seconds,
      })),
      rangeFromUtc: out.range.from_utc,
      rangeToUtc: out.range.to_utc,
    };
  }
  exportRows(o: { fromUtc: string; toUtc: string; format: 'csv' | 'json' }): ExportRowRec[] {
    // §09 R6: full parity for the GUI Export buttons — `tt export --range FROM TO --json|--csv`
    // renders the SAME core toCsv/toJsonEntries bytes the GUI rounds through main. Parse the
    // chosen format back to the surface-neutral row shape so the export contract is asserted
    // identical to CoreWorld's (proving the GUI export reaches nothing tt cannot, §17 R8).
    const args = ['export', '--range', o.fromUtc, o.toUtc, o.format === 'json' ? '--json' : '--csv'];
    return this.parseExportOutput(this.tt(args).out, o.format);
  }
  exportAllRows(format: 'csv' | 'json'): ExportRowRec[] {
    // §09 R06: NO range flag — `tt export` alone is the whole record (the recorded CLI
    // default: everything ever, not an implicit this-week window).
    return this.parseExportOutput(this.tt(['export', format === 'json' ? '--json' : '--csv']).out, format);
  }
  /** Parse `tt export` stdout (either format) back to the surface-neutral row shape. */
  private parseExportOutput(out: string, format: 'csv' | 'json'): ExportRowRec[] {
    if (format === 'json') {
      const rows = JSON.parse(out || '[]') as {
        client: string | null;
        description: string | null;
        raw_duration_s: number;
        billable: boolean;
      }[];
      return rows.map((e) => ({
        client: e.client,
        description: e.description,
        rawSeconds: e.raw_duration_s,
        billable: e.billable,
      }));
    }
    return parseCsvExport(out);
  }
  saveReport(o: {
    name: string;
    preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month';
    by: 'client' | 'project' | 'day' | 'tag';
    billableFilter: 'billable' | 'all' | 'non-billable';
    rounding?: boolean;
    roundingIncrementMin?: number;
  }): void {
    // §09 R08: `tt report save <name>` is the CLI parity twin of the GUI builder's Save —
    // the relative preset flag re-resolves through the SAME core resolveRange on each run.
    const PRESET_FLAG: Record<typeof o.preset, string> = {
      today: '--today',
      week: '--week',
      'last-week': '--last-week',
      month: '--month',
      'last-month': '--last-month',
    };
    const args = ['report', 'save', o.name, PRESET_FLAG[o.preset], '--by', o.by];
    if (o.billableFilter === 'all') args.push('--all');
    else if (o.billableFilter === 'non-billable') args.push('--non-billable');
    if (o.rounding) args.push('--round', String(o.roundingIncrementMin ?? 15));
    this.tt(args);
  }
  attemptSaveReport(o: {
    name: string;
    preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month';
    by: 'client' | 'project' | 'day' | 'tag';
    billableFilter: 'billable' | 'all' | 'non-billable';
  }): { rejected: boolean } {
    // §13 — a duplicate `tt report save` exits non-zero with a diagnostic and stores nothing;
    // that non-zero exit is the surface's rejection signal (the twin of attemptSetConfig).
    const PRESET_FLAG: Record<typeof o.preset, string> = {
      today: '--today',
      week: '--week',
      'last-week': '--last-week',
      month: '--month',
      'last-month': '--last-month',
    };
    const args = ['report', 'save', o.name, PRESET_FLAG[o.preset], '--by', o.by];
    if (o.billableFilter === 'all') args.push('--all');
    else if (o.billableFilter === 'non-billable') args.push('--non-billable');
    const r = this.tt(args);
    return { rejected: r.code !== 0 };
  }
  saveReportRange(o: {
    name: string;
    fromUtc: string;
    toUtc: string;
    by: 'client' | 'project' | 'day' | 'tag';
    billableFilter: 'billable' | 'all' | 'non-billable';
  }): void {
    // §09 R01/R08: `tt report save --range FROM TO` freezes an ABSOLUTE window, parity with the
    // GUI builder's Custom range. The from/to parse to UTC through the same parseTime `tt add` uses.
    const args = ['report', 'save', o.name, '--range', o.fromUtc, o.toUtc, '--by', o.by];
    if (o.billableFilter === 'all') args.push('--all');
    else if (o.billableFilter === 'non-billable') args.push('--non-billable');
    this.tt(args);
  }
  attemptSaveReportRange(o: {
    name: string;
    fromUtc: string;
    toUtc: string;
    by: 'client' | 'project' | 'day' | 'tag';
    billableFilter: 'billable' | 'all' | 'non-billable';
  }): { rejected: boolean } {
    // §09 R01/R08 — an inverted `tt report save --range FROM TO` exits non-zero with the core
    // diagnostic and stores nothing; that non-zero exit is the surface's rejection signal.
    const args = ['report', 'save', o.name, '--range', o.fromUtc, o.toUtc, '--by', o.by];
    if (o.billableFilter === 'all') args.push('--all');
    else if (o.billableFilter === 'non-billable') args.push('--non-billable');
    const r = this.tt(args);
    return { rejected: r.code !== 0 };
  }
  attemptEditReportRange(name: string, o: { fromUtc: string; toUtc: string }): { rejected: boolean } {
    const r = this.tt(['report', 'edit', name, '--range', o.fromUtc, o.toUtc]);
    return { rejected: r.code !== 0 };
  }
  listReportNames(): string[] {
    const r = this.tt(['report', 'ls', '--json']);
    return (JSON.parse(r.out || '[]') as { name: string }[]).map((d) => d.name);
  }
  editReportRange(name: string, preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month'): void {
    const PRESET_FLAG: Record<typeof preset, string> = {
      today: '--today',
      week: '--week',
      'last-week': '--last-week',
      month: '--month',
      'last-month': '--last-month',
    };
    this.tt(['report', 'edit', name, PRESET_FLAG[preset]]);
  }
  editReportBy(name: string, by: 'client' | 'project' | 'day' | 'tag'): void {
    this.tt(['report', 'edit', name, '--by', by]);
  }
  renameReport(name: string, to: string): void {
    this.tt(['report', 'rename', name, to]);
  }
  removeReport(name: string): void {
    this.tt(['report', 'rm', name]);
  }
  runReportTotalSeconds(name: string): number {
    // §09 R06/R09 — `tt report run <name> --json` now exports the FILTERED ENTRIES the report
    // shows (not a grouped Report). The run total is their billable-seconds sum (raw − excluded),
    // which equals the grouped grand total CoreWorld reads off store.runReport — so the "run total
    // equals ad-hoc" parity holds, computed from the same filtered set the export writes.
    const rows = JSON.parse(this.tt(['report', 'run', name, '--json']).out) as {
      raw_duration_s: number;
      excluded_s: number;
    }[];
    return rows.reduce((s, e) => s + (e.raw_duration_s - e.excluded_s), 0);
  }
  exportSavedReportRows(name: string): ExportRowRec[] {
    // §09 R06/R09: `tt report run <name> --csv` emits the FILTERED rows the report shows (the
    // SAME core toCsv CoreWorld renders via store.exportSavedReport → reportFilteredEntries).
    return parseCsvExport(this.tt(['report', 'run', name, '--csv']).out);
  }
  pinFavoriteFromEntry(name: string, source: number | 'open'): void {
    // §05 R09: `tt fav add <name> --running` / `--from-entry <id>` captures the template off
    // the source entry — the CLI parity twin of the GUI rail's Pin-from-running-timer.
    const args = ['fav', 'add', name];
    if (source === 'open') args.push('--running');
    else args.push('--from-entry', String(source));
    this.tt(args);
  }
  pinFavoriteFromAttrs(o: {
    name: string;
    description?: string;
    client?: string;
    project?: string;
    billable?: boolean;
    tags?: string[];
  }): void {
    const args = ['fav', 'add', o.name];
    if (o.description) args.push('--desc', o.description);
    if (o.client) args.push('--client', o.client);
    if (o.project) args.push('--project', o.project);
    if (o.billable === true) args.push('--bill');
    if (o.billable === false) args.push('--no-bill');
    for (const t of o.tags ?? []) args.push('--tag', t);
    this.tt(args);
  }
  listFavorites(): FavoriteRec[] {
    const favs = JSON.parse(this.tt(['fav', 'ls', '--json']).out || '[]') as {
      name: string;
      description: string | null;
      client_id: number | null;
      project_id: number | null;
      billable: boolean;
      tags: string[];
    }[];
    const clients = JSON.parse(this.tt(['client', 'ls', '--archived', '--json']).out || '[]') as {
      id: number;
      name: string;
    }[];
    const projects = JSON.parse(this.tt(['project', 'ls', '--archived', '--json']).out || '[]') as {
      id: number;
      name: string;
    }[];
    const clientNames = new Map(clients.map((c) => [c.id, c.name]));
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    return favs.map((f) => ({
      name: f.name,
      description: f.description,
      clientLabel: label(
        f.client_id !== null ? clientNames.get(f.client_id) ?? null : null,
        f.project_id !== null ? projectNames.get(f.project_id) ?? null : null,
      ),
      billable: f.billable,
      tags: f.tags,
    }));
  }
  renameFavorite(name: string, to: string): void {
    this.tt(['fav', 'rename', name, to]);
  }
  unpinFavorite(name: string): void {
    this.tt(['fav', 'rm', name]);
  }
  startFromFavorite(name: string): { id: number } {
    // §05 R10: `tt fav start <name>` — the CLI parity twin of the rail's Resume.
    this.tt(['fav', 'start', name]);
    return { id: this.openId()! };
  }
  startWithFav(name: string): { id: number } {
    // §05 R10: the SECOND CLI route to the same core action — `tt start --fav <name>`.
    this.tt(['start', '--fav', name]);
    return { id: this.openId()! };
  }
  attemptStartFromFavorite(name: string): { rejected: boolean } {
    // §05 R10: an unknown favorite fails cleanly — non-zero exit, nothing started.
    const r = this.tt(['fav', 'start', name]);
    return { rejected: r.code !== 0 };
  }
  running(): { description: string | null; clientLabel: string | null; billable: boolean; tags: string[] } | null {
    const s = JSON.parse(this.tt(['status', '--json']).out) as {
      running: boolean;
      entry: {
        description: string | null;
        client: string | null;
        project: string | null;
        billable: boolean;
        tags: string[];
      } | null;
    };
    if (!s.running || !s.entry) return null;
    return {
      description: s.entry.description,
      clientLabel: label(s.entry.client, s.entry.project),
      billable: s.entry.billable,
      tags: s.entry.tags,
    };
  }
  checkinScheduleAnchor(): string | null {
    // §20 R07 — read the schedule the tt process committed to `app_state` directly off the DB
    // file. tt is process-per-command, so the row is only there if the `start`/`stop` process
    // durably committed it — exactly the cross-process durability the requirement is about.
    // (No new CLI surface: the test harness reads the committed bytes, like entriesInLatestBackup.)
    const db = openDb(this.db);
    try {
      const row = db.prepare("SELECT value FROM app_state WHERE key = 'checkin_state'").get() as
        | { value: string }
        | undefined;
      return row ? (JSON.parse(row.value) as { startUtc: string }).startUtc : null;
    } finally {
      db.close();
    }
  }
  relaunch(): void {
    // §20 R04 — tt is process-per-command: every `tt` invocation already re-opens the store (so
    // the launch backup + integrity gate + recovery run). A cheap read forces that fresh open —
    // the explicit "relaunch" the backup scenarios anchor on, exactly as a CoreWorld relaunch does.
    this.tt(['status']);
  }
  backupCount(): number {
    return JSON.parse(this.tt(['backup', 'ls', '--json']).out || '[]').length;
  }
  entriesInLatestBackup(): number {
    // §20 R04 — read the LATEST backup independently of the live DB: point a fresh `tt list` at
    // the backup file itself (TT_DB), which opens it and counts its entries. Proves the backup is
    // a real, recoverable snapshot — reachable on the tt surface exactly as on core.
    const backups = JSON.parse(this.tt(['backup', 'ls', '--json']).out || '[]') as { path: string }[];
    if (backups.length === 0) return 0;
    const res = spawnSync('node', [BIN, 'list', '--all', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, TT_DB: backups[0]!.path, TT_NOW: NOW_UTC, NODE_NO_WARNINGS: '1' },
    });
    return (JSON.parse(res.stdout || '[]') as unknown[]).length;
  }
  corruptDatabase(): void {
    // §20 R03 — overwrite the SQLite header on disk so the next `tt` open's quick_check fails.
    // (tt holds no live handle between commands, so there is nothing to close first.)
    const fd = openSync(this.db, 'r+');
    try {
      writeSync(fd, Buffer.from('xxxxxxxxxxxxxxxx'), 0, 16, 0);
    } finally {
      closeSync(fd);
    }
  }
  hasQuarantinedFile(): boolean {
    return readdirSync(this.dir).some((f) => f.startsWith(`${basename(this.db)}.corrupted-`));
  }
  restoreLatestBackup(): { chosenEntryCount: number } {
    // §20 R05 / §17 R12 — the explicit `tt backup restore <name> --force` path. Resolve the newest
    // backup's NAME from `tt backup ls --json`, read its entry count independently (a fresh handle
    // straight on the backup file, no launch backup), then restore by that name. tt is process-per-
    // command, so the restore process re-opens, quarantines the current file to a `.replaced-*`
    // sibling, copies the chosen backup in, and the next read sees the restored file.
    const backups = JSON.parse(this.tt(['backup', 'ls', '--json']).out || '[]') as {
      name: string;
      path: string;
    }[];
    const chosen = backups[0];
    if (!chosen) throw new Error('no backup to restore from');
    const db = openDb(chosen.path);
    let chosenEntryCount: number;
    try {
      chosenEntryCount = (db.prepare('SELECT COUNT(*) AS n FROM entry').get() as { n: number }).n;
    } finally {
      db.close();
    }
    this.tt(['backup', 'restore', chosen.name, '--force']);
    return { chosenEntryCount };
  }
  hasReplacedFile(): boolean {
    return readdirSync(this.dir).some((f) => f.startsWith(`${basename(this.db)}.replaced-`));
  }
  // §20 R03 — the garbage bytes written to the (backup-less) db, kept so openCorruptDatabase can
  // prove the failed open did not mutate the file.
  private integrityBytes?: Buffer;
  corruptDatabaseFile(): void {
    // §20 R03 — write a garbage "database" to the world's fresh temp db path. This feature has no
    // Background that calls reset(), so initialize the temp dir/path lazily; either way the dir
    // holds no `.bak-*` sibling (nothing has opened/backed-up), so the next `tt` open cannot
    // recover and must detect-and-refuse.
    if (!this.dir) this.reset();
    this.integrityBytes = Buffer.from('this is not a sqlite database');
    writeFileSync(this.db, this.integrityBytes);
  }
  openCorruptDatabase(): { refused: boolean; wrote: boolean } {
    // §20 R03 — open the corrupt, backup-less db through a REAL `tt` command (status --json), the
    // normal open path. Corruption is detected and, with no backup to recover from, Store.open
    // throws — `tt` exits non-zero and names the integrity failure on stderr. refused = that
    // signal; wrote = the file's bytes changed (it must NOT — R03 must not write to a corrupt file).
    const r = this.tt(['status', '--json']);
    const refused = r.code !== 0 && /integrity|corrupt/i.test(r.err);
    const after = readFileSync(this.db);
    const wrote = !after.equals(this.integrityBytes!);
    return { refused, wrote };
  }
}
