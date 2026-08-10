/**
 * The exact-times FIELD VOCABULARY (PRD §12 R14/R15/R17, G1) — the one format the raw
 * Start/Stop text fields render, and the one parse that reads them back. Electron-free,
 * mirroring tags.ts / liveview.ts / timerview.ts; its only collaborator is core's
 * wall-clock pair (wallClockOf / wallClockToUtc), the same primitives `tt`'s parseTime
 * uses, so the two surfaces read a wall-clock string identically (§04 R06).
 *
 * These two functions are INVERSES and must stay so, which is why they share a file rather
 * than sitting one in `renderer/su.ts` and one wherever a parse happened to be needed. The
 * renderer reaches them through `window.SU` (su.ts binds the configured zone and
 * re-exports, the same way it imports core's formatDuration and timerview's
 * countUpSeconds); `timerview.ts`'s `liveEditStripPatch` and the `add` IPC handler reach
 * them directly. One definition, three consumers — the #168 rule, one level deeper so the
 * unit-pinned layer shares it too.
 *
 * WHOSE WALL CLOCK (§04 R06 / §14). Both functions take the configured time zone —
 * an IANA zone, or the `'system'` sentinel/absent for the OS zone at read time — so the
 * fields render AND parse in the zone the user configured, symmetric by construction.
 * Parsing resolves DST compatibly (core wallClockToUtc): a nonexistent wall time shifts
 * forward past the gap; an ambiguous one takes the earlier offset.
 *
 * WHAT THE FIELD SHOWS (issue #159). `YYYY-MM-DD HH:mm:ss` in the configured zone's wall
 * clock, no timezone suffix. Two deliberate choices:
 *
 *   - SPACE, not `T`. The `T` is a wire separator from ISO-8601 serialization; this string is
 *     not wire, it is the text a user selects and retypes to adjust a start time. The mockups
 *     (context/mockups/timer.html, edit-entry.html) always showed it space-separated; the app
 *     showed `2026-07-26T00:37:37` and the field's own placeholder promised a third thing.
 *   - SECONDS ALWAYS, even at `:00`. §12 R15 / issue #49 require exact times to round-trip to
 *     the second, so the field must be able to show seconds; emitting them only when non-zero
 *     made the placeholder a lie either way (it promised `HH:mm` and rendered `HH:mm:ss`). A
 *     fixed-width value is also what `tnum` alignment in the design spec assumes.
 *
 * WHAT THE FIELD ACCEPTS. Both spellings — space and `T` — so nothing a user has learned to
 * type (or a `tt`-shaped `2026-06-24T09:07`) breaks, and the seconds stay optional on input.
 * Structured like core's `parseTime`/`parseIsoUtc`: two explicit regexes and NO bare
 * `new Date(text)` fallback. That last part is load-bearing, not fastidiousness. The engine's
 * legacy parser is *more* lenient about a space-separated string than a `T`-separated one — it
 * reads the half-typed `2026-06-24 08:` as 08:00 where `2026-06-24T08:` is Invalid — so simply
 * switching separators and leaving the old `new Date(value)` in place would have turned every
 * mid-keystroke value into a committable instant, silently moving a start while the user was
 * still typing it. Anything neither regex matches is an Invalid Date, as before.
 */
import { resolveTimeZone, wallClockOf, wallClockToUtc } from '@stint/core';

/**
 * Render a Date as the field's wall-clock string in the configured zone:
 * `YYYY-MM-DD HH:mm:ss`, no zone suffix.
 *
 * Load-bearing beyond appearance: this string is also the SEED the live-edit strip and the
 * unified form byte-compare an untouched field against (§12 R14/R15, issue #68), so a change
 * here moves what "untouched" means. `renderer-bundle.test.ts` pins the output directly for
 * exactly that reason.
 */
export function localInputValue(date: Date, timeZone?: string): string {
  const w = wallClockOf(date, resolveTimeZone(timeZone));
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${w.year}-${pad(w.month)}-${pad(w.day)} ` +
    `${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`
  );
}

/**
 * The local-datetime shape the fields accept: a date, either separator, and a clock time whose
 * seconds (and their fraction) are optional — `2026-06-24 09:07:33`, `2026-06-24T09:07`.
 */
const LOCAL_INPUT_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/**
 * A full instant carrying its own zone — the one shape that is NOT local wall clock and so is
 * handed to the engine as written (a value pasted from `tt`, an export, or the database).
 */
const ZONED_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Parse a Start/Stop field's text into a Date — the inverse of {@link localInputValue},
 * reading the wall clock in the same configured zone the seed rendered in.
 *
 * Returns a Date, INVALID (NaN) when unreadable, rather than null: every call site already
 * guards with `isNaN(d.getTime())` or lets `toISOString()` throw its RangeError into the §12
 * R21 message region, and keeping that shape means adopting this parser changes no behaviour
 * on a half-typed value.
 *
 * A local match resolves through core's `wallClockToUtc` (compatible DST resolution — §04
 * R06), so the fields become the configured zone's wall clock they claim to be; a
 * zone-bearing instant goes to the engine and lands on the instant it names; everything
 * else — including every prefix of a value still being typed — is Invalid.
 */
export function parseLocalInput(value: string, timeZone?: string): Date {
  const s = String(value ?? '').trim();
  const m = LOCAL_INPUT_RE.exec(s);
  if (!m) return ZONED_INSTANT_RE.test(s) ? new Date(s) : new Date(NaN);
  const base = wallClockToUtc(
    {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: Number(m[4]),
      minute: Number(m[5]),
      second: m[6] ? Number(m[6]) : 0,
    },
    resolveTimeZone(timeZone),
  );
  // A typed millisecond fraction rides on top of the second-resolution wall clock.
  const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  return ms === 0 ? base : new Date(base.getTime() + ms);
}
