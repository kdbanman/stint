/**
 * The GUI report/export plumbing (PRD §09, §12 R8) — Electron-free so it is unit-testable
 * without a main process, mirroring uistate.ts/start.ts. The report builder view itself
 * paints the core `Report` (the `report` IPC returns it verbatim, parity with `tt report`);
 * this module owns the two pure pieces the export path and the on-screen summary need:
 *
 *   1. resolveExportRange — turn a preset name (resolved through core's resolveRange) OR an
 *      explicit custom from/to into the absolute UTC bounds `tt export` uses. The renderer
 *      never re-derives date math; the preset rule lives once in core.
 *   2. exportPayload — render the range's raw entries to the CSV / JSON byte string `tt
 *      export --csv/--json` produces, so the GUI export writes bytes that match the CLI.
 *
 * Export mirrors `tt export` exactly (raw entries for a range, billable='all', no
 * client/project/tag narrowing) so the MANUAL byte-for-byte parity check holds — the
 * report view's filters shape the on-screen summary, not the exported file.
 */
import { resolveRange, toCsv, toJsonEntries } from '@stint/core';
import type {
  Store,
  EntryView,
  Report,
  WeekStart,
  SavedReport,
  SavedReportInput,
  SavedReportPatch,
  RangeSpec,
} from '@stint/core';
import type { SavedReportView, SavedReportInputView, SavedReportRangeView } from './ipc.js';

export type RangePreset = 'today' | 'week' | 'last-week' | 'month' | 'last-month';

/** What the renderer's Export buttons send over the `exportEntries` IPC channel. */
export interface ExportRequest {
  format: 'csv' | 'json';
  /**
   * §09 R09 — export from a SAVED report: the saved definition's name (or id). When present,
   * main resolves the def's range and exports its raw entries (preset/custom resolved in
   * core), so the bytes match `tt report run <name> --csv|--json`. It takes precedence over
   * preset/from/to (those describe an ad-hoc range; a saved ref carries its own range).
   */
  savedReportRef?: string | number;
  /** A named preset resolved through core; takes precedence over from/to when present. */
  preset?: RangePreset;
  /** An explicit custom range (used only when no preset is supplied). */
  fromUtc?: string;
  toUtc?: string;
}

/**
 * What the `report` IPC handler accepts: a core ReportRequest whose absolute from/to are
 * OPTIONAL because a preset (resolved through core's resolveRange) can supply them instead.
 * Exactly one of {preset} or {fromUtc,toUtc} is meaningful — buildReportView prefers preset.
 */
export type ReportViewRequest = Omit<Parameters<Store['report']>[0], 'fromUtc' | 'toUtc'> & {
  preset?: RangePreset;
  fromUtc?: string;
  toUtc?: string;
};

/**
 * Resolve a preset OR explicit custom from/to into absolute UTC bounds. A preset, when
 * supplied, takes precedence and is resolved through core's resolveRange (the single home
 * for the preset rule — exactly as `tt report --week/...` / `tt export --week/...` use it);
 * otherwise the explicit from/to is passed straight through. With neither, it defaults to
 * This week (the at-a-glance figure), mirroring `tt export`'s default.
 */
export function resolveExportRange(
  req: { preset?: RangePreset; fromUtc?: string; toUtc?: string },
  weekStart: WeekStart,
  now: Date,
): { fromUtc: string; toUtc: string } {
  if (req.preset) return resolveRange(req.preset, weekStart, now);
  if (req.fromUtc && req.toUtc) return { fromUtc: req.fromUtc, toUtc: req.toUtc };
  return resolveRange('week', weekStart, now);
}

/**
 * Build the report the GUI paints. A thin pass-through to store.report that resolves a
 * preset into absolute bounds first (so the renderer stays thin and never re-derives date
 * math), keeping the returned shape the core `Report` the report view already paints.
 */
export function buildReportView(
  store: Pick<Store, 'report' | 'settings'>,
  req: ReportViewRequest,
  now: Date,
): Report {
  const { preset, fromUtc, toUtc, ...rest } = req;
  // A preset, when supplied, resolves through core (the renderer never re-derives date
  // math); otherwise the explicit custom from/to is passed straight through.
  const range = preset
    ? resolveRange(preset, store.settings().weekStart, now)
    : { fromUtc: fromUtc!, toUtc: toUtc! };
  return store.report({ ...rest, fromUtc: range.fromUtc, toUtc: range.toUtc });
}

/**
 * §09 R09 — run a SAVED report and return the core Report the Reports view's run-output
 * panel paints. A thin pass-through to store.runReport (which resolves the stored RangeSpec
 * through core's resolveReportDef and reuses the one report() path), so the renderer never
 * re-derives a range, grouping, rounding, or totals — it paints the same Report shape the
 * ad-hoc `report` channel returns. `ref` is the saved definition's name or id.
 */
export function buildSavedReportView(
  store: Pick<Store, 'runReport'>,
  ref: string | number,
  now: Date,
): Report {
  return store.runReport(ref, now);
}

/**
 * The export file's bytes for a resolved range. Raw entries (billable='all', no filter),
 * rendered to CSV or the JSON-entries shape — byte-identical to `tt export --csv/--json`
 * for the same range, with a trailing newline so the file ends cleanly.
 */
export function exportPayload(entries: EntryView[], format: 'csv' | 'json', now: Date): string {
  if (format === 'json') {
    const json = JSON.stringify(toJsonEntries(entries, now), null, 2);
    return json.endsWith('\n') ? json : json + '\n';
  }
  const csv = toCsv(entries, now);
  return csv.endsWith('\n') ? csv : csv + '\n';
}

/** A default file name for the save dialog, e.g. `stint-export-2026-06-22.csv`. */
export function exportFileName(fromUtc: string, format: 'csv' | 'json'): string {
  const day = fromUtc.slice(0, 10);
  return `stint-export-${day}.${format}`;
}

// ----------------------------------------------- saved reports (§09 R08–R09)
// Pure, Electron-free conversions between core's SavedReport types and the renderer-safe
// View shapes (no core import in the page). The two shapes mirror each other field-for-
// field, so these are faithful pass-throughs the main-process IPC handlers wrap.

/** Core RangeSpec → renderer-safe range view. */
function rangeSpecToView(spec: RangeSpec): SavedReportRangeView {
  return spec.kind === 'preset'
    ? { kind: 'preset', preset: spec.preset }
    : { kind: 'absolute', fromUtc: spec.fromUtc, toUtc: spec.toUtc };
}

/** Renderer-safe range view → core RangeSpec. */
function rangeSpecFromView(spec: SavedReportRangeView): RangeSpec {
  return spec.kind === 'preset'
    ? { kind: 'preset', preset: spec.preset }
    : { kind: 'absolute', fromUtc: spec.fromUtc, toUtc: spec.toUtc };
}

/** §09 R08 — a core saved report → the renderer-safe projection the Reports view paints. */
export function savedReportToView(def: SavedReport): SavedReportView {
  const out: SavedReportView = {
    id: def.id,
    name: def.name,
    rangeSpec: rangeSpecToView(def.rangeSpec),
    by: def.by,
    billableFilter: def.billableFilter,
    rounding: def.rounding,
    roundingIncrementMin: def.roundingIncrementMin,
    createdUtc: def.createdUtc,
  };
  if (def.clientId !== undefined) out.clientId = def.clientId;
  if (def.projectId !== undefined) out.projectId = def.projectId;
  if (def.tag !== undefined) out.tag = def.tag;
  if (def.search !== undefined) out.search = def.search;
  return out;
}

/** §09 R08 — the Reports view's create payload → core SavedReportInput. */
export function savedReportInputFromView(v: SavedReportInputView): SavedReportInput {
  const out: SavedReportInput = {
    name: v.name,
    rangeSpec: rangeSpecFromView(v.rangeSpec),
    by: v.by,
    billableFilter: v.billableFilter,
    rounding: v.rounding,
    roundingIncrementMin: v.roundingIncrementMin,
  };
  if (v.clientId !== undefined) out.clientId = v.clientId;
  if (v.projectId !== undefined) out.projectId = v.projectId;
  if (v.tag !== undefined) out.tag = v.tag;
  if (v.search !== undefined) out.search = v.search;
  return out;
}

/** §09 R08 — the Reports view's amend payload → core SavedReportPatch. */
export function savedReportPatchFromView(v: Partial<SavedReportInputView>): SavedReportPatch {
  const out: SavedReportPatch = {};
  if (v.rangeSpec !== undefined) out.rangeSpec = rangeSpecFromView(v.rangeSpec);
  if (v.by !== undefined) out.by = v.by;
  if (v.billableFilter !== undefined) out.billableFilter = v.billableFilter;
  if (v.clientId !== undefined) out.clientId = v.clientId;
  if (v.projectId !== undefined) out.projectId = v.projectId;
  if (v.tag !== undefined) out.tag = v.tag;
  if (v.search !== undefined) out.search = v.search;
  if (v.rounding !== undefined) out.rounding = v.rounding;
  if (v.roundingIncrementMin !== undefined) out.roundingIncrementMin = v.roundingIncrementMin;
  return out;
}
