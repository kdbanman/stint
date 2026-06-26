/**
 * Export formats (PRD §09 R6). CSV is one row per entry with the exact column
 * contract; JSON is the structured equivalent. No PDF, no Markdown.
 */
import type { EntryView } from './types.js';
import { detectOverlaps } from './report.js';

/** The exact CSV column contract (PRD §09 R6). */
export const CSV_COLUMNS = [
  'client',
  'project',
  'tags',
  'description',
  'start_utc',
  'end_utc',
  'raw_duration_s',
  'excluded_s',
  'billable',
  'overlapped',
] as const;

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Render entries as CSV. Overlap is computed across the supplied set. */
export function toCsv(entries: EntryView[], now: Date = new Date()): string {
  const overlapped = detectOverlaps(entries, now);
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const e of entries) {
    rows.push(
      [
        e.clientName ?? '',
        e.projectName ?? '',
        e.tags.join(';'),
        e.description ?? '',
        e.startUtc,
        e.endUtc ?? '',
        String(e.rawSeconds),
        String(e.excludedSeconds),
        String(e.billable),
        String(overlapped.has(e.id)),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // Trailing newline so the file ends cleanly.
  return rows.join('\n') + '\n';
}

export interface JsonEntry {
  id: number;
  client: string | null;
  project: string | null;
  tags: string[];
  description: string | null;
  start_utc: string;
  end_utc: string | null;
  raw_duration_s: number;
  excluded_s: number;
  billable: boolean;
  overlapped: boolean;
}

/** Render entries as the JSON export shape. */
export function toJsonEntries(entries: EntryView[], now: Date = new Date()): JsonEntry[] {
  const overlapped = detectOverlaps(entries, now);
  return entries.map((e) => ({
    id: e.id,
    client: e.clientName,
    project: e.projectName,
    tags: e.tags,
    description: e.description,
    start_utc: e.startUtc,
    end_utc: e.endUtc,
    raw_duration_s: e.rawSeconds,
    excluded_s: e.excludedSeconds,
    billable: e.billable,
    overlapped: overlapped.has(e.id),
  }));
}
