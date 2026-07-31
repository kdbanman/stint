# Reference — `Agentic Arch Audit` findings

Loaded by `triage-discoveries`. Facts only: what the finding is, which doc owns
it, where its proof of fix lives. The procedure is in `SKILL.md`.

## Finding shape

A confirmed problem in one of the four systems that carry the requirements —
the code, the verification apparatus, the SDLC/process, the `context/` docs as
artifacts. The problem in one sentence, evidence (file:line, doc §, commit),
stakes argued in both directions, severity and confidence. Problem capture
only: nothing about the fix is decided.

Never about the product's requirements themselves — an arch audit's charter is
to preserve them.

## Owning doc

`context/process.html` for process-shaped findings — it is the PRD of the
apparatus, and many findings are violations of its §02 principles.
`context/prd.html` for product-shaped ones. `context/acceptance.html` +
`acceptance/criteria/COVERAGE.md` when the finding lands in the AC apparatus.

The common category here is **`needs new requirement or AC`** in its second
sense: recording an accepted decision whose rationale exists nowhere.

## Where the proof of fix lives

| Kind of finding | Proof |
|---|---|
| apparatus gap — a claim nothing checks | The new or strengthened check that **binds the claim**, following the repo's bind-two-homes-or-fail-loud pattern (`parity.test.ts`, `judge-bind.test.ts`, `build-matrix.test.ts`, `meta-docs.test.ts`), plus which `context/process.html` §05 row it joins. |
| unrecorded decision | The doc § that will record it — named exactly, not "document this." |
| structural | The test or binding that makes the drift class **impossible**, or the deletion-test claim that will hold after the change. |
| process design with no code surface | Often no gate exists to build. Say so plainly in the proof-of-fix plan rather than inventing a check; the orchestrator's review is the catch. |

A finding whose fix modifies a gate carries the self-reference flag (see
`SKILL.md`) — common in this stream, since apparatus gaps are usually closed by
editing the apparatus.
