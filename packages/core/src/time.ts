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

// ───────────────────────────── configured time zone (§04 R06, §14) ─────────────────────

/**
 * §14 — resolve the `time_zone` setting to a concrete IANA zone. The sentinel `'system'`
 * (or an absent value) is resolved against the OS **at read time**, so an OS zone change
 * is followed without a restart; an explicit IANA zone pins display/parsing regardless of
 * the OS. Every zone-sensitive derivation (display, wall-clock parsing, day buckets,
 * range presets) resolves through this one function, so "whose local" has one answer.
 */
export function resolveTimeZone(setting?: string): string {
  return !setting || setting === 'system'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : setting;
}

/**
 * §14 — whether `tz` is a time zone the platform supports: the engine's own Intl accepts
 * it (constructing a formatter with an unknown zone throws a RangeError). Deliberately NOT
 * bare membership in `Intl.supportedValuesOf('timeZone')`: that list carries only the
 * CLDR-canonical names, so it omits `'UTC'` and rejects valid IANA aliases the platform
 * formats fine (`Asia/Kolkata` vs the list's `Asia/Calcutta`) — a validation that refuses
 * zones the OS itself reports would strand a `'system'` user trying to pin their own zone.
 * The supported-values list remains the GUI dropdown's option source. The `'system'`
 * sentinel is NOT a zone — settings.ts accepts it before consulting this.
 */
export function isSupportedTimeZone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A wall-clock reading — the civil date/time an instant shows on a zone's clock. */
export interface WallClock {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  hour: number;
  minute: number;
  second: number;
}

// One cached formatter per zone: wallClockOf runs per rendered timestamp and per calendar
// event, and Intl.DateTimeFormat construction is orders of magnitude dearer than format().
const wallFormatters = new Map<string, Intl.DateTimeFormat>();
function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = wallFormatters.get(timeZone);
  if (!f) {
    // en-CA + h23: numeric fields whose values are read back as numbers below — the locale
    // only shapes separators, which formatToParts sidesteps entirely.
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    wallFormatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock reading of an instant in an IANA zone (the display-side primitive). */
export function wallClockOf(instant: Date, timeZone: string): WallClock {
  const parts = wallFormatter(timeZone).formatToParts(instant);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour: num('hour'),
    minute: num('minute'),
    second: num('second'),
  };
}

const DAY_MS = 86_400_000;

/** A zone's UTC offset (ms east of UTC) at an instant, derived from its wall clock. */
function zoneOffsetMs(timeZone: string, utcMs: number): number {
  // Offsets are whole seconds; diff on the second-truncated instant so a millisecond
  // fraction on the input never smears into the offset.
  const floored = Math.floor(utcMs / 1000) * 1000;
  const w = wallClockOf(new Date(floored), timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - floored;
}

/**
 * The instant a wall-clock reading names in an IANA zone — the parse-side inverse of
 * {@link wallClockOf}, with **compatible** DST resolution (§04 R06): a wall time that
 * never exists (the spring-forward gap) shifts forward past the gap; one that exists
 * twice (the fall-back hour) takes the earlier instant (the first, pre-transition
 * offset). Out-of-range fields (month 13, day 0) carry over as calendar arithmetic via
 * Date.UTC normalisation, which is what lets resolveRange step days/months plainly.
 */
export function wallClockToUtc(
  w: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date {
  const wallMs = Date.UTC(w.year, w.month - 1, w.day, w.hour ?? 0, w.minute ?? 0, w.second ?? 0);
  // The zone's offset a day before and a day after the wall reading (read as if UTC)
  // brackets any transition near it; a candidate offset is real iff re-reading the zone at
  // the candidate instant yields the same offset.
  const before = zoneOffsetMs(timeZone, wallMs - DAY_MS);
  const after = zoneOffsetMs(timeZone, wallMs + DAY_MS);
  const candidates: number[] = [];
  for (const off of before === after ? [before] : [before, after]) {
    const utc = wallMs - off;
    if (zoneOffsetMs(timeZone, utc) === off && !candidates.includes(utc)) candidates.push(utc);
  }
  // Ambiguous (two real instants): the earlier one. Nonexistent (none): apply the
  // pre-transition offset, which lands past the gap by exactly the gap's size.
  if (candidates.length > 0) return new Date(Math.min(...candidates));
  return new Date(wallMs - before);
}

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
 *   - clock:     `14:30`                      → that time today, configured zone
 *   - local ISO: `2026-06-24T14:30`           → configured zone, no offset
 *   - full ISO:  `2026-06-24T14:30:00Z` / with offset → as written
 *
 * `now` defaults to the system clock; injectable for deterministic parsing. The two
 * wall-clock forms parse in `timeZone` (an IANA zone or the `'system'` sentinel/absent →
 * the OS zone, §04 R06/§14), symmetric with display, with compatible DST resolution
 * (wallClockToUtc): a nonexistent time shifts forward past the gap, an ambiguous one
 * takes the earlier offset. "Today" for the bare-clock form is the configured zone's
 * calendar day of `now`.
 */
export function parseTime(input: string, now: Date = new Date(), timeZone?: string): string {
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

  const tz = resolveTimeZone(timeZone);

  // Clock time today, configured zone: 14:30
  const hhmm = HHMM_RE.exec(s);
  if (hhmm) {
    const today = wallClockOf(now, tz);
    return toUtc(
      wallClockToUtc(
        { ...today, hour: Number(hhmm[1]), minute: Number(hhmm[2]), second: 0 },
        tz,
      ),
    );
  }

  // Zoneless datetime, configured zone: 2026-06-24T14:30(:ss)?
  const ldt = LOCAL_DATETIME_RE.exec(s);
  if (ldt) {
    const d = wallClockToUtc(
      {
        year: Number(ldt[1]),
        month: Number(ldt[2]),
        day: Number(ldt[3]),
        hour: Number(ldt[4]),
        minute: Number(ldt[5]),
        second: ldt[6] ? Number(ldt[6]) : 0,
      },
      tz,
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

/**
 * §04 R06 — the ONE human rendering of a stored UTC instant, honoring both display
 * settings: `time_zone` (resolved at read time — 'system' follows the OS) and
 * `date_format` ('iso' → an unambiguous fixed `YYYY-MM-DD HH:MM:SS`; 'system' → the
 * runner's locale). Both surfaces' timestamp columns route through this (`tt list` /
 * `tt backup ls` and the GUI's stamp labels), so what zone a timestamp reads in has a
 * single answer. Display only — stored truth stays UTC ISO; `null` renders the em-dash
 * placeholder (an open entry's end).
 */
export function formatStamp(
  iso: string | null,
  settings: { dateFormat: 'system' | 'iso'; timeZone: string },
): string {
  if (!iso) return '—';
  const tz = resolveTimeZone(settings.timeZone);
  const d = new Date(iso);
  if (settings.dateFormat === 'iso') {
    const w = wallClockOf(d, tz);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${w.year}-${p(w.month)}-${p(w.day)} ${p(w.hour)}:${p(w.minute)}:${p(w.second)}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: tz,
  }).format(d);
}
