/**
 * The Entries-view list model (PRD §12 R9) — grouping, free-text search, and the
 * one match rule, defined once in @stint/core so the GUI Entries view and `tt list`
 * group and search identically (no surface re-derives any of it).
 *
 * Range / billable / client / project / tag filtering is already done upstream by
 * store.listEntries (it is SQL-indexed where it can be, and a post-`toView` pass for
 * tags); this module covers what is left: matching the free-text query against the
 * resolved fields, and bucketing the surviving entries by the chosen grouping.
 */
import type { EntryView } from './types.js';
import { groupInto, sortedGroups, localDay } from './report.js';

/**
 * How the Entries view buckets its rows. The same four groupings the report's
 * Group-by control offers (§09 R2), reusing the report's GroupBy vocabulary: 'day'
 * (the renderer's default, newest-first), and client / project / tag.
 */
export type EntryGroupBy = 'day' | 'client' | 'project' | 'tag';

/** One grouped bucket: the group key and the entries that fall under it. */
export interface EntryGroup {
  key: string;
  entries: EntryView[];
}

/** The Entries-view list: the grouped buckets and the flat set of matched entry ids. */
export interface EntryList {
  groups: EntryGroup[];
  matchedIds: number[];
}

/**
 * §09 R7 — the one free-text match rule, shared by the Entries view and `tt list`.
 * Case-insensitive substring over the resolved fields the report-builder search box
 * covers: description, client name, project name, and any tag. An empty or
 * whitespace-only query matches every entry (no search active).
 */
export function matchesQuery(e: EntryView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystacks = [e.description, e.clientName, e.projectName, ...e.tags];
  return haystacks.some((h) => h != null && h.toLowerCase().includes(q));
}

/** The group key(s) an entry falls under for a given grouping (tags fan out). */
function keysOf(e: EntryView, by: EntryGroupBy): string[] {
  switch (by) {
    case 'day':
      return [localDay(e.startUtc)];
    case 'client':
      return [e.clientName ?? '(no client)'];
    case 'project':
      return [e.projectName ?? '(no project)'];
    case 'tag':
      // An entry with multiple tags lands in each of its tag groups (and untagged once),
      // exactly like the report's by-tag grouping.
      return e.tags.length > 0 ? e.tags : ['(untagged)'];
  }
}

/**
 * Bucket entries by the chosen grouping. Day groups sort DESC (newest day first,
 * matching the current renderer's day-grouped list); client / project / tag sort ASC
 * (locale-aware), reusing the report's sorted-group helper so the ordering rule lives
 * in one place. Tag grouping puts an entry under each of its tags (and '(untagged)').
 */
export function groupEntries(entries: EntryView[], by: EntryGroupBy): EntryGroup[] {
  const sorted = sortedGroups(groupInto(entries, (e) => keysOf(e, by)));
  if (by === 'day') sorted.reverse(); // newest day first
  return sorted.map(([key, es]) => ({ key, entries: es }));
}

/**
 * Build the Entries-view list from a pre-filtered set of entries (range / billable /
 * client / project / tag are already applied by store.listEntries). Pure: it applies
 * the free-text query, then groups the survivors. `matchedIds` is the flat set of
 * entries that survived the query, in input order.
 */
export function buildEntryList(
  entries: EntryView[],
  opts: { by: EntryGroupBy; query?: string },
): EntryList {
  const matched = opts.query ? entries.filter((e) => matchesQuery(e, opts.query!)) : entries;
  return {
    groups: groupEntries(matched, opts.by),
    matchedIds: matched.map((e) => e.id),
  };
}
