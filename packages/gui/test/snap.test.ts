/**
 * Unit — §12 R23's drag-snap resolution (packages/gui/src/snap.ts).
 *
 * The step every time-surface drag lands on was written twice in the renderer (app.js's week
 * grid and timepicker.js's start-only picker), and BOTH copies re-typed core's defaults as the
 * literals 5 and 15 — the issue-#168 defect class su.ts's DEFAULT_WINDOW already answers for
 * the working-hours pair. One home, read from core, asserted here.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '@stint/core';
import { snapStepMin } from '../src/snap.js';

describe('snapStepMin — the active drag-snap step (§12 R23)', () => {
  it('reads the coarse row at rest and the fine row while the ephemeral toggle is on', () => {
    const settings = { snapFineMinutes: 3, snapCoarseMinutes: 20 };
    expect(snapStepMin(settings, false)).toBe(20);
    expect(snapStepMin(settings, true)).toBe(3);
  });

  it('falls back to a default when the snapshot is stale, partial, or unreadable', () => {
    expect(snapStepMin(null, false)).toBe(DEFAULT_SETTINGS.snapCoarseMinutes);
    expect(snapStepMin({}, true)).toBe(DEFAULT_SETTINGS.snapFineMinutes);
    expect(snapStepMin({ snapCoarseMinutes: 0 }, false)).toBe(DEFAULT_SETTINGS.snapCoarseMinutes);
  });

  it("takes that fallback FROM core's row, never a re-typed literal (issue #168)", () => {
    // The defect this pins. Asserting the fallback equals 15 today cannot see it — a hardcoded
    // copy satisfies that forever. Only MOVING core's row separates the two: a derived fallback
    // follows, a re-typed one stays behind and hands the user a different grid from the one
    // `tt config set snap_coarse_minutes` reports.
    const stored = DEFAULT_SETTINGS.snapCoarseMinutes;
    DEFAULT_SETTINGS.snapCoarseMinutes = stored + 7;
    try {
      expect(snapStepMin({}, false)).toBe(stored + 7);
    } finally {
      DEFAULT_SETTINGS.snapCoarseMinutes = stored;
    }
  });
});
