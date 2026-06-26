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

Example (prd.html on main):

```
http://htmlpreview.github.io/?https://raw.githubusercontent.com/kdbanman/stint/main/prd.html
```

When linking a doc that only exists on a feature branch, use that branch name in
place of `<branch>`.

## Files

| File | Description |
|------|-------------|
| `concept.html` | **The why.** Product concept — the idea, the insight ("a running timer is just an open row"), who it's for, and the deliberate non-goals. |
| `prd.html` | **The what.** Full product requirements: domain model, architecture, timer/editing/reporting behavior, CLI & GUI specs, schema, settings, edge cases, and the §17 v1 acceptance criteria. |
| `glossary.html` | **The words.** Ubiquitous-language glossary — one canonical term per concept, rejected synonyms, key relationships, and resolved terminology ambiguities. |
| `acceptance.html` | **The how-we'll-know.** Acceptance-criteria strategy: five complementary AC methods (BDD, property-based, golden/schema, LLM-judged, manual), a PRD-to-method coverage map, and one worked sample per method. |
| `README.md` | Implementation front door: layout, quick start, `tt` tour, GUI, and how to run the five AC method suites. |
| `packages/` | `@stint/core` (schema, transitions, invariants, reporting), `tt` CLI, and the Electron GUI. |
| `acceptance/` | Coverage matrix, JSON schemas, JUDGE rubric, MANUAL runbooks, parity matrix, and generated evidence. |
| `features/` | Gherkin specs run against both surfaces (parity). |
| `LICENSE` | MIT license. |

Read order for newcomers: `concept.html` → `prd.html` → `glossary.html` →
`acceptance.html`.
