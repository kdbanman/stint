---
name: code-quality-audit
description: Run a module-level code & test quality audit — read the implementation and tests against engineering.html's balance rules, grill the owner over the verdicts, then file the confirmed findings as issues. Use when the user asks for a code quality audit or review, a consistency review, or a codebase sweep.
---

# Code quality audit

The module-level twin of `arch-audit`: that skill critiques the four *systems*
that carry the requirements; this one reads the *code and tests themselves*
against `context/engineering.html`. Same posture as every discovery instrument
(process.html §06): the run gates nothing, fixes nothing, and produces no
green — its output is issues. The charter never changes: **preserve
requirements and functionality** — findings are about how the code is written,
never about what the product should do.

One session, three phases, run as the operator holding judgment between them
(process.html R13). Load `context/engineering.html` before starting; its §02
vocabulary (module, interface, depth, seam, shallow) and §03 quadrants are the
audit's language — don't drift into "component," "service," "layer."

## Phase 1 — read

Fan read-only subagents across the implementation (`packages/*/src`,
`packages/gui/renderer`) and tests (`packages/*/test`, `features/`), each
hunting one dimension. The dimensions:

- **Depth** — shallow modules, pass-throughs, entangled pairs (two functions
  only understandable together), information leakage (one decision spelled in
  two places), interfaces costlier than what they hide.
- **Consistency** — the same thing done two ways; a pattern the codebase has
  clearly chosen (engineering.html §04's recorded conventions) violated in
  places. Cite both sites; inconsistency findings need two file:line pointers
  by definition.
- **Abstraction** — wrong abstractions (parameters and conditionals accreted
  per caller — candidates for the §02 re-inline exit), and proven sameness
  left duplicated (copies that have changed in lockstep).
- **Over-delivery** — speculative generality: capability, flexibility, or
  configuration with no current caller; scope creep left over from past
  changes; guards whose defect costs less than their upkeep (§03).
- **Test quality** — quadrant misplacements (glue with unit tests, domain
  logic without); tautological, change-detector, and mock-asserting tests;
  tests that break on refactors; trivial code with tests; missing tests where
  §03's table demands them.
- **Comments** — mechanics-narrating noise, and its inverse: a non-obvious
  decision with no rationale recorded (§07).

Weight attention by change frequency (`git log` hot spots) — depth problems
only cost where change happens, so a finding in cold code must argue why it
matters anyway. Each subagent returns candidates with file:line evidence and
quantification where cheap (callers, line counts, commit counts). The operator
verifies every candidate by reading the code before it survives — subagent
findings are leads, not verdicts — and drops any the evidence refutes.

## Phase 2 — grill the owner

Run a `grill-me` session over the surviving findings (cluster ones that would
be one issue): one at a time, recommended verdict first, until each is either
a **confirmed problem** or an **accepted decision**. Capture the rationale for
each accepted decision — an unrecorded decision is itself a finding if no doc
or comment records it. The owner shapes anything about a finding, including
whether it is one.

## Phase 3 — file the findings

One issue per confirmed problem, labeled **Agentic Discovery** (the family
label every discovery instrument applies — `triage-discoveries` intakes on it)
plus **Agentic Code Quality Audit** (the provenance label, this instrument's
alone; findings are traceable to the audit that filed them). Problem capture
only — no solution sections. Each issue is self-contained: the problem in one
sentence (the handle), evidence (file:line, both sites for consistency
findings, numbers where they exist), why it costs (what drifts, what a future
change pays, what a reader mislearns), severity and confidence, honestly.
Over-delivery findings name the deletion, not a redesign.
