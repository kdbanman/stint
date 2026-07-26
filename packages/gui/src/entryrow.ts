/**
 * The ONE builder for `EntryRowView` — how a core `EntryView` plus its overlap detail
 * becomes the renderer-safe row both entry-listing paths paint (issue #166).
 *
 * `ipc.ts` declares the shape's 14 fields; this declares how each is derived. Two callers
 * consume it — `uistate.ts` (the day-grouped `getState`/`search` snapshot) and
 * `ipc-handlers.ts` (the §12 R9 Entries-view `listEntries` query) — and they were built by
 * hand-written copies that had to change in lockstep: commit `4e30056` added the same four
 * lines (issue #84's `clientName`/`projectName` plus their comment) to both as identical
 * hunks, and a third copy in the QA driver missed the update silently. Engineering §02
 * abstracts on the third occurrence once lockstep is proven; it is. Adding a field is now a
 * single-site edit here, with `tsc` covering the callers.
 *
 * Design it twice: the alternative was a projection that took the whole
 * `Map<number, OverlapDetail>` and did its own lookup. Rejected — the two callers key that
 * map differently (`uistate` off the grouped entry, `listEntries` off a re-joined `byId`
 * lookup), so the map-shaped interface would have had to carry both. Taking the already-
 * resolved detail keeps the seam at one entry, one overlap.
 */
import { joinClientProject, type EntryView, type OverlapDetail } from '@stint/core';
import type { EntryRowView } from './ipc.js';

/**
 * Project one joined entry to its painted row. `overlap` is that entry's worst-neighbour
 * detail from core's `describeOverlaps` — `undefined` when the entry overlaps nothing,
 * which is exactly what makes `overlapped` false.
 */
export function toEntryRowView(entry: EntryView, overlap: OverlapDetail | undefined): EntryRowView {
  return {
    id: entry.id,
    description: entry.description,
    clientLabel: joinClientProject(entry.clientName, entry.projectName),
    // §09 R7 (issue #84): the names ride separately so the live search matches each
    // field on its own, never the joined label.
    clientName: entry.clientName,
    projectName: entry.projectName,
    startUtc: entry.startUtc,
    endUtc: entry.endUtc,
    billableSeconds: entry.billableSeconds,
    billable: entry.billable,
    overlapped: overlap !== undefined,
    // §12 R9: the detailed overlap banner reads minutes + which neighbour (previous/
    // next); rounded from the core-owned overlap seconds so it cannot drift.
    overlapMinutes: overlap ? Math.round(overlap.overlapSeconds / 60) : 0,
    overlapRelation: overlap ? overlap.relation : null,
    sleptThrough: entry.sleptThrough,
    excludedSeconds: entry.excludedSeconds,
    // §12 R9: the un-trimmed wall-clock duration, so a slept entry whose billable was
    // trimmed can paint the raw duration struck through beside the live billable one.
    rawSeconds: entry.rawSeconds,
    tags: entry.tags,
  };
}
