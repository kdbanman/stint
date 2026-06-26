/**
 * Reporting, rounding, and overlap detection (PRD §06, §09).
 *
 * Stored time is exact. Rounding applies only at display/export and only to the
 * grouped total (the billable line), never to each entry or to stored timestamps.
 * Overlapped spans and unreviewed sleep are flagged so the same time cannot
 * silently bill twice or quietly reach an invoice.
 */
import type { EntryView } from './types.js';
import type { WeekStart } from './settings.js';

export type GroupBy = 'client' | 'project' | 'day' | 'tag';
export type BillableFilter = 'billable' | 'all' | 'non-billable';

export interface ReportOptions {
  by: GroupBy;
  billableFilter: BillableFilter;
  rounding: boolean;
  roundingIncrementMin: number;
}

export interface ReportLine {
  key: string;
  /** Nested lines (client → project); empty for flat groupings. */
  children: ReportLine[];
  entryIds: number[];
  /** Exact billable seconds summed over this line's entries. */
  totalSeconds: number;
  /** Rounded seconds: rounding applied to this line's total (PRD §09 R4). */
  roundedSeconds: number;
}

export interface Report {
  lines: ReportLine[];
  grandTotalSeconds: number;
  grandRoundedSeconds: number;
  /** Entries whose span overlaps another entry in the report. */
  overlappedEntryIds: number[];
  /** Slept-through entries that have not been (fully) reviewed/subtracted. */
  unreviewedSleepEntryIds: number[];
  options: ReportOptions;
  rangeFromUtc: string;
  rangeToUtc: string;
}

/** Round seconds to the nearest `incrementMin` minutes (nearest, not always-up). */
export function roundSeconds(seconds: number, incrementMin: number): number {
  if (incrementMin <= 0) return seconds;
  const step = incrementMin * 60;
  return Math.round(seconds / step) * step;
}

/**
 * The one overlap rule, shared by everything that needs it: two half-open intervals
 * [aStart, aEnd) and [bStart, bEnd) intersect. Defined once so the report-wide scan
 * and the per-entry write-time check can never drift apart.
 */
export function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** How an entry's worst-overlapping neighbour sits relative to it. */
export type OverlapRelation = 'previous' | 'next';

/** Per-entry detail of its single worst overlap, surfaced in context (PRD §12 R9). */
export interface OverlapDetail {
  /** Seconds the entry's span shares with its worst-overlapping neighbour. */
  overlapSeconds: number;
  /** The neighbour the entry overlaps most. */
  neighborId: number;
  /** Whether that neighbour starts before (previous) or at/after (next) this entry. */
  relation: OverlapRelation;
}

/**
 * For each overlapping entry, the detail of its single worst overlap: how many seconds
 * it shares with its worst-overlapping neighbour and whether that neighbour starts before
 * (`previous`) or at/after (`next`) it. Built on the one `spansOverlap` rule the report
 * scan uses, so the in-context banner amount can never drift from the report flag. An
 * entry that overlaps nothing is absent from the map. Overlap seconds are
 * `max(0, min(aEnd,bEnd) - max(aStart,bStart))`; an open entry's end is taken as `now`.
 */
export function describeOverlaps(
  entries: EntryView[],
  now: Date = new Date(),
): Map<number, OverlapDetail> {
  const nowMs = now.getTime();
  const spans = entries.map((e) => ({
    id: e.id,
    s: Date.parse(e.startUtc),
    e: e.endUtc ? Date.parse(e.endUtc) : nowMs,
  }));
  const details = new Map<number, OverlapDetail>();
  // Keep, for each entry, the largest overlap span seen so far so the banner reports the
  // worst (most billing-significant) neighbour.
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i]!;
      const b = spans[j]!;
      if (!spansOverlap(a.s, a.e, b.s, b.e)) continue;
      const overlapSeconds = Math.max(0, (Math.min(a.e, b.e) - Math.max(a.s, b.s)) / 1000);
      // a's neighbour b: `previous` when b starts strictly before a, else `next`.
      consider(details, a.id, overlapSeconds, b.id, b.s < a.s ? 'previous' : 'next');
      // b's neighbour a: symmetric relation from b's vantage point.
      consider(details, b.id, overlapSeconds, a.id, a.s < b.s ? 'previous' : 'next');
    }
  }
  return details;
}

/** Keep the worst (largest) overlap detail for an entry, tie-broken by first seen. */
function consider(
  details: Map<number, OverlapDetail>,
  id: number,
  overlapSeconds: number,
  neighborId: number,
  relation: OverlapRelation,
): void {
  const prior = details.get(id);
  if (!prior || overlapSeconds > prior.overlapSeconds) {
    details.set(id, { overlapSeconds, neighborId, relation });
  }
}

/**
 * Detect overlaps among entries. Two entries overlap when their [start, end)
 * intervals intersect; an open entry's end is taken as `now`.
 * Returns the set of entry ids that overlap at least one other entry. Derived from the
 * one `describeOverlaps` scan so the Set and the per-entry detail never disagree on which
 * entries overlap (report.ts/export.ts depend on this signature).
 */
export function detectOverlaps(entries: EntryView[], now: Date = new Date()): Set<number> {
  return new Set(describeOverlaps(entries, now).keys());
}

/** Local calendar day (YYYY-MM-DD) of an instant, in the given zone. */
export function localDay(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

function filterByBillable(entries: EntryView[], filter: BillableFilter): EntryView[] {
  switch (filter) {
    case 'billable':
      return entries.filter((e) => e.billable);
    case 'non-billable':
      return entries.filter((e) => !e.billable);
    case 'all':
      return entries;
  }
}

function makeLine(key: string, entries: EntryView[], opts: ReportOptions): ReportLine {
  const totalSeconds = entries.reduce((s, e) => s + e.billableSeconds, 0);
  return {
    key,
    children: [],
    entryIds: entries.map((e) => e.id),
    totalSeconds,
    roundedSeconds: opts.rounding
      ? roundSeconds(totalSeconds, opts.roundingIncrementMin)
      : totalSeconds,
  };
}

/**
 * Build a report from a pre-fetched, already range-filtered set of entries.
 * Overlap detection runs over the full input set (before the billable filter) so a
 * billable entry overlapping a non-billable one is still flagged.
 */
export function buildReport(
  allInRange: EntryView[],
  opts: ReportOptions,
  range: { fromUtc: string; toUtc: string },
  now: Date = new Date(),
): Report {
  const overlapped = detectOverlaps(allInRange, now);
  const entries = filterByBillable(allInRange, opts.billableFilter);

  let lines: ReportLine[];
  switch (opts.by) {
    case 'client':
      lines = groupByClientProject(entries, opts);
      break;
    case 'project':
      lines = groupBy(entries, opts, (e) => e.projectName ?? '(no project)');
      break;
    case 'day':
      lines = groupBy(entries, opts, (e) => localDay(e.startUtc));
      break;
    case 'tag':
      lines = groupByTag(entries, opts);
      break;
  }

  const grandTotalSeconds = entries.reduce((s, e) => s + e.billableSeconds, 0);
  const grandRoundedSeconds = lines.reduce((s, l) => s + l.roundedSeconds, 0);

  const unreviewedSleepEntryIds = entries
    .filter((e) => e.sleptThrough && e.excludedSeconds < sleptSeconds(e))
    .map((e) => e.id);

  // Keep only overlaps among entries that survived the billable filter (O(n) via Set).
  const keptIds = new Set(entries.map((e) => e.id));

  return {
    lines,
    grandTotalSeconds,
    grandRoundedSeconds,
    overlappedEntryIds: [...overlapped].filter((id) => keptIds.has(id)),
    unreviewedSleepEntryIds,
    options: opts,
    rangeFromUtc: range.fromUtc,
    rangeToUtc: range.toUtc,
  };
}

function sleptSeconds(e: EntryView): number {
  return e.sleepSpans.reduce(
    (s, span) => s + Math.max(0, (Date.parse(span.wakeUtc) - Date.parse(span.sleepUtc)) / 1000),
    0,
  );
}

/**
 * Group items into buckets by one or more keys each (multi-key handles tags, where an
 * entry belongs to every one of its tags). One implementation of the accumulator the
 * report groupers and the GUI day-grouping all need, instead of the `(m.get(k) ??
 * m.set(k, []).get(k)!).push(x)` idiom copy-pasted at four call sites.
 */
export function groupInto<T>(items: T[], keysOf: (t: T) => string[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    for (const key of keysOf(item)) {
      let bucket = map.get(key);
      if (!bucket) {
        bucket = [];
        map.set(key, bucket);
      }
      bucket.push(item);
    }
  }
  return map;
}

/**
 * A grouped map's entries, ordered by key (stable, locale-aware). Exported so the
 * Entries-view grouping (entrylist.ts) shares the one locale-aware key ordering the
 * report groupers use, rather than duplicating the localeCompare sort.
 */
export function sortedGroups<T>(map: Map<string, T[]>): [string, T[]][] {
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** A grouped map's entries, ordered by key (stable, locale-aware). */
function sortedEntries<T>(map: Map<string, T[]>): [string, T[]][] {
  return sortedGroups(map);
}

function groupBy(
  entries: EntryView[],
  opts: ReportOptions,
  keyOf: (e: EntryView) => string,
): ReportLine[] {
  return sortedEntries(groupInto(entries, (e) => [keyOf(e)])).map(([k, es]) =>
    makeLine(k, es, opts),
  );
}

function groupByClientProject(entries: EntryView[], opts: ReportOptions): ReportLine[] {
  return sortedEntries(groupInto(entries, (e) => [e.clientName ?? '(no client)']))
    .map(([clientName, clientEntries]) => {
      const children = groupBy(clientEntries, opts, (e) => e.projectName ?? '(no project)');
      // The client line's rounded total is the sum of its rounded project lines, so
      // rounding is applied to the billable line consistently at the leaf level.
      const roundedSeconds = children.reduce((s, c) => s + c.roundedSeconds, 0);
      const totalSeconds = clientEntries.reduce((s, e) => s + e.billableSeconds, 0);
      return {
        key: clientName,
        children,
        entryIds: clientEntries.map((e) => e.id),
        totalSeconds,
        roundedSeconds,
      };
    });
}

function groupByTag(entries: EntryView[], opts: ReportOptions): ReportLine[] {
  // An entry with multiple tags lands in each of its tag groups (and untagged once).
  return sortedEntries(groupInto(entries, (e) => (e.tags.length > 0 ? e.tags : ['(untagged)']))).map(
    ([k, es]) => makeLine(k, es, opts),
  );
}

/** Resolve a named preset or explicit range to UTC bounds. */
export function resolveRange(
  preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month',
  weekStart: WeekStart,
  now: Date = new Date(),
): { fromUtc: string; toUtc: string } {
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const addDays = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const weekStartOf = (d: Date) => {
    const sd = startOfDay(d);
    const dow = sd.getDay(); // 0=Sun
    const offset = weekStart === 'monday' ? (dow + 6) % 7 : dow;
    return addDays(sd, -offset);
  };

  let from: Date;
  let to: Date;
  switch (preset) {
    case 'today':
      from = startOfDay(now);
      to = addDays(from, 1);
      break;
    case 'week':
      from = weekStartOf(now);
      to = addDays(from, 7);
      break;
    case 'last-week':
      to = weekStartOf(now);
      from = addDays(to, -7);
      break;
    case 'month':
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      break;
    case 'last-month':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
  }
  return { fromUtc: from.toISOString(), toUtc: to.toISOString() };
}
