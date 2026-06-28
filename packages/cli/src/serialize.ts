/**
 * snake_case JSON serializers for `--json` output — the scripting contract
 * (PRD §11, validated against acceptance/criteria/schemas/*.json).
 */
import { type Report, type Status, type SavedReport, type Favorite, type BackupInfo } from '@stint/core';

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

/**
 * §09 R08 — the snake_case scripting shape of a saved report definition, validated
 * against acceptance/criteria/schemas/report-def.schema.json. The range is rendered as a
 * discriminated object (range_kind preset|absolute) so the relative/absolute distinction
 * survives the JSON round-trip, exactly as it is stored.
 */
export function reportDefJson(def: SavedReport): unknown {
  return {
    id: def.id,
    name: def.name,
    range_kind: def.rangeSpec.kind,
    range_preset: def.rangeSpec.kind === 'preset' ? def.rangeSpec.preset : null,
    range_from_utc: def.rangeSpec.kind === 'absolute' ? def.rangeSpec.fromUtc : null,
    range_to_utc: def.rangeSpec.kind === 'absolute' ? def.rangeSpec.toUtc : null,
    group_by: def.by,
    billable_filter: def.billableFilter,
    client_id: def.clientId ?? null,
    project_id: def.projectId ?? null,
    tag: def.tag ?? null,
    search: def.search ?? null,
    rounding: def.rounding,
    rounding_increment_min: def.roundingIncrementMin,
    created_utc: def.createdUtc,
  };
}

/** §09 R08 — a list of saved report definitions (report-def-list.schema.json). */
export function reportDefListJson(defs: SavedReport[]): unknown {
  return defs.map(reportDefJson);
}

/**
 * §05 R09 — the snake_case scripting shape of a favorite (a pinned timer template),
 * validated against acceptance/criteria/schemas/favorite.schema.json. Mirrors the entry/report
 * scripting shapes: ids as `client_id`/`project_id` (null when unset), tags as a string array.
 */
export function favoriteJson(fav: Favorite): unknown {
  return {
    id: fav.id,
    name: fav.name,
    description: fav.description,
    client_id: fav.clientId,
    project_id: fav.projectId,
    billable: fav.billable,
    tags: fav.tags,
  };
}

/** §05 R09 — a list of favorites (the `tt fav ls --json` array). */
export function favoriteListJson(favs: Favorite[]): unknown {
  return favs.map(favoriteJson);
}

/**
 * §20 R04 / §17 R12 — the snake_case scripting shape of an automatic backup, validated against
 * acceptance/criteria/schemas/backup.schema.json. `tt backup ls --json` emits an array of these (the tt
 * mirror of the GUI Settings → Backups list): the file name (the restore handle), its absolute
 * path, the UTC instant it was taken, and its size in bytes.
 */
export function backupJson(b: BackupInfo): unknown {
  return {
    name: b.name,
    path: b.path,
    created_utc: b.createdUtc,
    size_bytes: b.sizeBytes,
  };
}

/** §20 R04 — a list of backups (the `tt backup ls --json` array, newest-first). */
export function backupListJson(backups: BackupInfo[]): unknown {
  return backups.map(backupJson);
}
