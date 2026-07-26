---
name: design-audit
description: Run a recurring adversarial design audit — judge the running GUI and mockups against the design spec and the distilled craft corpus, grill the owner over the verdicts, then file confirmed problems as issues. Use when the user asks for a design audit, design review, or polish pass.
---

# Adversarial design audit

One session, three phases in order — the design sibling of `arch-audit`. The
charter: **judge how the product looks, reads, and feels** against
`context/design.html` (the binding rules), the platform grammar, and the craft
corpus in `references/` — never against private taste. Functional defects are
`qa-audit`'s job; requirements critique is `arch-audit`'s; this session is
about the surface: hierarchy, alignment, colour, type, states, motion,
interaction feel.

Two kinds of output, routed differently:

- **Defects** — the spec or a checklist rule is violated (a token bypassed, a
  floor missed, a state unhandled, a misalignment): one GitHub issue per
  confirmed problem, labeled **Agentic Discovery** + **Agentic Design Audit**,
  triaged by the `triage-discoveries` skill.
- **Opportunities** — the spec is satisfied but the design could be better (a
  new idiom, a palette evolution, dark mode): appended to the standing
  **Design opportunities** issue, one-line handle each. Never filed as defects.

Nothing else lands in the repo: the session's outputs are the report shown to
the user, the issues, and the opportunity lines.

## Load before starting

- `context/design.html` + `context/design.tokens.json` — the binding rules;
  every finding cites a rule id (D01–D17, A01–A06) or names the checklist item.
- `acceptance/criteria/STATES.md` — the state matrix; the audit walks it.
- `references/checklist.md` — the working checklist (floors, heuristics,
  micro-details, states).
- `references/corpus.md` — the source corpus, for grounding judgments and for
  the grilling phase's vocabulary. Cite sources, don't paraphrase them as taste.
- The repo's `grill-me` skill for phase 2's stance, and `run` to drive the app.

## Phase 1 — audit

Two persistent agents, messages shuttled by the operator (never compiled into
an orchestration script — process.html R13):

- **Auditor** — adversarial, checklist-driven. Works surface by surface
  (Timer, Entries, Clients, Reports, Settings, popover — idle *and* the
  non-ideal states per STATES.md), asking of each: which rule or checklist item
  does this violate, and would a screenshot convince the owner? Keeps a running
  good/questionable/bad ledger with rule citations. Declares saturation when a
  full pass adds nothing new.
- **Evidence-gatherer** — unopinionated. Drives the real app (the `run` skill /
  Chromium-over-real-core driver), captures the screenshots the auditor names,
  measures what's measurable (computed styles, actual paddings, contrast of a
  rendered pair), and reports inconvenient findings as readily as convenient
  ones. Never asserts taste; only facts with file:line or pixel evidence.

At saturation the auditor drafts the report: provenance (commit, date, method),
then **Conforming / Questionable / Violating** findings — each with the rule
id, the evidence (screenshot or measurement), and severity — then the
opportunity list. The evidence-gatherer fact-checks every measurement and every
absence claim. Report to the user as a legible HTML artifact with the
screenshots inline; it is the owner's reference during the grilling.

## Phase 2 — grill the owner

Verdicts are the auditor's; the grilling is the bar. Run a `grill-me` session
over every questionable/violating finding (cluster what would be one issue):
one question at a time, recommended answer first, until each finding is either
a **confirmed problem**, an **accepted deviation** (the owner's rationale gets
recorded — an accepted deviation with no recorded rationale in the spec is
itself a finding: the spec should say so), or an **opportunity** (rerouted to
the standing issue). Taste calls the owner can't articulate a rule for become
opportunities, not defects.

## Phase 3 — file

- One issue per confirmed problem, labeled **Agentic Discovery** + **Agentic
  Design Audit**:
  the problem in one sentence (name the idea); the violated rule id or
  checklist item; evidence (screenshot, measurement, file:line); severity and
  confidence, honestly. Problem capture only — no solution sections.
- Append opportunities to the **Design opportunities** issue (create it if
  missing), one line each.
- Accepted deviations that the spec should record → one issue against
  `context/design.html` (a spec gap, not a product defect).
