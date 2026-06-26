# Stint

A cross-platform desktop time tracker for one freelancer who bills by time. An
Electron **tray app** and a **`tt` CLI** are equal surfaces over one local SQLite
database, built as a TypeScript monorepo around a shared `@stint/core` package. It
runs entirely offline; the unit is time, and no money lives in the app.

> The design lives in the styled HTML docs at the repo root — read order:
> [`concept.html`](concept.html) → [`prd.html`](prd.html) →
> [`glossary.html`](glossary.html) → [`acceptance.html`](acceptance.html). This
> README is the implementation's front door.

## The keystone idea

There is no timer object ticking somewhere. **A running timer is simply the one
entry whose `end` is still null.** "Running" is a row state, not a process, and
elapsed time is always *derived* (`now − start`), never stored or incremented. That
single insight is what makes "the terminal and the window both control the live
timer" a non-problem: both surfaces just read and write the same row through
`@stint/core`.

## Layout

```
packages/
  core/   @stint/core — schema, every state transition, invariants, reporting,
          rounding, the check-in cadence. The single source of truth.
  cli/    tt — the command-line surface (commander), --json everywhere.
  gui/    Electron tray app + main window; renderer is an equal surface over IPC.
features/      Gherkin specs, run against BOTH surfaces (parity).
acceptance/    Coverage matrix, JSON schemas, JUDGE rubric, MANUAL runbooks,
               and generated evidence (verbatim CLI transcript + screenshots).
scripts/       Evidence generator and the no-network backstop.
```

One core, one file, two thin shells (PRD §04): a single SQLite file in **WAL mode**;
all reads and writes go through `@stint/core`; every write is one transaction under
`BEGIN IMMEDIATE` with a busy timeout, so the CLI and the running app cooperate.

## Requirements

- **Node ≥ 22.5** — persistence is the built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html),
  no native build step. The GUI needs an Electron whose bundled Node is ≥ 22.5
  (Electron 35+); this repo pins Electron 42.

## Quick start

```sh
npm install
npm run build
node packages/cli/dist/bin.js status   # or: npm run tt -- status
```

The database resolves to `$TT_DB` if set, else the per-OS app-data directory
(`~/.local/share/stint/timetracker.sqlite` on Linux, `~/Library/Application Support`
on macOS, `%APPDATA%` on Windows). Both surfaces resolve the same path. Backup = copy
the file; export = `tt export`. No network, ever.

### `tt` tour

```sh
tt start "auth refactor" --client "Client A" --project API --tag deep
tt status                       # ▸ running 01:24:07 · "auth refactor" · Client A / API
tt stop
tt add "spec review" --from 13:00 --to 14:30 --client "Client A"
tt list --week
tt report --week --by client --round 15
tt export --month --csv -o june.csv
tt sleep ls                     # review slept-through entries
tt sleep subtract 42            # exclude slept time (reversible)
tt status --json                # scripting contract; --json on every read command
```

Time arguments accept absolute (`14:30`, `2026-06-24T14:30`) and relative (`-90m`,
`-1h30m`) forms. Read commands exit `0`; refusals and errors exit non-zero.

### GUI

```sh
npm run build
npm run gui     # requires an Electron binary (see Requirements)
```

A tray/menu-bar timer counts up; one click stops, switches, or starts. A global
hotkey (`Ctrl+Alt+T`) toggles from anywhere. The main window groups entries by day
with flags in context, and a report builder with CSV/JSON export.

## Testing & acceptance

No single notation verifies the whole PRD well, so Stint uses the five complementary
methods from `acceptance.html`. The full map is
[`acceptance/COVERAGE.md`](acceptance/COVERAGE.md).

| Method | Proves | Run |
|--------|--------|-----|
| **BDD** (Gherkin) | User flows, in ubiquitous language, against **both** surfaces | `npm run test:bdd` |
| **PROP** (fast-check) | The money-affecting laws over thousands of inputs | `npm run test:prop` |
| **GOLD** (snapshots + JSON-Schema) | The exact CLI/CSV/JSON contract | `npm run test:gold` |
| **JUDGE** (Playwright + rubric) | Subjective GUI qualities over real screenshots | `npm run judge` |
| **MANUAL** ([runbook](acceptance/manual/runbook.md)) | Real sleep/wake, cadence, no-network, tray/hotkey | by hand |

```sh
npm test                 # PROP · GOLD · BDD · integration · parity (one command)
npm run judge            # captures GUI screenshots, scores the JUDGE rubric
npm run evidence         # regenerates acceptance/evidence/cli-transcript.md
npm run verify:no-network
```

The BDD suite runs each `.feature` against `@stint/core` **and** the built `tt`
binary, which is how the full-parity claim (§17 R8) is proven without a second copy
of the spec. The `acceptance/parity-matrix.json` (asserted complete) maps every GUI
capability to its `tt` command.

### Evidence in this repo

- [`acceptance/evidence/cli-transcript.md`](acceptance/evidence/cli-transcript.md) —
  verbatim `tt` output, organised by the §17 acceptance criteria.
- [`acceptance/evidence/screenshots/`](acceptance/evidence/screenshots/) — the real
  rendered GUI (empty state, running popover, flags in context).
- [`acceptance/evidence/judge-report.json`](acceptance/evidence/judge-report.json) —
  per-rubric PASS/FAIL with justifications.

## Driving PRD coverage (Claude Code workflow)

Every requirement in [`prd.html`](prd.html) carries a status badge — `implemented`,
`partial`, or `todo` (see §17). To close the open ones systematically there is a
[Claude Code](https://code.claude.com/docs/en/workflows) **workflow** at
[`.claude/workflows/stint-prd-coverage.js`](.claude/workflows/stint-prd-coverage.js).
It orchestrates a fleet of subagents through seven phases:

1. **Inventory** — parse `prd.html`'s status fields + `COVERAGE.md` into a work-list of every `todo`/`partial` requirement.
2. **Plan** — one agent per requirement returns its exact file set + implementation/AC/evidence plan.
3. **Implement** — schedule packages into dependency-ordered, **file-disjoint waves** (so parallel agents never edit the same file); each wave is build/test-verified with a bounded repair loop.
4. **Cover** — extend the five AC methods plus `parity-matrix.json` and the `COVERAGE.md` index.
5. **Evidence** — regenerate everything (`build`, `test`, `verify:no-network`, `judge`, `evidence`).
6. **Verify** — adversarial completeness critics, one per requirement, defaulting to *incomplete* unless implemented **and** covered by a passing AC **and** reflected in evidence; loop-until-dry repair.
7. **Finalize** — flip the proven requirements' badges to `implemented`, refresh `COVERAGE.md`, and do a final green check.

### Invoking it in Claude Code

The workflow is opt-in (it spawns many agents and edits the repo), so you ask Claude to run it:

```text
use a workflow to run stint-prd-coverage
```

Once Claude has run it once you can save it as a slash command and invoke it as
`/stint-prd-coverage`. Watch live progress — phases, agents, token spend — with `/workflows`;
pause/resume and stop individual agents from there. A paused run resumes within the same
session with completed agents cached.

### Scoping a run with `scopeTo`

A full sweep is large. Pass **`args`** to scope a run to a subset of requirements — for a
cheap calibration pass, or to stage coverage as a sequence of small, reviewable runs (there is
no mid-run input, so each scoped run completes and you review the diff before the next):

```text
use a workflow to run stint-prd-coverage scoped to ["§09 search", "§12 R8"]
```

`args` may be a string, an array of strings, or `{ scopeTo: [...] }`. Each token is matched
case-insensitively as a substring against `"<reqId> <section> <title>"`, so `"§12 R8"`,
`"search"`, and `"settings"` all select requirements. Omit `args` for the full sweep — which is
also the right final step, letting the completeness critics re-check the whole PRD and flip any
remaining badges. A staged, dependency-ordered sequence to reach full coverage is in the PR that
introduced this workflow.

## License

MIT — see [`LICENSE`](LICENSE).
