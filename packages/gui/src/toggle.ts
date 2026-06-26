/**
 * The pure timer-toggle decision (PRD §12 R2) — the one global-hotkey / tray-click
 * action, extracted so it is unit-testable without an Electron host. The main
 * process binds the OS-global shortcut and the tray click to {@link toggleTimer},
 * which executes whatever this function decides; that wiring (shortcut
 * registration, the click handler firing) is what stays under MANUAL, but the
 * *decision* it carries out is exercised here and in core.
 *
 * The rule: a running timer stops; otherwise resume the last entry's attributes,
 * or — with no history to resume from — start a fresh empty timer.
 */
export type TimerAction = 'stop' | 'resume' | 'start';

export function nextTimerAction(hasOpenEntry: boolean, hasResumableEntry: boolean): TimerAction {
  if (hasOpenEntry) return 'stop';
  return hasResumableEntry ? 'resume' : 'start';
}
