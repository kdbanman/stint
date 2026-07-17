---
name: change-requirements
description: >-
  Use when the user wants to add, change, or remove Stint product
  requirements — anything that alters the context/ spec docs (prd, concept,
  glossary, acceptance). Designs the change; does not execute it.
---

# Change requirements (Stint)

Turn a user's list of desired requirement changes into a complete, reviewable
**requirements transition**: grilled design decisions, rewritten requirement
docs, a work-list mapping doc, and mockups covering every new/changed GUI
requirement — ready for the user to launch the `requirements-transition`
skill against.

**Scope of this skill: author, don't run.** You conduct the interview and author
every artifact below, then hand the run to the user. You do **not** execute the
transition, write code, or modify `packages/`. The `requirements-transition`
skill is what later does that work, consuming the work-list you author here.

Read first for house style and the target shape:
- `CLAUDE.md` — repo doc map and conventions.
- `context/process.html` §04 — the authoring rules every doc you write here
  must follow (concise over grammatical, common language, no editorializing,
  stateless, one home per fact).
- An existing `requirements-transition.md` if one is present (study its shape:
  §0 consumption legend, §1 global decisions, §C core labeling, §2
  section-by-section new/modified/deleted tables, §19/§20 new sections, §W
  screen-recording scope, §R two reviews, §Z swap/cleanup). Your job is to
  reliably produce a doc of this shape plus the new docs and mockups.
- `.claude/skills/requirements-transition/SKILL.md` — the standing execution
  skill. The work-list you author is its input; keep the columns and section
  structure exactly what its stages consume.

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
in the house style (per the `context/process.html` §04 authoring rules),
reflecting every signed-off decision:

- `context/prd.html` — full requirements including new sections and the `core` badges
  (Step 3). Renumber within each section as needed; the transition doc's
  **Change** column stays authoritative for intent.
- `context/concept.html` — the why, updated for dropped/added framing.
- `context/glossary.html` — canonical terms for any new concept (one term per concept,
  list rejected synonyms).
- `context/acceptance.html` — the AC strategy and PRD-to-method coverage map, updated for
  the new/changed requirements.

### 2c. Author `requirements-transition.md` (the work-list)

This is the single source of truth the `requirements-transition` skill
consumes. Mirror the reference shape exactly:

- **§0 How the transition consumes this file** — the column legend: ID, Change
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
- **§W Screen-recording QA evidence** — scope of the transition skill's
  recording stage.
- **§R Review stages** — the two reviews the transition skill runs.
- **§Z Swap / cleanup** — the completion swap list the transition skill's
  gated final stage deletes and updates.

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
recording in QA evidence (work-list §W, captured by the transition skill's
recording stage).

---

## Step 4 — Reconcile with the transition skill

Execution is **not** authored per change. The standing
`requirements-transition` skill
(`.claude/skills/requirements-transition/SKILL.md`) carries the stages — plan
→ file-disjoint waves with checkpoint commits → AC verification → the two
reviews with a bounded improvement loop → screen-recording QA LAST → one PR →
the gated old→new swap — plus the subagent model-level rubric. Your job here
is to make sure your work-list feeds it:

1. **Re-read the transition skill** and confirm every stage can consume what
   you authored: the §0 legend matches the columns its Plan/Implement stages
   read; §W's scope (core `●` GUI rows ∪ Rec `▶` rows) is derivable from your
   tables; §R names the two reviews; §Z lists everything the swap must delete
   (the `*-old.html` docs, retired files per DELETED rows, and
   `requirements-transition.md` itself).
2. **If the change genuinely needs a stage or convention the skill lacks**
   (a new evidence kind, a new artifact class), extend the skill itself as a
   durable improvement to the standing procedure — never fork a per-change
   variant. Per-change orchestration is scaffolding, and the process forbids
   it (`context/process.html`).

---

## Step 5 — Stop and hand off

You have authored everything; **do not run the transition.** Report to the
user:

1. What was authored: renamed old docs, new docs, `requirements-transition.md`,
   and new/updated mockups (plus any durable extension made to the
   `requirements-transition` skill).
2. The **mockup-coverage check** result (every NEW/MODIFIED GUI requirement maps
   to ≥1 mockup).
3. The core-requirement labeling summary (relabeled + net-new core reqs).
4. **How to launch it themselves**, e.g.: "When you're ready, invoke the
   `requirements-transition` skill — it will plan, implement in disjoint
   waves, verify AC, run the two reviews, capture screen recordings, open one
   PR, and swap old→new on green. The merge is your gate."

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
- [ ] Work-list reconciled against the `requirements-transition` skill's
      stages (§0 legend, §W scope, §R reviews, §Z swap list); any needed
      extension made to the skill itself, never a per-change fork.
- [ ] Handed off to the user with launch instructions; transition NOT run.
