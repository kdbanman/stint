---
name: process-requirements-transition
description: >-
  Use for a Stint requirements change too large to land as in-place section
  edits — a whole-doc rewrite or multi-doc restructure. Reached from the
  triaged backlog (`Triaged: transition required`) or invoked by the owner directly.
  Authors the new docs and the executable issue backlog; never executes.
---

# Requirements transition — authoring (Stint)

Turn a signed-off requirement-change synthesis into everything execution
needs: new spec docs coexisting with the old, mockups, and a decomposed,
sequenced backlog of member issues the ordinary orchestrator
(`process-triaged-issues`) runs. **This skill authors and stops.** Execution
is not a second skill — it is the orchestrator over the backlog this skill
files, launched by the owner.

**When it applies:** the change's intermediate states would make the spec lie
(renumbered sections, a canonical term changed everywhere, docs split or
merged), or the old→new map is itself an artifact the owner must review.
Anything smaller is an in-place section edit and rides the triaged backlog
directly (`context/process.html` §06) — do not reach for this machinery.

Read first: `CLAUDE.md`; `context/process.html` §03 (this skill's contract),
§04 (authoring rules), §06 (the backlog this feeds), §07 (branch/PR/merge
semantics); the current docs the change touches; the mockups.

## Step 1 — The synthesis is the input

The design decisions arrive settled, or get settled here:

- **From the triaged backlog:** the orchestrator's batched interview already
  grilled the design and the owner signed off the synthesis. Consume it
  verbatim; do not re-ask settled decisions.
- **Invoked directly by the owner:** run the grill first (`grill-me` stance —
  one cluster at a time, recommended answer each, codebase consulted for
  anything code can answer). Probe per change: new/modified/deleted
  classification, CLI↔GUI parity (waived only explicitly), schema impact,
  data-integrity and data-loss consequences, mockup homes, AC methods. End
  with a written synthesis — global decisions plus the classification — and
  get explicit sign-off.

No authoring before a signed-off synthesis exists.

## Step 2 — Author the coexisting docs

On a fresh **transition branch** off `main` (this branch is the shared base
for the whole transition):

1. Rename every requirement doc the change touches to `*-old.html`
   (e.g. `context/prd.html` → `context/prd-old.html`). Old and new coexist
   until the swap; rename only docs that actually change.
2. Author the new docs in house style (§04), reflecting every signed-off
   decision: `prd.html` (with `core` badges per Step 3), `concept.html`,
   `glossary.html` (one term per concept, rejected synonyms),
   `acceptance.html` (AC routing for every new/changed requirement), and
   `architecture.html` — the consolidated runtime rendering is in this
   rewrite fan-out deliberately (process.html §06); leaving it out is how it
   drifts.
3. Author or update mockups. **Hard rule: every NEW or MODIFIED GUI
   requirement appears in at least one mockup.** Run the coverage check —
   every gui-surface NEW/MODIFIED requirement names an existing mockup file —
   and report the result.

## Step 3 — Core labeling

**A requirement is `core` iff it (a) ensures data integrity — atomicity,
invariants, immutability of stored truth; (b) protects against data loss —
crash-safety, durability, backups, the export escape hatch,
destructive-action confirmation; or (c) enables core data entry — creating
entries, starting/stopping timers, manual backfill.**

Apply it: relabel existing requirements that meet the definition; badge new
ones; **author new core requirements where the change opens an
integrity/loss gap the synthesis didn't list**; record explicit exclusions
with reasons where a plausibly-core requirement is ruled not core.

## Step 4 — File the backlog

Decompose the change into **member issues, born `Triaged: ready for execution`**, as sub-issues
of one parent labeled `[META] Orchestration` and titled
`[META] Orchestration: <transition name>` — the same handoff mechanism
every orchestrator batch uses (process.html §06).

- **The parent** carries what runs *between* members: the base branch name,
  sequencing and dependency, file-collision warnings, and the launch
  instruction. It is the prompt the orchestrator runs from.
- **Each member issue** is a triage-contract-complete unit: the requirement
  ids it lands, change class (`NEW`/`MODIFIED`/`DELETED`), core flag,
  surfaces (`core`/`cli`/`gui`), the exact files, the mockup(s), the AC
  method(s) (`BDD`/`PROP`/`GOLD`/`JUDGE`/`MANUAL`), and a recording flag
  where GUI evidence is owed. Decisions settled, plan named — a member issue
  never needs a second interview.
- **The standard tail** — every transition's backlog ends with these member
  issues, sequenced after the implementation members:
  1. **AC/evidence sweep** — regenerate all evidence serialized (`npm run
     build`, `npm test`, `npm run verify:no-network`, `npm run judge`,
     `npm run evidence`); every requirement covered by a passing, executable
     AC of its mapped method; no stubs, no skips.
  2. **The two reviews** — an adversarial AC-evidence-sufficiency review
     (defaults to *insufficient*) and a code-quality & architecture review;
     findings feed a bounded improvement loop (2–3 rounds), skips justified.
  3. **Recordings** — captured LAST so they show the shipped UI; scope is
     every core GUI member plus flagged rows; authored per
     `author-qa-gif`, uploaded to the evidence bucket, index updated.
  4. **Swap + integration PR** — delete the `*-old.html` docs and files
     retired by DELETED members; ensure `README.md`, `CLAUDE.md`,
     `COVERAGE.md`, and the parity matrix reference only the new state (no
     change narrative — timeless docs); open the single integration PR from
     the transition branch to `main` and close the parent.

A transition needing a stage this tail lacks extends this skill — never a
per-change fork.

## Step 5 — Stop at the launch

Push the transition branch (docs + mockups authored, backlog filed), then
report to the owner: the branch, the parent issue, the member count and
sequencing, the mockup-coverage result, and the core-labeling summary.

**Do not launch the orchestrator.** The launch is the owner's: they point
`process-triaged-issues` at the parent. Execution semantics from there
(process.html §07): member branches and PRs target the transition branch;
the session merges member PRs on green; the human gates are the launch and
the integration PR to `main`.

## Definition-of-done checklist

- [ ] Signed-off synthesis in hand (consumed from the orchestrator, or
      grilled and signed off here); no settled decision re-asked.
- [ ] Touched docs renamed `*-old.html`; new docs authored in house style on
      a transition branch off `main`.
- [ ] Mockup-coverage hard rule checked and reported.
- [ ] Core definition applied: relabels, new-gap core requirements,
      recorded exclusions.
- [ ] Backlog filed: `[META] Orchestration` parent naming the base branch
      and sequencing; member sub-issues born `Triaged: ready for execution`, each
      contract-complete; standard tail present and sequenced last.
- [ ] Branch pushed; owner handed the parent issue and launch instructions;
      orchestrator NOT launched.
