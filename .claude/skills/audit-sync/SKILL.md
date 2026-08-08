---
name: audit-sync
description: Run a sync audit — judge requirements↔implementation sync and file drift findings as issues. Use when asked for a sync audit or assessment, a doc-drift check, or whether the docs still tell the truth about the tree.
---

# Requirements ↔ implementation sync audit

One question, asked hard: **do the docs still tell the truth about the tree?**
A discovery instrument (`context/process.html` §06): it gates nothing, produces
no green, and lands nothing in the repo — its outputs are filed issues and a
run summary. Heavy by design: fanned-out readers over the whole claim surface,
behavioral evidence where reading cannot settle a claim, operator judgment
between phases (process.html R13 — never compile the run into an orchestration
script). Cadence is the §06 recorded convention: once in a while, not per-PR.

## The question, split

Machine-decidable facts — a cited path exists, banned markup is absent — belong
to static checks, never to this skill: don't re-derive what a deterministic
check asserts, and where such a check is *missing* for a machine-decidable
claim, that absence is itself a finding, not a reason to do the checking by
hand. This skill owns the **judgment half**: whether the *meaning* still
matches. The claim surface, doc by doc:

- `context/prd.html` requirement text ↔ what the shipped surfaces actually do.
- `acceptance/criteria/COVERAGE.md` row verdicts ↔ what the cited tests
  actually prove. A cited file can exist yet prove less than its row claims —
  existence is the static check's question; sufficiency is yours.
- `context/process.html` §05 inventory ↔ what `ci.yml` and `scripts/`
  actually run, and §02's principles ↔ whether the apparatus still honors
  them.
- `context/acceptance.html` method routing ↔ the suites as they exist.
- `context/architecture.html` ↔ the real module shape of `packages/`.
- `context/glossary.html` and the §09 process glossary ↔ the vocabulary the
  code, tests, and docs actually use.
- `context/mockups/` ↔ the GUI requirements they illustrate (the PRD §18
  keep-in-sync duty).
- The front doors (`CLAUDE.md`, `README.md`) ↔ everything they summarize.

## Drift has direction — name it

Every finding states which side is wrong and which way the lie leans:

- **Stale-optimistic** — the doc claims more than the tree holds: a phantom
  check in the §05 inventory, a "covered" row whose test proves less than the
  requirement. A false green in prose; the worst kind, because it reassures.
- **Stale-pessimistic** — the doc claims less: an open "gap" a merged issue
  closed, a requirement described as unbuilt that shipped. Sends readers to
  re-fix finished work and erodes trust in every other row.
- **Behavior drift** — the doc is right and the tree diverges: shipped
  behavior no longer does what the requirement says. Not a doc defect at all —
  a product defect wearing one's clothes.

Deciding which side is wrong is the audit's central judgment call. When
it is genuinely undecidable — text and tree disagree and either could
reasonably move — file the disagreement itself and say so; triage owns the
which-side-moves decision, not you.

## Phase 1 — fan out readers

Split the claim surface into reader-sized beats — per PRD section, per
meta-doc, per subsystem — and spawn read-only subagents, one per beat. Each
reader returns a claims table: the doc's claim, what the tree says (with
file:line on both sides), a verdict (agrees / drifts-optimistic /
drifts-pessimistic / behavior-drift / can't-settle-by-reading), and honest
confidence. Readers run at the strongest model level, no downgrade — the §03
gate question fails here twice over: no gate catches a subtly wrong verdict,
and nothing at all catches a drift a reader silently missed. Cover the whole
surface; depth per claim is where judgment economizes, not breadth.

## Phase 2 — settle by observation

Reading settles most claims; behavior settles the rest. For every
can't-settle-by-reading verdict and every claim about what a surface *does*,
get behavioral evidence: run the suites, run the `tt` CLI, drive the real
renderer through the QA driver (`packages/gui/qa/` — the `audit-qa` skill has
the driving discipline). A claim settled by observation outranks one settled
by reading; a coverage-row verdict is only confirmed by what the cited test
demonstrably exercises, not by its filename or header comment.

## Phase 3 — judge, verify, file

The operator holds this phase — dedupe across readers, then verify before
filing: re-check every absence claim ("no test covers X", "nothing runs Y")
and every agrees verdict independently — a clearance is worth exactly what
the check behind it is worth — and require file:line evidence on both sides
of every finding.
Every finding carries the same two labels — **Agentic Discovery** (the family
label every discovery instrument applies) plus **Agentic Sync Audit** (the
provenance label, this instrument's alone) — regardless of which of the two
shapes below it takes. This instrument is the one that files both shapes, so
the shape is read from the issue body, never inferred from the label:

- **Behavior drift** → reproduce through the real entry point, then file in the
  bug-report shape with `author-bug-report`. Never file a reading-only hunch
  as a reproduced defect.
- **Doc drift** (either lean) → file in the audit-arch problem shape: the
  problem in one sentence, evidence, stakes, severity and confidence, no
  solution sections.

Findings then ride the normal triage gate
(`triage-issues`); this skill never triages its own findings and never
edits a doc or a line of code to "quickly fix" what it found. Claims checked
and found *in agreement* are a one-line note in the run summary — visible
coverage, never an issue. Close with the summary: surface covered, agreement
noted, findings filed with issue numbers, and anything left unsettled with
what would settle it.

## Definition of done

- [ ] Every doc on the claim surface assigned to a reader; no section skipped
      silently — a beat deliberately left out is named in the summary.
- [ ] Every finding has file:line evidence on both sides and a named
      direction (or is filed as an undecidable disagreement).
- [ ] Behavioral claims settled by observation, not inference; behavior-drift
      findings reproduced through the real entry point.
- [ ] Absence claims independently re-checked before filing.
- [ ] Findings filed in the correct shape, both labels applied; nothing
      triaged, nothing fixed, nothing committed.
- [ ] Run summary delivered: coverage, agreements, findings, unsettled
      residue.
