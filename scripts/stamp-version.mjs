#!/usr/bin/env node
/**
 * §19 R06 — stamp the date/build version into the single source of truth before a build.
 *
 * Computes the release version `YYYY.M.D` from the current UTC date (month and day NOT
 * zero-padded, per the spec example `2026.6.27`), with an optional same-day build suffix
 * `.N` supplied by CI via `STINT_BUILD_N` (an integer ≥ 2; absent or 1 ⇒ no suffix). It
 * rewrites the committed dev-placeholder literal in `packages/core/src/version.ts` so the
 * built `dist` carries the real version, then echoes the version to stdout (CI captures
 * it for the Git tag / GitHub Release name — the §19 R05 linkage).
 *
 * Pure date math + one file rewrite; NO network, no other side effects. Idempotent: it
 * re-targets the `APP_VERSION` literal regardless of its current value, so a second run
 * (or a run over an already-stamped tree) simply re-stamps today's version.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Compute `YYYY.M.D[.N]` for a given Date (UTC) and same-day build counter. */
export function computeVersion(now = new Date(), buildN = undefined) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-based, NOT zero-padded
  const d = now.getUTCDate(); //         NOT zero-padded
  const base = `${y}.${m}.${d}`;
  const n = Number(buildN);
  return Number.isInteger(n) && n >= 2 ? `${base}.${n}` : base;
}

const VERSION_FILE = fileURLToPath(
  new URL('../packages/core/src/version.ts', import.meta.url),
);

// The literal `APP_VERSION` is assigned via `process.env.STINT_VERSION ?? '<literal>'`;
// rewrite only that fallback string so the env override and the rest of the file stand.
const ASSIGN_RE =
  /(export const APP_VERSION: string = process\.env\.STINT_VERSION \?\? ')([^']*)(';)/;

export function stampFile(version, file = VERSION_FILE) {
  const src = readFileSync(file, 'utf8');
  if (!ASSIGN_RE.test(src)) {
    throw new Error(`stamp-version: APP_VERSION literal not found in ${file}`);
  }
  writeFileSync(file, src.replace(ASSIGN_RE, `$1${version}$3`));
  return version;
}

// Run only when invoked directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = computeVersion(new Date(), process.env.STINT_BUILD_N);
  stampFile(version);
  process.stdout.write(`${version}\n`);
}
