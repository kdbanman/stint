/**
 * The pure Timer-view (G5) derivation (PRD §12 R14) — Electron-free so it is unit-testable
 * without a main process, mirroring start.ts / liveview.ts / reportview.ts. The Timer view
 * is the GUI's core-entry surface: a live count-up over the running entry, the live-edit-
 * running strip (edit the OPEN row's attributes + start time WITHOUT stopping it), the Start
 * form, and the pinned favorites rail. ALL behaviour lives in @stint/core (store.start /
 * store.edit / store.*Favorite); this module owns only the four pure projections the renderer
 * (app.js) and the IPC handlers wrap, so the count-up and the no-stop edit-patch rule are
 * proven once here rather than smeared across the page:
 *
 *   1. deriveRunningModel — the running-state display model (live count-up seconds, state,
 *      description + client/project label, tags) from a UiState snapshot. Display-only: the
 *      count-up is now − startUtc − excludedSeconds, never stored, never money (GOLD/PROP own
 *      the billable math). It reads the SAME startUtc core opened the row at.
 *   2. liveEditPatch — the live-edit-running patch the existing `edit` IPC carries. It builds
 *      ONLY the changed fields and, crucially, NEVER an endUtc: editing the open entry must not
 *      close it (PRD §05 R6), so a startUtc / attribute change keeps the row open and the timer
 *      running. The endUtc field is structurally absent from the returned patch.
 *   3. favoriteRows — project FavoriteView[] into the rail's row models (name + a one-line
 *      client/project/billable meta + the resume handle = the favorite's name), so the rail and
 *      `tt fav ls` show the same template set.
 *   4. (the Start payload is start.ts's StartPayload, re-exported so the Timer view has one
 *      import for its core-entry surface.)
 */
import type { UiState, FavoriteView } from './ipc.js';
import type { EditPatch } from '@stint/core';
export type { StartPayload } from './start.js';

/** The running-state display model the Timer-view clock panel paints. */
export interface RunningModel {
  /** Whether a timer is open right now. */
  running: boolean;
  /** The open entry's id (for the live-edit patch's target); null when idle. */
  entryId: number | null;
  /**
   * The live count-up in whole seconds: now − startUtc − excludedSeconds, floored at 0.
   * Display-only (never stored); the renderer formats it HH:MM:SS and advances it per tick.
   * 0 when idle.
   */
  elapsedSeconds: number;
  /** The running entry's description, or null when idle / unlabelled. */
  description: string | null;
  /** The joined "Client / Project" label, or null when idle / no client. */
  clientProjectLabel: string | null;
  /** Whether the running entry is billable (the strip's Billable toggle reflects this). */
  billable: boolean;
  /** The running entry's tags (chips), [] when idle. */
  tags: string[];
  /** The open entry's start instant (ISO-8601 UTC) — the live-edit Start-time field's value; null when idle. */
  startUtc: string | null;
}

/**
 * Derive the running-state display model from the snapshot alone (no IPC). The count-up is
 * the live now − startUtc − excludedSeconds; `now` is injected so the JUDGE harness can pin
 * it (and the unit test asserts a deterministic value). When nothing runs, the model reads an
 * idle face (0 elapsed, no description/label/tags) the clock panel paints as 00:00:00 / idle.
 */
export function deriveRunningModel(state: UiState, now: Date): RunningModel {
  const e = state.status.running ? state.status.entry : null;
  if (!e) {
    return {
      running: false,
      entryId: null,
      elapsedSeconds: 0,
      description: null,
      clientProjectLabel: null,
      billable: false,
      tags: [],
      startUtc: null,
    };
  }
  // excludedSeconds is optional on the status entry (a slept stretch trimmed from the open
  // row); default 0 so a snapshot without it still counts up from the raw start.
  const excluded = (e as { excludedSeconds?: number }).excludedSeconds ?? 0;
  const raw = Math.floor((now.getTime() - Date.parse(e.startUtc)) / 1000) - excluded;
  return {
    running: true,
    entryId: e.id,
    elapsedSeconds: Math.max(0, raw),
    description: e.description,
    clientProjectLabel: e.clientLabel,
    billable: e.billable,
    tags: e.tags ?? [],
    startUtc: e.startUtc,
  };
}

/** The live-edit-running strip's changed fields (a renderer-resolvable subset of EditPatch). */
export interface LiveEditInput {
  /** New description (null clears it); omit to leave unchanged. */
  description?: string | null;
  /** New start instant (ISO-8601 UTC); omit to leave unchanged. */
  startUtc?: string;
  /** New billable flag; omit to leave unchanged. */
  billable?: boolean;
  /** Tags to add / remove (the strip's tag delta); omit either to leave it alone. */
  addTags?: string[];
  removeTags?: string[];
  /** New client/project ids (resolved by the renderer's pickers); omit to leave unchanged. */
  clientId?: number | null;
  projectId?: number | null;
}

/**
 * Build the live-edit-running patch for the existing `edit` IPC. It forwards ONLY the fields
 * the strip actually changed (so an untouched field is never sent), and — the load-bearing
 * invariant of §12 R14 — it NEVER carries an endUtc: editing the open entry must keep it open
 * (PRD §05 R6), so the timer keeps running through a start-time / attribute change. `endUtc` is
 * not a parameter of LiveEditInput and is never written onto the returned patch, so the open
 * row cannot be closed through this surface even by accident. (The fuller close/reopen edit is
 * the §05 R6 editor modal, which omits End on the open entry for the same reason.)
 */
export function liveEditPatch(input: LiveEditInput): EditPatch {
  const patch: EditPatch = {};
  if (input.description !== undefined) patch.description = input.description;
  if (input.startUtc !== undefined) patch.startUtc = input.startUtc;
  if (input.billable !== undefined) patch.billable = input.billable;
  if (input.clientId !== undefined) patch.clientId = input.clientId;
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (input.addTags && input.addTags.length) patch.addTags = input.addTags;
  if (input.removeTags && input.removeTags.length) patch.removeTags = input.removeTags;
  // Intentionally NO endUtc — see the doc comment. The open row stays open.
  return patch;
}

/** One favorites-rail row: the name, a one-line meta, and the resume handle (= the name). */
export interface FavoriteRow {
  id: number;
  name: string;
  /** A compact "Client / Project · billable" meta line; '' when the template has no attributes. */
  meta: string;
  /** Whether the template is billable (the meta's billable/non-billable word reads from this). */
  billable: boolean;
  /** The handle a one-click Resume sends over startFavorite ({ name }). Parity with `tt fav start <name>`. */
  resumeName: string;
}

/**
 * Project the renderer-safe FavoriteView[] into the rail's row models. The meta line joins the
 * favorite's stored attributes — a client/project label (resolved server-side; the view carries
 * ids, so the renderer pairs this with its client/project lookup for the human label) and the
 * billable word — exactly the template a resume copies, so the rail and `tt fav ls` read the
 * same set. `labelFor` resolves a (clientId, projectId) pair to a human label (the renderer's
 * own client/project map); a favorite with no client yields just the billable word.
 */
export function favoriteRows(
  favs: FavoriteView[],
  labelFor: (clientId: number | null, projectId: number | null) => string | null,
): FavoriteRow[] {
  return favs.map((f) => {
    const label = labelFor(f.clientId, f.projectId);
    const bill = f.billable ? 'billable' : 'non-billable';
    const meta = label ? `${label} · ${bill}` : bill;
    return { id: f.id, name: f.name, meta, billable: f.billable, resumeName: f.name };
  });
}
