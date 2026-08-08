# Reference — `Agentic QA Audit` findings

Loaded by `triage-issues`. Facts only: what the finding is, which doc owns
it, where its proof of fix lives. The procedure is in `SKILL.md`.

## Finding shape

A reproduced, root-caused GUI defect: symptom, root cause with file:line
pointers, embedded repro evidence from the evidence bucket, honest
severity and confidence. Filed by `author-bug-report` at the end of a QA
audit. It reproduces through the real entry point — treat the defect as real
unless the body itself flags a confidence gap.

## Owning doc

`context/prd.html` — the requirements and the §17 acceptance criteria.
`features/*.feature` and `acceptance/criteria/` for what is already proven.

A QA audit deliberately judges the app **as a user acting intuitively, not
against the spec**, so "no requirement covers this" is the normal case, not a
dismissal — it is what `needs new requirement or AC` is for.

## Where the proof of fix lives

**The recurring lesson: these are renderer-behavior bugs the suite structurally
cannot see.** Diagnose why it slipped before naming a guard, or the new guard
lands in the same blind spot:

- BDD and PROP run over `@stint/core` + `tt` with **no DOM** — a GUI bug passes
  them cleanly.
- `packages/gui/test/renderer-static.test.ts` holds **static-only** contracts
  (banned APIs/glyphs, isolation, unique ids — issue #85). Renderer *behavior*
  never lands there.
- The JUDGE recipes that *do* drive the real renderer often assert
  control-level facts, or use fixtures too small to tell "filtered" from
  "show-all."

The homes:

| Kind of behavior | Guard |
|---|---|
| GUI drive-to-outcome | A **JUDGE** machine-scored recipe: `packages/gui/judge/record.mjs` + `run-judge.mjs`, rubric row in `acceptance/criteria/judge-rubric.md`, over a **realistic** fixture. The home for most QA-audit findings — it drives the actual renderer over a real store. `judge-bind.test.ts` binds rubric row ↔ scene both directions, so a new row needs its scene. |
| core contract / invariant | **BDD** (`features/*.feature`, core + `tt`), **PROP**, or **GOLD**. |
| static-only contract (banned API/glyph, isolation, structural invariant a driven page cannot see) | `packages/gui/test/renderer-static.test.ts`. |
| live-only residue | `acceptance/criteria/manual/runbook.md`, plus the automated mirror R03 requires. |

Two traps worth naming in the comment when they apply:

- **Fixture realism.** A bug invisible with one day of data is blatant with
  three weeks (issue #55). A JUDGE scene over a trivial fixture is a guard that
  will miss the next one.
- **Outcome over control.** Where an existing guard should have caught it, the
  usual diagnosis is a control-level assertion ("the filter button exists")
  where an outcome assertion was needed ("the list shows only the filtered
  rows").
