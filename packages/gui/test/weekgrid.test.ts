/**
 * Unit — the Entries week grid's calendar arithmetic (packages/gui/src/weekgrid.ts).
 *
 * §12 R09/R16 date math with no DOM and no IPC: which week a day belongs to, which columns
 * that week shows, how the toolbar names them, and how an interval fans onto those columns.
 * It ran only inside app.js, a classic script with no exports, so the branches below could be
 * exercised only by driving a browser to a week that reached them (#322) — the JUDGE scenes
 * pin one rendered week (a Monday-start June week with one overnight span), which leaves the
 * Sunday week start, the cross-month/cross-year label widening and a span crossing MORE than
 * one midnight unasserted anywhere.
 *
 * Every date here is a resolved local day token, as the grid speaks them; the zone that
 * produced it is su.ts's business, not this module's.
 */
import { describe, it, expect } from 'vitest';
import { weekBounds, shownDays, weekLabel, entrySegments, spanSegments } from '../src/weekgrid.js';

describe('the week a day belongs to (§12 R09)', () => {
  it('walks back to the configured week-start day', () => {
    // Wednesday 24 June 2026 — the same day, in two different weeks.
    expect(weekBounds('2026-06-24', 'monday')).toEqual(['2026-06-22', '2026-06-28']);
    expect(weekBounds('2026-06-24', 'sunday')).toEqual(['2026-06-21', '2026-06-27']);
  });

  it('puts a Sunday at the end of a Monday week and the head of a Sunday one', () => {
    // The day the setting moves furthest: Sunday 28 June 2026 is the last column of one week
    // and the first column of the other, so a wrong week-start shifts the whole view by six
    // days rather than by an edge day.
    expect(weekBounds('2026-06-28', 'monday')).toEqual(['2026-06-22', '2026-06-28']);
    expect(weekBounds('2026-06-28', 'sunday')).toEqual(['2026-06-28', '2026-07-04']);
  });

  it('crosses a month boundary as ordinary calendar arithmetic', () => {
    expect(weekBounds('2026-06-30', 'monday')).toEqual(['2026-06-29', '2026-07-05']);
  });
});

describe('the columns a week shows (§12 R09)', () => {
  it('hides the weekend by default and shows all seven when the toggle is on', () => {
    expect(shownDays('2026-06-22', false)).toEqual([
      '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26',
    ]);
    expect(shownDays('2026-06-22', true)).toEqual([
      '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28',
    ]);
  });

  it('drops Sunday from the head of a Sunday-start week, not five days from its middle', () => {
    // A Sunday-start week with the weekend hidden opens on Monday and closes on Friday: the
    // filter is by weekday, never by position, so the two week-start settings show the same
    // five columns for the same calendar week.
    expect(shownDays('2026-06-21', false)).toEqual([
      '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26',
    ]);
  });
});

describe('the toolbar week label (§12 R09)', () => {
  it('names the month and year once when both ends share them', () => {
    expect(weekLabel('2026-06-22', '2026-06-26')).toBe('Jun 22 – 26, 2026');
    expect(weekLabel('2026-06-22', '2026-06-28')).toBe('Jun 22 – 28, 2026');
  });

  it('names both months when the week crosses one', () => {
    expect(weekLabel('2026-06-29', '2026-07-03')).toBe('Jun 29 – Jul 3, 2026');
  });

  it('names both years when the week crosses one', () => {
    expect(weekLabel('2026-12-28', '2027-01-01')).toBe('Dec 28, 2026 – Jan 1, 2027');
  });
});

describe('a stored entry laid onto the day columns (§12 R16, issue #71)', () => {
  it('paints a same-day entry as one block, floored so a short one stays clickable', () => {
    expect(entrySegments({ startDay: '2026-06-22', startMin: 540, end: { day: '2026-06-22', min: 690 } })).toEqual([
      { day: '2026-06-22', topMin: 540, botMin: 690, part: 'full' },
    ]);
    // 09:00–09:02 is two minutes; it is drawn as five so the block can be seen and hit.
    expect(entrySegments({ startDay: '2026-06-22', startMin: 540, end: { day: '2026-06-22', min: 542 } })).toEqual([
      { day: '2026-06-22', topMin: 540, botMin: 545, part: 'full' },
    ]);
  });

  it('fans a span crossing two midnights into start, middle and end pieces', () => {
    // Mon 22:00 → Thu 06:15: the branch a one-night overnight never reaches — the middle days
    // are covered wholly and belong to no other segment, so each is a full-height slice.
    expect(entrySegments({ startDay: '2026-06-22', startMin: 1320, end: { day: '2026-06-25', min: 375 } })).toEqual([
      { day: '2026-06-22', topMin: 1320, botMin: 1440, part: 'seg-start' },
      { day: '2026-06-23', topMin: 0, botMin: 1440, part: 'seg-mid' },
      { day: '2026-06-24', topMin: 0, botMin: 1440, part: 'seg-mid' },
      { day: '2026-06-25', topMin: 0, botMin: 375, part: 'seg-end' },
    ]);
  });

  it('emits no end segment for a span ending exactly at midnight', () => {
    // The start segment already reaches the boundary; an end segment here would be a
    // zero-height block on a day the entry does not visibly occupy.
    expect(entrySegments({ startDay: '2026-06-22', startMin: 1350, end: { day: '2026-06-23', min: 0 } })).toEqual([
      { day: '2026-06-22', topMin: 1350, botMin: 1440, part: 'seg-start' },
    ]);
  });

  it('leaves the open row one footless block in its start column', () => {
    // No end day exists to cross into, and the foot is the renderer's future-fade cap.
    expect(entrySegments({ startDay: '2026-06-22', startMin: 900, end: null })).toEqual([
      { day: '2026-06-22', topMin: 900, botMin: null, part: 'open' },
    ]);
  });

  it('folds a degenerate end-before-start into its start column instead of fanning backwards', () => {
    expect(entrySegments({ startDay: '2026-06-23', startMin: 600, end: { day: '2026-06-22', min: 120 } })).toEqual([
      { day: '2026-06-23', topMin: 600, botMin: 605, part: 'full' },
    ]);
  });
});

describe("the form's live interval laid onto the day columns (§12 R16/R17)", () => {
  it('fans a typed overnight stop across the columns exactly as a stored entry does', () => {
    expect(spanSegments({ startDay: '2026-06-22', startMin: 1320, end: { day: '2026-06-24', min: 375 } })).toEqual([
      { day: '2026-06-22', topMin: 1320, botMin: 1440, part: 'seg-start' },
      { day: '2026-06-23', topMin: 0, botMin: 1440, part: 'seg-mid' },
      { day: '2026-06-24', topMin: 0, botMin: 375, part: 'seg-end' },
    ]);
  });

  it("floors a mid-drag interval at one minute, not a stored block's five", () => {
    expect(spanSegments({ startDay: '2026-06-22', startMin: 540, end: { day: '2026-06-22', min: 540 } })).toEqual([
      { day: '2026-06-22', topMin: 540, botMin: 541, part: 'full' },
    ]);
  });

  it('draws a stopless interval three hours ahead, clipped at the column foot', () => {
    expect(spanSegments({ startDay: '2026-06-22', startMin: 600, end: null })).toEqual([
      { day: '2026-06-22', topMin: 600, botMin: 780, part: 'open' },
    ]);
    expect(spanSegments({ startDay: '2026-06-22', startMin: 1380, end: null })).toEqual([
      { day: '2026-06-22', topMin: 1380, botMin: 1440, part: 'open' },
    ]);
  });
});
