/**
 * snake_case JSON serializers for `--json` output — the scripting contract
 * (PRD §11, validated against acceptance/schemas/*.json).
 */
import {
  toJsonEntries,
  type EntryView,
  type Report,
  type Status,
} from '@stint/core';

export function statusJson(status: Status): unknown {
  if (!status.running || !status.entry) return { running: false, entry: null };
  const e = status.entry;
  return {
    running: true,
    entry: {
      id: e.id,
      description: e.description,
      client: e.clientName,
      project: e.projectName,
      tags: e.tags,
      start_utc: e.startUtc,
      elapsed_seconds: e.billableSeconds,
      billable: e.billable,
      slept_through: e.sleptThrough,
    },
  };
}

export function entriesJson(entries: EntryView[], now: Date): unknown {
  return toJsonEntries(entries, now);
}

export function reportJson(report: Report): unknown {
  const line = (l: Report['lines'][number]): unknown => ({
    key: l.key,
    children: l.children.map(line),
    entry_ids: l.entryIds,
    total_seconds: l.totalSeconds,
    rounded_seconds: l.roundedSeconds,
  });
  return {
    lines: report.lines.map(line),
    grand_total_seconds: report.grandTotalSeconds,
    grand_rounded_seconds: report.grandRoundedSeconds,
    overlapped_entry_ids: report.overlappedEntryIds,
    unreviewed_sleep_entry_ids: report.unreviewedSleepEntryIds,
    options: {
      by: report.options.by,
      billable_filter: report.options.billableFilter,
      rounding: report.options.rounding,
      rounding_increment_min: report.options.roundingIncrementMin,
    },
    range: { from_utc: report.rangeFromUtc, to_utc: report.rangeToUtc },
  };
}
