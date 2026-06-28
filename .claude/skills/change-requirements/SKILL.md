---
name: change-requirements
description: >-
  Drive a controlled requirements change for Stint. Use whenever the user wants
  to change, add, modify, or remove product requirements — new features, dropped
  features, schema/data-model changes, CLI/GUI behavior, packaging, anything that
  alters context/prd.html / context/concept.html / context/glossary.html / context/acceptance.html. The user
  LISTS the changes they want; this skill grills the design, then authors the
  full transition artifact set (renamed *-old.html docs, new docs, a
  requirements-transition.md work-list, mockups, and the transition workflow) and
  STOPS. It authors but does not run the workflow.
---

# Change requirements (Stint)

Turn a user's list of desired requirement changes into a complete, reviewable
**requirements transition**: grilled design decisions, rewritten requirement
docs, a work-list mapping doc, mockups covering every new/changed GUI
requirement, and a transition workflow ready for the user to launch.

**Scope of this skill: author, don't run.** You conduct the interview and author
every artifact below, then hand the run to the user. You do **not** execute the
transition workflow, write code, or modify `packages/`. The workflow you author
is what later does that work.

Read first for house style and the target shape:
- `CLAUDE.md` — repo doc map and conventions.
- An existing `requirements-transition.md` if one is present (study its shape:
  §0 consumption legend, §1 global decisions, §C core labeling, §2
  section-by-section new/modified/deleted tables, §19/§20 new sections, §W
  screen-recording scope, §R two reviews, §Z swap/cleanup). Your job is to
  reliably produce a doc of this shape plus the new docs and mockups.
- `.claude/workflows/requirements-transition.js` — the existing transition
  workflow; mirror its `meta`/phases/schema style when re-authoring it.

---

## Step 0 — Intake

1. Capture the user's raw list of requested changes verbatim. Do not start
   editing anything.
2. Skim the current docs that the changes touch (`context/prd.html`, `context/concept.html`,
   `context/glossary.html`, `context/acceptance.html`) and the mockups in `context/mockups/` so your
   questions are grounded in what exists. **Consult the codebase directly for
   anything code can answer** (current schema, current CLI surface, current GUI
   views) instead of asking the user.
3. Announce the plan in one line: "I'll grill the design, then author the
   transition docs, mockups, and workflow, and hand it to you to run."

---

## Step 1 — Grill interview (Matt Pocock methodology)

Drive to shared understanding before writing anything. Grilling rules — follow
all of them:

- **One tight cluster at a time.** Ask a single focused cluster of related
  questions, then **stop and wait** for answers before descending to the next
  layer. Never dump a long flat questionnaire.
- **Always offer a recommended answer.** Every question carries your
  recommendation and a one-line rationale, so the user can confirm fast or
  redirect. "I'd recommend X because Y — agree, or do you want Z?"
- **Consult the codebase, don't ask what code can answer.** Read the schema, the
  CLI command table, the renderer, the mockups. Only ask the user for product
  intent and decisions code can't reveal.
- **Descend the design tree.** Start at intent ("what is this change for?"),
  descend into behavior, surfaces, data model, and edge cases. Keep descending a
  branch until it bottoms out in a concrete decision, then move to the next.
- **Probe these dimensions for every change** (these become the work-list
  columns):
  - **New vs modified vs deleted** — classify each requirement precisely. A
    "change" often splits into several requirements of different kinds.
  - **Cross-surface parity (CLI ↔ GUI).** Every new entity/behavior must be
    reachable from both `tt` and the GUI unless the user explicitly waives it.
    Ask the parity question explicitly for each new entity.
  - **Data-model / schema impact.** New tables, columns, indexes, migrations?
    Name them.
  - **Data integrity / data-loss / core-data-entry impact** — probe this
    explicitly and hard (see Step 3). This is where **core requirements** get
    discovered. Ask: can this change drop, corrupt, or fail to persist user
    data? Does it touch creating entries / starting / stopping / manual
    backfill? Are there new integrity or durability requirements the user didn't
    list but should exist?
- **End with a written synthesis the user signs off on.** Produce the **Global
  decisions** table (G1, G2, …) — one row per resolved decision — and the
  draft new/modified/deleted classification. Present it and get an explicit
  "yes, proceed" before authoring. This synthesis becomes §1 of the
  transition doc.

Do not advance to Step 2 until the user has signed off on the synthesis.

---

## Step 2 — Author the transition artifacts

Once the synthesis is signed off, author all of the following. Do not run any
workflow; do not touch `packages/`.

### 2a. Rename affected legacy docs

For every requirement doc the change touches, rename it to `*-old.html` (e.g.
`context/prd.html` → `context/prd-old.html`). The old and new docs **coexist** until the
workflow's swap stage. Only rename docs that actually change.

### 2b. Author the new docs

Author the new `context/prd.html` / `context/concept.html` / `context/glossary.html` / `context/acceptance.html`
in the legacy house style, reflecting every signed-off decision:

- `context/prd.html` — full requirements including new sections and the `core` badges
  (Step 3). Renumber within each section as needed; the transition doc's
  **Change** column stays authoritative for intent.
- `context/concept.html` — the why, updated for dropped/added framing.
- `context/glossary.html` — canonical terms for any new concept (one term per concept,
  list rejected synonyms).
- `context/acceptance.html` — the AC strategy and PRD-to-method coverage map, updated for
  the new/changed requirements.

### 2c. Author `requirements-transition.md` (the work-list)

This is the single source of truth the workflow consumes. Mirror the reference
shape exactly:

- **§0 How the workflow consumes this file** — the column legend: ID, Change
  (`NEW`/`MODIFIED`/`DELETED`), Core (`●`), Surfaces (`core`/`cli`/`gui`),
  Files, Mockup, AC (`BDD`/`PROP`/`GOLD`/`JUDGE`/`MANUAL`), Rec (`▶`).
- **§1 Global decisions** — the grill-outcome table (G1, G2, …) from Step 1.
- **§C Core requirement classification** — the definition (Step 3), the list of
  existing requirements relabeled `core`, and a pointer to new core reqs.
- **§2 Section-by-section changes** — one table per affected PRD section. Every
  requirement row tags: Change, Core flag, Surfaces, a Summary, the affected
  **Files**, target **Mockup(s)**, **AC method(s)**, and **Rec** flag.
- **New sections** (e.g. §19 packaging, §20 durability) for net-new requirement
  clusters.
- **§W Screen-recording QA evidence** — scope of the recording stage (Step 4).
- **§R Review stages** — the two reviews (Step 4).
- **§Z Swap / cleanup** — the completion swap list (Step 4 + the cleanup
  checklist below).

Every requirement gets: a stable ID, exactly one Change tag, a Core flag where
it applies, its surfaces, its files, its mockup(s), and its AC method(s).

### 2d. Author / update mockups — coverage is a HARD RULE

> **Mockup-coverage rule: every NEW or MODIFIED GUI requirement must be
> represented in at least one mockup.** No exceptions.

- Create or update standalone, dependency-free HTML mockups in `context/mockups/` for
  every new/changed GUI requirement.
- Each such requirement's **Mockup** column in the work-list must name ≥1
  existing mockup file.
- **Run the coverage check before finishing:** iterate every row whose Surfaces
  include `gui` and whose Change is `NEW` or `MODIFIED`, and confirm its Mockup
  column is non-empty and the named file exists. If any row fails, author the
  missing mockup (or extend an existing one) and re-check. Report the check
  result in your final summary.

---

## Step 3 — Core labeling

Apply the **core-requirement definition** and badge accordingly.

**A requirement is `core` iff it does one of:**
- **(a) ensures data integrity** — atomicity, invariants, immutability of stored
  truth;
- **(b) protects against data loss** — crash-safety, durability, backups, the
  export escape hatch, destructive-action confirmation;
- **(c) enables core data entry** — creating entries, starting timers, stopping
  timers, manual backfill.

Apply it like this:

1. **Relabel existing requirements** that meet the definition with a `core`
   badge in the new `context/prd.html` (badge only, no behavior change) and list them in
   §C of the work-list.
2. **Add `core` badges** to new requirements that meet the definition.
3. **Fill integrity/loss gaps.** Where the change opens a data-integrity or
   data-loss gap that the user didn't list, **author new core requirements** to
   close it (e.g. DB-open invariants, integrity check on open, automatic
   backups + retention, corruption recovery, monotonic-time guard, durable
   app-state). Put net-new core reqs in their own section.
4. **Record exclusions.** If a plausibly-core requirement is ruled *not* core,
   say so explicitly with the reason (accuracy/privacy/consistency are not
   integrity-or-loss).

Core GUI requirements and all changed/new GUI requirements get a screen
recording in QA evidence (Step 4 §W).

---

## Step 4 — Author the transition workflow

Author `.claude/workflows/requirements-transition.js` (mirror the `meta` +
phases + JSON-schema style of the existing `requirements-transition.js` if one
is present). **Author it; do not run
it.** The workflow consumes `requirements-transition.md` and carries out all
pending work. It must encode these stages in order:

1. **Plan** — parse the work-list into a per-requirement plan; one agent per
   requirement returns its exact file set + implementation/AC/evidence plan.
2. **Implement in file-disjoint waves** — schedule requirements into waves so no
   two agents in a wave touch the same file; verify each wave green before the
   next.
3. **AC verification** — regenerate all evidence (`npm run build`, `npm test`,
   `npm run judge`, `npm run evidence`, `npm run verify:no-network`); each
   requirement must have a passing executable AC of its mapped method(s).
4. **Two separate reviews**, each looping back into an improvement pass:
   - **AC-evidence-sufficiency review** — an adversarial completeness critic per
     requirement; defaults to *insufficient* unless the requirement is
     implemented **and** covered by a passing AC **and** reflected in regenerated
     evidence (no stubs/skips).
   - **Code-quality & architecture review** — in the Matt Pocock
     *improve-codebase-architecture* lineage: hunt shallow modules, leaky seams,
     poor locality, cognitive bounce; apply the deletion test; rate findings
     `Strong` / `Worth exploring` / `Speculative` with a top recommendation.
     Must not regress AC.
5. **Improvement loop** — apply review feedback; re-verify until both reviews are
   clean and AC stays green.
6. **Screen-recording QA stage — runs LAST**, after AC and both reviews. This is
   **QA evidence, not executable AC.** Scope:
   - all **core-flow GUI requirements** (GUI requirements marked `core`);
   - all **changed/new GUI requirements** (every `Rec ▶` row);
   - all **code-change-adjacent requirements** demonstrable in the GUI.
   Recordings land under `acceptance/evidence/recordings/`, indexed by
   requirement id. **Deliver them as committed, inline-embedded GIFs** — this is
   the only format that renders inline in a PR description without a manual
   web upload (GitHub's CSP blocks inline `<video>` from repo/raw URLs; native
   video controls would require drag-dropping the file into the web editor).
   Recording production conventions (the workflow's Recordings stage carries the
   exact ffmpeg/Playwright recipe):
   - **GIF, ASCII-only filenames** slugged from the requirement id
     (`§12 R15` → `12-r15.gif`) — non-ASCII/spaced names render unreliably.
   - **Slowed to ~0.5× with a ~1.5 s hold on the final frame** so fast actions
     are followable and each loop has a clear settle/restart beat.
   - **Make the interaction visible** (inject a synthetic cursor + click pulse,
     highlight the target element) so clicks are not invisible.
   - **Commit** the GIFs (do NOT git-ignore them) and **embed each inline** in
     the PR body as an image — `![<req id> — <caption>](<raw-url-at-commit-sha>)`
     — pinned to the commit SHA, **each with a one-line description of what the
     GIF shows**.
7. **Evidence aggregation → one GitHub PR** — collect AC evidence, both review
   reports, and the recordings into a single PR.
8. **Auto-swap, gated on all-green** — only when every requirement has passing AC
   evidence **and** both reviews are clean, perform the old→new swap inside the
   same PR (see cleanup list below). The **human gate is the PR merge.**

### Swap / cleanup list (the workflow's final stage, gated on all-green)

- Delete the `*-old.html` files (`context/prd-old.html`, `context/concept-old.html`,
  `context/glossary-old.html`, `context/acceptance-old.html` — whichever were created).
- Delete any GUI files folded into another view (e.g. a retired standalone page
  + its script), per the work-list's DELETED rows.
- Delete superseded prior-art workflows referenced in the work-list.
- Delete **`requirements-transition.md`** itself (the mapping doc is consumed).
- Ensure `README.md`, `CLAUDE.md`, `acceptance/criteria/COVERAGE.md`, and
  `acceptance/criteria/parity-matrix.json` reference only the new docs and entities.

---

## Step 5 — Stop and hand off

You have authored everything; **do not run the workflow.** Report to the user:

1. What was authored: renamed old docs, new docs, `requirements-transition.md`,
   new/updated mockups, and `.claude/workflows/requirements-transition.js`.
2. The **mockup-coverage check** result (every NEW/MODIFIED GUI requirement maps
   to ≥1 mockup).
3. The core-requirement labeling summary (relabeled + net-new core reqs).
4. **How to launch it themselves**, e.g.: "When you're ready, use a workflow to
   run `requirements-transition` — it will plan, implement in disjoint waves,
   verify AC, run the two reviews, capture screen recordings, open one PR, and
   swap old→new on green. The merge is your gate."

Then stop.

---

## Definition-of-done checklist

- [ ] Grill interview held one cluster at a time, each question with a
      recommendation; codebase consulted for code-answerable facts.
- [ ] Written synthesis (global decisions + new/modified/deleted) signed off by
      the user before any authoring.
- [ ] Affected legacy docs renamed to `*-old.html`; new docs authored in house
      style.
- [ ] `requirements-transition.md` authored with all columns (ID, Change, Core,
      Surfaces, Files, Mockup, AC, Rec) and §0/§1/§C/§2/new-sections/§W/§R/§Z.
- [ ] Cross-surface parity decided per new entity; data-model/schema impact
      named.
- [ ] Core definition applied: existing reqs relabeled, new core reqs added for
      integrity/loss gaps, exclusions recorded.
- [ ] **Mockup-coverage rule satisfied** — every NEW/MODIFIED GUI requirement
      maps to ≥1 mockup; coverage check run and reported.
- [ ] `requirements-transition.js` workflow authored (file-disjoint waves, AC
      verification, two reviews, improvement loop, screen-recording stage LAST,
      evidence→one PR, gated auto-swap) — **authored, not run.**
- [ ] Handed off to the user with launch instructions; workflow NOT run.
