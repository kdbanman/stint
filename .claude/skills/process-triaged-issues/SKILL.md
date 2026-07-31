---
name: process-triaged-issues
description: >-
  Use when the user asks to process, work, or close out the triaged issue
  backlog (issues labeled "Triaged" or "Triaged: transition") — the one
  execution engine downstream of triage. Drives each unit to an open PR.
---

# Process triaged issues (Stint)

Consume the triaged backlog — **the one downstream of the triage gate**
(`context/process.html` §06): every open issue labeled `Triaged` or
`Triaged: transition`. Hold **one** batched grill interview covering all the
issues that need requirement decisions, then fan the work out — one subagent
per unit — and drive until every unit has an open, ready-for-review PR. This
skill ends at **PRs up, not merged to `main`**; merge to `main` stays the one
human gate (§07).

## Where this fits

- Upstream, one gate (`context/process.html` §06): `triage-discoveries`
  consumes any un-triaged open issue — audit findings and owner-raised alike —
  and records the category, the owner's fix direction, the proof of fix, and
  a routing verdict naming **scale, never session shape**: `Triaged` (this
  skill carries the fix end-to-end) or `Triaged: transition` (the fix needs
  the transition machinery, §03).
- This skill: interview once, delegate, deliver PRs. Issue-scale requirement
  changes are handled here directly — the batched interview is the grill, the
  per-issue subagent lands the in-place spec edits with the code.
- A `Triaged: transition` unit is handled by handing the machinery its input:
  the batched interview settles its design (the synthesis, signed off), then
  the `requirements-transition` skill authors the coexisting docs and files
  the member backlog — and **stops at the owner's launch**. When the owner
  launches, the member issues are ordinary `Triaged` units of a later batch
  of this skill, targeting the transition branch their handoff names.
- Session shape — one session or several, how work is grouped — is this
  session's judgment. The verdict never prescribes it.

Read first: `CLAUDE.md`; `context/process.html` §03 (skills & subagents),
§04 (authoring rules every spec edit must obey), §06 (the pipeline), §07
(branch/PR/merge); and the triage comment on each target issue — it carries
the category, the owner decisions already made, and the regression-guard plan
pointing at real files.

## Step 1 — Gather

Collect the open issues labeled `Triaged` or `Triaged: transition` (or the
set the user names). Read each in full — body **plus** the triage comment.
Decisions recorded there are settled: do not re-ask them.

Then read the batch's **handoff issue** — one per batch, labeled
`Triaged Orchestration`: the batch's sequencing, batching and dependency,
which no per-issue comment carries. Filed by `triage-discoveries` for an
ordinary batch, or by `requirements-transition` for a transition's member
backlog — in the latter case it also names the **base branch** every member
unit targets. If none exists, work it out yourself before partitioning
rather than proceeding without it.

## Step 2 — One batched requirements interview

For the issues labeled `needs new requirement or AC` — and for every
`Triaged: transition` issue, whose synthesis this interview produces — run
the grill **once across the whole batch**:

- One tight cluster of related questions at a time; stop and wait for
  answers. Never a flat questionnaire.
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
A unit may span **more than one PR** when its triage comment says so — the
sequencing lives in the unit, not in a routing label. Merge issues into a
single unit only when they share a requirement or the same files, so separate
PRs would conflict or duplicate work. Keep a merged unit reviewable — when in
doubt, split. A unit's PR names every issue it closes.

A `Triaged: transition` issue partitions to a single **authoring unit**:
invoke `requirements-transition` with the signed-off synthesis; the unit is
done when the transition branch is pushed and the member backlog is filed —
execution waits for the owner's launch.

Then sequence and batch deliberately. **The handoff issue is the starting
partition.** Depart from it where the tree has moved since, and say so:

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

Launch one subagent per unit, in parallel. The judgment-heavy stages —
interview, synthesis, partitioning, final PR review — stay in this session.

### Choosing subagent model level

Each subagent runs at a **model level** — `sonnet` < `opus` < `fable`.
Decide per unit, by this procedure:

1. **Default is `fable`.** Downgrading is a deliberate act, never the reflex.
2. **Ask the gate question:** *if this subagent does its job subtly wrong,
   what catches it?* A **deterministic gate** — the build, a test, a golden,
   the judge, the evidence-drift comparison, a later stage that mechanically
   rechecks — makes the task downgrade-eligible. If only a review or a human
   would catch it, do not downgrade.
3. **The levels:**
   - `sonnet` — mechanical and fully specified, verified by command: run a
     suite and report failures verbatim; regenerate evidence; apply an exact
     rename list; collect an inventory a later stage rechecks.
   - `opus` — well-scoped, gate-checked execution: implementation against a
     precise contract with co-located tests that pin the behavior. Never for
     anything that authors or alters requirements or acceptance criteria, or
     touches a core (`●`) integrity/data-loss requirement.
   - `fable` — uncertain or subtle work needing judgment and wayfinding:
     authoring or altering requirements/ACs; core integrity/data-loss
     requirements; review stages; repair whose cause is not yet understood;
     any task deciding what the spec *means*.
4. **Reasoning effort is always `high`.** When in doubt, `fable` — a wrong
   cheap agent costs a diagnose-and-repair loop that dwarfs the saving.

### Delegation rules

- **Self-reference flagged units get no benefit of the doubt.** A unit whose
  fix modifies a deterministic gate (the judge, CI wiring, check scripts,
  test harnesses) cannot be vouched for by the gate it modifies — the triage
  comment carries the flag. Delegate the mechanical work if useful, but
  review that unit's gate-diff in this session line by line before calling it
  done; for small gate changes, just do the unit in-session.
- **Isolation: own worktree + branch.** Units run concurrently and must not
  share a working tree. A unit's branch targets `main`, or the base branch
  its handoff names (a transition's member units target the transition
  branch).
- **Prompt contents:** the issue number(s) and full text, the triage comment
  verbatim, the signed-off interview decisions for that unit verbatim, the
  base branch, and the definition of done below. Do **not** prescribe skills
  or a step-by-step method — the repo's `CLAUDE.md` and
  `context/process.html` steer the session, and the triage comment already
  names the guard files. Beware the corollary: a detailed-but-partial
  checklist **prescribes by omission** — agents optimize to the enumerated
  list and the ambient steering loses. Point prompts at the §05 inventory
  and the relevant skills; don't restate them.
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
- **Member PRs targeting a shared transition branch are merged by this
  session on green** (§07) — merge to `main` is the human gate, and a
  transition's gates are the launch and its single integration PR. PRs
  targeting `main` are never merged here.
- Finish with a table mapping issue → unit → PR, plus anything handed to the
  owner (a transition backlog awaiting launch, design gaps the interview
  couldn't settle).

## Definition-of-done checklist

- [ ] All open `Triaged` / `Triaged: transition` issues gathered; bodies and
      triage comments read.
- [ ] The batch's `Triaged Orchestration` handoff read (or worked out), and
      carried into Step 3 — including any base branch it names.
- [ ] One batched grill held for every `needs new requirement or AC` and
      `Triaged: transition` issue; written synthesis signed off before any
      delegation.
- [ ] Units partitioned; any multi-issue unit justified by a shared
      requirement or files, and its PR names every issue; any multi-PR unit
      justified by its triage comment.
- [ ] Transition units: `requirements-transition` invoked with the synthesis;
      stopped at the owner's launch, never auto-launched.
- [ ] Units sequenced: gate-strengthening work first, shared-file units
      ordered rather than raced, kindred small fixes batched.
- [ ] Every self-reference-flagged unit's gate-diff reviewed in-session (or
      the unit done in-session); none delegated fire-and-forget.
- [ ] Every unit delegated to a subagent in its own worktree at a model level
      chosen by the gate question — prompted with issue + triage comment +
      decisions + base branch, not with skill instructions.
- [ ] Every unit passed the §05 checks for its touched surfaces — operator-run
      rows included — and its PR follows `pr-authoring`.
- [ ] Every unit's PR open and ready (not draft); failures re-driven, not
      dropped; member PRs to a transition branch merged on green, PRs to
      `main` left for the owner.
- [ ] Final report maps issue → PR; nothing merged to `main` by this skill.
