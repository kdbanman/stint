/**
 * The pure Timer-view (G5) derivation (PRD §12 R14) — Electron-free so it is unit-testable
 * without a main process, mirroring start.ts / liveview.ts / reportview.ts. The Timer view
 * is the GUI's core-entry surface: a live count-up over the running entry, the live-edit-
 * running strip (edit the OPEN row's attributes + start time WITHOUT stopping it), the Start
 * form, and the pinned favorites rail. ALL behaviour lives in @stint/core (store.start /
 * store.edit / store.*Favorite); this module owns only the four pure projections the renderer
 * (app.js) and the IPC handlers wrap, so the count-up and the no-stop edit-patch rule are
 * proven once here rather than smeared across the page.
 */
import type { UiState, FavoriteView } from './ipc.js';
import type { EditPatch } from '@stint/core';
import { parseLocalInput } from './localtime.js';

/** start.ts's StartPayload, re-exported so the Timer view has one import for its core-entry surface. */
export type { StartPayload } from './start.js';

/** The running-state display model the Timer-view clock panel paints. */
export interface RunningModel {
  /** Whether a timer is open right now. */
  running: boolean;
  /** The open entry's id (for the live-edit patch's target); null when idle. */
  entryId: number | null;
  /**
   * The live count-up in whole seconds: now − startUtc − excludedSeconds, floored at 0.
   * Display-only (never stored, never money — GOLD/PROP own the billable math); the renderer
   * formats it HH:MM:SS and advances it per tick.
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
 * The ONE live count-up rule (§12 R2): now − startUtc − excludedSeconds in whole seconds,
 * floored at 0 (a clock that jumped backwards, or an excluded stretch longer than the raw
 * span, reads 00:00:00 — never a negative count-up). deriveRunningModel and the renderer's
 * per-tick `SU.elapsed` both consume THIS helper; neither re-derives the arithmetic.
 */
export function countUpSeconds(startUtc: string, now: Date, excludedSeconds = 0): number {
  const raw = Math.floor((now.getTime() - Date.parse(startUtc)) / 1000) - excludedSeconds;
  return Math.max(0, raw);
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
  return {
    running: true,
    entryId: e.id,
    elapsedSeconds: countUpSeconds(e.startUtc, now, excluded),
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
  return patch;
}

/**
 * The live-edit-running strip's three inline fields as the renderer reads them straight off the
 * DOM: for each field, the string/flag renderLiveEdit SEEDED and the field's CURRENT value. The
 * renderer hands over the raw strings so the seed-vs-field diff — which decides what the user
 * actually changed — lives here where GOLD pins it, not only in the untestable renderer mirror
 * (issue #68). Tags + client/project are NOT here: the strip routes those to the unified editor.
 */
export interface LiveEditStripInput {
  /** #le-desc: the seeded description string (running.description ?? '') and the field's current value. */
  seedDescription: string;
  description: string;
  /** #le-start: the seeded start string (localInputValue of the running start) and the field's current text. */
  seedStart: string;
  start: string;
  /** The running entry's stored start instant (ISO-8601 UTC) — the reparse double-guard's reference. */
  startUtc: string;
  /** #le-bill: the seeded and current billable checkbox state. */
  seedBillable: boolean;
  billable: boolean;
}

/**
 * Diff the live-edit-running strip's three inline fields against their seeds, then build the
 * minimal edit patch through liveEditPatch — the strip's converged diff (issue #68). The
 * governing rule (glossary 'Stored truth', §12 R14/R15): a field the user did NOT touch
 * contributes NO key, so a desc-only edit sends `description` and nothing else.
 *
 * The start-time gate is a BYTE-comparison of the current field string vs the seeded string —
 * NOT a reparse-and-compare — mirroring the §12 R15 editor rule (app.js seeded-string check). An
 * untouched start is byte-identical to its seed and is never even parsed. That is load-bearing on
 * a DST fall-back-ambiguous wall-clock (e.g. the second 1:30 AM in America/Chicago): reparsing the
 * untouched seed string resolves to the OTHER of the two instants and would emit a spurious startUtc
 * shifted an hour on an otherwise desc-only edit; byte-comparison skips it entirely. Only when the
 * field text genuinely differs is it parsed — through localtime.ts's `parseLocalInput`, the one
 * inverse of the format the field was seeded in, which reads either separator (issue #159) — and
 * an unparseable half-typed instant contributes nothing (the NaN guard), while a change resolving
 * to the SAME stored instant is dropped by the double-guard.
 */
export function liveEditStripPatch(input: LiveEditStripInput, timeZone?: string): EditPatch {
  const changed: LiveEditInput = {};
  // Description: normalise both sides (a blank field is a cleared label = null) and compare, so an
  // untouched field — where the seed already equals the running description — yields no key.
  const nextDesc = input.description.trim() === '' ? null : input.description;
  const seedDesc = input.seedDescription === '' ? null : input.seedDescription;
  if (nextDesc !== seedDesc) changed.description = nextDesc;
  // Start: BYTE-comparison first (the #68 fix). An untouched field is byte-identical to its seed
  // and is skipped WITHOUT parsing, so a DST-ambiguous wall-clock never reparses to the wrong
  // instant. Only a genuinely edited, parseable value resolving to a DIFFERENT stored instant rides.
  if (input.start && input.start !== input.seedStart) {
    // §04 R06: an edited wall-clock start parses in the CONFIGURED zone, the same zone the
    // seed rendered in.
    const parsed = parseLocalInput(input.start, timeZone);
    if (!isNaN(parsed.getTime())) {
      const nextIso = parsed.toISOString();
      if (nextIso !== new Date(input.startUtc).toISOString()) changed.startUtc = nextIso;
    }
  }
  if (input.billable !== input.seedBillable) changed.billable = input.billable;
  return liveEditPatch(changed);
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
