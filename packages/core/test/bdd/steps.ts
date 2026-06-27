/**
 * Step definitions in the project's ubiquitous language (glossary.html). Each step
 * binds to the World interface, so it runs identically against @stint/core and tt.
 */
import { expect } from 'vitest';
import type { World, EntryRec, ExportRowRec, EntryGroupRec, ListViewReq, FavoriteRec } from './world.js';

/** Scenario-scoped scratch shared across steps. */
export interface Ctx {
  originalId?: number;
  lastId?: number;
  lastClosedId?: number;
  entryIds: number[];
  twoIds?: [number, number];
  mergedId?: number;
  lastWarned?: boolean;
  /** §06 R1 — the result of the most recent `When I attempt to delete … without confirming`. */
  removeResult?: { refused: boolean };
  /** §09 R7 — the rows returned by the most recent `When I search for "X"`. */
  searchResults?: EntryRec[];
  /** §09 R6 — the rows returned by the most recent `When I export the range …`. */
  exportRows?: ExportRowRec[];
  /** §12 R9 — the accumulating Entries-view query the control-bar clauses build up. */
  listQuery?: ListViewReq;
  /** §12 R9 — the grouped result of the most recent Entries-view query. */
  listGroups?: EntryGroupRec[];
  /** §09 R09 — the grand total seconds of the most recent saved-report run. */
  runTotalSeconds?: number;
  /** §09 R09 — the grand total captured before a re-grouping edit, to prove regroup-invariance. */
  priorRunTotalSeconds?: number;
  /** §09 R09 — the rows from the most recent export-from-saved-report. */
  savedExportRows?: ExportRowRec[];
  /** §05 R09 — the favorites from the most recent `When I view the favorites`. */
  favorites?: FavoriteRec[];
  /** §05 R10 — the result of the most recent `When I attempt to resume from favorite "X"`. */
  resumeFavResult?: { rejected: boolean };
  /** §20 R03 — the result of the most recent `When I open the database` over a corrupt file. */
  integrityOpen?: { refused: boolean; wrote: boolean };
}

export interface StepDef {
  pattern: RegExp;
  run: (world: World, ctx: Ctx, ...args: string[]) => void;
}

const DAY = '2026-06-24';
const iso = (hhmm: string): string => `${DAY}T${hhmm.padStart(5, '0')}:00Z`;

// §09 R1 — fixed midday UTC anchors for the range scenarios. The clock (FIXED_NOW) is a
// Wednesday; an entry at midday on this Wednesday is unambiguously "this week", and one a
// full week earlier is unambiguously "last week", across any reasonable runner timezone.
// (Both BDD surfaces resolve the preset window through the SAME core resolveRange, so they
// always agree; these anchors only keep each entry clearly on the intended side.)
const THIS_WEEK_ANCHOR = '2026-06-24T12:00:00Z';
const LAST_WEEK_ANCHOR = '2026-06-17T12:00:00Z';

// §09 R2 — two midday-UTC anchors on DISTINCT days of the same week (the Mon-start week
// of the fixed Wednesday clock is Jun 22–28). 24h apart at midday UTC, so the local
// calendar day differs in any reasonable runner timezone — keeping by-day grouping
// deterministic without pinning a timezone. "day 1" and "day 2" in the grouping feature
// map to these so two entries can be placed on two distinct days of this week.
const THIS_WEEK_DAYS: Record<string, string> = {
  '1': '2026-06-24T12:00:00Z',
  '2': '2026-06-23T12:00:00Z',
};
const plusHours = (isoStart: string, hours: number): string =>
  new Date(Date.parse(isoStart) + hours * 3_600_000).toISOString();
const plusMinutes = (isoStart: string, minutes: number): string =>
  new Date(Date.parse(isoStart) + minutes * 60_000).toISOString();

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
  // §09 R1 — place a closed, client-attributed (so billable) entry of a given length in
  // this week or last week, relative to the fixed clock, for the range scenarios.
  {
    pattern: /^a closed entry "([^"]*)" for "([^"]*)" this week lasting (\d+) hours?$/,
    run: (w, ctx, desc, client, hours) => {
      const r = w.backfillAt({
        desc,
        client,
        fromIso: THIS_WEEK_ANCHOR,
        toIso: plusHours(THIS_WEEK_ANCHOR, Number(hours)),
      });
      ctx.lastClosedId = r.id;
      ctx.entryIds.push(r.id);
    },
  },
  // §08 R3 — place a closed, CLIENTLESS entry this week. A clientless entry defaults to
  // non-billable (PRD §08 clientless default: billable ?? clientId !== null), so this seeds
  // the non-billable side a report's billable filter must include or exclude.
  {
    pattern: /^a closed non-billable entry "([^"]*)" this week lasting (\d+) hours?$/,
    run: (w, ctx, desc, hours) => {
      const r = w.backfillAt({
        desc,
        fromIso: THIS_WEEK_ANCHOR,
        toIso: plusHours(THIS_WEEK_ANCHOR, Number(hours)),
      });
      ctx.lastClosedId = r.id;
      ctx.entryIds.push(r.id);
    },
  },
  {
    pattern: /^a closed entry "([^"]*)" for "([^"]*)" last week lasting (\d+) hours?$/,
    run: (w, ctx, desc, client, hours) => {
      const r = w.backfillAt({
        desc,
        client,
        fromIso: LAST_WEEK_ANCHOR,
        toIso: plusHours(LAST_WEEK_ANCHOR, Number(hours)),
      });
      ctx.lastClosedId = r.id;
      ctx.entryIds.push(r.id);
    },
  },
  // §09 R2 — place a closed, client/project-attributed, tagged entry on a chosen day of
  // this week, for the group-by scenarios. The tags (comma-separated) and the project let
  // one set of entries be regrouped by client / project / day / tag; the day selector
  // (1 or 2 → THIS_WEEK_DAYS) puts entries on distinct days so by-day grouping is observable.
  {
    pattern:
      /^a closed entry "([^"]*)" for "([^"]*)" \/ "([^"]*)" tagged "([^"]*)" this week on day (\d) lasting (\d+) hours?$/,
    run: (w, ctx, desc, client, project, tags, day, hours) => {
      const fromIso = THIS_WEEK_DAYS[day];
      if (!fromIso) throw new Error(`no this-week anchor for day "${day}"`);
      const r = w.backfillAt({
        desc,
        client,
        project,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        fromIso,
        toIso: plusHours(fromIso, Number(hours)),
      });
      ctx.lastClosedId = r.id;
      ctx.entryIds.push(r.id);
    },
  },

  // §09 R4 — place a closed, client/project-attributed entry of a given length in MINUTES
  // (not whole hours) on day 1 of this week, so a rounding scenario can use a duration that
  // is NOT a clean multiple of the rounding increment and observe nearest-not-always-up.
  {
    pattern:
      /^a closed entry "([^"]*)" for "([^"]*)" \/ "([^"]*)" this week lasting (\d+) minutes$/,
    run: (w, ctx, desc, client, project, minutes) => {
      const fromIso = THIS_WEEK_DAYS['1']!;
      const r = w.backfillAt({
        desc,
        client,
        project,
        fromIso,
        toIso: plusMinutes(fromIso, Number(minutes)),
      });
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
  {
    pattern:
      /^I switch to an entry "([^"]*)" for "([^"]*)" \/ "([^"]*)" at (\d{1,2}:\d{2})$/,
    run: (w, ctx, desc, client, project, at) => {
      const r = w.switch({ desc, client, project, atIso: iso(at) });
      ctx.lastId = r.id;
    },
  },
  {
    pattern: /^I switch to an entry "([^"]*)" at (\d{1,2}:\d{2})$/,
    run: (w, ctx, desc, at) => {
      const r = w.switch({ desc, atIso: iso(at) });
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
    // §12 R7 — the GUI Manual-add form carries client/project alongside the explicit
    // from/to (the same attribute set `tt add` accepts). This attribute-bearing backfill
    // is the surface-neutral parity twin: it resolves the client/project by name through
    // core's single rule, exactly as the `add` IPC and `tt add` do.
    pattern:
      /^I backfill an entry "([^"]*)" for "([^"]*)" \/ "([^"]*)" from (\d{1,2}:\d{2}) to (\d{1,2}:\d{2})$/,
    run: (w, ctx, desc, client, project, from, to) => {
      const r = w.backfill({ desc, client, project, from: iso(from), to: iso(to) });
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
  // §06 R1 — delete an entry outright, surface-neutral over the World `remove` capability
  // (CoreWorld store.remove, CliWorld `tt rm --force`). Proves the delete arithmetic — the
  // row is gone, the totals it carried no longer count — behaves identically on both surfaces.
  {
    pattern: /^I delete the entry "([^"]*)"$/,
    run: (w, _c, desc) => w.remove(byDesc(w, desc).id),
  },
  // §06 R1 — the confirm gate IS the loss-protection (core): attempt a delete WITHOUT
  // confirming over the World `removeUnconfirmed` capability (CoreWorld never auto-confirms a
  // destructive delete, CliWorld `tt rm` without --force refuses) and stash the result so the
  // assertions below can prove the gate held identically on both surfaces — the entry survives.
  {
    pattern: /^I attempt to delete the entry "([^"]*)" without confirming$/,
    run: (w, ctx, desc) => {
      ctx.removeResult = w.removeUnconfirmed(byDesc(w, desc).id);
    },
  },
  {
    pattern: /^I rename client "([^"]*)" to "([^"]*)"$/,
    run: (w, _c, name, to) => w.renameClient(name, to),
  },
  {
    pattern: /^I archive client "([^"]*)"$/,
    run: (w, _c, name) => w.archiveClient(name),
  },
  {
    pattern: /^I rename project "([^"]*)" to "([^"]*)"$/,
    run: (w, _c, name, to) => w.renameProject(name, to),
  },
  {
    pattern: /^I archive project "([^"]*)"$/,
    run: (w, _c, name) => w.archiveProject(name),
  },
  // §12 R10 — reference-data creation/management the Clients view exposes. Creating a
  // client/project is the GUI Add-client / Add-project parity twin; creating a tag is the
  // explicit manage-it-first path (tags are otherwise born on the fly when applied).
  {
    pattern: /^I add a client "([^"]*)"$/,
    run: (w, _c, name) => w.addClient(name),
  },
  {
    pattern: /^I add a project "([^"]*)" for client "([^"]*)"$/,
    run: (w, _c, name, client) => w.addProject(name, client),
  },
  {
    pattern: /^I add a tag "([^"]*)"$/,
    run: (w, _c, name) => w.addTag(name),
  },
  {
    pattern: /^I rename tag "([^"]*)" to "([^"]*)"$/,
    run: (w, _c, name, to) => w.renameTag(name, to),
  },
  {
    pattern: /^I archive tag "([^"]*)"$/,
    run: (w, _c, name) => w.archiveTag(name),
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
  // §06 R1 — delete arithmetic: the named row no longer exists, and the surviving rows are
  // exactly those expected (the deleted entry's time no longer counts toward the list).
  {
    pattern: /^there is no entry "([^"]*)"$/,
    run: (w, _c, desc) => expect(w.list().some((e) => e.description === desc)).toBe(false),
  },
  // §06 R1 — the loss-protection gate held: the unconfirmed delete was refused, and the named
  // entry is still present (the destructive action never destroyed data on either surface).
  {
    pattern: /^the delete is refused$/,
    run: (_w, ctx) => expect(ctx.removeResult?.refused).toBe(true),
  },
  {
    pattern: /^there is still an entry "([^"]*)"$/,
    run: (w, _c, desc) => expect(w.list().some((e) => e.description === desc)).toBe(true),
  },
  {
    pattern: /^there are exactly (\d+) entries$/,
    run: (w, _c, count) => expect(w.list()).toHaveLength(Number(count)),
  },
  {
    pattern: /^client "([^"]*)" is not in the active client list$/,
    run: (w, _c, name) => expect(w.activeClientNames()).not.toContain(name),
  },
  {
    pattern: /^project "([^"]*)" is not in the active project list$/,
    run: (w, _c, name) => expect(w.activeProjectNames()).not.toContain(name),
  },
  // §12 R10 — active-list membership for the reference-data the Clients view manages.
  {
    pattern: /^client "([^"]*)" is in the active client list$/,
    run: (w, _c, name) => expect(w.activeClientNames()).toContain(name),
  },
  {
    pattern: /^project "([^"]*)" is in the active project list$/,
    run: (w, _c, name) => expect(w.activeProjectNames()).toContain(name),
  },
  {
    pattern: /^tag "([^"]*)" is in the active tag list$/,
    run: (w, _c, name) => expect(w.activeTagNames()).toContain(name),
  },
  {
    pattern: /^tag "([^"]*)" is not in the active tag list$/,
    run: (w, _c, name) => expect(w.activeTagNames()).not.toContain(name),
  },
  { pattern: /^the open entry is billable$/, run: (w) => expect(open(w)?.billable).toBe(true) },
  {
    pattern: /^the entry "([^"]*)" is billable$/,
    run: (w, _c, desc) => expect(byDesc(w, desc).billable).toBe(true),
  },
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

  // ---- §09 R7 free-text search (the contract the GUI search box drives) ---
  // Surface-neutral over the World `search` capability: CoreWorld store.listEntries({ search }),
  // CliWorld `tt list --all --json --search <query>`. The result is captured so the assertions
  // below can check the matched descriptions / count — proving the filter identical on both.
  {
    pattern: /^I search for "([^"]*)"$/,
    run: (w, ctx, query) => {
      ctx.searchResults = w.search(query);
    },
  },
  {
    pattern: /^the search results are exactly "([^"]*)"$/,
    run: (_w, ctx, desc) => {
      const got = (ctx.searchResults ?? []).map((e) => e.description).sort();
      expect(got).toEqual([desc]);
    },
  },
  {
    pattern: /^the search results contain (\d+) entries$/,
    run: (_w, ctx, count) => {
      expect(ctx.searchResults ?? []).toHaveLength(Number(count));
    },
  },

  // ---- §12 R9 Entries-view grouping / filtering / search ------------------
  // The control bar the GUI Entries view drives (window.stint.listEntries) and `tt list
  // --by/--search/--range/--client/--project/--tag`. Each clause mutates an accumulating
  // ListViewReq and re-runs World.listView (CoreWorld store.listEntries+buildEntryList,
  // CliWorld `tt list … --json` then the SAME buildEntryList), so the surfaces are compared
  // on identical grouping. The assertions read the latest grouped result.
  {
    pattern: /^I view entries grouped by (day|client|project|tag)$/,
    run: (w, ctx, by) => {
      ctx.listQuery = { ...(ctx.listQuery ?? {}), by: by as ListViewReq['by'] };
      ctx.listGroups = w.listView(ctx.listQuery);
    },
  },
  {
    pattern: /^I view entries this week grouped by (day|client|project|tag)$/,
    run: (w, ctx, by) => {
      ctx.listQuery = { ...(ctx.listQuery ?? {}), by: by as ListViewReq['by'], preset: 'week' };
      ctx.listGroups = w.listView(ctx.listQuery);
    },
  },
  {
    pattern:
      /^I view entries grouped by (day|client|project|tag) for the range (\S+) to (\S+)$/,
    run: (w, ctx, by, from, to) => {
      ctx.listQuery = {
        ...(ctx.listQuery ?? {}),
        by: by as ListViewReq['by'],
        fromUtc: from,
        toUtc: to,
      };
      delete ctx.listQuery.preset;
      ctx.listGroups = w.listView(ctx.listQuery);
    },
  },
  {
    pattern: /^I filter the entry list to client "([^"]*)"$/,
    run: (w, ctx, client) => {
      ctx.listQuery = { by: 'day', ...(ctx.listQuery ?? {}), client };
      ctx.listGroups = w.listView(ctx.listQuery);
    },
  },
  {
    pattern: /^I filter the entry list to project "([^"]*)"$/,
    run: (w, ctx, project) => {
      ctx.listQuery = { by: 'day', ...(ctx.listQuery ?? {}), project };
      ctx.listGroups = w.listView(ctx.listQuery);
    },
  },
  {
    pattern: /^I filter the entry list to tag "([^"]*)"$/,
    run: (w, ctx, tag) => {
      ctx.listQuery = { by: 'day', ...(ctx.listQuery ?? {}), tag };
      ctx.listGroups = w.listView(ctx.listQuery);
    },
  },
  {
    pattern: /^I search the entry list for "([^"]*)"$/,
    run: (w, ctx, query) => {
      ctx.listQuery = { by: 'day', ...(ctx.listQuery ?? {}), search: query };
      ctx.listGroups = w.listView(ctx.listQuery);
    },
  },
  {
    pattern: /^the entry list shows "([^"]*)" under group "([^"]*)"$/,
    run: (_w, ctx, desc, key) => {
      const group = (ctx.listGroups ?? []).find((g) => g.key === key);
      expect(group, `expected a group "${key}" in the entry list`).toBeDefined();
      expect(group!.descriptions).toContain(desc);
    },
  },
  {
    pattern: /^the entry list does not show "([^"]*)"$/,
    run: (_w, ctx, desc) => {
      const all = (ctx.listGroups ?? []).flatMap((g) => g.descriptions);
      expect(all).not.toContain(desc);
    },
  },
  {
    pattern: /^the entry list has groups exactly "([^"]*)"$/,
    run: (_w, ctx, keys) => {
      const expected = keys.split(',').map((k) => k.trim());
      expect((ctx.listGroups ?? []).map((g) => g.key)).toEqual(expected);
    },
  },

  // ---- §08 R3 report billable filter (the GUI three-way Billable control / `tt report
  // --all|--non-billable`) ------------------------------------------------------------
  // The default report is billable-only; the filter can instead show ALL time or only the
  // NON-billable time. Surface-neutral over World.report — CoreWorld store.report's
  // filterByBillable, CliWorld `tt report --all|--non-billable` — so the same filter
  // arithmetic the GUI Billable segment drives is proven identical on @stint/core and tt
  // (§17 R8). Phrased so one scenario can assert the same week's total under each variant.
  {
    pattern: /^an? (billable|all|non-billable) report for this week totals (\d+) hours?$/,
    run: (w, _c, filter, hours) => {
      const r = w.report({
        preset: 'week',
        by: 'client',
        billableFilter: filter as 'billable' | 'all' | 'non-billable',
      });
      expect(r.grandTotalSeconds).toBe(Number(hours) * 3600);
    },
  },

  // ---- §09 R1 report by range (the contract the GUI picker drives) --------
  {
    pattern: /^a report for (this week|last week) totals (\d+) billable hours?$/,
    run: (w, _c, preset, hours) => {
      const r = w.report({ preset: presetKey(preset), by: 'client', billableFilter: 'billable' });
      expect(r.grandTotalSeconds).toBe(Number(hours) * 3600);
    },
  },
  {
    pattern: /^a report for (this week|last week) has no time under "([^"]*)"$/,
    run: (w, _c, preset, client) => {
      const r = w.report({ preset: presetKey(preset), by: 'client', billableFilter: 'billable' });
      expect(r.lines.map((l) => l.key)).not.toContain(client);
    },
  },
  {
    pattern: /^a report for (this week|last week) groups (\d+) billable hours? under "([^"]*)"$/,
    run: (w, _c, preset, hours, client) => {
      const r = w.report({ preset: presetKey(preset), by: 'client', billableFilter: 'billable' });
      const line = r.lines.find((l) => l.key === client);
      expect(line, `expected a "${client}" line in the report`).toBeDefined();
      expect(line!.totalSeconds).toBe(Number(hours) * 3600);
    },
  },
  {
    pattern: /^a report for the range (\S+) to (\S+) totals (\d+) billable hours?$/,
    run: (w, _c, from, to, hours) => {
      const r = w.report({ fromUtc: from, toUtc: to, by: 'client', billableFilter: 'billable' });
      expect(r.grandTotalSeconds).toBe(Number(hours) * 3600);
    },
  },
  {
    pattern: /^a report for the range (\S+) to (\S+) has no time under "([^"]*)"$/,
    run: (w, _c, from, to, client) => {
      const r = w.report({ fromUtc: from, toUtc: to, by: 'client', billableFilter: 'billable' });
      expect(r.lines.map((l) => l.key)).not.toContain(client);
    },
  },

  // ---- §09 R2 report grouping (the contract the GUI Group-by control drives) ----
  // The grouping engine is core's store.report with the chosen `by`; these steps drive it
  // surface-neutrally over the same World.report the range scenarios use, so the grouping
  // is proven identical on @stint/core and tt (§17 R8). The `by` is the same value the GUI
  // #by-seg segment sends over window.stint.report.
  {
    pattern:
      /^a report for this week grouped by (client|project|day|tag) groups (\d+) billable hours? under "([^"]*)"$/,
    run: (w, _c, by, hours, key) => {
      const r = w.report({ preset: 'week', by: groupBy(by), billableFilter: 'billable' });
      const line = r.lines.find((l) => l.key === key);
      expect(line, `expected a "${key}" line in the by-${by} report`).toBeDefined();
      expect(line!.totalSeconds).toBe(Number(hours) * 3600);
    },
  },
  {
    pattern: /^a report for this week grouped by (client|project|day|tag) has (\d+) group lines?$/,
    run: (w, _c, by, count) => {
      const r = w.report({ preset: 'week', by: groupBy(by), billableFilter: 'billable' });
      expect(r.lines.length).toBe(Number(count));
    },
  },
  {
    pattern:
      /^a report for this week grouped by (client|project|day|tag) totals (\d+) billable hours?$/,
    run: (w, _c, by, hours) => {
      const r = w.report({ preset: 'week', by: groupBy(by), billableFilter: 'billable' });
      expect(r.grandTotalSeconds).toBe(Number(hours) * 3600);
    },
  },
  // §09 R2 — the grouping-invariance fact: the grand total is the same no matter the
  // grouping (regrouping never changes the underlying time). Phrased per-grouping so a
  // scenario can assert it across client / project / day / tag with the one expected total.
  {
    pattern:
      /^a report for this week totals (\d+) billable hours? grouped by (client|project|day|tag)$/,
    run: (w, _c, hours, by) => {
      const r = w.report({ preset: 'week', by: groupBy(by), billableFilter: 'billable' });
      expect(r.grandTotalSeconds).toBe(Number(hours) * 3600);
    },
  },

  // ---- §09 R4 rounding the grouped line (the contract the GUI Rounding toggle drives) ----
  // Rounding applies to the grouped BILLABLE LINE nearest the chosen increment (not always
  // up), and NEVER alters stored time. Surface-neutral over the World `report` capability:
  // CoreWorld store.report with rounding on, CliWorld `tt report --round <min>` — the same
  // core roundSeconds either way (the GUI #rounding toggle / increment picker only choose it).
  {
    pattern:
      /^a report for this week grouped by (client|project|day|tag) rounded to (\d+) minutes? groups (\d+) seconds under "([^"]*)"$/,
    run: (w, _c, by, inc, seconds, key) => {
      const r = w.report({
        preset: 'week',
        by: groupBy(by),
        billableFilter: 'billable',
        rounding: true,
        roundingIncrementMin: Number(inc),
      });
      const line = r.lines.find((l) => l.key === key);
      expect(line, `expected a "${key}" line in the rounded report`).toBeDefined();
      expect(line!.roundedSeconds).toBe(Number(seconds));
    },
  },
  {
    // The same line's EXACT (unrounded) total is unchanged — rounding is display-only, so
    // the stored billable seconds the report sums still read the exact figure.
    pattern:
      /^a report for this week grouped by (client|project|day|tag) has an exact (\d+) seconds under "([^"]*)"$/,
    run: (w, _c, by, seconds, key) => {
      const r = w.report({ preset: 'week', by: groupBy(by), billableFilter: 'billable' });
      const line = r.lines.find((l) => l.key === key);
      expect(line, `expected a "${key}" line in the report`).toBeDefined();
      expect(line!.totalSeconds).toBe(Number(seconds));
    },
  },
  {
    // Rounding never touches stored time: after a rounded report, the entry's own billable
    // duration is still the exact figure (the §17 R4 stored-time-untouched invariant, here
    // observed through the surface-neutral entry list — the same fact the GUI relies on).
    pattern: /^the entry "([^"]*)" still has a billable duration of (\d+) seconds$/,
    run: (w, _c, desc, seconds) => {
      expect(byDesc(w, desc).billableSeconds).toBe(Number(seconds));
    },
  },

  // §06 R4 / §09 — overlap is allowed but FLAGGED in a report: two entries whose spans
  // intersect are both surfaced as overlapped. Surface-neutral over the World reportOverlaps
  // capability (CoreWorld store.report.overlappedEntryIds / CliWorld `tt report --json`
  // overlapped_entry_ids), covering the whole Mon-start week of the fixed Wednesday clock.
  {
    pattern: /^a report covering this week flags (\d+) overlapping entries$/,
    run: (w, _c, count) => {
      // Cover the whole Mon-start week of the fixed Wednesday clock (Jun 22–29).
      const flagged = w.reportOverlaps('2026-06-22T00:00:00Z', '2026-06-29T00:00:00Z');
      expect(flagged.length).toBe(Number(count));
    },
  },

  // ---- §12 R11 / §14 settings round-trip (the contract the GUI Settings view edits) ----
  // The Settings view persists each §14 setting over the SAME setSetting capability `tt
  // config set` uses; these steps prove a chosen value round-trips and reads back, run TWICE
  // (core + tt) via the World `setConfig`/`getConfig` methods — so the surfaces are proven
  // identical (§17 R8) on exactly the settings the view edits.
  {
    pattern: /^I set (?:the )?(.+?) to "?([^"]*?)"?$/,
    run: (w, _c, setting, value) => {
      w.setConfig(settingKey(setting), value);
    },
  },
  {
    pattern: /^the configured (.+?) is "?([^"]*?)"?$/,
    run: (w, _c, setting, value) => {
      expect(w.getConfig(settingKey(setting))).toBe(value);
    },
  },

  // ---- §09 R6 CSV / JSON export shape (the contract the GUI Export buttons drive) -------
  // The Export CSV / Export JSON buttons write the RAW entries for the shown range via core's
  // toCsv/toJsonEntries (byte-identical to `tt export --csv/--json`). Surface-neutral over the
  // World `exportRows` capability: CoreWorld renders+parses core's exporters, CliWorld shells
  // `tt export --range … --csv|--json`. The assertions read the parsed rows so the export
  // shape is proven identical on both surfaces (the GUI export reaches nothing tt cannot).
  {
    pattern: /^I export the range (\S+) to (\S+) as (csv|json)$/,
    run: (w, ctx, from, to, format) => {
      ctx.exportRows = w.exportRows({ fromUtc: from, toUtc: to, format: format as 'csv' | 'json' });
    },
  },
  {
    pattern: /^the export has (\d+) rows?$/,
    run: (_w, ctx, count) => {
      expect(ctx.exportRows ?? []).toHaveLength(Number(count));
    },
  },
  {
    pattern: /^the export has a row "([^"]*)" for "([^"]*)" of (\d+) seconds$/,
    run: (_w, ctx, desc, client, seconds) => {
      const row = (ctx.exportRows ?? []).find((r) => r.description === desc);
      expect(row, `expected an exported row "${desc}"`).toBeDefined();
      expect(row!.client).toBe(client);
      expect(row!.rawSeconds).toBe(Number(seconds));
    },
  },
  {
    pattern: /^every exported row carries its billable flag$/,
    run: (_w, ctx) => {
      for (const row of ctx.exportRows ?? []) {
        expect(typeof row.billable).toBe('boolean');
      }
    },
  },

  // ---- §09 R08–R09 saved reports (the contract the GUI Reports view drives) ----
  // A saved report stores a RELATIVE preset spec (e.g. "this-week") + group-by + billable
  // filter + rounding; it re-resolves through the SAME core resolveRange the ad-hoc report
  // uses on every run. Surface-neutral over the World saved-report capabilities: CoreWorld
  // store.saveReport/runReport/editReport/…, CliWorld `tt report save|ls|run|edit|rename|rm`.
  // Run TWICE so the relative-spec resolution + CRUD persistence + run totals are proven
  // identical on @stint/core and tt (§17 R8/R14).
  {
    pattern:
      /^I save a report "([^"]*)" for (this week|last week|today|this month|last month) grouped by (client|project|day|tag) over (billable|all|non-billable) time$/,
    run: (w, _c, name, preset, by, filter) => {
      w.saveReport({
        name,
        preset: presetKeyFull(preset),
        by: groupBy(by),
        billableFilter: filter as 'billable' | 'all' | 'non-billable',
      });
    },
  },
  {
    pattern:
      /^I save a report "([^"]*)" for (this week|last week|today|this month|last month) grouped by (client|project|day|tag) over (billable|all|non-billable) time rounded to (\d+) minutes$/,
    run: (w, _c, name, preset, by, filter, inc) => {
      w.saveReport({
        name,
        preset: presetKeyFull(preset),
        by: groupBy(by),
        billableFilter: filter as 'billable' | 'all' | 'non-billable',
        rounding: true,
        roundingIncrementMin: Number(inc),
      });
    },
  },
  {
    pattern: /^the saved report list includes "([^"]*)"$/,
    run: (w, _c, name) => expect(w.listReportNames()).toContain(name),
  },
  {
    pattern: /^the saved report list does not include "([^"]*)"$/,
    run: (w, _c, name) => expect(w.listReportNames()).not.toContain(name),
  },
  {
    pattern: /^I run the saved report "([^"]*)"$/,
    run: (w, ctx, name) => {
      ctx.runTotalSeconds = w.runReportTotalSeconds(name);
    },
  },
  {
    pattern: /^the saved report run totals (\d+) billable hours?$/,
    run: (_w, ctx, hours) => {
      expect(ctx.runTotalSeconds).toBe(Number(hours) * 3600);
    },
  },
  {
    // §09 R09 — the saved run's total equals an equivalent ad-hoc report over the same
    // resolved preset window: the saved relative spec and the ad-hoc preset resolve through
    // the one core resolveRange, so they can never diverge. Asserted on both surfaces.
    pattern:
      /^the saved report run total equals an ad-hoc (this week|last week|today|this month|last month) report grouped by (client|project|day|tag) over (billable|all|non-billable) time$/,
    run: (w, ctx, preset, by, filter) => {
      const adhoc = w.report({
        preset: presetKeyFull(preset),
        by: groupBy(by),
        billableFilter: filter as 'billable' | 'all' | 'non-billable',
      });
      expect(ctx.runTotalSeconds).toBe(adhoc.grandTotalSeconds);
    },
  },
  {
    pattern:
      /^I change the saved report "([^"]*)" range to (this week|last week|today|this month|last month)$/,
    run: (w, _c, name, preset) => w.editReportRange(name, presetKeyFull(preset)),
  },
  {
    // §09 R08 — amend a saved def's group-by. Captures the current run total first so a
    // subsequent re-run can assert the regrouped total is unchanged (grouping is invariant
    // on the grand total). Proven on both surfaces (store.editReport / `tt report edit --by`).
    pattern: /^I change the saved report "([^"]*)" grouping to (client|project|day|tag)$/,
    run: (w, ctx, name, by) => {
      ctx.priorRunTotalSeconds = ctx.runTotalSeconds;
      w.editReportBy(name, groupBy(by));
    },
  },
  {
    pattern: /^the saved report run total is unchanged$/,
    run: (_w, ctx) => {
      expect(ctx.runTotalSeconds).toBe(ctx.priorRunTotalSeconds);
    },
  },
  {
    pattern: /^I rename the saved report "([^"]*)" to "([^"]*)"$/,
    run: (w, _c, name, to) => w.renameReport(name, to),
  },
  {
    pattern: /^I delete the saved report "([^"]*)"$/,
    run: (w, _c, name) => w.removeReport(name),
  },
  {
    // §09 R09 — export FROM a saved report: the RAW entries for the definition's resolved
    // range (CoreWorld store.exportSavedReport → toCsv; CliWorld `tt report run <name> --csv`),
    // proving CSV export-from-saved is reachable + identical on both surfaces.
    pattern: /^I export the saved report "([^"]*)"$/,
    run: (w, ctx, name) => {
      ctx.savedExportRows = w.exportSavedReportRows(name);
    },
  },
  {
    pattern: /^the saved report export has (\d+) rows?$/,
    run: (_w, ctx, count) => {
      expect(ctx.savedExportRows ?? []).toHaveLength(Number(count));
    },
  },
  {
    pattern: /^the saved report export has a row "([^"]*)" for "([^"]*)" of (\d+) seconds$/,
    run: (_w, ctx, desc, client, seconds) => {
      const row = (ctx.savedExportRows ?? []).find((r) => r.description === desc);
      expect(row, `expected an exported row "${desc}"`).toBeDefined();
      expect(row!.client).toBe(client);
      expect(row!.rawSeconds).toBe(Number(seconds));
    },
  },
  {
    pattern: /^the saved report export does not have a row "([^"]*)"$/,
    run: (_w, ctx, desc) => {
      expect((ctx.savedExportRows ?? []).find((r) => r.description === desc)).toBeUndefined();
    },
  },

  // ---- §05 R09 favorites (the contract the GUI Timer view's favorites rail drives) ----
  // A favorite is a named timer template capturing description / client / project / billable /
  // tags — pinned from the running timer, a closed entry, or explicit attributes; listed;
  // renamed; unpinned. Surface-neutral over the World favorite capabilities: CoreWorld
  // store.pinFavorite/listFavorites/renameFavorite/unpinFavorite, CliWorld `tt fav
  // add|ls|rename|rm`. Run TWICE so the template capture + CRUD persistence are proven
  // identical on @stint/core and tt (§17 R8/R14). (Resume from a favorite is §05 R10.)
  {
    pattern: /^I pin a favorite "([^"]*)" from the running entry$/,
    run: (w, _c, name) => w.pinFavoriteFromEntry(name, 'open'),
  },
  {
    pattern: /^I pin a favorite "([^"]*)" from the entry "([^"]*)"$/,
    run: (w, _c, name, desc) => w.pinFavoriteFromEntry(name, byDesc(w, desc).id),
  },
  {
    pattern:
      /^I pin a favorite "([^"]*)" for "([^"]*)" \/ "([^"]*)" tagged "([^"]*)"$/,
    run: (w, _c, name, client, project, tags) =>
      w.pinFavoriteFromAttrs({
        name,
        client,
        project,
        billable: true,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      }),
  },
  {
    pattern: /^I view the favorites$/,
    run: (w, ctx) => {
      ctx.favorites = w.listFavorites();
    },
  },
  {
    pattern: /^I rename the favorite "([^"]*)" to "([^"]*)"$/,
    run: (w, _c, name, to) => w.renameFavorite(name, to),
  },
  {
    pattern: /^I unpin the favorite "([^"]*)"$/,
    run: (w, _c, name) => w.unpinFavorite(name),
  },
  {
    pattern: /^the favorites list includes "([^"]*)"$/,
    run: (w, ctx, name) => {
      const favs = ctx.favorites ?? w.listFavorites();
      expect(favs.map((f) => f.name)).toContain(name);
    },
  },
  {
    pattern: /^the favorites list does not include "([^"]*)"$/,
    run: (w, ctx, name) => {
      const favs = ctx.favorites ?? w.listFavorites();
      expect(favs.map((f) => f.name)).not.toContain(name);
    },
  },
  {
    pattern: /^the favorite "([^"]*)" is for "([^"]*)"$/,
    run: (w, ctx, name, lbl) => {
      const fav = (ctx.favorites ?? w.listFavorites()).find((f) => f.name === name);
      expect(fav, `expected a favorite "${name}"`).toBeDefined();
      expect(fav!.clientLabel).toBe(lbl);
    },
  },
  {
    pattern: /^the favorite "([^"]*)" has description "([^"]*)"$/,
    run: (w, ctx, name, desc) => {
      const fav = (ctx.favorites ?? w.listFavorites()).find((f) => f.name === name);
      expect(fav, `expected a favorite "${name}"`).toBeDefined();
      expect(fav!.description).toBe(desc);
    },
  },
  {
    pattern: /^the favorite "([^"]*)" has tag "([^"]*)"$/,
    run: (w, ctx, name, tag) => {
      const fav = (ctx.favorites ?? w.listFavorites()).find((f) => f.name === name);
      expect(fav, `expected a favorite "${name}"`).toBeDefined();
      expect(fav!.tags).toContain(tag);
    },
  },
  {
    pattern: /^the favorite "([^"]*)" is (billable|non-billable)$/,
    run: (w, ctx, name, bill) => {
      const fav = (ctx.favorites ?? w.listFavorites()).find((f) => f.name === name);
      expect(fav, `expected a favorite "${name}"`).toBeDefined();
      expect(fav!.billable).toBe(bill === 'billable');
    },
  },

  // ---- §05 R10 resume from a favorite (the rail's one-click Resume / tt fav start /
  // tt start --fav) -------------------------------------------------------------------------
  // One action starts a FRESH timer from the favorite's template; the favorite is never mutated.
  // Surface-neutral over World.startFromFavorite (CoreWorld store.startFromFavorite / CliWorld
  // `tt fav start`) and World.startWithFav (the `tt start --fav` route to the SAME core action),
  // so both CLI entry points + the GUI rail are proven to reach identical behavior (§17 R8/R14).
  {
    pattern: /^I resume from favorite "([^"]*)"$/,
    run: (w, ctx, name) => {
      ctx.lastId = w.startFromFavorite(name).id;
    },
  },
  {
    pattern: /^I start with --fav "([^"]*)"$/,
    run: (w, ctx, name) => {
      ctx.lastId = w.startWithFav(name).id;
    },
  },
  {
    pattern: /^I attempt to resume from favorite "([^"]*)"$/,
    run: (w, ctx, name) => {
      ctx.resumeFavResult = w.attemptStartFromFavorite(name);
    },
  },
  {
    pattern: /^the resume from favorite is rejected$/,
    run: (_w, ctx) => expect(ctx.resumeFavResult?.rejected).toBe(true),
  },
  {
    pattern: /^the running timer is for "([^"]*)"$/,
    run: (w, _c, lbl) => {
      const r = w.running();
      expect(r, 'expected a running timer').not.toBeNull();
      expect(r!.clientLabel).toBe(lbl);
    },
  },
  {
    pattern: /^the running timer is (billable|non-billable)$/,
    run: (w, _c, bill) => {
      const r = w.running();
      expect(r, 'expected a running timer').not.toBeNull();
      expect(r!.billable).toBe(bill === 'billable');
    },
  },
  {
    pattern: /^the running timer has tag "([^"]*)"$/,
    run: (w, _c, tag) => {
      const r = w.running();
      expect(r, 'expected a running timer').not.toBeNull();
      expect(r!.tags).toContain(tag);
    },
  },

  // ---- §20 R04/R05, §17 R12 backups & recovery (the data-loss-protection contract) ----
  // A fresh launch makes a recoverable backup; a corrupted database is detected on open and
  // recovered from the latest backup without data loss. Surface-neutral over the World backup
  // capabilities: CoreWorld closes+re-opens the file-backed Store (launch backup + integrity
  // gate + recovery) and reads its backups; CliWorld re-runs `tt` (process-per-command already
  // re-opens) and reads `tt backup ls --json`. Run TWICE so backup-on-launch and corruption
  // recovery are proven identical on @stint/core and tt (§17 R8/R12).
  {
    // The launch backup captures the state AT launch (before this command's own writes), so a
    // relaunch is what snapshots the data just written — exactly how the GUI's launch backup works.
    pattern: /^I relaunch the store$/,
    run: (w) => w.relaunch(),
  },
  {
    pattern: /^I corrupt the database and relaunch the store$/,
    run: (w) => {
      w.corruptDatabase();
      w.relaunch();
    },
  },
  {
    pattern: /^there is at least one backup$/,
    run: (w) => expect(w.backupCount()).toBeGreaterThanOrEqual(1),
  },
  {
    pattern: /^the latest backup contains (\d+) entr(?:y|ies)$/,
    run: (w, _c, count) => expect(w.entriesInLatestBackup()).toBe(Number(count)),
  },
  {
    // §20 R05 — recovery left no data behind: the reopened database still reports exactly the
    // pre-corruption entry count (the surface-neutral entry list is the live, recovered DB).
    pattern: /^the database has exactly (\d+) entr(?:y|ies)$/,
    run: (w, _c, count) => expect(w.list()).toHaveLength(Number(count)),
  },
  {
    // §20 R05 — the corrupt file was set aside, not destroyed: a `.corrupted-*` sibling remains.
    pattern: /^the corrupt database file is quarantined beside the database$/,
    run: (w) => expect(w.hasQuarantinedFile()).toBe(true),
  },

  // ---- §20 R03 integrity check on open (detect corruption, refuse to write) ----
  // The bare detect-and-refuse contract, isolated from R05's recover-from-backup path: a corrupt
  // database with NO backup beside it must be DETECTED on open and the open REFUSED before any
  // write — never falling through to normal operation on a corrupt file. Surface-neutral over the
  // World integrity capabilities: CoreWorld opens via openDb (a RecoveryError is the refusal);
  // CliWorld runs a real `tt status` (non-zero exit + integrity error on stderr). Run TWICE so the
  // write-refusal is proven identical on @stint/core and tt (§17 R8). The corrupt file's bytes must
  // be UNCHANGED after the refused open — concrete proof that R03 wrote nothing to the bad file.
  {
    pattern: /^the database file is corrupted$/,
    run: (w) => w.corruptDatabaseFile(),
  },
  {
    pattern: /^I open the database$/,
    run: (w, c) => {
      c.integrityOpen = w.openCorruptDatabase();
    },
  },
  {
    pattern: /^the open is refused before any write$/,
    run: (_w, c) => {
      expect(c.integrityOpen, 'expected a prior `When I open the database`').toBeDefined();
      // Refused: corruption was detected and the open did not proceed to normal operation.
      expect(c.integrityOpen!.refused).toBe(true);
      // And not a single byte of the corrupt file was rewritten — R03 must not write to it.
      expect(c.integrityOpen!.wrote).toBe(false);
    },
  },

  // ---- §20 R07 app_state durability (the schedule never drifts from its entry) ----
  // start() seeds the check-in schedule in the SAME transaction as the open entry (anchored at
  // its start); stop() clears it in the SAME transaction as the close. Surface-neutral over the
  // World schedule capability: CoreWorld reads store.checkinState(); CliWorld reads the committed
  // `app_state` row off the DB file the tt process wrote (durable across the process boundary).
  // Each assertion has an "after reopening the store" twin that re-reads through a fresh launch,
  // proving the state was committed durably — not merely held in-process — and runs TWICE (§17 R8).
  {
    pattern: /^the persisted check-in schedule is anchored at (\d{1,2}:\d{2})$/,
    run: (w, _c, at) => expect(w.checkinScheduleAnchor()).toBe(iso(at)),
  },
  {
    pattern: /^the persisted check-in schedule is anchored at (\d{1,2}:\d{2}) after reopening the store$/,
    run: (w, _c, at) => {
      w.relaunch();
      expect(w.checkinScheduleAnchor()).toBe(iso(at));
    },
  },
  {
    pattern: /^no check-in schedule is persisted$/,
    run: (w) => expect(w.checkinScheduleAnchor()).toBeNull(),
  },
  {
    pattern: /^no check-in schedule is persisted after reopening the store$/,
    run: (w) => {
      w.relaunch();
      expect(w.checkinScheduleAnchor()).toBeNull();
    },
  },
  {
    pattern: /^nothing is running after reopening the store$/,
    run: (w) => {
      w.relaunch();
      expect(w.status().running).toBe(false);
    },
  },
];

/** Map the spoken group-by word to the report() `by` option (the GUI #by-seg value). */
function groupBy(spoken: string): 'client' | 'project' | 'day' | 'tag' {
  return spoken as 'client' | 'project' | 'day' | 'tag';
}

/** Map the spoken "this week"/"last week" to core's resolveRange preset key. */
function presetKey(spoken: string): 'week' | 'last-week' {
  return spoken === 'last week' ? 'last-week' : 'week';
}

/**
 * §09 R08 — map the full spoken preset phrase (this week / last week / today / this month /
 * last month) to core's resolveRange preset key (the same enum the saved RangeSpec carries).
 */
function presetKeyFull(spoken: string): 'today' | 'week' | 'last-week' | 'month' | 'last-month' {
  switch (spoken) {
    case 'today':
      return 'today';
    case 'this week':
      return 'week';
    case 'last week':
      return 'last-week';
    case 'this month':
      return 'month';
    case 'last month':
      return 'last-month';
    default:
      throw new Error(`unknown preset phrase "${spoken}"`);
  }
}

/**
 * §12 R11 / §14 — map a spoken setting name to its snake_case key (the key both surfaces
 * accept). The settings feature speaks in ubiquitous language ("week start", "accent usage",
 * "date format"); this resolves each to the descriptor key `tt config set` / core use.
 */
function settingKey(spoken: string): string {
  const KEYS: Record<string, string> = {
    rounding: 'rounding',
    'rounding increment': 'rounding_increment_min',
    'week start': 'week_start',
    'first check-in': 'first_checkin_min',
    'check-in interval': 'checkin_interval_min',
    'global hotkey': 'global_hotkey',
    'accent usage': 'accent',
    accent: 'accent',
    'date format': 'date_format',
  };
  const key = KEYS[spoken.trim().toLowerCase()];
  if (!key) throw new Error(`unknown setting name "${spoken}"`);
  return key;
}

export function matchStep(text: string): { def: StepDef; args: string[] } {
  for (const def of steps) {
    const m = def.pattern.exec(text);
    if (m) return { def, args: m.slice(1) };
  }
  throw new Error(`no step definition matches: ${text}`);
}
