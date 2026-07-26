/**
 * The timer toggle (PRD §12 R2) — the one hotkey / popover-button action, Electron-free so
 * it is unit-testable without a host. The decision ({@link nextTimerAction}) and the write
 * that carries it out ({@link toggleTimer}) both live here, with ONE caller shape each side
 * of the seam: main.ts binds the OS-global shortcut to it, ipc-handlers.ts serves the
 * `toggle` channel (the popover's and Timer view's button) with it, and the QA driver's
 * bridge reaches it through that map. Only the wiring (shortcut registration, the key
 * actually firing) stays under MANUAL.
 *
 * The rule: a running timer stops; otherwise resume the last entry's attributes,
 * or — with no history to resume from — start a fresh empty timer.
 */
import type { EntryView, Store, WriteResult } from '@stint/core';
import type { WriteAck } from './ipc.js';

export type TimerAction = 'stop' | 'resume' | 'start';

export function nextTimerAction(hasOpenEntry: boolean, hasResumableEntry: boolean): TimerAction {
  if (hasOpenEntry) return 'stop';
  return hasResumableEntry ? 'resume' : 'start';
}

/**
 * Execute the decision against the store and repaint. Returns the underlying write's
 * warnings (a resume/start can land on an instant that overlaps another entry, PRD §06 R4)
 * so the renderer can surface them inline.
 */
export function toggleTimer(store: Store, refreshAll: () => void): WriteAck {
  const hasResumable = store.listEntries().length > 0;
  let res: WriteResult<EntryView> | null = null;
  switch (nextTimerAction(!!store.openEntry(), hasResumable)) {
    case 'stop':
      res = store.stop({});
      break;
    case 'resume':
      res = store.resume();
      break;
    case 'start':
      res = store.start({});
      break;
  }
  refreshAll();
  return { warnings: res.warnings };
}
