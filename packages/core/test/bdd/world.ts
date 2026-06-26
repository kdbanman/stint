/**
 * The BDD "world" — one interface, two implementations. Steps bind to this; the
 * same .feature files run against @stint/core directly (CoreWorld) and through the
 * tt executable (CliWorld), which is how the full-parity claim (§17 R8) is proven
 * without a second copy of the spec.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Store,
  joinClientProject,
  resolveRange,
  buildEntryList,
  toCsv,
  toJsonEntries,
  settingDescriptor,
  type EntryView,
  type EntryGroupBy,
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
 * §12 R9 — a grouped Entries-view bucket, surface-neutral. The group key plus the
 * descriptions of the entries that fall under it (enough to assert membership/exclusion).
 */
export interface EntryGroupRec {
  key: string;
  descriptions: string[];
}

/**
 * §12 R9 — an Entries-view query. EITHER a named preset (resolved through core's
 * resolveRange — the same rule the GUI control bar drives) OR explicit from/to. The
 * grouping + client/project/tag/billable + free-text search mirror the control bar; every
 * narrowing field is optional. Surface-neutral: CoreWorld store.listEntries+buildEntryList,
 * CliWorld `tt list --by/--search/--range/--client/--project/--tag --json` then the SAME
 * core buildEntryList — so the two surfaces are compared on identical grouping (§17 R8).
 */
export interface ListViewReq {
  by: EntryGroupBy;
  preset?: 'today' | 'week' | 'last-week' | 'month' | 'last-month';
  fromUtc?: string;
  toUtc?: string;
  client?: string;
  project?: string;
  tag?: string;
  search?: string;
  billable?: 'billable' | 'all' | 'non-billable';
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
  /**
   * §05 R8 — Switch: stop the open entry and start a new one as one named action.
   * Surface-neutral: core resolves to store.start (atomic stop+start), tt to
   * `tt switch` (the alias of `start`); both return the new open entry's id.
   */
  switch(o: {
    desc: string | null;
    client?: string;
    project?: string;
    billable?: boolean;
    atIso: string;
  }): { id: number };
  stop(atIso: string): void;
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
  }): {
    id: number;
  };
  edit(id: number, patch: { desc?: string; startUtc?: string; billable?: boolean }): void;
  /**
   * §06 R1 — delete an entry outright. Surface-neutral: CoreWorld calls store.remove(id);
   * CliWorld shells `tt rm <id> --force` (the confirmation gate is a surface concern, proven
   * at GOLD/JUDGE; this step exercises the underlying delete arithmetic on both surfaces).
   */
  remove(id: number): void;
  split(id: number, atIso: string): { ids: [number, number] };
  merge(ids: number[], opts?: { client?: string }): { id: number; warned: boolean };
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
   * §12 R10 — tag management at parity with `tt tag` / the Clients view's tag strip.
   * Surface-neutral: CoreWorld calls store.addTag/renameTag/archiveTag/listTags directly;
   * CliWorld shells `tt tag add/rename/archive` and reads `tt tag ls --json`. addTag is
   * create-or-return (wraps core's ensureTag), so it is the explicit manage-it-first path.
   */
  addTag(name: string): void;
  renameTag(name: string, to: string): void;
  archiveTag(name: string): void;
  activeTagNames(): string[];
  /**
   * §12 R11 / §14 — the shared `config` capability the GUI Settings view edits. Surface-
   * neutral: CoreWorld calls store.setSetting / store.settings(); CliWorld shells
   * `tt config set <snake> <value>` and reads `tt config ls --json`. setConfig/getConfig take
   * the snake_case key the descriptor list owns (the same key both surfaces accept), so a
   * settings scenario proves the view's edits are real AND parity-preserving (§17 R8).
   */
  setConfig(key: string, value: string): void;
  getConfig(key: string): string;
  list(): EntryRec[];
  /**
   * §09 R7 — free-text search over the entries. Surface-neutral: CoreWorld drives
   * store.listEntries({ search }); CliWorld drives `tt list --all --json --search <query>`
   * and parses the rows — which is what proves the CLI flag is at full parity.
   */
  search(query: string): EntryRec[];
  /**
   * §12 R9 — the grouped/filtered/searched Entries view. Surface-neutral: CoreWorld lists
   * via store.listEntries(filter) then groups via core's buildEntryList; CliWorld lists via
   * `tt list … --json` then groups via the SAME buildEntryList — so both surfaces are
   * compared on identical grouping. Returns the grouped buckets (key + member descriptions).
   */
  listView(req: ListViewReq): EntryGroupRec[];
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
}

const label = joinClientProject;

/**
 * §12 R9 — group a set of EntryViews via core's buildEntryList and project to the
 * surface-neutral group-rec shape (key + member descriptions). Shared by BOTH worlds so the
 * grouping compared across surfaces is byte-for-byte the same core helper — the GUI Entries
 * view and `tt list --by` reach nothing the other cannot.
 */
function groupRecs(entries: EntryView[], by: EntryGroupBy): EntryGroupRec[] {
  return buildEntryList(entries, { by }).groups.map((g) => ({
    key: g.key,
    descriptions: g.entries.map((e) => e.description ?? '(no description)'),
  }));
}

/** A fixed clock so derived elapsed is deterministic. */
const FIXED_NOW = '2026-06-24T23:59:00Z';

// ----------------------------------------------------------------- CoreWorld

export class CoreWorld implements World {
  readonly name = 'core';
  private store!: Store;
  private clock: Clock = () => new Date(FIXED_NOW);

  reset(): void {
    this.store?.close();
    this.store = Store.openMemory(this.clock);
  }
  dispose(): void {
    this.store?.close();
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
  switch(o: {
    desc: string | null;
    client?: string;
    project?: string;
    billable?: boolean;
    atIso: string;
  }): { id: number } {
    // Switch is store.start: it atomically closes any open entry then opens a new one.
    return this.start(o);
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
  }): { id: number } {
    const { clientId, projectId } = this.ids(o);
    const r = this.store.add({
      description: o.desc,
      fromUtc: o.fromIso,
      toUtc: o.toIso,
      clientId,
      projectId,
      ...(o.tags && o.tags.length ? { tags: o.tags } : {}),
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
  remove(id: number): void {
    this.store.remove(id);
  }
  split(id: number, atIso: string): { ids: [number, number] } {
    const [a, b] = this.store.split(id, atIso);
    return { ids: [a.id, b.id] };
  }
  merge(ids: number[], opts?: { client?: string }): { id: number; warned: boolean } {
    const mergeOpts = opts?.client ? { clientId: this.store.ensureClient(opts.client).id } : {};
    const r = this.store.merge(ids, mergeOpts);
    return { id: r.value.id, warned: r.warnings.length > 0 };
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
    return String((this.store.settings() as Record<string, unknown>)[d.key]);
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
  listView(req: ListViewReq): EntryGroupRec[] {
    // §12 R9: resolve the range (preset through core's resolveRange, or explicit), narrow
    // through store.listEntries (client/project/tag/billable/search all resolve there), then
    // group via core's buildEntryList — the SAME helper the CLI path below groups with.
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
    const entries = this.store.listEntries(filter);
    return groupRecs(entries, req.by);
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
      env: { ...process.env, TT_DB: this.db, TT_NOW: FIXED_NOW, NODE_NO_WARNINGS: '1' },
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
  switch(o: {
    desc: string | null;
    client?: string;
    project?: string;
    billable?: boolean;
    atIso: string;
  }): { id: number } {
    // `tt switch` is the alias of `tt start` (§05 R8) — same atomic stop+start.
    const args = ['switch'];
    if (o.desc) args.push(o.desc);
    if (o.client) args.push('--client', o.client);
    if (o.project) args.push('--project', o.project);
    if (o.billable === true) args.push('--bill');
    if (o.billable === false) args.push('--no-bill');
    args.push('--at', o.atIso);
    this.tt(args);
    return { id: this.openId()! };
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
  }): { id: number } {
    const args = ['add', o.desc, '--from', o.fromIso, '--to', o.toIso];
    if (o.client) args.push('--client', o.client);
    if (o.project) args.push('--project', o.project);
    for (const t of o.tags ?? []) args.push('--tag', t);
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
  remove(id: number): void {
    // §06 R1: `tt rm` refuses without confirmation (proven at GOLD); pass --force to delete,
    // exercising the same store.remove the GUI Delete-confirm dialog reaches.
    this.tt(['rm', String(id), '--force']);
  }
  split(id: number, atIso: string): { ids: [number, number] } {
    const r = this.tt(['split', String(id), '--at', atIso]);
    const m = /into (\d+) and (\d+)/.exec(r.out)!;
    return { ids: [Number(m[1]), Number(m[2])] };
  }
  merge(ids: number[], opts?: { client?: string }): { id: number; warned: boolean } {
    const args = ['merge', ...ids.map(String)];
    if (opts?.client) args.push('--client', opts.client);
    const r = this.tt(args);
    const id = Number(/merged into entry (\d+)/.exec(r.out)?.[1]);
    return { id, warned: /warning/.test(r.err) };
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
  list(): EntryRec[] {
    return this.listRows(['list', '--all', '--json']);
  }
  search(query: string): EntryRec[] {
    // §09 R7: full parity for the flag — the GUI search box's query is `tt list --search`.
    return this.listRows(['list', '--all', '--json', '--search', query]);
  }
  listView(req: ListViewReq): EntryGroupRec[] {
    // §12 R9: list through `tt list … --json` (range/client/project/tag/search/billable all
    // narrow there), parse the rows back to EntryViews, then group via the SAME core
    // buildEntryList CoreWorld uses — proving the GUI Entries view's grouping is reachable
    // from tt and identical on both surfaces. The --by flag groups tt's OWN human table; the
    // --json scripting shape stays the flat row array, which is what we re-group here.
    const PRESET_FLAG: Record<NonNullable<ListViewReq['preset']>, string> = {
      today: '--today',
      week: '--week',
      'last-week': '--last-week',
      month: '--month',
      'last-month': '--last-month',
    };
    const args = ['list', '--json', '--by', req.by];
    if (req.preset) args.push(PRESET_FLAG[req.preset]);
    else if (req.fromUtc && req.toUtc) args.push('--range', req.fromUtc, req.toUtc);
    if (req.billable === 'all' || req.billable === undefined) args.push('--all');
    else if (req.billable === 'non-billable') args.push('--non-billable');
    if (req.client) args.push('--client', req.client);
    if (req.project) args.push('--project', req.project);
    if (req.tag) args.push('--tag', req.tag);
    if (req.search) args.push('--search', req.search);
    const r = this.tt(args);
    const rows = JSON.parse(r.out || '[]') as {
      id: number;
      client: string | null;
      project: string | null;
      tags: string[];
      description: string | null;
      start_utc: string;
      end_utc: string | null;
      raw_duration_s: number;
      excluded_s: number;
      billable: boolean;
    }[];
    // Reconstruct enough of an EntryView for the grouping (the fields buildEntryList reads).
    const entries: EntryView[] = rows.map((e) => ({
      id: e.id,
      clientId: null,
      projectId: null,
      description: e.description,
      startUtc: e.start_utc,
      endUtc: e.end_utc,
      billable: e.billable,
      excludedSeconds: e.excluded_s,
      clientName: e.client,
      projectName: e.project,
      tags: e.tags,
      sleepSpans: [],
      sleptThrough: false,
      rawSeconds: e.raw_duration_s,
      billableSeconds: e.raw_duration_s - e.excluded_s,
    }));
    return groupRecs(entries, req.by);
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
    const r = this.tt(args);
    if (o.format === 'json') {
      const rows = JSON.parse(r.out || '[]') as {
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
    return parseCsvExport(r.out);
  }
}
