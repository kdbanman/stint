# Requirements transition — Remove the "Switch" concept (issue #34)

This is the single source of truth the `requirements-transition` workflow
consumes. It removes **Switch** as a distinct concept across requirements and
implementation. Net effect: one fewer verb/affordance, **no behavior lost** —
Start already performs the atomic stop-then-start, and Resume already carries
attributes forward.

The new requirement docs (`context/prd.html`, `context/concept.html`,
`context/glossary.html`, `context/acceptance.html`) and the mockups
(`timer.html`, `main.html`, `tray-popover.html`, `design-system.html`) are
**already authored** (Switch removed). Their `*-old.html` snapshots coexist
until §Z. The workflow's job is the **code + spec + acceptance-apparatus**
changes below, then verification, review, recordings, one PR, and the §Z swap.

---

## §0 How the workflow consumes this file

Each requirement row carries these columns:

| Column | Meaning |
|--------|---------|
| **ID** | Stable requirement id (e.g. `§05 R01`, `§12 R05`). Switch's own id `§05 R8` is **retired**, not renumbered — favorites/resume stay at `§05 R09/R10/R11`. |
| **Change** | `NEW` · `MODIFIED` · `DELETED`. |
| **Core** | `●` iff the requirement meets the §C core definition (integrity / loss-prevention / core-entry). |
| **Surfaces** | `core` · `cli` · `gui` · `specs` · `docs` — where the change lands. |
| **Files** | Every file the change creates/edits/deletes (code AND tests AND parity/coverage/rubric/runbook/evidence/mockup/doc). Used to schedule **file-disjoint** waves. |
| **Mockup** | Mockup file(s) depicting a GUI requirement (`—` if none). |
| **AC** | Executable AC method(s): `BDD` · `PROP` · `GOLD` · `JUDGE` · `MANUAL`. Empty for docs-only rows; a DELETED row is verified by the **absence-of-`switch`** check, not a new test. |
| **Rec** | `▶` iff a screen recording is required in QA evidence (§W). |

> **DANGER — false positives that must NOT be touched.** Two `switch` tokens in
> the code are unrelated to the feature and must survive verbatim:
> - `packages/gui/renderer/settings.js` — `role="switch"` (ARIA role on a toggle).
> - `packages/gui/src/main.ts:148` — `switch (nextTimerAction(...))` (a JS
>   `switch` statement).
> Also intentional and kept: the docs' negations ("no separate switch action")
> and the generic English verb in `context/concept.html` ("when you switch from
> one client to another you start a new timer").

---

## §1 Global decisions

| ID | Decision |
|----|----------|
| **G1** | "Switch" is removed entirely as a distinct concept — no verb, affordance, alias, term, scenario, JUDGE item, or requirement anywhere. No new Switch requirements are added (the #27 audit's "Switch instant & carry-forward default" proposal is **dropped, not adopted**). |
| **G2** | **Start** is the canonical atomic stop-then-start. The one useful framing is folded into Start (§05 R01): *"starting while a timer runs stops the open entry first, as one atomic stop-then-start."* Attribute carry-forward stays the job of **Resume** (§05 R04). |
| **G3** | **Timer view, running state:** the start-with-details form **stays available while running**. Submitting it starts a new entry, atomically stopping the open one — a strictly richer "switch." Stop stays. The dedicated `#switch` / `#timer-switch` buttons are deleted. |
| **G4** | **Tray popover, running state:** the Stop/Start toggle **+ Open Stint only**. The dedicated Switch button is deleted; the popover does not host a favorites/quick-start list (favorites stay reachable via the Timer view's favorites rail). |
| **G5** | **CLI:** drop `.alias('switch')` on `start` (`program.ts`). `tt start` is the only verb (still the atomic stop-then-start). |
| **G6** | **Specs/parity:** remove Switch scenarios/steps from `features/tracking.feature`, `features/parity.feature`, `features/reachable_by_hand.feature`; remove the `switch()` methods from the BDD `CoreWorld`/`CliWorld`/interface and the `switch` step. The PROP at-most-one-open / atomic-transition laws **keep their coverage** using a `start`/`stop`/`add` generated op set (drop `switch` from the generator). `parity-matrix.json`'s `start` row drops `"switch"` from its `tt` array. |
| **G7** | **Glossary:** no Switch term added; the existing disposition note is updated to past tense ("removed — issue #34"). Already authored. |
| **G8** | **Core:** no core behavior changes. Removing Switch opens **no** data-integrity/loss gap — Start's atomicity (at-most-one-open, atomic stop-then-start) is unchanged and already core-covered. No relabels, no net-new core requirements (see §C). |

---

## §C Core requirement classification

**Definition.** A requirement is `core` iff it (a) ensures data integrity,
(b) protects against data loss, or (c) enables core data entry.

- **No relabels.** Every existing `core` badge stands. The reqs this transition
  touches that are already `core` — `§05 R01` (Start), `§12 R05` (Start form),
  `§12 R04` (Active-timer panel), `§12 R14` (Full Timer view) — **keep** their
  badges; their core character (atomic stop-then-start; the GUI core-entry
  surface) is unchanged by removing the redundant Switch label.
- **No net-new core requirements.** Removing Switch closes no integrity/loss
  gap and opens none: Start was always the atomic stop-then-start, and the
  **at-most-one-open** + **atomic-transition** PROP laws (`§04 R02–R04`,
  `prop/invariants.test.ts`) already prove no operation leaves two open rows or
  loses a close. Those laws are *retained verbatim* except that their generator
  no longer emits a redundant `switch` op (it emits `start`, which is the same
  core call).
- **Exclusion recorded.** This is a *deletion* transition; the "is it core?"
  question applies to what's removed. Nothing core is removed — the Switch
  surface was a pure alias of Start with no independent behavior, data, or
  invariant. Verified by: no `core` `switch()` exists (`CoreWorld.switch =
  store.start`), no schema/table, no migration.

---

## §2 Section-by-section changes

### §05 Timer & entries

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|----|--------|------|----------|---------|-------|--------|----|----|
| §05 R01 (Start) | MODIFIED | ● | core, cli, gui, docs | Fold in "starting while running stops the open entry first (atomic stop-then-start) — switching *is* starting; no separate verb." (doc already authored.) | `context/prd.html` *(done)* | timer.html, tray-popover.html | BDD (`features/tracking.feature` start-while-running), PROP (`prop/invariants.test.ts` at-most-one-open) | — |
| §05 R8 (Switch) | **DELETED** | — | core, cli, gui, specs, docs | Remove the Switch requirement wholesale; it had no behavior beyond Start. (PRD slot retired, not renumbered.) | `context/prd.html` *(done)* | — | absence check (no `switch` verb/affordance/alias/term survives) | — |

### §11 CLI

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|----|--------|------|----------|---------|-------|--------|----|----|
| §11 switch-alias | **DELETED** | — | cli | Drop `.alias('switch')` on the `start` command (and its `§05 R8` comment). `tt start` remains the atomic stop-then-start. | `packages/cli/src/program.ts` (~line 207); `packages/cli/test/gold/cli.test.ts` (any golden asserting the `switch` alias / command list) | — | GOLD (`cli.test.ts`: help/command-list no longer offers `switch`; `tt start` still stops-then-starts) | — |

### §12 GUI

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|----|--------|------|----------|---------|-------|--------|----|----|
| §12 R01 (Tray popover) | MODIFIED | — | gui | Remove the dedicated Switch button; popover while running = Stop/Start toggle + Open Stint only. | `packages/gui/renderer/popover.html` (remove `#switch`), `packages/gui/renderer/popover.js` (remove `#switch` wiring/icon/comment), `packages/gui/renderer/styles.css` (popover action-row), `packages/gui/src/main.ts:280` (comment), `packages/gui/test/tray.test.ts`, `packages/gui/test/parity.test.ts` | tray-popover.html *(done)* | JUDGE (`TRAY_POPOVER_SURFACE` — no Switch), MANUAL (`CHECK TRAY`) | ▶ |
| §12 R04 (Active-timer panel) | MODIFIED | ● | gui | Drop Switch from the card's primary actions; running card = Stop (+ favorite pin). Entries strip unchanged (it already hosts no actions). | `packages/gui/renderer/index.html` (remove `#timer-switch`), `packages/gui/renderer/app.js` (remove `#timer-switch` render/handler + comments ~117/180/202/278/1016–1024), `packages/gui/renderer/styles.css:164/1849`, `packages/gui/test/liveview.test.ts`, `packages/gui/test/renderer-static.test.ts` | timer.html *(done)*, main.html *(done)* | JUDGE (`IN_WINDOW_TIMER` — card shows Stop, no Switch) | ▶ |
| §12 R05 (Start form) | MODIFIED | ● | gui | Retitle "Start form" (drop "/Switch"); the form **stays available while running** (no longer "flips to Switch") so Start performs the atomic stop-then-start. Remove the legacy one-tap `#switch` button. | `packages/gui/renderer/index.html` (remove `#switch`), `packages/gui/renderer/app.js` (remove `#switch` render/handler + comments ~131/133/978–981/1272; ensure the start-form is shown, not hidden, while running), `packages/gui/renderer/styles.css:508/671`, `packages/gui/test/renderer-static.test.ts`, `packages/gui/test/parity.test.ts` | timer.html *(done)* | BDD (`features/reachable_by_hand.feature` start-with-attributes by hand), JUDGE (start form fields present while running; no Switch affordance) | ▶ |
| §12 R14 (Full Timer view) | MODIFIED | ● (entry) | gui | Drop "switch" from the view's capability list; create/start with details (starting while running stops the open entry first), stop, live-edit, favorites resume. | `packages/gui/renderer/index.html`, `packages/gui/renderer/app.js`, `packages/gui/test/renderer-static.test.ts` | timer.html *(done)* | JUDGE (`TIMER_VIEW`) | ▶ |
| §12 SWITCH_AFFORDANCE (JUDGE item) | **DELETED** | — | gui | Remove the dedicated `SWITCH_AFFORDANCE` judge check and its `main-switch.png` / popover-switch fixtures/screenshot; remove `switchVisible`/`hasSwitch`/`switchHidden` assertions from the popover & timer judge items so they assert Switch's **absence**. | `acceptance/criteria/judge-rubric.md`, `packages/gui/judge/run-judge.mjs`, `packages/gui/judge/fixtures.mjs`, `packages/gui/judge/record.mjs` | — | regenerated by `npm run judge` | — |

### Cross-cutting: BDD worlds & feature specs

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|----|--------|------|----------|---------|-------|--------|----|----|
| specs-switch | **DELETED** | — | specs | Remove every Switch scenario/step and `switch()` world method; keep start/stop/add coverage intact. | `features/tracking.feature` (Switch scenario), `features/parity.feature` (Switch scenario), `features/reachable_by_hand.feature` (Switch-by-hand scenario), `packages/core/test/bdd/world.ts` (interface `switch` + `CoreWorld.switch` + `CliWorld.switch`), `packages/core/test/bdd/steps.ts` (the `I switch to an entry …` step) | — | BDD (suite still green; no orphan step) | — |
| prop-switch | MODIFIED | ● | core | Drop `switch` from the generated operation set in the property tests; the at-most-one-open / atomic-transition laws keep proving over `start`/`stop`/`add` (start *is* the atomic stop-then-start). | `packages/core/test/prop/invariants.test.ts`, `packages/core/test/prop/appstate.test.ts` | — | PROP (laws unchanged, generator no longer emits `switch`) | — |

### Cross-cutting: acceptance apparatus & docs

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|----|--------|------|----------|---------|-------|--------|----|----|
| parity-switch | MODIFIED | — | cli, gui, docs | Drop `"switch"` from the `start` row's `tt` array and from its description. | `acceptance/criteria/parity-matrix.json` (line 8) | — | parity (`gui/test/parity.test.ts` reads this) | — |
| coverage-switch | MODIFIED | — | docs | Remove `switch` from the §04/§05 prose (the generated "start/stop/switch/add sequence" wording → "start/stop/add"); drop any Switch-AC mention. | `acceptance/criteria/COVERAGE.md` | — | — | — |
| runbook-switch | **DELETED** | — | docs | Delete the `CHECK IN-WINDOW SWITCH (GUI)` section (~lines 681–711) and the popover/Entries Switch checklist items (~72/74/589/620–621); keep the generic-English "switch group-by / switch light↔dark" lines untouched. | `acceptance/criteria/manual/runbook.md` | — | MANUAL (runbook still self-consistent) | — |
| readme-switch | MODIFIED | — | docs | "one click starts, stops, or switches" → "one click starts or stops" (line 55). | `README.md` | — | — | — |
| concept (doc) | MODIFIED | — | docs | Drop "switch" from the tray affordance list; keep the generic-verb sentence. Already authored. | `context/concept.html` *(done)* | — | — | — |
| glossary (doc) | MODIFIED | — | docs | Disposition note → past tense ("removed — issue #34"); no Switch term. Already authored. | `context/glossary.html` *(done)* | — | — | — |
| acceptance (doc) | MODIFIED | — | docs | "Start/Switch form" → "Start form"; drop "switch" from the §12 R14 subject. Already authored. | `context/acceptance.html` *(done)* | — | — | — |

---

## §W Screen-recording QA evidence (runs LAST)

QA evidence, **not** executable AC. Scope = core-flow GUI ∪ every `Rec ▶` row ∪
code-change-adjacent GUI. For this transition that is the running-state GUI
surfaces that change shape:

| Req | What the GIF must show |
|-----|------------------------|
| `§12 R05` (`12-r05.gif`) | Timer view while running: **Stop + the start-with-details form** (no Switch button). Fill the form and submit → the open entry closes and the new one opens in one action (Start *is* switch). |
| `§12 R04` (`12-r04.gif`) | The running Active-timer card showing **Stop** (and favorite pin), with **no** Switch button. |
| `§12 R01` (`12-r01.gif`) | The tray popover while running: **Stop + Open Stint** only — no Switch button. |
| `§12 R14` (`12-r14.gif`) | The full Timer view running flow: start-with-details, stop, live-edit, favorites resume — confirming no Switch verb anywhere in the view. |

Conventions (the workflow's Recordings stage carries the exact recipe): GIF,
ASCII-only filenames slugged from the req id (`§12 R05` → `12-r05.gif`), slowed
~0.5× with a ~1.5 s end-frame hold, a synthetic cursor + click pulse so clicks
are visible. Commit under `acceptance/evidence/recordings/` (do **not**
git-ignore) and embed each inline in the PR body as
`![<req id> — <caption>](<raw-url-at-commit-sha>)`, pinned to the commit SHA,
each with a one-line description.

---

## §R Review stages

Two separate passes, each looping into a bounded improvement pass:

1. **AC-evidence-sufficiency review** — adversarial completeness critic per
   touched requirement; defaults to *insufficient* unless the change is
   implemented **and** covered by a passing AC **and** reflected in regenerated
   evidence. Specifically must confirm: no `switch` verb/affordance/alias/term
   survives anywhere except the two whitelisted false positives (§0) and the
   intentional doc negations; the at-most-one-open PROP laws still pass; the
   regenerated `judge-report.json` no longer contains `SWITCH_AFFORDANCE` and
   the popover/timer items now assert Switch's absence.
2. **Code-quality & architecture review** — Matt-Pocock
   *improve-codebase-architecture* lineage: apply the deletion test (is the
   running-state code simpler with one affordance gone?), hunt for orphaned
   handlers/CSS/ids left behind, dead `#i-swap` references that were *only* for
   Switch (the icon stays for Merge), and any now-redundant branching in the
   renderer. Must not regress AC.

---

## §Z Swap / cleanup (final stage, gated on all-green)

Only when every touched requirement has passing AC evidence **and** both reviews
are clean, on a full (unscoped) run, perform on the PR branch (commit, do not
merge):

**deletePaths**
- `context/prd-old.html`
- `context/concept-old.html`
- `context/glossary-old.html`
- `context/acceptance-old.html`
- `requirements-transition.md` (this mapping)

> No GUI page is folded away and no legacy workflow is superseded by this
> transition — Switch was an alias/affordance, not a standalone view. Do **not**
> delete anything not listed here.

**referenceFixes** — ensure these reference only the new docs/surfaces and that
**no `switch` verb/affordance/alias/term survives** (allowed survivors: the two
§0 false positives and the doc negations):
- `README.md`
- `CLAUDE.md`
- `acceptance/criteria/COVERAGE.md`
- `acceptance/criteria/parity-matrix.json`
- `acceptance/criteria/judge-rubric.md`
- `acceptance/criteria/manual/runbook.md`

Final gate confirmation: `npm run build && npm test && npm run judge &&
npm run evidence && npm run verify:no-network` all green, recordings committed
and embedded in the PR, then push to the PR branch. The **human gate is the PR
merge.**
