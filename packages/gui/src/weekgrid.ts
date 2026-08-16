/**
 * §12 R09/R16 — the Entries week grid's calendar arithmetic: which week a day belongs to,
 * which columns that week shows, how the toolbar names them, and how an interval lays onto
 * those columns as rendering segments.
 *
 * GUI-only but pure, so it lives here rather than in core (engineering.html §06's layering
 * table) and reaches the classic renderer through `renderer/su.ts` as `window.SU` — the
 * src/snap.ts route. Kept out of app.js because a 3.9k-line classic script exports nothing:
 * the Sunday week start, the cross-month/cross-year label widening and the multi-day
 * middle-segment fan-out could only be asked a question by opening a browser (#322).
 *
 * DAY TOKENS AND MINUTES, NEVER INSTANTS. Every date here is a resolved local day —
 * 'YYYY-MM-DD' in the configured zone (§04 R06), the vocabulary core's `localDay` keys the
 * snapshot's day buckets with, so the two compare directly — and every position is a local
 * minute-of-day (0–1440). Resolving an instant into that vocabulary is su.ts's job
 * (`localDayOf` / `localMinuteOfDay`, the one derivation of each — #168); this module takes
 * the resolved values, which is why it needs no zone, no clock and no settings snapshot of
 * its own. What is left is plain UTC math over civil dates, and a civil date has no DST.
 */
import type { WeekStart } from '@stint/core';

/** Fixed English abbreviations, not Intl month names, so a label cannot shift with the
 * host's ICU data (core's group-key labels use a table for the same reason). The
 * date/number-format setting governs times and numerals, never these. */
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Which piece of a span a segment is — the class the renderer paints its open edges from. */
export type SegmentPart = 'open' | 'full' | 'seg-start' | 'seg-mid' | 'seg-end';

/** One painted block: the day column it lands in and its local-minute top/foot. */
export interface DaySegment {
  day: string;
  topMin: number;
  /** null on a stored OPEN row only — its foot is the renderer's future-fade cap (calEvent). */
  botMin: number | null;
  part: SegmentPart;
}

/**
 * An interval already resolved to the grid's vocabulary. A null `end` is the OPEN row — the
 * keystone shape (a running timer is the entry whose end is null), which is why the open
 * block below is a branch rather than a flag beside the bounds.
 */
export interface LocalSpan {
  /**
   * The column the span starts in. For a stored entry this is the day bucket core grouped it
   * under, passed in rather than re-derived, so the start segment lands in its own column
   * even at a local-day boundary.
   */
  startDay: string;
  startMin: number;
  end: { day: string; min: number } | null;
}

/** A day token's civil date as a UTC instant — the one parse, so no zone enters the math. */
function utcDateOf(day: string): Date {
  const [y, m, d] = day.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

/** Monday–Friday. The token is already a resolved local day, so no zone is re-derived. */
function isWeekday(day: string): boolean {
  const dow = utcDateOf(day).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/** The day token `n` days from `day`. */
export function addDays(day: string, n: number): string {
  const dt = utcDateOf(day);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * §12 R09: the [first, last] day tokens of the week containing `day`, aligned to the
 * `week_start` setting (§14) — the same week the report presets and by-week group keys walk
 * back to, over a day token rather than an instant.
 */
export function weekBounds(day: string, weekStart: WeekStart): [string, string] {
  const startDow = weekStart === 'sunday' ? 0 : 1;
  const back = (utcDateOf(day).getUTCDay() - startDow + 7) % 7;
  const start = addDays(day, -back);
  return [start, addDays(start, 6)];
}

/**
 * §12 R09: the week's SHOWN columns from its first day — Monday–Friday with the weekend
 * hidden (`show_weekend` off, the §14 default), all seven with it shown. The hidden days
 * keep their entries stored and reported; they are only not this view's columns.
 */
export function shownDays(weekStartDay: string, showWeekend: boolean): string[] {
  const week: string[] = [];
  for (let i = 0; i < 7; i++) week.push(addDays(weekStartDay, i));
  return showWeekend ? week : week.filter(isWeekday);
}

/**
 * §12 R09: the toolbar's label over the shown span — "Jun 22 – 26, 2026" with the weekend
 * hidden, "Jun 22 – 28, 2026" with it shown. Month and year are stated once when both ends
 * share them, and both ends are named in full when they do not: a week crossing a month
 * reads "Jun 29 – Jul 3, 2026", one crossing a year "Dec 28, 2026 – Jan 1, 2027".
 */
export function weekLabel(firstDay: string, lastDay: string): string {
  const [fy, fm, fd] = firstDay.split('-');
  const [ly, lm, ld] = lastDay.split('-');
  const first = `${MONTHS_SHORT[Number(fm) - 1]} ${Number(fd)}`;
  const last = `${MONTHS_SHORT[Number(lm) - 1]} ${Number(ld)}`;
  if (fy === ly && fm === lm) return `${first} – ${Number(ld)}, ${Number(fy)}`;
  if (fy === ly) return `${first} – ${last}, ${Number(fy)}`;
  return `${first}, ${Number(fy)} – ${last}, ${Number(ly)}`;
}

/**
 * The fan-out of a CLOSED span onto the day columns: one 'full' block when it stays inside
 * its start day, else a start segment reaching the column foot (24:00), a full-height slice
 * per whole middle day, and an end segment from the next column's head.
 *
 * `minHeightMin` is the floor a very short span is widened to, and it is the ONLY thing the
 * two public fan-outs disagree on — so the arithmetic that decides which columns a span
 * touches has one definition, and a change to it cannot reach one surface and miss the other.
 */
function closedSegments(
  span: LocalSpan,
  end: { day: string; min: number },
  minHeightMin: number,
): DaySegment[] {
  // `end.day <= startDay` also folds any degenerate end-before-start into the same-day path
  // rather than emitting a backwards fan-out.
  if (end.day <= span.startDay) {
    return [
      {
        day: span.startDay,
        topMin: span.startMin,
        botMin: Math.max(end.min, span.startMin + minHeightMin),
        part: 'full',
      },
    ];
  }
  const segs: DaySegment[] = [
    { day: span.startDay, topMin: span.startMin, botMin: 1440, part: 'seg-start' },
  ];
  for (let mid = addDays(span.startDay, 1); mid < end.day; mid = addDays(mid, 1)) {
    segs.push({ day: mid, topMin: 0, botMin: 1440, part: 'seg-mid' });
  }
  // A span ending exactly at local midnight (min 0) gains no visible slice on the end day —
  // the start segment already reaches the boundary — so no zero-height end segment is emitted.
  if (end.min > 0) segs.push({ day: end.day, topMin: 0, botMin: end.min, part: 'seg-end' });
  return segs;
}

/**
 * §12 R16 (issue #71): the segments a STORED entry lays onto the day columns. A same-day
 * entry is one 'full' block in its start-day column; a closed entry whose local end day
 * differs CROSSES MIDNIGHT and renders one segment per touched column, all sharing the entry
 * id. The open entry never splits — it stays one future-fading start-only block (no end day
 * exists to cross into), and its null foot is the renderer's fade cap.
 *
 * ATTRIBUTION IS NOT TOUCHED HERE. The entry lives in exactly one day bucket, keyed by its
 * start day (core's entrylist grouping); these segments are a pure rendering fan-out that
 * never re-buckets it, so an end/middle column shows the span WITHOUT counting it in that
 * column's billable total — matching `tt report --by day` (§16). A segment landing on a day
 * the grid does not show is simply not drawn, which for the same reason moves no total.
 *
 * The 5-minute floor is legibility: a very short block still has to be seen and clicked.
 */
export function entrySegments(span: LocalSpan): DaySegment[] {
  if (span.end === null) {
    return [{ day: span.startDay, topMin: span.startMin, botMin: null, part: 'open' }];
  }
  return closedSegments(span, span.end, 5);
}

/**
 * §12 R16/R17: the same fan-out over the unified form's LIVE interval — the pending block a
 * drag or a typed field paints, so a stop typed onto a later day fans into one segment per
 * shown day instead of flattening to same-day.
 *
 * Two rules differ from a stored entry's: the open row is capped three hours into the future
 * (the pending block has to be drawn now, where calEvent computes a stored one's fade), and
 * the floor is one minute — the interval is still being dragged, and a minute is the smallest
 * thing the user can be pointing at.
 */
export function spanSegments(span: LocalSpan): DaySegment[] {
  if (span.end === null) {
    return [
      {
        day: span.startDay,
        topMin: span.startMin,
        botMin: Math.min(span.startMin + 180, 1440),
        part: 'open',
      },
    ];
  }
  return closedSegments(span, span.end, 1);
}
