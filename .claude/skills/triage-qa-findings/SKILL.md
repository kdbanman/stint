---
name: triage-qa-findings
description: >-
  Use when issues found by agentic QA (e.g. labeled "Agentic QA
  Discovery") need triaging — categorizing each against the spec as a
  violated requirement, a missing one, or a plain bug, then annotating
  and labeling it. Categorizes and routes; does not fix.
---

# Triage QA findings (Stint)

Take a batch of issues found by agentic QA — the intuitive-user GUI sweep and
the bugs it files — and turn each into a **triaged, categorized, fix-ready**
issue: classified against the spec, annotated with where a guard must go so it
can't regress, and labeled. This skill **categorizes and routes; it does not
fix.** No `packages/` edits, no requirement docs rewritten — it produces the
per-issue comment and the labels, then hands each issue to the right downstream
path.

## Where this fits

Agentic QA discovers bugs; this triages them; the category routes each one
(`context/process.html` §03):

- **`needs new requirement or AC`** → the `change-requirements` skill (author the
  spec change) → `requirements-transition` (execute it).
- **`has requirement or AC already`** / **`no requirement needed`** → an ordinary
  issue-anchored bugfix PR (§07). For the `has` case the fix also **strengthens
  the guard that should have caught it** — the regression slipped a real gate.

Read first for the vocabulary you classify with:

- `CLAUDE.md` — the doc map.
- `context/process.html` §06 (QA discovery — where this skill sits), §04
  (authoring rules the comment must follow), §05 (the automatic/manual boundary
  — which AC method a
  new guard belongs to).
- `context/acceptance.html` + `acceptance/criteria/COVERAGE.md` — the five AC
  methods (BDD · PROP · GOLD · JUDGE · MANUAL) and the PRD-to-method map. This is
  the language for "where a guard goes."
- `context/prd.html` — the requirements and the §17 acceptance criteria you
  classify against; `features/*.feature` and `acceptance/criteria/` for what is
  already proven.

## The three categories

Classify each issue into **one or more**:

- **`has requirement or AC already`** — a requirement or AC already governs the
  behavior; the code just violates it. Fix is surgical, no doc change. The
  regression-prevention work is usually **strengthening an existing-but-too-weak
  guard**.
- **`needs new requirement or AC`** — no requirement currently specifies the
  behavior, but one should. Feeds `change-requirements`.
- **`no requirement needed`** — a plain bug with no doc consequence: a surgical
  fix, nothing to specify.

An issue can span categories — a two-part finding often does. Apply **every**
category label that genuinely applies; GitHub issues carry multiple labels, and
the category belongs to the finding, not to the whole issue.

## Step 1 — Gather

Find the issues to triage — default the open issues labeled `Agentic QA
Discovery`, or whatever set the user names. Read each in full: the reported
behavior, the root-cause note, the evidence.

## Step 2 — Classify against the spec (one subagent per issue)

Classification is a research question: **does a requirement or AC already cover
this behavior?** Fan out — one subagent per issue — each tasked to search
`context/prd.html` (incl. §17 ACs), `features/*.feature`, `acceptance/criteria/`,
and the mockups, and report with **exact quotes and section refs**:

- whether a requirement covers the behavior;
- whether an AC / `.feature` scenario covers it, and **on which surface** — many
  BDD suites run over `@stint/core` and `tt` only, never the renderer DOM, so a
  GUI bug passes them cleanly;
- a recommended category with reasoning.

Model level: a misclassification misroutes the whole issue, and no gate catches
it — run these research subagents at the strongest level (the §03 gate
question).

## Step 3 — Decide, and ask when it's genuinely a product call

Make the final call per issue from the research. Two situations need the
**user**, not a guess:

- **Ambiguous between categories** — an adjacent principle exists but doesn't
  quite reach the behavior (`has` vs `needs`), or the finding straddles two.
- **The correct behavior is itself unspecified** — if fixing the bug means
  *deciding what the app should do*, that is a product decision. Ask; the answer
  usually settles the category (a decision to *change* behavior means `needs new
  requirement or AC`).

Put these as tight, recommended-answer questions in one batch. Don't launder a
real ambiguity into a confident label.

## Step 4 — Locate the regression guard (the substantive work)

For each issue, work out **where** to add coverage so the bug can't return,
grounded in the real harness — never a generic "add a test." The recurring
lesson from the GUI sweep: these are renderer-behavior bugs the suite
structurally can't see — BDD/PROP run over core+tt with no DOM,
`packages/gui/test/renderer-static.test.ts` holds only static-only contracts
(banned APIs/glyphs, isolation, unique ids — issue #85), and the
JUDGE recipes that *do* drive the real renderer often assert control-level facts
or use fixtures too small to tell "filtered" from "show-all." Name the specific
layer:

- **Requirement / mockup** — only for `needs new requirement or AC`: which
  `context/prd.html` §/R to add or change, and (the `change-requirements`
  hard rule) which mockup in `context/mockups/` must depict it.
- **Executable AC** — which of the five methods, and which file:
  - GUI drive-to-outcome behavior → a **JUDGE** machine-scored recipe
    (`packages/gui/judge/record.mjs` + `run-judge.mjs`, rubric
    `acceptance/criteria/judge-rubric.md`) over a **realistic fixture**. This is
    the home for most agentic-QA GUI findings — the JUDGE harness drives the
    actual renderer over a real store.
  - core contract / invariant → **BDD** (`features/*.feature`, runs core+tt),
    **PROP**, or **GOLD**.
  - a static-only contract (banned API/glyph, isolation, structural invariant —
    something a driven page cannot see) → `renderer-static.test.ts`; renderer
    *behavior* never lands there (issue #85) — it gets a JUDGE scene.

Point at the actual file and state what the new guard asserts. Where an existing
guard *should* have caught it, say why it didn't and how to harden it — usually
a realistic fixture plus an **outcome** assertion in place of a control-level
one.

## Step 5 — Annotate and label

Per issue:

1. **Post one comment** (house style, §04): the category (with the
   requirement/AC refs that justify it), one line on why it slipped the suite,
   and the Step-4 regression-prevention plan pointing at real files.
2. **Apply labels:** every category that applies **plus** the routing label:
   `Triaged` when the fix is sized for one issue-anchored PR, or
   `Triaged: dedicated session` when the routing verdict sends it to
   `change-requirements` or a dedicated session instead — only plain `Triaged`
   feeds `process-triaged-issues`, and either label records that triage is
   complete. Preserve the issue's existing labels — a label-set update
   replaces the whole set, so include the originals (e.g.
   `Agentic QA Discovery`) in the call.

Be frugal elsewhere: one comment per issue, no thread noise.

## Step 6 — Report and route

Summarize for the user: the issue → category table, any product decisions they
made, and the routing — which issues go to `change-requirements`, which to a
bugfix PR. **Do not open PRs or fix code.** Triage ends at annotated, labeled
issues.

## Definition-of-done checklist

- [ ] Every target issue read in full.
- [ ] Classification researched against the spec per issue (requirement + AC,
      with surface), one subagent each at the strongest model level.
- [ ] Genuine ambiguities and product-behavior calls put to the user, not
      guessed.
- [ ] Each issue placed in ≥1 category; multi-category findings carry a label
      for each.
- [ ] Regression guard located per issue at a real file in the right AC method;
      weak-but-existing guards diagnosed, not just re-flagged.
- [ ] One comment per issue in house style; the routing label (`Triaged` or
      `Triaged: dedicated session`) + category labels applied; original labels
      preserved.
- [ ] Final report routes each issue downstream; no code touched, no PR opened.
