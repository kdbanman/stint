# Stint

A cross-platform desktop time tracker for one freelancer who bills by time. An
Electron **tray app** and a **`tt` CLI** are equal surfaces over one local SQLite
database, built as a TypeScript monorepo around a shared `@stint/core` package. It
runs entirely offline; the unit is time, and no money lives in the app.

> The design lives in the styled HTML docs under [`context/`](context/) — read
> order: [`concept.html`](context/concept.html) → [`prd.html`](context/prd.html) →
> [`glossary.html`](context/glossary.html) → [`acceptance.html`](context/acceptance.html),
> then [`process.html`](context/process.html) for how it's built &amp; verified. This
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
methods from [`context/acceptance.html`](context/acceptance.html). The full map is
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

## License

MIT — see [`LICENSE`](LICENSE).
