/**
 * The pure live-view derivation (PRD §12 R9 / §17 R11) — recompute the Entries view's
 * visible list AND its report totals from the in-memory `UiState` snapshot alone, so a
 * search / filter / group selection reflects LIVE in both the list and the totals
 * without an IPC round-trip. Extracted (like toggle.ts / confirm.ts) so the derivation
 * is unit-testable without an Electron host; the renderer (app.js) mirrors it to repaint
 * `#entries` + `#week-total` on every keystroke, and the actual DOM wiring stays MANUAL.
 *
 * No new core query is needed: the snapshot's per-entry `billableSeconds` is the
 * core-owned value `tt report` already sums, so reusing it here keeps the live totals
 * equal to what the report builder would produce for the same selection. This module
 * therefore owns no money arithmetic — only filtering, grouping, and summation of the
 * already-computed seconds (GOLD/PROP/BDD own the report math itself).
 */
import type { UiState, EntryRowView } from './ipc.js';

/** The control-bar selection the live view derives against. Every field is optional. */
export interface ViewSelection {
  /** Free-text query, matched case-insensitively over description / client / tag. */
  search?: string;
  /** Exact client/project label to keep (the row's `clientLabel`); null keeps the no-client rows. */
  clientLabel?: string | null;
  /** Billable narrowing — defaults to 'all' (no narrowing). */
  billable?: 'all' | 'billable' | 'non-billable';
  /** Grouping key — defaults to 'day'. */
  group?: 'day' | 'client';
}

/** One painted group block: a key + its rows + the summed billable seconds for the group. */
export interface ViewGroup {
  key: string;
  entries: EntryRowView[];
  billableSeconds: number;
}

/** What deriveView returns — the grouped list plus the two live totals the view shows. */
export interface DerivedView {
  groups: ViewGroup[];
  /** Sum of every visible row's billable seconds — the list's at-a-glance total. */
  listTotalSeconds: number;
  /** The report total for the selection: the billable-only sum (what `tt report` shows). */
  reportTotalSeconds: number;
}

const NO_CLIENT = '(no client)';

/** Whether a row matches the free-text query (case-insensitive over description/client/tags). */
function matchesSearch(e: EntryRowView, needle: string): boolean {
  const hay = [e.description, e.clientLabel, ...(e.tags ?? [])];
  return hay.some((h) => h != null && String(h).toLowerCase().includes(needle));
}

/** Whether a row passes the billable narrowing. */
function matchesBillable(e: EntryRowView, billable: ViewSelection['billable']): boolean {
  if (billable === 'billable') return e.billable;
  if (billable === 'non-billable') return !e.billable;
  return true; // 'all' or undefined
}

/** Whether a row matches the chosen client/project label (null keeps the no-client rows). */
function matchesClient(e: EntryRowView, clientLabel: string | null | undefined): boolean {
  if (clientLabel === undefined) return true; // no client filter
  if (clientLabel === null) return e.clientLabel == null;
  return e.clientLabel === clientLabel;
}

/**
 * Derive the live view for a selection from the snapshot alone. The selection narrows the
 * snapshot's rows (search + client + billable), groups the survivors (by day or client),
 * and totals them two ways: `listTotalSeconds` is every visible row's billable seconds
 * (the list glance), `reportTotalSeconds` is the BILLABLE-ONLY sum (what `tt report`'s
 * default billable total shows). When no selection narrows anything, both totals equal
 * the snapshot's full totals — the live view and the plain load agree.
 */
export function deriveView(state: UiState, sel: ViewSelection = {}): DerivedView {
  const needle = (sel.search ?? '').trim().toLowerCase();
  const rows: EntryRowView[] = state.days
    .flatMap((d) => d.entries)
    .filter(
      (e) =>
        (needle === '' || matchesSearch(e, needle)) &&
        matchesClient(e, sel.clientLabel) &&
        matchesBillable(e, sel.billable),
    );

  const by = sel.group ?? 'day';
  const keyOf = (e: EntryRowView): string =>
    by === 'client' ? e.clientLabel ?? NO_CLIENT : e.startUtc.slice(0, 10);

  // Group preserving first-seen order; day groups read newest-first (the list default),
  // client groups read in first-seen order (mirroring the snapshot's row order).
  const order: string[] = [];
  const buckets = new Map<string, EntryRowView[]>();
  for (const e of rows) {
    const k = keyOf(e);
    if (!buckets.has(k)) {
      buckets.set(k, []);
      order.push(k);
    }
    buckets.get(k)!.push(e);
  }
  if (by === 'day') order.sort((a, b) => b.localeCompare(a)); // newest day first

  const groups: ViewGroup[] = order.map((key) => {
    const entries = buckets.get(key)!;
    return {
      key,
      entries,
      billableSeconds: entries.reduce((s, e) => s + (e.billable ? e.billableSeconds : 0), 0),
    };
  });

  const listTotalSeconds = rows.reduce((s, e) => s + e.billableSeconds, 0);
  const reportTotalSeconds = rows
    .filter((e) => e.billable)
    .reduce((s, e) => s + e.billableSeconds, 0);

  return { groups, listTotalSeconds, reportTotalSeconds };
}
