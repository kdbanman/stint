---
name: arch-review
description: Run an adversarial architecture review of the systems that specify, implement, verify, and deliver the product — or triage a finished review's findings into issues. Use when the user asks for an architecture/design review session or to grill through its verdicts.
---

# Adversarial architecture review

A full session produces three artifacts, in order: a review document
(`reviews/architecture-review.md`), a grilled owner triage of its verdicts, and
one GitHub issue per confirmed problem labeled **Agentic Arch Review Discovery**.
Each stage can also run alone (a re-review refreshes the document; a triage can
start from an existing document). The charter never changes: **preserve
requirements and functionality** — critique the four systems that carry them
(code, verification apparatus, SDLC/process, the `context/` docs as artifacts),
not the product's requirements.

Run the stages as the operator, holding judgment between them (process.html
R13) — never compile the session into an orchestration script.

## Taste references

Load before starting; they set the goals and vocabulary:

- Matt Pocock's `improve-codebase-architecture` and `codebase-design` skills —
  fetch from `https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/<name>/SKILL.md`.
  Use the codebase-design glossary exactly (**module**, **interface**,
  **depth**, **seam**, **adapter**, **leverage**, **locality**, the deletion
  test); don't drift into "component," "service," "boundary."
- The repo's `grilling` skill (vendored from the same source) for stage 3's
  interview stance.

## Stage 1 — the skeptic/researcher cycle

Two persistent agents, messages shuttled by the operator:

- **Skeptic** — adversarial, grill-me-style. Asks why-why-why about decisions
  across all four systems, 3–6 pointed questions per round, each stating the
  suspicion motivating it. May read cheaply for orientation (CLAUDE.md, README,
  git log hot spots); directs deep research to the researcher. Keeps a running
  good/questionable/bad ledger. Declares saturation when new answers stop
  changing judgments — expect 4–6 rounds; don't stop at 2 or drag past 6.
- **Researcher** — unopinionated. Answers with file:line citations, quantifies
  where cheap, fans out read-only subagents for breadth, reads decisive files
  itself before load-bearing claims. Hunts recorded rationale (docs, comments,
  git history) and answers "no recorded rationale found" plainly rather than
  inventing one. Reports inconvenient findings as readily as convenient ones.

The skeptic must re-ask harder when an answer lacks evidence; the researcher
must correct the skeptic's premises when wrong (both directions happened and
mattered in the first run — issue #20).

## Stage 2 — the document

The skeptic drafts `reviews/architecture-review.md`: provenance header
(method, date, commit reviewed), a standalone map of all four systems, then
**Good / Questionable / Bad decisions** (each entry: decision, evidence,
judgment in the design vocabulary — including suspicions the evidence refuted;
honesty about refutations is what makes the confirmations credible), then
requirements-preserving fixes ordered by leverage. Repo authoring rules bind
(process.html §04). The researcher then fact-checks every number, a sample of
citations, and **every absence claim** ("no X exists anywhere"); the operator
applies mechanical corrections. Ship the document as its own PR.

## Stage 3 — grill the owner

Verdicts are the skeptic's, not the owner's. Run a `grilling` session over
every questionable/bad entry (cluster entries that would be one issue): one
question at a time, recommended answer first, until shared understanding of
which findings are **actual problems** and which are **accepted decisions**.
Capture the owner's rationale for each accepted decision — that rationale is
itself a finding (an unrecorded decision) if no doc records it.

## Stage 4 — file the problems

One issue per confirmed problem, labeled **Agentic Arch Review Discovery**.
Problem capture only — no solution sections; fixes are the fix-PR's job.
Each issue: the problem in one sentence; evidence (file:line, doc §, commit);
why it's a problem (what drifts, what false-greens, what it costs); severity
and confidence, honestly; a link back to the review document section. Follow
`bug-report-authoring` for tone and evidence discipline. Issues found to be
product-behavior bugs during the grill route to the QA labels instead
(`triage-qa-findings`).
