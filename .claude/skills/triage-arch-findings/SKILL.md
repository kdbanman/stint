---
name: triage-arch-findings
description: >-
  Use when issues filed by an architecture review (labeled "Agentic Arch
  Review Discovery") need triage into the Triaged backlog. Decides and
  routes; does not fix.
---

# Triage architecture findings (Stint)

Take the issues an architecture review filed and turn each **confirmed
problem** into a **work-ready** one: fix direction decided with the owner,
proof-of-fix named, sized, labeled, routed. The sibling of
`triage-qa-findings`, adapted to what an arch finding already is and isn't.

The asymmetry that shapes this skill: **the review's grilling confirmed the
problem; `Triaged` promises a plan.** An arch issue arrives unusually
triage-ready — evidence with file:line, stakes, severity, confidence,
sometimes fix constraints are already in the body — but `arch-review` phase 3
is problem capture only, so nothing about the *fix* has been decided. This
skill supplies that missing half. It **decides and routes; it does not fix.**
No `packages/` edits, no docs rewritten — it produces the per-issue comment
and labels, then hands each issue to the right downstream path.

## Where this fits

`arch-review` critiques the four systems (code, verification apparatus,
SDLC/process, the `context/` docs as artifacts), grills the owner, and files
one issue per confirmed problem. This skill triages those issues into the
**same `Triaged` contract `triage-qa-findings` produces**, so
`process-triaged-issues` consumes both streams identically. Its most
important output is the routing verdict — which issues that orchestrator
should *not* get.

Read first for the vocabulary you decide with:

- `CLAUDE.md` — the doc map.
- `context/process.html` §03 (gate question, skills), §06 (discovery — where
  this skill sits), §04 (authoring rules the comment must follow), §02 (the
  principles — many arch findings are violations of these).
- `context/acceptance.html` + `acceptance/criteria/COVERAGE.md` — when a
  finding lands in the AC apparatus.
- `context/prd.html` — when a finding is product-shaped.

## The four decisions per issue

Triage records four things per issue, in one comment:

1. **Category.** The QA categories apply unchanged — classify against
   **whichever requirements doc owns the behavior**: `context/prd.html` for
   product-shaped findings, `context/process.html` for process-shaped ones
   (process.html is the PRD of the apparatus).
   - `has requirement or AC already` — a requirement or principle already
     governs it and reality violates it (a §02 principle asserted but
     unenforced, a spec'd precondition never checked).
   - `needs new requirement or AC` — the behavior should be specified
     (either doc) but isn't. Includes recording an accepted decision whose
     rationale exists nowhere.
   - `no requirement needed` — plain apparatus or code work with no doc
     consequence.
   Where spec and reality disagree (the doc claims a check that doesn't
   exist), the owner decides **which side moves** — build the check or
   retract the claim — and the category follows the decision.
2. **Fix direction.** The owner's call on *what kind* of fix, not its
   design: which alerting channel, confirm-vs-refuse, bind-vs-retract,
   which of the alternatives the issue left open. The grilling confirmed the
   problem exists; this decides what "fixed" means. Recommended answer
   first, one cluster at a time — `grill-me` stance, never a questionnaire.
3. **Proof of fix.** The arch analog of the QA regression guard — name what
   will show the problem gone and staying gone, at a real file:
   - apparatus gap → the new or strengthened check that binds the claim
     (the repo's bind-two-homes-or-fail-loud pattern), and which §05 row it
     joins;
   - unrecorded decision → the doc § that will record it;
   - structural → the test or binding that makes the drift class impossible,
     or the deletion-test claim that will hold after the change.
   Never a generic "add a test."
4. **Routing verdict.** The sizing call:
   - **Orchestrator-sized** → label `Triaged` (+ category labels): fits one
     issue-anchored PR, reviewable, and a deterministic gate can catch a
     subtle implementation failure.
   - **Dedicated session** → label `Triaged: dedicated session` (+ category
     labels), never plain `Triaged`: multi-PR restructures, tooling
     decisions, process design with no code surface. Name the route in the
     comment (the `change-requirements` pair for spec-scale change, a
     dedicated working session otherwise). The label records that triage is
     complete — without it a routed issue is indistinguishable from an
     un-triaged one — while only plain `Triaged` feeds
     `process-triaged-issues`.

   An issue whose triage is *suspended* rather than completed (the owner
   withdraws the fix direction pending more thought) gets neither label:
   it is not yet routed, and its pending state must stay visible. Track
   the open question somewhere real (a todo issue) and say so in the
   comment.

## The self-reference flag

Mark any issue whose fix **modifies a deterministic gate** — the judge, CI
wiring, check scripts, test harnesses. For these the §03 gate question fails:
the gate being modified cannot gate its own modification, so a delegated
subagent can green itself. The flag tells `process-triaged-issues` to review
that unit's gate-diff in-session (or keep the unit in-session entirely). A
gate-modifying issue can still be orchestrator-sized; it just can't be
fire-and-forget.

## Steps

1. **Gather.** Default: open issues labeled `Agentic Arch Review Discovery`,
   or the set the user names. Read each in full — body, evidence, recorded
   fix constraints. Do not re-litigate the problem: the grilling settled
   that it is one.
2. **Research where needed.** Most arch issues carry their evidence already.
   Spawn a research subagent only where a decision needs facts the issue
   lacks (what would the check cost, does a binding site exist, which doc
   owns the claim). Strongest model level — a wrong answer misroutes the
   issue and no gate catches it (§03).
3. **Decide with the owner.** Batch the fix-direction questions across all
   issues into one grill-style interview: tight clusters, recommended
   answers, one at a time. Sizing and proof-of-fix are usually yours to
   recommend; fix direction is theirs to make.
4. **Annotate and label.** Per issue, one comment in house style (§04):
   category with the doc refs that justify it, the owner's fix-direction
   decision, the proof-of-fix plan at real files, the routing verdict, and
   the self-reference flag if it applies. Apply the category labels plus
   `Triaged` for orchestrator-sized issues or `Triaged: dedicated session`
   for dedicated-session ones; preserve existing labels — a label-set
   update replaces the whole set, so include the originals
   (`Agentic Arch Review Discovery`).
5. **Report and route.** Summarize: issue → category → route table, the
   owner decisions made, which issues are now `Triaged` backlog and which go
   where instead. **Do not open PRs or fix anything.**

## Definition-of-done checklist

- [ ] Every target issue read in full; problems taken as confirmed, not
      re-argued.
- [ ] Each issue classified against the doc that owns it (PRD or
      process.html), with refs.
- [ ] Fix direction decided by the owner for every issue that had
      alternatives open; nothing laundered into a confident label.
- [ ] Proof of fix named at a real file/§ per issue.
- [ ] Routing verdict per issue; `Triaged` only on orchestrator-sized ones;
      dedicated-session issues labeled `Triaged: dedicated session` and
      naming their route; suspended issues left unlabeled with their open
      question tracked.
- [ ] Gate-modifying fixes carry the self-reference flag.
- [ ] One comment per issue, house style; labels applied with originals
      preserved.
- [ ] Final report tables the routing; no code touched, no PR opened.
