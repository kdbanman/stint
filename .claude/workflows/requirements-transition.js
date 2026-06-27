export const meta = {
  name: 'requirements-transition',
  description:
    'Carry out the Stint old→new requirements transition end-to-end. Consumes ' +
    'requirements-transition.md as the work-list: inventory every new/modified/deleted ' +
    'requirement (with core flag, surfaces, files, mockup, AC methods, Rec flag), plan, ' +
    'implement in dependency-ordered file-disjoint waves, verify the executable AC and ' +
    'regenerate evidence, run TWO separate reviews (AC-evidence-sufficiency + ' +
    'code-quality/architecture), apply review feedback in a bounded improvement loop, ' +
    'gather screen-recording QA evidence LAST, aggregate everything into one GitHub PR, and ' +
    '— only once every requirement has passing AC evidence and both reviews are clean — ' +
    'perform the §Z old→new swap. Loops until every requirement has clear verification ' +
    'evidence aggregated into the PR. The human gate is PR merge.',
  whenToUse:
    'When you want the requirements-transition.md work-list executed in full: every pending ' +
    'requirement implemented across core/cli/gui with parity, proven by its mapped AC methods, ' +
    'reviewed twice, demonstrated by screen recordings, and packaged into one ready-for-review ' +
    'PR. Pass args to scope a calibration run to a subset of requirement ids (e.g. ' +
    'args: ["§05 R09", "§20"]); omit args for the full transition. The swap/cleanup (§Z) only ' +
    'fires on a full, all-green, unscoped run.',
  // These titles MUST match the phase() calls below, in order.
  phases: [
    { title: 'Inventory', detail: 'Parse requirements-transition.md into a structured per-requirement work-list' },
    { title: 'Plan', detail: 'Per requirement/cluster: exact file set + implementation + AC + evidence plan' },
    { title: 'Implement', detail: 'Dependency-ordered, file-disjoint waves (core→cli/gui, schema→consumers); each wave build/test-verified with a bounded repair loop' },
    { title: 'Verify', detail: 'Run/extend executable AC (BDD/PROP/GOLD/JUDGE/MANUAL) per the mapping; regenerate evidence' },
    { title: 'Review', detail: 'TWO separate passes: (a) adversarial AC-evidence-sufficiency critic, (b) code-quality & architecture review (deletion test, shallow modules, leaky seams)' },
    { title: 'Improve', detail: 'Apply both reviews’ feedback in a bounded loop-until-dry; must not regress AC' },
    { title: 'Recordings', detail: 'QA screen recordings (LAST): core-flow GUI, all Rec ▶ rows, code-change-adjacent reqs; saved under acceptance/evidence/recordings/ indexed by req id' },
    { title: 'PR', detail: 'Regenerate all evidence, commit on the working branch, open ONE ready-for-review PR with recordings linked and a per-requirement status checklist' },
    { title: 'Swap', detail: 'Only when every req has passing AC evidence AND both reviews clean: delete *-old.html / report.html / report.js / legacy workflow / this mapping, promote new docs, fix references (§Z)' },
  ],
};

// ===========================================================================
// Schemas (JSON Schema, Draft-7-ish — validated at the tool layer so agents
// retry on a miss). One schema per structured stage.
// ===========================================================================

// --- PHASE 1: Inventory ---------------------------------------------------
// Mirrors the columns of requirements-transition.md so nothing is dropped.
const WORKLIST = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      description: 'EVERY requirement row in requirements-transition.md (§2, §19, §20, plus the deleted report.html row).',
      items: {
        type: 'object',
        required: ['reqId', 'section', 'change', 'core', 'surfaces', 'files', 'acMethods', 'rec', 'summary'],
        properties: {
          reqId: { type: 'string', description: 'Stable id, e.g. "§05 R09", "§12 R-report.html", "§20 R04", "concept".' },
          section: { type: 'string', description: 'Owning section, e.g. "§05 Timer & entries".' },
          change: { enum: ['NEW', 'MODIFIED', 'DELETED'] },
          core: { type: 'boolean', description: 'True iff marked ● (core requirement per §C).' },
          surfaces: { type: 'array', items: { enum: ['core', 'cli', 'gui', 'packaging', 'CI', 'docs'] }, description: 'Surfaces touched (the Surfaces/Files columns).' },
          files: { type: 'array', items: { type: 'string' }, description: 'Implementation files/areas named in the Files column (verbatim where given).' },
          mockup: { type: 'array', items: { type: 'string' }, description: 'Mockup file(s) depicting it (Mockup column); empty if "—".' },
          acMethods: { type: 'array', items: { enum: ['BDD', 'PROP', 'GOLD', 'JUDGE', 'MANUAL'] }, description: 'Executable AC method(s) from the AC column; empty for docs-only/meta rows.' },
          rec: { type: 'boolean', description: 'True iff the Rec column is ▶ (screen recording required in QA evidence).' },
          isGui: { type: 'boolean', description: 'True iff this requirement has a GUI surface (drives recording scope §W).' },
          summary: { type: 'string', description: 'One-line intent from the Summary column.' },
        },
      },
    },
    globalDecisions: {
      type: 'array', description: 'The §1 G-decisions (id + text) that shape multiple requirements.',
      items: { type: 'object', required: ['id', 'text'], properties: { id: { type: 'string' }, text: { type: 'string' } } },
    },
    swapTargets: {
      type: 'object', description: 'The §Z swap/cleanup work-list, captured now so the final phase is data-driven.',
      required: ['deletePaths', 'referenceFixes'],
      properties: {
        deletePaths: { type: 'array', items: { type: 'string' }, description: 'Files to delete at swap (*-old.html, report.html/js, legacy workflow, this mapping).' },
        referenceFixes: { type: 'array', items: { type: 'string' }, description: 'Docs whose references must point only at the new docs/entities (README, CLAUDE.md, COVERAGE.md, parity-matrix.json).' },
      },
    },
    recordingScope: {
      type: 'array', description: 'Req ids that need a screen recording per §W (core-flow GUI ∪ Rec ▶ ∪ code-change-adjacent GUI).',
      items: { type: 'string' },
    },
  },
};

// --- PHASE 2: Plan --------------------------------------------------------
const PLAN = {
  type: 'object',
  required: ['reqId', 'files', 'steps', 'acPlan', 'evidencePlan', 'recordingPlan', 'dependsOn', 'needsWorktree'],
  properties: {
    reqId: { type: 'string' },
    change: { enum: ['NEW', 'MODIFIED', 'DELETED'] },
    files: { type: 'array', items: { type: 'string' }, description: 'EVERY file this requirement creates/edits/deletes (code AND tests AND schema/rubric/runbook/parity/coverage/mockup/doc). Used to schedule disjoint waves — be complete and precise.' },
    steps: { type: 'string', description: 'Concrete implementation steps, including schema migration ordering where a new table is added.' },
    acPlan: {
      type: 'array',
      description: 'One entry per AC method this requirement needs (per its acMethods).',
      items: { type: 'object', required: ['method', 'file', 'what'], properties: { method: { enum: ['BDD', 'PROP', 'GOLD', 'JUDGE', 'MANUAL'] }, file: { type: 'string' }, what: { type: 'string', description: 'The exact assertion/scenario that would fail if the behavior regressed.' } } },
    },
    evidencePlan: { enum: ['evidence', 'judge', 'both', 'none'], description: 'Which regen step refreshes this requirement’s evidence.' },
    recordingPlan: { type: 'string', description: 'If this req is in the recording scope: which GUI state/flow to drive and what the video must show. "none" if not recorded.' },
    dependsOn: { type: 'array', items: { type: 'string' }, description: 'reqIds that must land first (schema before consumers; core query before its GUI view; nav shell before settings view).' },
    needsWorktree: { type: 'boolean', description: 'True iff this work is likely to conflict on a shared file even after wave scheduling (rare; triggers worktree isolation).' },
  },
};

// --- PHASE 3: Implement ---------------------------------------------------
const IMPL = {
  type: 'object',
  required: ['reqId', 'filesChanged', 'testsAdded', 'parityRows', 'notes'],
  properties: {
    reqId: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'array', items: { type: 'string' }, description: 'AC test files created/extended for this requirement.' },
    parityRows: { type: 'array', items: { type: 'string' }, description: 'New GUI IPC channels added to parity-matrix.json (empty if none).' },
    blockedOnFile: { type: 'array', items: { type: 'string' }, description: 'Files owned by another requirement that this work turned out to need (do NOT edit them — report instead).' },
    notes: { type: 'string', description: 'What was built and any deviation from plan.' },
  },
};

// --- shared SUITE result (build/test/evidence runs) -----------------------
const SUITE = {
  type: 'object',
  required: ['build', 'testPassed', 'judge', 'evidence', 'noNetwork', 'failures', 'summary'],
  properties: {
    build: { type: 'boolean' },
    testPassed: { type: 'boolean' },
    judge: { type: 'boolean' },
    evidence: { type: 'boolean' },
    noNetwork: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' }, description: 'Failing test names / commands with the key error line.' },
    summary: { type: 'string' },
  },
};

// --- PHASE 5a: AC-evidence-sufficiency review -----------------------------
// Adversarial completeness critic. Defaults to insufficient.
const AC_VERDICT = {
  type: 'object',
  required: ['reqId', 'implemented', 'hasPassingAC', 'reflectedInEvidence', 'verdict', 'gaps'],
  properties: {
    reqId: { type: 'string' },
    implemented: { type: 'boolean', description: 'Behavior actually exists in the named surfaces as the requirement requires.' },
    hasPassingAC: { type: 'boolean', description: '≥1 of the mapped methods has a PASSING, non-trivial assertion that would fail on regression (not a stub/skip).' },
    reflectedInEvidence: { type: 'boolean', description: 'Present in COVERAGE.md AND the regenerated evidence (cli-transcript / judge-report / parity-matrix).' },
    verdict: { enum: ['sufficient', 'insufficient'], description: 'sufficient ONLY if implemented AND hasPassingAC AND reflectedInEvidence.' },
    gaps: { type: 'array', items: { type: 'string' }, description: 'Exactly what is missing; empty only when sufficient.' },
  },
};

// --- PHASE 5b: Code-quality & architecture review -------------------------
// Matt-Pocock-style: shallow modules, leaky seams, locality, cognitive bounce, deletion test.
const ARCH_REVIEW = {
  type: 'object',
  required: ['findings', 'topRecommendation', 'clean'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'kind', 'locations', 'rating', 'deletionTest', 'recommendation'],
        properties: {
          title: { type: 'string' },
          kind: { enum: ['shallow-module', 'leaky-seam', 'poor-locality', 'cognitive-bounce', 'duplication', 'dead-code', 'other'] },
          locations: { type: 'array', items: { type: 'string' }, description: 'file:symbol references.' },
          rating: { enum: ['Strong', 'Worth exploring', 'Speculative'] },
          deletionTest: { type: 'string', description: 'Can this code/abstraction be deleted or inlined without loss? Result of applying the deletion test.' },
          recommendation: { type: 'string', description: 'Concrete refactor; must not change behavior or weaken any AC.' },
        },
      },
    },
    topRecommendation: { type: 'string', description: 'The single highest-value change.' },
    clean: { type: 'boolean', description: 'True iff there are no Strong findings left to act on.' },
  },
};

// --- PHASE 7: Recordings --------------------------------------------------
const RECORDING = {
  type: 'object',
  required: ['reqId', 'captured', 'path', 'shows', 'notes'],
  properties: {
    reqId: { type: 'string' },
    captured: { type: 'boolean', description: 'False if the harness lacks the capability — note it, never fake it.' },
    path: { type: 'string', description: 'acceptance/evidence/recordings/<reqId>.webm (or "" if not captured).' },
    shows: { type: 'string', description: 'What the video demonstrates (the requirement being exercised).' },
    notes: { type: 'string', description: 'If captured=false, the missing capability and what a human must do instead.' },
  },
};

// --- PHASE 8: PR ----------------------------------------------------------
const PR_RESULT = {
  type: 'object',
  required: ['committed', 'prUrl', 'checklist', 'summary'],
  properties: {
    committed: { type: 'boolean' },
    prUrl: { type: 'string' },
    checklist: { type: 'array', items: { type: 'object', required: ['reqId', 'status'], properties: { reqId: { type: 'string' }, status: { enum: ['done', 'partial', 'blocked'] }, note: { type: 'string' } } } },
    summary: { type: 'string' },
  },
};

// ===========================================================================
// Shared context every coding/AC agent needs (keeps prompts lean & consistent)
// ===========================================================================
const REPO = `Repo: Stint, a TypeScript monorepo at the cwd. Surfaces are EQUAL: @stint/core
(packages/core), the tt CLI (packages/cli), and the Electron GUI (packages/gui). ALL logic
lives in @stint/core; CLI and GUI are thin shells over it. Parity (PRD §17 R8) is mandatory:
favorites and saved reports must each be fully reachable from both tt and the GUI.

This run is driven by requirements-transition.md (the work-list). New requirement text is
specified inline there; the legacy text is in *-old.html. macOS + Linux only — Windows is
dropped everywhere (code, build matrix, docs, %APPDATA% path).

Conventions you MUST follow (do not invent new structure):
- BDD: features/*.feature (Gherkin); steps in packages/core/test/bdd/steps.ts; every scenario
  runs TWICE (core + tt) via run.test.ts — write surface-neutral steps.
- PROP: packages/core/test/prop/*.test.ts (fast-check) for money/integrity invariants.
- GOLD: packages/cli/test/gold/cli.test.ts and packages/core/test/gold/contracts.test.ts;
  JSON Schemas in acceptance/schemas/<command>.schema.json (Draft 7).
- JUDGE: acceptance/judge-rubric.md + packages/gui/judge/run-judge.mjs (Playwright, pinned
  clock JUDGE_NOW) + fixtures in packages/gui/judge/fixtures.mjs.
- MANUAL: append a "CHECK <TITLE>" procedure to acceptance/manual/runbook.md.
- Parity: every new GUI IPC channel in packages/gui/src/ipc.ts CHANNELS gets a row in
  acceptance/parity-matrix.json (asserted by packages/gui/test/parity.test.ts).
- Coverage index: acceptance/COVERAGE.md is hand-maintained — add/refresh the PRD row.
- New core entities (favorite, report) need a schema/migration in packages/core, then CLI
  (tt fav …, tt report save|ls|show|rm|run) and GUI (Timer favorites rail, Reports view).
Commands: npm run build · npm test · npm run test:bdd|test:prop|test:gold · npm run judge
· npm run evidence · npm run verify:no-network. Node ≥22.5; node:sqlite; NO network ever.`;

// ===========================================================================
// PHASE 1 — Inventory: parse requirements-transition.md into a work-list.
// ===========================================================================
phase('Inventory');
const inv = await agent(
  `${REPO}

Read requirements-transition.md IN FULL (it is the work-list), plus acceptance/COVERAGE.md and
acceptance/parity-matrix.json for the current state. Parse EVERY requirement row in the §2
section-by-section tables, the §19 packaging table, and the §20 hardening table — including the
docs-only "concept" row and the DELETED "§12 R-report.html" row. For each requirement capture:
reqId, section, change (NEW/MODIFIED/DELETED), core (● → true), surfaces, the Files column
(verbatim where given), mockup(s), acMethods (BDD/PROP/GOLD/JUDGE/MANUAL — empty for docs/meta
rows), rec (▶ → true), isGui (true iff it has a gui surface), and the one-line summary.

Also return: globalDecisions (the §1 G1–G13 table), swapTargets (the §Z deletePaths and
referenceFixes), and recordingScope — the union, per §W, of (1) every GUI requirement marked
core, (2) every Rec ▶ row, and (3) every code-change-adjacent GUI requirement (the §19 update
flow R03/R04 and §20 backup/restore R04/R05). Be exhaustive: a row missed here never gets built,
verified, or recorded.`,
  { label: 'inventory', phase: 'Inventory', agentType: 'Explore', schema: WORKLIST, effort: 'high' }
);

// scopeTo: narrow a calibration run to a subset of requirement ids. args may be a string,
// an array of strings, or { scopeTo: [...] }. Each token is matched case-insensitively
// (substring) against "reqId section summary". Omit args for the full transition.
function normalizeScope(a) {
  if (a == null) return null;
  const raw = Array.isArray(a) ? a : (typeof a === 'object' ? (a.scopeTo || a.scope || []) : [a]);
  const toks = (Array.isArray(raw) ? raw : [raw]).map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  return toks.length ? toks : null;
}
const scope = normalizeScope(args);
const FULL_RUN = !scope; // swap/cleanup (§Z) only fires on an unscoped, all-green run.

let work = inv.items;
if (scope) {
  work = work.filter((w) => scope.some((s) => `${w.reqId} ${w.section} ${w.summary}`.toLowerCase().includes(s)));
  log(`scopeTo ${JSON.stringify(scope)} → ${work.length} of ${inv.items.length} requirements in scope.`);
  if (!work.length) return { scopedOut: true, scope, note: 'No inventoried requirement matched the scope tokens; nothing to do.' };
}

// Requirements an agent actually builds/tests vs. pure-doc rows. The "concept" doc-only row and
// the DELETED report.html row carry no executable AC; they are handled by the doc/swap stages.
const buildable = work.filter((w) => w.change !== 'DELETED' && (w.acMethods || []).length > 0);
const docOnly = work.filter((w) => (w.acMethods || []).length === 0 && w.change !== 'DELETED');
const deletions = work.filter((w) => w.change === 'DELETED');
log(`Inventory: ${work.length} requirements (${buildable.length} buildable, ${docOnly.length} doc-only, ${deletions.length} deletions); ` +
    `recording scope ${(inv.recordingScope || []).length}${scope ? ' (scoped)' : ''}.`);

// ===========================================================================
// PHASE 2 — Plan: one plan per buildable requirement. BARRIER is justified: the
// wave scheduler needs ALL file lists at once to compute disjoint batches.
// Doc-only rows get a single lightweight plan handled in the doc wave.
// ===========================================================================
phase('Plan');
const plans = (await parallel(
  buildable.map((w) => () =>
    agent(
      `${REPO}

Plan the work to fully deliver requirement ${w.reqId} — ${w.summary}
(change ${w.change}; core ${w.core}; surfaces ${(w.surfaces || []).join('+')}; AC ${(w.acMethods || []).join('/')};
files hint: ${(w.files || []).join(', ') || 'none given'}; mockup: ${(w.mockup || []).join(', ') || 'none'};
recording required: ${w.rec ? 'YES (▶)' : 'no'}).

Read the relevant source, the inline spec in requirements-transition.md, and the mockup(s) before
planning. Return the EXACT, COMPLETE set of files you will create/edit/delete (code AND tests AND
schema/rubric/runbook/parity/coverage/mockup/prd.html section) — this list schedules non-conflicting
parallel work, so precision matters. Provide concrete steps (for a NEW table: schema/migration FIRST,
then core query, then CLI, then GUI). Provide an acPlan covering EVERY AC method in this requirement's
AC column, each with the precise assertion. State the evidence regen step (evidence/judge/both/none).
If this requirement is in the recording scope, give a recordingPlan (which GUI state/flow to drive,
what the video must show); else "none". List dependsOn (schema before consumers; core query before its
GUI view; nav shell before settings view). Set needsWorktree true ONLY if you expect a hard file
conflict that wave scheduling can't resolve.`,
      { label: `plan:${w.reqId}`, phase: 'Plan', schema: PLAN, effort: 'high' }
    )
  )
)).filter(Boolean);
const planById = new Map(plans.map((p) => [p.reqId, p]));

// ---------------------------------------------------------------------------
// Scheduler: dependency-ordered, file-DISJOINT waves. Items in the same wave
// touch NO common file, so parallel agents edit the shared tree without conflict
// (no worktree merge needed). dependsOn is honored ACROSS waves; core/schema land
// before their consumers because plans declare those edges. A "core" or schema
// file appearing in two plans forces them into different waves automatically.
// ---------------------------------------------------------------------------
function buildWaves(plansList, byId) {
  const remaining = new Set(plansList.map((p) => p.reqId));
  const done = new Set();
  const waves = [];
  let guard = 0;
  while (remaining.size && guard++ < 50) {
    // Ready = all declared deps already landed (or out of scope / unknown).
    const ready = [...remaining].filter((id) =>
      (byId.get(id).dependsOn || []).every((d) => done.has(d) || !byId.has(d)));
    const pool = ready.length ? ready : [...remaining]; // break dependency cycles defensively
    const wave = [];
    const claimed = new Set();
    for (const id of pool) {
      const files = byId.get(id).files || [];
      if (files.some((f) => claimed.has(f))) continue; // shares a file with someone already in this wave → defer
      files.forEach((f) => claimed.add(f));
      wave.push(id);
    }
    if (!wave.length) { // every ready item collides on a file with each other — admit one to make progress
      const id = pool[0];
      wave.push(id);
    }
    wave.forEach((id) => { remaining.delete(id); done.add(id); });
    waves.push(wave);
  }
  if (remaining.size) waves.push([...remaining]); // safety net
  return waves;
}
const waves = buildWaves(plans, planById);
log(`Scheduled ${plans.length} requirements into ${waves.length} file-disjoint waves: ${waves.map((w) => w.length).join(' → ')}`);

// Any plan that flagged needsWorktree gets worktree isolation so its edits never
// collide with concurrent agents; merged back by the verify agent for its wave.
const worktreeIds = new Set(plans.filter((p) => p.needsWorktree).map((p) => p.reqId));
if (worktreeIds.size) log(`Worktree isolation requested for: ${[...worktreeIds].join(', ')}`);

// ===========================================================================
// PHASE 3 — Implement, wave by wave. Within a wave: parallel coding (disjoint
// files). After each wave: ONE verify agent builds + tests the whole tree
// (serialized so concurrent dist/ writes can't clash), then a bounded repair loop.
// ===========================================================================
phase('Implement');
for (let w = 0; w < waves.length; w++) {
  const ids = waves[w];
  log(`Wave ${w + 1}/${waves.length}: implementing ${ids.join(', ')}`);
  await parallel(
    ids.map((id) => () => {
      const p = planById.get(id);
      const wreq = work.find((x) => x.reqId === id);
      const opts = { label: `impl:${id}`, phase: 'Implement', schema: IMPL };
      if (worktreeIds.has(id)) opts.isolation = 'worktree';
      return agent(
        `${REPO}

Implement requirement ${id} to completion, INCLUDING its co-located acceptance tests.
Change type: ${p.change || wreq.change}. ${wreq && wreq.core ? 'This is a CORE requirement (data integrity / loss-protection / core entry) — be especially careful with atomicity, invariants, and durability.' : ''}
Plan:
- Files: ${p.files.join(', ')}
- Steps: ${p.steps}
- AC to add now: ${p.acPlan.map((a) => `${a.method} in ${a.file} (${a.what})`).join('; ')}

Put real behavior in @stint/core where logic belongs; keep CLI/GUI thin and at PARITY. For a new
table (favorite/report) write the schema/migration and core query first, then wire CLI and GUI over
the SAME core API. Add any new GUI IPC channel to packages/gui/src/ipc.ts CHANNELS and a row in
acceptance/parity-matrix.json. Write the BDD/PROP/GOLD/JUDGE-fixture/MANUAL artifacts named in the
plan as you go. Match surrounding style and the conventions above.

Do NOT run \`npm run build\` or \`npm test\` (a verify agent runs them for the whole wave to avoid
concurrent build clashes) — but type-check your reasoning carefully. Only touch files in your plan;
if you discover you need a file another requirement owns, put it in blockedOnFile and report it
instead of editing.`,
        opts
      );
    })
  );
  // Verify the wave green, repair up to twice (bounded loop).
  let green = false;
  for (let attempt = 0; attempt < 3 && !green; attempt++) {
    const check = await agent(
      `${REPO}

Run \`npm run build\` then \`npm test\`. Report build success, whether ALL tests pass, and the exact
failing test names with the key error line for any failures. Do not fix anything — just report.
(judge/evidence/noNetwork: report false here; they run in the Verify phase.)`,
      { label: `verify-wave-${w + 1}`, phase: 'Implement', schema: SUITE, effort: 'high' }
    );
    if (check.build && check.testPassed) { green = true; break; }
    log(`Wave ${w + 1} red (attempt ${attempt + 1}): ${(check.failures || []).slice(0, 5).join(' | ')}`);
    await agent(
      `${REPO}

The wave's build/tests are failing. Fix ONLY what is broken — do not redesign. Failures:
${(check.failures || []).join('\n')}
Touch the minimum set of files (code or the new tests) to make \`npm run build && npm test\` green for
what this wave added, WITHOUT weakening any assertion. Then stop.`,
      { label: `repair-wave-${w + 1}-${attempt + 1}`, phase: 'Implement' }
    );
  }
  if (!green) log(`⚠ Wave ${w + 1} still red after repair attempts — carrying failures into the Verify phase.`);
}

// Doc-only rows (the concept rewrite, prd.html badge/section text, mockup sync) — these touch
// only docs/HTML and the prd.html section text, so run them together after code lands.
if (docOnly.length) {
  log(`Doc wave: ${docOnly.map((d) => d.reqId).join(', ')}`);
  await parallel(
    docOnly.map((d) => () =>
      agent(
        `${REPO}

Apply the documentation change for ${d.reqId} — ${d.summary} (files hint: ${(d.files || []).join(', ') || 'docs'}).
Edit the new docs (prd.html / concept.html / glossary.html / acceptance.html) and any mockup named,
rendering the inline spec from requirements-transition.md in the legacy house style: add the \`core\`
badge where ● is marked, drop every Windows/%APPDATA% mention, and cross-reference §20 hardening where
the mapping says to. Keep mockups in sync with the PRD (PRD §18). Do NOT touch the *-old.html files
(they are deleted at swap). Touch only docs/mockups.`,
        { label: `doc:${d.reqId}`, phase: 'Implement' }
      )
    )
  );
}

// ===========================================================================
// PHASE 4 — Verify (AC): run/extend the executable AC per the mapping, then
// regenerate ALL evidence once, serialized. First fill cross-cutting AC/index
// files the per-requirement work didn't own, then regen.
// ===========================================================================
phase('Verify');
await parallel([
  () => agent(
    `${REPO}

Update acceptance/parity-matrix.json so EVERY GUI IPC channel now in packages/gui/src/ipc.ts CHANNELS
(including the new favorite and saved-report channels) has a row mapping it to its tt command path(s)
— §17 R14 parity for the new entities. Confirm packages/gui/test/parity.test.ts still asserts
completeness; extend it only if the channel-extraction shape changed. Run \`npm run test:gold\` and
report pass/fail in your notes.`,
    { label: 'cover:parity', phase: 'Verify' }
  ),
  () => agent(
    `${REPO}

Extend the JUDGE apparatus for the new/changed GUI surfaces: the full Timer view with the favorites
rail (§12 R14, §05 R09/R10), the in-sidebar Reports view = saved reports (§12 R08), the visual
time-range picker (§12 R15), the always-present fixed-width sidebar shell (§12 R03), the single-click
popover / removed dropdown (§12 R01), and the one-clickability convention (§15). Add rubric items to
acceptance/judge-rubric.md (machine-checkable → deterministic Playwright assertion in
packages/gui/judge/run-judge.mjs; subjective → screenshot-only pass:null). Add fixtures to
packages/gui/judge/fixtures.mjs (keep the pinned clock JUDGE_NOW). Do NOT run the judge harness yet.
Keep existing items intact.`,
    { label: 'cover:judge', phase: 'Verify' }
  ),
  () => agent(
    `${REPO}

Append MANUAL "CHECK <TITLE>" procedures to acceptance/manual/runbook.md for the OS-reality items this
transition introduced: §16 update-mid-timer / backup-on-launch / corruption-recovery; §17 R12 backups
& recovery; §17 R13 install & update; §19 R01–R06 (build matrix, single installer, in-app update
check/download, publish-on-merge, date/build versioning); §20 R03/R05 integrity-check & corruption
recovery. Numbered steps + verify bullets, matching the existing format. Don't duplicate existing
procedures.`,
    { label: 'cover:manual', phase: 'Verify' }
  ),
]);

const suite = await agent(
  `${REPO}

Run, in order, and report each result precisely:
  npm run build
  npm test
  npm run verify:no-network
  npm run judge        (regenerates acceptance/evidence/judge-report.json + screenshots/)
  npm run evidence     (regenerates acceptance/evidence/cli-transcript.md)
Return build, testPassed, judge, evidence, noNetwork booleans, the list of any failures with their
key error line, and a one-paragraph summary. Do not fix anything here.`,
  { label: 'regen-evidence', phase: 'Verify', schema: SUITE, effort: 'high' }
);
log(`Verify/evidence: build=${suite.build} tests=${suite.testPassed} judge=${suite.judge} evidence=${suite.evidence} no-network=${suite.noNetwork}`);

// ===========================================================================
// PHASE 5 — Review: TWO SEPARATE passes (mapping §R). Each produces feedback
// that feeds the Improve loop. They are deliberately different agents with
// different schemas, mandates, and defaults.
//   (a) AC-evidence-sufficiency — per requirement, adversarial, defaults insufficient.
//   (b) Code-quality & architecture — whole-diff, Matt-Pocock deletion-test method.
// ===========================================================================
phase('Review');

// --- 5a. AC-evidence-sufficiency review (per buildable requirement) -------
const acVerdicts = (await parallel(
  buildable.map((w) => () =>
    agent(
      `${REPO}

ADVERSARIAL AC-EVIDENCE-SUFFICIENCY REVIEW for requirement ${w.reqId} — ${w.summary}.
Default to "insufficient" and only upgrade to "sufficient" if you can PROVE all three:
  1. implemented — the behavior actually exists across its surfaces (${(w.surfaces || []).join('+')}) as the
     inline spec in requirements-transition.md requires, AT PARITY where it has both cli and gui;
  2. hasPassingAC — at least one of its mapped methods (${(w.acMethods || []).join('/')}) has a PASSING,
     non-trivial assertion that would FAIL if the behavior regressed — read the test and run the
     relevant suite (\`npm run test:bdd|test:prop|test:gold\`, grep the rubric/runbook). A skipped test,
     a stub, or an assertion that can't fail = NOT passing AC.
  3. reflectedInEvidence — there is a COVERAGE.md row AND the regenerated evidence
     (cli-transcript / judge-report / parity-matrix) reflects it.
List the precise gaps. Be a hostile critic: when in doubt, "insufficient".`,
      { label: `review-ac:${w.reqId}`, phase: 'Review', agentType: 'Explore', schema: AC_VERDICT, effort: 'high' }
    )
  )
)).filter(Boolean);
const acInsufficient = acVerdicts.filter((v) => v.verdict === 'insufficient');
log(`Review 5a (AC sufficiency): ${acVerdicts.length - acInsufficient.length} sufficient, ${acInsufficient.length} insufficient.`);

// --- 5b. Code-quality & architecture review (whole diff) ------------------
const archReview = await agent(
  `${REPO}

CODE-QUALITY & ARCHITECTURE REVIEW of everything this transition changed (diff against the merge-base
of the working branch). Adapt Matt Pocock's improve-codebase-architecture method:
  - Hunt SHALLOW MODULES (big interface, little behind it), LEAKY SEAMS (abstractions that force
    callers to know internals; core logic that leaked into cli/gui shells), POOR LOCALITY (related
    logic scattered; the favorite/report flows split awkwardly across core/cli/gui), and COGNITIVE
    BOUNCE (a reader must jump across many files to follow one behavior).
  - Apply the DELETION TEST to every new abstraction/module/wrapper: could it be deleted or inlined
    with no loss? If yes, that's a finding.
  - Pay attention to the new core entities (favorite, report), the schema/migration, the visual
    time-range picker component, and the durability/backup code (§20).
Rate each finding Strong / Worth exploring / Speculative, give file:symbol locations, state the
deletion-test result, and a concrete behavior-preserving recommendation. Give ONE topRecommendation.
Set clean=true ONLY if there are no Strong findings left. Recommendations must NOT weaken any AC.`,
  { label: 'review-arch', phase: 'Review', agentType: 'Explore', schema: ARCH_REVIEW, effort: 'high' }
);
const strongFindings = (archReview.findings || []).filter((f) => f.rating === 'Strong');
log(`Review 5b (architecture): ${(archReview.findings || []).length} findings (${strongFindings.length} Strong); clean=${archReview.clean}. Top: ${archReview.topRecommendation}`);

// ===========================================================================
// PHASE 6 — Improve: apply both reviews' feedback in a bounded loop-until-dry.
// Each round: fix AC-insufficient requirements (parallel, file-disjoint where
// possible) + apply Strong architecture findings, re-run the affected suites,
// then re-review. Stop when both reviews are clean or fuel runs out. Must not
// regress AC: every round ends by confirming build+test green.
// ===========================================================================
phase('Improve');
let openAc = new Set(acInsufficient.map((v) => v.reqId));
let archClean = archReview.clean && strongFindings.length === 0;
let lastArch = archReview;
const FUEL = budget && budget.total
  ? Math.max(2, Math.min(4, Math.floor(budget.remaining() / 250_000)))
  : 3;

for (let round = 0; round < FUEL && (openAc.size || !archClean); round++) {
  log(`Improve round ${round + 1}/${FUEL}: ${openAc.size} AC-insufficient, arch ${archClean ? 'clean' : 'has Strong findings'}.`);

  const fixes = [];
  // AC fixes — one agent per insufficient requirement (small set; disjoint by reqId scope).
  for (const id of openAc) {
    const v = acVerdicts.find((x) => x.reqId === id) || { gaps: [] };
    const wreq = work.find((x) => x.reqId === id) || {};
    fixes.push(() =>
      agent(
        `${REPO}

Close the AC-evidence gaps for ${id} — ${wreq.summary || ''}. Gaps: ${(v.gaps || []).join('; ') || 'see review'}.
Implement any missing behavior AND/OR add the missing REAL AC assertion (mapped methods
${(wreq.acMethods || []).join('/')}; not a stub/skip) AND/OR add the missing COVERAGE.md row / parity row.
Then run the affected suite to confirm it goes green. Touch the minimum files; do not weaken other
assertions.`,
        { label: `improve-ac:${id}-r${round + 1}`, phase: 'Improve' }
      )
    );
  }
  // Architecture fixes — apply Strong findings only (Worth-exploring/Speculative are advisory).
  const strong = (lastArch.findings || []).filter((f) => f.rating === 'Strong');
  if (strong.length) {
    fixes.push(() =>
      agent(
        `${REPO}

Apply these Strong code-quality/architecture findings WITHOUT changing behavior or weakening any AC:
${strong.map((f, i) => `${i + 1}. [${f.kind}] ${f.title} @ ${(f.locations || []).join(', ')} — ${f.recommendation} (deletion test: ${f.deletionTest})`).join('\n')}
Refactor conservatively, keep core/cli/gui parity, then run \`npm run build && npm test\` and confirm
green. If a finding turns out to be wrong or risky, skip it and say why in your result.`,
        { label: `improve-arch-r${round + 1}`, phase: 'Improve' }
      )
    );
  }
  if (fixes.length) await parallel(fixes);

  // Guard: improvements must not regress AC. Rebuild + retest before re-reviewing.
  const guard = await agent(
    `${REPO}

Run \`npm run build && npm test && npm run verify:no-network\`, then regenerate evidence
(\`npm run judge\` and \`npm run evidence\`). Report build/testPassed/judge/evidence/noNetwork and any
failures with the key error line. Do not fix anything.`,
    { label: `improve-guard-r${round + 1}`, phase: 'Improve', schema: SUITE, effort: 'high' }
  );
  if (!(guard.build && guard.testPassed)) {
    log(`⚠ Improve round ${round + 1} regressed the build/tests: ${(guard.failures || []).slice(0, 5).join(' | ')} — repairing before re-review.`);
    await agent(
      `${REPO}

The last improvement pass broke the build/tests. Fix ONLY what regressed, minimally, without weakening
assertions, until \`npm run build && npm test\` is green again. Then stop.`,
      { label: `improve-repair-r${round + 1}`, phase: 'Improve' }
    );
  }

  // Re-run BOTH reviews over the (now smaller) open set to decide loop termination.
  const reAc = (await parallel(
    [...openAc].map((id) => () => {
      const wreq = work.find((x) => x.reqId === id) || {};
      return agent(
        `${REPO}

Re-run the ADVERSARIAL AC-EVIDENCE-SUFFICIENCY check for ${id} — ${wreq.summary || ''}. Same bar as before:
sufficient ONLY if implemented AND a mapped method (${(wreq.acMethods || []).join('/')}) has a passing
non-trivial assertion AND it's reflected in COVERAGE.md + regenerated evidence. Default insufficient.`,
        { label: `review-ac:${id}-r${round + 1}`, phase: 'Improve', agentType: 'Explore', schema: AC_VERDICT, effort: 'high' }
      );
    })
  )).filter(Boolean);
  reAc.filter((v) => v.verdict === 'sufficient').forEach((v) => openAc.delete(v.reqId));
  // keep latest verdict text for any still-open req so next round's gaps are fresh
  reAc.forEach((v) => { const i = acVerdicts.findIndex((x) => x.reqId === v.reqId); if (i >= 0) acVerdicts[i] = v; });

  lastArch = await agent(
    `${REPO}

Re-run the CODE-QUALITY & ARCHITECTURE review over the current diff (same Matt-Pocock method,
deletion test, Strong/Worth-exploring/Speculative ratings). Report remaining findings and set
clean=true ONLY if no Strong findings remain.`,
    { label: `review-arch-r${round + 1}`, phase: 'Improve', agentType: 'Explore', schema: ARCH_REVIEW, effort: 'high' }
  );
  archClean = lastArch.clean && (lastArch.findings || []).every((f) => f.rating !== 'Strong');
}
if (openAc.size) log(`⚠ AC still insufficient after ${FUEL} rounds: ${[...openAc].join(', ')} — surfaced in the PR checklist.`);
if (!archClean) log(`⚠ Architecture review not clean after ${FUEL} rounds; Strong findings remain — surfaced in the PR.`);

// Gate for the recording + swap stages: every BUILDABLE requirement has sufficient AC evidence
// AND both reviews are clean. Doc-only rows and deletions don't carry AC; they don't block.
const allAcSufficient = openAc.size === 0;
const reviewsClean = allAcSufficient && archClean;

// ===========================================================================
// PHASE 7 — Recordings (QA evidence). GATED TO RUN LAST: only after plan →
// implement → verify(AC) → both reviews → improve. These are NOT executable AC;
// they are PR QA evidence. Scope per §W: core-flow GUI ∪ Rec ▶ ∪ code-change-
// adjacent GUI. Drive the GUI via the repo's existing Playwright/judge harness
// with video recording; if a capability is missing, NOTE it — never fake it.
// ===========================================================================
phase('Recordings');
// recordingScope from inventory ∩ in-scope work; only GUI requirements.
const recScope = (inv.recordingScope || []).filter((id) => work.some((w) => w.reqId === id));
const recTargets = recScope.length
  ? recScope
  : work.filter((w) => w.isGui && (w.rec || w.core)).map((w) => w.reqId); // fallback if inventory omitted the union

if (!recTargets.length) {
  log('Recordings: no GUI requirements in scope; skipping the recording stage.');
} else if (!reviewsClean) {
  // Still attempt recordings (they aid PR review) but flag that the gate isn't met.
  log(`Recordings: proceeding for ${recTargets.length} GUI reqs, but reviews are NOT clean — recordings are best-effort evidence, not a pass signal.`);
} else {
  log(`Recordings: capturing ${recTargets.length} GUI requirements (reviews clean).`);
}

let recordings = [];
if (recTargets.length) {
  // One harness-extension agent first establishes a video-capable driver, then per-req captures
  // run in parallel writing to distinct files (acceptance/evidence/recordings/<reqId>.webm).
  await agent(
    `${REPO}

Set up screen-RECORDING capability by reusing the existing JUDGE harness (packages/gui/judge/
run-judge.mjs + fixtures.mjs, Playwright + pinned clock). Add a recording entry point (e.g.
packages/gui/judge/record.mjs) that launches the SAME renderer/window setup but with Playwright
\`recordVideo\` enabled, driving a named fixture state and saving a .webm to
acceptance/evidence/recordings/<reqId>.webm. Create the recordings/ directory. Do NOT change any
existing judge behavior or rubric. If the headless Chromium build here cannot record video, do not
fake anything — instead make the entry point clearly report the missing capability so per-req agents
can surface it. Build if needed.`,
    { label: 'rec:setup', phase: 'Recordings' }
  );

  recordings = (await parallel(
    recTargets.map((id) => () => {
      const wreq = work.find((x) => x.reqId === id) || {};
      const p = planById.get(id);
      return agent(
        `${REPO}

Capture the screen-recording QA evidence for GUI requirement ${id} — ${wreq.summary || ''}.
${p && p.recordingPlan && p.recordingPlan !== 'none' ? `Recording plan: ${p.recordingPlan}` : 'Drive the GUI flow that exercises this requirement end to end (the fixture state that shows it working).'}
Use the recording entry point from rec:setup (Playwright recordVideo over the real renderer, pinned
clock). Save to acceptance/evidence/recordings/${id}.webm. The video must SHOW the requirement being
exercised (e.g. start/stop/add for §05; favorites rail resume for §05 R09/R10; saved-report run/export
for §12 R08; range-picker drag for §12 R15; backup/restore for §20; update check/download for §19).
Return captured=true with the path and what it shows. If the harness cannot record video here, return
captured=false and NOTE the missing capability and what a human must do — never fabricate a file.`,
        { label: `rec:${id}`, phase: 'Recordings', schema: RECORDING }
      );
    })
  )).filter(Boolean);
  const got = recordings.filter((r) => r.captured).length;
  log(`Recordings: ${got}/${recordings.length} captured; ${recordings.length - got} reported a missing capability (noted, not faked).`);
}

// ===========================================================================
// PHASE 8 — Evidence & PR: regenerate everything once more, commit on the
// working branch, and aggregate into ONE ready-for-review GitHub PR with the
// recordings linked and a per-requirement status checklist.
// ===========================================================================
phase('PR');
const finalSuite = await agent(
  `${REPO}

Final evidence regen — run in order and report precisely: \`npm run build\`, \`npm test\`,
\`npm run verify:no-network\`, \`npm run judge\`, \`npm run evidence\`. Return the five booleans, any
failures with the key error line, and a one-paragraph summary. Do not fix anything.`,
  { label: 'final-evidence', phase: 'PR', schema: SUITE, effort: 'high' }
);
log(`Final evidence: build=${finalSuite.build} tests=${finalSuite.testPassed} judge=${finalSuite.judge} evidence=${finalSuite.evidence} no-network=${finalSuite.noNetwork}`);

// Build the per-requirement status checklist from the latest AC verdicts + deletions/doc rows.
const acById = new Map(acVerdicts.map((v) => [v.reqId, v]));
const checklistData = work.map((w) => {
  if (w.change === 'DELETED') return { reqId: w.reqId, status: 'pending-swap', note: 'removed at §Z swap' };
  if ((w.acMethods || []).length === 0) return { reqId: w.reqId, status: 'doc', note: 'documentation/meta change' };
  const v = acById.get(w.reqId);
  const sufficient = v ? v.verdict === 'sufficient' : !openAc.has(w.reqId);
  const rec = recordings.find((r) => r.reqId === w.reqId);
  const recNote = rec ? (rec.captured ? 'recording attached' : `recording MISSING: ${rec.notes}`) : (w.rec ? 'recording required but not captured' : '');
  return { reqId: w.reqId, status: sufficient ? 'done' : 'partial', note: [v && !sufficient ? (v.gaps || []).join('; ') : '', recNote].filter(Boolean).join(' | ') };
});

const pr = await agent(
  `${REPO}

Aggregate this transition into ONE GitHub PR on the CURRENT working branch (do NOT target the default
branch directly; commit on the working branch and open the PR FROM it INTO the default branch).

1. Stage and commit all changes from this transition with a clear message describing the requirements
   delivered (favorites, saved reports, full Timer view, visual range picker, durability/backups,
   packaging/update flow, Windows removal, the core relabeling, and all AC + evidence). Use the repo's
   commit trailer convention.
2. Push the working branch and create a PR that is READY FOR REVIEW (not draft). Body must include:
   - a one-paragraph summary of the transition;
   - a PER-REQUIREMENT STATUS CHECKLIST (use this exact data):
${checklistData.map((c) => `     - [${c.status === 'done' ? 'x' : ' '}] ${c.reqId} — ${c.status}${c.note ? ` (${c.note})` : ''}`).join('\n')}
   - a "QA screen recordings" section LINKING each recording under acceptance/evidence/recordings/
     (binaries are git-ignored/large — link by path/relative URL and note any that report a missing
     capability rather than a file):
${recordings.length ? recordings.map((r) => `     - ${r.reqId}: ${r.captured ? r.path : 'NOT CAPTURED — ' + r.notes}`).join('\n') : '     - (none in scope)'}
   - an "Evidence" section noting build=${finalSuite.build}, tests=${finalSuite.testPassed},
     judge=${finalSuite.judge}, evidence=${finalSuite.evidence}, no-network=${finalSuite.noNetwork},
     and the Markdown PR-body footer required by the repo conventions.
3. Do NOT merge (the human gate is PR merge). Return committed, the PR url, the checklist, and a summary.`,
  { label: 'open-pr', phase: 'PR', schema: PR_RESULT, effort: 'high' }
);
log(`PR: committed=${pr.committed} url=${pr.prUrl}`);

// ===========================================================================
// PHASE 9 — Swap (only after all-green). Per §Z: gate on EVERY buildable
// requirement having sufficient AC evidence AND both reviews clean AND a green
// final suite AND a full (unscoped) run. Only then delete the old artifacts,
// promote the new docs, and fix references. The human gate is PR merge — so the
// swap commits onto the SAME PR branch; it does not merge.
// ===========================================================================
phase('Swap');
const finalGreen = finalSuite.build && finalSuite.testPassed && finalSuite.noNetwork;
const recordingsOk = !recordings.length || recordings.every((r) => r.captured);
const swapGate = FULL_RUN && allAcSufficient && reviewsClean && finalGreen && pr.committed;

let swap = { performed: false, reason: '' };
if (!swapGate) {
  const reasons = [];
  if (!FULL_RUN) reasons.push('scoped run (swap only on full unscoped runs)');
  if (!allAcSufficient) reasons.push(`AC insufficient for: ${[...openAc].join(', ') || 'unknown'}`);
  if (!archClean) reasons.push('architecture review not clean');
  if (!finalGreen) reasons.push('final suite not green');
  if (!pr.committed) reasons.push('PR not committed');
  swap.reason = reasons.join('; ');
  log(`Swap SKIPPED — gate not met: ${swap.reason}`);
} else {
  log('Swap gate MET — performing §Z old→new swap on the PR branch.');
  await agent(
    `${REPO}

Every requirement now has passing AC evidence and both reviews are clean. Perform the §Z old→new SWAP
on the CURRENT PR branch (commit; do NOT merge — the human gate is the PR merge), then push so it lands
on the open PR. Read requirements-transition.md §Z for the authoritative list, then:
  - DELETE prd-old.html, concept-old.html, glossary-old.html, acceptance-old.html.
  - DELETE packages/gui/renderer/report.html and packages/gui/renderer/report.js (folded into the
    in-sidebar Reports view); remove any remaining references/wiring to them.
  - DELETE .claude/workflows/stint-prd-coverage.js (legacy, superseded — used only as prior art).
  - DELETE requirements-transition.md (this mapping).
  - Ensure README.md, CLAUDE.md, acceptance/COVERAGE.md, and acceptance/parity-matrix.json reference
    ONLY the new docs and the new entities (favorite, saved report); fix any dangling links to the
    deleted files.
Then run \`npm run build && npm test && npm run verify:no-network\` once more to confirm nothing
referenced the deleted files, commit the swap, and push to the PR branch. Report what was deleted,
what references were fixed, and whether the tree is still green.`,
    { label: 'swap', phase: 'Swap', effort: 'high' }
  );
  swap = { performed: true, reason: 'all-green; swap committed to PR branch' };
}

// ---------------------------------------------------------------------------
// Final report.
// ---------------------------------------------------------------------------
return {
  fullRun: FULL_RUN,
  requirements: work.length,
  buildable: buildable.length,
  waves: waves.length,
  acSufficient: buildable.length - openAc.size,
  acInsufficient: [...openAc],
  architectureClean: archClean,
  recordings: { targeted: recTargets.length, captured: recordings.filter((r) => r.captured).length },
  evidence: finalSuite,
  pr: { committed: pr.committed, url: pr.prUrl },
  swap,
  allGreen: swapGate && recordingsOk,
  summary: pr.summary,
};
