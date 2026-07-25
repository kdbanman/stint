# Requirements transition — the design layer (work-list)

**Status: ACTIVE TRANSITION.** Single source of truth for the in-progress
requirements change that introduces the **design layer**: the normative visual
spec (`context/design.html`), the token source of truth
(`context/design.tokens.json`), the UI state inventory
(`acceptance/criteria/STATES.md`), WCAG-checkable floors in the acceptance
apparatus, and app/mockup conformance. The handle: **the look, made law**.

The `requirements-transition` skill (`.claude/skills/requirements-transition/SKILL.md`)
consumes this file to plan, implement, verify, review, and gather evidence,
then aggregates into one PR.

**Lifecycle.** When every requirement here has passing verification evidence,
the old→new swap runs: the `*-old.html` docs and **this file** are deleted.
Until then both sets coexist.

---

## 0. How the transition consumes this file

Each requirement row carries:

- **ID** — stable handle. Design rules use `design.html` ids (`D01`–`D17`,
  `A01`–`A06`). Existing requirements keep their `§NN Rmm` id.
- **Change** — `NEW` · `MODIFIED` · `DELETED`.
- **Core** — `●` if core (§C). None here — see §C.
- **Surfaces** — `core` / `cli` / `gui` (plus `docs`, `mockups`, `scripts` where
  the surface is the apparatus itself).
- **Files** — the implementation surface an agent will touch.
- **Mockup** — the mockup(s) depicting it (every NEW/MODIFIED GUI req maps to ≥1).
- **AC** — BDD · PROP · GOLD · JUDGE · MANUAL.
- **Rec** — `▶` if a screen recording is required in PR QA evidence (§W).

§V's divergence resolutions are requirement rows too: each V-row is MODIFIED,
surfaces `gui`+`mockups`, AC JUDGE, and is planned/implemented/verified like
any §2 row (mock-side V-rows were landed at authoring time; app-side V-rows —
V3, V5, V7, V8 — are the transition's).

---

## 1. Global decisions (grill outcomes)

| # | Decision |
|---|----------|
| G1 | The palette **evolves** in this transition; significant redesign opportunities go to the standing **Design opportunities** issue, not into scope. |
| G2 | New normative `context/design.html` owns the visual system. PRD §12 keeps behavior/layout topology and delegates visuals; `mockups/design-system.html` is demoted to a generated-and-checked illustration. |
| G3 | The transition brings `packages/gui` into conformance with every **specified** rule; residual subjective polish belongs to the `design-audit` skill's first run after merge. |
| G4 | New `.claude/skills/design-audit/` skill (arch-review sibling): adversarial audit → owner grilling → one issue per confirmed problem, labeled **Agentic Design Review Discovery**. The distilled source corpus lives in the skill's references, not in `context/`. |
| G5 | Two-layer DTCG `context/design.tokens.json` (Radix primitive scales + semantic aliases; the app-side names `wash`/`rule`/`flag` are canonical). `scripts/gen-tokens.mjs` writes the marked CSS block in every mockup and `styles.css`; a guard test asserts parity and stays wired. |
| G6 | Dark mode **out of scope**; tracked in the opportunities issue; no dark token ships before the whole mode does (D03). |
| G7 | Verification stance splits: rendered comparison (JUDGE) for composition; computed checks for token parity, contrast, reduced-motion. The "never assert CSS in code" doctrine is deleted. |
| G8 | 4px grid redefined **spacing-only** (padding/gap/margin; heights free), enforced (D07); off-grid spacing retuned. |
| G9 | `acceptance/criteria/STATES.md`: per-view × state matrix (ideal/empty/error/edge; loading N/A once). Every cell evidenced or waived. States are apparatus, **not** new GUI requirements. |
| G10 | WCAG 2.2 AA floors are binding (A01–A06). Consequences accepted: former `--faint` text becomes `muted` or disabled-styled; warn text darkens to amber·12. |
| G11 | "Slightly noisy" doctrine ends: mocks show only specified reality (PRD §18 rewrite). `sleep-review.html` retired; phantom flourishes stripped; the desirable ones logged in the opportunities issue. |
| G12 | Composition divergences resolved **by rule** (D11/D12/D06); each resolution is a §V row, vetoable at PR review. JUDGE-pinned implementation values win where no rule decides. |
| G13 | Palette = **Radix light scales wholesale**: sand / tomato / red / grass / amber. Notable consequence: the accent-filled primary uses tomato·11 (white label 5.0:1); tomato·9 is the non-text signal. |
| G14 | One standing **Design opportunities** GitHub issue collects deliberate candidates (dark mode; per-client/tag usage counts; range-total chip; sidebar week-stat block; popover Quit). |
| G15 | Anti-bloat: `design.html` carries decided rules + one-line attributions only; corpus and checklists live in the `design-audit` skill. |
| G16 | **CLI parity waived for the design layer** — visual-only, GUI-by-nature (PRD §17 R8 untouched for behavior). No schema impact. |

---

## C. Core requirement classification

Definition unchanged (integrity / loss-protection / core data entry).
**No requirement in this transition is core.** Explicitly considered and
excluded: visual conformance, contrast floors, and state coverage are
look-and-legibility concerns — they cannot drop, corrupt, or fail to persist
data, and touch no entry path. Existing core labels are untouched.

---

## 2. Section-by-section changes

### New doc — `context/design.html` (all rows NEW unless noted)

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|----|--------|:----:|----------|---------|-------|--------|----|----|
| D01 | NEW | | docs/gui/mockups | Two-layer tokens; surfaces reference semantic tokens only; raw hex in a surface is a defect. | `context/design.tokens.json`, `styles.css`, `context/mockups/*` | `design-system.html` | GOLD | |
| D02 | NEW | | scripts/gui/mockups | Generator writes marked token blocks; guard test asserts parity + stays wired. | `scripts/gen-tokens.mjs`, guard test, `styles.css`, `context/mockups/*` | `design-system.html` | GOLD | |
| D03 | NEW | | docs | Light-only; dark is tracked, never partial. | `context/design.html` | — | — | |
| D04–D05 | NEW | | gui/mockups | Colour roles per token table; semantic colour always paired with word/icon. | `styles.css`, all mockups | `design-system.html` | GOLD/JUDGE | ▶ |
| D06 | NEW | | gui/mockups | Type ramp; clocks mono/tnum 22–38px (impl values win — §V2). | `styles.css` | `design-system.html`, `timer.html` | JUDGE | ▶ |
| D07 | NEW | | gui/mockups | Spacing-only 4px grid; off-grid padding/gap/margin retuned (e.g. field `8px 11px` → `8px 12px`). | `styles.css`, all mockups | `design-system.html` | GOLD/JUDGE | |
| D08–D09 | NEW | | gui/mockups | Radius trio; one elevation ladder, depth-not-tint. (Existing practice, now normative.) | `styles.css` | `design-system.html` | JUDGE | |
| D10 | NEW | | gui | Motion ~120ms, meaningful only; `prefers-reduced-motion` collapses transitions. | `styles.css` | `design-system.html` | GOLD/JUDGE | |
| D11 | NEW | | gui/mockups | Accent discipline: ≤1 accent-solid primary per view; clickable text = neutral button treatment. Per-view primaries in §V. | `styles.css`, renderer views | `design-system.html`, per-view mocks | JUDGE | ▶ |
| D12 | NEW | | gui/mockups | Selection ≠ accent — raised-chip idiom everywhere **including the nav rail** (active item = lifted chip + accent icon, ink label). | `styles.css`, `index.html` | all view mocks | JUDGE | ▶ |
| D13 | NEW | | gui/mockups | One field idiom; focus ring; visible labels; placeholders `muted`. | `styles.css` | `design-system.html`, `edit-entry.html` | JUDGE | |
| D14–D15 | NEW | | gui/mockups | Pills/tags semantics; warn vs err message palettes. (Existing practice, now normative; warn text → amber·12.) | `styles.css` | `design-system.html` | JUDGE | |
| D16 | NEW | | gui/mockups | One line-icon family; icon-only affordances use `muted` + accessible name (ops-chip icons move off `faint`). | `styles.css`, renderer | `main.html` | JUDGE | |
| D17 | NEW | | docs | Split verification stance (computed + rendered). | `context/design.html`, `context/process.html` | — | — | |
| A01–A02 | NEW | | gui | Contrast floors 4.5:1 text / 3:1 non-text, computed over permitted token pairs. | guard test | `design-system.html` | GOLD | |
| A03–A05 | NEW | | gui | Target ≥24px; focus visible; colour never sole signal. | `judge-rubric.md` scenes, renderer fixes | `design-system.html` | JUDGE | ▶ |
| A06 | NEW | | gui | Reduced-motion honored. | `styles.css`, guard test | — | GOLD | |

### §V — Divergence resolutions (G12; each row vetoable at review)

| # | Divergence (mock vs impl) | Winner | Rule | Files |
|---|---------------------------|--------|------|-------|
| V1 | Nav rail 212px vs 168px | **impl 168px** | JUDGE-pinned | mocks update |
| V2 | Timer clock 46px sans ink vs 38px mono | **impl** (mono/tnum, 38px; strip clock 22px) | D06 | mocks update |
| V3 | Picker "me" block: outline+weak fill vs solid accent | **mock** | D11 (solid accent = primary action only) | `styles.css` |
| V4 | Picker geometry 32px/hr·44px gutter vs 30px/hr·52px | **impl** | JUDGE-pinned | mocks update |
| V5 | Merge bar: selbar + count pill + neutral Merge vs accent card below | **mock** | D11 (Entries' primary is Add Entry Manually) | `styles.css`, `index.html`, `app.js` |
| V6 | "New report" neutral vs accent-solid | **impl** (accent-solid; Reports' create is its primary) | D11 | `reports.html` mock updates |
| V7 | Nav active accent-weak fill vs (same both) | **neither** — new raised-chip idiom | D12 | both update |
| V8 | `--ink-soft` (impl-only token) | **retired** — folds into `ink`/`muted` | D01 | `styles.css` |
| V9 | Mock flourishes: week-stat block, range-total chip, popover Quit ×, per-client/tag counts | **stripped** | G11 | mocks update; logged in opportunities issue |

### PRD (`context/prd.html` → new; legacy at `context/prd-old.html`)

| ID | Change | Core | Summary | Files | Mockup | AC |
|----|--------|:----:|---------|-------|--------|----|
| §12 R19 | MODIFIED | | Keyboard/focus & accent discipline now delegate to `design.html` D11–D13/A04 (was "§15"). | `context/prd.html` | — | JUDGE (existing) |
| §15 clickability | MODIFIED | | The clickability bullet keeps the behavioral consequence; the accent rule itself now has one home — design.html D11. | `context/prd.html` | — | JUDGE (existing) |
| §18 | MODIFIED | | Rewritten: mocks match the spec exactly (no "slightly noisy"); read-order + table updated; `design.html`/tokens named; `sleep-review.html` row removed. | `context/prd.html` | — | — |
| §18 sleep-review row | DELETED | | The standalone sleep-review surface was resolved into the editor (§12 R10); its mockup is retired. | `context/mockups/sleep-review.html` (delete) | — | — |

### Acceptance (`context/acceptance.html` → new; legacy at `context/acceptance-old.html`)

| ID | Change | Core | Summary | Files | Mockup | AC |
|----|--------|:----:|---------|-------|--------|----|
| acceptance | MODIFIED | | Add the state inventory (STATES.md) and computed style checks to the toolkit map; route `design.html` rules to GOLD (computed) + JUDGE (rendered). | `context/acceptance.html` | — | — |
| STATES.md | NEW | | Per-view × state matrix, every cell evidenced or waived; `TODO(transition)` cells closed by this transition. | `acceptance/criteria/STATES.md`, `COVERAGE.md` | — | (meta) |
| judge-rubric | MODIFIED | | Scenes for D11/D12 accents, A03 targets, A04 focus, A05 pairing; screenshot baselines regenerated on the new palette. | `acceptance/criteria/judge-rubric.md`, evidence | — | JUDGE |

### Glossary / Architecture / Process / front doors

| ID | Change | Core | Summary | Files | Mockup | AC |
|----|--------|:----:|---------|-------|--------|----|
| glossary | MODIFIED | | New canonical terms: **design token**, **scale step**, **semantic token**, **accent discipline**, **state inventory**, **design spec** (rejected: theme, style guide as doc names). | `context/glossary.html` | — | — |
| architecture | MODIFIED | | Token pipeline (tokens.json → generator → marked blocks) added to the file-level module map; non-normative rendering of D01/D02. | `context/architecture.html` | — | — |
| process | MODIFIED | | Visual-verification principle updated to the split stance (G7); `design-audit` added to the skills inventory; targeted in-place edits (no rename). | `context/process.html` | — | — |
| CLAUDE.md / README | MODIFIED | | `design.html` + `design.tokens.json` rows in the files table; read order gains design.html; token-generation command in README. | `CLAUDE.md`, `README.md` | — | — |
| design-audit skill | NEW | | Process artifact (G4); authored in this change, exercised after merge. | `.claude/skills/design-audit/` | — | — |

---

## W. Screen-recording QA evidence (tail stage)

Scope = every `Rec ▶` row: the app-wide restyle demonstrated as one guided tour
per view (Timer idle+running, Entries incl. edit/merge-bar, Clients, Reports,
Settings, tray popover), plus close-ups of the changed idioms — nav selection
(D12/V7), merge bar (V5), picker "me" block (V3). Recordings land under
`acceptance/evidence/recordings/`, indexed by rule id, per the qa-gif-authoring
skill.

## R. Review stages

The two standing reviews (per the transition skill): **AC-evidence-sufficiency**
(every D/A row implemented ∧ covered ∧ reflected in regenerated evidence —
including every `TODO(transition)` cell in STATES.md closed) and
**code-quality & architecture** (the generator and guard are code; deletion
test applies). Both loop into a bounded improvement pass before recordings.

## Z. Swap / cleanup at completion

- Delete `context/prd-old.html`, `context/acceptance-old.html`,
  `context/glossary-old.html`, `context/architecture-old.html`.
- Delete `context/mockups/sleep-review.html` (already removed in authoring —
  verify gone).
- Delete **this file** (`requirements-transition.md`).
- Ensure `CLAUDE.md`, `README.md`, `acceptance/criteria/COVERAGE.md`, and
  `context/prd.html` §18's table reference only the new docs and the surviving
  11 mockups.

The human gate is the **PR merge**.
