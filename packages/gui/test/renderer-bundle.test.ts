/**
 * GOLD — the renderer bundle guard (issue #83). `window.SU` is no longer a hand-copied
 * dialect of core: it is BUILT (scripts/build-renderer.mjs) from core + gui-main sources,
 * so the old source-text mirror regexes are replaced by BEHAVIORAL equivalence here — the
 * suite executes the exact bundle the pages load and asserts it behaves as the modules it
 * imports, and that no Node-touching core module survives into the browser bundle.
 *
 * Two kinds of fact live here, and the difference matters (issue #178):
 *   - EQUIVALENCE — fmtDur/fmtHours/deriveView/tagDiff/elapsed are core's or gui/src's rules
 *     reached through the bundle, so the assertion is "IS the imported rule". Since #83 that
 *     mostly proves esbuild preserved semantics; the rules themselves are proven at home.
 *   - GUI-OWNED DECISIONS — timelineWindow, lineFlags, rangeLabel, localInputValue,
 *     friendlyHotkey, applyDateFormat/localTime and icon() exist nowhere else. They are pure
 *     and collaborator-free (engineering.html §03's unit-test-thoroughly quadrant), and
 *     su.ts has no named exports (it is a classic-script bundle entry), so this harness —
 *     the bundle evaluated into a live `SU` — is the sanctioned way to call them.
 */
import { describe, it, expect, beforeAll } from 'vitest';
// @ts-expect-error — plain .mjs script, no types needed.
import { buildRendererBundle } from '../../../scripts/build-renderer.mjs';
import { formatDuration, formatHours } from '@stint/core';
import { deriveView } from '../src/liveview.js';
import { tagDiff } from '../src/tags.js';
import { countUpSeconds } from '../src/timerview.js';
import type { UiState } from '../src/ipc.js';

let bundleText: string;
let SU: any;

beforeAll(async () => {
  const result = await buildRendererBundle({ write: false });
  bundleText = result.outputFiles[0].text;
  // The bundle is an IIFE classic script whose only top-level effect is `window.SU = …`;
  // executing it against a bare object IS the renderer's load, minus the DOM.
  const w: any = {};
  new Function('window', bundleText)(w);
  SU = w.SU;
});

describe('GOLD: renderer bundle is core, not a dialect (issue #83)', () => {
  it('the browser bundle is node-free (db/store/backup tree-shaken out)', () => {
    // If an SU import ever drags a Node-touching core module into the bundle, the
    // `node:*` externals survive as import/require references — fail loud here.
    expect(bundleText).not.toMatch(/["']node:/);
    expect(bundleText).not.toMatch(/\brequire\(/);
  });

  it('fmtDur IS core formatDuration — signed negatives included, no renderer clamp', () => {
    for (const s of [-90061, -3661, -65, -1, 0, 1, 59, 3661, 30 * 86400]) {
      expect(SU.fmtDur(s)).toBe(formatDuration(s));
    }
    // The dialect's old divergence, pinned dead: a negative duration reads signed (`tt` parity).
    expect(SU.fmtDur(-65)).toBe('-00:01:05');
  });

  it("fmtHours IS core formatHours plus the view's 'h' suffix", () => {
    for (const s of [0, 1, 5400, 3600, 86400]) {
      expect(SU.fmtHours(s)).toBe(formatHours(s) + 'h');
    }
  });

  it('deriveView IS the liveview.ts derivation (§12 R9)', () => {
    const state = {
      days: [
        {
          entries: [
            { id: 1, description: 'alpha', clientName: 'Acme', projectName: 'Site', clientLabel: 'Acme / Site', tags: ['deep'], billable: true, billableSeconds: 3600, startUtc: '2026-06-22T09:00:00.000Z' },
            { id: 2, description: 'beta', clientName: null, projectName: null, clientLabel: null, tags: [], billable: false, billableSeconds: 1800, startUtc: '2026-06-23T09:00:00.000Z' },
          ],
        },
      ],
    } as unknown as UiState;
    for (const sel of [
      {},
      { search: 'alp' },
      { billable: 'billable' as const },
      { clientLabel: null },
      { group: 'client' as const },
    ]) {
      expect(SU.deriveView(state, sel)).toEqual(deriveView(state, sel));
    }
  });

  it('tagDiff IS the tags.ts decision (§07)', () => {
    for (const [a, b] of [
      [['a'], ['A', 'b']],
      [['deep', 'work'], ['work']],
      [[' x ', 'x'], ['y']],
      [[], []],
    ] as [string[], string[]][]) {
      expect(SU.tagDiff(a, b)).toEqual(tagDiff(a, b));
    }
  });

  it('elapsed consumes the ONE count-up rule (timerview.ts countUpSeconds)', () => {
    const start = '2026-06-22T09:00:00.000Z';
    const before = countUpSeconds(start, new Date(), 600);
    const got = SU.elapsed(start, 600);
    const after = countUpSeconds(start, new Date(), 600);
    expect(got).toBeGreaterThanOrEqual(before);
    expect(got).toBeLessThanOrEqual(after);
  });
});

// timelineWindow reads LOCAL wall-clock minutes off every instant it is given, so the
// instants below are built FROM the local wall clock each assertion talks about and the
// expected minute-of-day numbers hold in whatever timezone the test host runs (the same
// TZ-independence idiom as reportview.test.ts). 2026-06-24 is a Wednesday well clear of
// every DST transition, so each wall-clock time below exists exactly once.
const atLocal = (hour: number, minute: number): string =>
  new Date(2026, 5, 24, hour, minute).toISOString();
const NOON = atLocal(12, 0);

/**
 * §14 / G16 — the ONE default-viewport derivation both timeline surfaces consume (§12 R15's
 * inline picker, §12 R16's entries calendar). JUDGE `TIMELINE_WINDOW` proves the two happy
 * paths against the rendered Settings view; these pin the decisions a screenshot cannot
 * reach — the per-field HH:MM fallbacks, the inverted-pair reset, the around-hours guard,
 * re-centering on an edited interval, and the day-edge clamp.
 */
describe('SU.timelineWindow — the default scroll viewport, in local minutes-of-day (§14/G16)', () => {
  it('working-hours mode is the stored window, start to end', () => {
    expect(
      SU.timelineWindow(
        { workingHoursStart: '09:00', workingHoursEnd: '15:00', pickerWindowMode: 'working_hours' },
        NOON,
      ),
    ).toEqual({ startMin: 540, endMin: 900 });
  });

  it('a missing settings snapshot falls back to the documented 07:00–18:00 default', () => {
    expect(SU.timelineWindow(null, NOON)).toEqual({ startMin: 420, endMin: 1080 });
    expect(SU.timelineWindow({}, NOON)).toEqual({ startMin: 420, endMin: 1080 });
  });

  it('a malformed HH:MM falls back PER FIELD — the readable half of the pair survives', () => {
    // Strict zero-padded HH:MM only: '7:00' and '25:00' are the two shapes core rejects on
    // write, so a stale snapshot carrying one must not drag the other field to a default too.
    expect(SU.timelineWindow({ workingHoursStart: '7:00', workingHoursEnd: '15:00' }, NOON)).toEqual({
      startMin: 420, // the default start…
      endMin: 900, // …but the stored 15:00 end is kept
    });
    expect(SU.timelineWindow({ workingHoursStart: '09:00', workingHoursEnd: '25:00' }, NOON)).toEqual({
      startMin: 540,
      endMin: 1080,
    });
  });

  it('23:59 is a readable end and 24:00 is not (the HH:MM boundary)', () => {
    expect(SU.timelineWindow({ workingHoursStart: '00:00', workingHoursEnd: '23:59' }, NOON)).toEqual({
      startMin: 0,
      endMin: 1439,
    });
    expect(SU.timelineWindow({ workingHoursStart: '00:00', workingHoursEnd: '24:00' }, NOON)).toEqual({
      startMin: 0,
      endMin: 1080, // 24:00 unreadable → the default end, and 00:00 < 18:00 so it stands
    });
  });

  it('an inverted or empty pair resets BOTH edges, never just the offending one', () => {
    expect(SU.timelineWindow({ workingHoursStart: '15:00', workingHoursEnd: '09:00' }, NOON)).toEqual({
      startMin: 420,
      endMin: 1080,
    });
    expect(SU.timelineWindow({ workingHoursStart: '09:00', workingHoursEnd: '09:00' }, NOON)).toEqual({
      startMin: 420,
      endMin: 1080,
    });
  });

  it('around_now centers the window on the clock and ignores the working hours entirely', () => {
    expect(
      SU.timelineWindow(
        {
          workingHoursStart: '09:00',
          workingHoursEnd: '15:00',
          pickerWindowMode: 'around_now',
          pickerAroundHours: 8,
        },
        NOON,
      ),
    ).toEqual({ startMin: 480, endMin: 960 }); // 12:00 ± 4h, not 09:00–15:00
  });

  it('around_now honours the 1–24 integer bounds and falls back to 8h outside them', () => {
    const around = (pickerAroundHours: unknown) =>
      SU.timelineWindow({ pickerWindowMode: 'around_now', pickerAroundHours }, NOON);
    expect(around(1)).toEqual({ startMin: 690, endMin: 750 }); // 12:00 ± 30m
    expect(around(24)).toEqual({ startMin: 0, endMin: 1440 }); // the whole track
    expect(around(0)).toEqual({ startMin: 480, endMin: 960 }); // below the floor → 8h
    expect(around(25)).toEqual({ startMin: 480, endMin: 960 }); // above the ceiling → 8h
    expect(around(2.5)).toEqual({ startMin: 480, endMin: 960 }); // not an integer → 8h
    expect(around(undefined)).toEqual({ startMin: 480, endMin: 960 }); // absent → 8h
  });

  it('an around_now window near a day edge meets the edge instead of leaving the track', () => {
    expect(
      SU.timelineWindow({ pickerWindowMode: 'around_now', pickerAroundHours: 8 }, atLocal(0, 30)),
    ).toEqual({ startMin: 0, endMin: 270 }); // 00:30 − 4h would be −210
    expect(
      SU.timelineWindow({ pickerWindowMode: 'around_now', pickerAroundHours: 8 }, atLocal(23, 30)),
    ).toEqual({ startMin: 1170, endMin: 1440 }); // 23:30 + 4h would be 1650
  });

  it('an edited interval re-centers the window on itself, keeping the span the mode gave it', () => {
    // 09:00–15:00 is a 6h span; an evening interval moves it, it does not resize it.
    expect(
      SU.timelineWindow({ workingHoursStart: '09:00', workingHoursEnd: '15:00' }, NOON, {
        startUtc: atLocal(20, 0),
        endUtc: atLocal(21, 0),
      }),
    ).toEqual({ startMin: 1050, endMin: 1410 }); // 20:30 ± 3h
  });

  it('a running edited interval centers on its start (no end to average against)', () => {
    expect(
      SU.timelineWindow({ workingHoursStart: '09:00', workingHoursEnd: '15:00' }, NOON, {
        startUtc: atLocal(20, 0),
        endUtc: null,
      }),
    ).toEqual({ startMin: 1020, endMin: 1380 }); // 20:00 ± 3h
  });

  it('an edited interval re-centers the AROUND_NOW span, still clamped to the track', () => {
    expect(
      SU.timelineWindow(
        { workingHoursStart: '09:00', workingHoursEnd: '15:00', pickerWindowMode: 'around_now', pickerAroundHours: 8 },
        NOON,
        { startUtc: atLocal(2, 0), endUtc: atLocal(3, 0) },
      ),
    ).toEqual({ startMin: 0, endMin: 390 }); // 02:30 ± 4h, the low edge clamped
  });

  it('an interval object with no start is not an edited interval — the mode window stands', () => {
    expect(
      SU.timelineWindow({ workingHoursStart: '09:00', workingHoursEnd: '15:00' }, NOON, { endUtc: null }),
    ).toEqual({ startMin: 540, endMin: 900 });
  });
});

/**
 * §09 R6 — which flags a grouped report line carries. Pure set membership over the ids the
 * core Report already computed; the renderer derives no flags of its own.
 */
describe('SU.lineFlags — report flags shown in context on the affected line (§09 R6)', () => {
  it('a line with no flagged entry carries no flags', () => {
    expect(SU.lineFlags({ entryIds: [1, 2, 3] }, [4], [5])).toEqual([]);
  });

  it('one flagged entry flags the whole line it was grouped into', () => {
    expect(SU.lineFlags({ entryIds: [1, 2, 3] }, [3], [])).toEqual(['overlap']);
    expect(SU.lineFlags({ entryIds: [1, 2, 3] }, [], [1])).toEqual(['unreviewed sleep']);
  });

  it('both conditions read overlap first, then unreviewed sleep', () => {
    expect(SU.lineFlags({ entryIds: [1, 2] }, [2], [1])).toEqual(['overlap', 'unreviewed sleep']);
  });

  it('an absent id list is an empty one — a report without flag sets flags nothing', () => {
    expect(SU.lineFlags({}, [1], [1])).toEqual([]);
    expect(SU.lineFlags({ entryIds: [1] })).toEqual([]);
  });
});

/**
 * §09 R1 — the resolved-range header. The report range is half-open [from, to), so the label
 * must name the INCLUSIVE last day; showing `to` itself would advertise a day the report does
 * not cover. The expectations compose SU.localDateLabel over the last day named explicitly,
 * which states the rule independently of the `to − 1ms` arithmetic and stays correct under
 * any host locale (the label itself is locale-formatted).
 */
describe('SU.rangeLabel — the header names the inclusive last day (§09 R1)', () => {
  it('a Mon–Sun week ends on the Sunday, not the Monday after it', () => {
    expect(SU.rangeLabel('2026-06-22T00:00:00.000Z', '2026-06-29T00:00:00.000Z')).toBe(
      `${SU.localDateLabel('2026-06-22T00:00:00.000Z')} → ${SU.localDateLabel('2026-06-28T23:59:59.999Z')}`,
    );
  });

  it('a whole month ends inside that month, not on the first of the next', () => {
    expect(SU.rangeLabel('2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')).toBe(
      `${SU.localDateLabel('2026-06-01T00:00:00.000Z')} → ${SU.localDateLabel('2026-06-30T23:59:59.999Z')}`,
    );
  });

  it('a single-day range reads as that one day on both sides', () => {
    expect(SU.rangeLabel('2026-06-24T00:00:00.000Z', '2026-06-25T00:00:00.000Z')).toBe(
      `${SU.localDateLabel('2026-06-24T00:00:00.000Z')} → ${SU.localDateLabel('2026-06-24T23:59:59.999Z')}`,
    );
  });
});

/**
 * §12 R15/R17 (G1) — the ONE local-time seed format shared by the raw Start/Stop fields, the
 * split instant, and the inline picker's write-backs. Load-bearing: timerview.ts's
 * liveEditStripPatch BYTE-compares a field against its seed, and timerview.test.ts hardcodes
 * that seed as a literal — so without these assertions a format drift silently stops the byte
 * gate matching and re-emits `startUtc` on every untouched start (the issue #68 regression)
 * while timerview.test.ts stays green.
 */
describe('SU.localInputValue — the local-time seed the byte gate compares against (§12 R15)', () => {
  it('a whole-minute instant renders without seconds', () => {
    expect(SU.localInputValue(new Date(2026, 5, 24, 9, 7, 0))).toBe('2026-06-24T09:07');
    expect(SU.localInputValue(new Date(2026, 5, 24, 0, 0, 0))).toBe('2026-06-24T00:00');
  });

  it('a non-zero seconds instant keeps its seconds', () => {
    // This exact string is timerview.test.ts's SEED_START literal: if it stops matching,
    // that suite's byte-gate scenarios are testing a seed the renderer never produces.
    expect(SU.localInputValue(new Date(2026, 5, 24, 9, 7, 33))).toBe('2026-06-24T09:07:33');
  });

  it('every field is zero-padded to two digits', () => {
    expect(SU.localInputValue(new Date(2026, 0, 5, 3, 4, 5))).toBe('2026-01-05T03:04:05');
  });

  it('the seed round-trips through `new Date(value)` to the same instant, to the second', () => {
    // No timezone suffix: the string is local wall-clock, and the parse must return the very
    // instant it was rendered from — the contract the strip's reparse-on-edit path relies on.
    const stored = new Date(2026, 5, 24, 9, 7, 33);
    expect(new Date(SU.localInputValue(stored)).getTime()).toBe(stored.getTime());
  });
});

describe('SU display chrome — hotkeys, the ISO clock, and the line-icon set', () => {
  it('friendlyHotkey shows the accelerator in the words the OS uses', () => {
    expect(SU.friendlyHotkey('CommandOrControl+Shift+S')).toBe('Ctrl+Shift+S');
    expect(SU.friendlyHotkey('Command+Shift+S')).toBe('Cmd+Shift+S');
  });

  it('§12 R11 — the iso date format renders an unambiguous zero-padded 24h clock', () => {
    SU.applyDateFormat('iso');
    expect(SU.localTime(atLocal(9, 7))).toBe('09:07');
    expect(SU.localTime(atLocal(21, 0))).toBe('21:00');
    SU.applyDateFormat('system'); // display-only global; leave the default as found
  });

  it('icon() is decorative by default and labelled only when given a title', () => {
    expect(SU.icon('clock')).toBe('<svg class="ic" aria-hidden="true"><use href="#i-clock"/></svg>');
    expect(SU.icon('x', { cls: 'ic-lg', title: 'Close "now"' })).toBe(
      '<svg class="ic ic-lg" role="img" aria-label="Close &quot;now&quot;"><use href="#i-x"/></svg>',
    );
  });

  it('every id in the icon vocabulary resolves to a symbol in the sprite', () => {
    // The defect: an id added to ICON_IDS (or a renamed symbol) renders an empty box, which
    // no <use href> error surfaces. The unresolved ids are named in the failure.
    const unresolved = SU.ICON_IDS.filter((id: string) => !SU.ICON_SPRITE.includes(`id="i-${id}"`));
    expect(unresolved).toEqual([]);
  });
});
