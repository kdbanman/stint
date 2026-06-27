/**
 * The pure destructive-action confirm decision (PRD §12 R13 / §17 R11) — extracted so
 * the rule "no destroy on a single stray click" is unit-testable without an Electron
 * host or a DOM, mirroring toggle.ts. The renderer's `confirmInline` gate (app.js) and
 * the future archive-when-referenced confirm carry out whatever this decides; that
 * wiring — the actual inline `.confirm` affordance / OS dialog, the click handlers —
 * stays under MANUAL, but the *decision* it enforces is exercised here.
 *
 * The rule: a destructive action (deleting an entry, archiving a still-referenced
 * client/project) MUST pass through an explicit confirm before it runs; a
 * non-destructive action runs straight through. `confirmGate` models the two states a
 * destructive action moves through — `requested` (armed, awaiting confirmation) and
 * `confirmed` (the explicit confirm tap) — so a caller can never invoke the underlying
 * op from the bare request: only a `confirmed` gate may proceed.
 */

/** The destructive GUI actions R11 gates. Anything not here runs without a confirm. */
export type DestructiveAction = 'delete' | 'archive-referenced';

/** Every GUI action the confirm decision is asked about (destructive or not). */
export type GuiAction = DestructiveAction | 'edit' | 'split' | 'merge' | 'subtract-sleep';

const DESTRUCTIVE = new Set<GuiAction>(['delete', 'archive-referenced']);

/**
 * Whether an action destroys data and therefore needs a confirm step. Delete (removes an
 * entry) and archive-when-referenced (hides a client/project still referenced by history)
 * are destructive; editing / splitting / merging / subtracting sleep are reversible edits
 * that act straight away.
 */
export function isDestructive(action: GuiAction): boolean {
  return DESTRUCTIVE.has(action);
}

/** The two-stage gate a destructive action moves through. */
export interface ConfirmGate {
  action: GuiAction;
  /** 'requested' = armed, awaiting the explicit confirm; 'confirmed' = the confirm tap fired. */
  stage: 'requested' | 'confirmed';
}

/**
 * Arm a destructive action: the first (stray-safe) click produces a `requested` gate,
 * which does NOT yet permit the op. A non-destructive action is returned already
 * `confirmed` — it has nothing to gate, so it proceeds immediately.
 */
export function requestAction(action: GuiAction): ConfirmGate {
  return { action, stage: isDestructive(action) ? 'requested' : 'confirmed' };
}

/** The explicit confirm tap: move an armed destructive gate to `confirmed`. */
export function confirmAction(gate: ConfirmGate): ConfirmGate {
  return { ...gate, stage: 'confirmed' };
}

/**
 * Whether the underlying destructive op may now run. True only when the gate is
 * `confirmed` — so a `requested` (single stray click) destroys nothing. This is the one
 * predicate the renderer's confirm callback mirrors: `window.stint.remove` is reachable
 * ONLY when this returns true.
 */
export function mayProceed(gate: ConfirmGate): boolean {
  return gate.stage === 'confirmed';
}
