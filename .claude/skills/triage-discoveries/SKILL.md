---
name: triage-discoveries
description: >-
  Use when discovery findings (issues labeled "Agentic Discovery" — from
  qa-audit, arch-audit, design-audit, code-quality-audit, or sync-audit)
  need triage into the Triaged backlog. Decides and routes; does not fix.
---

# Triage discoveries (Stint)

The gate between a filed finding and workable backlog (`context/process.html`
§06). Take each finding an audit filed and turn it into a **work-ready** issue:
categorized against the doc that owns it, fix direction decided with the owner,
proof of fix named at a real file, sized, labeled, routed.

One gate, five intakes. The five discovery instruments differ in what they look
at and where a fix's proof lives; the triage procedure over their findings is
one procedure, and it lives here once. What varies per instrument lives in
`references/` — nothing procedural does.

This skill **decides and routes; it does not fix.** No `packages/` edits, no
docs rewritten — it produces the per-issue comment and labels, then hands each
issue to the right downstream path. Its most important output is the routing
verdict: which issues `process-triaged-issues` should *not* get.

## The asymmetry that shapes this skill

**The audit's grilling confirmed the problem; `Triaged` promises a plan.**

Findings arrive unusually triage-ready — evidence with file:line, stakes,
severity, confidence, sometimes fix constraints already in the body — because
every audit's filing phase is problem capture only, deliberately deciding
nothing about the fix. This skill supplies that missing half. Do not
re-litigate the problem: the grilling settled that it is one.

## Intake

Default: open issues labeled `Agentic Discovery` carrying neither `Triaged` nor
`Triaged: dedicated session`, or the set the user names. Each also carries one
provenance label naming the instrument that filed it:

| Provenance label | Instrument | Reference |
|---|---|---|
| `Agentic QA Audit` | `qa-audit` | `references/qa.md` |
| `Agentic Arch Audit` | `arch-audit` | `references/arch.md` |
| `Agentic Design Audit` | `design-audit` | `references/design.md` |
| `Agentic Code Quality Audit` | `code-quality-audit` | `references/code-quality.md` |
| `Agentic Sync Audit` | `sync-audit` | `references/sync.md` |

**Prefer one discovery type per batch** — one audit run's output, one triage
pass — so the operator holds one owning doc's vocabulary, one set of guard
homes, and one finding shape at a time. Load that type's reference file and
work from it. When a cluster genuinely spans types (a layout defect filed by
both `qa-audit` and `design-audit`), load every reference the cluster touches
and triage it as one cluster rather than splitting it across passes.

Batching by type scopes *which issues are in the batch* — it does not split the
interview. Fix-direction questions are always batched across the whole batch
into one grill (Step 3), whatever types it spans.

**Provenance is optional; `Agentic Discovery` is the contract.** A finding
filed outside any audit — noticed in a working session, raised in a PR review,
observed by the owner — carries the family label alone. It is a first-class
finding and triages identically; it simply implies no reference file. Pick the
reference(s) that fit what the finding is *about* (the guard homes are keyed to
subject matter, not to the instrument that filed it), or work from the spine
alone when none fits. A bare family label means "no instrument filed this,"
which is accurate provenance — not a missing label to be repaired.

Read first for the vocabulary you decide with:

- `CLAUDE.md` — the doc map.
- `context/process.html` §03 (gate question, skills), §06 (discovery — where
  this skill sits), §04 (authoring rules the comment must follow), §02 (the
  principles — many findings are violations of these).
- `context/acceptance.html` + `acceptance/criteria/COVERAGE.md` — the five AC
  methods (BDD · PROP · GOLD · JUDGE · MANUAL) and the PRD-to-method map. This
  is the language for "where a guard goes."
- The batch's reference file(s), per the table above.

## The four decisions per issue

Triage records four things per issue, in one comment.

### 1 — Category

Classify against **whichever doc owns the behavior** — the reference file names
it. Apply **every** category that genuinely applies; a two-part finding often
spans two, and the category belongs to the finding, not to the whole issue.

- **`has requirement or AC already`** — a requirement, rule, or principle
  already governs it and reality violates it. Fix is surgical, no doc change.
  The regression-prevention work is usually **strengthening an existing-but-too-
  weak guard** — it let this through.
- **`needs new requirement or AC`** — the behavior should be specified but
  isn't. Includes recording an accepted decision whose rationale exists
  nowhere. Feeds `change-requirements`.
- **`no requirement needed`** — plain code or apparatus work with no doc
  consequence.

Where spec and reality disagree (the doc claims a check that doesn't exist),
the owner decides **which side moves** — build the check or retract the claim —
and the category follows the decision.

### 2 — Fix direction

The owner's call on *what kind* of fix, not its design: confirm-vs-refuse,
bind-vs-retract, which alerting channel, which of the alternatives the issue
left open. The grilling confirmed the problem exists; this decides what "fixed"
means.

Two situations need the **owner**, not a guess: a finding ambiguous between
categories (an adjacent principle exists but doesn't quite reach the behavior),
and a finding whose correct behavior is itself unspecified — if fixing it means
*deciding what the app should do*, that is a product decision. Don't launder a
real ambiguity into a confident label.

### 3 — Proof of fix

Name what will show the problem gone and staying gone, **at a real file**.
Never a generic "add a test." The reference file names the guard homes for the
batch's instrument and the traps that make the obvious home the wrong one.

Where an existing guard *should* have caught it, say why it didn't and how to
harden it — a weak guard diagnosed is worth more than a weak guard re-flagged.

### 4 — Routing verdict

The sizing call:

- **Orchestrator-sized** → label `Triaged` (+ category labels): fits one
  issue-anchored PR, reviewable, and a deterministic gate can catch a subtle
  implementation failure.
- **Dedicated session** → label `Triaged: dedicated session` (+ category
  labels), never plain `Triaged`: multi-PR restructures, tooling decisions,
  process design with no code surface, spec-scale change. Name the route in the
  comment (the `change-requirements` → `requirements-transition` pair for
  spec-scale change, a dedicated working session otherwise). The label records
  that triage is complete — without it a routed issue is indistinguishable from
  an un-triaged one — while only plain `Triaged` feeds
  `process-triaged-issues`.

An issue whose triage is *suspended* rather than completed (the owner withdraws
the fix direction pending more thought) gets neither label: it is not yet
routed, and its pending state must stay visible. Track the open question
somewhere real (a todo issue) and say so in the comment.

## The self-reference flag

Mark any issue whose fix **modifies a deterministic gate** — the judge, CI
wiring, check scripts, test harnesses. For these the §03 gate question fails:
the gate being modified cannot gate its own modification, so a delegated
subagent can green itself. The flag tells `process-triaged-issues` to review
that unit's gate-diff in-session (or keep the unit in-session entirely).

It applies to any instrument's findings, not just apparatus-shaped ones — a
product bugfix whose regression guard changes the judge harness is
self-referential too. A gate-modifying issue can still be orchestrator-sized;
it just can't be fire-and-forget.

## Steps

1. **Gather.** Collect the batch per *Intake*. Read each issue in full — body,
   evidence, recorded fix constraints. Load the reference file(s) the batch's
   provenance labels name.
2. **Research where needed.** Classification is a research question: *does a
   requirement, rule, or AC already cover this?* Where the issue doesn't carry
   the answer, fan out one subagent per issue to search the owning doc, the
   `.feature` files, `acceptance/criteria/`, and the mockups, reporting with
   **exact quotes and section refs** — including **on which surface** an AC
   covers the behavior, since many suites run over `@stint/core` and `tt` only.
   Findings that already carry their evidence need no subagent. Strongest model
   level: a misclassification misroutes the issue and no gate catches it (§03).
3. **Decide with the owner.** Batch the fix-direction questions across the whole
   batch into one grill-style interview: tight clusters, recommended answers,
   one at a time — never a flat questionnaire. Sizing and proof of fix are
   usually yours to recommend; fix direction is theirs to make.
4. **Annotate and label.** Per issue, **one** comment in house style (§04): the
   category with the doc refs that justify it, the owner's fix-direction
   decision, the proof-of-fix plan at real files, the routing verdict, and the
   self-reference flag if it applies. Apply the category labels plus `Triaged`
   or `Triaged: dedicated session`; **preserve existing labels** — a label-set
   update replaces the whole set, so include the originals (`Agentic Discovery`
   and the provenance label). Be frugal elsewhere: one comment per issue, no
   thread noise.
5. **Report and route.** Summarize: issue → category → route table, the owner
   decisions made, which issues are now `Triaged` backlog and which go where
   instead. **Do not open PRs or fix anything.**

## Definition-of-done checklist

- [ ] Every target issue read in full; problems taken as confirmed, not
      re-argued.
- [ ] The reference file loaded for every provenance label in the batch.
- [ ] Each issue placed in ≥1 category, classified against the doc that owns
      it, with refs; multi-category findings carry a label for each.
- [ ] Genuine ambiguities and product-behavior calls put to the owner in one
      batched grill, not guessed.
- [ ] Proof of fix named at a real file/§ per issue; weak-but-existing guards
      diagnosed, not just re-flagged.
- [ ] Routing verdict per issue; `Triaged` only on orchestrator-sized ones;
      dedicated-session issues labeled `Triaged: dedicated session` and naming
      their route; suspended issues left unlabeled with their open question
      tracked.
- [ ] Gate-modifying fixes carry the self-reference flag.
- [ ] One comment per issue, house style; labels applied with originals
      preserved.
- [ ] Final report tables the routing; no code touched, no PR opened.
