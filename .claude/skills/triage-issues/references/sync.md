# Reference — `Agentic Sync Audit` findings

Loaded by `triage-issues`. Facts only: what the finding is, which doc owns
it, where its proof of fix lives. The procedure is in `SKILL.md`.

## Finding shape

The one instrument that files **two** shapes under a single provenance label,
so read the shape from the body, never from the label:

- **Bug-report shape** — behavior drift reproduced through the real entry
  point. Triage it exactly like a `audit-qa` finding; `references/qa.md` names
  the guard homes.
- **Problem shape** — stale doc text, either lean. Triage it like an
  `audit-arch` finding; `references/arch.md` names the guard homes.

Every finding also names its **direction**, which is the fact triage acts on:

| Direction | What it means | Category tendency |
|---|---|---|
| **stale-optimistic** | The doc claims more than the tree holds — a phantom §05 check, a "covered" row whose test proves less than the requirement. A false green in prose. | Usually `has requirement or AC already`: build what the doc claims. |
| **stale-pessimistic** | The doc claims less — an open "gap" a merged issue closed, a shipped requirement described as unbuilt. | Usually `no requirement needed`: correct the text. |
| **behavior drift** | The doc is right, the tree diverged. A product defect wearing a doc defect's clothes. | Route as a product finding, not a doc one. |
| **undecidable** | Text and tree disagree and either could reasonably move. Filed as the disagreement itself. | **The owner decides which side moves**, and the category follows. This is the fix-direction question, and the audit deliberately left it open — it is triage's to close, never to guess. |

## Owning doc

Whichever doc carries the drifting claim — that is what the finding cites on
the doc side. `context/process.html` §05 for inventory claims,
`acceptance/criteria/COVERAGE.md` for coverage-row verdicts,
`context/acceptance.html` for method routing, `context/architecture.html` for
module shape, `context/prd.html` for requirement text, `context/glossary.html`
and process.html §09 for vocabulary, `CLAUDE.md` / `README.md` for the front
doors.

## Where the proof of fix lives

Correcting the text is necessary and never sufficient — the text was correct
once. **The proof is what stops it drifting again**, and the sync audit's whole
premise is that hand-synced prose does drift:

| Kind of finding | Proof |
|---|---|
| a machine-decidable claim with no check | The check, in `packages/gui/test/meta-docs.test.ts` or beside it — the audit's charter says a *missing* static check for a machine-decidable claim is itself a finding, so this is the common case. |
| a judgment claim that cannot be machine-checked | The corrected text, plus the honest statement that nothing binds it. Say so rather than inventing a check that cannot prove the claim. |
| a copy class not yet in the fan-out inventory | The new row in `context/process.html` §06's intent fan-out table, classed kept / bound / unbound / gone. A copy class absent from that table is drift by construction. |
| behavior drift | Per `references/qa.md` — the guard goes where the *behavior* lives, not where the doc does. |
