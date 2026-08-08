/**
 * The GUI report/export plumbing (PRD §09, §12 R8) — Electron-free so it is unit-testable
 * without a main process, mirroring uistate.ts/start.ts. The report builder view itself
 * paints the core `Report` (the `report` IPC returns it verbatim, parity with `tt report`);
 * this module owns the pure pieces the export path and the on-screen summary need.
 *
 * §09 R06/R09 — export has TWO honest scopes (resolveExportDefinition owns the split):
 * the FILTERED rows a saved report shows (byte-identical to `tt report run <name>
 * --csv|--json`) and ALL DATA — the raw entries for the resolved range (byte-identical to
 * `tt export`). The report's filters shape the filtered file; the all-data file is the raw
 * escape hatch. Both render through the SAME core exporters, so the MANUAL byte-diff holds.
 */
import { resolveRange, resolveDateRange, utcWindowToDatePair, toCsv, toJsonEntries } from '@stint/core';
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

// ----------------------------------------------- plain-date custom ranges (§09 R01 / G3)
//
// The plain-date → half-open-window rule (resolveDateRange) and its inverse
// (utcWindowToDatePair) live in core, next to the resolveRange presets that share their
// inclusive-end-day convention (issue #83 — GUI range resolution gets a core home). Every
// caller imports them straight from there; this module only consumes them below.

/** What the renderer's Export buttons send over the `exportEntries` IPC channel. */
export interface ExportRequest {
  format: 'csv' | 'json';
  /**
   * §09 R06/R09 — which set of entries to export:
   *   - 'filtered' — the FILTERED rows the report SHOWS (its range narrowed by the def's
   *     client/project/tag/search + billable filter), byte-identical to `tt report run
   *     <name> --csv|--json`. Requires `savedReportRef` (a filtered export belongs to a report).
   *   - 'all' — ALL DATA: the RAW entries for the resolved range (billable='all', no
   *     narrowing), byte-identical to `tt export`. This is the durability / data-out escape
   *     hatch; the report's filters do NOT shape the file.
   */
  scope: 'filtered' | 'all';
  /**
   * §09 R09 — the saved definition's name (or id). For scope 'filtered' it names the report
   * whose rows are exported; for scope 'all' its resolved range bounds the raw export. It takes
   * precedence over preset/from/to (those describe an ad-hoc range; a saved ref carries its own).
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
  timeZone?: string,
): { fromUtc: string; toUtc: string } {
  if (req.preset) return resolveRange(req.preset, weekStart, now, timeZone);
  if (req.fromUtc && req.toUtc) return { fromUtc: req.fromUtc, toUtc: req.toUtc };
  return resolveRange('week', weekStart, now, timeZone);
}

/**
 * Build the report the GUI paints. A thin pass-through to store.report that resolves a
 * preset into absolute bounds first (so the renderer stays thin and never re-derives date
 * math), keeping the returned shape the core `Report` the report view already paints.
 */
export function buildReportView(
  store: Pick<Store, 'report' | 'settings' | 'timeZone'>,
  req: ReportViewRequest,
  now: Date,
): Report {
  const { preset, fromUtc, toUtc, ...rest } = req;
  // A preset, when supplied, resolves through core (the renderer never re-derives date
  // math) in the configured zone (§04 R06/§14); otherwise the explicit custom from/to is
  // passed straight through.
  const range = preset
    ? resolveRange(preset, store.settings().weekStart, now, store.timeZone())
    : { fromUtc: fromUtc!, toUtc: toUtc! };
  return store.report({ ...rest, fromUtc: range.fromUtc, toUtc: range.toUtc });
}

/**
 * §09 R06/R09 — resolve an export request to its absolute range AND the entries it covers,
 * honouring the request's SCOPE so the two honest export meanings live in one place:
 *
 *   - scope 'filtered' (a saved report's own Export): the FILTERED rows the report shows —
 *     store.reportFilteredEntries resolves the def and applies its client/project/tag/search +
 *     billable filter, so the file holds exactly what the run-output paints. Byte-identical to
 *     `tt report run <name> --csv|--json`. The range (used only to name the file) is the def's
 *     resolved window.
 *   - scope 'all' (the "Export All Data" escape hatch): the RAW set for the resolved window
 *     (billable='all', NO narrowing), exactly `tt export`. The window comes from the saved def
 *     (if a ref is given) or the ad-hoc preset/custom range — so an all-data export and
 *     `tt export --range <from> <to>` produce byte-identical files.
 *
 * Pure (Electron-free): main.ts just renders + writes the result.
 */
export function resolveExportDefinition(
  req: ExportRequest,
  store: Pick<
    Store,
    'runReport' | 'reportFilteredEntries' | 'resolveReportRange' | 'listEntries' | 'settings' | 'timeZone'
  >,
  now: Date,
): { range: { fromUtc: string; toUtc: string }; entries: EntryView[] } {
  if (req.scope === 'filtered') {
    if (req.savedReportRef === undefined) {
      throw new Error('a filtered export requires a saved report reference');
    }
    // The rows the report SHOWS — the one core filtered-entries path both surfaces share.
    const range = store.resolveReportRange(req.savedReportRef, now);
    return { range, entries: store.reportFilteredEntries(req.savedReportRef, now) };
  }
  // scope 'all': the RAW entries for the resolved window (billable='all', no narrowing).
  const range =
    req.savedReportRef !== undefined
      ? store.resolveReportRange(req.savedReportRef, now)
      : resolveExportRange(req, store.settings().weekStart, now, store.timeZone());
  const entries = store.listEntries({ fromUtc: range.fromUtc, toUtc: range.toUtc, billable: 'all' });
  return { range, entries };
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
// View shapes (no core import in the page). The preset arm mirrors field-for-field; the
// absolute arm converts between core's UTC instants and the renderer's PLAIN DATE pair
// (§09 R01 / G3) via resolveDateRange / utcWindowToDatePair, so the date math lives here
// (once), never in the page.

/** Core RangeSpec → renderer-safe range view (absolute window → its covering date pair). */
function rangeSpecToView(spec: RangeSpec, timeZone?: string): SavedReportRangeView {
  if (spec.kind === 'preset') return { kind: 'preset', preset: spec.preset };
  const { fromDate, toDate } = utcWindowToDatePair(spec.fromUtc, spec.toUtc, timeZone);
  return { kind: 'absolute', fromDate, toDate };
}

/** Renderer-safe range view → core RangeSpec (date pair → the configured zone's half-open window). */
function rangeSpecFromView(spec: SavedReportRangeView, timeZone?: string): RangeSpec {
  if (spec.kind === 'preset') return { kind: 'preset', preset: spec.preset };
  const { fromUtc, toUtc: toUtcBound } = resolveDateRange(spec.fromDate, spec.toDate, timeZone);
  return { kind: 'absolute', fromUtc, toUtc: toUtcBound };
}

/** §09 R08 — a core saved report → the renderer-safe projection the Reports view paints. */
export function savedReportToView(def: SavedReport, timeZone?: string): SavedReportView {
  const out: SavedReportView = {
    id: def.id,
    name: def.name,
    rangeSpec: rangeSpecToView(def.rangeSpec, timeZone),
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
export function savedReportInputFromView(
  v: SavedReportInputView,
  timeZone?: string,
): SavedReportInput {
  const out: SavedReportInput = {
    name: v.name,
    rangeSpec: rangeSpecFromView(v.rangeSpec, timeZone),
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
export function savedReportPatchFromView(
  v: Partial<SavedReportInputView>,
  timeZone?: string,
): SavedReportPatch {
  const out: SavedReportPatch = {};
  if (v.rangeSpec !== undefined) out.rangeSpec = rangeSpecFromView(v.rangeSpec, timeZone);
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
