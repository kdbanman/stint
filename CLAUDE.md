# Stint — repository guide

Stint is a cross-platform desktop time tracker for one freelancer who bills by
time: an Electron tray app and a CLI (`tt`) as equal surfaces over one local
SQLite database, built as a TypeScript monorepo around a shared `@stint/core`
package.

The repo holds both the **design documents** (the styled HTML below) and the
**implementation** under `packages/` (`core`, `cli`, `gui`), with the
acceptance-criteria apparatus under `acceptance/`, `features/`, and `scripts/`.
See `README.md` for the implementation front door and `acceptance/COVERAGE.md`
for the full PRD-to-test map. Key commands: `npm run build`, `npm test`,
`npm run judge`, `npm run evidence`, `npm run verify:no-network`.

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
| `context/acceptance.html` | **The how-we'll-know.** Acceptance-criteria strategy: five complementary AC methods (BDD, property-based, golden/schema, LLM-judged, manual), a PRD-to-method coverage map, and one worked sample per method. |
| `context/process.html` | **The how-it's-built.** Process & verification (SDLC) requirements — properties the build/CI/acceptance apparatus must satisfy, distinct from the application requirements. A seed; fuller spec tracked in issue #19. |
| `context/mockups/` | **The look.** Standalone, dependency-free HTML mockups of the GUI views (`main`, `reports`, `edit-entry`, `settings`) — design intent for `context/prd.html` §12/§18. "Slightly noisy": they show more than ships today. Keep in sync with the PRD when GUI requirements change (PRD §18). |
| `README.md` | Implementation front door: layout, quick start, `tt` tour, GUI, and how to run the five AC method suites. |
| `packages/` | `@stint/core` (schema, transitions, invariants, reporting), `tt` CLI, and the Electron GUI. |
| `acceptance/` | Coverage matrix, JSON schemas, JUDGE rubric, MANUAL runbooks, parity matrix, and generated evidence. |
| `features/` | Gherkin specs run against both surfaces (parity). |
| `LICENSE` | MIT license. |

Read order for newcomers: `context/concept.html` → `context/prd.html` →
`context/glossary.html` → `context/acceptance.html` (then `context/process.html`
for how it's built &amp; verified).
