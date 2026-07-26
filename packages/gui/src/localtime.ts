/**
 * The exact-times FIELD VOCABULARY (PRD §12 R14/R15/R17, G1) — the one format the raw
 * Start/Stop text fields render, and the one parse that reads them back. Electron-free and
 * collaborator-free, mirroring tags.ts / liveview.ts / timerview.ts.
 *
 * These two functions are INVERSES and must stay so, which is why they share a file rather
 * than sitting one in `renderer/su.ts` and one wherever a parse happened to be needed. The
 * renderer reaches them through `window.SU` (su.ts imports and re-exports, the same way it
 * imports core's formatDuration and timerview's countUpSeconds); `timerview.ts`'s
 * `liveEditStripPatch` and the `add` IPC handler reach them directly. One definition,
 * three consumers — the #168 rule, one level deeper so the unit-pinned layer shares it too.
 *
 * WHAT THE FIELD SHOWS (issue #159). `YYYY-MM-DD HH:mm:ss` in *local* time, no timezone
 * suffix. Two deliberate choices:
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

/**
 * Render a Date as the field's local wall-clock string: `YYYY-MM-DD HH:mm:ss`, no zone.
 *
 * Load-bearing beyond appearance: this string is also the SEED the live-edit strip and the
 * unified form byte-compare an untouched field against (§12 R14/R15, issue #68), so a change
 * here moves what "untouched" means. `renderer-bundle.test.ts` pins the output directly for
 * exactly that reason.
 */
export function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
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
 * Parse a Start/Stop field's text into a local Date — the inverse of {@link localInputValue}.
 *
 * Returns a Date, INVALID (NaN) when unreadable, rather than null: every call site already
 * guards with `isNaN(d.getTime())` or lets `toISOString()` throw its RangeError into the §12
 * R21 message region, and keeping that shape means adopting this parser changes no behaviour
 * on a half-typed value.
 *
 * A local match is built through the Date *constructor*, so the fields become the local wall
 * clock they claim to be; a zone-bearing instant goes to the engine and lands on the instant it
 * names; everything else — including every prefix of a value still being typed — is Invalid.
 */
export function parseLocalInput(value: string): Date {
  const s = String(value ?? '').trim();
  const m = LOCAL_INPUT_RE.exec(s);
  if (!m) return ZONED_INSTANT_RE.test(s) ? new Date(s) : new Date(NaN);
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] ? Number(m[6]) : 0,
    m[7] ? Number(m[7].padEnd(3, '0')) : 0,
  );
}
