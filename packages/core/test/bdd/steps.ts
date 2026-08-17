/**
 * Step definitions in the project's ubiquitous language (glossary.html). Each step
 * binds to the World interface, so it runs identically against @stint/core and tt.
 */
import { expect } from 'vitest';
import type {
  World,
  EntryRec,
  ExportRowRec,
  ListFilterReq,
  FavoriteRec,
  StorageResolution,
} from './world.js';
import type { GroupBy } from '@stint/core';

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
  /** §06 R3 — the result of the most recent `When I attempt to merge … without acknowledging the gap`. */
  mergeResult?: { refused: boolean };
  /** §09 R7 — the rows returned by the most recent `When I search for "X"`. */
  searchResults?: EntryRec[];
  /** §09 R6 — the rows returned by the most recent `When I export the range …`. */
  exportRows?: ExportRowRec[];
  /** §11 — the accumulating entry-list query the range/filter/search clauses build up. */
  listReq?: ListFilterReq;
  /** §11 — the flat, ungrouped result of the most recent entry-list query. */
  listResults?: EntryRec[];
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
  /** §07 R03 (#64) — the result of the most recent `When I try to add/rename` reference data. */
  refDataResult?: { rejected: boolean };
  /** §05 R06 / §16 (#61) — the result of the most recent future-start edit attempt on the open row. */
  editResult?: { rejected: boolean };
  /** §05 R01 / §16 (#61) — the result of the most recent backdated-start attempt over the open row. */
  startResult?: { rejected: boolean };
  /** §20 R03 — the result of the most recent `When I open the database` over a corrupt file. */
  integrityOpen?: { refused: boolean; wrote: boolean };
  /** §20 R05 — the entry count of the backup the most recent named restore reinstated. */
  restoreChosenCount?: number;
  /** §13 — the result of the most recent `When the storage paths resolve …`. */
  storageRes?: StorageResolution;
  /** §20 R10/R11 — the result of the most recent storage launch attempt. */
  storageLaunchRes?: { refused: boolean; message: string };
  /** §20 R04/R14 — the result of the most recent backup listing under the sandbox env. */
  storageList?: { refused: boolean; message: string; names: string[] };
  /** §20 R14 — the result of the most recent forced backup under the sandbox env. */
  storageNow?: { refused: boolean; message: string; claimed: boolean };
  /** §20 R12/R13 — the result of the most recent storage-location change attempt. */
  storageChangeRes?: { refused: boolean; message: string };
  /** §20 R12/R13 — the config file's raw text captured just before the change (the untouched probe). */
  storageConfigBefore?: string;
}

export interface StepDef {
  pattern: RegExp;
  run: (world: World, ctx: Ctx, ...args: string[]) => void;
}

const DAY = '2026-06-24';
// Accepts HH:MM or HH:MM:SS — sub-minute instants let a scenario prove stored truth round-trips
// to the SECOND (§12 R15 / glossary "Stored truth"), e.g. a 09:07:33 start that no editor pass
// may quietly snap to a 5-minute grid.
const iso = (t: string): string => {
  const [h, m, s] = t.split(':');
  return `${DAY}T${h!.padStart(2, '0')}:${m}:${s ?? '00'}Z`;
};

// §05 R06 / §16 (#61) — an instant unambiguously AFTER the fixed clock (FIXED_NOW is late on DAY,
// 2026-06-24T23:59Z), used to prove a future start on the running entry is refused on both
// surfaces. The next calendar day at midday is safely ahead of now under any runner timezone.
const FUTURE_ISO = '2026-06-25T12:00:00Z';

// §05 R10 — a description carrying an interior newline. The line break lives HERE, in the step
// definition, not in the Gherkin cell, so the .feature stays single-line while the stored/reported
// value is genuinely multiline. Read back on BOTH surfaces to prove verbatim storage + full-fidelity
// reporting identically (§17 R8).
const MULTILINE_DESC = 'line one\nline two';

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
    // The times may carry seconds (HH:MM:SS) so a scenario can seed a non-5-min-aligned span
    // and prove edits preserve stored truth to the second (§12 R15 / issue #49).
    pattern: /^a closed entry "([^"]*)" from (\d{1,2}:\d{2}(?::\d{2})?) to (\d{1,2}:\d{2}(?::\d{2})?)$/,
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
  // §09 R06 — a client-attributed but explicitly NON-BILLABLE entry in last week: the off-filter
  // row INSIDE a billable-only report's resolved range that tells the two export scopes apart
  // (the filtered export drops it; the raw "Export All Data" / `tt export` keeps it).
  {
    pattern: /^a closed non-billable entry "([^"]*)" for "([^"]*)" last week lasting (\d+) hours?$/,
    run: (w, ctx, desc, client, hours) => {
      const r = w.backfillAt({
        desc,
        client,
        billable: false,
        fromIso: LAST_WEEK_ANCHOR,
        toIso: plusHours(LAST_WEEK_ANCHOR, Number(hours)),
      });
      ctx.lastClosedId = r.id;
      ctx.entryIds.push(r.id);
    },
  },
  // §09 R2 — place a closed, client/project-attributed, tagged entry on a chosen day of
  // this week, for the group-by scenarios. The tags (comma-separated) and the project let
  // one set of entries be regrouped by client / project / day / week / month / tag; the day
  // selector (1 or 2 → THIS_WEEK_DAYS) puts entries on distinct days so by-day grouping is
  // observable.
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

  // §09 R1 — place a closed, client-attributed entry at an explicit LOCAL day + wall-clock
  // time (new Date(y, m-1, d, h, m), the same local calendar the GUI's plain date fields
  // resolve against), so a plain-date range's local-midnight boundaries are exercised: an
  // entry ending 23:30 LOCAL on the range's to-date must still fall INSIDE the window,
  // and one in the small hours of the next local day must fall outside it.
  {
    pattern:
      /^a closed entry "([^"]*)" for "([^"]*)" on local day (\d{4})-(\d{2})-(\d{2}) at (\d{2}):(\d{2}) lasting (\d+) minutes$/,
    run: (w, ctx, desc, client, y, mo, d, hh, mm, minutes) => {
      const fromIso = new Date(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(hh),
        Number(mm),
      ).toISOString();
      const r = w.backfillAt({
        desc,
        client,
        fromIso,
        toIso: plusMinutes(fromIso, Number(minutes)),
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
    // §12 R17 — backfill a CROSS-MIDNIGHT (overnight) span: from HH:MM on DAY to HH:MM the NEXT
    // local day. The GUI path for overnight is the unified form's collapsed Start/Stop expander
    // (§12 R17) — the single-day interval picker can't drag across midnight, so the expander's raw
    // text stop dated a later day is the only way to enter one. This step stays surface-neutral and
    // runs TWICE (CoreWorld.backfillAt = store.add, CliWorld.backfillAt = `tt add --from --to`),
    // proving a span that crosses midnight commits IDENTICALLY on both surfaces — one closed entry,
    // never rejected, blocked, or flattened to the same day. fromIso lands on DAY, toIso on DAY+1.
    pattern: /^I backfill an entry "([^"]*)" from (\d{1,2}:\d{2}) to (\d{1,2}:\d{2}) the next day$/,
    run: (w, ctx, desc, from, to) => {
      const NEXT_DAY = new Date(Date.parse(`${DAY}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      const toIso = `${NEXT_DAY}T${to.padStart(5, '0')}:00Z`;
      const r = w.backfillAt({ desc, fromIso: iso(from), toIso });
      ctx.lastId = r.id;
      ctx.lastClosedId = r.id;
      ctx.entryIds.push(r.id);
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
    // §05 R10 — backfill a closed entry whose description spans two lines (the newline is in
    // MULTILINE_DESC, not the Gherkin cell). Surface-neutral over the same `backfill`/`add`
    // capability the other manual-add steps use.
    pattern: /^I add a closed entry with a two-line description$/,
    run: (w, ctx) => {
      const r = w.backfill({ desc: MULTILINE_DESC, from: iso('09:00'), to: iso('10:00') });
      ctx.lastId = r.id;
      ctx.lastWarned = r.warned;
    },
  },
  {
    // §05 R10 / §17 R8 — read the description back over the World `list` capability (CoreWorld
    // store.listEntries description, CliWorld `tt list --all --json` description) and prove the
    // interior newline survived storage + reporting byte-for-byte, identically on both surfaces.
    pattern: /^the stored description keeps both lines verbatim$/,
    run: (w) => {
      const e = w.list().find((x) => x.description === MULTILINE_DESC);
      expect(e, 'an entry with the two-line description exists').toBeTruthy();
      expect(e!.description).toBe(MULTILINE_DESC);
      expect(e!.description).toContain('\n');
    },
  },
  {
    // §12 R10 / §05 R08 — seed a closed entry that slept through: a backfilled span from 09:00
    // lasting `hours`, with a recorded sleep span of `sleepHours` inside it (from 10:00). Core
    // records the span (store.recordSleepSpan); the CLI seeds it via a transient Store on the db.
    pattern: /^a slept entry "([^"]*)" of raw (\d+) hours? with a recorded (\d+) hours? sleep span$/,
    run: (w, ctx, desc, hours, sleepHours) => {
      const from = iso('09:00');
      const sleepFrom = iso('10:00');
      const r = w.seedSleptEntry({
        desc,
        from,
        to: plusHours(from, Number(hours)),
        sleepFrom,
        sleepTo: plusHours(sleepFrom, Number(sleepHours)),
      });
      ctx.lastClosedId = r.id;
      ctx.lastId = r.id;
      ctx.entryIds.push(r.id);
    },
  },
  {
    // §12 R10 / §05 R08 — exclude (or, called again, restore) an entry's recorded slept time. The
    // same core toggle both the GUI editor's reversible control and `tt sleep subtract` reach.
    pattern: /^I subtract the slept time from "([^"]*)"$/,
    run: (w, _c, desc) => w.subtractSleep(byDesc(w, desc).id),
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
  // §06 R3 — the contiguity gate: attempt to merge a GAPPED selection WITHOUT acknowledging
  // the gap, over the World `mergeUnacknowledged` capability (CoreWorld catches the StoreError,
  // CliWorld `tt merge` without --allow-gap refuses). Stash the result so the assertion below
  // proves the fold never ran and the originals survive on both surfaces.
  {
    pattern: /^I attempt to merge those two entries without acknowledging the gap$/,
    run: (w, ctx) => {
      ctx.mergeResult = w.mergeUnacknowledged(thoseTwo(ctx));
    },
  },
  // §06 R3 — the acknowledged path stays reachable: a gapped merge folds the gap into the span
  // once the gap is acknowledged (CoreWorld allowGap, CliWorld --allow-gap).
  {
    pattern: /^I merge those two entries acknowledging the gap$/,
    run: (w, ctx) => {
      ctx.mergedId = w.merge(thoseTwo(ctx), { allowGap: true }).id;
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
  // §05 R06 / §03 / §16 (#61) — attempt to move the running entry's start to a FUTURE instant
  // (the day AFTER the fixed clock, unambiguously ahead of now). Core refuses it on BOTH surfaces
  // and stores nothing; stash the result so the assertion below proves the guard held identically.
  {
    pattern: /^I attempt to edit the open entry start to a future time$/,
    run: (w, ctx) => {
      ctx.editResult = w.attemptEditStart(open(w)!.id, FUTURE_ISO);
    },
  },
  {
    pattern: /^the future-start edit is rejected$/,
    run: (_w, ctx) => expect(ctx.editResult?.rejected).toBe(true),
  },
  // §05 R01 / §03 / §16 (#61) — attempt to Start a new entry backdated BEFORE the running row's
  // start: start()'s atomic close would then write an end < start, so the whole transaction is
  // refused and rolls back on BOTH surfaces, the open row left intact. Stash the result.
  {
    pattern: /^I attempt to start an entry "([^"]*)" backdated to (\d{1,2}:\d{2})$/,
    run: (w, ctx, desc, at) => {
      ctx.startResult = w.attemptStart({ desc, atIso: iso(at) });
    },
  },
  {
    pattern: /^the backdated start is rejected$/,
    run: (_w, ctx) => expect(ctx.startResult?.rejected).toBe(true),
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
  // §12 R13 — restore (un-archive) reference data, the reverse of archive. Surface-neutral over
  // the World restore capability (CoreWorld store.restore*, CliWorld `tt … restore`), so the
  // Clients view's Restore button is proven to reach nothing tt cannot (§17 R8).
  {
    pattern: /^I restore client "([^"]*)"$/,
    run: (w, _c, name) => w.restoreClient(name),
  },
  {
    pattern: /^I restore project "([^"]*)"$/,
    run: (w, _c, name) => w.restoreProject(name),
  },
  {
    pattern: /^I restore tag "([^"]*)"$/,
    run: (w, _c, name) => w.restoreTag(name),
  },
  // §12 R13 edge — attempt to restore a project whose owning client is still archived; both
  // surfaces REFUSE (an active project under a hidden client is unselectable). Stash the result
  // for the shared "the reference-data change is rejected" assertion.
  {
    pattern: /^I try to restore project "([^"]*)"$/,
    run: (w, ctx, name) => {
      ctx.refDataResult = w.attemptRestoreProject(name);
    },
  },
  // §07 R03 (#64) — attempt an add/rename whose name may already be taken; the surface either
  // creates it or REJECTS the duplicate. Both surfaces reject identically (§17 R8), so a
  // by-client report can never silently conflate two clients under one line.
  {
    pattern: /^I try to add a client "([^"]*)"$/,
    run: (w, ctx, name) => {
      ctx.refDataResult = w.attemptAddClient(name);
    },
  },
  {
    pattern: /^I try to add a project "([^"]*)" for client "([^"]*)"$/,
    run: (w, ctx, name, client) => {
      ctx.refDataResult = w.attemptAddProject(name, client);
    },
  },
  {
    pattern: /^I try to add a tag "([^"]*)"$/,
    run: (w, ctx, name) => {
      ctx.refDataResult = w.attemptAddTag(name);
    },
  },
  {
    pattern: /^I try to rename client "([^"]*)" to "([^"]*)"$/,
    run: (w, ctx, name, to) => {
      ctx.refDataResult = w.attemptRenameClient(name, to);
    },
  },
  {
    pattern: /^I try to rename project "([^"]*)" to "([^"]*)"$/,
    run: (w, ctx, name, to) => {
      ctx.refDataResult = w.attemptRenameProject(name, to);
    },
  },
  {
    pattern: /^I try to rename tag "([^"]*)" to "([^"]*)"$/,
    run: (w, ctx, name, to) => {
      ctx.refDataResult = w.attemptRenameTag(name, to);
    },
  },
  {
    pattern: /^the reference-data change is rejected$/,
    run: (_w, ctx) => expect(ctx.refDataResult?.rejected).toBe(true),
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
  // §05 R06 — the amended open row still has NO end instant: status (a second, independent
  // capability — core store.status / `tt status --json`) still reports it running, and the
  // listed row's end is null (core: endUtc null; tt: `list --json` end null). Fails if any
  // surface's edit path stopped the open row or wrote/synthesized an end (e.g. an edit that
  // defaults the missing end to "now").
  {
    pattern: /^the open entry has no end$/,
    run: (w) => {
      expect(w.status().running).toBe(true);
      const o = open(w);
      expect(o).toBeDefined();
      expect(o!.endUtc).toBeNull();
    },
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
  // §06 R3 — the contiguity gate held: the unacknowledged gapped merge was refused, so the
  // fold never fabricated the gap as billable time (the originals survive, asserted below).
  {
    pattern: /^the merge is refused$/,
    run: (_w, ctx) => expect(ctx.mergeResult?.refused).toBe(true),
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
    // §12 R15 / glossary "Stored truth" (issue #49) — the entry's stored start/stop, asserted to
    // the SECOND (the times may carry HH:MM:SS). Regresses if any surface's edit path quietly
    // rewrites an untouched span — e.g. a 5-min snap applied by merely opening + saving an editor.
    pattern:
      /^the entry "([^"]*)" runs exactly from (\d{1,2}:\d{2}(?::\d{2})?) to (\d{1,2}:\d{2}(?::\d{2})?)$/,
    run: (w, _c, desc, from, to) => {
      const e = byDesc(w, desc);
      expect(e.startUtc).toBe(iso(from));
      expect(e.endUtc).toBe(iso(to));
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

  // ---- §11 entry list: range / filter / free-text search (flat, ungrouped) --
  // `tt list` (and core store.listEntries) return ONE flat set for a range, narrowed by
  // client / project / tag and free-text search — no grouping (that left the list for
  // Reports, G11). Each clause accumulates a ListFilterReq and re-runs World.listFiltered
  // (CoreWorld store.listEntries, CliWorld `tt list … --json`), so the two surfaces are
  // compared on the identical flat set (§17 R8). The assertions read the latest result.
  {
    pattern: /^I list entries this week$/,
    run: (w, ctx) => {
      ctx.listReq = { ...(ctx.listReq ?? {}), preset: 'week' };
      ctx.listResults = w.listFiltered(ctx.listReq);
    },
  },
  {
    pattern: /^I list entries for the range (\S+) to (\S+)$/,
    run: (w, ctx, from, to) => {
      ctx.listReq = { ...(ctx.listReq ?? {}), fromUtc: from, toUtc: to };
      delete ctx.listReq.preset;
      ctx.listResults = w.listFiltered(ctx.listReq);
    },
  },
  {
    pattern: /^I filter the entry list to client "([^"]*)"$/,
    run: (w, ctx, client) => {
      ctx.listReq = { ...(ctx.listReq ?? {}), client };
      ctx.listResults = w.listFiltered(ctx.listReq);
    },
  },
  {
    pattern: /^I filter the entry list to project "([^"]*)"$/,
    run: (w, ctx, project) => {
      ctx.listReq = { ...(ctx.listReq ?? {}), project };
      ctx.listResults = w.listFiltered(ctx.listReq);
    },
  },
  {
    pattern: /^I filter the entry list to tag "([^"]*)"$/,
    run: (w, ctx, tag) => {
      ctx.listReq = { ...(ctx.listReq ?? {}), tag };
      ctx.listResults = w.listFiltered(ctx.listReq);
    },
  },
  {
    pattern: /^I search the entry list for "([^"]*)"$/,
    run: (w, ctx, query) => {
      ctx.listReq = { ...(ctx.listReq ?? {}), search: query };
      ctx.listResults = w.listFiltered(ctx.listReq);
    },
  },
  {
    pattern: /^the entry list is exactly "([^"]*)"$/,
    run: (_w, ctx, descs) => {
      const expected = descs.split(',').map((d) => d.trim()).sort();
      const got = (ctx.listResults ?? []).map((e) => e.description ?? '').sort();
      expect(got).toEqual(expected);
    },
  },
  {
    pattern: /^the entry list does not show "([^"]*)"$/,
    run: (_w, ctx, desc) => {
      const all = (ctx.listResults ?? []).map((e) => e.description);
      expect(all).not.toContain(desc);
    },
  },
  // §12 R16 — the per-day + range billable totals the readonly entries calendar presents in its
  // day-headers and range chip. Derived from the SAME flat listed set both surfaces return, laid
  // by local day (the day key core already resolves): a day's total is the billable-only sum of
  // its entries' billableSeconds (an in-range day with no entries totals zero), and the range
  // total is the whole listed set's billable sum. Proven twice (core store.listEntries + tt list
  // --json) so the totals the calendar shows are identical on both surfaces.
  {
    pattern: /^the day "([^"]*)" has a billable total of (\d+) hours?$/,
    run: (_w, ctx, day, hours) => {
      const total = (ctx.listResults ?? [])
        .filter((e) => e.billable && e.startUtc.slice(0, 10) === day)
        .reduce((s, e) => s + e.billableSeconds, 0);
      expect(total).toBe(Number(hours) * 3600);
    },
  },
  {
    pattern: /^the range billable total is (\d+) hours?$/,
    run: (_w, ctx, hours) => {
      const total = (ctx.listResults ?? [])
        .filter((e) => e.billable)
        .reduce((s, e) => s + e.billableSeconds, 0);
      expect(total).toBe(Number(hours) * 3600);
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

  // §09 R1 — a report over a PLAIN-DATE pair (no time component, G3). The step resolves
  // the day pair with the SAME rule the GUI side applies (gui/src/reportview.ts
  // resolveDateRange): local Date(y, m-1, d) construction → the half-open local window
  // [from 00:00, day-after-to 00:00), the day-after by CALENDAR arithmetic (never +24h,
  // so a DST-transition to-day still ends at true local midnight). It then drives the
  // same World `report` capability the other range scenarios use — CoreWorld store.report
  // over the resolved bounds, CliWorld `tt report --range FROM TO --json` — so the
  // plain-date window is proven identical on both logic surfaces (§17 R8). Decimal hours
  // let the half-hour boundary entry register (e.g. 2.5h = Mon 2h + late-Tue 0.5h).
  {
    pattern:
      /^a report for the plain-date range (\d{4})-(\d{2})-(\d{2}) through (\d{4})-(\d{2})-(\d{2}) totals ([\d.]+) billable hours?$/,
    run: (w, _c, y1, m1, d1, y2, m2, d2, hours) => {
      const fromUtc = new Date(Number(y1), Number(m1) - 1, Number(d1)).toISOString();
      // The inclusive end day: the window closes at 00:00 local the day AFTER the to-date.
      const toUtc = new Date(Number(y2), Number(m2) - 1, Number(d2) + 1).toISOString();
      const r = w.report({ fromUtc, toUtc, by: 'client', billableFilter: 'billable' });
      expect(r.grandTotalSeconds).toBe(Number(hours) * 3600);
    },
  },

  // ---- §09 R2 report grouping (the contract the GUI Group-by control drives) ----
  // The grouping engine is core's store.report with the chosen `by`; these steps drive it
  // surface-neutrally over the same World.report the range scenarios use, so the grouping
  // is proven identical on @stint/core and tt (§17 R8). The `by` is the same value the GUI
  // #by-seg segment sends over window.stint.report.
  {
    pattern:
      /^a report for this week grouped by (client|project|day|week|month|tag) groups (\d+) billable hours? under "([^"]*)"$/,
    run: (w, _c, by, hours, key) => {
      const r = w.report({ preset: 'week', by: groupBy(by), billableFilter: 'billable' });
      const line = r.lines.find((l) => l.key === key);
      expect(line, `expected a "${key}" line in the by-${by} report`).toBeDefined();
      expect(line!.totalSeconds).toBe(Number(hours) * 3600);
    },
  },
  {
    pattern: /^a report for this week grouped by (client|project|day|week|month|tag) has (\d+) group lines?$/,
    run: (w, _c, by, count) => {
      const r = w.report({ preset: 'week', by: groupBy(by), billableFilter: 'billable' });
      expect(r.lines.length).toBe(Number(count));
    },
  },
  {
    pattern:
      /^a report for this week grouped by (client|project|day|week|month|tag) totals (\d+) billable hours?$/,
    run: (w, _c, by, hours) => {
      const r = w.report({ preset: 'week', by: groupBy(by), billableFilter: 'billable' });
      expect(r.grandTotalSeconds).toBe(Number(hours) * 3600);
    },
  },
  // §09 R2 — the grouping-invariance fact: the grand total is the same no matter the
  // grouping (regrouping never changes the underlying time). Phrased per-grouping so a
  // scenario can assert it across all six groupings with the one expected total.
  {
    pattern:
      /^a report for this week totals (\d+) billable hours? grouped by (client|project|day|week|month|tag)$/,
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
      /^a report for this week grouped by (client|project|day|week|month|tag) rounded to (\d+) minutes? groups (\d+) seconds under "([^"]*)"$/,
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
      /^a report for this week grouped by (client|project|day|week|month|tag) has an exact (\d+) seconds under "([^"]*)"$/,
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
  {
    // §14 — an INVALID setting write is rejected on this surface (a malformed HH:MM, an
    // inverted working-hours pair, an out-of-range around span, an unknown time zone),
    // storing nothing. Runs over the World attemptSetConfig capability so the strictness is
    // proven identical on core AND tt (§17 R8); a follow-up "the configured … is …" step
    // asserts the default survived.
    pattern: /^setting (?:the )?(.+?) to "([^"]*)" is rejected$/,
    run: (w, _c, setting, value) => {
      expect(w.attemptSetConfig(settingKey(setting), value).rejected).toBe(true);
    },
  },
  {
    // §04 R06 / §14 — seed a closed entry at EXPLICIT UTC instants, so a zone scenario can
    // pin exactly which wall clock the configured zone must render them as.
    pattern: /^a closed entry "([^"]*)" from (\S+) to (\S+)$/,
    run: (w, _c, desc, fromIso, toIso) => {
      w.backfillAt({ desc, fromIso, toIso });
    },
  },
  {
    // §04 R06 / §14 — BOTH surfaces render stored UTC in the ONE configured zone: CoreWorld
    // through core's formatStamp over the store's settings (what the GUI stamp labels
    // paint), CliWorld off the human `tt list` table's START cell — the recorded behavior
    // change away from raw UTC ISO. Run twice, the two surfaces are proven to show one zone.
    pattern: /^the entry "([^"]*)" renders a start of "([^"]*)"$/,
    run: (w, _c, desc, stamp) => {
      expect(w.renderedStart(desc)).toBe(stamp);
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
    // §09 R06 — the UNSCOPED export: the whole record, every raw entry ever (billable and
    // non-billable, no range) — what the GUI's always-on "Export All Data" buttons and
    // no-flag `tt export` write. Distinct from the ranged step above, which narrows.
    pattern: /^I export everything as (csv|json)$/,
    run: (w, ctx, format) => {
      ctx.exportRows = w.exportAllRows(format as 'csv' | 'json');
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
      /^I save a report "([^"]*)" for (this week|last week|today|this month|last month) grouped by (client|project|day|week|month|tag) over (billable|all|non-billable) time$/,
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
      /^I save a report "([^"]*)" for (this week|last week|today|this month|last month) grouped by (client|project|day|week|month|tag) over (billable|all|non-billable) time rounded to (\d+) minutes$/,
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
    // §13 / §12 R21 — core REFUSES a duplicate report name (UNIQUE COLLATE NOCASE). The GUI
    // builder surfaces this refusal inline (§12 R21); this scenario proves the CONTRACT it
    // surfaces holds on BOTH surfaces (CoreWorld store.saveReport throws, CliWorld `tt report
    // save` exits non-zero), and — paired with a follow-up list assertion — that a refused save
    // persists nothing. Mirrors the "setting … is rejected" §14 rejection step.
    pattern:
      /^saving a report "([^"]*)" for (this week|last week|today|this month|last month) grouped by (client|project|day|week|month|tag) over (billable|all|non-billable) time is rejected$/,
    run: (w, _c, name, preset, by, filter) => {
      expect(
        w.attemptSaveReport({
          name,
          preset: presetKeyFull(preset),
          by: groupBy(by),
          billableFilter: filter as 'billable' | 'all' | 'non-billable',
        }).rejected,
      ).toBe(true);
    },
  },
  {
    // §09 R01/R08 — save a report with an ABSOLUTE custom range (fixed from/to bounds). Used by
    // the same-day (from == to) VALID scenario: the report rule is ≤, so this is accepted, saved,
    // and runnable. Surface-neutral (CoreWorld store.saveReport{absolute} / CliWorld `tt report
    // save --range FROM TO`).
    pattern:
      /^I save a report "([^"]*)" for the custom range (\S+) to (\S+) grouped by (client|project|day|week|month|tag) over (billable|all|non-billable) time$/,
    run: (w, _c, name, fromUtc, toUtc, by, filter) => {
      w.saveReportRange({
        name,
        fromUtc,
        toUtc,
        by: groupBy(by),
        billableFilter: filter as 'billable' | 'all' | 'non-billable',
      });
    },
  },
  {
    // §09 R01/R08 — core REFUSES an inverted absolute range (from > to), which only ever resolves
    // to an empty window, so it is rejected rather than stored (mirroring add()'s from<to guard and
    // §14's working-hours start<end). This is the refusal the GUI builder surfaces inline (§12 R21);
    // this proves the CONTRACT holds on BOTH surfaces (store.saveReport throws / `tt report save`
    // exits non-zero), and — paired with a list assertion — that a refused save persists nothing.
    pattern:
      /^saving a report "([^"]*)" for the custom range (\S+) to (\S+) grouped by (client|project|day|week|month|tag) over (billable|all|non-billable) time is rejected$/,
    run: (w, _c, name, fromUtc, toUtc, by, filter) => {
      expect(
        w.attemptSaveReportRange({
          name,
          fromUtc,
          toUtc,
          by: groupBy(by),
          billableFilter: filter as 'billable' | 'all' | 'non-billable',
        }).rejected,
      ).toBe(true);
    },
  },
  {
    // §09 R08 — the from ≤ to guard holds on EDIT too: amending a saved report into an inverted
    // absolute window is refused, leaving the original definition untouched. Both surfaces.
    pattern:
      /^amending the saved report "([^"]*)" range to the custom range (\S+) to (\S+) is rejected$/,
    run: (w, _c, name, fromUtc, toUtc) => {
      expect(w.attemptEditReportRange(name, { fromUtc, toUtc }).rejected).toBe(true);
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
      /^the saved report run total equals an ad-hoc (this week|last week|today|this month|last month) report grouped by (client|project|day|week|month|tag) over (billable|all|non-billable) time$/,
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
    pattern: /^I change the saved report "([^"]*)" grouping to (client|project|day|week|month|tag)$/,
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
  {
    // §20 R05 / §17 R12 — the explicit named-restore path (distinct from automatic recovery): the
    // newest backup is resolved to its name and restored, its entry count captured for the match.
    pattern: /^I restore from the latest backup by name$/,
    run: (w, c) => {
      c.restoreChosenCount = w.restoreLatestBackup().chosenEntryCount;
    },
  },
  {
    // §20 R05 — the reopened database carries exactly the chosen backup's snapshot (its live entry
    // count equals the backup's, read independently before the restore).
    pattern: /^the restored database matches the named backup$/,
    run: (w, c) => {
      expect(c.restoreChosenCount, 'expected a prior `When I restore … by name`').toBeDefined();
      expect(w.list()).toHaveLength(c.restoreChosenCount!);
    },
  },
  {
    // §20 R05 — the destructive restore set the pre-restore file aside, not destroyed: a
    // `.replaced-*` sibling remains beside the database.
    pattern: /^the previous database file is set aside beside the database$/,
    run: (w) => expect(w.hasReplacedFile()).toBe(true),
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

  // ---- §13 / §20 R10/R11/R14 storage paths (config home, ladders, loud refusals) ----
  // Surface-neutral over the World storage-sandbox capabilities: CoreWorld injects the
  // sandbox env into core's resolveStoragePaths / Store.open; CliWorld spawns real `tt`
  // processes under TT_CONFIG / TT_DB / TT_BACKUP_DIR. Run TWICE so the ladders and every
  // refusal are proven identical on @stint/core and tt (§17 R8/R15).
  { pattern: /^a storage sandbox$/, run: (w) => w.storageSandbox() },
  {
    pattern: /^the config file sets a custom database path$/,
    run: (w) => w.storageWriteConfig(JSON.stringify({ dbPath: w.storagePath('confDb') })),
  },
  {
    pattern: /^the config file sets a custom backup directory$/,
    run: (w) => w.storageWriteConfig(JSON.stringify({ backupDir: w.storagePath('confBackups') })),
  },
  {
    pattern: /^the config file sets a database path in a missing directory$/,
    run: (w) => w.storageWriteConfig(JSON.stringify({ dbPath: w.storagePath('missingDb') })),
  },
  {
    pattern: /^the config file contains invalid JSON$/,
    run: (w) => w.storageWriteConfig('{ this is not json'),
  },
  {
    pattern: /^the config file carries an unknown key$/,
    run: (w) =>
      w.storageWriteConfig(JSON.stringify({ dbPath: w.storagePath('confDb'), extra: true })),
  },
  {
    pattern: /^the config file sets a relative database path$/,
    run: (w) => w.storageWriteConfig(JSON.stringify({ dbPath: 'relative/tt.sqlite' })),
  },
  {
    pattern: /^an empty backup directory set in the environment$/,
    run: (w) => w.storageUseBackupDirEnv('live'),
  },
  {
    pattern: /^a missing backup directory set in the environment$/,
    run: (w) => w.storageUseBackupDirEnv('missing'),
  },
  {
    pattern: /^the storage paths resolve with the database set in the environment$/,
    run: (w, c) => {
      c.storageRes = w.storageResolve({ dbEnv: true });
    },
  },
  {
    pattern: /^the storage paths resolve with the database and backup directory set in the environment$/,
    run: (w, c) => {
      w.storageUseBackupDirEnv('live');
      c.storageRes = w.storageResolve({ dbEnv: true });
    },
  },
  {
    pattern: /^the storage paths resolve$/,
    run: (w, c) => {
      c.storageRes = w.storageResolve({ dbEnv: false });
    },
  },
  {
    pattern: /^the database path comes from the environment$/,
    run: (w, c) => {
      expect(c.storageRes!.refused).toBe(false);
      expect(c.storageRes!.db).toEqual({ path: w.storagePath('envDb'), source: 'env' });
    },
  },
  {
    pattern: /^the database path is the configured one with source "config"$/,
    run: (w, c) => {
      expect(c.storageRes!.refused).toBe(false);
      expect(c.storageRes!.db).toEqual({ path: w.storagePath('confDb'), source: 'config' });
    },
  },
  {
    pattern: /^the backup directory is beside the database with source "default"$/,
    run: (w, c) => {
      expect(c.storageRes!.refused).toBe(false);
      // Beside the resolved database: the env-db file's own directory (§13, §20 R04).
      const besideDb = w.storagePath('envDb').replace(/\/[^/]+$/, '');
      expect(c.storageRes!.backupDir).toEqual({ path: besideDb, source: 'default' });
    },
  },
  {
    pattern: /^the backup directory is the configured one with source "config"$/,
    run: (w, c) => {
      expect(c.storageRes!.refused).toBe(false);
      expect(c.storageRes!.backupDir).toEqual({
        path: w.storagePath('confBackups'),
        source: 'config',
      });
    },
  },
  {
    pattern: /^the backup directory comes from the environment$/,
    run: (w, c) => {
      expect(c.storageRes!.refused).toBe(false);
      expect(c.storageRes!.backupDir).toEqual({ path: w.storagePath('backups'), source: 'env' });
    },
  },
  {
    pattern: /^the config file row names the sandbox config file with source "env"$/,
    run: (w, c) => {
      expect(c.storageRes!.refused).toBe(false);
      expect(c.storageRes!.configFile).toEqual({ path: w.storagePath('config'), source: 'env' });
    },
  },
  {
    // §20 R10/R11 — the refusal attempts launch with the database env rung SILENT, so a
    // fallback-to-default bug would have somewhere to go; the Then steps prove it didn't.
    pattern: /^I attempt to launch$/,
    run: (w, c) => {
      c.storageLaunchRes = w.storageLaunch({ dbEnv: false });
    },
  },
  {
    pattern: /^I launch$/,
    run: (w, c) => {
      c.storageLaunchRes = w.storageLaunch({ dbEnv: false });
      expect(c.storageLaunchRes.refused).toBe(false);
    },
  },
  {
    pattern: /^the launch is refused naming the config file$/,
    run: (w, c) => {
      expect(c.storageLaunchRes!.refused).toBe(true);
      expect(c.storageLaunchRes!.message).toContain(w.storagePath('config'));
    },
  },
  {
    pattern: /^the refusal names the unknown key$/,
    run: (_w, c) => expect(c.storageLaunchRes!.message).toContain('extra'),
  },
  {
    // §20 R10/R11 — nothing was created anywhere in the sandbox: no database file, no
    // WAL/SHM sidecar. (The refusal fires before any open, so the default path outside the
    // sandbox is equally untouched — the phantom-empty-tracker guard.)
    pattern: /^no database was created in the sandbox$/,
    run: (w) => {
      const created = w.storageFilesIn('sandbox').filter((f) => /\.sqlite/.test(f));
      expect(created).toEqual([]);
    },
  },
  {
    pattern: /^a database file exists at the configured path$/,
    run: (w) => expect(w.storageExists('confDb')).toBe(true),
  },
  {
    pattern: /^the launch is refused naming the database path and the config file$/,
    run: (w, c) => {
      expect(c.storageLaunchRes!.refused).toBe(true);
      expect(c.storageLaunchRes!.message).toContain(w.storagePath('missingDb'));
      expect(c.storageLaunchRes!.message).toContain(w.storagePath('config'));
    },
  },
  {
    pattern: /^the missing directory was not created$/,
    run: (w) => expect(w.storageExists('missingDbParent')).toBe(false),
  },
  {
    pattern: /^a launched database with one closed entry$/,
    run: (w, c) => {
      c.storageLaunchRes = w.storageLaunch({ dbEnv: true });
      expect(c.storageLaunchRes.refused).toBe(false);
      w.storageAddEntry();
    },
  },
  { pattern: /^I relaunch$/, run: (w) => w.storageRelaunch() },
  {
    pattern: /^the active backup directory holds a timestamped backup named after the database$/,
    run: (w) => {
      // The backup landed in the ACTIVE directory (§20 R04) — and NOT beside the database,
      // which proves the ladder steered the write, not just that a write happened.
      expect(w.storageFilesIn('backups').some((f) => f.startsWith('tt.sqlite.bak-'))).toBe(true);
      expect(w.storageFilesIn('envDbDir').some((f) => f.includes('.bak-'))).toBe(false);
    },
  },
  {
    pattern: /^listing backups shows that backup$/,
    run: (w, c) => {
      c.storageList = w.storageListBackups();
      expect(c.storageList.refused).toBe(false);
      expect(c.storageList.names.some((n) => n.startsWith('tt.sqlite.bak-'))).toBe(true);
    },
  },
  {
    pattern: /^the database is still usable$/,
    run: (w) => expect(w.storageDbUsable()).toBe(true),
  },
  {
    pattern: /^listing backups reports the dead backup directory$/,
    run: (w, c) => {
      c.storageList = w.storageListBackups();
      expect(c.storageList.refused).toBe(true);
      expect(c.storageList.message).toContain(w.storagePath('missingBackups'));
    },
  },
  {
    pattern: /^forcing a backup reports the dead backup directory and no backup is claimed$/,
    run: (w, c) => {
      c.storageNow = w.storageBackupNow();
      expect(c.storageNow.refused).toBe(true);
      expect(c.storageNow.claimed).toBe(false);
      expect(c.storageNow.message).toContain(w.storagePath('missingBackups'));
      // §20 R14 — the never-reported-written half has a filesystem twin: nothing appeared.
      expect(w.storageFilesIn('missingBackups')).toEqual([]);
    },
  },

  // ---- §20 R12 database location change (migrate / start fresh / adopt) — CORE-ONLY ----
  // The pipeline's only driver is the GUI (§12 R26; no tt verb, architecture.html §08);
  // the feature carrying these steps is tagged @core-only, so they bind CoreWorld only.
  {
    // Launched through the CONFIG rung (no TT_DB — the change commits `dbPath` into the
    // config file, and an env override would outrank it on the proving relaunch).
    pattern: /^a launched database with one closed entry at the configured path$/,
    run: (w, c) => {
      c.storageLaunchRes = w.storageLaunch({ dbEnv: false });
      expect(c.storageLaunchRes.refused).toBe(false);
      w.storageAddEntry();
    },
  },
  {
    pattern: /^a foreign file already at the new home$/,
    run: (w) => w.storageSeedNewHome('foreign'),
  },
  {
    pattern: /^a healthy database with two entries already at the new home$/,
    run: (w) => w.storageSeedNewHome('healthy'),
  },
  {
    pattern: /^a corrupt database file already at the new home$/,
    run: (w) => w.storageSeedNewHome('corrupt'),
  },
  {
    pattern: /^a database from a newer schema already at the new home$/,
    run: (w) => w.storageSeedNewHome('future'),
  },
  {
    pattern: /^the database location changes by (migrate|start fresh) to the new home$/,
    run: (w, c, mode) => {
      c.storageConfigBefore = w.storageConfigText();
      c.storageChangeRes = w.storageChangeDbLocation(
        mode === 'start fresh' ? 'start-fresh' : 'migrate',
        'newDb',
      );
    },
  },
  {
    pattern: /^the database location changes by migrate to a missing directory$/,
    run: (w, c) => {
      c.storageConfigBefore = w.storageConfigText();
      c.storageChangeRes = w.storageChangeDbLocation('migrate', 'missingDb');
    },
  },
  {
    // §20 R12's done-when: the old file is kept in place, untouched, and NAMED in the
    // success message.
    pattern: /^the change succeeds naming the old database file$/,
    run: (w, c) => {
      expect(c.storageChangeRes!.refused).toBe(false);
      expect(c.storageChangeRes!.message).toContain(w.storagePath('confDb'));
      expect(c.storageChangeRes!.message).toContain('untouched');
    },
  },
  {
    pattern: /^the change reports the existing file was adopted$/,
    run: (w, c) => {
      expect(c.storageChangeRes!.refused).toBe(false);
      expect(c.storageChangeRes!.message).toContain('adopted');
      expect(c.storageChangeRes!.message).toContain(w.storagePath('confDb'));
    },
  },
  {
    pattern: /^the config file points the database at the new home$/,
    run: (w) => {
      const config = JSON.parse(w.storageConfigText()) as { dbPath?: string };
      expect(config.dbPath).toBe(w.storagePath('newDb'));
    },
  },
  {
    // The §13 cross-surface effect: the relaunch resolves the COMMITTED config through
    // the same core ladder every surface uses, and finds the migrated data live there.
    pattern: /^a relaunch opens the tracked entry at the new home$/,
    run: (w) => {
      w.storageRelaunch();
      expect(w.storageExists('newDb')).toBe(true);
      expect(w.storageEntryCount()).toBe(1);
    },
  },
  {
    pattern: /^a relaunch opens an empty database at the new home$/,
    run: (w) => {
      // Start fresh commits WITHOUT creating the file; the relaunch's §20 R11 first-run
      // semantics (absent file, live parent) create the fresh database at the new home.
      w.storageRelaunch();
      expect(w.storageExists('newDb')).toBe(true);
      expect(w.storageEntryCount()).toBe(0);
    },
  },
  {
    pattern: /^a relaunch opens the two adopted entries at the new home$/,
    run: (w) => {
      w.storageRelaunch();
      expect(w.storageEntryCount()).toBe(2);
    },
  },
  {
    pattern: /^a relaunch still opens the tracked entry at the configured path$/,
    run: (w) => {
      // The refusal left the old path active: the relaunch resolves the unchanged config
      // back to the configured database and the tracked entry is still there.
      w.storageRelaunch();
      expect(w.storageEntryCount()).toBe(1);
    },
  },
  {
    pattern: /^the old database file is still in place$/,
    run: (w) => expect(w.storageExists('confDb')).toBe(true),
  },
  {
    // Copy, never delete — and the pre-change backup is a TRUE copy: after the pipeline
    // the old main file and the newest backup at the old home hold identical bytes.
    pattern: /^the old database file is byte-identical to the pre-change backup$/,
    run: (w) => expect(w.storageOldDbMatchesLatestBackup()).toBe(true),
  },
  {
    pattern: /^the change is refused because migrate never overwrites$/,
    run: (w, c) => {
      expect(c.storageChangeRes!.refused).toBe(true);
      expect(c.storageChangeRes!.message).toContain('migrate never overwrites');
      expect(c.storageChangeRes!.message).toContain(w.storagePath('newDb'));
    },
  },
  {
    pattern: /^the change is refused naming the integrity failure$/,
    run: (w, c) => {
      expect(c.storageChangeRes!.refused).toBe(true);
      expect(c.storageChangeRes!.message).toContain('integrity');
      expect(c.storageChangeRes!.message).toContain(w.storagePath('newDb'));
    },
  },
  {
    pattern: /^the change is refused naming both schema versions$/,
    run: (w, c) => {
      expect(c.storageChangeRes!.refused).toBe(true);
      // The seeded future stamp and the refusal's newer-than framing (§20 R08/R09 gate).
      expect(c.storageChangeRes!.message).toContain('schema version 99');
      expect(c.storageChangeRes!.message).toContain('newer than');
    },
  },
  {
    pattern: /^the change is refused naming the missing parent$/,
    run: (w, c) => {
      expect(c.storageChangeRes!.refused).toBe(true);
      const parent = w.storagePath('missingDb').replace(/\/[^/]+$/, '');
      expect(c.storageChangeRes!.message).toContain(parent);
      expect(c.storageChangeRes!.message).toContain('does not exist');
    },
  },
  {
    // §20 R12/R13 — any failure leaves the config file byte-for-byte as it was.
    pattern: /^the config file is untouched$/,
    run: (w, c) => expect(w.storageConfigText()).toBe(c.storageConfigBefore!),
  },

  // ---- §20 R13 backup directory change (verified move / start fresh) — CORE-ONLY ----
  // Same posture as the §20 R12 steps above: the GUI is the pipeline's only driver, and
  // the @core-only feature binds these to CoreWorld alone.
  {
    pattern: /^a configured backup directory holding existing backups$/,
    run: (w) => w.storageSeedBackupDir(),
  },
  {
    pattern: /^one of those backup names is already taken in the new backup home$/,
    run: (w) => w.storageSeedBackupCollision(),
  },
  {
    pattern: /^the backup directory changes by (migrate|start fresh) to the new backup home$/,
    run: (w, c, mode) => {
      c.storageConfigBefore = w.storageConfigText();
      c.storageChangeRes = w.storageChangeBackupDir(
        mode === 'start fresh' ? 'start-fresh' : 'migrate',
        'newBackups',
      );
    },
  },
  {
    pattern: /^the backup directory changes by migrate to the new backup home with a torn copy$/,
    run: (w, c) => {
      c.storageConfigBefore = w.storageConfigText();
      c.storageChangeRes = w.storageChangeBackupDir('migrate', 'newBackups', true);
    },
  },
  {
    pattern: /^the backup directory changes by migrate to the default location beside the database$/,
    run: (w, c) => {
      c.storageConfigBefore = w.storageConfigText();
      c.storageChangeRes = w.storageChangeBackupDir('migrate', 'default');
    },
  },
  {
    pattern: /^the backup directory changes by migrate to a missing backup directory$/,
    run: (w, c) => {
      c.storageConfigBefore = w.storageConfigText();
      c.storageChangeRes = w.storageChangeBackupDir('migrate', 'missingBackups');
    },
  },
  {
    pattern: /^the backup change succeeds naming the moved backups$/,
    run: (_w, c) => {
      expect(c.storageChangeRes!.refused).toBe(false);
      expect(c.storageChangeRes!.message).toContain('moved');
      expect(c.storageChangeRes!.message).toContain('verified');
    },
  },
  {
    pattern: /^the backup change succeeds leaving the old backups put$/,
    run: (_w, c) => {
      expect(c.storageChangeRes!.refused).toBe(false);
      expect(c.storageChangeRes!.message).toContain('stay put, untouched');
    },
  },
  {
    pattern: /^the backup change is refused because migrate never overwrites$/,
    run: (w, c) => {
      expect(c.storageChangeRes!.refused).toBe(true);
      expect(c.storageChangeRes!.message).toContain('migrate never overwrites');
      expect(c.storageChangeRes!.message).toContain(w.storagePath('newBackups'));
    },
  },
  {
    pattern: /^the backup change is refused naming the failed verification$/,
    run: (_w, c) => {
      expect(c.storageChangeRes!.refused).toBe(true);
      expect(c.storageChangeRes!.message).toContain('copy verification');
      expect(c.storageChangeRes!.message).toContain('both backup sets are intact');
    },
  },
  {
    pattern: /^the backup change is refused naming the missing backup directory$/,
    run: (w, c) => {
      expect(c.storageChangeRes!.refused).toBe(true);
      expect(c.storageChangeRes!.message).toContain(w.storagePath('missingBackups'));
      expect(c.storageChangeRes!.message).toContain('does not exist');
    },
  },
  {
    pattern: /^every existing backup is in the new backup home, byte-identical$/,
    run: (w) => expect(w.storageBackupsMatchSnapshot('newBackups')).toBe(true),
  },
  {
    pattern: /^every existing backup is still in the old backup directory$/,
    run: (w) => expect(w.storageBackupsMatchSnapshot('confBackups')).toBe(true),
  },
  {
    // The delete half of the move ran: originals gone from the old directory (§20 R13 —
    // only ever after every copy verified and the config committed).
    pattern: /^the old backup directory holds no backups$/,
    run: (w) => {
      expect(w.storageFilesIn('confBackups').filter((f) => f.includes('.bak-'))).toEqual([]);
    },
  },
  {
    // The abort rolled the run's own copies back: no original NAME reached the new home
    // (the fresh backup, not part of the pre-change set, stays).
    pattern: /^none of the aborted copies remain in the new backup home$/,
    run: (w) => {
      const names = w.storageSnapshotNames();
      const inNew = w.storageFilesIn('newBackups').filter((f) => names.includes(f));
      expect(inNew).toEqual([]);
    },
  },
  {
    pattern: /^a fresh backup of the database is in the new backup home$/,
    run: (w) => expect(w.storageFreshBackupIn()).toBe(true),
  },
  {
    pattern: /^the config file points the backups at the new backup home$/,
    run: (w) => {
      const config = JSON.parse(w.storageConfigText()) as { dbPath?: string; backupDir?: string };
      expect(config.backupDir).toBe(w.storagePath('newBackups'));
      // The atomic rewrite preserved the unrelated key (§13).
      expect(config.dbPath).toBe(w.storagePath('confDb'));
    },
  },
  {
    // §13 reset semantics — toward the default rung the commit DELETES the key; a
    // resolved default is never written into the file.
    pattern: /^the config file holds no backup directory key$/,
    run: (w) => {
      const config = JSON.parse(w.storageConfigText()) as { dbPath?: string; backupDir?: string };
      expect(config.backupDir).toBeUndefined();
      expect(config.dbPath).toBe(w.storagePath('confDb'));
    },
  },
  {
    pattern: /^the missing backup directory was not created$/,
    run: (w) => expect(w.storageExists('missingBackups')).toBe(false),
  },
  {
    // §20 R04 — listing follows the ACTIVE directory: the relaunch resolves the committed
    // config and finds every moved backup there.
    pattern: /^a relaunch lists the moved backups from the new backup home$/,
    run: (w) => {
      w.storageRelaunch();
      const list = w.storageListBackups();
      expect(list.refused).toBe(false);
      for (const name of w.storageSnapshotNames()) expect(list.names).toContain(name);
    },
  },
  {
    pattern: /^a relaunch resolves the backup directory beside the database with source "default"$/,
    run: (w) => {
      w.storageRelaunch();
      const res = w.storageResolve({ dbEnv: false });
      expect(res.refused).toBe(false);
      const besideDb = w.storagePath('confDb').replace(/\/[^/]+$/, '');
      expect(res.backupDir).toEqual({ path: besideDb, source: 'default' });
    },
  },
];

/** Map the spoken group-by word to the report() `by` option (the GUI #by-seg value). */
function groupBy(spoken: string): GroupBy {
  return spoken as GroupBy;
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
 * accept). The settings feature speaks in ubiquitous language ("week start",
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
    'date format': 'date_format',
    // §04 R06 / §14 — the configured time zone ('system' or an IANA zone).
    'time zone': 'time_zone',
    // §14 — the timeline-window settings (G15): the working-hours pair, the picker's
    // default-window mode, and the around-now span.
    'working hours start': 'working_hours_start',
    'working hours end': 'working_hours_end',
    'picker window mode': 'picker_window_mode',
    'picker around hours': 'picker_around_hours',
    // §14 / §12 R09/R23 — the Entries-calendar settings: the two drag-snap resolutions
    // (whole minutes 1–30, fine ≤ coarse) and the show-weekend boolean.
    'fine snap': 'snap_fine_minutes',
    'coarse snap': 'snap_coarse_minutes',
    'show weekend': 'show_weekend',
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
