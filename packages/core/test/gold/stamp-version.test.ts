/**
 * GOLD — the release version stamp can still find its target (PRD §19 R06; runbook
 * "CHECK INSTALL & UPDATE (§17 R13)" part (a) reads the stamped version on a real install).
 *
 * Named defect (#174): `scripts/stamp-version.mjs` rewrites `APP_VERSION`'s `??` fallback in
 * `packages/core/src/version.ts` by regex — a coupling neither file can express in code. It
 * used to match ONLY a quoted literal, so substituting the `DEV_VERSION` constant exported
 * nineteen lines above it (the obvious cleanup) broke the stamp. The script now accepts both
 * fallback forms; these tests pin THAT tolerance, because a regex tightened back to
 * literal-only still passes CI's stamp step against whatever form the tree happens to carry,
 * silently re-arming the trap for the next reader.
 *
 * All three run offline over a temp copy — no network, and `packages/core/src/version.ts` is
 * never written. The suite is form-agnostic by construction: CI stamps before `npm test`, so
 * the checked file is the DEV_VERSION form locally and a quoted literal in CI.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReleaseVersion } from '@stint/core';
// @ts-expect-error — plain .mjs script, no types needed.
import { stampFile, computeVersion } from '../../../../scripts/stamp-version.mjs';

const stamp = stampFile as (version: string, file: string) => string;
const compute = computeVersion as (now?: Date, buildN?: string) => string;

const VERSION_TS = fileURLToPath(new URL('../../src/version.ts', import.meta.url));

/** Stamp `version` into a throwaway copy of `src` and return the rewritten text. */
function stampCopy(src: string, version: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'stint-stamp-'));
  try {
    const file = join(dir, 'version.ts');
    writeFileSync(file, src);
    stamp(version, file);
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The one assignment line the script targets, in the `DEV_VERSION`-constant form. */
const CONSTANT_FORM = "export const APP_VERSION: string = process.env.STINT_VERSION ?? DEV_VERSION;\n";
/** The same line as an already-stamped tree carries it. */
const LITERAL_FORM = "export const APP_VERSION: string = process.env.STINT_VERSION ?? '0.0.0-dev';\n";

describe('GOLD: the version stamp finds its target (§19 R06)', () => {
  it('stamps the committed version.ts, whatever fallback form it carries', () => {
    // The live coupling: an APP_VERSION refactor that the script cannot rewrite fails HERE, in
    // `npm test`, instead of at the release workflow's stamp step.
    const out = stampCopy(readFileSync(VERSION_TS, 'utf8'), '2026.6.27');
    expect(out).toContain("process.env.STINT_VERSION ?? '2026.6.27';");
    expect(out).toContain("export const DEV_VERSION = '0.0.0-dev';"); // the sentinel is untouched
  });

  it('accepts BOTH fallback forms, so substituting the constant is not a trap', () => {
    for (const form of [CONSTANT_FORM, LITERAL_FORM]) {
      expect(stampCopy(form, '2026.6.27')).toBe(
        "export const APP_VERSION: string = process.env.STINT_VERSION ?? '2026.6.27';\n",
      );
    }
  });

  it('refuses a fallback it cannot rewrite rather than emitting an unstamped build', () => {
    // Routing the fallback through a helper is the shape the comment at the site forbids: the
    // script must THROW, not silently leave the dev sentinel in a published release.
    const indirect =
      "const fallback = DEV_VERSION;\nexport const APP_VERSION: string = process.env.STINT_VERSION ?? fallback;\n";
    expect(() => stampCopy(indirect, '2026.6.27')).toThrow(/APP_VERSION fallback not found/);
  });

  it('re-stamping an already-stamped tree is idempotent and stays a release version', () => {
    // release.yml stamps the `pack` matrix on top of a tree CI may already have stamped.
    const once = stampCopy(readFileSync(VERSION_TS, 'utf8'), '2026.6.27');
    expect(stampCopy(once, '2026.6.27.2')).toContain(
      "process.env.STINT_VERSION ?? '2026.6.27.2';",
    );
    expect(isReleaseVersion(compute(new Date('2026-06-27T00:00:00Z'), '2'))).toBe(true);
  });
});
