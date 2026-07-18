---
name: arch-review
description: Run an adversarial architecture review session — critique the systems that specify, implement, verify, and deliver the product, grill the owner over the verdicts, then file the confirmed problems as issues. Use when the user asks for an architecture or design review.
---

# Adversarial architecture review

One session, three phases in order: the skeptic/researcher review cycle, a
grilled owner pass over its verdicts, and one GitHub issue per confirmed
problem labeled **Agentic Arch Review Discovery**. The charter never changes:
**preserve requirements and functionality** — critique the four systems that
carry them (code, verification apparatus, SDLC/process, the `context/` docs as
artifacts), not the product's requirements.

Run the phases as the operator, holding judgment between them (process.html
R13) — never compile the session into an orchestration script. Nothing lands
in the repo: the session's outputs are the report shown to the user and the
issues.

## Taste references

Load before starting; they set the goals and vocabulary:

- Matt Pocock's `improve-codebase-architecture` and `codebase-design` skills —
  fetch from `https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/<name>/SKILL.md`.
  Use the codebase-design glossary exactly (**module**, **interface**,
  **depth**, **seam**, **adapter**, **leverage**, **locality**, the deletion
  test); don't drift into "component," "service," "boundary."
- The repo's `grill-me` skill for phase 2's interview stance.

## Phase 1 — review

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
must correct the skeptic's premises when wrong — both directions happen and
matter.

At saturation the skeptic drafts the review: provenance (method, date, commit
reviewed), a standalone map of the four systems, then **Good / Questionable /
Bad decisions** (each entry: decision, evidence, judgment in the design
vocabulary — including suspicions the evidence refuted; honesty about
refutations is what makes the confirmations credible), then
requirements-preserving fixes ordered by leverage. The researcher fact-checks
every number, a sample of citations, and **every absence claim** ("no X exists
anywhere"); the operator applies mechanical corrections. Every questionable/bad
entry also carries its **stakes**, thought through hard in both directions: the
strongest case the finding is real and the strongest honest case it is fine,
the consequence trajectory if left (and its trigger), and the cost and risk of
changing it. Report to the user as a legible, minimal, engineering-styled HTML
artifact in the conversation — not as a repo file. The artifact is the owner's
reference material during the grilling.

## Phase 2 — grill the owner

Verdicts are the skeptic's, not the owner's; the grilling is the bar. It can
shape anything about a proposed issue — including whether it is one at all.
Run a `grill-me` session over every questionable/bad entry (cluster entries
that would be one issue): one question at a time, recommended answer first,
until shared understanding of which findings are **actual problems** and which
are **accepted decisions**. Capture the owner's rationale for each accepted
decision — that rationale is itself a finding (an unrecorded decision) if no
doc records it.

## Phase 3 — file the problems

One issue per confirmed problem, labeled **Agentic Arch Review Discovery**.
Problem capture only — no solution sections; fixes are the fix-PR's job. Each
issue is self-contained: the problem in one sentence; evidence (file:line,
doc §, commit); why it's a problem (what drifts, what false-greens, what it
costs); severity and confidence, honestly.
