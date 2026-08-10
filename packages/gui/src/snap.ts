/**
 * §12 R23 — the drag-snap resolution, in minutes: the step every time-surface drag lands on.
 *
 * GUI-only and pure, so it lives here rather than in core (§14 calls the pair "input
 * preferences, not core") and is re-exported through `renderer/su.ts` as `window.SU.snapStepMin`
 * — the one home both drag surfaces read: the Entries week grid (app.js) and the Timer view's
 * start-only picker (timepicker.js). It was written once per surface, and both copies re-typed
 * core's defaults as bare 5 / 15, so a user who moved `snap_fine_minutes` got core's number
 * from the settings path and the renderer's from every fallback — the issue-#168 defect class
 * su.ts's DEFAULT_WINDOW answers for the working-hours pair.
 */
import { DEFAULT_SETTINGS } from '@stint/core';

/** The §14 rows a drag surface reads — optional, because a stale/partial snapshot is tolerated. */
export interface SnapSettings {
  snapFineMinutes?: number;
  snapCoarseMinutes?: number;
}

/**
 * The active step: the coarse row at rest, the fine row while the ephemeral fine-snap toggle is
 * on (§12 R23 — the toggle is never persisted). Core owns and validates the stored pair (whole
 * minutes 1–30, fine ≤ coarse); the fallback here only shields a stale or partial snapshot.
 */
export function snapStepMin(settings: SnapSettings | null | undefined, fine: boolean): number {
  const s = settings || {};
  const stored = Number(fine ? s.snapFineMinutes : s.snapCoarseMinutes);
  if (stored >= 1) return stored;
  return fine ? DEFAULT_SETTINGS.snapFineMinutes : DEFAULT_SETTINGS.snapCoarseMinutes;
}
