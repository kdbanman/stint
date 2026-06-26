export const meta = {
  name: 'stint-prd-coverage',
  description:
    'Drive Stint to complete PRD coverage: implement every todo/partial requirement, ' +
    'add acceptance criteria across all five AC methods, regenerate evidence, and flip the ' +
    'PRD status fields — with adversarial completeness checks and a bounded repair loop.',
  whenToUse:
    'When you want every prd.html requirement implemented, proven by the five AC methods ' +
    '(BDD/PROP/GOLD/JUDGE/MANUAL), mapped in COVERAGE.md, and backed by regenerated evidence.',
  phases: [
    { title: 'Inventory', detail: 'Parse prd.html + COVERAGE.md into a gap work-list' },
    { title: 'Plan', detail: 'Per requirement: implementation + AC + evidence plan, with exact files touched' },
    { title: 'Implement', detail: 'Code each package in dependency-ordered, file-disjoint waves; verify each wave green' },
    { title: 'Cover', detail: 'Add/extend AC: BDD, PROP, GOLD schemas, JUDGE rubric, MANUAL, parity-matrix, COVERAGE rows' },
    { title: 'Evidence', detail: 'Build + full suite + judge + evidence + no-network; capture results' },
    { title: 'Verify', detail: 'Adversarial completeness critics per requirement; loop-until-dry repair' },
    { title: 'Finalize', detail: 'Flip PRD status fields to implemented, refresh COVERAGE, summarize' },
  ],
};

// ---------------------------------------------------------------------------
// Schemas (JSON Schema — validated at the tool layer, so agents retry on miss)
// ---------------------------------------------------------------------------
const WORKLIST = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['reqId', 'section', 'title', 'statusNow', 'surfaces', 'acMethods', 'summary'],
        properties: {
          reqId: { type: 'string', description: 'e.g. "§12 R8" or "§09 search"' },
          section: { type: 'string' },
          title: { type: 'string' },
          statusNow: { enum: ['todo', 'partial'] },
          surfaces: { type: 'array', items: { enum: ['core', 'cli', 'gui'] } },
          acMethods: { type: 'array', items: { enum: ['BDD', 'PROP', 'GOLD', 'JUDGE', 'MANUAL'] } },
          summary: { type: 'string' },
        },
      },
    },
    evidenceGaps: {
      type: 'array', description: 'Requirements already implemented but missing an AC row or evidence',
      items: { type: 'object', required: ['reqId', 'gap'], properties: { reqId: { type: 'string' }, gap: { type: 'string' } } },
    },
  },
};

const PLAN = {
  type: 'object',
  required: ['reqId', 'files', 'steps', 'acPlan', 'evidencePlan', 'dependsOn'],
  properties: {
    reqId: { type: 'string' },
    files: { type: 'array', items: { type: 'string' }, description: 'EVERY file this package creates or edits (code AND tests) — used to schedule disjoint waves' },
    steps: { type: 'string', description: 'Concrete implementation steps' },
    acPlan: { type: 'array', items: { type: 'object', required: ['method', 'file', 'what'], properties: { method: { enum: ['BDD', 'PROP', 'GOLD', 'JUDGE', 'MANUAL'] }, file: { type: 'string' }, what: { type: 'string' } } } },
    evidencePlan: { type: 'string', description: 'Which regen step refreshes evidence: evidence | judge | none' },
    dependsOn: { type: 'array', items: { type: 'string' }, description: 'reqIds that must land first' },
  },
};

const IMPL = {
  type: 'object',
  required: ['reqId', 'filesChanged', 'testsAdded', 'notes'],
  properties: {
    reqId: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string', description: 'What was built and any deviation from plan' },
  },
};

const SUITE = {
  type: 'object',
  required: ['build', 'testPassed', 'judge', 'evidence', 'noNetwork', 'failures', 'summary'],
  properties: {
    build: { type: 'boolean' },
    testPassed: { type: 'boolean' },
    judge: { type: 'boolean' },
    evidence: { type: 'boolean' },
    noNetwork: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' }, description: 'Failing test names / commands with the error line' },
    summary: { type: 'string' },
  },
};

const VERDICT = {
  type: 'object',
  required: ['reqId', 'implemented', 'hasAC', 'hasEvidence', 'verdict', 'gaps'],
  properties: {
    reqId: { type: 'string' },
    implemented: { type: 'boolean' },
    hasAC: { type: 'boolean', description: 'Has ≥1 passing AC across the required methods' },
    hasEvidence: { type: 'boolean', description: 'Reflected in COVERAGE.md + regenerated evidence/parity' },
    verdict: { enum: ['covered', 'incomplete'] },
    gaps: { type: 'array', items: { type: 'string' }, description: 'Exactly what is missing; empty when covered' },
  },
};

// ---------------------------------------------------------------------------
// Shared context every coding agent needs (keeps prompts lean & consistent)
// ---------------------------------------------------------------------------
const REPO = `Repo: Stint, a TypeScript monorepo at the cwd. Surfaces are equal: @stint/core
(packages/core), the tt CLI (packages/cli), and the Electron GUI (packages/gui).
All logic lives in @stint/core; CLI and GUI are thin shells over it.

Conventions you MUST follow (do not invent new structure):
- BDD: features/*.feature (Gherkin); steps in packages/core/test/bdd/steps.ts; every
  scenario runs TWICE (core + tt) via run.test.ts — write surface-neutral steps.
- PROP: packages/core/test/prop/*.test.ts (fast-check) for money-affecting invariants.
- GOLD: packages/cli/test/gold/cli.test.ts and packages/core/test/gold/contracts.test.ts;
  JSON Schemas in acceptance/schemas/<command>.schema.json (Draft 7).
- JUDGE: acceptance/judge-rubric.md + packages/gui/judge/run-judge.mjs (Playwright,
  pinned clock) + fixtures in packages/gui/judge/fixtures.mjs.
- MANUAL: append a "CHECK <TITLE>" procedure to acceptance/manual/runbook.md.
- Parity: every new GUI IPC channel in packages/gui/src/ipc.ts CHANNELS must get a row in
  acceptance/parity-matrix.json (asserted by packages/gui/test/parity.test.ts).
- Coverage index: acceptance/COVERAGE.md is hand-maintained — add/refresh the PRD row.
Commands: npm run build · npm test · npm run test:bdd|test:prop|test:gold · npm run judge
· npm run evidence · npm run verify:no-network. Node ≥22.5; node:sqlite; no network ever.`;

// ---------------------------------------------------------------------------
// PHASE 1 — Inventory: turn the PRD's status fields into a concrete work-list
// ---------------------------------------------------------------------------
phase('Inventory');
const inv = await agent(
  `${REPO}

Read prd.html in full, plus acceptance/COVERAGE.md and acceptance/parity-matrix.json.
Every requirement in prd.html carries a status badge: implemented / partial / todo
(class "st-done"/"st-partial"/"st-todo"). Produce the COMPLETE work-list of every
requirement whose status is "todo" or "partial" — these are the gaps to close for full
PRD coverage. For each, capture: the reqId (section + R-number, e.g. "§12 R8", or a short
slug like "§09 search"), section, title, current status, which surfaces it touches
(core/cli/gui), which AC methods should prove it (per the COVERAGE.md conventions — money/
invariant rules need PROP or GOLD; user flows need BDD; GUI presentation needs JUDGE; OS
reality needs MANUAL), and a one-line summary. Also list any requirement already marked
implemented that LACKS an AC row in COVERAGE.md or evidence (evidenceGaps). Be exhaustive —
missing a gap here means it never gets built.`,
  { label: 'inventory', phase: 'Inventory', agentType: 'Explore', schema: WORKLIST, effort: 'high' }
);
const work = inv.items;
log(`Inventory: ${work.length} open requirements (${work.filter(w => w.statusNow === 'todo').length} todo, ${work.filter(w => w.statusNow === 'partial').length} partial); ${(inv.evidenceGaps || []).length} evidence gaps.`);

// ---------------------------------------------------------------------------
// PHASE 2 — Plan: one plan per requirement. BARRIER is justified here — the wave
// scheduler below needs ALL file lists at once to compute disjoint batches.
// ---------------------------------------------------------------------------
phase('Plan');
const plans = (await parallel(
  work.map((w) => () =>
    agent(
      `${REPO}

Plan the work to bring this requirement to full coverage. Requirement ${w.reqId} — ${w.title}
(status ${w.statusNow}; surfaces ${w.surfaces.join('+')}; AC ${w.acMethods.join('/')}).
Summary: ${w.summary}

Read the relevant source before planning. Return: the EXACT set of files you will create or
edit (code AND tests AND any schema/rubric/runbook/parity/coverage files) — this list is used
to schedule non-conflicting parallel work, so be complete and precise; concrete implementation
steps; an acPlan (method + file + what) covering every AC method this requirement needs; the
evidence regen step (evidence/judge/none); and dependsOn (reqIds that must land first, e.g. a
GUI view depending on a core query, or a settings view depending on the nav shell).`,
      { label: `plan:${w.reqId}`, phase: 'Plan', schema: PLAN, effort: 'high' }
    )
  )
)).filter(Boolean);
const planById = new Map(plans.map((p) => [p.reqId, p]));

// ---------------------------------------------------------------------------
// Scheduler: dependency-ordered, file-DISJOINT waves. Items in the same wave
// touch no common file, so they edit the shared tree concurrently without
// conflict (no worktree merge needed). dependsOn is respected across waves.
// ---------------------------------------------------------------------------
function buildWaves(plans, byId) {
  const remaining = new Set(plans.map((p) => p.reqId));
  const done = new Set();
  const waves = [];
  let guard = 0;
  while (remaining.size && guard++ < 50) {
    const ready = [...remaining].filter((id) => (byId.get(id).dependsOn || []).every((d) => done.has(d) || !byId.has(d)));
    const pool = ready.length ? ready : [...remaining]; // break dependency cycles defensively
    const wave = [];
    const claimed = new Set();
    for (const id of pool) {
      const files = byId.get(id).files || [];
      if (files.some((f) => claimed.has(f))) continue; // shares a file with someone already in this wave → defer
      files.forEach((f) => claimed.add(f));
      wave.push(id);
    }
    wave.forEach((id) => { remaining.delete(id); done.add(id); });
    waves.push(wave);
  }
  if (remaining.size) waves.push([...remaining]); // safety net
  return waves;
}
const waves = buildWaves(plans, planById);
log(`Scheduled ${plans.length} packages into ${waves.length} file-disjoint waves: ${waves.map((w) => w.length).join(' → ')}`);

// ---------------------------------------------------------------------------
// PHASE 3 — Implement, wave by wave. Within a wave: parallel coding (disjoint
// files). After each wave: ONE verify agent builds + tests the whole tree
// (serialized so concurrent dist/ writes can't clash), then a bounded repair loop.
// ---------------------------------------------------------------------------
phase('Implement');
for (let w = 0; w < waves.length; w++) {
  const ids = waves[w];
  log(`Wave ${w + 1}/${waves.length}: implementing ${ids.join(', ')}`);
  await parallel(
    ids.map((id) => () => {
      const p = planById.get(id);
      return agent(
        `${REPO}

Implement requirement ${id} to completion, INCLUDING its co-located acceptance tests.
Plan:
- Files: ${p.files.join(', ')}
- Steps: ${p.steps}
- AC to add now: ${p.acPlan.map((a) => `${a.method} in ${a.file} (${a.what})`).join('; ')}

Put real behavior in @stint/core where logic belongs; keep CLI/GUI thin. Match the
surrounding code's style and the conventions above. Write the BDD/PROP/GOLD tests for this
requirement as you go. Do NOT run \`npm run build\` or \`npm test\` (a verify agent runs them
for the whole wave to avoid concurrent build clashes) — but DO type-check your own reasoning
carefully. Only touch the files in your plan; if you discover you need a file another package
owns, note it in your result instead of editing it.`,
        { label: `impl:${id}`, phase: 'Implement', schema: IMPL }
      );
    })
  );
  // Verify the wave, then repair up to twice.
  let green = false;
  for (let attempt = 0; attempt < 3 && !green; attempt++) {
    const check = await agent(
      `${REPO}

Run \`npm run build\` then \`npm test\`. Report build success, whether all tests pass, and the
exact failing test names with the key error line for any failures. Do not fix anything — just
report. (judge/evidence/noNetwork: report false/false/false here; they run in a later phase.)`,
      { label: `verify-wave-${w + 1}`, phase: 'Implement', schema: SUITE, effort: 'high' }
    );
    if (check.build && check.testPassed) { green = true; break; }
    log(`Wave ${w + 1} red (attempt ${attempt + 1}): ${check.failures.slice(0, 5).join(' | ')}`);
    await agent(
      `${REPO}

The wave's build/tests are failing. Fix ONLY what is broken — do not redesign. Failures:
${check.failures.join('\n')}
Touch the minimum set of files (code or the new tests) to make \`npm run build && npm test\`
green for what this wave added, without weakening any assertion. Then stop.`,
      { label: `repair-wave-${w + 1}-${attempt + 1}`, phase: 'Implement' }
    );
  }
  if (!green) log(`⚠ Wave ${w + 1} still red after repair attempts — carrying failures into the Verify phase.`);
}

// ---------------------------------------------------------------------------
// PHASE 4 — Cover: cross-cutting AC + index files the per-package work didn't own.
// These target mostly-disjoint files, so run them together.
// ---------------------------------------------------------------------------
phase('Cover');
await parallel([
  () => agent(
    `${REPO}

Update acceptance/parity-matrix.json so EVERY GUI IPC channel now in packages/gui/src/ipc.ts
CHANNELS has a row mapping it to its tt command path(s). Then confirm packages/gui/test/parity.test.ts
still asserts completeness (extend it only if the channel-extraction shape changed). Run
\`npm run test:gold\` and report pass/fail in your notes.`,
    { label: 'cover:parity', phase: 'Cover' }
  ),
  () => agent(
    `${REPO}

Extend the JUDGE apparatus for the new GUI views (report builder, settings, entry editor /
manual-add, nav shell, filtering/search, flags-in-context banner). Add rubric items to
acceptance/judge-rubric.md (machine-checkable → pass true/false with a deterministic Playwright
assertion in packages/gui/judge/run-judge.mjs; subjective → pass:null screenshot-only). Add any
needed fixtures to packages/gui/judge/fixtures.mjs (keep the pinned clock). Do NOT run the judge
harness yet (Evidence phase does). Keep existing items intact.`,
    { label: 'cover:judge', phase: 'Cover' }
  ),
  () => agent(
    `${REPO}

Append MANUAL check procedures to acceptance/manual/runbook.md for anything only verifiable on
real hardware that the new work introduced (e.g. the in-window Switch action, GUI confirm-on-
delete, keyboard/focus pass). Follow the existing "CHECK <TITLE>" format with numbered steps and
verify bullets. Don't duplicate procedures already covered.`,
    { label: 'cover:manual', phase: 'Cover' }
  ),
]);

// ---------------------------------------------------------------------------
// PHASE 5 — Evidence: one agent regenerates everything, serialized.
// ---------------------------------------------------------------------------
phase('Evidence');
const suite = await agent(
  `${REPO}

Run, in order, and report each result precisely:
  npm run build
  npm test
  npm run verify:no-network
  npm run judge        (regenerates acceptance/evidence/judge-report.json + screenshots/)
  npm run evidence     (regenerates acceptance/evidence/cli-transcript.md)
Return build, testPassed, judge, evidence, noNetwork booleans, the list of any failures with
their key error line, and a one-paragraph summary. Do not fix anything here.`,
  { label: 'regen-evidence', phase: 'Evidence', schema: SUITE, effort: 'high' }
);
log(`Evidence: build=${suite.build} tests=${suite.testPassed} judge=${suite.judge} evidence=${suite.evidence} no-network=${suite.noNetwork}`);

// ---------------------------------------------------------------------------
// PHASE 6 — Verify: adversarial completeness critics, one per requirement.
// A requirement is "covered" only if implemented AND has ≥1 passing AC AND is
// reflected in COVERAGE/evidence. Loop-until-dry: incomplete → repair → re-verify.
// ---------------------------------------------------------------------------
phase('Verify');
let toCheck = work.map((w) => w.reqId);
const stillOpen = new Set(toCheck);
const FUEL = budget.total ? Math.max(2, Math.min(4, Math.floor(budget.remaining() / 200_000))) : 3;
for (let round = 0; round < FUEL && stillOpen.size; round++) {
  const verdicts = (await parallel(
    [...stillOpen].map((id) => () => {
      const w = work.find((x) => x.reqId === id);
      return agent(
        `${REPO}

Adversarially verify that requirement ${id} — ${w.title} — is FULLY covered. Default to
"incomplete" unless you can prove otherwise. Check, by reading source and tests and running the
relevant suite (\`npm run test:bdd|test:prop|test:gold\`, or grep the rubric/runbook/parity/
coverage files):
  1. implemented — the behavior actually exists in core/cli/gui as the PRD requires;
  2. hasAC — at least one of its required methods (${w.acMethods.join('/')}) has a PASSING,
     non-trivial assertion that would fail if the behavior regressed;
  3. hasEvidence — there is a row in acceptance/COVERAGE.md and the regenerated evidence
     (cli-transcript / judge-report / parity-matrix) reflects it.
List the precise gaps. A requirement with a test that does not actually exercise the behavior is
"incomplete".`,
        { label: `verify:${id}`, phase: 'Verify', agentType: 'Explore', schema: VERDICT, effort: 'high' }
      );
    })
  )).filter(Boolean);

  const incomplete = verdicts.filter((v) => v.verdict === 'incomplete');
  verdicts.filter((v) => v.verdict === 'covered').forEach((v) => stillOpen.delete(v.reqId));
  log(`Verify round ${round + 1}: ${verdicts.length - incomplete.length} covered, ${incomplete.length} incomplete.`);
  if (!incomplete.length) break;

  // Repair wave for the incomplete ones (file-disjoint where possible; small set, run sequentially-safe).
  await parallel(
    incomplete.map((v) => () =>
      agent(
        `${REPO}

Close the remaining coverage gaps for ${v.reqId}. Gaps: ${v.gaps.join('; ')}.
Implement the missing behavior and/or add the missing AC (real assertions, not stubs) and/or the
missing COVERAGE.md row. Then run the affected suite to confirm green. Touch the minimum files.`,
        { label: `verify-fix:${v.reqId}`, phase: 'Verify' }
      )
    )
  );
}
if (stillOpen.size) log(`⚠ Unresolved after ${FUEL} rounds: ${[...stillOpen].join(', ')} — surfaced in the final report.`);

// ---------------------------------------------------------------------------
// PHASE 7 — Finalize: flip PRD status fields, refresh COVERAGE, full green check.
// ---------------------------------------------------------------------------
phase('Finalize');
const covered = work.map((w) => w.reqId).filter((id) => !stillOpen.has(id));
const final = await agent(
  `${REPO}

For every requirement now fully covered (${covered.join(', ') || 'none'}), update prd.html:
flip its status badge from st-todo/st-partial to st-done ("implemented"), and trim any
"todo (§..)" tail notes that are now false. Do NOT flip anything still listed unresolved
(${[...stillOpen].join(', ') || 'none'}). Then refresh acceptance/COVERAGE.md (PRD rows + the §17
table) so it matches reality, and update §17 R8 (GUI↔tt parity) if parity now holds. Finally run
\`npm run build && npm test && npm run verify:no-network\` once more and report whether the tree is
fully green. Summarize what shipped, what changed in the PRD, and anything still open.`,
  { label: 'finalize', phase: 'Finalize', schema: SUITE, effort: 'high' }
);

return {
  requirementsTargeted: work.length,
  waves: waves.length,
  covered,
  unresolved: [...stillOpen],
  evidence: suite,
  finalGreen: final.build && final.testPassed && final.noNetwork,
  summary: final.summary,
};
