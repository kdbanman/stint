/**
 * The GUI's per-notification check-in interval picker (PRD §10b R4) — Electron-free.
 *
 * This is the pure selection logic the main process wires into a real OS Notification,
 * kept in its own module (like `toggle.ts` / `start.ts`) so it is unit-testable without
 * the Electron runtime. The end-to-end OS-notification firing is covered by MANUAL.
 */

/** A notification action button — structurally `Electron.NotificationAction`. */
export interface NotificationAction {
  type: 'button';
  text: string;
}

/**
 * What a chosen notification action index means (PRD §10b R4):
 * - 'stop'        — close the timer now.
 * - 'keepDefault' — keep running on the configured default cadence (no override).
 * - a number      — minutes until the NEXT check-in only (a per-notification override).
 */
export type CheckinChoice = 'stop' | 'keepDefault' | number;

/** The inline interval choices (minutes) offered as the per-notification "dropdown". */
export const CHECKIN_INTERVAL_CHOICES: readonly number[] = [15, 30, 60, 120];

/**
 * Build the notification's action buttons and the map from a chosen action index back to
 * a CheckinChoice (PRD §10b R4).
 *
 * An OS-native Notification cannot host a real <select>, so the canonical Electron
 * representation of the "inline interval dropdown" is a fixed set of labelled action
 * buttons: index 0 = Stop, index 1 = Keep going (default cadence, no override), then one
 * button per interval choice ('+15m', '+30m', …). Picking an interval button reschedules
 * ONLY the next check-in to that many minutes out — it does not stop the timer and does
 * not change the persisted `checkin_interval_min` default. The layout is fixed.
 */
export function checkinActions(): {
  actions: NotificationAction[];
  intervalForIndex: (i: number) => CheckinChoice;
} {
  const actions: NotificationAction[] = [
    { type: 'button', text: 'Stop' },
    { type: 'button', text: 'Keep going' },
    ...CHECKIN_INTERVAL_CHOICES.map((m) => ({ type: 'button' as const, text: `+${m}m` })),
  ];
  const intervalForIndex = (i: number): CheckinChoice => {
    if (i === 0) return 'stop';
    if (i === 1) return 'keepDefault';
    return CHECKIN_INTERVAL_CHOICES[i - 2] ?? 'keepDefault';
  };
  return { actions, intervalForIndex };
}
