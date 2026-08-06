/**
 * Human-readable output helpers for tt. Monochrome, table-based, no color codes so
 * output is stable for golden comparison and pipe-friendly.
 */
import { formatDuration, joinClientProject, type EntryView, type SavedReport, type Favorite } from '@stint/core';

/** Render a left-aligned table with a 2-space gutter. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  // widths[i]: widths is headers.map, and every caller's row carries one cell per header.
  const fmt = (cells: string[]) =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i]!)).join('  ').trimEnd();
  const lines = [fmt(headers)];
  for (const r of rows) lines.push(fmt(r));
  return lines.join('\n');
}

/** A short label for an entry's client/project, e.g. "Client A / API" or "—". */
export function clientProjectLabel(e: EntryView): string {
  return joinClientProject(e.clientName, e.projectName) ?? '—';
}

/**
 * §05 R10, §11 — the human-table rendering of a (possibly multiline) description. Descriptions
 * are stored VERBATIM with their newlines intact and `--json`/CSV carry the full text (§09 R06,
 * §11); the `tt list` human table, however, is one line per entry, so it shows ONLY the first
 * line, capped at 60 characters. A trailing ellipsis (U+2026) is appended whenever content was
 * dropped — either the first line ran past 60 characters, OR the description had more than one
 * line (so the reader is signalled there is more than the single line shown). This is the sole
 * place that cap lives — the machine read-side (`--json`, CSV export) never calls it, so full
 * fidelity is preserved there. null / empty → ''. Consumed by `tt list`'s `toRow` (§11).
 */
export function descriptionCell(desc: string | null): string {
  if (!desc) return '';
  const lines = desc.split(/\r?\n/);
  const firstLine = lines[0] ?? '';
  const truncated = lines.length > 1 || firstLine.length > 60;
  return truncated ? `${firstLine.slice(0, 60)}…` : firstLine;
}

/** Flags shown against an entry in lists/reports (PRD §06, §10). */
export function entryFlags(e: EntryView, overlapped = false): string {
  const f: string[] = [];
  if (overlapped) f.push('overlap');
  if (e.sleptThrough) f.push('slept');
  return f.join(',');
}

export function statusLine(e: EntryView): string {
  const desc = e.description ? `"${e.description}"` : '(no description)';
  const where = clientProjectLabel(e);
  const tail = where === '—' ? '' : ` · ${where}`;
  return `▸ running ${formatDuration(e.billableSeconds)} · ${desc}${tail}`;
}

/** Short ISO without milliseconds for compact tables. */
export function shortUtc(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace(/\.\d{3}Z$/, 'Z');
}

/**
 * §09 R08 — a one-line rendering of a saved report's range spec, e.g. "this-week" for a
 * preset or "2026-06-01 → 2026-06-08" for an absolute window. Used by `report ls`/`show`.
 */
export function reportRangeSpecLine(def: SavedReport): string {
  if (def.rangeSpec.kind === 'preset') return def.rangeSpec.preset;
  return `${shortUtc(def.rangeSpec.fromUtc)} → ${shortUtc(def.rangeSpec.toUtc)}`;
}

/**
 * §05 R09 — one row of the `tt fav ls` human table: the favorite's name, its resolved
 * client/project label (or "—"), the billable flag, and its tags. The label is resolved by
 * the caller (the store holds the names; the Favorite carries ids), mirroring how the entry
 * list renders client/project.
 */
export function favoriteRow(fav: Favorite, clientProject: string): string[] {
  return [
    fav.name,
    clientProject,
    fav.description ?? '',
    fav.billable ? 'yes' : 'no',
    fav.tags.join(','),
  ];
}

/** §09 R08 — the multi-line human detail block for `tt report show <name>`. */
export function reportDefDetail(def: SavedReport): string {
  const filters: string[] = [];
  if (def.clientId !== undefined) filters.push(`client #${def.clientId}`);
  if (def.projectId !== undefined) filters.push(`project #${def.projectId}`);
  if (def.tag !== undefined) filters.push(`tag ${def.tag}`);
  if (def.search !== undefined) filters.push(`search "${def.search}"`);
  const rounding = def.rounding ? `nearest ${def.roundingIncrementMin}m` : 'off';
  return table(
    ['FIELD', 'VALUE'],
    [
      ['name', def.name],
      ['range', reportRangeSpecLine(def)],
      ['group by', def.by],
      ['billable', def.billableFilter],
      ['filters', filters.length ? filters.join(', ') : '—'],
      ['rounding', rounding],
    ],
  );
}
