/**
 * GOLD — the renderer bundle guard (issue #83). `window.SU` is no longer a hand-copied
 * dialect of core: it is BUILT (scripts/build-renderer.mjs) from core + gui-main sources,
 * so the old source-text mirror regexes are replaced by BEHAVIORAL equivalence here — the
 * suite executes the exact bundle the pages load and asserts it behaves as the modules it
 * imports, and that no Node-touching core module survives into the browser bundle.
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

  it('exposes the full SU surface the classic scripts consume', () => {
    expect(Object.keys(SU).sort()).toEqual(
      [
        'ICON_IDS', 'ICON_SPRITE', 'applyDateFormat', 'deriveView', 'elapsed', 'fmtDur',
        'fmtHours', 'friendlyHotkey', 'icon', 'injectSprite', 'lineFlags', 'localDateLabel',
        'localInputValue', 'localTime', 'rangeLabel', 'tagDiff', 'timelineWindow',
      ].sort(),
    );
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
