/**
 * Check-in cadence (PRD §10b) — pure scheduling logic, no timers or I/O.
 *
 * First check-in fires at start + firstMin (default 60), then every intervalMin
 * (default 30). The schedule is autonomous (ignoring one still fires the next on
 * time), survives relaunch (a check-in due while closed fires once, then resumes),
 * and realigns from wake after a long sleep (no backlog of missed notifications).
 *
 * The GUI drives this by persisting `CheckinState` and calling `evaluateCheckin`
 * on every tick and once on launch. All math is on the nominal grid anchored at
 * `start`, but a detected gap collapses to a single fire — that is what delivers
 * "fire once on relaunch" and "realign from wake, no backlog" from one rule.
 */

export interface CheckinState {
  /** When the running entry started (anchor of the nominal grid). ISO-8601 UTC. */
  startUtc: string;
  /** The next nominal slot at which a check-in is due. ISO-8601 UTC. */
  nextDueUtc: string;
}

export interface CheckinEval {
  /** True if a check-in should fire now. At most one fire per evaluation. */
  fire: boolean;
  /** The updated state to persist. */
  state: CheckinState;
  /** How many additional due slots were collapsed (skipped, not fired). */
  collapsedBacklog: number;
}

const MIN = 60_000;

/** Initialise cadence state for a freshly started entry. */
export function initCheckinState(startUtc: string, firstMin: number): CheckinState {
  return {
    startUtc,
    nextDueUtc: new Date(Date.parse(startUtc) + firstMin * MIN).toISOString(),
  };
}

/**
 * Evaluate the schedule at `now`.
 *
 * @param overrideNextMin If set, applies to the *next gap only*: the slot after
 *   this fire is placed `overrideNextMin` minutes out from the fire, then cadence
 *   reverts to `intervalMin` (PRD §10b — custom dropdown pick).
 */
export function evaluateCheckin(
  state: CheckinState,
  intervalMin: number,
  now: Date = new Date(),
  overrideNextMin?: number,
): CheckinEval {
  const nowMs = now.getTime();
  const nextDueMs = Date.parse(state.nextDueUtc);

  if (nowMs < nextDueMs) {
    return { fire: false, state, collapsedBacklog: 0 };
  }

  const stepMs = intervalMin * MIN;
  // Smallest nominal slot strictly greater than now: advances past every slot that
  // came due (whether ignored, or missed while closed/asleep) but fires only once.
  // Guard against a non-positive interval (which would never advance) — the loop must
  // make progress. Settings validation rejects this, but defend the pure function too.
  let k = 1;
  if (stepMs > 0) {
    while (nextDueMs + k * stepMs <= nowMs) k++;
  }
  const collapsedBacklog = k - 1;

  const nextDueUtc =
    overrideNextMin !== undefined
      ? new Date(nowMs + overrideNextMin * MIN).toISOString()
      : new Date(nextDueMs + k * stepMs).toISOString();

  return {
    fire: true,
    state: { startUtc: state.startUtc, nextDueUtc },
    collapsedBacklog,
  };
}

/**
 * The nominal due times in [fromUtc, toUtc), for inspection and testing.
 * Pure description of the grid: start+first, +interval, +interval, …
 */
export function nominalCheckins(
  startUtc: string,
  firstMin: number,
  intervalMin: number,
  fromUtc: string,
  toUtc: string,
): string[] {
  const out: string[] = [];
  const from = Date.parse(fromUtc);
  const to = Date.parse(toUtc);
  let t = Date.parse(startUtc) + firstMin * MIN;
  const step = intervalMin * MIN;
  // Guard against a non-positive interval producing an infinite loop.
  if (step <= 0) return out;
  while (t < to) {
    if (t >= from) out.push(new Date(t).toISOString());
    t += step;
  }
  return out;
}
