/**
 * §19 R06 — date/build versioning. The single source of truth for the app version,
 * read identically by BOTH surfaces (the tt CLI's `--version` and the GUI Settings →
 * Software Update view), so the two equal surfaces can never report a different version.
 *
 * The release version is `YYYY.M.D` (month/day NOT zero-padded, e.g. `2026.6.27`) with
 * an optional numeric build suffix `.N` (N ≥ 2) for multiple same-day releases
 * (`2026.6.27.2`). The committed fallback below is a deterministic, offline, non-release
 * SENTINEL (`DEV_VERSION` = `0.0.0-dev`) so an unstamped local/dev build still runs; CI
 * replaces that fallback via `scripts/stamp-version.mjs` before `npm run build`, and
 * `process.env.STINT_VERSION` overrides at runtime (the test/stamp hook). No network, no
 * clock read at import.
 */

/** The dev placeholder a freshly checked-out, unstamped build carries. */
export const DEV_VERSION = '0.0.0-dev';

/**
 * A release version: `YYYY.M.D` with an optional `.N` same-day build suffix. Month and
 * day are 1–2 digits and NOT zero-padded (the §19 R06 example is `2026.6.27`, not
 * `2026.06.27`), the year is exactly four digits, and N (when present) is ≥ 1 digit.
 */
export const VERSION_RE = /^\d{4}\.\d{1,2}\.\d{1,2}(\.\d+)?$/;

/** True iff `s` is a stamped release version (the §19 R06 `YYYY.M.D[.N]` shape). */
export function isReleaseVersion(s: string): boolean {
  return VERSION_RE.test(s);
}

/**
 * The app version both surfaces report. `STINT_VERSION` in the environment wins (the CI
 * stamp / test hook); otherwise the stamped fallback — `DEV_VERSION` until a build stamps
 * it to a real `YYYY.M.D[.N]`.
 *
 * CONSTRAINT (#174): the assignment's TEXT is load-bearing outside the type system.
 * `scripts/stamp-version.mjs` rewrites the `??` fallback in place by regex and throws when
 * it cannot match, so this must stay one line of the form
 * `export const APP_VERSION: string = process.env.STINT_VERSION ?? <DEV_VERSION | '…'>;`.
 * Those two fallback forms are all the script accepts — routing the fallback through a
 * helper, a ternary, or a second statement breaks the release stamp. Pinned by GOLD
 * `core/test/gold/stamp-version.test.ts`.
 */
export const APP_VERSION: string = process.env.STINT_VERSION ?? DEV_VERSION;
