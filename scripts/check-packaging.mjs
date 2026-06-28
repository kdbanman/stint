#!/usr/bin/env node
/**
 * Packaging-toolchain GOLD backstop (PRD §19 R01; runbook "CHECK BUILD MATRIX").
 *
 * electron-builder shells out to a precompiled native helper, `app-builder`, shipped
 * by the `app-builder-bin` package as a per-platform binary. If that binary is missing
 * from node_modules, `npm --workspace @stint/gui run pack` dies deep inside packaging
 * with a cryptic `spawn .../app-builder-bin/<platform>/<arch>/app-builder ENOENT` — the
 * exact failure that turned every release-matrix `pack` run red while the build/test CI
 * stayed green, because nothing on the PR path ever exercised packaging.
 *
 * This is the cheap, deterministic, no-network guard that closes that gap: it resolves
 * the helper the SAME way electron-builder does (via the `app-builder-bin` module) and
 * asserts the binary exists and is executable for the current platform/arch. It runs on
 * every PR (the CI `verify` job) so a missing native helper fails fast and clearly,
 * BEFORE merge, instead of surfacing only in the post-merge release pack. It is also the
 * post-`npm ci` verify step in the release `pack` job, where a failure triggers a
 * cache-clean reinstall repair (see .github/workflows/release.yml).
 *
 * Pure check: no network, no side effects (mirrors scripts/check-no-network.mjs).
 */
import { accessSync, constants, statSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Resolve electron-builder's native `app-builder` helper path and confirm it is a real,
 * executable file. Returns a list of human-readable problems (empty when healthy).
 */
export function checkPackagingToolchain() {
  const problems = [];

  let appBuilderPath;
  try {
    // `app-builder-bin` exports `appBuilderPath` computed for process.platform/arch —
    // identical resolution to what app-builder-lib uses when it spawns the helper.
    ({ appBuilderPath } = require('app-builder-bin'));
  } catch (err) {
    problems.push(
      `cannot load "app-builder-bin" (electron-builder's native helper package): ${err.message}. ` +
        `Run \`npm ci\` so the dev dependency is installed.`,
    );
    return problems;
  }

  if (!appBuilderPath) {
    problems.push('"app-builder-bin" resolved no appBuilderPath for this platform/arch');
    return problems;
  }

  let st;
  try {
    st = statSync(appBuilderPath);
  } catch {
    problems.push(
      `app-builder helper missing at ${appBuilderPath} (${process.platform}/${process.arch}). ` +
        `electron-builder would fail with "spawn … app-builder ENOENT". The binary ships inside ` +
        `the app-builder-bin package; a clean reinstall (\`npm cache clean --force && npm ci\`) restores it.`,
    );
    return problems;
  }

  if (!st.isFile() || st.size === 0) {
    problems.push(`app-builder helper at ${appBuilderPath} is not a non-empty file (size=${st.size})`);
  }

  // POSIX runners must be able to EXECUTE it (Windows is unsupported — §19 R01 — so the
  // execute-bit check is POSIX-only).
  if (process.platform !== 'win32') {
    try {
      accessSync(appBuilderPath, constants.X_OK);
    } catch {
      problems.push(`app-builder helper at ${appBuilderPath} is not executable (missing +x)`);
    }
  }

  return problems;
}

// Run as a CLI when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkPackagingToolchain();
  if (problems.length > 0) {
    console.error('packaging-toolchain check FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const { appBuilderPath } = require('app-builder-bin');
  console.log(`packaging-toolchain check passed: app-builder helper present at ${appBuilderPath}`);
}
