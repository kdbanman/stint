/**
 * The tt command surface (PRD §11) — full parity with the GUI over @stint/core.
 *
 * Human-readable tables by default; `--json` on every read command for scripting.
 * Clean exit codes (0 success, non-zero on error). All writes go through the shared
 * core under BEGIN IMMEDIATE + busy timeout so they cooperate with the running app.
 */
import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import {
  Store,
  APP_VERSION,
  parseTime,
  formatDuration,
  formatHours,
  resolveRange,
  joinClientProject,
  toCsv,
  toJsonEntries,
  detectOverlaps,
  buildEntryList,
  SETTING_DESCRIPTORS,
  settingDescriptor,
  type EntryView,
  type EntryGroupBy,
  type BillableFilter,
  type GroupBy,
  type Settings,
  type SavedReportInput,
  type SavedReportPatch,
  type RangeSpec,
} from '@stint/core';
import {
  table,
  statusLine,
  clientProjectLabel,
  entryFlags,
  shortUtc,
  reportRangeSpecLine,
  reportDefDetail,
  favoriteRow,
} from './format.js';
import {
  statusJson,
  reportJson,
  reportDefJson,
  reportDefListJson,
  favoriteListJson,
  backupListJson,
} from './serialize.js';

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

export interface Deps {
  openStore: () => Store;
  /** The wall clock, also the base for relative time parsing. */
  now: () => Date;
  io: Io;
}

/** A domain/usage error that maps to a specific non-zero exit code. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 2,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

const collect = (val: string, prev: string[]): string[] => [...prev, val];

function billableFilter(opts: { all?: boolean; nonBillable?: boolean }): BillableFilter {
  if (opts.nonBillable) return 'non-billable';
  if (opts.all) return 'all';
  return 'billable';
}

interface RangeOpts {
  today?: boolean;
  week?: boolean;
  lastWeek?: boolean;
  month?: boolean;
  lastMonth?: boolean;
  range?: [string, string];
}

function resolveRangeOpts(
  opts: RangeOpts,
  settings: Settings,
  now: Date,
  fallback?: 'week' | 'today',
): { fromUtc: string; toUtc: string } | undefined {
  if (opts.range) {
    return {
      fromUtc: parseTime(opts.range[0], now),
      toUtc: parseTime(opts.range[1], now),
    };
  }
  if (opts.today) return resolveRange('today', settings.weekStart, now);
  if (opts.week) return resolveRange('week', settings.weekStart, now);
  if (opts.lastWeek) return resolveRange('last-week', settings.weekStart, now);
  if (opts.month) return resolveRange('month', settings.weekStart, now);
  if (opts.lastMonth) return resolveRange('last-month', settings.weekStart, now);
  if (fallback) return resolveRange(fallback, settings.weekStart, now);
  return undefined;
}

/** Resolve the --client / --project / --tag attribute flags to ids/tags. */
function resolveAttributes(
  store: Store,
  opts: { client?: string; project?: string; tag?: string[]; bill?: boolean; noBill?: boolean },
): { clientId: number | null; projectId: number | null; tags: string[]; billable?: boolean } {
  // Name resolution (create-on-demand, project⇒client) lives in core — one rule for
  // every surface (PRD §03, §07).
  const { clientId, projectId } = store.resolveClientProjectByName({
    client: opts.client,
    project: opts.project,
  });
  const out: { clientId: number | null; projectId: number | null; tags: string[]; billable?: boolean } = {
    clientId,
    projectId,
    tags: opts.tag ?? [],
  };
  // Tri-state: --bill ⇒ true, --no-bill ⇒ false, neither ⇒ undefined (use the default).
  if (opts.bill !== undefined) out.billable = opts.bill;
  return out;
}

function printWarnings(io: Io, warnings: { message: string }[]): void {
  for (const w of warnings) io.err(`warning: ${w.message}`);
}

/**
 * The shared `--json | empty | table` output contract for every list command, so the
 * scripting shape and the empty-state message are defined once rather than re-hand-rolled
 * in `list`, `client ls`, `project ls`, and `sleep ls`.
 */
function emitList<T>(
  io: Io,
  json: boolean | undefined,
  spec: {
    items: T[];
    toJson: (items: T[]) => unknown;
    empty: string;
    headers: string[];
    toRow: (item: T) => string[];
  },
): void {
  if (json) {
    io.out(JSON.stringify(spec.toJson(spec.items)));
    return;
  }
  if (spec.items.length === 0) {
    io.out(spec.empty);
    return;
  }
  io.out(table(spec.headers, spec.items.map(spec.toRow)));
}

function resolveEntityRef(
  ref: string,
  find: (name: string) => { id: number } | null,
): number {
  if (/^\d+$/.test(ref)) return Number(ref);
  const found = find(ref);
  if (!found) throw new CliError(`no match for "${ref}"`);
  return found.id;
}

export function buildProgram(deps: Deps): Command {
  const { io, now } = deps;
  const program = new Command();
  // §09 R08 — `report` is BOTH an ad-hoc query (with options) AND a group of saved-report
  // subcommands that reuse the same option names (--week/--by/--json/…). Positional options
  // make a recognized subcommand terminate the parent's option parsing, so `report ls --json`
  // binds --json to `ls` rather than to the parent `report`, while `report --week --json`
  // (no subcommand) still parses against the ad-hoc form.
  program.enablePositionalOptions();
  program
    .name('tt')
    .description('Stint time tracker — the command-line surface')
    // §19 R06 — the date/build version stamped into @stint/core, the SAME constant the GUI
    // Settings → Software Update view shows, so `tt --version` and the GUI report one version.
    .version(APP_VERSION)
    .configureOutput({
      writeOut: (s) => io.out(s.replace(/\n$/, '')),
      writeErr: (s) => io.err(s.replace(/\n$/, '')),
    });

  const withStore = <T>(fn: (store: Store) => T): T => {
    const store = deps.openStore();
    try {
      return fn(store);
    } finally {
      store.close();
    }
  };

  // ----------------------------------------------------------------- start
  program
    .command('start')
    .description('Stop any open entry and open a new one')
    .argument('[description]', 'what you are working on')
    .option('--client <name>', 'client name')
    .option('--project <name>', 'project name')
    .option('--tag <tag>', 'tag (repeatable)', collect, [])
    .option('--bill', 'mark billable')
    .option('--no-bill', 'mark non-billable')
    .option('--at <time>', 'start time (default: now)')
    .option('--fav <name>', 'start from a pinned favorite (other flags override its template)')
    .action((description: string | undefined, opts) => {
      withStore((store) => {
        // §05 R10 — `tt start --fav <name>` resumes from a favorite's template, with any
        // explicit attribute flags layered over it as overrides (override wins per field;
        // tags replace when given). Without --fav the start behaves exactly as before.
        if (opts.fav) {
          const attrs = resolveAttributes(store, opts);
          const overrides: Parameters<Store['startFromFavorite']>[1] = {};
          if (description !== undefined) overrides.description = description;
          if (opts.client !== undefined || opts.project !== undefined) {
            overrides.clientId = attrs.clientId;
            overrides.projectId = attrs.projectId;
          }
          if (attrs.billable !== undefined) overrides.billable = attrs.billable;
          if (opts.tag && opts.tag.length) overrides.tags = attrs.tags;
          if (opts.at) overrides.atUtc = parseTime(opts.at, now());
          try {
            const res = store.startFromFavorite(opts.fav, overrides);
            printWarnings(io, res.warnings);
            io.out(statusLine(res.value));
          } catch (err) {
            throw new CliError((err as Error).message);
          }
          return;
        }
        const attrs = resolveAttributes(store, opts);
        const res = store.start({
          description: description ?? null,
          clientId: attrs.clientId,
          projectId: attrs.projectId,
          tags: attrs.tags,
          ...(attrs.billable !== undefined ? { billable: attrs.billable } : {}),
          ...(opts.at ? { atUtc: parseTime(opts.at, now()) } : {}),
        });
        printWarnings(io, res.warnings);
        io.out(statusLine(res.value));
      });
    });

  // ------------------------------------------------------------------ stop
  program
    .command('stop')
    .description('Close the open entry')
    .option('--at <time>', 'stop time (default: now)')
    .action((opts) => {
      withStore((store) => {
        const res = store.stop(opts.at ? { atUtc: parseTime(opts.at, now()) } : {});
        printWarnings(io, res.warnings);
        const e = res.value;
        io.out(`stopped ${formatDuration(e.billableSeconds)} · ${clientProjectLabel(e)}`);
      });
    });

  // ---------------------------------------------------------------- status
  program
    .command('status')
    .description('Show the open entry and its derived elapsed, or nothing running')
    .option('--json', 'machine-readable output')
    .action((opts) => {
      withStore((store) => {
        const status = store.status();
        if (opts.json) {
          io.out(JSON.stringify(statusJson(status)));
          return;
        }
        if (!status.entry) {
          io.out('nothing running');
          return;
        }
        io.out(statusLine(status.entry));
      });
    });

  // ---------------------------------------------------------------- resume
  program
    .command('resume')
    .description("Start a new entry from the last entry's attributes")
    .action(() => {
      withStore((store) => {
        const res = store.resume();
        printWarnings(io, res.warnings);
        io.out(statusLine(res.value));
      });
    });

  // ------------------------------------------------------------------- add
  program
    .command('add')
    .description('Backfill a completed entry')
    .argument('<description>', 'what you worked on')
    .requiredOption('--from <time>', 'start time')
    .requiredOption('--to <time>', 'end time')
    .option('--client <name>', 'client name')
    .option('--project <name>', 'project name')
    .option('--tag <tag>', 'tag (repeatable)', collect, [])
    .option('--bill', 'mark billable')
    .option('--no-bill', 'mark non-billable')
    .action((description: string, opts) => {
      withStore((store) => {
        const attrs = resolveAttributes(store, opts);
        const res = store.add({
          description,
          fromUtc: parseTime(opts.from, now()),
          toUtc: parseTime(opts.to, now()),
          clientId: attrs.clientId,
          projectId: attrs.projectId,
          tags: attrs.tags,
          ...(attrs.billable !== undefined ? { billable: attrs.billable } : {}),
        });
        printWarnings(io, res.warnings);
        io.out(`added entry ${res.value.id} · ${formatDuration(res.value.rawSeconds)}`);
      });
    });

  // ------------------------------------------------------------------ edit
  program
    .command('edit')
    .description('Amend any field of an entry')
    .argument('<id>', 'entry id')
    .option('--desc <text>', 'description')
    .option('--from <time>', 'new start')
    .option('--to <time>', 'new end')
    .option('--client <name>', 'client name')
    .option('--project <name>', 'project name')
    .option('--tag <tag>', 'add a tag (repeatable)', collect, [])
    .option('--untag <tag>', 'remove a tag (repeatable)', collect, [])
    .option('--bill', 'mark billable')
    .option('--no-bill', 'mark non-billable')
    .action((id: string, opts) => {
      withStore((store) => {
        const patch: Parameters<Store['edit']>[1] = {};
        if (opts.desc !== undefined) patch.description = opts.desc;
        if (opts.from) patch.startUtc = parseTime(opts.from, now());
        if (opts.to) patch.endUtc = parseTime(opts.to, now());
        if (opts.project) {
          // Resolving a project also fixes the client (project⇒client); the entry's
          // current client is the fallback when --client is not given.
          const resolved = store.resolveClientProjectByName({
            client: opts.client,
            project: opts.project,
            fallbackClientId: store.getEntry(Number(id))?.clientId ?? null,
          });
          patch.clientId = resolved.clientId;
          patch.projectId = resolved.projectId;
        } else if (opts.client) {
          patch.clientId = store.ensureClient(opts.client).id;
        }
        if (opts.bill !== undefined) patch.billable = opts.bill;
        if (opts.tag?.length) patch.addTags = opts.tag;
        if (opts.untag?.length) patch.removeTags = opts.untag;
        const res = store.edit(Number(id), patch);
        printWarnings(io, res.warnings);
        io.out(`edited entry ${res.value.id}`);
      });
    });

  // ----------------------------------------------------------------- split
  program
    .command('split')
    .description('Cut an entry into two at an instant within its span')
    .argument('<id>', 'entry id')
    .requiredOption('--at <time>', 'split point')
    .action((id: string, opts) => {
      withStore((store) => {
        const [a, b] = store.split(Number(id), parseTime(opts.at, now()));
        io.out(`split entry ${id} into ${a.id} and ${b.id}`);
      });
    });

  // ----------------------------------------------------------------- merge
  program
    .command('merge')
    .description('Merge a contiguous selection into one entry')
    .argument('<ids...>', 'entry ids')
    .option('--client <name>', 'resolve client conflicts to this client')
    .option('--project <name>', 'resolve project conflicts to this project')
    .action((ids: string[], opts) => {
      withStore((store) => {
        const mergeOpts: Parameters<Store['merge']>[1] = {};
        if (opts.client || opts.project) {
          const resolved = store.resolveClientProjectByName({
            client: opts.client,
            project: opts.project,
          });
          mergeOpts.clientId = resolved.clientId;
          if (opts.project) mergeOpts.projectId = resolved.projectId;
        }
        const res = store.merge(ids.map(Number), mergeOpts);
        printWarnings(io, res.warnings);
        io.out(`merged into entry ${res.value.id} · ${formatDuration(res.value.rawSeconds)}`);
      });
    });

  // -------------------------------------------------------------------- rm
  program
    .command('rm')
    .description('Delete an entry')
    .argument('<id>', 'entry id')
    .option('--force', 'skip confirmation')
    .action((id: string, opts) => {
      withStore((store) => {
        if (!opts.force) {
          throw new CliError(
            `refusing to delete entry ${id} without confirmation; pass --force`,
          );
        }
        store.remove(Number(id));
        io.out(`deleted entry ${id}`);
      });
    });

  // ------------------------------------------------------------------ list
  program
    .command('list')
    .alias('ls')
    .description('List entries')
    .option('--today', 'today')
    .option('--week', 'this week')
    .option('--last-week', 'last week')
    .option('--month', 'this month')
    .option('--last-month', 'last month')
    .option('--range <from...>', 'custom range: FROM TO')
    .option('--client <name>', 'filter by client')
    .option('--project <name>', 'filter by project')
    .option('--tag <tag>', 'filter by tag')
    .option('--search <text>', 'free-text query on description/client/project/tag')
    .option('--by <grouping>', 'group the table: client | project | day | tag')
    .option('--all', 'include non-billable')
    .option('--non-billable', 'only non-billable')
    .option('--json', 'machine-readable output')
    .action((opts) => {
      withStore((store) => {
        const settings = store.settings();
        const range = resolveRangeOpts(normalizeRange(opts), settings, now());
        const filter: Parameters<Store['listEntries']>[0] = {
          billable: billableFilter(opts),
        };
        if (range) {
          filter.fromUtc = range.fromUtc;
          filter.toUtc = range.toUtc;
        }
        const emptyList = (): void => io.out(opts.json ? '[]' : 'no entries');
        if (opts.client) {
          const c = store.findClientByName(opts.client);
          if (!c) return emptyList();
          filter.clientId = c.id;
        }
        if (opts.project) {
          const p = store.findProjectByName(opts.project, filter.clientId);
          if (!p) return emptyList();
          filter.projectId = p.id;
        }
        if (opts.tag) filter.tag = opts.tag;
        if (opts.search) filter.search = opts.search;
        const entries = store.listEntries(filter);
        // The --json scripting contract stays the flat row array (search/filters only
        // narrow rows; the row shape is unchanged), so grouping never affects it.
        if (opts.json) {
          io.out(JSON.stringify(toJsonEntries(entries, now())));
          return;
        }
        if (entries.length === 0) {
          io.out('no entries');
          return;
        }
        const overlaps = detectOverlaps(entries, now());
        const headers = ['ID', 'START', 'END', 'DUR', 'CLIENT/PROJECT', 'DESCRIPTION', 'BILL', 'FLAGS'];
        const toRow = (e: EntryView): string[] => [
          String(e.id),
          shortUtc(e.startUtc),
          shortUtc(e.endUtc),
          formatDuration(e.billableSeconds),
          clientProjectLabel(e),
          e.description ?? '',
          e.billable ? 'yes' : 'no',
          entryFlags(e, overlaps.has(e.id)),
        ];
        // --by groups the human table exactly as the Entries view does (one core helper,
        // buildEntryList), with a per-group header carrying the key + summed billable
        // hours. Without --by the table is the flat list it has always been.
        if (opts.by) {
          const by = opts.by as EntryGroupBy;
          if (!['client', 'project', 'day', 'tag'].includes(by)) {
            throw new CliError(`unknown --by grouping "${by}"`);
          }
          const { groups } = buildEntryList(entries, { by });
          const blocks = groups.map((g) => {
            const total = g.entries.reduce((s, e) => s + e.billableSeconds, 0);
            return (
              `${g.key}  (${formatHours(total)}h)\n` + table(headers, g.entries.map(toRow))
            );
          });
          io.out(blocks.join('\n\n'));
          return;
        }
        io.out(table(headers, entries.map(toRow)));
      });
    });

  // ---------------------------------------------------------------- report
  const report = program
    .command('report')
    .enablePositionalOptions()
    .description('Grouped totals (ad-hoc query; saved reports under `report save|ls|show|rm|run`)')
    .option('--today', 'today')
    .option('--week', 'this week')
    .option('--last-week', 'last week')
    .option('--month', 'this month')
    .option('--last-month', 'last month')
    .option('--range <from...>', 'custom range: FROM TO')
    .option('--by <grouping>', 'client | project | day | tag', 'client')
    .option('--round [minutes]', 'round grouped totals (default increment from settings)')
    .option('--client <name>', 'filter by client')
    .option('--project <name>', 'filter by project')
    .option('--tag <tag>', 'filter by tag')
    .option('--search <text>', 'free-text query on description/client/project/tag')
    .option('--all', 'include non-billable')
    .option('--non-billable', 'only non-billable')
    .option('--csv', 'CSV output')
    .option('--json', 'machine-readable output')
    .action((opts) => {
      withStore((store) => {
        const settings = store.settings();
        const range = resolveRangeOpts(normalizeRange(opts), settings, now(), 'week')!;
        const by = opts.by as GroupBy;
        if (!['client', 'project', 'day', 'tag'].includes(by)) {
          throw new CliError(`unknown --by grouping "${by}"`);
        }
        let rounding = settings.rounding;
        let roundingIncrementMin = settings.roundingIncrementMin;
        if (opts.round !== undefined) {
          rounding = true;
          if (typeof opts.round === 'string') roundingIncrementMin = Number(opts.round);
        }
        const req: Parameters<Store['report']>[0] = {
          fromUtc: range.fromUtc,
          toUtc: range.toUtc,
          by,
          billableFilter: billableFilter(opts),
          rounding,
          roundingIncrementMin,
        };
        // Unknown --client/--project means "no matching entries" — consistent with
        // `list`, not "report everything" (a -1 id matches nothing).
        if (opts.client) {
          req.clientId = store.findClientByName(opts.client)?.id ?? -1;
        }
        if (opts.project) {
          req.projectId = store.findProjectByName(opts.project, req.clientId)?.id ?? -1;
        }
        if (opts.tag) req.tag = opts.tag;
        if (opts.search) req.search = opts.search;
        const built = store.report(req);
        if (opts.json) {
          io.out(JSON.stringify(reportJson(built)));
          return;
        }
        if (opts.csv) {
          // Mirror the JSON/table narrowing: the CSV export covers the same set the
          // report reports on, so client/project/tag/search filters must travel here too
          // (otherwise `report --search … --csv` would export the whole range).
          const entries = store.listEntries({
            fromUtc: range.fromUtc,
            toUtc: range.toUtc,
            billable: req.billableFilter,
            ...(req.clientId !== undefined ? { clientId: req.clientId } : {}),
            ...(req.projectId !== undefined ? { projectId: req.projectId } : {}),
            ...(req.tag !== undefined ? { tag: req.tag } : {}),
            ...(req.search !== undefined ? { search: req.search } : {}),
          });
          io.out(toCsv(entries, now()).replace(/\n$/, ''));
          return;
        }
        io.out(renderReport(built, rounding));
      });
    });

  // ----------------------------------------------- report save|ls|show|rm|run (§09 R08–R09)
  // Saved reports are subcommands of `report`; the bare `report …` query form above stays
  // intact. All logic is in @stint/core (store.saveReport/runReport/…); these verbs are
  // thin shells, at full parity with the GUI Reports view.
  report
    .command('save')
    .description('Save a named report definition')
    .argument('<name>', 'saved report name')
    .option('--today', 'today')
    .option('--week', 'this week')
    .option('--last-week', 'last week')
    .option('--month', 'this month')
    .option('--last-month', 'last month')
    .option('--range <from...>', 'absolute range: FROM TO')
    .option('--by <grouping>', 'client | project | day | tag', 'client')
    .option('--round [minutes]', 'round grouped totals (default increment from settings)')
    .option('--client <name>', 'filter by client')
    .option('--project <name>', 'filter by project')
    .option('--tag <tag>', 'filter by tag')
    .option('--search <text>', 'free-text query on description/client/project/tag')
    .option('--all', 'include non-billable')
    .option('--non-billable', 'only non-billable')
    .action((name: string, opts) => {
      withStore((store) => {
        const input = buildSavedReportInput(store, name, opts, now());
        try {
          const def = store.saveReport(input);
          io.out(`saved report "${def.name}"`);
        } catch (err) {
          throw new CliError((err as Error).message);
        }
      });
    });
  report
    .command('ls')
    .description('List saved report definitions')
    .option('--json', 'machine-readable output')
    .action((opts) =>
      withStore((store) => {
        const defs = store.listReports();
        if (opts.json) {
          io.out(JSON.stringify(reportDefListJson(defs)));
          return;
        }
        if (defs.length === 0) {
          io.out('no saved reports');
          return;
        }
        io.out(
          table(
            ['NAME', 'RANGE', 'BY', 'BILLABLE'],
            defs.map((d) => [d.name, reportRangeSpecLine(d), d.by, d.billableFilter]),
          ),
        );
      }),
    );
  report
    .command('show')
    .description('Show a saved report definition')
    .argument('<name>', 'saved report name')
    .option('--json', 'machine-readable output')
    .action((name: string, opts) =>
      withStore((store) => {
        const def = store.getReport(name);
        if (!def) throw new CliError(`no saved report named "${name}"`);
        if (opts.json) {
          io.out(JSON.stringify(reportDefJson(def)));
          return;
        }
        io.out(reportDefDetail(def));
      }),
    );
  report
    .command('edit')
    .description('Amend a saved report definition (range/grouping/filters/rounding)')
    .argument('<name>', 'saved report name')
    .option('--today', 'today')
    .option('--week', 'this week')
    .option('--last-week', 'last week')
    .option('--month', 'this month')
    .option('--last-month', 'last month')
    .option('--range <from...>', 'absolute range: FROM TO')
    .option('--by <grouping>', 'client | project | day | tag')
    .option('--round [minutes]', 'round grouped totals')
    .option('--no-round', 'turn rounding off')
    .option('--client <name>', 'filter by client')
    .option('--project <name>', 'filter by project')
    .option('--tag <tag>', 'filter by tag')
    .option('--search <text>', 'free-text query on description/client/project/tag')
    .option('--all', 'include non-billable')
    .option('--billable', 'only billable')
    .option('--non-billable', 'only non-billable')
    .action((name: string, opts) => {
      withStore((store) => {
        const existing = store.getReport(name);
        if (!existing) throw new CliError(`no saved report named "${name}"`);
        const patch = buildSavedReportPatch(store, opts, now());
        try {
          store.editReport(name, patch);
          io.out(`edited report "${name}"`);
        } catch (err) {
          throw new CliError((err as Error).message);
        }
      });
    });
  report
    .command('rename')
    .description('Rename a saved report')
    .argument('<name>', 'saved report name')
    .argument('<newName>', 'new name')
    .action((name: string, newName: string) =>
      withStore((store) => {
        try {
          store.renameReport(name, newName);
          io.out(`renamed report to "${newName}"`);
        } catch (err) {
          throw new CliError((err as Error).message);
        }
      }),
    );
  report
    .command('rm')
    .description('Delete a saved report')
    .argument('<name>', 'saved report name')
    .action((name: string) =>
      withStore((store) => {
        try {
          store.removeReport(name);
          io.out(`deleted report "${name}"`);
        } catch (err) {
          throw new CliError((err as Error).message);
        }
      }),
    );
  report
    .command('run')
    .description('Run a saved report against current data')
    .argument('<name>', 'saved report name')
    .option('--csv', 'CSV output')
    .option('--json', 'machine-readable output')
    .action((name: string, opts) =>
      withStore((store) => {
        const def = store.getReport(name);
        if (!def) throw new CliError(`no saved report named "${name}"`);
        if (opts.csv) {
          // §09 R09 — CSV/JSON export from a saved report: the RAW entries for the resolved
          // range (billable='all', no narrowing — byte-identical to `tt export` for that
          // window), rendered through the SAME core export path the GUI export uses.
          io.out((store.exportSavedReport(name, 'csv', now()) as string).replace(/\n$/, ''));
          return;
        }
        // --json (and the default human view) render the grouped Report runReport builds —
        // the standard Report shape `tt report` already emits (report.schema.json).
        const built = store.runReport(name, now());
        if (opts.json) {
          io.out(JSON.stringify(reportJson(built)));
          return;
        }
        io.out(renderReport(built, def.rounding));
      }),
    );

  // ---------------------------------------------------------------- export
  program
    .command('export')
    .description('Raw entries for a range')
    .option('--today', 'today')
    .option('--week', 'this week')
    .option('--last-week', 'last week')
    .option('--month', 'this month')
    .option('--last-month', 'last month')
    .option('--range <from...>', 'custom range: FROM TO')
    .option('--csv', 'CSV output (default)')
    .option('--json', 'JSON output')
    .option('-o, --output <file>', 'write to a file instead of stdout')
    .action((opts) => {
      withStore((store) => {
        const settings = store.settings();
        const range = resolveRangeOpts(normalizeRange(opts), settings, now(), 'week')!;
        const entries = store.listEntries({
          fromUtc: range.fromUtc,
          toUtc: range.toUtc,
          billable: 'all',
        });
        const payload = opts.json
          ? JSON.stringify(toJsonEntries(entries, now()), null, 2)
          : toCsv(entries, now());
        if (opts.output) {
          writeFileSync(opts.output, payload.endsWith('\n') ? payload : payload + '\n');
          io.out(`wrote ${entries.length} entries to ${opts.output}`);
        } else {
          io.out(payload.replace(/\n$/, ''));
        }
      });
    });

  // ---------------------------------------------------------------- client
  const client = program.command('client').description('Manage clients');
  client
    .command('add')
    .argument('<name>')
    .action((name: string) => withStore((s) => io.out(`client ${s.addClient(name).id} "${name}"`)));
  client
    .command('rename')
    .argument('<ref>')
    .argument('<name>')
    .action((ref: string, name: string) =>
      withStore((s) => {
        s.renameClient(resolveEntityRef(ref, (n) => s.findClientByName(n)), name);
        io.out(`renamed client to "${name}"`);
      }),
    );
  client
    .command('archive')
    .argument('<ref>')
    .action((ref: string) =>
      withStore((s) => {
        s.archiveClient(resolveEntityRef(ref, (n) => s.findClientByName(n)));
        io.out('archived');
      }),
    );
  client
    .command('ls')
    .option('--archived', 'include archived')
    .option('--json', 'machine-readable output')
    .action((opts) =>
      withStore((s) =>
        emitList(io, opts.json, {
          items: s.listClients(!!opts.archived),
          toJson: (cs) => cs.map((c) => ({ id: c.id, name: c.name, archived: c.archived })),
          empty: 'no clients',
          headers: ['ID', 'NAME', 'ARCHIVED'],
          toRow: (c) => [String(c.id), c.name, c.archived ? 'yes' : ''],
        }),
      ),
    );

  // --------------------------------------------------------------- project
  const project = program.command('project').description('Manage projects');
  project
    .command('add')
    .argument('<name>')
    .requiredOption('--client <name>', 'owning client')
    .action((name: string, opts) =>
      withStore((s) => {
        const c = s.ensureClient(opts.client);
        io.out(`project ${s.addProject(name, c.id).id} "${name}" for "${c.name}"`);
      }),
    );
  project
    .command('rename')
    .argument('<ref>')
    .argument('<name>')
    .action((ref: string, name: string) =>
      withStore((s) => {
        s.renameProject(resolveEntityRef(ref, (n) => s.findProjectByName(n)), name);
        io.out(`renamed project to "${name}"`);
      }),
    );
  project
    .command('archive')
    .argument('<ref>')
    .action((ref: string) =>
      withStore((s) => {
        s.archiveProject(resolveEntityRef(ref, (n) => s.findProjectByName(n)));
        io.out('archived');
      }),
    );
  project
    .command('ls')
    .option('--client <name>', 'filter by client')
    .option('--archived', 'include archived')
    .option('--json', 'machine-readable output')
    .action((opts) =>
      withStore((s) => {
        const clientId = opts.client ? s.findClientByName(opts.client)?.id : undefined;
        emitList(io, opts.json, {
          items: s.listProjects(clientId, !!opts.archived),
          toJson: (ps) =>
            ps.map((p) => ({ id: p.id, client_id: p.clientId, name: p.name, archived: p.archived })),
          empty: 'no projects',
          headers: ['ID', 'NAME', 'CLIENT_ID', 'ARCHIVED'],
          toRow: (p) => [String(p.id), p.name, String(p.clientId), p.archived ? 'yes' : ''],
        });
      }),
    );

  // ------------------------------------------------------------------- tag
  // §12 R10 — manage tags at parity with `tt client`/`tt project`. Tags are otherwise
  // born on the fly when first applied (§03); these are the explicit manage-them-first
  // verbs the Clients view's tag controls mirror. `ls` shares the one emitList contract.
  const tag = program.command('tag').description('Manage tags');
  tag
    .command('add')
    .argument('<name>')
    .action((name: string) => withStore((s) => io.out(`tag ${s.addTag(name).id} "${name}"`)));
  tag
    .command('rename')
    .argument('<ref>')
    .argument('<name>')
    .action((ref: string, name: string) =>
      withStore((s) => {
        s.renameTag(resolveEntityRef(ref, (n) => s.findTagByName(n)), name);
        io.out(`renamed tag to "${name}"`);
      }),
    );
  tag
    .command('archive')
    .argument('<ref>')
    .action((ref: string) =>
      withStore((s) => {
        s.archiveTag(resolveEntityRef(ref, (n) => s.findTagByName(n)));
        io.out('archived');
      }),
    );
  tag
    .command('ls')
    .option('--archived', 'include archived')
    .option('--json', 'machine-readable output')
    .action((opts) =>
      withStore((s) =>
        emitList(io, opts.json, {
          items: s.listTags(!!opts.archived),
          toJson: (ts) => ts.map((t) => ({ id: t.id, name: t.name, archived: t.archived })),
          empty: 'no tags',
          headers: ['ID', 'NAME', 'ARCHIVED'],
          toRow: (t) => [String(t.id), t.name, t.archived ? 'yes' : ''],
        }),
      ),
    );

  // ------------------------------------------------------------------- fav
  // §05 R09 — favorites (pinned timer templates). All logic is in @stint/core
  // (store.pinFavorite/listFavorites/renameFavorite/unpinFavorite); these verbs are thin
  // shells at full parity with the GUI Timer view's favorites rail. (Resume from a favorite —
  // `fav start` / `start --fav` — is §05 R10, not this command group.)
  const fav = program.command('fav').description('Manage pinned timer favorites');
  fav
    .command('add')
    .description('Pin a favorite from a running/closed entry or from explicit attributes')
    .argument('<name>', 'favorite name')
    .option('--from-entry <id>', 'capture the template from this entry')
    .option('--running', 'capture the template from the running entry')
    .option('--desc <text>', 'description')
    .option('--client <name>', 'client name')
    .option('--project <name>', 'project name')
    .option('--tag <tag>', 'tag (repeatable)', collect, [])
    .option('--bill', 'mark billable')
    .option('--no-bill', 'mark non-billable')
    .action((name: string, opts) => {
      withStore((store) => {
        const template: Parameters<Store['pinFavorite']>[0] = { name };
        if (opts.running) {
          template.fromEntryId = 'open';
        } else if (opts.fromEntry !== undefined) {
          template.fromEntryId = Number(opts.fromEntry);
        } else {
          // Explicit attributes: resolve client/project names through core's single rule.
          const attrs = resolveAttributes(store, opts);
          template.description = opts.desc ?? null;
          template.clientId = attrs.clientId;
          template.projectId = attrs.projectId;
          template.tags = attrs.tags;
          if (attrs.billable !== undefined) template.billable = attrs.billable;
        }
        try {
          const created = store.pinFavorite(template);
          io.out(`pinned favorite "${created.name}"`);
        } catch (err) {
          throw new CliError((err as Error).message);
        }
      });
    });
  fav
    .command('start')
    .description('Start a fresh timer from a pinned favorite (§05 R10)')
    .argument('<name>', 'favorite name')
    .action((name: string) => {
      withStore((store) => {
        // §05 R10 — resume from a favorite: a FRESH entry from the template (core delegates to
        // start, so it atomically closes any open entry and inherits the overlap warning). The
        // favorite is never mutated. Parity with the GUI rail's Resume + `tt start --fav`.
        try {
          const res = store.startFromFavorite(name);
          printWarnings(io, res.warnings);
          io.out(statusLine(res.value));
        } catch (err) {
          throw new CliError((err as Error).message);
        }
      });
    });
  fav
    .command('ls')
    .description('List pinned favorites')
    .option('--json', 'machine-readable output')
    .action((opts) =>
      withStore((store) => {
        const favs = store.listFavorites();
        if (opts.json) {
          io.out(JSON.stringify(favoriteListJson(favs)));
          return;
        }
        if (favs.length === 0) {
          io.out('no favorites');
          return;
        }
        // Resolve each favorite's client/project ids to a label (the store holds the names).
        const clientNames = new Map(store.listClients(true).map((c) => [c.id, c.name]));
        const projectNames = new Map(store.listProjects(undefined, true).map((p) => [p.id, p.name]));
        io.out(
          table(
            ['NAME', 'CLIENT/PROJECT', 'DESCRIPTION', 'BILL', 'TAGS'],
            favs.map((f) => {
              const cp =
                joinClientProject(
                  f.clientId !== null ? clientNames.get(f.clientId) ?? null : null,
                  f.projectId !== null ? projectNames.get(f.projectId) ?? null : null,
                ) ?? '—';
              return favoriteRow(f, cp);
            }),
          ),
        );
      }),
    );
  fav
    .command('rename')
    .description('Rename a favorite')
    .argument('<ref>', 'favorite name or id')
    .argument('<name>', 'new name')
    .action((ref: string, name: string) =>
      withStore((store) => {
        try {
          store.renameFavorite(/^\d+$/.test(ref) ? Number(ref) : ref, name);
          io.out(`renamed favorite to "${name}"`);
        } catch (err) {
          throw new CliError((err as Error).message);
        }
      }),
    );
  fav
    .command('rm')
    .description('Unpin a favorite')
    .argument('<ref>', 'favorite name or id')
    .action((ref: string) =>
      withStore((store) => {
        try {
          store.unpinFavorite(/^\d+$/.test(ref) ? Number(ref) : ref);
          io.out('unpinned');
        } catch (err) {
          throw new CliError((err as Error).message);
        }
      }),
    );

  // ---------------------------------------------------------------- backup
  // §20 R04/R05, §17 R12 — automatic backups + recovery. All logic is in @stint/core
  // (store.listBackups/backupNow/restoreFromBackup over the file-level backup module); these
  // verbs are thin shells, at full parity with the GUI Settings → Backups section (the tt mirror
  // of "Last backup", "Back up now", and Restore…). Retention is the `backup_retention` setting,
  // changed via `tt config set backup_retention <N>` — no separate backup-config command.
  const backup = program.command('backup').description('Manage automatic backups (§20 R04/R05)');
  backup
    .command('ls')
    .description('List the timestamped backups beside the database (newest first)')
    .option('--json', 'machine-readable output')
    .action((opts) =>
      withStore((store) => {
        const backups = store.listBackups();
        if (opts.json) {
          io.out(JSON.stringify(backupListJson(backups)));
          return;
        }
        if (backups.length === 0) {
          io.out('no backups');
          return;
        }
        io.out(
          table(
            ['NAME', 'CREATED', 'SIZE'],
            backups.map((b) => [b.name, shortUtc(b.createdUtc), `${b.sizeBytes}`]),
          ),
        );
      }),
    );
  backup
    .command('now')
    .description('Force a backup now (a no-op when the database is unchanged)')
    .action(() =>
      withStore((store) => {
        const made = store.backupNow();
        io.out(made ? `backed up to ${made.name}` : 'unchanged — no new backup needed');
      }),
    );
  backup
    .command('restore')
    .description('Restore the database from a named backup (destructive — current file set aside)')
    .argument('<name>', 'backup file name (from `backup ls`)')
    .option('--force', 'skip confirmation')
    .action((name: string, opts) =>
      withStore((store) => {
        if (!opts.force) {
          throw new CliError(
            `refusing to restore from "${name}" without confirmation; pass --force`,
          );
        }
        try {
          const r = store.restoreFromBackup(name);
          io.out(`restored from ${r.recoveredFrom}; previous file set aside at ${r.quarantinedTo}`);
        } catch (err) {
          throw new CliError((err as Error).message);
        }
      }),
    );

  // ----------------------------------------------------------------- sleep
  const sleep = program.command('sleep').description('Review sleep-flagged entries');
  sleep
    .command('ls', { isDefault: true })
    .option('--json', 'machine-readable output')
    .action((opts) =>
      withStore((s) =>
        emitList(io, opts.json, {
          items: s.listSleepFlagged(),
          toJson: (es) =>
            es.map((e) => ({
              id: e.id,
              description: e.description,
              excluded_s: e.excludedSeconds,
              spans: e.sleepSpans.map((sp) => ({
                sleep_utc: sp.sleepUtc,
                wake_utc: sp.wakeUtc,
                source: sp.source,
              })),
            })),
          empty: 'no sleep-flagged entries',
          headers: ['ID', 'DESCRIPTION', 'SPANS', 'EXCLUDED', 'SOURCES'],
          toRow: (e) => [
            String(e.id),
            e.description ?? '',
            String(e.sleepSpans.length),
            formatDuration(e.excludedSeconds),
            [...new Set(e.sleepSpans.map((sp) => sp.source))].join(','),
          ],
        }),
      ),
    );
  sleep
    .command('subtract')
    .argument('<id>')
    .description('Exclude slept time from billable duration (reversible)')
    .action((id: string) =>
      withStore((s) => {
        const r = s.subtractSleep(Number(id));
        if (r.after > r.before) {
          io.out(`excluded ${formatDuration(r.after)} of slept time from entry ${id}`);
        } else {
          io.out(`restored entry ${id}: slept time no longer excluded`);
        }
      }),
    );

  // ---------------------------------------------------------------- config
  const config = program.command('config').description('Read and set settings');
  config
    .command('ls', { isDefault: true })
    .option('--json', 'machine-readable output')
    .action((opts) =>
      withStore((s) => {
        const st = s.settings();
        if (opts.json) {
          io.out(JSON.stringify(st));
          return;
        }
        io.out(
          table(
            ['SETTING', 'VALUE'],
            SETTING_DESCRIPTORS.map((d) => [d.snake, String(st[d.key])]),
          ),
        );
      }),
    );
  config
    .command('set')
    .argument('<key>')
    .argument('<value>')
    .action((key: string, value: string) =>
      withStore((s) => {
        applySetting(s, key, value);
        io.out(`set ${key} = ${value}`);
      }),
    );

  program.exitOverride();
  return program;
}

function normalizeRange(opts: Record<string, unknown>): RangeOpts {
  const r = opts.range as string[] | undefined;
  const out: RangeOpts = {
    today: !!opts.today,
    week: !!opts.week,
    lastWeek: !!opts.lastWeek,
    month: !!opts.month,
    lastMonth: !!opts.lastMonth,
  };
  if (r && r.length >= 2) out.range = [r[0]!, r[1]!];
  return out;
}

/**
 * §09 R08 — assemble a SavedReportInput from the `report save` flags. The range becomes
 * an ABSOLUTE spec when `--range FROM TO` is given (the explicit bounds are parsed to UTC
 * and frozen), otherwise a relative PRESET (default `week`, matching the ad-hoc report's
 * default) that re-resolves on every run. Client/project names resolve to ids through the
 * same core lookups the ad-hoc query uses; an unknown name throws (no silent empty report).
 */
function buildSavedReportInput(
  store: Store,
  name: string,
  opts: {
    today?: boolean;
    week?: boolean;
    lastWeek?: boolean;
    month?: boolean;
    lastMonth?: boolean;
    range?: string[];
    by?: string;
    round?: string | boolean;
    client?: string;
    project?: string;
    tag?: string;
    search?: string;
    all?: boolean;
    nonBillable?: boolean;
  },
  nowDate: Date,
): SavedReportInput {
  const by = (opts.by ?? 'client') as GroupBy;
  if (!['client', 'project', 'day', 'tag'].includes(by)) {
    throw new CliError(`unknown --by grouping "${by}"`);
  }
  let rangeSpec: RangeSpec;
  if (opts.range && opts.range.length >= 2) {
    rangeSpec = {
      kind: 'absolute',
      fromUtc: parseTime(opts.range[0]!, nowDate),
      toUtc: parseTime(opts.range[1]!, nowDate),
    };
  } else {
    const preset = opts.today
      ? 'today'
      : opts.lastWeek
        ? 'last-week'
        : opts.month
          ? 'month'
          : opts.lastMonth
            ? 'last-month'
            : 'week';
    rangeSpec = { kind: 'preset', preset };
  }
  const settings = store.settings();
  let rounding = settings.rounding;
  let roundingIncrementMin = settings.roundingIncrementMin;
  if (opts.round !== undefined) {
    rounding = true;
    if (typeof opts.round === 'string') roundingIncrementMin = Number(opts.round);
  } else {
    rounding = false;
  }
  const input: SavedReportInput = {
    name,
    rangeSpec,
    by,
    billableFilter: billableFilter({ all: opts.all, nonBillable: opts.nonBillable }),
    rounding,
    roundingIncrementMin,
  };
  if (opts.client) {
    const c = store.findClientByName(opts.client);
    if (!c) throw new CliError(`no client "${opts.client}"`);
    input.clientId = c.id;
  }
  if (opts.project) {
    const p = store.findProjectByName(opts.project, input.clientId);
    if (!p) throw new CliError(`no project "${opts.project}"`);
    input.projectId = p.id;
  }
  if (opts.tag) input.tag = opts.tag;
  if (opts.search) input.search = opts.search;
  return input;
}

/**
 * §09 R08 — assemble a SavedReportPatch from the `report edit` flags. Only the axes the
 * user actually named are amended (an omitted flag leaves that field untouched); the range
 * is patched only when a preset flag or `--range` is given, becoming the matching spec.
 */
function buildSavedReportPatch(
  store: Store,
  opts: {
    today?: boolean;
    week?: boolean;
    lastWeek?: boolean;
    month?: boolean;
    lastMonth?: boolean;
    range?: string[];
    by?: string;
    round?: string | boolean;
    client?: string;
    project?: string;
    tag?: string;
    search?: string;
    all?: boolean;
    billable?: boolean;
    nonBillable?: boolean;
  },
  nowDate: Date,
): SavedReportPatch {
  const patch: SavedReportPatch = {};
  if (opts.range && opts.range.length >= 2) {
    patch.rangeSpec = {
      kind: 'absolute',
      fromUtc: parseTime(opts.range[0]!, nowDate),
      toUtc: parseTime(opts.range[1]!, nowDate),
    };
  } else if (opts.today) patch.rangeSpec = { kind: 'preset', preset: 'today' };
  else if (opts.week) patch.rangeSpec = { kind: 'preset', preset: 'week' };
  else if (opts.lastWeek) patch.rangeSpec = { kind: 'preset', preset: 'last-week' };
  else if (opts.month) patch.rangeSpec = { kind: 'preset', preset: 'month' };
  else if (opts.lastMonth) patch.rangeSpec = { kind: 'preset', preset: 'last-month' };
  if (opts.by !== undefined) {
    if (!['client', 'project', 'day', 'tag'].includes(opts.by)) {
      throw new CliError(`unknown --by grouping "${opts.by}"`);
    }
    patch.by = opts.by as GroupBy;
  }
  // commander sets opts.round to `false` when `--no-round` is passed, a string/true for
  // `--round [min]`, and leaves it undefined when neither is given.
  if (opts.round === false) {
    patch.rounding = false;
  } else if (opts.round !== undefined) {
    patch.rounding = true;
    if (typeof opts.round === 'string') patch.roundingIncrementMin = Number(opts.round);
  }
  if (opts.all) patch.billableFilter = 'all';
  else if (opts.nonBillable) patch.billableFilter = 'non-billable';
  else if (opts.billable) patch.billableFilter = 'billable';
  if (opts.client !== undefined) {
    const c = store.findClientByName(opts.client);
    if (!c) throw new CliError(`no client "${opts.client}"`);
    patch.clientId = c.id;
  }
  if (opts.project !== undefined) {
    const p = store.findProjectByName(opts.project, patch.clientId);
    if (!p) throw new CliError(`no project "${opts.project}"`);
    patch.projectId = p.id;
  }
  if (opts.tag !== undefined) patch.tag = opts.tag;
  if (opts.search !== undefined) patch.search = opts.search;
  return patch;
}

function applySetting(store: Store, key: string, value: string): void {
  const d = settingDescriptor(key);
  if (!d) throw new CliError(`unknown setting "${key}"`);
  const parsed = d.parse(value);
  if (parsed === undefined) throw new CliError(`invalid value for ${key}: "${value}"`);
  try {
    // setSetting → writeSetting runs the descriptor's validation (allowed increments,
    // positive minutes, week-start domain).
    store.setSetting(d.key, parsed as never);
  } catch (err) {
    throw new CliError((err as Error).message);
  }
}

function renderReport(report: ReturnType<Store['report']>, rounding: boolean): string {
  const dur = (s: number) => `${formatDuration(s)}  (${formatHours(s)}h)`;
  const lines: string[] = [];
  const head =
    `Report  ${shortUtc(report.rangeFromUtc)} → ${shortUtc(report.rangeToUtc)}  ` +
    `(${report.options.billableFilter}, by ${report.options.by}` +
    (rounding ? `, rounded ${report.options.roundingIncrementMin}m` : '') +
    ')';
  lines.push(head);
  lines.push('');
  for (const line of report.lines) {
    lines.push(`${line.key.padEnd(28)}${dur(rounding ? line.roundedSeconds : line.totalSeconds)}`);
    for (const child of line.children) {
      lines.push(
        `  ${child.key.padEnd(26)}${dur(rounding ? child.roundedSeconds : child.totalSeconds)}`,
      );
    }
  }
  lines.push('');
  lines.push(
    `${'Total'.padEnd(28)}${dur(rounding ? report.grandRoundedSeconds : report.grandTotalSeconds)}`,
  );
  if (report.overlappedEntryIds.length > 0) {
    lines.push(`⚠ overlapped entries: ${report.overlappedEntryIds.join(', ')}`);
  }
  if (report.unreviewedSleepEntryIds.length > 0) {
    lines.push(`⚠ unreviewed sleep on entries: ${report.unreviewedSleepEntryIds.join(', ')}`);
  }
  return lines.join('\n');
}

// Keep EntryView imported for downstream typing of helpers.
export type { EntryView };
