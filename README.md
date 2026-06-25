# stint

A quiet, native macOS time tracker for one freelancer who bills by time — a
menu-bar app and a CLI (`tt`) as **equal surfaces** over one local SQLite
database. See [`concept.html`](concept.html), [`prd.html`](prd.html),
[`glossary.html`](glossary.html), and [`acceptance.html`](acceptance.html) for
the full design.

This repository is being built one thin vertical slice at a time.

## Implemented slice: the running-timer keystone

> *A running timer is just an open row.* — concept.html §02

The first slice implements the conceptual heart of the product — `start`,
`stop`, `status` — through **both** surfaces, over one SQLite file, enforcing
the cardinal invariant: **at most one entry is ever open.**

```
$ tt start "auth refactor"
▸ started · "auth refactor"

$ tt status
▸ running 01:24:07 · "auth refactor"

$ tt stop
■ stopped · 1h 24m
```

The menu-bar app (SwiftUI `MenuBarExtra`) shows the same running timer counting
up and offers one-click Start/Stop. Neither surface owns the logic: both import
the shared `StintKit` core and read/write the same file, so `tt start` from a
terminal surfaces in the menu bar within a second, and vice versa.

## Layout

| Path | Role |
|------|------|
| `Sources/StintKit` | **The shared core.** Schema, `Entry`, and the `Store` that owns every state transition and the single-open-entry invariant (enforced both transactionally and by a unique index). Pure Swift + GRDB; runs on Linux and macOS. |
| `Sources/tt` | **The CLI.** `tt start/stop/status`, human tables by default and `--json` for scripting. |
| `Sources/StintApp` | **The menu-bar app.** SwiftUI `MenuBarExtra` (macOS-only) over the same core. |
| `Tests/StintKitTests` | `PROP` invariant properties + `BDD` behavioural flows. |
| `Tests/ttTests` | `GOLD` golden tests pinning the `tt` contract byte-for-byte. |

## Build & test

Requires a Swift 5.9+ toolchain. On Linux, install SQLite headers first
(`apt-get install -y libsqlite3-dev`).

```sh
swift build
swift test
./scripts/demo.sh   # a scripted, deterministic tt session
```

On macOS, `swift build` additionally builds the `StintApp` menu-bar target.

## How the acceptance criteria are met

Following [`acceptance.html`](acceptance.html)'s method set, this slice is
verified by executable criteria that run in CI on every push (Linux + macOS):

| Method | Where | Proves |
|--------|-------|--------|
| **PROP** | `InvariantPropertyTests` | At most one open entry under *any* start/stop sequence (§17 R2), enforced in the core **and** structurally rejected by the DB. |
| **BDD** | `StoreFlowTests` | start / stop / status flows and "start while running closes the first" (§05, §16), stepped on the core. |
| **GOLD** | `CLIGoldenTests` | The exact `tt` stdout, exit codes, and `--json` shape (§11, acceptance §08), driven as a black box with a pinned clock. |

Parity (§17 R8) for this slice: every capability the menu-bar app exposes
(start, stop, observe status) is reachable from `tt`, because both are thin
shells over the identical `StintKit.Store`.
