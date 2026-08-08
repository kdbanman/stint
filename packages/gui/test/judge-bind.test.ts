/**
 * GOLD — rubric↔scene bind guard (issues #85, #185).
 *
 * The JUDGE rubric (acceptance/criteria/judge-rubric.md) and the judge harness
 * (packages/gui/judge/run-judge.mjs) state the same intent twice: a rubric row names the
 * claim, a scene proves it. Before #85 nothing bound the two homes, so they drifted
 * silently — the harness shipped a SOFTWARE_UPDATE scene for months while the rubric had
 * no such row. This is the repo's bind-two-homes pattern (parity.test.ts,
 * meta-docs.test.ts) applied to that pair, at two grains:
 *
 *   1. ROW ↔ SCENE. Every rubric row id has a scene in the harness's SCENES table that
 *      declares it, and every id that table declares is a real rubric row.
 *   2. SUB-FACT (#185). Every rubric row's Sub-facts cell names exactly the sub-facts the
 *      harness recorded for it. Matching ids caught a whole missing scene but not the
 *      drift #185 documents — a scene's assertions change, the ids still match, and the
 *      row's claim goes stale unread. An assertion added or deleted renames the set.
 *
 *   3. CAPTURE (#283). No two scenes write the same screenshot file. Capture filenames
 *      are hand-chosen per scene, so a collision means last writer wins while both
 *      scenes cite the file as their evidence — one of them is then reviewed every wave
 *      against an image of the OTHER scene's state, and no freshness gate can notice
 *      because the file exists and is fresh. The scene side comes from
 *      `node run-judge.mjs --list-captures` (the same listing-mode philosophy as
 *      --list-items); the driver holds each scene's declaration to what it actually
 *      writes, so the listing is the truth about a run, not a parallel hand-copied list.
 *
 * The scene side of (1) comes from `node run-judge.mjs --list-items` — the harness's own
 * listing mode over the real SCENES table (no browser launched) — not from regexing the
 * harness source, so a refactor of the harness cannot fool the guard and a renamed local
 * cannot break it. Sub-facts only exist once a scene has run, so (2) reads the committed
 * acceptance/evidence/judge-report.json, whose scored contract (item, pass, facts) CI
 * compares against a fresh `npm run judge` (scripts/compare-judge-contract.mjs); a stale
 * report fails there, not silently here. The third leg is
 * enforced at judge runtime: the driver throws if a scene records a rubric item it does
 * not declare, or misses one it does.
 *
 * The same pattern binds the RECORD harness's per-requirement recipes to their index rows
 * in acceptance/evidence/recordings/README.md, the only other home that names them.
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
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

// The rubric holds two tables: the claim table, then the Sub-facts index. Split on the heading
// so each reader sees only its own — the row shape is identical in both.
const rubricSections = (): [string, string] => {
  const [claims, facts] = read('acceptance/criteria/judge-rubric.md').split('\n## Sub-facts\n');
  if (!facts) throw new Error('judge-rubric.md has no "## Sub-facts" section');
  return [claims!, facts];
};

const rowsOf = (section: string): string[] => section.split('\n').filter((l) => /^\| `[A-Z_]+` \|/.test(l));
const idOf = (row: string): string => /^\| `([A-Z_]+)` \|/.exec(row)![1]!;

const rubricIds = (): string[] => rowsOf(rubricSections()[0]).map(idOf);

// An unscored row carries an em dash and no names.
const rubricFacts = (): Map<string, string[]> =>
  new Map(
    rowsOf(rubricSections()[1]).map((row) => [
      idOf(row),
      [...row.slice(row.indexOf('|', 3)).matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1]!),
    ]),
  );

const sceneIds = (): string[] =>
  execFileSync(process.execPath, [join(repoRoot, 'packages/gui/judge/run-judge.mjs'), '--list-items'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

const sceneCaptures = (): { scene: string; capture: string }[] =>
  execFileSync(process.execPath, [join(repoRoot, 'packages/gui/judge/run-judge.mjs'), '--list-captures'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [scene, capture] = line.split('\t');
      return { scene: scene!, capture: capture! };
    });

const reportResults = (): { item: string; facts: Record<string, boolean> | null }[] =>
  (JSON.parse(read('acceptance/evidence/judge-report.json')) as {
    results: { item: string; facts: Record<string, boolean> | null }[];
  }).results;

// An item can be recorded by more than one scene (TIMELINE_WINDOW is), so the row's set is the
// union across its records — in first-recorded order, which is the order the rubric lists them.
// The union only holds the bind if those records name disjoint facts; two scenes sharing a name
// could otherwise trade an assertion between them with the row unchanged (asserted below).
const reportFacts = (): Map<string, string[]> => {
  const byItem = new Map<string, string[]>();
  for (const r of reportResults()) {
    const names = byItem.get(r.item) ?? [];
    for (const name of Object.keys(r.facts ?? {})) if (!names.includes(name)) names.push(name);
    byItem.set(r.item, names);
  }
  return byItem;
};

const recipeIds = (): string[] =>
  execFileSync(process.execPath, [join(repoRoot, 'packages/gui/judge/record.mjs'), '--list'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

// record.mjs names a recording by its recipe id run through asciiSlug; the index cites the
// resulting file. The slug is the join between the two homes.
const recipeSlug = (id: string): string =>
  id
    .replace(/§/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const indexedGifs = (): string[] => [
  ...new Set([...read('acceptance/evidence/recordings/README.md').matchAll(/`([a-z0-9][a-z0-9-]*)\.gif`/g)].map((m) => m[1]!)),
];

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

describe('judge rubric ↔ recorded sub-facts (issue #185)', () => {
  it('the Sub-facts index and the report both cover exactly the claim rows', () => {
    const claims = rubricIds().sort();
    expect([...rubricFacts().keys()].sort(), 'Sub-facts index vs the claim table').toEqual(claims);
    expect([...reportFacts().keys()].sort(), 'judge report vs the claim table').toEqual(claims);
  });

  it('every rubric row enumerates exactly the sub-facts its scene recorded', () => {
    const recorded = reportFacts();
    const drifted = [...rubricFacts()]
      .map(([id, listed]) => ({
        id,
        missing: (recorded.get(id) ?? []).filter((f) => !listed.includes(f)),
        stale: listed.filter((f) => !(recorded.get(id) ?? []).includes(f)),
      }))
      .filter((d) => d.missing.length || d.stale.length);
    expect(drifted, 'rubric rows out of sync with the sub-facts the harness records').toEqual([]);
  });

  it('a row lists sub-facts if and only if its item is machine-scored', () => {
    const recorded = reportFacts();
    const mismatched = [...rubricFacts()]
      .filter(([id, listed]) => !listed.length !== !(recorded.get(id) ?? []).length)
      .map(([id]) => id);
    expect(mismatched, 'unscored rows carrying sub-facts, or scored rows carrying none').toEqual([]);
  });

  it('scenes recording the same item name disjoint sub-facts', () => {
    const seen = new Map<string, number>();
    for (const r of reportResults()) {
      for (const name of Object.keys(r.facts ?? {})) {
        const key = `${r.item}.${name}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    const collisions = [...seen].filter(([, n]) => n > 1).map(([key]) => key);
    expect(collisions, 'one sub-fact name recorded by two scenes of the same item').toEqual([]);
  });

  it('no row lists the same sub-fact twice', () => {
    const dupes = [...rubricFacts()]
      .filter(([, names]) => new Set(names).size !== names.length)
      .map(([id]) => id);
    expect(dupes, 'rubric rows repeating a sub-fact name').toEqual([]);
  });
});

describe('judge scene capture uniqueness (issue #283)', () => {
  it('the harness lists a non-trivial capture set', () => {
    expect(sceneCaptures().length).toBeGreaterThan(50);
  });

  it('no two scenes write the same capture file', () => {
    const writers = new Map<string, string[]>();
    for (const { scene, capture } of sceneCaptures()) {
      const scenes = writers.get(capture) ?? [];
      if (!scenes.includes(scene)) scenes.push(scene);
      writers.set(capture, scenes);
    }
    const collisions = [...writers]
      .filter(([, scenes]) => scenes.length > 1)
      .map(([capture, scenes]) => `${capture} written by [${scenes.join(', ')}]`);
    expect(collisions, 'capture files with two writers — last writer wins, every citation of it lies').toEqual([]);
  });
});

describe('record recipe ↔ recordings index bind', () => {
  it('every recipe has an index row, and every indexed recording has a recipe', () => {
    const slugs = recipeIds().map(recipeSlug);
    expect(slugs.length).toBeGreaterThan(30);
    const indexed = indexedGifs();
    expect(
      slugs.filter((s) => !indexed.includes(s)),
      'recipes with no row in acceptance/evidence/recordings/README.md',
    ).toEqual([]);
    expect(
      indexed.filter((g) => !slugs.includes(g)),
      'indexed recordings with no recipe in record.mjs',
    ).toEqual([]);
  });
});
