---
name: audit-qa
description: Run a QA audit — drive the running GUI as a user (the sweep technique) to find defects no requirement covers, using tour/coverage/oracle heuristics to explore diversely rather than click at random. Use when starting or running an agentic QA, exploratory, or sweep pass over the app.
---

# QA audit

How to run a QA audit well. The audit's technique is the **sweep**: drive the running GUI *the
way a user would* and file what it finds (`context/process.html` §06). Like every discovery
instrument it gates nothing and produces no green — its output is issues. This skill is the
*finding* half; `author-bug-report` is the *filing* half, and `author-qa-gif` records the
evidence. Don't restate their conventions here.

The trap this skill exists to avoid: clicking around, "looks fine," done. Ad-hoc clicking finds
only shallow bugs and misses whole classes. Every #37 finding (#48–#52, #55) falls out of one of
the heuristics below — so aim the sweep with them instead of relying on luck.

Grounded in standard exploratory-testing practice: Whittaker's **tours**, Bach/Bolton's **SFDIPOT**
coverage model and **FEW HICCUPPS** oracles, the classic **test-design techniques**, and
**session-based test management**. You don't need the books — the working subset is below.

## The mindset

Exploratory testing is *simultaneous* learning, test design, and execution: you design the next
action from what the last one taught you. Assess the app **as a user acting intuitively, not
against the spec** — the point of a sweep is the defects nobody wrote a requirement for, so
"it matches the PRD" is not a defence and "no requirement covers this" is not a dismissal.

## Run it as sessions

Work in time-boxed sessions, not one endless drift (session-based test management):

- **Charter** — one sentence naming the mission for this session ("exercise every Entries control
  with three weeks of data"). One charter, one focus.
- **Time-box** — ~45–90 min of actual driving per charter, then stop and write up.
- **Notes as you go** — what you did, what you expected, what happened, and any *hunch* to chase
  later. A sweep is worthless if the repro is lost by the time you file.
- **Realistic, seeded data first.** A bug invisible with trivial data is obvious with realistic
  data — seed *weeks* of entries across many days/clients/projects/tags before you start, not one.
  #55 was completely invisible with a single day of data and blatant with three weeks.

## 1 — Cover: what to visit (SFDIPOT)

Before driving a feature, walk it against these guidewords so you leave the happy path. Not every
one applies every session; use them to notice the surfaces you'd otherwise skip.

| Guideword | What to probe in Stint | Caught |
|-----------|------------------------|--------|
| **S**tructure | every screen, view, panel, modal, kebab menu — visit each surface at least once | #48, #51 |
| **F**unctions | each feature and how features *interact* (start a timer, then go filter Entries) | #50 |
| **D**ata | the billed artifact: times, rounding, durations, precision; empty / huge / conflicting values | #49 |
| **I**nterfaces | the IPC boundary (`window.stint`), CSV/JSON export, the CLI ⇄ GUI parity surface | #55 |
| **P**latform | Electron renderer constraints — CSP `script-src 'self'`, no `window.prompt`/`confirm`/`alert` | #52 |
| **O**perations | how a real freelancer actually uses it over a day/week; onboarding from empty | #48 |
| **T**ime | ordering, concurrency, stale state, week/day boundaries, timers left running, sleep/wake | #50, #55 |

## 2 — Drive: how to move diversely (tours)

A **tour** is a lens that steers a session toward one defect class. Pick a couple per charter
rather than wandering. The high-yield tours for a desktop time-tracker:

- **FedEx / Money tour** — follow one piece of data end to end: enter it, store it, filter it,
  report it, export it. Watch for it changing or vanishing in transit. *(#49 times rewritten on
  save; #55 the query never reaching core.)*
- **Garbage Collector / Supermodel tour** — visit *every* control methodically, judging only the
  surface: does each button/field/menu actually do something and look right? *(#48 dead button;
  #51 duplicated fields.)*
- **Obsessive-Compulsive tour** — repeat and re-enter: double-click the action, save with no edits,
  re-run, paste the same value twice, toggle back and forth. *(#49 save-with-no-edits mutates.)*
- **Saboteur / Anti-social tour** — feed what the form doesn't want: empty, whitespace, very long,
  special characters, `to` before `from`, negative/zero durations; cancel mid-flow.
- **Landmark / interleaving tour** — hop between features in an unusual order and check for
  after-effects: the bug is often in feature B *because* of what you did in feature A. *(#50 Timer
  frozen because an Entries filter left stale module state.)*

## 3 — Feed: what values to choose (test-design techniques)

When a control takes input, don't pick one arbitrary value — pick the values that expose faults:

- **Equivalence partitioning** — one representative per class (billable vs non-billable; today vs
  this-week vs last-month range), so you cover behaviour without redundant clicks.
- **Boundary-value analysis** — faults cluster at edges: the minute/second before and after a
  rounding grid, midnight, week-start, an entry that ends exactly when the next begins, 0-second
  and multi-day entries. *(The 5-min snap in #49 is a boundary defect.)*
- **State-transition testing** — exercise every transition of a stateful surface, especially the
  awkward ones: idle→running→stopped, editing a running vs a stopped entry, split/merge. *(#51 is a
  running-state transition the UI mishandles.)*
- **Error guessing** — deliberately try what tends to break UIs: duplicate DOM ids, disabled
  buttons that aren't, stale renders after an external write, unsupported dialogs.

## 4 — Recognize: how you know it's a bug (oracles)

Without a requirement, a bug is an **inconsistency with an oracle**. When something feels off, name
*which* oracle it violates — that's how you justify a finding to a maintainer and avoid filing a
non-bug. **FEW HICCUPPS**:

- **F**amiliar — resembles a known bug pattern.
- **E**xplainable — you can't explain the behaviour coherently.
- **W**orld — contradicts how the world works (a "week" total that isn't a week — #55).
- **H**istory — differs from the app's own past behaviour or stored value (saved times ≠ entered
  times — #49).
- **I**mage — undercuts the product's intended quality/polish.
- **C**omparable products — other time-trackers don't behave this way.
- **C**laims — contradicts the docs, tooltip, label, or button text (button says *Start* while a
  timer runs — #51).
- **U**ser expectations — a reasonable user would be surprised (a primary button that does nothing
  — #48).
- **P**roduct — inconsistent *with itself* (Add-tag works, Add-client doesn't — #48; the app already
  avoids `window.confirm` but still calls `window.prompt` — #52).
- **P**urpose — fails its evident purpose (a filter that doesn't filter — #55).
- **S**tatutes — violates an external rule/standard it must obey.

An oracle is fallible, so lean on several. If nothing feels wrong, that's not proof it's right —
switch tour or oracle and look again.

## 5 — Hand off

For each defect: confirm it reproduces through the **real** entry point, then file it with
`author-bug-report` (one standalone issue, root cause, honest confidence) and capture the repro
with `author-qa-gif`. Label every issue **Agentic Discovery** (the family label every discovery
instrument applies — `triage-issues` intakes on it) plus **Agentic QA Audit** (the provenance
label, this instrument's alone). Note in the issue which tour/oracle surfaced it when it sharpens
the report. Behaviour you exercised and found *correct* is worth a one-line note in the audit
summary so coverage is visible — but it is never a filed issue.
