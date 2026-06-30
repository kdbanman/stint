/**
 * GOLD — the auto-publish guard runs in CI (PRD §19 R05; runbook "CHECK PUBLISH-ON-MERGE").
 *
 * Regression backstop for the release-matrix failure where electron-builder auto-published
 * in CI and died without GH_TOKEN. The PR-path `pack-smoke` runs `--dir` (never publishes),
 * so only this static guard catches a distributable build that forgets `--publish never`
 * BEFORE it reddens main's release workflow.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script, no types needed.
import { checkNoAutoPublish, electronBuilderInvocations, isDirOnlyBuild, publishIsDisabled } from '../../../../scripts/check-no-auto-publish.mjs';

describe('GOLD: no auto-publish (§19 R05)', () => {
  it('every distributable-producing electron-builder invocation disables publishing', () => {
    expect(checkNoAutoPublish()).toEqual([]);
  });

  it('actually finds the gui pack scripts to check (guard is not vacuously green)', () => {
    const sources = (electronBuilderInvocations() as Array<{ source: string }>).map((i) => i.source);
    expect(sources).toContain('packages/gui/package.json → scripts.pack');
    expect(sources).toContain('packages/gui/package.json → scripts.pack:smoke');
  });

  it('flags a distributable build that omits --publish never', () => {
    // The exact pre-fix `pack` command — must be caught.
    const cmd = 'electron-builder --config electron-builder.yml';
    expect(isDirOnlyBuild(cmd)).toBe(false);
    expect(publishIsDisabled(cmd)).toBe(false);
  });

  it('exempts --dir builds (they never publish) and recognises the publish-never flag', () => {
    expect(isDirOnlyBuild('electron-builder --linux dir --config electron-builder.yml')).toBe(true);
    expect(publishIsDisabled('electron-builder --publish never --config electron-builder.yml')).toBe(true);
    expect(publishIsDisabled('electron-builder -p never')).toBe(true);
    expect(publishIsDisabled('electron-builder --publish=never')).toBe(true);
  });
});
