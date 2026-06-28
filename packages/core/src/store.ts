/**
 * The Stint store — the single source of truth (PRD §04). Every state transition
 * and invariant lives here; both the tt CLI and the Electron GUI import it, so there
 * is no duplicated logic and no privileged surface.
 *
 * All writes run under BEGIN IMMEDIATE with a busy timeout, so they cooperate with
 * the running app across processes. Elapsed is never stored — always derived.
 */
import { openDb, type Db } from './db.js';
import { resolveDbPath } from './paths.js';
import {
  backupDb,
  listBackups as listBackupsFs,
  restoreFromBackup as restoreFromBackupFs,
  type BackupInfo,
  type RecoveryResult,
} from './backup.js';
import {
  systemClock,
  toUtc,
  secondsBetween,
  elapsedSeconds,
  type Clock,
} from './time.js';
import {
  readSettings,
  writeSetting,
  type Settings,
} from './settings.js';
import {
  buildReport,
  spansOverlap,
  type Report,
  type ReportOptions,
  type BillableFilter,
} from './report.js';
import { matchesQuery } from './entrylist.js';
import {
  resolveSavedRange,
  resolveReportDef,
  type SavedReport,
  type SavedReportInput,
  type SavedReportPatch,
  type RangeSpec,
  type RangePreset,
} from './savedreport.js';
import { toCsv, toJsonEntries, type JsonEntry } from './export.js';
import {
  initCheckinState,
  CHECKIN_STATE_KEY,
  LAST_SEEN_KEY,
  type CheckinState,
} from './checkin.js';
import type {
  Entry,
  EntryView,
  Client,
  Project,
  Tag,
  SleepSpan,
  SleepSource,
  Status,
  StartOptions,
  AddOptions,
  EditPatch,
  MergeOptions,
  Warning,
  WriteResult,
  Favorite,
  FavoriteTemplate,
} from './types.js';

interface EntryRow {
  id: number;
  client_id: number | null;
  project_id: number | null;
  description: string | null;
  start_utc: string;
  end_utc: string | null;
  billable: number;
  excluded_seconds: number;
}

interface FavoriteRow {
  id: number;
  name: string;
  description: string | null;
  client_id: number | null;
  project_id: number | null;
  billable: number;
}

interface ReportRow {
  id: number;
  name: string;
  range_kind: string;
  range_preset: string | null;
  range_from_utc: string | null;
  range_to_utc: string | null;
  group_by: string;
  billable_filter: string;
  client_id: number | null;
  project_id: number | null;
  tag: string | null;
  search: string | null;
  rounding: number;
  rounding_increment_min: number;
  created_utc: string;
}

export interface ListFilter {
  fromUtc?: string;
  toUtc?: string;
  clientId?: number;
  projectId?: number;
  tag?: string;
  /**
   * §09 R7 — a free-text query matched (case-insensitive substring) against an entry's
   * description, client name, project name, and any tag. Applied post-`toView` (those
   * fields are resolved there, not columns), exactly like the `tag` post-filter; it
   * narrows within the other filters rather than replacing them.
   */
  search?: string;
  billable?: BillableFilter;
}

export interface ReportRequest extends ReportOptions {
  fromUtc: string;
  toUtc: string;
  clientId?: number;
  projectId?: number;
  tag?: string;
  /** §09 R7 — the same free-text query as ListFilter, threaded into the listed set. */
  search?: string;
}

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

export class Store {
  /**
   * Prepared-statement cache. `toView`/`listEntries` run the same handful of lookups
   * per row, so re-`prepare()`-ing them each time is pure waste; cache by SQL text.
   */
  private readonly stmtCache = new Map<string, ReturnType<Db['prepare']>>();

  /**
   * §20 R05 — the recovery that happened on the most recent open, or null. The GUI reads this
   * after Store.open to inform the user a corrupt DB was recovered from a backup (nothing lost).
   */
  private recovery: RecoveryResult | null = null;

  private constructor(
    private db: Db,
    private readonly clock: Clock,
    /** The on-disk path (`:memory:` for the in-memory store), needed for backup/recovery. */
    private readonly path: string,
  ) {}

  /** A cached prepared statement for a fixed SQL string (hot read paths). */
  private stmt(sql: string): ReturnType<Db['prepare']> {
    let s = this.stmtCache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmtCache.set(sql, s);
    }
    return s;
  }

  /**
   * Open the store at the resolved path (TT_DB or per-OS default). On a file-backed open this
   * integrity-checks the DB and recovers from the latest backup if it is corrupt (§20 R03/R05),
   * then writes a fresh launch backup if the DB changed since the last one (§20 R04). The launch
   * backup is best-effort: a backup failure must never block opening the store.
   */
  static open(
    opts: { path?: string; clock?: Clock; userDataDir?: string; busyTimeoutMs?: number } = {},
  ): Store {
    const path = opts.path ?? resolveDbPath(process.env, opts.userDataDir);
    let recovery: RecoveryResult | null = null;
    const db = openDb(path, {
      ...(opts.busyTimeoutMs !== undefined ? { busyTimeoutMs: opts.busyTimeoutMs } : {}),
      onRecovered: (r) => {
        recovery = r;
      },
    });
    const store = new Store(db, opts.clock ?? systemClock, path);
    store.recovery = recovery;
    store.makeLaunchBackup();
    return store;
  }

  /** Open an in-memory store (tests). Backups/recovery are no-ops for `:memory:`. */
  static openMemory(clock: Clock = systemClock): Store {
    return new Store(openDb(':memory:'), clock, ':memory:');
  }

  /**
   * §20 R04 — write a launch backup if the DB content changed since the last one (a no-op on a
   * relaunch with no edits, and on `:memory:`). Best-effort: a filesystem hiccup here must not
   * stop the app from starting, so any failure is swallowed (the integrity gate still protects).
   */
  private makeLaunchBackup(): void {
    if (this.path === ':memory:') return;
    try {
      backupDb(this.path, this.db, { retention: this.settings().backupRetention });
    } catch {
      /* a backup write must never block opening the store */
    }
  }

  close(): void {
    this.db.close();
  }

  // -------------------------------------------------------------- backups (§20 R04/R05, §17 R12)

  /**
   * §20 R05 — the recovery performed on the most recent open, or null. The GUI reads this once
   * after open to tell the user a corrupt database was recovered from a backup (nothing lost).
   */
  lastRecovery(): RecoveryResult | null {
    return this.recovery;
  }

  /** §20 R04 — the timestamped backups beside the database, newest-first. */
  listBackups(): BackupInfo[] {
    return listBackupsFs(this.path);
  }

  /**
   * §20 R04 — force a backup now (the explicit Settings "Back up now" / `tt backup now` path).
   * Returns the new BackupInfo, or null when the DB is unchanged since the last backup (so the
   * surface can say "unchanged") or in-memory. Honors the retention setting like the launch path.
   */
  backupNow(): BackupInfo | null {
    if (this.path === ':memory:') return null;
    return backupDb(this.path, this.db, { retention: this.settings().backupRetention });
  }

  /**
   * §20 R05 / §17 R12 — restore the store from a named backup. Closes the live handle, quarantines
   * the current file to a `.replaced-*` sibling (never destroyed), copies the chosen backup into
   * place, and reopens the store on the restored file. Throws when in-memory or the name is unknown.
   */
  restoreFromBackup(backupName: string): RecoveryResult {
    if (this.path === ':memory:') {
      throw new StoreError('an in-memory store has no backups to restore from');
    }
    // Validate the name BEFORE closing the live handle, so an unknown name fails cleanly with the
    // store still open (a failed restore must never leave the store in a half-closed state).
    if (!listBackupsFs(this.path).some((b) => b.name === backupName)) {
      throw new StoreError(`no backup named "${backupName}" beside the database`);
    }
    this.stmtCache.clear();
    this.db.close();
    try {
      const result = restoreFromBackupFs(this.path, backupName);
      this.db = openDb(this.path);
      return result;
    } catch (err) {
      // Re-open on the original file so the store stays usable even if the restore copy failed.
      this.db = openDb(this.path);
      throw err;
    }
  }

  private now(): Date {
    return this.clock();
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------- entries

  /** The currently open entry (end IS NULL), or null. */
  openEntry(): EntryView | null {
    const row = this.stmt('SELECT * FROM entry WHERE end_utc IS NULL').get() as EntryRow | undefined;
    return row ? this.toView(row) : null;
  }

  status(): Status {
    const entry = this.openEntry();
    return { running: entry !== null, entry };
  }

  /**
   * Start a new entry, atomically stopping any open entry first (PRD §05 R1, §16).
   * Description/client/project/tags/billable are all optional.
   */
  start(opts: StartOptions = {}): WriteResult<EntryView> {
    return this.tx(() => {
      const at = opts.atUtc ?? toUtc(this.now());
      this.closeOpenEntry(at);
      const { clientId, projectId } = this.resolveClientProject(opts);
      const billable = opts.billable ?? clientId !== null;
      const id = this.insertEntry({
        clientId,
        projectId,
        description: opts.description ?? null,
        startUtc: at,
        endUtc: null,
        billable,
        excludedSeconds: 0,
      });
      this.applyTags(id, opts.tags ?? []);
      // §20 R07 — seed the check-in schedule and stamp last-seen INSIDE this same
      // transaction as the entry write. The schedule is anchored at the new open entry's
      // start, so it can never drift from the entry it describes: either both the open row
      // and its schedule state commit, or neither does (a crash mid-transition rolls back
      // to the previous consistent state). The GUI tick then advances this schedule; it no
      // longer has to lazily seed it on first tick.
      this.writeAppStateTx(
        CHECKIN_STATE_KEY,
        JSON.stringify(initCheckinState(at, this.settings().firstCheckinMin)),
      );
      this.writeAppStateTx(LAST_SEEN_KEY, at);
      return this.withOverlapWarning(id);
    });
  }

  /** Stop the open entry (PRD §05 R2). `atUtc` backdates the stop. */
  stop(opts: { atUtc?: string } = {}): WriteResult<EntryView> {
    return this.tx(() => {
      const open = this.openEntry();
      if (!open) throw new StoreError('nothing is running');
      const at = opts.atUtc ?? toUtc(this.now());
      if (Date.parse(at) < Date.parse(open.startUtc)) {
        throw new StoreError('stop time is before the entry started');
      }
      this.db.prepare('UPDATE entry SET end_utc = ? WHERE id = ?').run(at, open.id);
      // §20 R07 — clear the check-in schedule and stamp last-seen INSIDE this same
      // transaction as the close. With nothing running the schedule is meaningless, so it
      // commits-or-rolls-back together with the entry's end: a crash can never leave a stale
      // schedule pointing at an entry that is no longer open.
      this.writeAppStateTx(CHECKIN_STATE_KEY, null);
      this.writeAppStateTx(LAST_SEEN_KEY, at);
      return this.withOverlapWarning(open.id);
    });
  }

  /**
   * Resume: start a fresh entry copying the most recent entry's description,
   * client, project, and billable flag (PRD §05 R4). A new row, new id.
   */
  resume(): WriteResult<EntryView> {
    const last = this.db
      .prepare('SELECT * FROM entry ORDER BY start_utc DESC, id DESC LIMIT 1')
      .get() as EntryRow | undefined;
    if (!last) throw new StoreError('no entry to resume');
    const tags = this.tagsFor(last.id);
    return this.start({
      description: last.description,
      clientId: last.client_id,
      projectId: last.project_id,
      billable: last.billable === 1,
      tags,
    });
  }

  /**
   * Resume from a favorite (PRD §05 R10): start a FRESH entry from a pinned favorite's
   * template (description / client / project / billable / tags). The favorite is a template,
   * never mutated — a new row with a new id is created. Delegates to `start()`, so it inherits
   * the atomic close-open-then-open behavior (§05 R1, §16) and the overlap warning (§06 R4),
   * keeping the ≤1-open invariant. `overrides` lets the CLI `tt start --fav <name> [flags]`
   * path layer explicit attributes over the template — an override wins per field; tags are
   * replaced when given (matching `start`'s replace-not-merge semantics), kept otherwise.
   */
  startFromFavorite(name: string, overrides: Partial<StartOptions> = {}): WriteResult<EntryView> {
    const fav = this.findFavoriteByName(name);
    if (!fav) throw new StoreError(`no favorite "${name}"`);
    const opts: StartOptions = {
      description: fav.description,
      clientId: fav.clientId,
      projectId: fav.projectId,
      billable: fav.billable,
      tags: fav.tags,
    };
    if (overrides.description !== undefined) opts.description = overrides.description;
    if (overrides.clientId !== undefined) opts.clientId = overrides.clientId;
    if (overrides.projectId !== undefined) opts.projectId = overrides.projectId;
    if (overrides.billable !== undefined) opts.billable = overrides.billable;
    if (overrides.tags !== undefined) opts.tags = overrides.tags;
    if (overrides.atUtc !== undefined) opts.atUtc = overrides.atUtc;
    return this.start(opts);
  }

  /** Backfill a completed entry from explicit from/to times (PRD §05 R5). */
  add(opts: AddOptions): WriteResult<EntryView> {
    if (Date.parse(opts.toUtc) <= Date.parse(opts.fromUtc)) {
      throw new StoreError('--to must be after --from');
    }
    return this.tx(() => {
      const { clientId, projectId } = this.resolveClientProject(opts);
      const billable = opts.billable ?? clientId !== null;
      const id = this.insertEntry({
        clientId,
        projectId,
        description: opts.description ?? null,
        startUtc: opts.fromUtc,
        endUtc: opts.toUtc,
        billable,
        excludedSeconds: 0,
      });
      this.applyTags(id, opts.tags ?? []);
      // §20 R07 — backfill creates a CLOSED entry (no open timer), so it must NOT establish or
      // touch the check-in schedule: any schedule belongs to whatever is currently open, and
      // add() never changes what is open. Deliberately no writeAppStateTx here — the schedule
      // state is left exactly as it was (asserted by prop/appstate.test.ts).
      return this.withOverlapWarning(id);
    });
  }

  /** Amend any field of any entry, including the running one (PRD §05 R6, §06 R1). */
  edit(id: number, patch: EditPatch): WriteResult<EntryView> {
    return this.tx(() => {
      const row = this.requireEntry(id);
      const sets: string[] = [];
      const params: unknown[] = [];

      let clientId = row.client_id;
      let projectId = row.project_id;
      if (patch.projectId !== undefined || patch.clientId !== undefined) {
        const resolved = this.resolveClientProject({
          clientId: patch.clientId ?? row.client_id,
          projectId: patch.projectId !== undefined ? patch.projectId : row.project_id,
        });
        clientId = resolved.clientId;
        projectId = resolved.projectId;
        sets.push('client_id = ?', 'project_id = ?');
        params.push(clientId, projectId);
      }
      if (patch.description !== undefined) {
        sets.push('description = ?');
        params.push(patch.description);
      }
      if (patch.startUtc !== undefined) {
        sets.push('start_utc = ?');
        params.push(patch.startUtc);
      }
      if (patch.endUtc !== undefined) {
        sets.push('end_utc = ?');
        params.push(patch.endUtc);
      }
      if (patch.billable !== undefined) {
        sets.push('billable = ?');
        params.push(patch.billable ? 1 : 0);
      }
      if (sets.length > 0) {
        params.push(id);
        this.db.prepare(`UPDATE entry SET ${sets.join(', ')} WHERE id = ?`).run(...(params as never[]));
      }
      // Validate resulting span.
      const after = this.requireEntry(id);
      if (after.end_utc !== null && Date.parse(after.end_utc) <= Date.parse(after.start_utc)) {
        throw new StoreError('entry end must be after its start');
      }
      for (const t of patch.addTags ?? []) this.applyTags(id, [t]);
      for (const t of patch.removeTags ?? []) this.removeTag(id, t);
      return this.withOverlapWarning(id);
    });
  }

  /** Cut an entry into two at an instant within its span (PRD §06 R2). */
  split(id: number, atUtc: string): [EntryView, EntryView] {
    return this.tx(() => {
      const row = this.requireEntry(id);
      const end = row.end_utc ?? toUtc(this.now());
      const at = Date.parse(atUtc);
      if (at <= Date.parse(row.start_utc) || at >= Date.parse(end)) {
        throw new StoreError('split point must be strictly inside the entry span');
      }
      // First half: keep original id, end at the split point.
      this.db.prepare('UPDATE entry SET end_utc = ? WHERE id = ?').run(atUtc, id);
      // Second half: new entry inheriting client/project/billable, from split → original end.
      const newId = this.insertEntry({
        clientId: row.client_id,
        projectId: row.project_id,
        description: row.description,
        startUtc: atUtc,
        endUtc: row.end_utc, // null if the original was the running entry
        billable: row.billable === 1,
        excludedSeconds: 0,
      });
      for (const t of this.tagsFor(id)) this.applyTags(newId, [t]);
      return [this.viewOf(id), this.viewOf(newId)];
    });
  }

  /**
   * Merge a contiguous selection into one entry spanning earliest start → latest
   * end (PRD §06 R3). Descriptions concatenated, tags unioned. The first entry's
   * client/project/billable win unless overridden.
   */
  merge(ids: number[], opts: MergeOptions = {}): WriteResult<EntryView> {
    if (ids.length < 2) throw new StoreError('merge needs at least two entries');
    return this.tx(() => {
      const rows = ids.map((id) => this.requireEntry(id));
      const sorted = [...rows].sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc));
      const first = sorted[0]!;
      const startUtc = first.start_utc;
      // Latest end; if any is still open, the merged entry is open.
      let endUtc: string | null = sorted[0]!.end_utc;
      for (const r of sorted) {
        if (r.end_utc === null) {
          endUtc = null;
          break;
        }
        if (endUtc === null || Date.parse(r.end_utc) > Date.parse(endUtc)) endUtc = r.end_utc;
      }
      const descriptions = sorted.map((r) => r.description).filter((d): d is string => !!d);
      const description = descriptions.length ? [...new Set(descriptions)].join(' / ') : null;
      const clientId = opts.clientId !== undefined ? opts.clientId : first.client_id;
      const projectId = opts.projectId !== undefined ? opts.projectId : first.project_id;
      const billable = opts.billable !== undefined ? opts.billable : first.billable === 1;
      const resolved = this.resolveClientProject({ clientId, projectId });
      const allTags = new Set<string>();
      for (const r of sorted) for (const t of this.tagsFor(r.id)) allTags.add(t);

      // Delete the originals (after the open one is closed by the merge) then insert.
      for (const r of sorted) this.db.prepare('DELETE FROM entry WHERE id = ?').run(r.id);
      const newId = this.insertEntry({
        clientId: resolved.clientId,
        projectId: resolved.projectId,
        description,
        startUtc,
        endUtc,
        billable,
        excludedSeconds: sorted.reduce((s, r) => s + r.excluded_seconds, 0),
      });
      this.applyTags(newId, [...allTags]);
      return this.withOverlapWarning(newId);
    });
  }

  /** Delete an entry (PRD §06 R1). Confirmation is a CLI/GUI concern. */
  remove(id: number): void {
    this.tx(() => {
      this.requireEntry(id);
      this.db.prepare('DELETE FROM entry WHERE id = ?').run(id);
    });
  }

  getEntry(id: number): EntryView | null {
    const row = this.db.prepare('SELECT * FROM entry WHERE id = ?').get(id) as
      | EntryRow
      | undefined;
    return row ? this.toView(row) : null;
  }

  listEntries(filter: ListFilter = {}): EntryView[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.fromUtc) {
      where.push('start_utc >= ?');
      params.push(filter.fromUtc);
    }
    if (filter.toUtc) {
      where.push('start_utc < ?');
      params.push(filter.toUtc);
    }
    if (filter.clientId !== undefined) {
      where.push('client_id = ?');
      params.push(filter.clientId);
    }
    if (filter.projectId !== undefined) {
      where.push('project_id = ?');
      params.push(filter.projectId);
    }
    if (filter.billable === 'billable') where.push('billable = 1');
    if (filter.billable === 'non-billable') where.push('billable = 0');
    const sql =
      'SELECT * FROM entry' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY start_utc ASC, id ASC';
    let rows = (this.db.prepare(sql).all(...(params as never[])) as unknown as EntryRow[]).map((r) =>
      this.toView(r),
    );
    if (filter.tag) rows = rows.filter((e) => e.tags.includes(filter.tag!));
    // §09 R7: free-text search over the resolved fields (description / client / project /
    // tags), case-insensitive substring. Done in JS so clientName/projectName/tags — which
    // toView resolves, not entry columns — are matchable, mirroring the tag post-filter.
    // The match rule itself lives in entrylist.matchesQuery (the same rule the Entries
    // view and `tt list` group on), so search semantics cannot drift between the SQL
    // list path and the in-memory grouping path.
    if (filter.search?.trim()) rows = rows.filter((e) => matchesQuery(e, filter.search!));
    return rows;
  }

  report(req: ReportRequest): Report {
    const entries = this.listEntries({
      fromUtc: req.fromUtc,
      toUtc: req.toUtc,
      ...(req.clientId !== undefined ? { clientId: req.clientId } : {}),
      ...(req.projectId !== undefined ? { projectId: req.projectId } : {}),
      ...(req.tag !== undefined ? { tag: req.tag } : {}),
      ...(req.search !== undefined ? { search: req.search } : {}),
      billable: 'all',
    });
    return buildReport(
      entries,
      {
        by: req.by,
        billableFilter: req.billableFilter,
        rounding: req.rounding,
        roundingIncrementMin: req.roundingIncrementMin,
      },
      { fromUtc: req.fromUtc, toUtc: req.toUtc },
      this.now(),
    );
  }

  // -------------------------------------------------------- saved reports (§09 R08–R09)

  /**
   * Create a saved report definition (PRD §09 R08). The name is the cross-surface handle
   * and is unique case-insensitively; a duplicate is a StoreError, not a silent overwrite.
   * The range is stored as either a preset (re-resolved on each run) or absolute bounds.
   */
  saveReport(input: SavedReportInput): SavedReport {
    return this.tx(() => {
      this.assertNameFree('report', input.name, 'saved report');
      const createdUtc = toUtc(this.now());
      const spec = input.rangeSpec;
      const id = Number(
        this.db
          .prepare(
            `INSERT INTO report(
               name, range_kind, range_preset, range_from_utc, range_to_utc,
               group_by, billable_filter, client_id, project_id, tag, search,
               rounding, rounding_increment_min, created_utc
             ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            input.name,
            spec.kind,
            spec.kind === 'preset' ? spec.preset : null,
            spec.kind === 'absolute' ? spec.fromUtc : null,
            spec.kind === 'absolute' ? spec.toUtc : null,
            input.by,
            input.billableFilter,
            input.clientId ?? null,
            input.projectId ?? null,
            input.tag ?? null,
            input.search ?? null,
            input.rounding ? 1 : 0,
            input.roundingIncrementMin,
            createdUtc,
          ).lastInsertRowid,
      );
      return this.reportDefById(id);
    });
  }

  /** List all saved report definitions, name-ordered (PRD §09 R08). */
  listReports(): SavedReport[] {
    return this.listByName<ReportRow>('report').map((r) => this.toSavedReport(r));
  }

  /** A saved report by name (case-insensitive), or null. */
  getReport(name: string): SavedReport | null {
    const row = this.findReportByName(name);
    return row ? this.toSavedReport(row) : null;
  }

  /** Rename a saved report (PRD §09 R08). Rejects an unknown source or a duplicate target. */
  renameReport(name: string, newName: string): SavedReport {
    return this.tx(() => {
      const row = this.requireReport(name);
      this.assertRenameFree('report', newName, row.id, 'saved report');
      this.db.prepare('UPDATE report SET name = ? WHERE id = ?').run(newName, row.id);
      return this.reportDefById(row.id);
    });
  }

  /** Amend a saved report's range/grouping/filters/rounding (PRD §09 R08). */
  editReport(name: string, patch: SavedReportPatch): SavedReport {
    return this.tx(() => {
      const row = this.requireReport(name);
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.rangeSpec !== undefined) {
        const spec = patch.rangeSpec;
        sets.push('range_kind = ?', 'range_preset = ?', 'range_from_utc = ?', 'range_to_utc = ?');
        params.push(
          spec.kind,
          spec.kind === 'preset' ? spec.preset : null,
          spec.kind === 'absolute' ? spec.fromUtc : null,
          spec.kind === 'absolute' ? spec.toUtc : null,
        );
      }
      if (patch.by !== undefined) {
        sets.push('group_by = ?');
        params.push(patch.by);
      }
      if (patch.billableFilter !== undefined) {
        sets.push('billable_filter = ?');
        params.push(patch.billableFilter);
      }
      if (patch.clientId !== undefined) {
        sets.push('client_id = ?');
        params.push(patch.clientId);
      }
      if (patch.projectId !== undefined) {
        sets.push('project_id = ?');
        params.push(patch.projectId);
      }
      if (patch.tag !== undefined) {
        sets.push('tag = ?');
        params.push(patch.tag);
      }
      if (patch.search !== undefined) {
        sets.push('search = ?');
        params.push(patch.search);
      }
      if (patch.rounding !== undefined) {
        sets.push('rounding = ?');
        params.push(patch.rounding ? 1 : 0);
      }
      if (patch.roundingIncrementMin !== undefined) {
        sets.push('rounding_increment_min = ?');
        params.push(patch.roundingIncrementMin);
      }
      if (sets.length > 0) {
        params.push(row.id);
        this.db.prepare(`UPDATE report SET ${sets.join(', ')} WHERE id = ?`).run(...(params as never[]));
      }
      return this.reportDefById(row.id);
    });
  }

  /** Delete a saved report by name (PRD §09 R08). Rejects an unknown name. */
  removeReport(name: string): void {
    this.tx(() => {
      const row = this.requireReport(name);
      this.db.prepare('DELETE FROM report WHERE id = ?').run(row.id);
    });
  }

  /**
   * Run a saved report against current data (PRD §09 R09). `ref` is a name (case-insensitive)
   * or a numeric id, so either surface can run a definition by whichever handle it holds.
   *
   * NEVER-DIVERGE GUARANTEE (the crux, stated here at the call site): the definition is resolved
   * through resolveReportDef, which delegates to the SAME core resolveRange the ad-hoc report
   * path uses, and then folded into the one report() resolution+grouping path. So a saved report
   * and an ad-hoc report with identical filters over the same resolved range produce identical
   * totals — there is exactly one place range/grouping/rounding turn into a Report.
   */
  runReport(ref: string | number, now: Date = this.now()): Report {
    const def = this.requireReportDefByRef(ref);
    return this.report(resolveReportDef(def, this.settings().weekStart, now));
  }

  /**
   * Export the RAW entries a saved report covers (PRD §09 R09, §09 R6): resolve the def's
   * range, list its entries with billable='all' and NO client/project/tag/search narrowing —
   * byte-identical to `tt export` for the resolved window — and render them through the SAME
   * core toCsv/toJsonEntries the ad-hoc export uses. The saved report's filters shape its
   * on-screen totals (runReport), not the exported file: the export is the durability/data-out
   * path (the full range), so CSV/JSON from a saved report and `tt export --range …` agree.
   */
  exportSavedReport(
    ref: string | number,
    format: 'csv',
    now?: Date,
  ): string;
  exportSavedReport(
    ref: string | number,
    format: 'json',
    now?: Date,
  ): JsonEntry[];
  exportSavedReport(
    ref: string | number,
    format: 'csv' | 'json',
    now: Date = this.now(),
  ): string | JsonEntry[] {
    const def = this.requireReportDefByRef(ref);
    const range = resolveSavedRange(def.rangeSpec, this.settings().weekStart, now);
    const entries = this.listEntries({
      fromUtc: range.fromUtc,
      toUtc: range.toUtc,
      billable: 'all',
    });
    return format === 'csv' ? toCsv(entries, now) : toJsonEntries(entries, now);
  }

  private findReportByName(name: string): ReportRow | undefined {
    return this.findByNameCI<ReportRow>('report', name);
  }

  private requireReport(name: string): ReportRow {
    const row = this.findReportByName(name);
    if (!row) throw new StoreError(`no saved report named "${name}"`);
    return row;
  }

  private requireReportDef(name: string): SavedReport {
    return this.toSavedReport(this.requireReport(name));
  }

  /**
   * Resolve a saved-report handle — a numeric id OR a name (case-insensitive) — to its
   * definition, throwing a clear StoreError when nothing matches. One lookup for runReport
   * and exportSavedReport, so a name and an id reach the same definition on either surface.
   */
  private requireReportDefByRef(ref: string | number): SavedReport {
    if (typeof ref === 'number') {
      const row = this.findByIdRow<ReportRow>('report', ref);
      if (!row) throw new StoreError(`no saved report with id ${ref}`);
      return this.toSavedReport(row);
    }
    return this.requireReportDef(ref);
  }

  private reportDefById(id: number): SavedReport {
    return this.toSavedReport(this.findByIdRow<ReportRow>('report', id)!);
  }

  private toSavedReport(row: ReportRow): SavedReport {
    const spec: RangeSpec =
      row.range_kind === 'preset'
        ? { kind: 'preset', preset: row.range_preset as RangePreset }
        : { kind: 'absolute', fromUtc: row.range_from_utc!, toUtc: row.range_to_utc! };
    const out: SavedReport = {
      id: row.id,
      name: row.name,
      rangeSpec: spec,
      by: row.group_by as SavedReport['by'],
      billableFilter: row.billable_filter as SavedReport['billableFilter'],
      rounding: row.rounding === 1,
      roundingIncrementMin: row.rounding_increment_min,
      createdUtc: row.created_utc,
    };
    if (row.client_id !== null) out.clientId = row.client_id;
    if (row.project_id !== null) out.projectId = row.project_id;
    if (row.tag !== null) out.tag = row.tag;
    if (row.search !== null) out.search = row.search;
    return out;
  }

  // ------------------------------------------------------------ favorites (§05 R09)

  /**
   * Pin a favorite — a named timer template (PRD §05 R09). When `fromEntryId` is given (a
   * numeric id, or `'open'` for the running entry), the template is captured off that entry's
   * description / client / project / billable / tags; otherwise the explicit attributes are
   * used (resolved through the SAME resolveClientProject every start/add uses, so a project's
   * client stays authoritative). The name is the cross-surface handle and is unique
   * case-insensitively; a duplicate is a StoreError (the table's UNIQUE gives it teeth), not a
   * silent overwrite. Tags are applied through the favorite_tag twin of the entry_tag path.
   */
  pinFavorite(t: FavoriteTemplate): Favorite {
    return this.tx(() => {
      this.assertNameFree('favorite', t.name, 'favorite');
      let description: string | null;
      let clientId: number | null;
      let projectId: number | null;
      let billable: boolean;
      let tags: string[];
      if (t.fromEntryId !== undefined) {
        const src =
          t.fromEntryId === 'open'
            ? (() => {
                const open = this.db
                  .prepare('SELECT * FROM entry WHERE end_utc IS NULL')
                  .get() as EntryRow | undefined;
                if (!open) throw new StoreError('no running entry to pin');
                return open;
              })()
            : this.requireEntry(t.fromEntryId);
        description = src.description;
        clientId = src.client_id;
        projectId = src.project_id;
        billable = src.billable === 1;
        tags = this.tagsFor(src.id);
      } else {
        const resolved = this.resolveClientProject({
          clientId: t.clientId,
          projectId: t.projectId,
        });
        clientId = resolved.clientId;
        projectId = resolved.projectId;
        description = t.description ?? null;
        billable = t.billable ?? clientId !== null;
        tags = t.tags ?? [];
      }
      const id = Number(
        this.db
          .prepare(
            'INSERT INTO favorite(name, description, client_id, project_id, billable) VALUES(?,?,?,?,?)',
          )
          .run(t.name, description, clientId, projectId, billable ? 1 : 0).lastInsertRowid,
      );
      this.applyFavoriteTags(id, tags);
      return this.favoriteById(id);
    });
  }

  /** List all favorites, name-ordered, with tags joined (PRD §05 R09). */
  listFavorites(): Favorite[] {
    return this.listByName<FavoriteRow>('favorite').map((r) => this.toFavorite(r));
  }

  /** A favorite by name (case-insensitive), or null. */
  findFavoriteByName(name: string): Favorite | null {
    const row = this.findFavoriteRowByName(name);
    return row ? this.toFavorite(row) : null;
  }

  /** Rename a favorite (PRD §05 R09). Rejects an unknown source or a duplicate target. */
  renameFavorite(ref: string | number, newName: string): Favorite {
    return this.tx(() => {
      const row = this.requireFavoriteRow(ref);
      this.assertRenameFree('favorite', newName, row.id, 'favorite');
      this.db.prepare('UPDATE favorite SET name = ? WHERE id = ?').run(newName, row.id);
      return this.favoriteById(row.id);
    });
  }

  /** Unpin (delete) a favorite by name or id (PRD §05 R09). favorite_tag cascades. */
  unpinFavorite(ref: string | number): void {
    this.tx(() => {
      const row = this.requireFavoriteRow(ref);
      this.db.prepare('DELETE FROM favorite WHERE id = ?').run(row.id);
    });
  }

  private findFavoriteRowByName(name: string): FavoriteRow | undefined {
    return this.findByNameCI<FavoriteRow>('favorite', name);
  }

  /** Resolve a favorite handle — a numeric id OR a name (case-insensitive) — to its row. */
  private requireFavoriteRow(ref: string | number): FavoriteRow {
    if (typeof ref === 'number') {
      const row = this.findByIdRow<FavoriteRow>('favorite', ref);
      if (!row) throw new StoreError(`no favorite with id ${ref}`);
      return row;
    }
    const row = this.findFavoriteRowByName(ref);
    if (!row) throw new StoreError(`no favorite named "${ref}"`);
    return row;
  }

  private favoriteById(id: number): Favorite {
    return this.toFavorite(this.findByIdRow<FavoriteRow>('favorite', id)!);
  }

  private toFavorite(row: FavoriteRow): Favorite {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      clientId: row.client_id,
      projectId: row.project_id,
      billable: row.billable === 1,
      tags: this.favoriteTagsFor(row.id),
    };
  }

  /** Apply tags to a favorite — the favorite_tag twin of applyTags (entry_tag). */
  private applyFavoriteTags(favoriteId: number, tags: string[]): void {
    for (const name of tags) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const tagId = this.ensureTag(trimmed);
      this.db
        .prepare('INSERT OR IGNORE INTO favorite_tag(favorite_id, tag_id) VALUES(?, ?)')
        .run(favoriteId, tagId);
    }
  }

  private favoriteTagsFor(favoriteId: number): string[] {
    return (
      this.db
        .prepare(
          'SELECT t.name FROM tag t JOIN favorite_tag ft ON ft.tag_id = t.id WHERE ft.favorite_id = ? ORDER BY t.name',
        )
        .all(favoriteId) as { name: string }[]
    ).map((r) => r.name);
  }

  // ---------------------------------------------------------- reference data

  addClient(name: string): Client {
    const id = Number(
      (this.db.prepare('INSERT INTO client(name) VALUES(?)').run(name).lastInsertRowid),
    );
    return { id, name, archived: false };
  }

  renameClient(id: number, name: string): void {
    this.db.prepare('UPDATE client SET name = ? WHERE id = ?').run(name, id);
  }

  archiveClient(id: number): void {
    this.db.prepare('UPDATE client SET archived = 1 WHERE id = ?').run(id);
  }

  listClients(includeArchived = false): Client[] {
    const sql =
      'SELECT id, name, archived FROM client' +
      (includeArchived ? '' : ' WHERE archived = 0') +
      ' ORDER BY name';
    return (this.db.prepare(sql).all() as { id: number; name: string; archived: number }[]).map(
      (r) => ({ id: r.id, name: r.name, archived: r.archived === 1 }),
    );
  }

  findClientByName(name: string): Client | null {
    const r = this.db
      .prepare('SELECT id, name, archived FROM client WHERE name = ? COLLATE NOCASE')
      .get(name) as { id: number; name: string; archived: number } | undefined;
    return r ? { id: r.id, name: r.name, archived: r.archived === 1 } : null;
  }

  /** Find a client by name, creating it if absent. */
  ensureClient(name: string): Client {
    return this.findClientByName(name) ?? this.addClient(name);
  }

  /**
   * Resolve free-text client/project names to ids — the single rule every surface
   * needs (PRD §03, §07), so the CLI, the GUI, and the test harness don't each
   * re-derive it. A named client is created on demand; a named project is found under
   * the resolved client (or created there); a project named *without* a client must
   * already exist, and its client then becomes authoritative. `fallbackClientId`
   * supplies an existing client context when no client name is given (e.g. editing an
   * entry that already has a client).
   */
  resolveClientProjectByName(opts: {
    client?: string;
    project?: string;
    fallbackClientId?: number | null;
  }): { clientId: number | null; projectId: number | null } {
    const clientId: number | null = opts.client
      ? this.ensureClient(opts.client).id
      : (opts.fallbackClientId ?? null);
    if (!opts.project) return { clientId, projectId: null };
    if (clientId === null) {
      const found = this.findProjectByName(opts.project);
      if (!found) {
        throw new StoreError(
          `project "${opts.project}" not found; name a client to create it under one`,
        );
      }
      return { clientId: found.clientId, projectId: found.id };
    }
    const existing = this.findProjectByName(opts.project, clientId);
    return { clientId, projectId: existing ? existing.id : this.addProject(opts.project, clientId).id };
  }

  addProject(name: string, clientId: number): Project {
    // Atomic: the client-exists check and the insert must not straddle another write.
    return this.tx(() => {
      this.requireClient(clientId);
      const id = Number(
        this.db.prepare('INSERT INTO project(client_id, name) VALUES(?, ?)').run(clientId, name)
          .lastInsertRowid,
      );
      return { id, clientId, name, archived: false };
    });
  }

  renameProject(id: number, name: string): void {
    this.db.prepare('UPDATE project SET name = ? WHERE id = ?').run(name, id);
  }

  archiveProject(id: number): void {
    this.db.prepare('UPDATE project SET archived = 1 WHERE id = ?').run(id);
  }

  listProjects(clientId?: number, includeArchived = false): Project[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (clientId !== undefined) {
      where.push('client_id = ?');
      params.push(clientId);
    }
    if (!includeArchived) where.push('archived = 0');
    const sql =
      'SELECT id, client_id, name, archived FROM project' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY name';
    return (
      this.db.prepare(sql).all(...(params as never[])) as {
        id: number;
        client_id: number;
        name: string;
        archived: number;
      }[]
    ).map((r) => ({ id: r.id, clientId: r.client_id, name: r.name, archived: r.archived === 1 }));
  }

  findProjectByName(name: string, clientId?: number): Project | null {
    const params: unknown[] = [name];
    let sql = 'SELECT id, client_id, name, archived FROM project WHERE name = ? COLLATE NOCASE';
    if (clientId !== undefined) {
      sql += ' AND client_id = ?';
      params.push(clientId);
    }
    const r = this.db.prepare(sql).get(...(params as never[])) as
      | { id: number; client_id: number; name: string; archived: number }
      | undefined;
    return r ? { id: r.id, clientId: r.client_id, name: r.name, archived: r.archived === 1 } : null;
  }

  listTags(includeArchived = false): Tag[] {
    const sql =
      'SELECT id, name, archived FROM tag' +
      (includeArchived ? '' : ' WHERE archived = 0') +
      ' ORDER BY name';
    return (this.db.prepare(sql).all() as { id: number; name: string; archived: number }[]).map(
      (r) => ({ id: r.id, name: r.name, archived: r.archived === 1 }),
    );
  }

  /**
   * Create a tag (or return the existing one of that name) and hand back the row (§07,
   * §12 R10). Tags are otherwise born on the fly when first applied to an entry; this is
   * the explicit, manage-it-first path the Clients view and `tt tag add` drive. Wraps the
   * same `ensureTag` the entry-tagging path uses, so a name never yields two tag rows.
   */
  addTag(name: string): Tag {
    const id = this.ensureTag(name.trim());
    const r = this.db.prepare('SELECT id, name, archived FROM tag WHERE id = ?').get(id) as {
      id: number;
      name: string;
      archived: number;
    };
    return { id: r.id, name: r.name, archived: r.archived === 1 };
  }

  renameTag(id: number, name: string): void {
    this.db.prepare('UPDATE tag SET name = ? WHERE id = ?').run(name, id);
  }

  archiveTag(id: number): void {
    this.db.prepare('UPDATE tag SET archived = 1 WHERE id = ?').run(id);
  }

  findTagByName(name: string): Tag | null {
    const r = this.db
      .prepare('SELECT id, name, archived FROM tag WHERE name = ? COLLATE NOCASE')
      .get(name) as { id: number; name: string; archived: number } | undefined;
    return r ? { id: r.id, name: r.name, archived: r.archived === 1 } : null;
  }

  // ---------------------------------------------------------------- sleep

  /** Record a sleep→wake cycle on an entry and (implicitly) flag it (PRD §10a). */
  recordSleepSpan(
    entryId: number,
    sleepUtc: string,
    wakeUtc: string,
    source: SleepSource,
  ): SleepSpan {
    // Atomic: the entry-exists check and the span insert are one unit.
    return this.tx(() => {
      this.requireEntry(entryId);
      const id = Number(
        this.db
          .prepare('INSERT INTO sleep_span(entry_id, sleep_utc, wake_utc, source) VALUES(?,?,?,?)')
          .run(entryId, sleepUtc, wakeUtc, source).lastInsertRowid,
      );
      return { id, entryId, sleepUtc, wakeUtc, source };
    });
  }

  sleepSpansFor(entryId: number): SleepSpan[] {
    return (
      this.stmt(
        'SELECT id, entry_id, sleep_utc, wake_utc, source FROM sleep_span WHERE entry_id = ? ORDER BY sleep_utc',
      ).all(entryId) as {
        id: number;
        entry_id: number;
        sleep_utc: string;
        wake_utc: string;
        source: string;
      }[]
    ).map((r) => ({
      id: r.id,
      entryId: r.entry_id,
      sleepUtc: r.sleep_utc,
      wakeUtc: r.wake_utc,
      source: r.source as SleepSource,
    }));
  }

  /** Entries flagged slept-through (have at least one sleep span). */
  listSleepFlagged(): EntryView[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM entry WHERE id IN (SELECT DISTINCT entry_id FROM sleep_span) ORDER BY start_utc',
      )
      .all() as unknown as EntryRow[];
    return rows.map((r) => this.toView(r));
  }

  /**
   * Reconcile a wall-clock gap on launch (PRD §10a item 3). If an entry is open and
   * the gap since `lastSeenUtc` exceeds `thresholdSeconds`, record it as a
   * `source = gap` sleep span — a flagged suspicion, never auto-subtracted.
   */
  reconcileGap(
    lastSeenUtc: string,
    nowUtc: string = toUtc(this.now()),
    thresholdSeconds = 90,
  ): SleepSpan | null {
    const open = this.openEntry();
    if (!open) return null;
    const gap = secondsBetween(lastSeenUtc, nowUtc);
    if (gap < thresholdSeconds) return null;
    // The sleep can only have occurred during the open entry's span.
    const sleepFrom = Date.parse(lastSeenUtc) < Date.parse(open.startUtc) ? open.startUtc : lastSeenUtc;
    return this.recordSleepSpan(open.id, sleepFrom, nowUtc, 'gap');
  }

  /**
   * Toggle the slept-time subtraction for an entry (PRD §10a item 5). Sets
   * excluded_seconds to the total slept seconds, or back to 0 if already applied —
   * precise and reversible. Stored start/end are never touched.
   */
  subtractSleep(entryId: number): { before: number; after: number; sleptSeconds: number } {
    return this.tx(() => {
      const row = this.requireEntry(entryId);
      const slept = this.sleepSpansFor(entryId).reduce(
        (s, span) => s + Math.max(0, secondsBetween(span.sleepUtc, span.wakeUtc)),
        0,
      );
      const before = row.excluded_seconds;
      const after = before === slept ? 0 : slept;
      this.db.prepare('UPDATE entry SET excluded_seconds = ? WHERE id = ?').run(after, entryId);
      return { before, after, sleptSeconds: slept };
    });
  }

  // ---------------------------------------------------------------- settings

  settings(): Settings {
    return readSettings(this.db);
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    writeSetting(this.db, key, value);
  }

  // -------------------------------------------------------------- app state

  /**
   * Private application state owned by the running app (check-in cadence, last-seen
   * heartbeat) — kept in its own `app_state` table, behind the store, so the GUI need
   * not reach into the database and the user-facing `setting` table stays clean.
   */
  getAppState(key: string): string | null {
    const row = this.stmt('SELECT value FROM app_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setAppState(key: string, value: string): void {
    this.stmt(
      'INSERT INTO app_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
  }

  deleteAppState(key: string): void {
    this.stmt('DELETE FROM app_state WHERE key = ?').run(key);
  }

  /**
   * §20 R07 — upsert (value) or delete (null) an `app_state` key with NO transaction of its
   * own. This is the in-transaction primitive: the entry transitions (start/stop) call it
   * INSIDE their existing `tx()` body so the schedule/last-seen write commits atomically with
   * the entry row. It is private precisely because an `app_state` write that changes state
   * must ride the transaction of the entry write that changed it (the §20 R07 contract);
   * standalone writes go through the typed methods below, each of which owns its own short tx.
   */
  private writeAppStateTx(key: string, value: string | null): void {
    if (value === null) {
      this.db.prepare('DELETE FROM app_state WHERE key = ?').run(key);
    } else {
      this.db
        .prepare(
          'INSERT INTO app_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run(key, value);
    }
  }

  /**
   * §20 R07 — the persisted check-in schedule for the running entry, or null when nothing is
   * running (start() seeds it atomically; stop() clears it atomically). The GUI tick reads
   * this instead of reaching into `app_state` by string key, so the schedule survives relaunch
   * (§10b) on the SAME durable state the entry transitions wrote.
   */
  checkinState(): CheckinState | null {
    const raw = this.getAppState(CHECKIN_STATE_KEY);
    return raw ? (JSON.parse(raw) as CheckinState) : null;
  }

  /**
   * §20 R07 — persist an advanced check-in schedule together with the last-seen heartbeat as
   * ONE durable unit. The GUI tick calls this when `evaluateCheckin` advances the schedule
   * (a fire): the schedule advance and the heartbeat that proves the app was alive at that
   * instant commit-or-rollback together, so they can never disagree. `state === null` clears
   * the schedule (defensive; the normal clear path is stop()).
   */
  setCheckinState(state: CheckinState | null, nowUtc: string): void {
    this.tx(() => {
      this.writeAppStateTx(CHECKIN_STATE_KEY, state === null ? null : JSON.stringify(state));
      this.writeAppStateTx(LAST_SEEN_KEY, nowUtc);
    });
  }

  /**
   * §20 R07 — stamp the last-seen heartbeat (launch-time gap reconciliation, §10a). This is a
   * standalone state write whose "same transaction as the write that changes it" IS its own
   * short transaction — there is no entry write to ride. The GUI heartbeat path calls this.
   */
  recordLastSeen(nowUtc: string): void {
    this.tx(() => {
      this.writeAppStateTx(LAST_SEEN_KEY, nowUtc);
    });
  }

  // ---------------------------------------------------------------- internals

  /**
   * The one case-insensitive name lookup the named-entity tables (favorite, report) share —
   * `SELECT * FROM <table> WHERE name = ? COLLATE NOCASE`. Centralising it means the unique
   * cross-surface name handle resolves the SAME way for every such entity, instead of the
   * SELECT being copy-pasted per entity (the favorites and saved-reports groups had it twice).
   * `table` is an internal literal (never user input), so interpolating it carries no injection
   * risk; the name is bound. Each caller keeps its own typed row cast and its own error strings.
   */
  private findByNameCI<R>(table: 'favorite' | 'report', name: string): R | undefined {
    return this.db.prepare(`SELECT * FROM ${table} WHERE name = ? COLLATE NOCASE`).get(name) as
      | R
      | undefined;
  }

  /** Resolve a numeric-id row from a named-entity table (favorite, report) by primary key. */
  private findByIdRow<R>(table: 'favorite' | 'report', id: number): R | undefined {
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as R | undefined;
  }

  /** List a named-entity table (favorite, report) name-ordered, case-insensitively — the one
   * ordered fetch both groups share, so neither can drift on ordering. */
  private listByName<R>(table: 'favorite' | 'report'): R[] {
    return this.db
      .prepare(`SELECT * FROM ${table} ORDER BY name COLLATE NOCASE`)
      .all() as unknown as R[];
  }

  /**
   * Guard the case-insensitive name uniqueness every named entity (favorite, report) shares on
   * CREATE: throw a StoreError if `name` is already taken. `label` is the noun for the message
   * ("favorite" / "saved report"). One guard so the two groups can't drift on how a duplicate
   * is detected or worded — a duplicate is always an error, never a silent overwrite.
   */
  private assertNameFree(table: 'favorite' | 'report', name: string, label: string): void {
    if (this.findByNameCI(table, name)) {
      throw new StoreError(`a ${label} named "${name}" already exists`);
    }
  }

  /**
   * The RENAME twin of assertNameFree: throw if `newName` is held by a DIFFERENT row than
   * `currentId` (renaming an entity to its own current name is a no-op, not a clash).
   */
  private assertRenameFree(
    table: 'favorite' | 'report',
    newName: string,
    currentId: number,
    label: string,
  ): void {
    const clash = this.findByNameCI<{ id: number }>(table, newName);
    if (clash && clash.id !== currentId) {
      throw new StoreError(`a ${label} named "${newName}" already exists`);
    }
  }

  private requireEntry(id: number): EntryRow {
    const row = this.stmt('SELECT * FROM entry WHERE id = ?').get(id) as EntryRow | undefined;
    if (!row) throw new StoreError(`no entry with id ${id}`);
    return row;
  }

  private requireClient(id: number): void {
    const row = this.db.prepare('SELECT id FROM client WHERE id = ?').get(id);
    if (!row) throw new StoreError(`no client with id ${id}`);
  }

  private closeOpenEntry(at: string): void {
    const open = this.db.prepare('SELECT id FROM entry WHERE end_utc IS NULL').get() as
      | { id: number }
      | undefined;
    if (open) this.db.prepare('UPDATE entry SET end_utc = ? WHERE id = ?').run(at, open.id);
  }

  private resolveClientProject(opts: {
    clientId?: number | null;
    projectId?: number | null;
  }): { clientId: number | null; projectId: number | null } {
    const projectId = opts.projectId ?? null;
    if (projectId !== null) {
      const proj = this.db.prepare('SELECT client_id FROM project WHERE id = ?').get(projectId) as
        | { client_id: number }
        | undefined;
      if (!proj) throw new StoreError(`no project with id ${projectId}`);
      // A project's client is authoritative (PRD §03).
      return { clientId: proj.client_id, projectId };
    }
    return { clientId: opts.clientId ?? null, projectId: null };
  }

  private insertEntry(e: Omit<Entry, 'id'>): number {
    return Number(
      this.db
        .prepare(
          'INSERT INTO entry(client_id, project_id, description, start_utc, end_utc, billable, excluded_seconds) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          e.clientId,
          e.projectId,
          e.description,
          e.startUtc,
          e.endUtc,
          e.billable ? 1 : 0,
          e.excludedSeconds,
        ).lastInsertRowid,
    );
  }

  private ensureTag(name: string): number {
    const existing = this.db.prepare('SELECT id FROM tag WHERE name = ? COLLATE NOCASE').get(name) as
      | { id: number }
      | undefined;
    if (existing) return existing.id;
    return Number(this.db.prepare('INSERT INTO tag(name) VALUES(?)').run(name).lastInsertRowid);
  }

  private applyTags(entryId: number, tags: string[]): void {
    for (const name of tags) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const tagId = this.ensureTag(trimmed);
      this.db
        .prepare('INSERT OR IGNORE INTO entry_tag(entry_id, tag_id) VALUES(?, ?)')
        .run(entryId, tagId);
    }
  }

  private removeTag(entryId: number, name: string): void {
    this.db
      .prepare(
        'DELETE FROM entry_tag WHERE entry_id = ? AND tag_id = (SELECT id FROM tag WHERE name = ? COLLATE NOCASE)',
      )
      .run(entryId, name);
  }

  private tagsFor(entryId: number): string[] {
    return (
      this.stmt(
        'SELECT t.name FROM tag t JOIN entry_tag et ON et.tag_id = t.id WHERE et.entry_id = ? ORDER BY t.name',
      ).all(entryId) as { name: string }[]
    ).map((r) => r.name);
  }

  private viewOf(id: number): EntryView {
    return this.toView(this.requireEntry(id));
  }

  private toView(row: EntryRow): EntryView {
    const now = this.now();
    const clientName = row.client_id
      ? ((this.stmt('SELECT name FROM client WHERE id = ?').get(row.client_id) as
          | { name: string }
          | undefined)?.name ?? null)
      : null;
    const projectName = row.project_id
      ? ((this.stmt('SELECT name FROM project WHERE id = ?').get(row.project_id) as
          | { name: string }
          | undefined)?.name ?? null)
      : null;
    const sleepSpans = this.sleepSpansFor(row.id);
    // Open entry: derive live elapsed through the monotonic-time guard (PRD §20 R06) so a
    // wall-clock jump behind `start` (NTP / manual change) clamps to 0, never negative.
    // Closed entry: span from the stored end, still clamped for safety against a corrupt
    // stored end < start.
    const rawSeconds = row.end_utc
      ? Math.max(0, Math.round((Date.parse(row.end_utc) - Date.parse(row.start_utc)) / 1000))
      : elapsedSeconds(row.start_utc, now.toISOString());
    const billableSeconds = Math.max(0, rawSeconds - row.excluded_seconds);
    return {
      id: row.id,
      clientId: row.client_id,
      projectId: row.project_id,
      description: row.description,
      startUtc: row.start_utc,
      endUtc: row.end_utc,
      billable: row.billable === 1,
      excludedSeconds: row.excluded_seconds,
      clientName,
      projectName,
      tags: this.tagsFor(row.id),
      sleepSpans,
      sleptThrough: sleepSpans.length > 0,
      rawSeconds,
      billableSeconds,
    };
  }

  /** Find entries whose span overlaps the given entry (PRD §06 R4). */
  private overlapsOf(id: number): number[] {
    const row = this.requireEntry(id);
    const nowIso = toUtc(this.now());
    const start = row.start_utc;
    const end = row.end_utc ?? nowIso;
    const others = this.stmt('SELECT id, start_utc, end_utc FROM entry WHERE id <> ?').all(id) as {
      id: number;
      start_utc: string;
      end_utc: string | null;
    }[];
    const s = Date.parse(start);
    const e = Date.parse(end);
    return others
      .filter((o) =>
        spansOverlap(s, e, Date.parse(o.start_utc), o.end_utc ? Date.parse(o.end_utc) : Date.parse(nowIso)),
      )
      .map((o) => o.id);
  }

  private withOverlapWarning(id: number): WriteResult<EntryView> {
    const overlaps = this.overlapsOf(id);
    const warnings: Warning[] = [];
    if (overlaps.length > 0) {
      warnings.push({
        kind: 'overlap',
        message: `entry ${id} overlaps ${overlaps.length} other ${
          overlaps.length === 1 ? 'entry' : 'entries'
        } (${overlaps.join(', ')}); allowed but flagged in reports`,
        overlapsWith: overlaps,
      });
    }
    return { value: this.viewOf(id), warnings };
  }
}
