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
import { toUtc, resolveTimeZone, wallClockOf, wallClockToUtc } from './time.js';

/**
 * The ONE grouping vocabulary (PRD §09 R2), shared by the report, the Entries-view list
 * (entrylist.ts), saved reports, `tt report --by` and the GUI's list query. One canonical
 * term, no synonyms (glossary.html) — a second declaration of the same groupings under
 * a second name is what issue #170 removed: adding a grouping used to compile clean
 * and leave the Entries view unable to express it. It is now a compile error everywhere.
 */
export type GroupBy = 'client' | 'project' | 'day' | 'week' | 'month' | 'tag';
export type BillableFilter = 'billable' | 'all' | 'non-billable';

// The placeholder bucket labels for entries a grouping cannot key: no client, no project, no
// tags. Exported constants with ONE definition each, because both grouping surfaces paint the
// same buckets and a magic string re-typed per file lets the Reports view and the Entries view
// disagree on a bucket's name with nothing red (issue #170).
/** The bucket an entry with no client falls under. */
export const NO_CLIENT = '(no client)';
/** The bucket an entry with no project falls under. */
export const NO_PROJECT = '(no project)';
/** The bucket an entry with no tags falls under. */
export const UNTAGGED = '(untagged)';

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
      // spans[i], spans[j]: both loops are bounded by spans.length.
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

/**
 * Local calendar day (YYYY-MM-DD) of an instant, in the given zone — the day-bucket key
 * behind every by-day grouping (glossary "Group key"). `timeZone` is an IANA zone or the
 * `'system'` sentinel/absent → the OS zone at read time (§04 R06/§14).
 */
export function localDay(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: resolveTimeZone(timeZone),
  }).format(new Date(iso));
}

/**
 * Days back from a civil date's day-of-week (0=Sun) to the configured week start — the ONE
 * week-start arithmetic, shared by the "this week" range presets (resolveRange below) and
 * the by-week group keys, so a report's week buckets can never disagree with the window
 * "this week" resolves to.
 */
function daysBackToWeekStart(dow: number, weekStart: WeekStart): number {
  return weekStart === 'monday' ? (dow + 6) % 7 : dow;
}

/**
 * The start day (YYYY-MM-DD) of the configured week containing an instant: the instant's
 * local day in the given zone, walked back to the configured week-start day — the week
 * group key (§09 R02, glossary "Group key"). Zone-free calendar arithmetic once the local
 * day is known (a plain date has no DST).
 */
function localWeekStart(iso: string, weekStart: WeekStart, timeZone?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDay(iso, timeZone));
  if (!m) throw new Error(`localDay produced a non-date: ${localDay(iso, timeZone)}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() - daysBackToWeekStart(d.getUTCDay(), weekStart));
  return d.toISOString().slice(0, 10);
}

// Fixed month abbreviations for the week/month group-key labels below. A table, not
// Intl month names, so the rendered label — which reaches the drift-gated CLI transcript —
// cannot shift with the host's ICU data.
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * The human label for a report line's group key (§09 R02): a week key (`YYYY-MM-DD`, the
 * week's start day) reads "Week of Jul 27", a month key (`YYYY-MM`) reads "Jul 2026", and
 * every other grouping's key IS its label. Display only — the key stays the machine value
 * (it sorts the lines and rides `--json`); both surfaces label through this one function
 * (`tt`'s renderReport, the GUI via window.SU), so the label cannot fork per surface.
 */
export function groupKeyLabel(key: string, by: GroupBy): string {
  if (by === 'week') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    // MONTH_SHORT[..]: the regex holds the month to 01–12.
    if (m) return `Week of ${MONTH_SHORT[Number(m[2]) - 1]!} ${Number(m[3])}`;
  } else if (by === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (m) return `${MONTH_SHORT[Number(m[2]) - 1]!} ${m[1]}`;
  }
  return key;
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
  timeZone?: string,
  weekStart?: WeekStart,
): Report {
  const overlapped = detectOverlaps(allInRange, now);
  const entries = filterByBillable(allInRange, opts.billableFilter);

  // 'client' is the only NESTED grouping (client → project children); every other grouping is
  // flat and keyed by the one `groupKeysOf` derivation, so there is no second switch over the
  // vocabulary to keep in step with it (issue #170). `timeZone` reaches only the day/week/month
  // keys — client/project/tag keys are zone-free — and `weekStart` only the week keys.
  const lines =
    opts.by === 'client'
      ? groupByClientProject(entries, opts)
      : groupByKeys(entries, opts, opts.by, timeZone, weekStart);

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

/**
 * The group key(s) an entry falls under for a grouping — the ONE key derivation behind every
 * grouped surface (the report's lines below, and the Entries view's buckets in entrylist.ts).
 * Tags FAN OUT: an entry with multiple tags lands in each of its tag groups, and an untagged
 * one lands in `UNTAGGED` exactly once.
 */
export function groupKeysOf(
  e: EntryView,
  by: GroupBy,
  timeZone?: string,
  weekStart?: WeekStart,
): string[] {
  switch (by) {
    case 'day':
      // §04 R06 / §14: the day bucket is the CONFIGURED zone's calendar day of the start
      // ('system'/absent → the OS zone at read time).
      return [localDay(e.startUtc, timeZone)];
    case 'week':
      // §09 R02: attribution by the entry's START day — the same rule as by-day — walked
      // back to the configured week-start day. `weekStart` must be threaded from settings;
      // grouping by week without it is a caller bug, so fail loudly (the issue #55
      // pattern) rather than silently assuming a start day the setting may contradict.
      if (weekStart === undefined) {
        throw new Error("grouping by week requires the week_start setting threaded in");
      }
      return [localWeekStart(e.startUtc, weekStart, timeZone)];
    case 'month':
      // §09 R02: the configured zone's calendar month of the START day, keyed YYYY-MM.
      return [localDay(e.startUtc, timeZone).slice(0, 7)];
    case 'client':
      return [e.clientName ?? NO_CLIENT];
    case 'project':
      return [e.projectName ?? NO_PROJECT];
    case 'tag':
      return e.tags.length > 0 ? e.tags : [UNTAGGED];
    default:
      // Issue #55: a missing/unknown grouping is a caller bug (`by` is required on every
      // list query). Fail loudly with a clear message instead of falling through to
      // undefined — which used to surface as an opaque "keysOf … is not iterable"
      // TypeError deep inside groupInto.
      throw new Error(
        `unknown entry grouping '${String(by)}' — expected 'day', 'week', 'month', 'client', 'project' or 'tag'`,
      );
  }
}

/** One flat line per group key, ordered by key — the report shape of `groupKeysOf`. */
function groupByKeys(
  entries: EntryView[],
  opts: ReportOptions,
  by: GroupBy,
  timeZone?: string,
  weekStart?: WeekStart,
): ReportLine[] {
  return sortedGroups(groupInto(entries, (e) => groupKeysOf(e, by, timeZone, weekStart))).map(
    ([k, es]) => makeLine(k, es, opts),
  );
}

function groupByClientProject(entries: EntryView[], opts: ReportOptions): ReportLine[] {
  return sortedGroups(groupInto(entries, (e) => groupKeysOf(e, 'client')))
    .map(([clientName, clientEntries]) => {
      const children = groupByKeys(clientEntries, opts, 'project');
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

/**
 * Resolve a named preset to UTC bounds — the configured zone's calendar (§04 R06/§14,
 * glossary "Range preset"): "today"/"this week"/"this month" are the days the configured
 * zone's clock says they are, bounded by that zone's midnights. `timeZone` is an IANA
 * zone or the `'system'` sentinel/absent → the OS zone at read time. All day/month
 * stepping is CALENDAR arithmetic through `wallClockToUtc` (never `+ n*24h`), so a
 * DST-transition day of 23/25 local hours still bounds at true local midnights — and a
 * zone whose midnight does not exist on a transition day resolves compatibly (shifted
 * past the gap).
 */
export function resolveRange(
  preset: 'today' | 'week' | 'last-week' | 'month' | 'last-month',
  weekStart: WeekStart,
  now: Date = new Date(),
  timeZone?: string,
): { fromUtc: string; toUtc: string } {
  const tz = resolveTimeZone(timeZone);
  const today = wallClockOf(now, tz);
  // The zone's midnight of a civil date; out-of-range day/month carry over as calendar
  // arithmetic (Date.UTC normalisation inside wallClockToUtc).
  const midnight = (month: number, day: number) =>
    wallClockToUtc({ year: today.year, month, day }, tz);
  // Day-of-week of the civil date (zone-free once the date is known).
  const dow = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay(); // 0=Sun
  const back = daysBackToWeekStart(dow, weekStart);

  let from: Date;
  let to: Date;
  switch (preset) {
    case 'today':
      from = midnight(today.month, today.day);
      to = midnight(today.month, today.day + 1);
      break;
    case 'week':
      from = midnight(today.month, today.day - back);
      to = midnight(today.month, today.day - back + 7);
      break;
    case 'last-week':
      from = midnight(today.month, today.day - back - 7);
      to = midnight(today.month, today.day - back);
      break;
    case 'month':
      from = midnight(today.month, 1);
      to = midnight(today.month + 1, 1);
      break;
    case 'last-month':
      from = midnight(today.month - 1, 1);
      to = midnight(today.month, 1);
      break;
  }
  return { fromUtc: from.toISOString(), toUtc: to.toISOString() };
}

// ----------------------------------------------- plain-date custom ranges (§09 R01 / G3)

/** The configured zone's midnight, `plusDays` calendar days after a `YYYY-MM-DD` date. */
function localMidnight(date: string, plusDays: number, timeZone?: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`invalid plain date (expected YYYY-MM-DD): ${date}`);
  // wallClockToUtc: the day-after arithmetic is CALENDAR arithmetic (never `+ 24h`), so a
  // DST-transition day of 23/25 local hours still resolves to the true next local midnight.
  return wallClockToUtc(
    { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) + plusDays },
    resolveTimeZone(timeZone),
  );
}

/**
 * §09 R01 — a custom range is a PAIR OF PLAIN DATES, no time component (G3). Resolve the
 * two date-field values (`YYYY-MM-DD`) to the half-open window
 * [from 00:00, day-after-to 00:00) in the configured zone (§04 R06/§14): the to-day is
 * included IN FULL (an entry late that evening still counts) and the next day is
 * excluded — the same inclusive-end-day, half-open convention the resolveRange presets
 * above produce. This is the ONE home of the plain-date → window rule (both surfaces
 * route through it: the GUI's listEntries handler and saved-report rangeSpec conversions
 * via reportview.ts; the renderer only ever carries the raw date strings).
 */
export function resolveDateRange(
  fromDate: string,
  toDate: string,
  timeZone?: string,
): { fromUtc: string; toUtc: string } {
  return {
    fromUtc: toUtc(localMidnight(fromDate, 0, timeZone)),
    toUtc: toUtc(localMidnight(toDate, 1, timeZone)),
  };
}

/**
 * §09 R01 — the inverse of resolveDateRange: paint a stored absolute window back into the
 * two plain date fields, in the configured zone. The stored to-bound is EXCLUSIVE, so the
 * inclusive to-day is the local day of the instant just before it. Tolerant of LEGACY
 * arbitrary-instant windows (a saved def whose bounds are not local midnights): the pair
 * rounds OUTWARD to the covering day pair, so re-saving such a def normalises it to
 * plain-date bounds.
 */
export function utcWindowToDatePair(
  fromUtc: string,
  toUtcBound: string,
  timeZone?: string,
): { fromDate: string; toDate: string } {
  return {
    fromDate: localDay(fromUtc, timeZone),
    toDate: localDay(new Date(Date.parse(toUtcBound) - 1).toISOString(), timeZone),
  };
}
