# Reference — `Agentic Design Audit` findings

Loaded by `triage-discoveries`. Facts only: what the finding is, which doc owns
it, where its proof of fix lives. The procedure is in `SKILL.md`.

## Finding shape

A confirmed violation of the visual spec: the problem in one sentence, the
violated rule id (D01–D17, A01–A06) or checklist item, evidence (screenshot,
measurement, file:line), severity and confidence. Problem capture only.

Two shapes an audit deliberately does **not** send here:

- **Opportunities** — the spec is satisfied but the design could be better.
  They append to the standing *Design opportunities* issue, never as defects.
  If one reaches triage as a defect, route it back rather than triaging it.
- **Accepted deviations the spec should record** — filed as a spec gap against
  `context/design.html`, which makes them `needs new requirement or AC`.

## Owning doc

`context/design.html` — the normative visual spec; every finding already cites
its rule id. `context/design.tokens.json` holds the values.
`acceptance/criteria/STATES.md` is the state matrix an audit walks.
`context/prd.html` §12/§18 owns GUI behavior and layout, so a finding that is
really about *what the surface does* is a product finding wearing a design
finding's clothes — categorize it against the PRD.

Because the rule id is cited, the category is usually **`has requirement or AC
already`**: the rule exists and the renderer violates it.

## Where the proof of fix lives

The split is `context/design.html` §08's own: what a computed check can prove
exactly, versus what only a rendered comparison can judge.

| Kind of finding | Proof |
|---|---|
| token bypass, raw palette hex, contrast floor, spacing grid, text-size floor, placeholder colour, `faint`-as-text | `packages/gui/test/design-guard.test.ts` — the computed checks (D01/D02, D04, D06/D07, D13, A01/A02, A06). A new rule of this kind joins that file and its §05 row. |
| composition, hierarchy, alignment, state handling — anything judged by eye | A **JUDGE** scene: `packages/gui/judge/record.mjs` + `run-judge.mjs`, rubric row in `acceptance/criteria/judge-rubric.md`. `judge-bind.test.ts` binds row ↔ scene both directions. |
| a mockup that no longer depicts the spec | The mockup under `context/mockups/` (PRD §18 keep-in-sync duty); its token block regenerates from `design.tokens.json`. |

**The trap:** never propose pinning an implementation value in a source
assertion — exact px, a hex, a token on a named selector. `context/process.html`
§02 bans it: such pins fight every restyle and prove only that the code matches
itself. The narrow computed slice above is the sanctioned exception, because
those checks prove the rule rather than the code.
