---
name: process-triaged-issues
description: >-
  Use when the user asks to process, work, or close out the triaged issue
  backlog (issues labeled "Triaged") — drives each one to an open PR.
---

# Process triaged issues (Stint)

Consume the triaged discovery backlog: take every open issue labeled
`Triaged`, hold **one** batched grill interview covering all the issues that
need requirement changes, then fan the work out — one subagent per issue (or
small merged cluster) — and drive until every issue has an open, ready-for-
review PR. This skill ends at **PRs up, not merged**; the owner merge stays the
one human gate (`context/process.html` §07).

## Where this fits

- Upstream, five discovery instruments into one gate
  (`context/process.html` §06): `qa-audit` (via `bug-report-authoring`),
  `arch-audit`, `design-audit`, `code-quality-audit`, and `sync-audit` file
  their findings; `triage-discoveries` categorizes each against the doc that
  owns it, records the owner's fix direction, names the proof of fix, and
  labels. Every finding ends at the same `Triaged` comment-and-label contract;
  this skill does not care which instrument an issue came from, only that the
  contract holds.
- This skill: interview once, delegate, deliver PRs.
- For issue-scale requirement changes it substitutes for the
  `change-requirements` → `requirements-transition` pair: the batched interview
  is the grill, the per-issue subagent is the transition. A change too large
  for one issue-anchored PR (a multi-doc restructure, an `*-old.html` swap)
  still belongs to the pair — hand it back rather than force it through here.

Read first: `CLAUDE.md`; `context/process.html` §03 (subagents & model level),
§04 (authoring rules every spec edit must obey), §07 (branch/PR); and the
triage comment on each target issue — it carries the category, any owner
decisions already made, and the regression-guard plan pointing at real files.

## Step 1 — Gather

Collect the open issues labeled `Triaged` (or the set the user names) — plain
`Triaged` only: `Triaged: dedicated session` marks an issue triage routed
*away* from this orchestrator, never its input. Read each in full — body
**plus** the triage comment. Decisions recorded there are settled: do not
re-ask them.

Then read the batch's **handoff issue** — one per batch, labeled
`Triaged Orchestration`, filed by `triage-discoveries`: the batch's sequencing,
batching and dependency, which no per-issue comment carries. If none exists,
work it out yourself before partitioning rather than proceeding without it.

## Step 2 — One batched requirements interview

For the issues labeled `needs new requirement or AC`, run the
change-requirements-style grill **once across the whole batch**:

- One tight cluster of related questions at a time; stop and wait for answers.
  Never a flat questionnaire.
- Every question carries a recommended answer and a one-line rationale.
- Consult the codebase, don't ask what code can answer (schema, CLI command
  table, renderer, mockups).
- Cover per issue: the exact §/R text delta, in whichever doc owns the
  behavior — `context/prd.html` for product-shaped issues,
  `context/process.html` for process-shaped ones, `context/design.html` for
  visual rules, `context/engineering.html` for code and test conventions (the
  triage comment names it). The product questions that follow apply only to
  product-shaped issues: parity (a new capability is reachable from both `tt`
  and the GUI unless the user explicitly waives it), data-loss/integrity
  consequences, which mockup depicts the change, and where the ACs land.
- Triage-time decisions are givens; the interview goes one level deeper — the
  threshold behind a decided confirm, the canonical glossary term, comparator
  edge cases, CLI flag shapes.

End with a written per-issue synthesis (decisions, spec deltas, AC homes) and
get sign-off. **Do not delegate until it is signed off.**

## Step 3 — Partition into work units

Default: one issue = one unit = one branch + PR (§07's one-issue convention).
Merge issues into a single unit only when they share a requirement or the same
files, so separate PRs would conflict or duplicate work (e.g. a feedback
requirement whose call sites span several issues). Keep a merged unit
reviewable — when in doubt, split. A unit's PR names every issue it closes.

Then sequence and batch deliberately — the backlog varies more in shape than
a product-bugfix list (triaged arch issues especially), so don't just launch
everything at once. **The handoff issue is the starting partition.** Depart from
it where the tree has moved since, and say so:

- **Gate-strengthening first.** A unit that adds or tightens a deterministic
  gate (a schema, a binding test, a drift comparison) lands before units
  whose work that gate would check, so later units run against the stronger
  gate.
- **Shared-file units run sequentially,** not in parallel worktrees: units
  touching the same load-bearing files (`COVERAGE.md`, `context/process.html`,
  the judge) will conflict — order them, rebase later units on the earlier
  branch (Step 5), or fold them into one unit.
- **Batch kindred smallness.** A checklist issue of phrase-scale fixes is one
  unit, not N.

Issues labeled `has requirement or AC already` / `no requirement needed` need
no interview; they become units directly.

## Step 4 — Delegate

Launch one subagent per unit, in parallel:

- **Model level: Opus, high effort.** The §03 gate question justifies it: the
  §05 deterministic gates catch implementation slips, and PR review is the
  human gate.
  The judgment-heavy stages — interview, synthesis, partitioning, final PR
  review — stay in this session.
- **Self-reference flagged units get no benefit of the doubt.** A unit whose
  fix modifies a deterministic gate (the judge, CI wiring, check scripts,
  test harnesses) cannot be vouched for by the gate it modifies — the triage
  comment carries the flag. Delegate the mechanical work if useful, but
  review that unit's gate-diff in this session line by line before calling it
  done; for small gate changes, just do the unit in-session.
- **Isolation: own worktree + branch.** Units run concurrently and must not
  share a working tree.
- **Prompt contents:** the issue number(s) and full text, the triage comment
  verbatim, the signed-off interview decisions for that unit verbatim, and the
  definition of done below. Do **not** prescribe skills or a step-by-step
  method — the repo's `CLAUDE.md` and `context/process.html` steer the
  session, and the triage comment already names the guard files. Beware the
  corollary: a detailed-but-partial checklist **prescribes by omission** —
  agents optimize to the enumerated list and the ambient steering loses.
  Point prompts at the §05 inventory and the relevant skills; don't restate
  them.
- **Definition of done per unit:**
  - Spec-affecting units: `context/` docs and mockups updated per the
    decisions, obeying §04 authoring rules (mockup sync is a hard rule).
  - The fix implemented; the regression guards from the triage comment added
    at the named files/layers; `COVERAGE.md` rows corrected where touched.
  - **Every check `context/process.html` §05 names for the surfaces the unit
    touches** — automatic *and* operator-run. §05 is the source of truth;
    this file never restates it.
  - Issue-anchored branch pushed; a ready (not draft) PR opened that closes
    the unit's issue(s), authored per the `pr-authoring` skill.

## Step 5 — Drive to PRs-up

Do not end the run while any unit lacks an open PR:

- Monitor subagents. When one returns, verify its PR exists and its checks are
  green or pending. A failed or stalled unit is re-diagnosed and re-delegated
  (or finished directly) — one attempt is not the task.
- Review each PR diff against the unit's decisions before calling it done;
  push corrections to the unit's branch where needed.
- Review against the **un-gated conventions** too — §05's operator-run rows
  and the authoring skills' rules: the checks no CI gate enforces are exactly
  what this review exists to catch, and a green pipeline says nothing about
  them.
- Cross-unit conflicts land sequentially: rebase later units on the earlier
  branch or note the ordering in both PRs.
- Finish with a table mapping issue → unit → PR, plus anything handed back
  (too-large changes, design gaps the interview couldn't settle).

Merging is not this skill's job.

## Definition-of-done checklist

- [ ] All open `Triaged` issues gathered; bodies and triage comments read.
- [ ] The batch's `Triaged Orchestration` handoff read (or worked out), and
      carried into Step 3.
- [ ] One batched grill held for every `needs new requirement or AC` issue;
      written synthesis signed off before any delegation.
- [ ] Units partitioned; any multi-issue unit justified by a shared
      requirement or files, and its PR names every issue.
- [ ] Units sequenced: gate-strengthening work first, shared-file units
      ordered rather than raced, kindred small fixes batched.
- [ ] Every self-reference-flagged unit's gate-diff reviewed in-session (or
      the unit done in-session); none delegated fire-and-forget.
- [ ] Every unit delegated to an Opus high-effort subagent in its own
      worktree, prompted with issue + triage comment + decisions — not with
      skill instructions.
- [ ] Every unit passed the §05 checks for its touched surfaces — operator-run
      rows included — and its PR follows `pr-authoring`.
- [ ] Every unit's PR open and ready (not draft); failures re-driven, not
      dropped.
- [ ] Final report maps issue → PR; nothing merged by this skill.
