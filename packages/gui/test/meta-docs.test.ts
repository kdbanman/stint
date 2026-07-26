/**
 * GOLD — meta-doc bind guard (PRD §04 authoring "stateless" rule; process.html §02 R12).
 *
 * The meta-documents that describe the verification apparatus are hand-maintained and
 * machine-checked by nothing, so they drift in both directions (issue #81 — "docs lie about
 * the apparatus"): context/prd.html carried ~132 inline per-requirement status badges that a
 * stale value silently turns into a lie, and acceptance/criteria/COVERAGE.md cites test files
 * by path that a rename or delete can dangle out from under it. This applies the repo's own
 * bind-two-homes pattern (parity.test.ts / build-matrix.test.ts / cli.test.ts) to the
 * CHECKABLE half of that meta-layer, by static inspection of the two docs (no build/network):
 *
 *   1. context/prd.html contains NO status-marker markup — the §81 badge deletion holds, so a
 *      re-introduced `<span class="st …">implemented|partial|todo</span>` (or its CSS/legend)
 *      FAILS CI instead of quietly returning as spec-looking status.
 *   2. Every STRUCTURED file path COVERAGE.md cites exists in the tree — a dangling proof-map
 *      reference (a renamed or deleted test) FAILS CI.
 *
 * It only pins the mechanical facts. The "gap" vs "covered" judgment, and the prose that still
 * narrates implementation status, stay human — the requirements↔implementation sync assessment
 * is a separate concern (tracked apart from #81), not something a static check can decide.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

const prd = read('context/prd.html');
const coverage = read('acceptance/criteria/COVERAGE.md');

describe('GOLD — prd.html carries no implementation-status markers (§81)', () => {
  it('has no status-marker span markup', () => {
    // The deleted badge shape was `<span class="st st-done">implemented</span>` (also
    // st-partial / st-todo, and the bare "done" text). Any survivor or re-introduction:
    const markers = prd.match(/<span class="st\b[^"]*">[^<]*<\/span>/g) ?? [];
    expect(markers).toEqual([]);
  });

  it('has no leftover status-marker CSS or class tokens', () => {
    // The `.st` / `.st-done` / `.st-partial` / `.st-todo` rules and any class="st …" usage.
    expect(prd).not.toMatch(/class="st[ "]/);
    expect(prd).not.toMatch(/\.st-(?:done|partial|todo)\b/);
  });
});

/**
 * Build the set of every file that actually exists in the working tree (pruning heavy /
 * generated dirs), as repo-relative POSIX paths — the ground truth COVERAGE.md's citations
 * are checked against.
 */
const PRUNE = new Set(['node_modules', '.git', 'dist', 'dist-pack', 'coverage', '.claude']);
function walk(dir: string, acc: string[]): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (!PRUNE.has(ent.name)) walk(join(dir, ent.name), acc);
    } else {
      acc.push(relative(repoRoot, join(dir, ent.name)).split(sep).join('/'));
    }
  }
  return acc;
}
const tree = walk(repoRoot, []);
const treeSet = new Set(tree);

/**
 * A citation "exists" if a tracked file matches it exactly OR ends with `/<citation>`.
 * The suffix rule resolves the two package-relative conventions COVERAGE.md uses —
 * `core/…`, `gui/…`, `cli/…` (which live under `packages/…`) and sub-fragments like
 * `gold/contracts.test.ts` — with the same mechanism as a fully-rooted path. A leading
 * `app/` is the electron-builder BUNDLE root (it maps `packaging/**` → `app/packaging/**`),
 * not a source dir, so it is stripped before resolving so bundle-internal paths still verify.
 */
const existsInTree = (p: string): boolean => {
  const cands = p.startsWith('app/') ? [p, p.slice('app/'.length)] : [p];
  return cands.some((c) => treeSet.has(c) || tree.some((f) => f.endsWith('/' + c)));
};

const PATH_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|feature|json|md|sh|html|yml|yaml)$/;

/**
 * Extract the file-path citations COVERAGE.md makes inside backticks. Honest scope:
 *  - keep only tokens that end in a source/config extension (a path, not prose);
 *  - require a `/` — BARE filenames (`main.ts`, `app.js`, and the deliberately-retired
 *    `editor.js` / `report.html`) are ambiguous shorthand, not verifiable references, and a
 *    couple are cited precisely BECAUSE they are gone; structured paths are what dangle;
 *  - drop globs (`features/*.feature`) and build outputs (`/dist/`, `/dist-pack/`), which do
 *    not exist in a source checkout.
 * The `VAR = path` assignment form (e.g. "CLI_REL = packages/cli/dist/bin.js") is unwrapped
 * to its path first.
 */
const citations = new Set<string>();
for (const raw of coverage.match(/`[^`]+`/g) ?? []) {
  let t = raw.slice(1, -1).trim();
  const assigned = /^[A-Za-z_]\w*\s*=\s*(\S+)$/.exec(t);
  if (assigned) t = assigned[1] ?? t;
  if (!PATH_EXT.test(t)) continue;
  if (!t.includes('/')) continue;
  if (t.includes('*')) continue;
  if (t.includes('/dist/') || t.includes('/dist-pack/')) continue;
  citations.add(t);
}

describe('GOLD — every file path COVERAGE.md cites exists in the tree (§81)', () => {
  it('has no dangling proof-map references', () => {
    const dangling = [...citations].filter((c) => !existsInTree(c)).sort();
    expect(dangling).toEqual([]);
  });

  it('extracted a meaningful set of citations (the extractor is not silently empty)', () => {
    // Guards the guard: a regex that stopped matching would make the check above vacuous.
    expect(citations.size).toBeGreaterThan(50);
  });
});

/**
 * GOLD — every JUDGE item COVERAGE.md cites is a real rubric row (issue #167).
 *
 * The path check above only guards citations that LOOK like files. A criterion whose proof is a
 * JUDGE scene is cited by item id (`CONFIRM_DESTRUCTIVE`), and nothing bound those: #167 moved
 * §17 R11's proof off a deleted unit test onto the scenes that drive the real renderer, which
 * would have swapped a machine-checked citation for an unchecked one. This closes that: a
 * COVERAGE.md row naming a judge item that no longer exists FAILS CI, instead of reading as
 * proof of a criterion nothing proves.
 *
 * Rubric rows are the checked home because judge-bind.test.ts (#85) already binds them both ways
 * to the harness's SCENES table — so COVERAGE.md → rubric → scene resolves end to end, and this
 * leg needs no build (static, like the rest of this file).
 */
const NOT_JUDGE_ITEMS = new Set([
  // Code/config identifiers COVERAGE.md cites in the same SCREAMING_SNAKE backtick shape.
  'APP_VERSION',
  'DB_FILENAME',
  'GH_TOKEN',
  'SCHEMA_VERSION',
  'SETTING_DESCRIPTORS',
  'STINT_BUILD_N',
  'STINT_VERSION',
  'VERSION_RE',
  // NAV_SHELL's two named sub-facts. They live inside that row's prose, not as rows of their
  // own, so the harness has no scene to declare for them.
  'FIXED_WIDTH_ON_RESIZE',
  'SIDEBAR_EVERY_VIEW',
]);

describe('GOLD — every JUDGE item COVERAGE.md cites is a real rubric row (#167)', () => {
  const rubric = read('acceptance/criteria/judge-rubric.md');
  const rows = new Set([...rubric.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]!));
  const cited = new Set<string>();
  for (const raw of coverage.match(/`[^`]+`/g) ?? []) {
    const t = raw.slice(1, -1).trim();
    if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(t) && !NOT_JUDGE_ITEMS.has(t)) cited.add(t);
  }

  it('found both homes (neither reader is silently empty)', () => {
    expect(rows.size).toBeGreaterThan(30);
    expect(cited.size).toBeGreaterThan(20);
  });

  it('cites no judge item that has no rubric row', () => {
    // A failure here is either a deleted/renamed scene COVERAGE.md still claims as proof, or a
    // new non-judge identifier — add it to NOT_JUDGE_ITEMS, which is the moment to check it is
    // not actually a judge item the doc invented.
    const dangling = [...cited].filter((c) => !rows.has(c)).sort();
    expect(dangling, 'COVERAGE.md judge citations with no rubric row').toEqual([]);
  });

  it('the §17 R11 confirm proof is cited as judge scenes, not a unit mirror (#167)', () => {
    // The specific regression #167 fixed: the destructive-confirm criterion read as covered by
    // gui/test/confirm.test.ts, a pure model of the rule that nothing called, so deleting the
    // renderer's real gate would have left the suite green. Its proof is the real surface now.
    for (const id of ['CONFIRM_DESTRUCTIVE', 'CONFIRM_DELETE', 'CONFIRM_ARCHIVE']) {
      expect(cited, `${id} must stay cited as R11/R13 proof`).toContain(id);
    }
    expect(coverage).not.toMatch(/confirm\.test\.ts|src\/confirm\.ts/);
  });
});

/**
 * GOLD — the criteria docs stay line-diffable (issue #128).
 *
 * COVERAGE.md reached 177 KB in 97 physical lines, its longest line 53,141 characters, because
 * every row was a table cell that grew without bound. A hand-maintained criteria document whose
 * whole value is human review cannot be reviewed in that shape: a PR diff shows one changed
 * line, a terminal shows a wall, and grep returns 50 KB. COVERAGE.md is now hard-wrapped prose;
 * this pins the shape, so a re-flattened row FAILS CI instead of quietly returning.
 *
 * The cap is deliberately loose — a legitimate table row runs long, and this is a diffability
 * floor, not a style rule. `judge-rubric.md` is the same table-of-multi-KB-cells shape and is
 * NOT restructured here (#128 is scoped to COVERAGE.md); rather than exempt it, it carries a
 * budget at today's longest line, so it can only get shorter.
 */
const CRITERIA_DIR = 'acceptance/criteria';
const LINE_LIMIT = 500;
const BUDGETS = new Map([['judge-rubric.md', 5640]]);

describe('GOLD — acceptance/criteria/*.md stay line-diffable (#128)', () => {
  const docs = readdirSync(join(repoRoot, CRITERIA_DIR), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();

  it('found the criteria docs (the reader is not silently empty)', () => {
    expect(docs).toContain('COVERAGE.md');
    expect(docs.length).toBeGreaterThan(1);
  });

  it('no doc carries a line past its budget', () => {
    const over = docs
      .map((name) => {
        const longest = Math.max(...read(`${CRITERIA_DIR}/${name}`).split('\n').map((l) => l.length));
        return { name, longest, budget: BUDGETS.get(name) ?? LINE_LIMIT };
      })
      .filter((d) => d.longest > d.budget)
      .map((d) => `${d.name}: longest line ${d.longest} > ${d.budget}`);
    expect(over).toEqual([]);
  });
});

/**
 * GOLD — the skill set and process.html name the same skills (issue #133).
 *
 * process.html §03/§06 specify the agentic process by naming its skills; the skills live in
 * `.claude/skills/*`. Two hand-maintained homes for one fact, and the rename that motivated
 * this check (the `*-review` → `*-audit` sweep, the two triage skills merged into
 * `triage-discoveries`) is exactly the drift it catches: a skill dir renamed without the doc
 * following leaves the doc naming a skill that no longer exists, which reads as current
 * specification. Both directions, per the repo's bind-two-homes-or-fail-loud pattern.
 *
 * Scope is deliberately the NAMES only — that a skill dir exists and the doc mentions it. What
 * each skill does, and whether the doc describes it correctly, stays the sync audit's judgment
 * call (§06); no static check can decide it.
 */
const SKILLS_DIR = '.claude/skills';
const skillDirs = readdirSync(join(repoRoot, SKILLS_DIR), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
const process_ = read('context/process.html');

describe('GOLD — .claude/skills and process.html name the same skills (#133)', () => {
  it('found the skill set (the reader is not silently empty)', () => {
    expect(skillDirs.length).toBeGreaterThan(5);
  });

  it('every skill dir is named in process.html', () => {
    const unnamed = skillDirs.filter((s) => !process_.includes(`<code>${s}</code>`));
    expect(unnamed).toEqual([]);
  });

  it('every skill process.html names exists as a dir', () => {
    // Only `<code>` spans that look like a skill name (kebab-case, no dot, no slash) —
    // process.html cites files and commands in the same markup.
    const cited = new Set<string>();
    for (const m of process_.matchAll(/<code>([a-z][a-z0-9]*(?:-[a-z0-9]+)+)<\/code>/g)) {
      const name = m[1];
      if (name !== undefined && !name.includes('.')) cited.add(name);
    }
    const known = new Set(skillDirs);
    // The only kebab-case `<code>` spans process.html uses for something that is NOT a skill:
    // the orphan evidence branch and the CI job. Kept as an explicit two-name exception rather
    // than a looser pattern, so a THIRD such name has to be added deliberately here — which is
    // the moment to check it isn't actually a skill the doc invented.
    const NOT_SKILLS = new Set(['qa-evidence', 'pack-smoke']);
    const dangling = [...cited].filter((c) => !known.has(c) && !NOT_SKILLS.has(c)).sort();
    expect(dangling).toEqual([]);
  });
});
