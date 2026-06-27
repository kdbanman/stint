/**
 * Domain types for Stint, in the project's ubiquitous language (see glossary.html).
 *
 * The conceptual keystone: a *running timer* is the single *entry* whose `endUtc`
 * is null. "Running" is a row state, not a separate object. Elapsed time is always
 * derived (`now - start`), never stored or incremented.
 */

/** A client — top of the hierarchy. No rate; the unit is time, not money. */
export interface Client {
  id: number;
  name: string;
  archived: boolean;
}

/** A project — an optional refinement that belongs to exactly one client. */
export interface Project {
  id: number;
  clientId: number;
  name: string;
  archived: boolean;
}

/** A flat, reusable, cross-cutting label. Created on the fly when first applied. */
export interface Tag {
  id: number;
  name: string;
  archived: boolean;
}

/** How a sleep span was discovered. */
export type SleepSource = 'event' | 'gap' | 'unknown';

/**
 * A sleep→wake cycle that occurred during a running entry. Multiple per entry.
 * Times are ISO-8601 UTC. `source = event` is authoritative (live powerMonitor);
 * `source = gap` is a wall-clock-gap suspicion recovered on launch.
 */
export interface SleepSpan {
  id: number;
  entryId: number;
  sleepUtc: string;
  wakeUtc: string;
  source: SleepSource;
}

/** The core record. `endUtc` null ⇒ running. Times stored UTC. */
export interface Entry {
  id: number;
  clientId: number | null;
  projectId: number | null;
  description: string | null;
  startUtc: string;
  endUtc: string | null;
  billable: boolean;
  excludedSeconds: number;
}

/** An entry joined with its human-readable names, tags, and derived facts. */
export interface EntryView extends Entry {
  clientName: string | null;
  projectName: string | null;
  tags: string[];
  /** Sleep spans attached to this entry. */
  sleepSpans: SleepSpan[];
  /** True when at least one sleep span is attached. */
  sleptThrough: boolean;
  /** Raw wall-clock seconds: (end ?? now) - start. */
  rawSeconds: number;
  /** Billable seconds: max(0, raw - excludedSeconds). */
  billableSeconds: number;
}

/**
 * A pinned timer template (PRD §05 R09) — a named preset of the attributes a timer
 * starts with: description, client, project, billable, and tags. A favorite is NOT a
 * timer (it has no start/end); resuming from it (§05 R10) starts a fresh entry copying
 * this template. The name is the cross-surface handle, unique case-insensitively.
 */
export interface Favorite {
  id: number;
  name: string;
  description: string | null;
  clientId: number | null;
  projectId: number | null;
  billable: boolean;
  tags: string[];
}

/**
 * The attributes a favorite captures (PRD §05 R09). The `name` is the handle; the rest is
 * the template a resume copies. When created from an entry, these are read off that entry;
 * otherwise they are supplied explicitly. `fromEntryId` selects the source entry — a numeric
 * id, or `'open'` for the currently running entry — and takes precedence over explicit attrs.
 */
export interface FavoriteTemplate {
  name: string;
  fromEntryId?: number | 'open';
  description?: string | null;
  clientId?: number | null;
  projectId?: number | null;
  billable?: boolean;
  tags?: string[];
}

/** Result of `status`. */
export interface Status {
  running: boolean;
  entry: EntryView | null;
}

/** Attributes that can be supplied when starting / adding / editing an entry. */
export interface EntryAttributes {
  description?: string | null;
  clientId?: number | null;
  projectId?: number | null;
  billable?: boolean;
  tags?: string[];
}

export interface StartOptions extends EntryAttributes {
  /** When the entry started; defaults to now. ISO-8601 UTC. */
  atUtc?: string;
}

export interface AddOptions extends EntryAttributes {
  /** Required for backfill. ISO-8601 UTC. */
  fromUtc: string;
  toUtc: string;
}

export interface EditPatch {
  description?: string | null;
  clientId?: number | null;
  projectId?: number | null;
  startUtc?: string;
  endUtc?: string | null;
  billable?: boolean;
  /** Tags to add. Created on the fly. */
  addTags?: string[];
  /** Tags to remove. */
  removeTags?: string[];
}

export interface MergeOptions {
  /** Override the winning client (default: first entry's client). */
  clientId?: number | null;
  /** Override the winning project (default: first entry's project). */
  projectId?: number | null;
  /** Override the winning billable flag (default: first entry's). */
  billable?: boolean;
}

/** A non-fatal note surfaced alongside a successful write (e.g. overlap warnings). */
export interface Warning {
  kind: 'overlap';
  message: string;
  /** Ids of the other entries this write overlaps. */
  overlapsWith: number[];
}

/** A write result that may carry warnings (overlap is warned, not blocked). */
export interface WriteResult<T> {
  value: T;
  warnings: Warning[];
}
