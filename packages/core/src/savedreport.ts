/**
 * Saved report definitions (PRD §09 R08–R09, §13).
 *
 * A saved report is a named, persistent preset of {range-spec, group-by, filters,
 * rounding}. Its range is stored EITHER as a relative preset (re-resolved against
 * current data every time it runs) OR as an absolute UTC window — discriminated by the
 * RangeSpec union. The preset arm reuses the SAME preset enum and resolveRange that the
 * ad-hoc report path uses (see resolveSavedRange below), so a saved report and an ad-hoc
 * report can never diverge on how a range resolves. Logic lives here in @stint/core; the
 * tt CLI (`tt report save|ls|show|rm|run`) and the GUI Reports view are thin shells.
 */
import { resolveRange, type GroupBy, type BillableFilter, type ReportOptions } from './report.js';
import type { WeekStart } from './settings.js';

/** The five relative range presets a saved report may carry (same enum as resolveRange). */
export type RangePreset = 'today' | 'week' | 'last-week' | 'month' | 'last-month';

/**
 * A saved report's range: either a relative PRESET (re-resolved on each run) or an
 * ABSOLUTE UTC window (fixed bounds passed straight through). Discriminated by `kind`.
 */
export type RangeSpec =
  | { kind: 'preset'; preset: RangePreset }
  | { kind: 'absolute'; fromUtc: string; toUtc: string };

/** A persisted saved report definition (PRD §09 R08). */
export interface SavedReport {
  id: number;
  name: string;
  rangeSpec: RangeSpec;
  by: GroupBy;
  billableFilter: BillableFilter;
  /** Optional narrowing filters — undefined means "no filter on this axis". */
  clientId?: number;
  projectId?: number;
  tag?: string;
  search?: string;
  /** Display-only rounding of the grouped line (PRD §09 R04). */
  rounding: boolean;
  roundingIncrementMin: number;
  createdUtc: string;
}

/** The fields a caller supplies to create a saved report (id/createdUtc are assigned). */
export type SavedReportInput = Omit<SavedReport, 'id' | 'createdUtc'>;

/** A partial amendment to a saved report (PRD §09 R08 edit). Name is changed via rename. */
export type SavedReportPatch = Partial<Omit<SavedReport, 'id' | 'name' | 'createdUtc'>>;

/**
 * Resolve a saved report's RangeSpec to absolute UTC bounds. A preset delegates to the
 * SAME core resolveRange the ad-hoc report path uses (so the saved range and the ad-hoc
 * range can never diverge); an absolute spec passes its exact bounds through.
 */
export function resolveSavedRange(
  spec: RangeSpec,
  weekStart: WeekStart,
  now: Date = new Date(),
): { fromUtc: string; toUtc: string } {
  if (spec.kind === 'preset') return resolveRange(spec.preset, weekStart, now);
  return { fromUtc: spec.fromUtc, toUtc: spec.toUtc };
}

/**
 * The fully-resolved request a saved report becomes when it is RUN (PRD §09 R09): the
 * stored RangeSpec resolved to absolute UTC bounds, with the def's grouping / billable
 * filter / rounding / narrowing filters folded alongside. This is exactly the shape
 * store.report() consumes, so a saved report and the ad-hoc query share one code path —
 * they can never diverge on how a definition turns into totals.
 */
export interface ResolvedReportRequest extends ReportOptions {
  fromUtc: string;
  toUtc: string;
  clientId?: number;
  projectId?: number;
  tag?: string;
  search?: string;
}

/**
 * §09 R09 — turn a stored saved-report definition into the absolute, fully-resolved
 * report request RUN/EXPORT need. The RangeSpec re-resolves through resolveSavedRange (a
 * relative preset re-resolves against `now` through the SAME core resolveRange the ad-hoc
 * path uses; an absolute spec passes through unchanged); the def's by / billableFilter /
 * rounding / roundingIncrementMin and any client/project/tag/search narrowing ride along.
 * Owning this fold in one core function (rather than inline in the store) keeps the run
 * and export paths — and both surfaces — resolving a definition identically.
 */
export function resolveReportDef(
  def: SavedReport,
  weekStart: WeekStart,
  now: Date = new Date(),
): ResolvedReportRequest {
  const range = resolveSavedRange(def.rangeSpec, weekStart, now);
  const req: ResolvedReportRequest = {
    fromUtc: range.fromUtc,
    toUtc: range.toUtc,
    by: def.by,
    billableFilter: def.billableFilter,
    rounding: def.rounding,
    roundingIncrementMin: def.roundingIncrementMin,
  };
  if (def.clientId !== undefined) req.clientId = def.clientId;
  if (def.projectId !== undefined) req.projectId = def.projectId;
  if (def.tag !== undefined) req.tag = def.tag;
  if (def.search !== undefined) req.search = def.search;
  return req;
}
