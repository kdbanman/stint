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
import { Store, type Clock } from '@stint/core';

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

export interface World {
  readonly name: string;
  reset(): void;
  dispose(): void;
  ensureClientProject(client: string, project: string): void;
  start(o: { desc: string | null; client?: string; project?: string; atIso: string }): { id: number };
  stop(atIso: string): void;
  resume(): { id: number };
  backfill(o: { desc: string; from: string; to: string; client?: string; project?: string }): {
    id: number;
    warned: boolean;
  };
  split(id: number, atIso: string): { ids: [number, number] };
  merge(ids: number[]): { id: number; warned: boolean };
  list(): EntryRec[];
  status(): StatusRec;
  reportOverlaps(fromIso: string, toIso: string): number[];
}

function label(client: string | null, project: string | null): string | null {
  if (client && project) return `${client} / ${project}`;
  return client ?? project ?? null;
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
    let clientId: number | null = null;
    let projectId: number | null = null;
    if (o.client) clientId = this.store.ensureClient(o.client).id;
    if (o.project) {
      if (clientId === null) clientId = this.store.ensureClient('Internal').id;
      const p = this.store.findProjectByName(o.project, clientId) ?? this.store.addProject(o.project, clientId);
      projectId = p.id;
      clientId = p.clientId;
    }
    return { clientId, projectId };
  }
  start(o: { desc: string | null; client?: string; project?: string; atIso: string }): { id: number } {
    const { clientId, projectId } = this.ids(o);
    const r = this.store.start({ description: o.desc, clientId, projectId, atUtc: o.atIso });
    return { id: r.value.id };
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
  split(id: number, atIso: string): { ids: [number, number] } {
    const [a, b] = this.store.split(id, atIso);
    return { ids: [a.id, b.id] };
  }
  merge(ids: number[]): { id: number; warned: boolean } {
    const r = this.store.merge(ids);
    return { id: r.value.id, warned: r.warnings.length > 0 };
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
  start(o: { desc: string | null; client?: string; project?: string; atIso: string }): { id: number } {
    const args = ['start'];
    if (o.desc) args.push(o.desc);
    if (o.client) args.push('--client', o.client);
    if (o.project) args.push('--project', o.project);
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
  split(id: number, atIso: string): { ids: [number, number] } {
    const r = this.tt(['split', String(id), '--at', atIso]);
    const m = /into (\d+) and (\d+)/.exec(r.out)!;
    return { ids: [Number(m[1]), Number(m[2])] };
  }
  merge(ids: number[]): { id: number; warned: boolean } {
    const r = this.tt(['merge', ...ids.map(String)]);
    const id = Number(/merged into entry (\d+)/.exec(r.out)?.[1]);
    return { id, warned: /warning/.test(r.err) };
  }
  list(): EntryRec[] {
    const r = this.tt(['list', '--all', '--json']);
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
}
