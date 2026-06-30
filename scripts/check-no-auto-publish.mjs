#!/usr/bin/env node
/**
 * Auto-publish guard (PRD §19 R05; runbook "CHECK PUBLISH-ON-MERGE").
 *
 * electron-builder auto-detects CI and, for any invocation that produces *distributables*
 * (.dmg / .AppImage / .deb — anything but a `--dir` unpacked build), tries to PUBLISH them
 * to a GitHub Release. That step needs a GH_TOKEN. The release-matrix `pack` jobs build the
 * artifacts and hand them to a SEPARATE `publish` job (`gh release create`, §19 R05), so they
 * deliberately run with no token — and used to die at the very end with:
 *
 *     • artifacts will be published if draft release exists  reason=CI detected
 *     ⨯ GitHub Personal Access Token is not set, neither programmatically, nor using env "GH_TOKEN"
 *
 * That failure only ever surfaced in the post-merge release pack: the PR-path `pack-smoke`
 * job runs `--dir`, which never produces a distributable and so never reaches the publish
 * step — exactly the blind spot scripts/check-packaging.mjs was written to close for the
 * native helper. This is the matching cheap, deterministic, no-network guard for the publish
 * step: it asserts every distributable-producing electron-builder invocation explicitly
 * disables publishing (`--publish never`), so a regression fails on the PR, BEFORE merge,
 * instead of reddening main's release workflow.
 *
 * The `--publish never` CLI flag OVERRIDES any config-level publish provider, so requiring it
 * on the invocation is both necessary and sufficient — this guard does not need to parse
 * electron-builder.yml's (currently absent) `publish:` block.
 *
 * Pure check: no network, no side effects (mirrors scripts/check-no-network.mjs).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * True when an electron-builder command produces only an unpacked directory (`--dir` /
 * `--linux dir` / `-l dir` …). A `dir` build is never published, so it is exempt from the
 * publish-never requirement.
 */
export function isDirOnlyBuild(command) {
  // `dir` as a standalone target token (covers `--dir` and `<platform> dir`).
  return /(?:^|\s)(?:--dir|dir)(?:\s|$)/.test(command);
}

/**
 * True when an electron-builder command explicitly disables publishing
 * (`--publish never`, `--publish=never`, `-p never`, `-p=never`).
 */
export function publishIsDisabled(command) {
  return /(?:--publish|(?:^|\s)-p)(?:=|\s+)never\b/.test(command);
}

/**
 * Collect every electron-builder invocation Stint can run, paired with where it lives:
 *   - the gui workspace's npm scripts (what both CI workflows call via `npm run …`), and
 *   - any RAW `electron-builder …` command embedded directly in a workflow yaml (defense in
 *     depth — today the workflows only call npm scripts, but a future inline call must obey
 *     the same rule).
 * Returns [{ source, command }].
 */
export function electronBuilderInvocations() {
  const invocations = [];

  // 1. gui package.json scripts.
  const guiPkgPath = join(ROOT, 'packages/gui/package.json');
  const guiPkg = JSON.parse(readFileSync(guiPkgPath, 'utf8'));
  for (const [name, command] of Object.entries(guiPkg.scripts ?? {})) {
    if (command.includes('electron-builder')) {
      invocations.push({ source: `packages/gui/package.json → scripts.${name}`, command });
    }
  }

  // 2. Raw electron-builder calls in workflow yaml (skip comment lines).
  const workflowsDir = join(ROOT, '.github/workflows');
  let workflowFiles = [];
  try {
    workflowFiles = readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f));
  } catch {
    // No workflows dir — nothing to scan.
  }
  for (const file of workflowFiles) {
    const text = readFileSync(join(workflowsDir, file), 'utf8');
    text.split('\n').forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) return; // yaml comment
      // Strip the yaml step/list prefix (`- run:` / `run:` / leading `-`) so we test the
      // actual shell command, then match `electron-builder` only in COMMAND position — at
      // the start or right after a shell separator. This deliberately ignores the token
      // appearing inside an `echo "…"` string or a comment (today the workflows only call
      // `npm run pack`; a future RAW invocation must still obey the rule).
      const command = trimmed.replace(/^-\s*/, '').replace(/^run:\s*/, '');
      if (/(?:^|&&|\|\||;|\|)\s*electron-builder\b/.test(command)) {
        invocations.push({ source: `.github/workflows/${file}:${i + 1}`, command });
      }
    });
  }

  return invocations;
}

/**
 * Returns a list of human-readable problems (empty when healthy): every
 * distributable-producing electron-builder invocation that does NOT disable publishing.
 */
export function checkNoAutoPublish() {
  const problems = [];
  for (const { source, command } of electronBuilderInvocations()) {
    if (isDirOnlyBuild(command)) continue; // never publishes
    if (!publishIsDisabled(command)) {
      problems.push(
        `${source}: electron-builder produces distributables but does not pass \`--publish never\`. ` +
          `In CI it will try to publish to a GitHub Release and fail without GH_TOKEN ` +
          `(the release \`pack\` job builds only; the separate \`publish\` job cuts the release — §19 R05). ` +
          `Add \`--publish never\` to: ${command}`,
      );
    }
  }
  return problems;
}

// Run as a CLI when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkNoAutoPublish();
  if (problems.length > 0) {
    console.error('auto-publish guard FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const count = electronBuilderInvocations().length;
  console.log(`auto-publish guard passed: ${count} electron-builder invocation(s); all distributable builds pass --publish never`);
}
