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
  systemClock,
  toUtc,
  secondsBetween,
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

export interface ListFilter {
  fromUtc?: string;
  toUtc?: string;
  clientId?: number;
  projectId?: number;
  tag?: string;
  billable?: BillableFilter;
}

export interface ReportRequest extends ReportOptions {
  fromUtc: string;
  toUtc: string;
  clientId?: number;
  projectId?: number;
  tag?: string;
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

  private constructor(
    private readonly db: Db,
    private readonly clock: Clock,
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

  /** Open the store at the resolved path (TT_DB or per-OS default). */
  static open(
    opts: { path?: string; clock?: Clock; userDataDir?: string; busyTimeoutMs?: number } = {},
  ): Store {
    const path = opts.path ?? resolveDbPath(process.env, opts.userDataDir);
    return new Store(
      openDb(path, opts.busyTimeoutMs !== undefined ? { busyTimeoutMs: opts.busyTimeoutMs } : {}),
      opts.clock ?? systemClock,
    );
  }

  /** Open an in-memory store (tests). */
  static openMemory(clock: Clock = systemClock): Store {
    return new Store(openDb(':memory:'), clock);
  }

  close(): void {
    this.db.close();
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
    return rows;
  }

  report(req: ReportRequest): Report {
    const entries = this.listEntries({
      fromUtc: req.fromUtc,
      toUtc: req.toUtc,
      ...(req.clientId !== undefined ? { clientId: req.clientId } : {}),
      ...(req.projectId !== undefined ? { projectId: req.projectId } : {}),
      ...(req.tag !== undefined ? { tag: req.tag } : {}),
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

  // ---------------------------------------------------------------- internals

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
    const endMs = row.end_utc ? Date.parse(row.end_utc) : now.getTime();
    const rawSeconds = Math.max(0, Math.round((endMs - Date.parse(row.start_utc)) / 1000));
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
