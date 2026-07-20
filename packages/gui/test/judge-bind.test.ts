/**
 * GOLD — rubric↔scene bind guard (issue #85).
 *
 * The JUDGE rubric (acceptance/criteria/judge-rubric.md) and the judge harness
 * (packages/gui/judge/run-judge.mjs) state the same intent twice: a rubric row names the
 * claim, a scene proves it. Before #85 nothing bound the two homes, so they drifted
 * silently — the harness shipped a SOFTWARE_UPDATE scene for months while the rubric had
 * no such row. This is the repo's bind-two-homes pattern (parity.test.ts,
 * meta-docs.test.ts) applied to that pair:
 *
 *   1. Every rubric row id has a scene in the harness's SCENES table that declares it.
 *   2. Every rubric id the SCENES table declares is a real rubric row.
 *
 * The scene side comes from `node run-judge.mjs --list-items` — the harness's own listing
 * mode over the real SCENES table (no browser launched) — not from regexing the harness
 * source, so a refactor of the harness cannot fool the guard and a renamed local cannot
 * break it. The third leg of the bind is enforced at judge runtime: the driver throws if
 * a scene records a rubric item it does not declare, or misses one it does.
 *
 * run-judge.mjs imports the built packages/gui/dist/ipc.js, so this needs `npm run build`
 * first — the same precondition the judge itself has, and CI's order (build, then test).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const rubricIds = (): string[] => {
  const rubric = readFileSync(join(repoRoot, 'acceptance/criteria/judge-rubric.md'), 'utf8');
  return [...rubric.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]);
};

const sceneIds = (): string[] => {
  const out = execFileSync(
    process.execPath,
    [join(repoRoot, 'packages/gui/judge/run-judge.mjs'), '--list-items'],
    { encoding: 'utf8' },
  );
  return out.split('\n').filter(Boolean);
};

describe('judge rubric ↔ scene bind (issue #85)', () => {
  it('the rubric parses to a non-trivial row set and the harness lists its scenes', () => {
    expect(rubricIds().length).toBeGreaterThan(30);
    expect(sceneIds().length).toBeGreaterThan(30);
  });

  it('every rubric row has a scene that declares it', () => {
    const scenes = new Set(sceneIds());
    const unproven = rubricIds().filter((id) => !scenes.has(id));
    expect(unproven, 'rubric rows with no judge scene').toEqual([]);
  });

  it('every scene-declared item is a rubric row', () => {
    const rows = new Set(rubricIds());
    const unbound = sceneIds().filter((id) => !rows.has(id));
    expect(unbound, 'judge scenes with no rubric row').toEqual([]);
  });

  it('neither home carries duplicate ids', () => {
    const rows = rubricIds();
    expect(new Set(rows).size, 'duplicate rubric rows').toBe(rows.length);
    const scenes = sceneIds();
    expect(new Set(scenes).size, 'duplicate scene listings').toBe(scenes.length);
  });
});
