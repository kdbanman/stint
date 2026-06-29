export const meta = {
  name: 'remove-accent-setting',
  description:
    'Remove the configurable "accent" setting/feature from Stint entirely and make the clay brand accent (--accent #C8623E from the design system) unconditional. Colour becomes the design system\'s job, not a product requirement or user setting. Removes the accent setting across core/CLI/GUI/judge/tests and strips the accent requirement from the PRD/glossary/acceptance/COVERAGE/parity/runbook and the settings mockup — while KEEPING the clay token and the rationed-accent discipline checks. Then regenerates evidence, runs a consistency review, RE-RECORDS the GUI flows in the new clay style as committed GIFs (installing a full ffmpeg), and updates the existing branch PR. Stays green throughout.',
  whenToUse: 'When the accent is to be fixed to the brand clay and the accent setting/requirement removed.',
  phases: [
    { title: 'Code', detail: 'Remove the accent setting across core/CLI/GUI/judge/tests (keep the clay token + rationed-accent discipline)' },
    { title: 'Docs', detail: 'Strip the accent requirement/setting from PRD/glossary/acceptance/COVERAGE/parity/runbook and the settings mockup' },
    { title: 'Verify', detail: 'build, test, verify:no-network, judge, evidence — serialized' },
    { title: 'Review', detail: 'Consistency: no accent-setting leftovers anywhere; clay unconditional; discipline intact' },
    { title: 'Gifs', detail: 'Install full ffmpeg; re-record the GUI flows (now clay) and convert to committed GIFs' },
    { title: 'PR', detail: 'Commit on the working branch and update the existing PR' },
  ],
};

const REPO = `Repo: Stint, a TypeScript monorepo at the cwd. Surfaces are EQUAL: @stint/core (packages/core),
the tt CLI (packages/cli), the Electron GUI (packages/gui, renderer under packages/gui/renderer). Settings
are key/value rows in core (packages/core/src/settings.ts) surfaced by both \`tt config\` and the GUI
Settings view. Commands: npm run build · npm test · npm run verify:no-network · npm run judge · npm run
evidence · npm run record. Node ≥22.5; NO network for the app itself.`;

// The airtight keep-vs-remove contract every agent shares — the crux of this change.
const SPEC = `CHANGE: remove the configurable "accent" setting/feature ENTIRELY. Colour is the design system's
job (context/mockups/design-system.html + the mockups), NOT a product requirement or a user setting. The
brand accent is the clay token --accent:#C8623E defined in packages/gui/renderer/styles.css; it now stands
UNCONDITIONALLY (no runtime override, no system accent, no monochrome mode).

KEEP — do NOT touch or remove:
  - The clay --accent custom property in styles.css and EVERY var(--accent) usage in the renderer. That IS
    the design system painting clay; it stays and now applies unconditionally.
  - The "rationed accent" DISCIPLINE checks in the judge (ACCENT_DISCIPLINE and the per-scene
    getComputedStyle('--accent') "exactly one sanctioned accent fill per view, everything else monochrome"
    assertions). They enforce the design system and must keep passing against the fixed clay accent.
  - Every OTHER setting (rounding, week start, check-ins, global hotkey, date format, backup retention) and
    all behaviour, parity, IPC channels, and harness selectors.

REMOVE — everywhere, leaving the tree green:
  - core: packages/core/src/settings.ts — the AccentMode type, the Settings.accent field, its
    DEFAULT_SETTINGS entry, and its SETTING_DESCRIPTORS row (key/value store → NO migration needed).
  - CLI/core test goldens: the "accent ..." row/field in packages/cli/test/gold/cli.test.ts and
    packages/core/test/gold/contracts.test.ts, and the accent alias in packages/core/test/bdd/steps.ts.
  - GUI main: packages/gui/src/ipc.ts (the settings.accent mode field AND the top-level accent colour
    string), packages/gui/src/uistate.ts, packages/gui/src/main.ts — all accent plumbing.
  - renderer: packages/gui/renderer/util.js (delete applyAccent + applyAccentMode and their call sites;
    the clay styles.css token stands), settings.js (delete the "Accent colour" setting control/row), and
    any caller of applyAccentMode/applyAccent in app.js/reports.js/timepicker.js/editor.js/popover.js. Do
    NOT remove var(--accent) styling. Update the styles.css comment that says --accent is "overridden at
    runtime by the system accent" (clay is now unconditional).
  - judge/tests: packages/gui/judge/run-judge.mjs + fixtures.mjs + record.mjs — remove the accent SETTING
    items/fixtures (e.g. the Settings scene that selects .set-field[data-key="accent"] → 'monochrome' and
    any injected settings.accent / top-level accent colour in fixtures); KEEP the rationed-accent
    discipline checks. Update packages/gui/test/{renderer-static,timerview,liveview,tray}.test.ts to drop
    accent-SETTING assertions (keep discipline assertions).
  - docs: context/prd.html (the §12 R11 accent clause, the §14 accent setting, the §15 system-accent
    mention), context/glossary.html, context/acceptance.html, acceptance/criteria/COVERAGE.md,
    acceptance/criteria/parity-matrix.json (the accent config row, if present),
    acceptance/criteria/manual/runbook.md (any accent procedure/step).
  - mockups: context/mockups/settings.html (remove the Accent-colour setting row).
Never change behaviour beyond removing the accent setting.`;

const SUITE = {
  type: 'object',
  required: ['build', 'testPassed', 'failures', 'summary'],
  properties: {
    build: { type: 'boolean' }, testPassed: { type: 'boolean' }, judge: { type: 'boolean' },
    evidence: { type: 'boolean' }, noNetwork: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
  },
};
const REVIEW = {
  type: 'object',
  required: ['clean', 'leftovers', 'summary'],
  properties: {
    clean: { type: 'boolean', description: 'True iff NO accent-setting leftover remains AND the clay token + discipline are intact.' },
    leftovers: { type: 'array', items: { type: 'string' }, description: 'file:location of any remaining accent-setting reference (config field, setting control, IPC plumbing, test/judge assertion, doc requirement). Empty when clean.' },
    summary: { type: 'string' },
  },
};
const GIFS = {
  type: 'object',
  required: ['gifs', 'notes'],
  properties: {
    gifs: { type: 'array', items: { type: 'object', required: ['path', 'shows'], properties: { path: { type: 'string' }, shows: { type: 'string' } } } },
    notes: { type: 'string' },
  },
};
const PR_RESULT = {
  type: 'object', required: ['committed', 'prUrl', 'summary'],
  properties: { committed: { type: 'boolean' }, prUrl: { type: 'string' }, summary: { type: 'string' } },
};

// ===========================================================================
// Phase 1 — Code: four file-disjoint units edit in parallel, then a verify+repair loop.
// ===========================================================================
phase('Code');
const CODE_UNITS = [
  { id: 'core', files: 'packages/core/src/settings.ts + packages/cli/test/gold/cli.test.ts + packages/core/test/gold/contracts.test.ts + packages/core/test/bdd/steps.ts',
    task: 'Remove the accent setting from the core settings model and the CLI/core golden + BDD-alias tests that assert it.' },
  { id: 'gui-main', files: 'packages/gui/src/ipc.ts + packages/gui/src/uistate.ts + packages/gui/src/main.ts',
    task: 'Remove all accent plumbing from the GUI main process (the settings.accent mode field and the top-level accent colour string, and anything that reads/forwards them).' },
  { id: 'renderer', files: 'packages/gui/renderer/util.js + settings.js + app.js + reports.js + timepicker.js + editor.js + popover.js + styles.css (comment only)',
    task: 'Delete applyAccent/applyAccentMode and their call sites and the Settings "Accent colour" control; keep every var(--accent) styling so clay applies unconditionally; fix the styles.css "overridden at runtime" comment.' },
  { id: 'judge-tests', files: 'packages/gui/judge/run-judge.mjs + fixtures.mjs + record.mjs + packages/gui/test/{renderer-static,timerview,liveview,tray}.test.ts',
    task: 'Remove the accent-SETTING judge items/fixtures and the accent-setting test assertions; KEEP the rationed-accent discipline checks (ACCENT_DISCIPLINE + per-scene --accent reads).' },
];
await parallel(CODE_UNITS.map((u) => () =>
  agent(`${REPO}\n\n${SPEC}\n\nUNIT "${u.id}". Edit ONLY: ${u.files}.\n${u.task}\nFollow the KEEP/REMOVE
contract exactly. Match surrounding style. Do not run build/test (a verify step follows the wave).`,
    { label: `code:${u.id}`, phase: 'Code', effort: 'high' })
));
let green = false;
for (let attempt = 0; attempt < 3 && !green; attempt++) {
  const check = await agent(`${REPO}\n\nRun \`npm run build\` then \`npm test\`. Report build, testPassed, and
the exact failing test names with the key error line. Do not fix anything.`,
    { label: `verify-code-${attempt + 1}`, phase: 'Code', schema: SUITE, effort: 'high' });
  if (check.build && check.testPassed) { green = true; break; }
  log(`Code red (attempt ${attempt + 1}): ${(check.failures || []).slice(0, 6).join(' | ')}`);
  await agent(`${REPO}\n\n${SPEC}\n\nThe build/tests are red after removing the accent setting. Fix ONLY what
is broken (a missed accent reference, a golden that still lists accent, a type that still names AccentMode),
following the KEEP/REMOVE contract, until \`npm run build && npm test\` is green. Failures:\n${(check.failures || []).join('\n')}\nThen stop.`,
    { label: `repair-code-${attempt + 1}`, phase: 'Code' });
}

// ===========================================================================
// Phase 2 — Docs + mockups (file-disjoint from code).
// ===========================================================================
phase('Docs');
await parallel([
  () => agent(`${REPO}\n\n${SPEC}\n\nDOCS unit. Edit ONLY: context/prd.html, context/glossary.html,
context/acceptance.html, acceptance/criteria/COVERAGE.md, acceptance/criteria/parity-matrix.json,
acceptance/criteria/manual/runbook.md. Remove the accent SETTING/requirement: the §12 R11 accent clause,
the §14 accent setting, the §15 system-accent mention, the glossary/acceptance/COVERAGE accent rows, the
parity-matrix accent config row (if present), and any accent runbook step. Renumber/clean references so
nothing dangles. Keep the house style. Do NOT mention colour as a requirement — colour is the design
system's job now.`, { label: 'docs:spec', phase: 'Docs', effort: 'high' }),
  () => agent(`${REPO}\n\n${SPEC}\n\nMOCKUPS unit. Edit ONLY: context/mockups/settings.html (remove the
"Accent colour" setting row) and, if needed, context/mockups/design-system.html (the lead/comment should
present the clay accent as unconditional — drop any "system accent override" wording). Keep everything
else and the shared visual language intact.`, { label: 'docs:mockups', phase: 'Docs', effort: 'high' }),
]);

// ===========================================================================
// Phase 3 — Verify (serialized): regen all evidence (judge screenshots now clay).
// ===========================================================================
phase('Verify');
const verify = await agent(`${REPO}\n\nRun in order and report precisely: \`npm run build\`, \`npm test\`,
\`npm run verify:no-network\`, \`npm run judge\` (regenerates judge-report.json + screenshots over the
clay renderer), \`npm run evidence\`. Return build/testPassed/judge/evidence/noNetwork, any failures with
the key error line, and a one-paragraph summary. Do not fix anything.`,
  { label: 'verify-evidence', phase: 'Verify', schema: SUITE, effort: 'high' });
log(`Verify: build=${verify.build} tests=${verify.testPassed} judge=${verify.judge} evidence=${verify.evidence} no-network=${verify.noNetwork}`);
if (!(verify.build && verify.testPassed)) {
  await agent(`${REPO}\n\n${SPEC}\n\nVerify is red. Fix ONLY the regression, minimally, per the KEEP/REMOVE
contract, until \`npm run build && npm test && npm run judge && npm run evidence\` are green. Failures:
${(verify.failures || []).join('\n')}\nThen stop.`, { label: 'verify-repair', phase: 'Verify', effort: 'high' });
}

// ===========================================================================
// Phase 4 — Review + bounded repair: no accent-setting leftovers; clay unconditional.
// ===========================================================================
phase('Review');
let review = await agent(`${REPO}\n\n${SPEC}\n\nCONSISTENCY REVIEW. Search the WHOLE repo for any remaining
trace of the accent SETTING/feature: a Settings.accent / AccentMode reference, a "Accent colour" control,
accent IPC/uistate/main plumbing, an accent golden/fixture/judge-setting assertion, or an accent
requirement in prd/glossary/acceptance/COVERAGE/parity/runbook or the settings mockup. Confirm the clay
--accent token and the rationed-accent DISCIPLINE checks are intact and unconditional. Default clean=false;
clean=true ONLY if there are zero accent-setting leftovers AND clay+discipline are intact. List each
leftover as file:location.`, { label: 'review', phase: 'Review', agentType: 'Explore', schema: REVIEW, effort: 'high' });
for (let round = 0; round < 2 && !review.clean; round++) {
  log(`Review round ${round + 1}: ${(review.leftovers || []).length} leftover(s).`);
  await agent(`${REPO}\n\n${SPEC}\n\nRemove these accent-setting leftovers per the KEEP/REMOVE contract,
then run \`npm run build && npm test\` green:\n${(review.leftovers || []).join('\n')}\nThen stop.`,
    { label: `review-fix-${round + 1}`, phase: 'Review', effort: 'high' });
  review = await agent(`${REPO}\n\n${SPEC}\n\nRe-run the CONSISTENCY REVIEW (same bar, default clean=false).`,
    { label: `review-${round + 1}`, phase: 'Review', agentType: 'Explore', schema: REVIEW, effort: 'high' });
}

// ===========================================================================
// Phase 5 — GIFs: install a full ffmpeg, RE-RECORD the GUI flows (now clay), convert.
// ===========================================================================
phase('Gifs');
const gifs = await agent(`${REPO}\n\nProduce committed GIF QA evidence of the restyled GUI in the new
UNCONDITIONAL CLAY accent (the prior recordings showed the old system-accent blue). Steps:
  1. Install a FULL ffmpeg with gif + palettegen/paletteuse/setpts/fps/tpad support (apt-get update &&
     apt-get install -y ffmpeg, or a static build). Confirm \`ffmpeg -filters\` lists palettegen.
  2. \`npm run build\`. Then re-record the representative flows via the record harness
     (node packages/gui/judge/record.mjs --list to see recipe ids; capture a set that showcases the look:
     the full Timer view, the Entries list + visual time-range picker, the favorites rail, the Reports
     view, the Settings view, and the software-update flow). They render the clay accent now.
  3. Convert each .webm to a slowed, ASCII-named, COMMITTED GIF at acceptance/evidence/recordings/<slug>.gif
     (~1.5s end-frame hold, two-pass palette):
       ffmpeg -y -i in.webm -vf "setpts=2.0*PTS,fps=15,scale=iw:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=1.5,palettegen=stats_mode=diff" pal.png
       ffmpeg -y -i in.webm -i pal.png -filter_complex "setpts=2.0*PTS,fps=15,scale=iw:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=1.5[v];[v][1:v]paletteuse=dither=sierra2_4a" out.gif
  Note: acceptance/evidence/recordings/*.webm is gitignored (raw scratch) — only the .gif are committed.
  Return the committed gif paths + a one-line \`shows\` caption each. If a step is truly impossible, say so
  precisely; never fabricate a GIF.`, { label: 'gifs', phase: 'Gifs', schema: GIFS, effort: 'high' });
log(`Gifs: ${(gifs.gifs || []).length} produced.`);

// ===========================================================================
// Phase 6 — PR: commit + push, update the existing branch PR.
// ===========================================================================
phase('PR');
const final = await agent(`${REPO}\n\nFinal regen: \`npm run build\`, \`npm test\`, \`npm run verify:no-network\`,
\`npm run judge\`, \`npm run evidence\`. Report the five booleans + failures + a one-paragraph summary. No fixes.`,
  { label: 'final', phase: 'PR', schema: SUITE, effort: 'high' });
const pr = await agent(`${REPO}\n\nCommit all changes on the CURRENT working branch with a clear message
(remove the configurable accent setting; clay is now the unconditional brand accent from the design system;
accent requirement/setting stripped from the docs; GUI restyle GIFs re-recorded in clay). Use the repo's
commit trailer convention. Push. Then UPDATE the EXISTING PR for this branch (find it via the GitHub MCP
tools / git remote — do NOT open a second PR, do NOT merge): add an "Accent -> clay (setting removed)"
note summarizing the removal, and refresh the inline GIFs (committed under acceptance/evidence/recordings/,
pinned to the new commit SHA) with their captions:
${(gifs.gifs || []).map((g) => `  - ${g.path} | ${g.shows}`).join('\n') || '  - (none)'}
Evidence: build=${final.build}, tests=${final.testPassed}, judge=${final.judge}, evidence=${final.evidence},
no-network=${final.noNetwork}. Keep the Markdown footer. Return committed, the PR url, and a summary.`,
  { label: 'pr', phase: 'PR', schema: PR_RESULT, effort: 'high' });
log(`PR: committed=${pr.committed} url=${pr.prUrl}`);

return {
  codeGreen: green,
  evidence: final,
  reviewClean: review.clean,
  leftovers: review.leftovers || [],
  gifs: (gifs.gifs || []).length,
  pr: { committed: pr.committed, url: pr.prUrl },
  summary: pr.summary,
};
