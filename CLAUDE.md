# Stint — repository guide

Stint is a cross-platform desktop time tracker for one freelancer who bills by
time: an Electron tray app and a CLI (`tt`) as equal surfaces over one local
SQLite database, built as a TypeScript monorepo around a shared `@stint/core`
package.

The repo holds both the **design documents** (the styled HTML below) and the
**implementation** under `packages/` (`core`, `cli`, `gui`), with the
acceptance-criteria apparatus under `acceptance/`, `features/`, and `scripts/`.
See `README.md` for the implementation front door and `acceptance/criteria/COVERAGE.md`
for the full PRD-to-test map. Key commands: `npm run build`, `npm test`,
`npm run judge`, `npm run evidence`, `npm run verify:no-network`.

## Name the idea

Wherever an idea is delivered — an issue, a PR, a doc, a conversation — give it
a handle first: the concept compressed to one plain sentence a reader can hold
and repeat ("docs lie about the apparatus"). Detail hangs off the handle, never
replaces it.

## Sharing rendered HTML

These docs are styled HTML, which renders as raw source when opened directly on
GitHub or mobile. To share a *rendered* page, wrap its raw URL with htmlpreview.
Use a plain `http://` on the **outer** htmlpreview URL — `https://` on the outer
URL is currently broken — while keeping `https://` on the inner raw URL:

```
http://htmlpreview.github.io/?https://raw.githubusercontent.com/kdbanman/stint/<branch>/<file>
```

Example (prd.html on main — the spec docs live under `context/`):

```
http://htmlpreview.github.io/?https://raw.githubusercontent.com/kdbanman/stint/main/context/prd.html
```

When linking a doc that only exists on a feature branch, use that branch name in
place of `<branch>`.

## Files

| File | Description |
|------|-------------|
| `context/` | **The spec.** The styled-HTML specification docs (below). The canonical requirements/context for the project live here. |
| `context/concept.html` | **The why.** Product concept — the idea, the insight ("a running timer is just an open row"), who it's for, and the deliberate non-goals. |
| `context/prd.html` | **The what.** Full product (application) requirements: domain model, architecture, timer/editing/reporting behavior, CLI & GUI specs, schema, settings, edge cases, and the §17 v1 acceptance criteria. |
| `context/glossary.html` | **The words.** Ubiquitous-language glossary — one canonical term per concept, rejected synonyms, key relationships, and resolved terminology ambiguities. |
| `context/design.html` | **The look, made law.** Normative visual spec: the two-layer token system, colour roles, type ramp, spacing grid, component grammar (accent discipline, selection, fields, messages, icons), the WCAG 2.2 AA floors, and the split verification stance (computed checks + rendered comparison). Values live in `design.tokens.json`; the mockups illustrate it. |
| `context/design.tokens.json` | **The values.** W3C DTCG token file — Radix primitive scales + the semantic layer. The single source every generated CSS token block (mockups and `packages/gui/renderer/styles.css`) derives from. |
| `context/architecture.html` | **The shape.** Non-normative architecture overview — consolidates the runtime architecture the PRD spreads across §04/§13/§15/§19/§20 into one place, with topology/write-path/IPC diagrams and the file-level `@stint/core` module map. The PRD still owns the requirements + status; this explains how the pieces fit. |
| `context/acceptance.html` | **The how-we'll-know.** Acceptance-criteria strategy: five complementary AC methods (BDD, property-based, golden/schema, LLM-judged, manual), a PRD-to-method coverage map, and one worked sample per method. |
| `context/process.html` | **The how-it's-built.** Process & verification (SDLC) requirements, distinct from the application requirements: the principles, the agentic process (skills, subagents, model level), doc authoring rules, the automatic-vs-manual inventory, branch/PR/release governance, the specified-vs-convention line, and the process glossary. Binding on agent sessions working this repo. |
| `context/mockups/` | **The spec, illustrated.** Standalone, dependency-free HTML mockups of the GUI views (`timer`, `main`, `reports`, `settings`, `edit-entry`, `clients`, `tray-popover`, `software-update`, `merge-conflict`, `merge-gap`) — illustrations of `context/prd.html` §12 (behavior/layout) and `context/design.html` (style). They show only specified reality; their token blocks are generated from `design.tokens.json`. Keep in sync when GUI requirements change (PRD §18). |
| `context/mockups/design-system.html` | **The system, rendered.** The component sheet illustrating `context/design.html` — swatches per semantic token, type ramp, line-icon set, and component demos. The spec is normative; this page renders it. |
| `README.md` | Implementation front door: layout, quick start, `tt` tour, GUI, and how to run the five AC method suites. |
| `packages/` | `@stint/core` (schema, transitions, invariants, reporting), `tt` CLI, and the Electron GUI. |
| `acceptance/` | The acceptance-criteria apparatus, split in two: `criteria/` (coverage matrix, JSON schemas, JUDGE rubric, MANUAL runbook, parity matrix — **what must hold**) and `evidence/` (generated **proof those criteria hold** — CLI transcript, screenshots, recordings, judge report). |
| `features/` | Gherkin specs run against both surfaces (parity). |
| `LICENSE` | MIT license. |

Read order for newcomers: `context/concept.html` → `context/prd.html` →
`context/glossary.html` → `context/acceptance.html` (with
`context/architecture.html` alongside the PRD for how the pieces fit,
`context/design.html` for the visual system, and
`context/process.html` for how it's built &amp; verified).
