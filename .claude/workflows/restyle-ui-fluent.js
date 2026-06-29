export const meta = {
  name: 'restyle-ui-fluent',
  description:
    'Rework the entire Stint Electron GUI into the "Calm · Warm Paper" / Fluent design system, sourcing context/mockups/design-system.html, the per-view mockups, and the documented Fluent foundations. Decomposes the renderer into file-disjoint units (shared foundation → shell → per-view behavior); every rewrite unit gets its OWN full verify + dual review + bounded improve loop (mirroring requirements-transition.js), then a serialized evidence regen (judge screenshots + cli transcript), a cross-cutting consistency review, screen-recording QA evidence LAST, and aggregation into the existing branch PR. It restyles only — it never changes behavior, IPC channels, parity, or the selectors the judge/record/test harness depends on.',
  whenToUse:
    'When you want the running GUI restyled end-to-end to match the new mockups + design system, with per-unit verification + review + recordings + PR, without altering any behavior or acceptance criteria. Pass args (string or array of unit ids: styles/icons/shell/popover/main/editor/reports/settings/picker) to scope a calibration run; omit for the full rework.',
  phases: [
    { title: 'Foundation', detail: 'Rebuild the shared visual language: the full stylesheet (tokens + components + elevation ladder) and the line-icon sprite' },
    { title: 'Restyle', detail: 'Per file-disjoint unit (shell, popover, then each view’s dynamic DOM): rewrite → verify → dual review (mockup-fidelity + code-quality) → bounded improve' },
    { title: 'Reconcile', detail: 'Apply any shared-CSS/shell deltas the view units requested; build + full test the whole tree' },
    { title: 'Evidence', detail: 'Serialized regen: build, test, verify:no-network, judge (new screenshots), evidence (cli transcript)' },
    { title: 'Review', detail: 'Cross-cutting consistency + architecture review of the whole renderer diff; bounded improve that must not regress tests' },
    { title: 'Recordings', detail: 'QA screen recordings (LAST) of the restyled core flows via the record harness; slowed ASCII-named committed GIFs' },
    { title: 'PR', detail: 'Final evidence regen, commit on the working branch, update the existing branch PR with a per-unit checklist and inline recording GIFs' },
  ],
};

// ===========================================================================
// Shared context — every agent gets this. The hard rules that keep a *restyle*
// from turning into a behavior change or breaking the selector-driven harness.
// ===========================================================================
const REPO = `Repo: Stint, a TypeScript monorepo at the cwd. The GUI is packages/gui — an Electron app whose
VISIBLE UI is the static renderer under packages/gui/renderer/ (index.html, styles.css, app.js,
editor.js, reports.js, settings.js, timepicker.js, util.js, popover.html, popover.js). All business
logic lives in @stint/core; the renderer is a thin shell over window.stint.* IPC. macOS + Linux only.

This run RESTYLES the GUI into the new design language. The sources of truth for the look are, in the
repo:
  - context/mockups/design-system.html — the "Calm · Warm Paper" system: tokens, type ramp, the single
    line-icon family, and component rules (buttons, segmented control, toggle, fields, cards, tags,
    status pills, the elevation ladder), AND the documented Fluent foundations.
  - the per-view mockups under context/mockups/ (main, timer, clients, reports, settings, edit-entry,
    time-range-picker, tray-popover, software-update, merge-conflict, sleep-review).
Read the relevant mockup(s) + design-system.html before touching code; lift the exact tokens, classes,
spacing, radii, shadows, and markup shapes from them.

Commands: npm run build · npm test (vitest) · npm run verify:no-network · npm run judge (regenerates
acceptance/evidence/judge-report.json + screenshots/ via Playwright on the real renderer) · npm run
evidence · npm run record (packages/gui/judge/record.mjs — screen recordings of the real renderer).
Node ≥22.5; NO network ever.`;

// The Fluent / Calm subtleties to emphasize — the points the human cared about.
const DESIGN = `Apply the design system FAITHFULLY, emphasizing these subtle points (all documented in
design-system.html):
  - ONE RATIONED CLAY ACCENT (#C8623E): only the single primary action per view, the active nav item,
    and focus rings. Never decorative, never a highlighter.
  - SELECTION ≠ ACCENT: a chosen segmented-control option is a RAISED CHIP (surface lift + shadow),
    NOT a colored fill. The accent stays a signal.
  - STRICT ELEVATION LADDER: canvas → card (--sh-card) → raised → popover (--sh-pop) → modal
    (--sh-modal). The tray popover, editor/merge dialog, and update banner each sit exactly one rung
    above what they cover. NO nested cards, NO decorative tinted/dashed boxes — surface is signalled by
    elevation alone.
  - THE UI SPEAKS FOR ITSELF: remove all unnecessary text — no annotations, no control instructions, no
    explanatory captions, no reassurance copy, no spec/§-refs. Keep only labels, state, and values.
  - SMALL TYPE RAMP: hierarchy from size + weight (450/590/640/680), never colour or italics. Every
    clock and duration uses TABULAR NUMERALS so digits never jitter.
  - 4px GRID + fixed radius trio (8 controls / 12 cards / 16 window & overlays).
  - ONE CONTROL PER CHOICE-SHAPE (toggle = on/off, segmented = ≤4 peers, select = many). LINE ICONS
    ONLY from the one sprite — NEVER emoji. Running state is a small green dot.
  - MOTION functional & short (~120ms). WARM OPAQUE PAPER, not glass/translucency. INCLUSIVITY: colour
    is never the only signal — pair every semantic state with a word or icon (run dot + "running",
    worded warn pill).`;

// The single most important constraint for a restyle: the judge + record + test
// harness query specific selectors/ids/data-attributes. Break them and the whole
// verification apparatus silently goes wrong.
const PRESERVE = `CRITICAL — this is a RESTYLE, not a behavior change:
  - DO NOT change any behavior, IPC channel (window.stint.* / packages/gui/src/ipc.ts), parity row, or
    weaken any test assertion's intent.
  - PRESERVE every selector, element id, data-* attribute, and functional class the harness depends on
    (packages/gui/judge/run-judge.mjs, packages/gui/judge/record.mjs, packages/gui/judge/fixtures.mjs,
    and packages/gui/test/*.ts). Examples that MUST keep working: .nav-item[data-view="…"], #timer-clock,
    #timer-card.running/.idle, #timer-desc/#timer-state, #start-toggle/#start-form/#start-go/#start-bill,
    #switch, #fav-rail/#fav-pin/.fav-card/[data-act="fav-resume|fav-menu|fav-rename|fav-unpin"],
    .entry[data-id]/[data-act="edit|tags|split|delete|select|menu|subtract"], #add-toggle/#add-form/
    #add-from/#add-to/#add-from-pick/#add-go, #overlap-banner, .stp-backdrop/.stp/.stp-block.me/
    .stp-resize/.stp-apply, #le-start/#le-start-pick, the Reports/Settings/Update/backup hooks, etc.
  - PREFER restyling the EXISTING class names/structure to the new look over renaming them. When you
    DO change structure, update the co-located test in the same unit to assert the NEW structure WITHOUT
    weakening it, and confirm the judge/record selectors above still resolve.
  - If you need a shared-CSS rule that lives in styles.css (already restyled in the Foundation phase),
    do NOT edit styles.css yourself — return it as a cssRequest and it is applied in the Reconcile phase.`;

// ===========================================================================
// Schemas
// ===========================================================================
const REWRITE = {
  type: 'object',
  required: ['unit', 'filesChanged', 'selectorsPreserved', 'emojiRemoved', 'textStripped', 'cssRequests', 'notes'],
  properties: {
    unit: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    selectorsPreserved: { type: 'boolean', description: 'True iff every harness selector/id/data-* this unit touches still resolves.' },
    emojiRemoved: { type: 'boolean', description: 'True iff no emoji glyphs remain in this unit (replaced by the line-icon sprite).' },
    textStripped: { type: 'boolean', description: 'True iff unnecessary annotations/instructions/captions/reassurance were removed.' },
    cssRequests: { type: 'array', items: { type: 'string' }, description: 'Shared styles.css/index.html rules this unit needs but must not edit directly (applied in Reconcile). Empty if none.' },
    notes: { type: 'string' },
  },
};

const SUITE = {
  type: 'object',
  required: ['build', 'testPassed', 'failures', 'summary'],
  properties: {
    build: { type: 'boolean', description: 'tsc build succeeded (or n/a for a renderer-only scoped check → report true if not run).' },
    testPassed: { type: 'boolean' },
    judge: { type: 'boolean' },
    evidence: { type: 'boolean' },
    noNetwork: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

const FIDELITY = {
  type: 'object',
  required: ['unit', 'matchesMockup', 'accentRationed', 'selectionNotAccent', 'elevationLadder', 'noUnnecessaryText', 'tabularNums', 'lineIconsNoEmoji', 'harnessSelectorsIntact', 'verdict', 'gaps'],
  properties: {
    unit: { type: 'string' },
    matchesMockup: { type: 'boolean', description: 'The restyled markup/visuals match the named mockup(s) in layout, classes, spacing, radii, shadows.' },
    accentRationed: { type: 'boolean', description: 'Clay accent only on the one primary / active nav / focus ring.' },
    selectionNotAccent: { type: 'boolean', description: 'Chosen segments are raised chips, not colored fills (n/a → true).' },
    elevationLadder: { type: 'boolean', description: 'Correct rung; no nested cards / decorative boxes.' },
    noUnnecessaryText: { type: 'boolean', description: 'No annotations/instructions/explanatory captions/reassurance copy remain.' },
    tabularNums: { type: 'boolean', description: 'Clocks/durations use tabular numerals (n/a → true).' },
    lineIconsNoEmoji: { type: 'boolean', description: 'Line-icon sprite only; zero emoji.' },
    harnessSelectorsIntact: { type: 'boolean', description: 'Every judge/record/test selector this unit touches still resolves.' },
    verdict: { enum: ['sufficient', 'insufficient'], description: 'sufficient ONLY if all the above hold.' },
    gaps: { type: 'array', items: { type: 'string' }, description: 'Exact, concrete gaps; empty only when sufficient.' },
  },
};

const ARCH = {
  type: 'object',
  required: ['findings', 'clean'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'kind', 'locations', 'rating', 'recommendation'],
        properties: {
          title: { type: 'string' },
          kind: { enum: ['duplication', 'dead-code', 'shallow-module', 'poor-locality', 'cognitive-bounce', 'inconsistency', 'other'] },
          locations: { type: 'array', items: { type: 'string' } },
          rating: { enum: ['Strong', 'Worth exploring', 'Speculative'] },
          recommendation: { type: 'string', description: 'Concrete, behavior-preserving, AC-preserving refactor.' },
        },
      },
    },
    clean: { type: 'boolean', description: 'True iff no Strong findings remain.' },
  },
};

const RECORDING = {
  type: 'object',
  required: ['reqId', 'captured', 'path', 'shows', 'notes'],
  properties: {
    reqId: { type: 'string' },
    captured: { type: 'boolean', description: 'False if the harness lacks the capability — note it, never fake it.' },
    path: { type: 'string', description: 'Committed GIF at acceptance/evidence/recordings/<ascii-slug>.gif, or "" if not captured.' },
    shows: { type: 'string', description: 'One-line description used verbatim as the PR caption.' },
    notes: { type: 'string' },
  },
};

const PR_RESULT = {
  type: 'object',
  required: ['committed', 'prUrl', 'summary'],
  properties: {
    committed: { type: 'boolean' },
    prUrl: { type: 'string' },
    summary: { type: 'string' },
  },
};

// ===========================================================================
// The rework units — FILE-DISJOINT, scheduled into dependency waves. index.html
// and styles.css hold ALL view markup/styling, so the natural disjoint unit is
// the FILE/LAYER, not the view. Foundation (styles+icons) lands first; the shell
// markup + the standalone popover next; each view's dynamic DOM last (parallel,
// disjoint JS + disjoint test files).
// ===========================================================================
const UNITS = [
  {
    id: 'styles', wave: 0, dom: false,
    files: ['packages/gui/renderer/styles.css'],
    mockups: ['design-system.html', 'main.html', 'timer.html', 'clients.html', 'reports.html', 'settings.html', 'edit-entry.html', 'time-range-picker.html', 'tray-popover.html', 'software-update.html', 'merge-conflict.html', 'sleep-review.html'],
    scope: 'Rebuild the ENTIRE stylesheet as the Calm·Warm Paper + Fluent system: the :root token set (paper/canvas/sidebar/ink/muted/accent/run/warn/danger/line, the radius trio, the focus ring, and the sh-card/sh-raise/sh-pop/sh-modal elevation ladder), the base, and EVERY shared component (window chrome, fixed-width sidebar nav with the rationed-accent active state, buttons incl. exactly one filled primary + secondary/ghost/danger, the segmented control as a RAISED CHIP not a colored fill, the toggle, fields + focus ring, cards, tags, status pills) AND every view-specific rule — all lifted faithfully from design-system.html and the per-view mockups. Restyle EXISTING class names in place wherever the renderer already uses them; only add new classes where a mockup component has no current equivalent.',
  },
  {
    id: 'icons', wave: 0, dom: false,
    files: ['packages/gui/renderer/util.js'],
    mockups: ['design-system.html'],
    scope: 'Establish the single line-icon family as the source of truth: the SVG <symbol> sprite from design-system.html (clock/list/users/chart/settings/search/play/stop/swap/plus/star/cal/flag/moon/check/download/x/down/right/left/dots/edit/info/arrow/grip/restore) and a small helper to render an icon by id (1.6px stroke, currentColor). Remove any emoji-glyph helpers. Do NOT change unrelated util exports the renderer relies on; keep their signatures.',
  },
  {
    id: 'shell', wave: 1, dom: true,
    files: ['packages/gui/renderer/index.html', 'packages/gui/test/renderer-static.test.ts'],
    mockups: ['design-system.html', 'main.html', 'timer.html', 'clients.html', 'reports.html', 'settings.html'],
    scope: 'Restructure the window shell + fixed-width sidebar nav + every static view-container markup to the new class system and the line-icon sprite (replace ALL emoji), matching the mockups, and STRIP all unnecessary text. Keep every data-view / id / data-* hook. Update renderer-static.test.ts to assert the NEW structure without weakening it.',
  },
  {
    id: 'popover', wave: 1, dom: true,
    files: ['packages/gui/renderer/popover.html', 'packages/gui/renderer/popover.js', 'packages/gui/test/tray.test.ts'],
    mockups: ['tray-popover.html'],
    scope: 'Restyle the menu-bar / system-tray popover to tray-popover.html: a chromeless compact surface (one rung of elevation, the notch), the running count-up with tabular numerals + the run dot, Stop (primary) / Switch, a quick-start list, and Open Stint / Quit — line icons, no emoji, no unnecessary text. Update tray.test.ts to the new structure.',
  },
  {
    id: 'main', wave: 2, dom: true,
    files: ['packages/gui/renderer/app.js', 'packages/gui/test/favorites.test.ts', 'packages/gui/test/tags.test.ts'],
    mockups: ['timer.html', 'main.html', 'clients.html', 'sleep-review.html'],
    scope: 'Align the main-window dynamic DOM that app.js emits to the new system: the Timer card + active-timer strip + live-edit, the day-grouped Entries list (overlap warn pills + slept-through with strike-through billable), the merge selection bar, the Clients reference-data view, and the sleep-review sub-surface — new component classes, line icons, tabular-num time, semantic pills paired with words, and unnecessary text removed. Update favorites.test.ts and tags.test.ts.',
  },
  {
    id: 'editor', wave: 2, dom: true,
    files: ['packages/gui/renderer/editor.js', 'packages/gui/test/confirm.test.ts'],
    mockups: ['edit-entry.html', 'merge-conflict.html'],
    scope: 'Restyle the entry editor / manual-add / split / merge-conflict resolution / two-step delete confirm (window.SE) to edit-entry.html + merge-conflict.html: the dialog sits one rung above content (sh-modal), field/label/toggle components, the merge field-by-field conflict radios with auto-kept rows, the in-window two-step delete confirm — no unnecessary text. Update confirm.test.ts.',
  },
  {
    id: 'reports', wave: 2, dom: true,
    files: ['packages/gui/renderer/reports.js', 'packages/gui/test/reportview.test.ts'],
    mockups: ['reports.html'],
    scope: 'Restyle the in-sidebar Reports view to reports.html: the saved-reports list, the builder (range presets/custom, group-by segmented control as raised chips, client/project/tag filters, billable toggle, rounding control, search), the on-screen grouped summary with flags, and CSV/JSON export — tabular-num totals, line icons. Update reportview.test.ts.',
  },
  {
    id: 'settings', wave: 2, dom: true,
    files: ['packages/gui/renderer/settings.js', 'packages/gui/test/backupview.test.ts', 'packages/gui/test/update.test.ts'],
    mockups: ['settings.html', 'software-update.html'],
    scope: 'Restyle the Settings view to settings.html and the Software Update section + guided-install flow to software-update.html (the update banner one rung up, the version rows, the three-step guided install), plus the backup/restore section — segmented controls as raised chips, one primary per group, no unnecessary text. Update backupview.test.ts and update.test.ts as structure changes.',
  },
  {
    id: 'picker', wave: 2, dom: true,
    files: ['packages/gui/renderer/timepicker.js'],
    mockups: ['time-range-picker.html'],
    scope: 'Restyle the visual time-range picker (window.STP) to time-range-picker.html: the popover/modal elevation, month view → single-day hour-line column, the ACCENT "me" rectangle (drag body = move, drag bottom = resize, 5-min snap), other entries gray, overlaps yellow (warn-only). Preserve .stp/.stp-block.me/.stp-resize/.stp-apply and all picker selectors the record recipes drive.',
  },
];

// scope a calibration run to a subset of unit ids (args: "settings" or ["shell","reports"]).
function normalizeScope(a) {
  if (a == null) return null;
  const raw = Array.isArray(a) ? a : (typeof a === 'object' ? (a.scopeTo || a.scope || a.units || []) : [a]);
  const toks = (Array.isArray(raw) ? raw : [raw]).map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  return toks.length ? toks : null;
}
const scope = normalizeScope(args);
let units = UNITS;
if (scope) {
  units = UNITS.filter((u) => scope.some((s) => u.id.toLowerCase().includes(s)));
  log(`scope ${JSON.stringify(scope)} → ${units.map((u) => u.id).join(', ') || '(none)'}`);
  if (!units.length) return { scopedOut: true, scope, note: 'No unit matched.' };
}
const mockupRef = (u) => u.mockups.map((m) => `context/mockups/${m}`).join(', ');

// ===========================================================================
// Per-unit processing: rewrite → verify → dual review → bounded improve.
// Each unit gets its OWN full verify + review run (mirroring requirements-transition.js,
// but scoped to one rewrite agent). Returns the accumulated record incl. cssRequests.
// Build clashes are avoided: per-unit verify runs the unit's OWN vitest files + the
// structural smoke (vitest is process-isolated; no shared dist/judge writes here —
// the single tsc build + judge/evidence regen happen serialized in later phases).
// ===========================================================================
const SMOKE = 'packages/gui/test/renderer-static.test.ts';
function verifyCmd(u) {
  const files = Array.from(new Set([...(u.files.filter((f) => f.endsWith('.test.ts'))), SMOKE]));
  return `npx vitest run ${files.join(' ')}`;
}

async function processUnit(u, phaseName) {
  // -- rewrite --
  const rw = await agent(
    `${REPO}\n\n${DESIGN}\n\n${PRESERVE}\n\nRESTYLE UNIT "${u.id}". Files you OWN (edit only these): ${u.files.join(', ')}.
Reference mockup(s): ${mockupRef(u)} (and context/mockups/design-system.html).
Task: ${u.scope}
Read the mockup(s) + design-system.html first, then rewrite. Keep all harness selectors/ids/data-*
intact (see CRITICAL rules). If you need a shared styles.css/index.html rule you don't own, return it
in cssRequests instead of editing those files. Do not run build/test (a verify step follows).`,
    { label: `rewrite:${u.id}`, phase: phaseName, schema: REWRITE, effort: 'high' }
  );

  // -- verify (this unit's own tests + structural smoke) --
  let vr = await agent(
    `${REPO}\n\nVERIFY restyle unit "${u.id}". Run \`${verifyCmd(u)}\` and report testPassed + the exact
failing test names with the key error line for any failure. (build/judge/evidence: report false; they
run serialized later.) Do not fix anything — just report.`,
    { label: `verify:${u.id}`, phase: phaseName, schema: SUITE, effort: 'high' }
  );

  // -- dual review (mockup-fidelity + code-quality), in parallel --
  let [fid, arch] = await parallel([
    () => agent(
      `${REPO}\n\n${DESIGN}\n\nMOCKUP-FIDELITY REVIEW of restyle unit "${u.id}" (files ${u.files.join(', ')};
mockups ${mockupRef(u)}). Default to "insufficient". Upgrade to "sufficient" ONLY if it matches the
mockup AND honors every emphasized subtle point (accent rationed, selection≠accent, elevation ladder,
no unnecessary text, tabular nums, line-icons-no-emoji) AND every harness selector this unit touches
still resolves. List concrete gaps. Be a hostile critic.`,
      { label: `review-fidelity:${u.id}`, phase: phaseName, agentType: 'Explore', schema: FIDELITY, effort: 'high' }
    ),
    () => agent(
      `${REPO}\n\nCODE-QUALITY REVIEW of restyle unit "${u.id}" (files ${u.files.join(', ')}). Matt-Pocock
method on the changed file(s): hunt duplication, dead code, shallow modules, poor locality, cognitive
bounce, and INCONSISTENCY with the shared component classes. Apply the deletion test. Rate findings
Strong / Worth exploring / Speculative with behavior-preserving, AC-preserving recommendations. clean=true
ONLY if no Strong findings remain.`,
      { label: `review-arch:${u.id}`, phase: phaseName, agentType: 'Explore', schema: ARCH, effort: 'high' }
    ),
  ]);

  // -- bounded improve loop (≤2): close fidelity gaps + Strong findings + any red tests --
  const cssRequests = [...(rw.cssRequests || [])];
  for (let round = 0; round < 2; round++) {
    const strong = (arch.findings || []).filter((f) => f.rating === 'Strong');
    const needsWork = fid.verdict === 'insufficient' || !vr.testPassed || strong.length > 0;
    if (!needsWork) break;
    const fix = await agent(
      `${REPO}\n\n${DESIGN}\n\n${PRESERVE}\n\nIMPROVE restyle unit "${u.id}" (edit only ${u.files.join(', ')}).
Close these WITHOUT changing behavior, breaking harness selectors, or weakening assertions:
- Fidelity gaps: ${(fid.gaps || []).join('; ') || 'none'}
- Failing tests: ${(vr.failures || []).join(' | ') || 'none'}
- Strong code-quality findings: ${strong.map((f) => `${f.title} @ ${(f.locations || []).join(',')} — ${f.recommendation}`).join(' | ') || 'none'}
If a fix needs a shared styles.css/index.html rule, return it in cssRequests instead. Then stop.`,
      { label: `improve:${u.id}-r${round + 1}`, phase: phaseName, schema: REWRITE }
    );
    (fix.cssRequests || []).forEach((c) => cssRequests.push(c));
    vr = await agent(
      `${REPO}\n\nRe-verify unit "${u.id}": run \`${verifyCmd(u)}\` and report testPassed + failures. No fixes.`,
      { label: `verify:${u.id}-r${round + 1}`, phase: phaseName, schema: SUITE, effort: 'high' }
    );
    fid = await agent(
      `${REPO}\n\n${DESIGN}\n\nRe-run the MOCKUP-FIDELITY REVIEW of unit "${u.id}" (same bar, default insufficient).`,
      { label: `review-fidelity:${u.id}-r${round + 1}`, phase: phaseName, agentType: 'Explore', schema: FIDELITY, effort: 'high' }
    );
  }

  return { unit: u.id, rewrite: rw, verify: vr, fidelity: fid, arch, cssRequests };
}

// ===========================================================================
// Foundation (wave 0) then Restyle (waves 1, 2). Process wave by wave so deps
// (styles/icons → shell → views) are satisfied; within a wave units are file-
// disjoint, so pipeline them (each flows through its own verify/review/improve).
// ===========================================================================
const results = [];
const maxWave = Math.max(...units.map((u) => u.wave));
for (let w = 0; w <= maxWave; w++) {
  const waveUnits = units.filter((u) => u.wave === w);
  if (!waveUnits.length) continue;
  const phaseName = w === 0 ? 'Foundation' : 'Restyle';
  log(`${phaseName} — wave ${w}: ${waveUnits.map((u) => u.id).join(', ')}`);
  // pipeline so each unit independently runs rewrite→verify→review→improve; file-disjoint within a wave.
  const waveResults = await pipeline(
    waveUnits,
    (u) => processUnit(u, phaseName)
  );
  results.push(...waveResults.filter(Boolean));
}

const allCssRequests = results.flatMap((r) => r.cssRequests || []);
const insufficient = results.filter((r) => r.fidelity && r.fidelity.verdict === 'insufficient').map((r) => r.unit);
log(`Restyle done: ${results.length} units; ${insufficient.length ? `still-insufficient: ${insufficient.join(', ')}` : 'all units fidelity-sufficient'}; ${allCssRequests.length} shared-CSS request(s).`);

// ===========================================================================
// Reconcile — apply any shared styles.css/index.html deltas the view units asked
// for (serialized; these are the only edits to the shared files after Foundation),
// then build + full test the whole tree.
// ===========================================================================
phase('Reconcile');
if (allCssRequests.length) {
  await agent(
    `${REPO}\n\n${DESIGN}\n\nApply these shared-style requests raised by the view units to
packages/gui/renderer/styles.css (and packages/gui/renderer/index.html only if a request is structural).
Keep them consistent with the existing token set and component classes — do NOT introduce one-off colors,
new radii, or decorative rules; reuse tokens. Requests:
${allCssRequests.map((c, i) => `${i + 1}. ${c}`).join('\n')}
Then stop (a full build+test follows).`,
    { label: 'reconcile-css', phase: 'Reconcile' }
  );
} else {
  log('Reconcile: no shared-CSS requests.');
}
const reconcileSuite = await agent(
  `${REPO}\n\nRun \`npm run build\` then \`npm test\`. Report build, testPassed, and the exact failing test
names with the key error line. Do not fix anything.`,
  { label: 'reconcile-verify', phase: 'Reconcile', schema: SUITE, effort: 'high' }
);
if (!(reconcileSuite.build && reconcileSuite.testPassed)) {
  log(`Reconcile red: ${(reconcileSuite.failures || []).slice(0, 6).join(' | ')} — repairing.`);
  await agent(
    `${REPO}\n\n${PRESERVE}\n\nThe full build/test is red after the restyle. Fix ONLY what is broken
(markup/test mismatches, a dropped selector, a CSS typo) across the renderer + its tests, minimally and
without weakening assertions or changing behavior, until \`npm run build && npm test\` is green. Then stop.
Failures:\n${(reconcileSuite.failures || []).join('\n')}`,
    { label: 'reconcile-repair', phase: 'Reconcile' }
  );
}

// ===========================================================================
// Evidence — serialized regen of all evidence: the judge produces NEW screenshots
// of the restyled renderer (visual proof), and the cli transcript stays fresh.
// ===========================================================================
phase('Evidence');
const evidence = await agent(
  `${REPO}\n\nRun in order and report each precisely: \`npm run build\`, \`npm test\`,
\`npm run verify:no-network\`, \`npm run judge\` (regenerates acceptance/evidence/judge-report.json +
screenshots/ over the restyled renderer), \`npm run evidence\`. Return build/testPassed/judge/evidence/
noNetwork booleans, any failures with the key error line, and a one-paragraph summary. Do not fix anything.`,
  { label: 'evidence-regen', phase: 'Evidence', schema: SUITE, effort: 'high' }
);
log(`Evidence: build=${evidence.build} tests=${evidence.testPassed} judge=${evidence.judge} evidence=${evidence.evidence} no-network=${evidence.noNetwork}`);

// ===========================================================================
// Review — cross-cutting CONSISTENCY (the "total consistency" goal) + architecture
// over the whole renderer diff, then a bounded improve that must not regress tests.
// ===========================================================================
phase('Review');
let consistency = await agent(
  `${REPO}\n\n${DESIGN}\n\nCROSS-CUTTING CONSISTENCY REVIEW of the ENTIRE restyled renderer
(packages/gui/renderer/*) against context/mockups/design-system.html. The goal is TOTAL CONSISTENCY:
the same tokens, type ramp, spacing (4px grid), radii, elevation ladder, ONE line-icon family (zero
emoji anywhere), buttons (one primary per view), segmented-control-as-raised-chip, and "UI speaks for
itself" text discipline across EVERY view — sidebar, Timer, Entries, Clients, Reports, Settings, editor,
picker, popover. Flag every place a view diverges from the shared system or another view (one-off colors,
stray emoji, ad-hoc spacing, leftover explanatory text, accent used decoratively, nested cards). Rate
Strong/Worth exploring/Speculative; clean=true only if no Strong divergence remains.`,
  { label: 'review-consistency', phase: 'Review', agentType: 'Explore', schema: ARCH, effort: 'high' }
);
const FUEL = budget && budget.total ? Math.max(1, Math.min(3, Math.floor(budget.remaining() / 300_000))) : 2;
for (let round = 0; round < FUEL; round++) {
  const strong = (consistency.findings || []).filter((f) => f.rating === 'Strong');
  if (!strong.length) break;
  log(`Review improve round ${round + 1}: ${strong.length} Strong consistency finding(s).`);
  await agent(
    `${REPO}\n\n${DESIGN}\n\n${PRESERVE}\n\nApply these Strong consistency findings across the renderer
WITHOUT changing behavior, breaking harness selectors, or weakening tests; reuse the shared tokens/classes:
${strong.map((f, i) => `${i + 1}. [${f.kind}] ${f.title} @ ${(f.locations || []).join(', ')} — ${f.recommendation}`).join('\n')}
Then run \`npm run build && npm test\` and confirm green; if a finding is wrong/risky, skip it and say why.`,
    { label: `review-improve-r${round + 1}`, phase: 'Review' }
  );
  const guard = await agent(
    `${REPO}\n\nRun \`npm run build && npm test\`; report build/testPassed + failures. No fixes.`,
    { label: `review-guard-r${round + 1}`, phase: 'Review', schema: SUITE, effort: 'high' }
  );
  if (!(guard.build && guard.testPassed)) {
    await agent(
      `${REPO}\n\n${PRESERVE}\n\nThe consistency pass regressed build/tests. Fix ONLY the regression,
minimally, without weakening assertions, until \`npm run build && npm test\` is green. Then stop.
Failures:\n${(guard.failures || []).join('\n')}`,
      { label: `review-repair-r${round + 1}`, phase: 'Review' }
    );
  }
  consistency = await agent(
    `${REPO}\n\n${DESIGN}\n\nRe-run the CROSS-CUTTING CONSISTENCY REVIEW (same bar). clean=true only if no
Strong divergence remains.`,
    { label: `review-consistency-r${round + 1}`, phase: 'Review', agentType: 'Explore', schema: ARCH, effort: 'high' }
  );
}

// ===========================================================================
// Recordings (LAST) — QA evidence: drive the restyled renderer via the existing
// record harness, convert to slowed ASCII-named committed GIFs. Honest about a
// missing capability — never fake a file.
// ===========================================================================
phase('Recordings');
const recSetup = await agent(
  `${REPO}\n\nPrepare the screen-RECORDING harness for the restyled renderer. The entry point exists:
packages/gui/judge/record.mjs (Playwright recordVideo over the real renderer + canned fixtures + pinned
clock). Ensure it can run here: \`npm run build\` first; if it imports a missing dep (e.g. playwright-core)
install it; run \`node packages/gui/judge/record.mjs --list\` to enumerate the available recipe ids.
Report the list of recipe ids and whether the host can actually capture video (Playwright returns a
video() handle / a .webm is produced). Do NOT fake anything — if capture is impossible here, say so
clearly so the per-recipe step surfaces it. Also confirm \`ffmpeg\` is available (install via apt-get if
missing) for the webm→gif conversion. Do not change any judge/record behavior or rubric.`,
  { label: 'rec:setup', phase: 'Recordings', effort: 'high' }
);
log(`Recordings setup: ${recSetup.slice(0, 240)}`);

// A representative set of surfaces to showcase the new style in motion. The setup agent listed the real
// recipe ids; these capture agents each pick the matching recipe for their surface (and skip honestly if
// the id or capability is absent). Distinct GIF outputs → safe to run in parallel.
const REC_TARGETS = [
  { slug: 'restyle-timer', surface: 'the full Timer view (live count-up, live edit, favorites rail)', hint: 'prefer recipe "§12 R14" (full Timer view) or "§05 R01"/"§05 R02"' },
  { slug: 'restyle-entries-picker', surface: 'the Entries list + manual-add with the visual time-range picker (overlap warn)', hint: 'prefer recipe "§12 R15" or "§05 R05"/"§12 R07"' },
  { slug: 'restyle-favorites', surface: 'the favorites rail (pin / list / resume)', hint: 'prefer recipe "favorites-rail" or "§05 R09"/"§05 R10"' },
  { slug: 'restyle-reports', surface: 'the in-sidebar Reports view (builder + grouped summary)', hint: 'prefer a reports recipe (e.g. one driving the Reports view / savedReportsState)' },
  { slug: 'restyle-settings', surface: 'the Settings view', hint: 'prefer a settings recipe (settingsState)' },
  { slug: 'restyle-update', surface: 'the software-update / guided-install flow', hint: 'prefer a software-update recipe (UPDATE_FIXTURE)' },
];
const recordings = (await parallel(
  REC_TARGETS.map((t) => () =>
    agent(
      `${REPO}\n\nCapture screen-recording QA evidence showing the RESTYLED look in motion for ${t.surface}.
Use the record harness from rec:setup: ${t.hint}. Run the matching recipe to produce a .webm, then
convert it to a slowed, ASCII-named, COMMITTED GIF at acceptance/evidence/recordings/${t.slug}.gif with a
~1.5s end-frame hold (two-pass palette for quality):
  ffmpeg -y -i in.webm -vf "setpts=2.0*PTS,fps=15,scale=iw:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=1.5,palettegen=stats_mode=diff" pal.png
  ffmpeg -y -i in.webm -i pal.png -filter_complex "setpts=2.0*PTS,fps=15,scale=iw:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=1.5[v];[v][1:v]paletteuse=dither=sierra2_4a" "acceptance/evidence/recordings/${t.slug}.gif"
Use reqId "${t.slug}". Return captured=true + the committed GIF path + \`shows\` (a one-line caption of
what it demonstrates). If the matching recipe id doesn't exist or the host can't record/convert, return
captured=false and NOTE exactly why and what a human must do — never fabricate a file.`,
      { label: `rec:${t.slug}`, phase: 'Recordings', schema: RECORDING }
    )
  )
)).filter(Boolean);
const got = recordings.filter((r) => r.captured).length;
log(`Recordings: ${got}/${recordings.length} captured.`);

// ===========================================================================
// PR — final evidence regen, commit on the working branch, and UPDATE the existing
// branch PR (the design-system + mockups PR) with the implementation, a per-unit
// checklist, and the recordings embedded inline. Do NOT open a second PR; do NOT merge.
// ===========================================================================
phase('PR');
const finalSuite = await agent(
  `${REPO}\n\nFinal evidence regen — run in order and report precisely: \`npm run build\`, \`npm test\`,
\`npm run verify:no-network\`, \`npm run judge\`, \`npm run evidence\`. Return the five booleans, any
failures with the key error line, and a one-paragraph summary. Do not fix anything.`,
  { label: 'final-evidence', phase: 'PR', schema: SUITE, effort: 'high' }
);
log(`Final: build=${finalSuite.build} tests=${finalSuite.testPassed} judge=${finalSuite.judge} evidence=${finalSuite.evidence} no-network=${finalSuite.noNetwork}`);

const checklist = results.map((r) => ({
  unit: r.unit,
  status: r.fidelity && r.fidelity.verdict === 'sufficient' && (r.verify ? r.verify.testPassed : true) ? 'done' : 'partial',
  gaps: r.fidelity ? (r.fidelity.gaps || []) : [],
}));

const pr = await agent(
  `${REPO}\n\nAggregate this GUI restyle onto the CURRENT working branch and the EXISTING PR for it (the
design-system + mockups PR — find it via the GitHub MCP tools / ToolSearch "github pull request" or the
git remote; do NOT open a second PR, do NOT target a new branch, do NOT merge).
1. Stage and commit all renderer + test + evidence changes with a clear message (the Fluent/Calm GUI
   restyle: foundation tokens+icons, shell, popover, and every view aligned to the mockups; no behavior
   change). Use the repo's commit trailer convention. Push the branch.
2. UPDATE the existing PR's description: add an "Implementation — Fluent UI rework" section with
   - a one-paragraph summary (the running GUI now matches the mockups/design system; restyle-only, no
     behavior/AC change);
   - a PER-UNIT checklist (use this data):
${checklist.map((c) => `     - [${c.status === 'done' ? 'x' : ' '}] ${c.unit} — ${c.status}${c.gaps && c.gaps.length ? ` (${c.gaps.join('; ')})` : ''}`).join('\n')}
   - a "Screen recordings" subsection embedding each captured GIF inline. After committing+pushing,
     capture the commit SHA, then for each captured recording write its caption + an image pinned to that
     SHA: \`![<reqId> — <shows>](https://github.com/<owner>/<repo>/raw/<sha>/<path>)\`. List any NOT
     CAPTURED with the reason instead of a file. Recording data (reqId | path | shows | status):
${recordings.length ? recordings.map((r) => `     - ${r.reqId} | ${r.captured ? `${r.path} | ${r.shows || ''}` : `NOT CAPTURED — ${r.notes || ''}`}`).join('\n') : '     - (none)'}
   - an "Evidence" note: build=${finalSuite.build}, tests=${finalSuite.testPassed}, judge=${finalSuite.judge},
     evidence=${finalSuite.evidence}, no-network=${finalSuite.noNetwork}; new judge screenshots regenerated.
   Keep the repo's Markdown PR-body footer. Return committed, the PR url, and a summary. Do NOT merge.`,
  { label: 'open-pr', phase: 'PR', schema: PR_RESULT, effort: 'high' }
);
log(`PR: committed=${pr.committed} url=${pr.prUrl}`);

return {
  units: results.map((r) => ({ unit: r.unit, fidelity: r.fidelity ? r.fidelity.verdict : 'n/a', testsGreen: r.verify ? r.verify.testPassed : null })),
  cssRequestsApplied: allCssRequests.length,
  consistencyClean: consistency.clean,
  evidence: finalSuite,
  recordings: { targeted: REC_TARGETS.length, captured: got },
  pr: { committed: pr.committed, url: pr.prUrl },
  summary: pr.summary,
};
