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
  parseTime,
  formatDuration,
  formatHours,
  resolveRange,
  toCsv,
  detectOverlaps,
  type EntryView,
  type BillableFilter,
  type GroupBy,
  type Settings,
} from '@stint/core';
import {
  table,
  statusLine,
  clientProjectLabel,
  entryFlags,
  shortUtc,
} from './format.js';
import { statusJson, entriesJson, reportJson } from './serialize.js';

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
  let clientId: number | null = null;
  let projectId: number | null = null;
  if (opts.client) clientId = store.ensureClient(opts.client).id;
  if (opts.project) {
    if (clientId === null) {
      const found = store.findProjectByName(opts.project);
      if (!found) {
        throw new CliError(
          `project "${opts.project}" not found; pass --client to create it under a client`,
        );
      }
      projectId = found.id;
      clientId = found.clientId;
    } else {
      const existing = store.findProjectByName(opts.project, clientId);
      projectId = existing ? existing.id : store.addProject(opts.project, clientId).id;
    }
  }
  const tags = opts.tag ?? [];
  const out: { clientId: number | null; projectId: number | null; tags: string[]; billable?: boolean } = {
    clientId,
    projectId,
    tags,
  };
  // Tri-state: --bill ⇒ true, --no-bill ⇒ false, neither ⇒ undefined (use the default).
  if (opts.bill !== undefined) out.billable = opts.bill;
  return out;
}

function printWarnings(io: Io, warnings: { message: string }[]): void {
  for (const w of warnings) io.err(`warning: ${w.message}`);
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
  program
    .name('tt')
    .description('Stint time tracker — the command-line surface')
    .version('1.0.0')
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
    .action((description: string | undefined, opts) => {
      withStore((store) => {
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
        if (opts.client) patch.clientId = store.ensureClient(opts.client).id;
        if (opts.project) {
          const clientId = patch.clientId ?? store.getEntry(Number(id))?.clientId ?? null;
          if (clientId === null) throw new CliError('--project needs a client context (--client)');
          const existing = store.findProjectByName(opts.project, clientId);
          patch.projectId = existing ? existing.id : store.addProject(opts.project, clientId).id;
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
        if (opts.client) mergeOpts.clientId = store.ensureClient(opts.client).id;
        if (opts.project) {
          const clientId = mergeOpts.clientId ?? null;
          if (clientId === null) throw new CliError('--project needs --client to resolve');
          const existing = store.findProjectByName(opts.project, clientId);
          mergeOpts.projectId = existing ? existing.id : store.addProject(opts.project, clientId).id;
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
        if (opts.client) {
          const c = store.findClientByName(opts.client);
          if (c) filter.clientId = c.id;
          else {
            if (opts.json) io.out('[]');
            else io.out('no entries');
            return;
          }
        }
        if (opts.tag) filter.tag = opts.tag;
        const entries = store.listEntries(filter);
        if (opts.json) {
          io.out(JSON.stringify(entriesJson(entries, now())));
          return;
        }
        if (entries.length === 0) {
          io.out('no entries');
          return;
        }
        const overlaps = detectOverlaps(entries, now());
        io.out(
          table(
            ['ID', 'START', 'END', 'DUR', 'CLIENT/PROJECT', 'DESCRIPTION', 'BILL', 'FLAGS'],
            entries.map((e) => [
              String(e.id),
              shortUtc(e.startUtc),
              shortUtc(e.endUtc),
              formatDuration(e.billableSeconds),
              clientProjectLabel(e),
              e.description ?? '',
              e.billable ? 'yes' : 'no',
              entryFlags(e, overlaps.has(e.id)),
            ]),
          ),
        );
      });
    });

  // ---------------------------------------------------------------- report
  program
    .command('report')
    .description('Grouped totals')
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
        if (opts.client) {
          const c = store.findClientByName(opts.client);
          if (c) req.clientId = c.id;
        }
        if (opts.tag) req.tag = opts.tag;
        const report = store.report(req);
        if (opts.json) {
          io.out(JSON.stringify(reportJson(report)));
          return;
        }
        if (opts.csv) {
          const entries = store.listEntries({
            fromUtc: range.fromUtc,
            toUtc: range.toUtc,
            billable: req.billableFilter,
          });
          io.out(toCsv(entries, now()).replace(/\n$/, ''));
          return;
        }
        io.out(renderReport(report, rounding));
      });
    });

  // ---------------------------------------------------------------- export
  program
    .command('export')
    .description('Raw entries for a range')
    .option('--today', 'today')
    .option('--week', 'this week')
    .option('--month', 'this month')
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
          ? JSON.stringify(entriesJson(entries, now()), null, 2)
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
      withStore((s) => {
        const clients = s.listClients(!!opts.archived);
        if (opts.json) {
          io.out(JSON.stringify(clients.map((c) => ({ id: c.id, name: c.name, archived: c.archived }))));
          return;
        }
        if (clients.length === 0) {
          io.out('no clients');
          return;
        }
        io.out(
          table(
            ['ID', 'NAME', 'ARCHIVED'],
            clients.map((c) => [String(c.id), c.name, c.archived ? 'yes' : '']),
          ),
        );
      }),
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
        const projects = s.listProjects(clientId, !!opts.archived);
        if (opts.json) {
          io.out(
            JSON.stringify(
              projects.map((p) => ({ id: p.id, client_id: p.clientId, name: p.name, archived: p.archived })),
            ),
          );
          return;
        }
        if (projects.length === 0) {
          io.out('no projects');
          return;
        }
        io.out(
          table(
            ['ID', 'NAME', 'CLIENT_ID', 'ARCHIVED'],
            projects.map((p) => [String(p.id), p.name, String(p.clientId), p.archived ? 'yes' : '']),
          ),
        );
      }),
    );

  // ----------------------------------------------------------------- sleep
  const sleep = program.command('sleep').description('Review sleep-flagged entries');
  sleep
    .command('ls', { isDefault: true })
    .option('--json', 'machine-readable output')
    .action((opts) =>
      withStore((s) => {
        const flagged = s.listSleepFlagged();
        if (opts.json) {
          io.out(
            JSON.stringify(
              flagged.map((e) => ({
                id: e.id,
                description: e.description,
                excluded_s: e.excludedSeconds,
                spans: e.sleepSpans.map((sp) => ({
                  sleep_utc: sp.sleepUtc,
                  wake_utc: sp.wakeUtc,
                  source: sp.source,
                })),
              })),
            ),
          );
          return;
        }
        if (flagged.length === 0) {
          io.out('no sleep-flagged entries');
          return;
        }
        io.out(
          table(
            ['ID', 'DESCRIPTION', 'SPANS', 'EXCLUDED', 'SOURCES'],
            flagged.map((e) => [
              String(e.id),
              e.description ?? '',
              String(e.sleepSpans.length),
              formatDuration(e.excludedSeconds),
              [...new Set(e.sleepSpans.map((sp) => sp.source))].join(','),
            ]),
          ),
        );
      }),
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
            [
              ['rounding', String(st.rounding)],
              ['rounding_increment_min', String(st.roundingIncrementMin)],
              ['week_start', st.weekStart],
              ['first_checkin_min', String(st.firstCheckinMin)],
              ['checkin_interval_min', String(st.checkinIntervalMin)],
              ['global_hotkey', st.globalHotkey],
            ],
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

function applySetting(store: Store, key: string, value: string): void {
  switch (key) {
    case 'rounding':
      store.setSetting('rounding', value === 'true' || value === 'on');
      break;
    case 'rounding_increment_min':
      store.setSetting('roundingIncrementMin', Number(value));
      break;
    case 'week_start':
      if (value !== 'monday' && value !== 'sunday') throw new CliError('week_start must be monday or sunday');
      store.setSetting('weekStart', value);
      break;
    case 'first_checkin_min':
      store.setSetting('firstCheckinMin', Number(value));
      break;
    case 'checkin_interval_min':
      store.setSetting('checkinIntervalMin', Number(value));
      break;
    case 'global_hotkey':
      store.setSetting('globalHotkey', value);
      break;
    default:
      throw new CliError(`unknown setting "${key}"`);
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
