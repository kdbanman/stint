/**
 * The GUI's one attributed-start rule (PRD §05 R1, §12 R1) — Electron-free so it is
 * unit-testable without a main process. Mirrors the tt CLI's resolveAttributes
 * (packages/cli/src/program.ts): name resolution (create-on-demand, project⇒client)
 * lives in core, so both surfaces resolve the same way and neither drops attributes.
 *
 * main.ts's `start` IPC handler delegates here; the renderer's Start form is the only
 * caller that supplies attributes. The tray/hotkey quick-start stays parameterless.
 */
import type { Store, EntryView, WriteResult } from '@stint/core';

/** What the renderer's Start form sends over the `start` IPC channel. */
export interface StartPayload {
  description?: string | null;
  client?: string;
  project?: string;
  tags?: string[];
  billable?: boolean;
  /** ISO-8601 UTC start instant; defaults to now when omitted. */
  atUtc?: string;
}

/**
 * Start a new entry carrying the form's attributes. Resolves client/project names
 * through core (one rule per surface), then opens the entry — atomically stopping any
 * open one, so the ≤1-open invariant holds (PRD §03).
 */
export function startWithAttributes(store: Store, p: StartPayload): WriteResult<EntryView> {
  const { clientId, projectId } = store.resolveClientProjectByName({
    client: p.client,
    project: p.project,
  });
  return store.start({
    description: p.description ?? null,
    clientId,
    projectId,
    tags: p.tags ?? [],
    // Tri-state billable: only forward it when the form set it, so an omitted value
    // falls through to core's default (billable iff a client is present).
    ...(p.billable !== undefined ? { billable: p.billable } : {}),
    ...(p.atUtc ? { atUtc: p.atUtc } : {}),
  });
}
