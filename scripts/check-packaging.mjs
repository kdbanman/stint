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
 * asserts the binary exists, is executable, AND actually runs for the current
 * platform/arch. It runs on every PR (the CI `verify` job) so a missing native helper fails fast and clearly,
 * BEFORE merge, instead of surfacing only in the post-merge release pack. It is also the
 * post-`npm ci` verify step in the release `pack` job, where a failure triggers a
 * cache-clean reinstall repair (see .github/workflows/release.yml).
 *
 * Pure check: no network, no side effects (mirrors scripts/check-no-network.mjs).
 */
import { accessSync, constants, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);

/**
 * Resolve electron-builder's native `app-builder` helper path and confirm it is a real,
 * executable file that ACTUALLY RUNS. Returns a list of human-readable problems (empty
 * when healthy).
 *
 * Statting the file is not enough: a present, +x binary can still fail electron-builder's
 * `spawn(appBuilder)` with ENOENT (e.g. a broken prerelease binary, or a static binary the
 * runner's kernel/loader rejects). A stat-only guard false-passes in exactly that case. So
 * the authoritative check spawns the helper the same way electron-builder does and confirms
 * it executes.
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

  // The AUTHORITATIVE check: actually run the helper, exactly as electron-builder spawns it.
  // `app-builder --version` is a cheap, offline, side-effect-free invocation. A spawn error
  // here (ENOENT/EACCES) IS the failure electron-builder hits during "installing production
  // dependencies"; statting the file would have missed it.
  const run = spawnSync(appBuilderPath, ['--version'], { timeout: 20_000, encoding: 'utf8' });
  if (run.error) {
    problems.push(
      `app-builder helper at ${appBuilderPath} is present but WILL NOT EXECUTE: ${run.error.code ?? run.error.message} ` +
        `(spawn ${run.error.code ?? 'error'}). This is the exact "spawn … app-builder ENOENT" electron-builder dies on. ` +
        `A clean reinstall (\`npm cache clean --force && npm ci\`) restores it if the install was bad; if a fresh install ` +
        `still cannot run it, the app-builder-bin binary itself is broken on this runner (replace/pin app-builder-bin).`,
    );
  } else if (run.signal) {
    problems.push(`app-builder helper at ${appBuilderPath} was killed by signal ${run.signal} (timeout?)`);
  } else if (run.status !== 0) {
    problems.push(
      `app-builder helper at ${appBuilderPath} ran but exited ${run.status}: ${(run.stderr ?? '').trim().slice(0, 200)}`,
    );
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
  const r = spawnSync(appBuilderPath, ['--version'], { encoding: 'utf8' });
  const ver = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() || 'ok';
  console.log(`packaging-toolchain check passed: app-builder runs (${ver}) at ${appBuilderPath}`);
}
