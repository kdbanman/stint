/**
 * Human-readable output helpers for tt. Monochrome, table-based, no color codes so
 * output is stable for golden comparison and pipe-friendly.
 */
import { formatDuration, type EntryView } from '@stint/core';

/** Render a left-aligned table with a 2-space gutter. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const fmt = (cells: string[]) =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i]!)).join('  ').trimEnd();
  const lines = [fmt(headers)];
  for (const r of rows) lines.push(fmt(r));
  return lines.join('\n');
}

/** A short label for an entry's client/project, e.g. "Client A / API" or "—". */
export function clientProjectLabel(e: EntryView): string {
  if (e.clientName && e.projectName) return `${e.clientName} / ${e.projectName}`;
  if (e.clientName) return e.clientName;
  if (e.projectName) return e.projectName;
  return '—';
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
