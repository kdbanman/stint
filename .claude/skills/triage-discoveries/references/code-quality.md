# Reference — `Agentic Code Quality Audit` findings

Loaded by `triage-discoveries`. Facts only: what the finding is, which doc owns
it, where its proof of fix lives. The procedure is in `SKILL.md`.

## Finding shape

A module-level problem in the implementation or the tests: the handle in one
sentence, evidence (file:line — **both sites** for a consistency finding),
numbers where they exist (callers, line counts, commit counts), why it costs,
severity and confidence. Problem capture only. Over-delivery findings name the
deletion, not a redesign.

Never about what the product should do — the charter is how the code is
written.

## Owning doc

`context/engineering.html` — §02's vocabulary (module, interface, depth, seam,
shallow), §03's quadrants and balance rules, §04's recorded conventions, §07's
comment convention. Use that vocabulary in the comment; don't drift into
"component," "service," "layer."

Note the tier: `context/process.html` §08 puts everything in engineering.html
at **convention** tier except its one test-integrity requirement. A violated
convention is still `has requirement or AC already` for categorization
purposes — the doc governs it — but the routing verdict should weigh that
violating a convention is visible and cheap to reverse.

## Where the proof of fix lives

This is the stream where "add a test" is most often the *wrong* answer.
Most findings are proven by the change itself, not by a new guard:

| Kind of finding | Proof |
|---|---|
| depth — shallow module, pass-through, entangled pair, information leakage | The **deletion or merge** itself: name the module that stops existing, or the one decision that ends up spelled in one place. The existing suite passing unchanged is the proof the behavior held. |
| consistency — the same thing done two ways | The second site converged on the first, both cited. Where the pattern is worth binding, a lint rule or a static check that fails the next divergence. |
| wrong abstraction | The §02 re-inline exit taken, with the accreted parameters and per-caller conditionals gone. |
| over-delivery — capability with no caller | The deletion, named exactly. A guard here would be upkeep for a defect that costs less than the guard (§03). |
| test quality — quadrant misplacement, tautological / change-detector / mock-asserting test | The test moved, rewritten to assert an outcome, or deleted. A deleted test needs the argument for why nothing is lost. |
| missing test where §03's table demands one | The real file in the right AC method — see `acceptance/criteria/COVERAGE.md` and `context/acceptance.html` for the routing. |
| comment — narrating noise, or a non-obvious decision with no rationale | The comment deleted, or written at the decision site per §07. |

**The trap:** a finding in cold code. Depth problems only cost where change
happens, so if the audit weighted by `git log` hot spots and this one still
came from cold code, the issue must carry the argument for why it matters
anyway. If it doesn't, that is a fix-direction question for the owner — the
honest option is closing it as an accepted decision.
