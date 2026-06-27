/**
 * Time parsing and formatting.
 *
 * All storage is ISO-8601 UTC. Durations are computed from epoch milliseconds, so
 * they are timezone-independent and DST-safe (PRD §04, §16). Parsing accepts the
 * absolute and relative forms documented in PRD §11.
 */

/** A clock, injectable so tests can pin "now". */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/**
 * Normalise a Date to an ISO-8601 UTC string at second precision (the on-disk
 * format). Milliseconds are dropped so timestamps are clean and consistent across
 * every entry path; durations remain exact second math.
 */
export function toUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Whole seconds between two ISO-8601 instants (b - a). */
export function secondsBetween(aUtc: string, bUtc: string): number {
  return Math.round((Date.parse(bUtc) - Date.parse(aUtc)) / 1000);
}

/**
 * Monotonic-time guard for *derived* elapsed of an open entry (PRD §20 R06).
 *
 * Wall clocks are not monotonic: NTP corrections and manual clock changes can move
 * `now` *behind* an entry's `start`. The live count-up of a running entry must never
 * report negative, NaN, or otherwise garbage elapsed when that happens — it clamps to
 * 0 until the clock catches back up.
 *
 * Returns whole seconds `max(0, round((now - start) / 1000))`, and 0 (never negative,
 * never NaN) when `now < start` or when either timestamp fails to parse. Unlike
 * {@link secondsBetween} — the *signed* raw-span primitive used for stored start/end
 * span math (sleep spans, §10a) — this is the asymmetric, never-negative guard for
 * live/derived elapsed only.
 *
 * Do NOT reach for this as a general "clamp a duration to ≥ 0" helper. It is correct
 * *only* for the live count-up of an OPEN entry, where the second argument is the
 * wall-clock `now` and the asymmetry (clamp when `now < start`) absorbs a clock that
 * jumped backwards. For a CLOSED entry the span is bounded by a *stored* end, not by
 * `now`, so a backwards clock cannot corrupt it and there is nothing to absorb;
 * clamping that math here would only mask a genuinely corrupt `end < start` row instead
 * of surfacing it. Store.toView deliberately keeps the closed-entry span on its own
 * inline `max(0, …)` for exactly this reason — it is not an oversight to be "unified".
 */
export function elapsedSeconds(startUtc: string, nowUtc: string): number {
  const start = parseIsoUtc(startUtc);
  const now = parseIsoUtc(nowUtc);
  if (Number.isNaN(start) || Number.isNaN(now)) return 0;
  return Math.max(0, Math.round((now - start) / 1000));
}

/**
 * Strictly parse an ISO-8601 instant, returning epoch ms or NaN. Unlike bare
 * {@link Date.parse} — which leniently reads `"0"` as a year, `"1995"` as a date, etc. —
 * this requires a full date-time with an explicit zone, so garbage strings reaching the
 * monotonic guard yield NaN (and thus a clamped 0) instead of a spurious instant.
 */
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function parseIsoUtc(s: string): number {
  if (!ISO_UTC_RE.test(s)) return NaN;
  return Date.parse(s);
}

export class TimeParseError extends Error {
  constructor(input: string) {
    super(`could not parse time: "${input}"`);
    this.name = 'TimeParseError';
  }
}

const RELATIVE_RE = /^([+-])((?:\d+[hms])+)$/;
const RELATIVE_PART_RE = /(\d+)([hms])/g;
const HHMM_RE = /^(\d{1,2}):(\d{2})$/;
const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parse a time argument into an ISO-8601 UTC instant.
 *
 * Accepted forms (PRD §11):
 *   - relative:  `-90m`, `-1h30m`, `+5m`     → offset from `now`
 *   - clock:     `14:30`                      → that time today, local zone
 *   - local ISO: `2026-06-24T14:30`           → local zone, no offset
 *   - full ISO:  `2026-06-24T14:30:00Z` / with offset → as written
 *
 * `now` defaults to the system clock; injectable for deterministic parsing.
 */
export function parseTime(input: string, now: Date = new Date()): string {
  const s = input.trim();
  if (s === '') throw new TimeParseError(input);

  if (s.toLowerCase() === 'now') return toUtc(now);

  // Relative: -1h30m, +5m, -90m
  const rel = RELATIVE_RE.exec(s);
  if (rel) {
    const sign = rel[1] === '-' ? -1 : 1;
    let ms = 0;
    let m: RegExpExecArray | null;
    RELATIVE_PART_RE.lastIndex = 0;
    while ((m = RELATIVE_PART_RE.exec(rel[2]!)) !== null) {
      const n = Number(m[1]);
      const unit = m[2];
      ms += n * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000);
    }
    return toUtc(new Date(now.getTime() + sign * ms));
  }

  // Clock time today, local zone: 14:30
  const hhmm = HHMM_RE.exec(s);
  if (hhmm) {
    const d = new Date(now);
    d.setHours(Number(hhmm[1]), Number(hhmm[2]), 0, 0);
    return toUtc(d);
  }

  // Local datetime without zone: 2026-06-24T14:30(:ss)?
  const ldt = LOCAL_DATETIME_RE.exec(s);
  if (ldt) {
    const d = new Date(
      Number(ldt[1]),
      Number(ldt[2]) - 1,
      Number(ldt[3]),
      Number(ldt[4]),
      Number(ldt[5]),
      ldt[6] ? Number(ldt[6]) : 0,
      0,
    );
    if (Number.isNaN(d.getTime())) throw new TimeParseError(input);
    return toUtc(d);
  }

  // Anything Date can parse with an explicit zone (full ISO, Z or ±hh:mm).
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return toUtc(new Date(parsed));

  throw new TimeParseError(input);
}

/** Format a duration in seconds as `HH:MM:SS` (hours unbounded). */
export function formatDuration(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  let s = Math.abs(Math.trunc(seconds));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Format seconds as decimal hours to two places (e.g. `1.50`), for reports. */
export function formatHours(seconds: number): string {
  return (seconds / 3600).toFixed(2);
}

/** Render an ISO-8601 UTC instant in a given locale/zone (display only). */
export function renderLocal(
  iso: string,
  opts: { timeZone?: string; locale?: string } = {},
): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(opts.locale ?? 'en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: opts.timeZone,
  }).format(d);
}
