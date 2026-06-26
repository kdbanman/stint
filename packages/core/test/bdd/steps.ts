/**
 * Step definitions in the project's ubiquitous language (glossary.html). Each step
 * binds to the World interface, so it runs identically against @stint/core and tt.
 */
import { expect } from 'vitest';
import type { World, EntryRec } from './world.js';

/** Scenario-scoped scratch shared across steps. */
export interface Ctx {
  originalId?: number;
  lastId?: number;
  lastClosedId?: number;
  entryIds: number[];
  twoIds?: [number, number];
  mergedId?: number;
  lastWarned?: boolean;
}

export interface StepDef {
  pattern: RegExp;
  run: (world: World, ctx: Ctx, ...args: string[]) => void;
}

const DAY = '2026-06-24';
const iso = (hhmm: string): string => `${DAY}T${hhmm.padStart(5, '0')}:00Z`;

function open(world: World): EntryRec | undefined {
  return world.list().find((e) => e.endUtc === null);
}
function byDesc(world: World, desc: string): EntryRec {
  const e = world.list().find((x) => x.description === desc);
  if (!e) throw new Error(`no entry with description "${desc}"`);
  return e;
}
function thoseTwo(ctx: Ctx): number[] {
  return ctx.twoIds ?? ctx.entryIds.slice(-2);
}

export const steps: StepDef[] = [
  // ---- Given / setup -----------------------------------------------------
  { pattern: /^an empty database$/, run: (w) => w.reset() },
  {
    pattern: /^a client "([^"]*)" with project "([^"]*)"$/,
    run: (w, _c, client, project) => w.ensureClientProject(client, project),
  },
  {
    pattern: /^a closed entry "([^"]*)" from (\d{1,2}:\d{2}) to (\d{1,2}:\d{2})$/,
    run: (w, ctx, desc, from, to) => {
      const r = w.backfill({ desc, from: iso(from), to: iso(to) });
      ctx.lastClosedId = r.id;
      ctx.lastId = r.id;
      ctx.entryIds.push(r.id);
    },
  },
  {
    pattern:
      /^a closed entry "([^"]*)" for "([^"]*)" \/ "([^"]*)" from (\d{1,2}:\d{2}) to (\d{1,2}:\d{2})$/,
    run: (w, ctx, desc, client, project, from, to) => {
      const r = w.backfill({ desc, client, project, from: iso(from), to: iso(to) });
      ctx.lastClosedId = r.id;
      ctx.entryIds.push(r.id);
    },
  },
  {
    pattern: /^a closed entry "([^"]*)" for "([^"]*)" from (\d{1,2}:\d{2}) to (\d{1,2}:\d{2})$/,
    run: (w, ctx, desc, client, from, to) => {
      const r = w.backfill({ desc, client, from: iso(from), to: iso(to) });
      ctx.lastClosedId = r.id;
      ctx.entryIds.push(r.id);
    },
  },

  // ---- start / stop / resume / backfill ----------------------------------
  {
    pattern:
      /^I start an entry "([^"]*)" for "([^"]*)" \/ "([^"]*)" at (\d{1,2}:\d{2})$/,
    run: (w, ctx, desc, client, project, at) => {
      const r = w.start({ desc, client, project, atIso: iso(at) });
      ctx.originalId ??= r.id;
      ctx.lastId = r.id;
    },
  },
  {
    pattern: /^I start an entry "([^"]*)" at (\d{1,2}:\d{2})$/,
    run: (w, ctx, desc, at) => {
      const r = w.start({ desc, atIso: iso(at) });
      ctx.originalId ??= r.id;
      ctx.lastId = r.id;
    },
  },
  { pattern: /^I stop at (\d{1,2}:\d{2})$/, run: (w, _c, at) => w.stop(iso(at)) },
  {
    pattern: /^I resume$/,
    run: (w, ctx) => {
      ctx.lastId = w.resume().id;
    },
  },
  {
    pattern: /^I backfill an entry "([^"]*)" from (\d{1,2}:\d{2}) to (\d{1,2}:\d{2})$/,
    run: (w, ctx, desc, from, to) => {
      const r = w.backfill({ desc, from: iso(from), to: iso(to) });
      ctx.lastId = r.id;
      ctx.lastWarned = r.warned;
    },
  },
  {
    pattern: /^I split it at (\d{1,2}:\d{2})$/,
    run: (w, ctx, at) => {
      ctx.twoIds = w.split(ctx.lastClosedId!, iso(at)).ids;
    },
  },
  {
    pattern: /^I merge those two entries$/,
    run: (w, ctx) => {
      ctx.mergedId = w.merge(thoseTwo(ctx)).id;
    },
  },
  {
    pattern: /^I merge those two entries resolving to client "([^"]*)"$/,
    run: (w, ctx, client) => {
      ctx.mergedId = w.merge(thoseTwo(ctx), { client }).id;
    },
  },

  // ---- edit / billable override / reference data -------------------------
  {
    pattern: /^I mark the open entry billable$/,
    run: (w) => w.edit(open(w)!.id, { billable: true }),
  },
  {
    pattern: /^I mark the open entry non-billable$/,
    run: (w) => w.edit(open(w)!.id, { billable: false }),
  },
  {
    pattern: /^I edit the entry "([^"]*)" description to "([^"]*)"$/,
    run: (w, _c, desc, to) => w.edit(byDesc(w, desc).id, { desc: to }),
  },
  {
    pattern: /^I edit the open entry start to (\d{1,2}:\d{2})$/,
    run: (w, _c, at) => w.edit(open(w)!.id, { startUtc: iso(at) }),
  },
  {
    pattern: /^I rename client "([^"]*)" to "([^"]*)"$/,
    run: (w, _c, name, to) => w.renameClient(name, to),
  },
  {
    pattern: /^I archive client "([^"]*)"$/,
    run: (w, _c, name) => w.archiveClient(name),
  },

  // ---- assertions --------------------------------------------------------
  {
    pattern: /^exactly one entry is open$/,
    run: (w) => expect(w.list().filter((e) => e.endUtc === null)).toHaveLength(1),
  },
  {
    pattern: /^exactly zero entries are open$/,
    run: (w) => expect(w.list().filter((e) => e.endUtc === null)).toHaveLength(0),
  },
  {
    pattern: /^the entry "([^"]*)" is closed with end (\d{1,2}:\d{2})$/,
    run: (w, _c, desc, end) => {
      const e = byDesc(w, desc);
      expect(e.endUtc).toBe(iso(end));
    },
  },
  {
    pattern: /^the open entry is "([^"]*)"$/,
    run: (w, _c, desc) => expect(open(w)?.description).toBe(desc),
  },
  {
    pattern: /^the open entry is for "([^"]*)"$/,
    run: (w, _c, lbl) => expect(open(w)?.clientLabel).toBe(lbl),
  },
  {
    pattern: /^the open entry starts at (\d{1,2}:\d{2})$/,
    run: (w, _c, at) => expect(open(w)?.startUtc).toBe(iso(at)),
  },
  {
    pattern: /^the entry "([^"]*)" is for "([^"]*)"$/,
    run: (w, _c, desc, lbl) => expect(byDesc(w, desc).clientLabel).toBe(lbl),
  },
  {
    pattern: /^client "([^"]*)" is not in the active client list$/,
    run: (w, _c, name) => expect(w.activeClientNames()).not.toContain(name),
  },
  { pattern: /^the open entry is billable$/, run: (w) => expect(open(w)?.billable).toBe(true) },
  {
    pattern: /^the open entry is non-billable$/,
    run: (w) => expect(open(w)?.billable).toBe(false),
  },
  {
    pattern: /^the open entry has a different id from the original$/,
    run: (w, ctx) => {
      const o = open(w);
      expect(o).toBeDefined();
      expect(o!.id).not.toBe(ctx.originalId);
    },
  },
  {
    pattern: /^status reports an open entry "([^"]*)" for "([^"]*)"$/,
    run: (w, _c, desc, lbl) => {
      const s = w.status();
      expect(s.running).toBe(true);
      expect(s.description).toBe(desc);
      expect(s.clientLabel).toBe(lbl);
    },
  },
  {
    pattern: /^status reports nothing running$/,
    run: (w) => expect(w.status().running).toBe(false),
  },
  {
    pattern: /^the entry "([^"]*)" has a billable duration of (\d+) minutes$/,
    run: (w, _c, desc, mins) => expect(byDesc(w, desc).billableSeconds).toBe(Number(mins) * 60),
  },
  {
    pattern: /^the backfill succeeds$/,
    run: (w, ctx) => {
      expect(typeof ctx.lastId).toBe('number');
      expect(w.list().some((e) => e.id === ctx.lastId)).toBe(true);
    },
  },
  {
    pattern: /^a non-blocking overlap warning is surfaced$/,
    run: (_w, ctx) => expect(ctx.lastWarned).toBe(true),
  },
  {
    pattern: /^both entries are flagged overlapped in a report covering the day$/,
    run: (w) => {
      const flagged = w.reportOverlaps(`${DAY}T00:00:00Z`, '2026-06-25T00:00:00Z');
      expect(flagged.length).toBeGreaterThanOrEqual(2);
    },
  },
  {
    pattern: /^there are two entries covering (\d{1,2}:\d{2}) to (\d{1,2}:\d{2})$/,
    run: (w, ctx, from, to) => {
      const [a, b] = ctx.twoIds!;
      const entries = w.list().filter((e) => e.id === a || e.id === b);
      expect(entries).toHaveLength(2);
      const starts = entries.map((e) => e.startUtc).sort();
      const ends = entries.map((e) => e.endUtc!).sort();
      expect(starts[0]).toBe(iso(from));
      expect(ends[ends.length - 1]).toBe(iso(to));
    },
  },
  {
    pattern: /^there is one entry from (\d{1,2}:\d{2}) to (\d{1,2}:\d{2})$/,
    run: (w, _c, from, to) => {
      const entries = w.list();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.startUtc).toBe(iso(from));
      expect(entries[0]!.endUtc).toBe(iso(to));
    },
  },
  {
    pattern: /^the merged entry runs from (\d{1,2}:\d{2}) to (\d{1,2}:\d{2})$/,
    run: (w, ctx, from, to) => {
      const e = w.list().find((x) => x.id === ctx.mergedId)!;
      expect(e.startUtc).toBe(iso(from));
      expect(e.endUtc).toBe(iso(to));
    },
  },
  {
    pattern: /^the merged entry is for "([^"]*)"$/,
    run: (w, ctx, lbl) => {
      const e = w.list().find((x) => x.id === ctx.mergedId)!;
      expect(e.clientLabel).toBe(lbl);
    },
  },
];

export function matchStep(text: string): { def: StepDef; args: string[] } {
  for (const def of steps) {
    const m = def.pattern.exec(text);
    if (m) return { def, args: m.slice(1) };
  }
  throw new Error(`no step definition matches: ${text}`);
}
