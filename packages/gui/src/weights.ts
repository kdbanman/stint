/**
 * The Clients view's weights (PRD §12 R27) — per-client/per-project summed hours and
 * per-tag entry counts, each over two windows: all-time and this month. Electron-free;
 * the `referenceWeights` IPC handler delegates here, and the GOLD suite
 * (gui/test/weights.test.ts) pins the figures to literals over a real in-memory store.
 *
 * The numbers are CORE'S sums, never a second aggregation: each window is one
 * `store.report` call — the same resolution+grouping path behind `tt report --by
 * client|tag` (§09 R02) — with billableFilter 'all' (a weight answers "which records
 * carry the hours", billable and non-billable alike — `tt report --all`'s figure) and
 * rounding off (§12 R27: a weight is reference information, exact). A client line's
 * project children and a tag line's entryIds are read off the returned Report as-is;
 * nothing is re-summed here or in the renderer.
 */
import { resolveRange, NO_CLIENT, NO_PROJECT, UNTAGGED, type Store, type ReportLine } from '@stint/core';
import type { ReferenceWeightsView, ClientWeightView, TagWeightView } from './ipc.js';

/**
 * §12 R27 — the all-time window, as report bounds. `store.report` filters on the entry's
 * `start_utc` ISO string (lexicographic), so these sentinels cover every entry the store
 * can hold: no entry predates the epoch (`tt add` backfills real work) and none starts in
 * year 9999. Spelled as constants so the GOLD suite and the handler share one meaning of
 * "all time" — the whole record, the same set no-flag `tt export` covers.
 */
export const ALL_TIME_FROM_UTC = '1970-01-01T00:00:00.000Z';
export const ALL_TIME_TO_UTC = '9999-01-01T00:00:00.000Z';

/** The fixed report options every weights window shares (see the header). */
const WEIGHT_OPTIONS = {
  billableFilter: 'all',
  rounding: false,
  roundingIncrementMin: 15,
} as const;

/**
 * Build the Clients view's weights: two `store.report` reads per grouping — all-time and
 * core's month preset ("this month" is resolveRange('month') in the configured zone; the
 * GUI never derives its own window) — merged per name. Placeholder buckets (`(no client)`,
 * `(untagged)`, `(no project)` children) are dropped: the view lists real records only,
 * and clientless/untagged time is Reports' concern, not a reference-data weight.
 */
export function buildReferenceWeights(
  store: Pick<Store, 'report' | 'settings' | 'timeZone'>,
  now: Date,
): ReferenceWeightsView {
  const month = resolveRange('month', store.settings().weekStart, now, store.timeZone());
  const windows = [
    { fromUtc: ALL_TIME_FROM_UTC, toUtc: ALL_TIME_TO_UTC },
    { fromUtc: month.fromUtc, toUtc: month.toUtc },
  ] as const;

  const [clientAll, clientMonth] = windows.map(
    (w) => store.report({ ...WEIGHT_OPTIONS, by: 'client', fromUtc: w.fromUtc, toUtc: w.toUtc }).lines,
  ) as [ReportLine[], ReportLine[]];
  const [tagAll, tagMonth] = windows.map(
    (w) => store.report({ ...WEIGHT_OPTIONS, by: 'tag', fromUtc: w.fromUtc, toUtc: w.toUtc }).lines,
  ) as [ReportLine[], ReportLine[]];

  return {
    clients: mergeClients(clientAll, clientMonth),
    tags: mergeTags(tagAll, tagMonth),
  };
}

/** Union of the two windows' client lines, each with its project children merged the same way. */
function mergeClients(all: ReportLine[], month: ReportLine[]): ClientWeightView[] {
  const monthByName = new Map(month.map((l) => [l.key, l]));
  const out: ClientWeightView[] = [];
  for (const line of all) {
    if (line.key === NO_CLIENT) continue;
    const m = monthByName.get(line.key);
    out.push({
      name: line.key,
      allTimeSeconds: line.totalSeconds,
      monthSeconds: m?.totalSeconds ?? 0,
      projects: mergeProjects(line.children, m?.children ?? []),
    });
  }
  // The all-time window is a superset of this month (every entry ever), so no client can
  // appear month-only; the union IS the all-time list.
  return out;
}

/** One client's project children, merged per project name (unique per client, §07). */
function mergeProjects(
  all: ReportLine[],
  month: ReportLine[],
): ClientWeightView['projects'] {
  const monthByName = new Map(month.map((l) => [l.key, l]));
  return all
    .filter((l) => l.key !== NO_PROJECT)
    .map((l) => ({
      name: l.key,
      allTimeSeconds: l.totalSeconds,
      monthSeconds: monthByName.get(l.key)?.totalSeconds ?? 0,
    }));
}

/** Union of the two windows' tag lines as entry counts (a tag line's entryIds ARE its entries). */
function mergeTags(all: ReportLine[], month: ReportLine[]): TagWeightView[] {
  const monthByName = new Map(month.map((l) => [l.key, l]));
  return all
    .filter((l) => l.key !== UNTAGGED)
    .map((l) => ({
      name: l.key,
      allTimeCount: l.entryIds.length,
      monthCount: monthByName.get(l.key)?.entryIds.length ?? 0,
    }));
}
