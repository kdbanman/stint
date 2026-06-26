# Acceptance coverage matrix

How every PRD requirement and every §17 acceptance criterion is proven, mapped to
the five methods of `acceptance.html` (BDD · PROP · GOLD · JUDGE · MANUAL) and the
exact files that carry the proof. Primary method in **bold**.

Run it all: `npm run build && npm test && npm run judge && npm run evidence`.

## The five methods → where they live

| Method | What it proves | Location |
|--------|----------------|----------|
| **BDD** | User-observable flows, in ubiquitous language, run against **both** surfaces | `features/*.feature`, `packages/core/test/bdd/` |
| **PROP** | Invariants over generated inputs (the money-affecting laws) | `packages/core/test/prop/` |
| **GOLD** | The CLI/JSON/CSV contract & data shapes (artefact is the criterion) | `packages/core/test/gold/`, `packages/cli/test/gold/`, `acceptance/schemas/` |
| **JUDGE** | Deterministic renderer facts (machine-scored) + subjective look-and-feel (human/LLM over the captured screenshots) | `packages/gui/judge/`, `acceptance/judge-rubric.md`, `acceptance/evidence/screenshots/` |
| **MANUAL** | Physical/OS reality (real sleep, wall-clock cadence, no-network, tray/hotkey) | `acceptance/manual/runbook.md` |

## PRD section → method → proof

| PRD § | Subject | Methods | Proof |
|-------|---------|---------|-------|
| 03 | Domain invariants (≤1 open, derived elapsed, billable duration, project⇒client) | **PROP** · BDD | `prop/invariants.test.ts`, `bdd/*` |
| 04 | Atomic transitions, file-watch, busy-timeout cooperation, UTC math | **PROP** · BDD · MANUAL | `prop/invariants.test.ts`, `cli/test/integration/cross-surface.test.ts` |
| 05 | Start/stop/status/resume/backfill; editable open entry; billable defaults | **BDD** · PROP · GOLD | `features/tracking.feature` (edit-open scenarios), `prop/editing.test.ts`, `cli/test/gold/cli.test.ts` (edit) |
| 06 | Edit/delete/split/merge; overlap warns-not-blocks; merge conflict rule | **BDD** · PROP · GOLD | `features/overlap_and_editing.feature` (edit + merge-override scenarios), `prop/editing.test.ts`, `cli/test/gold/cli.test.ts` (merge override) |
| 07 | Clients/projects/tags: create, rename, archive, on-the-fly tags | **BDD** · PROP · GOLD | `features/overlap_and_editing.feature` (rename/archive scenarios), `prop/editing.test.ts`, `cli/test/gold/cli.test.ts` (rename/archive) |
| 08 | Billable override; clientless defaults; billable-only reporting default | **BDD** · PROP · GOLD | `features/tracking.feature` (billable-override scenarios), `prop/editing.test.ts`, `cli/test/gold/cli.test.ts` (billable override) |
| 09 | Report grouping/filters; rounding the line; flags surfaced; CSV+JSON | **GOLD** · PROP · BDD | `gold/contracts.test.ts`, `cli/test/gold/cli.test.ts`, `schemas/*` |
| 10a | Sleep-span flagging, wall-clock-gap reconcile, subtract | **MANUAL** · PROP · BDD | `prop/sleep.test.ts`, `manual/runbook.md` |
| 10b | Check-in cadence: 60-then-30, autonomous, survives relaunch, realigns | **MANUAL** · PROP | `prop/checkin.test.ts`, `manual/runbook.md` |
| 11 | tt command surface: tables, `--json`, exit codes, time parsing | **GOLD** · PROP · BDD | `cli/test/gold/cli.test.ts`, `schemas/*` |
| 12 | Tray count-up, hotkey toggle, main window, flags in context, empty states | **JUDGE** · **MANUAL** · GOLD | `judge/` (renderer facts + screenshots), `gui/test/toggle.test.ts` (toggle decision), `judge-rubric.md`, `manual/runbook.md` (shortcut registration, live tray, real hotkey) |
| 13 | Schema, WAL, TT_DB path resolution, default location | **GOLD** · BDD | `gold/contracts.test.ts`, `core/src/paths.ts` |
| 14 | Settings & defaults | **GOLD** · BDD | `gold/contracts.test.ts`, `cli/test/gold/cli.test.ts` |
| 16 | Decided edge cases (start-while-running, crash, DST, merge conflicts) | **BDD** · PROP · MANUAL | `features/*`, `prop/invariants.test.ts` |

## §17 acceptance criteria → proof

| # | Criterion (abridged) | Proven by | Evidence |
|---|----------------------|-----------|----------|
| R1 | tt-started timer shows in the other surface; status never disagrees | MANUAL · **BDD** · PROP | `cross-surface.test.ts`, transcript R1 |
| R2 | At most one entry open under rapid start/stop from either surface | **PROP** · BDD | `prop/invariants.test.ts`, `cross-surface.test.ts` (20 procs) |
| R3 | Close / sleep / crash mid-timer never corrupts elapsed | MANUAL · **PROP** · BDD | derived-elapsed tests, transcript R3 |
| R4 | Stored times never altered by rounding/sleep; reversible, derived-only | **PROP** · GOLD | `prop/invariants.test.ts`, `prop/sleep.test.ts`, transcript R4 |
| R5 | Sleep yields a flagged entry, second-accurate spans, working subtract | MANUAL · **PROP** · BDD · JUDGE | `prop/sleep.test.ts`, `main-flags.png`, transcript R5 |
| R6 | First check-in at 60m; cadence autonomous, survives relaunch, realigns | MANUAL · **PROP** | `prop/checkin.test.ts`, transcript R6 |
| R7 | Reports group/filter/round, flag overlap & sleep, export valid CSV+JSON | **GOLD** · PROP · BDD | `cli/test/gold/cli.test.ts`, `schemas/*`, transcript R4/R7 |
| R8 | Every GUI capability is reachable from tt | **BDD** · GOLD · JUDGE | `parity-matrix.json`, `gui/test/parity.test.ts`, BDD `@both` runs |
| R9 | No network connections | **MANUAL** · GOLD | `scripts/check-no-network.mjs`, `gold/no-network.test.ts` |

## Residual risk we accept (verbatim from acceptance.html §11)

- **Sleep reconciliation is wall-clock-approximate.** Gap-sourced spans bound the
  dead time but can't tell true sleep from app-closed time, so they are flagged for
  review and never auto-applied. Verified on real hardware before release.
- **Tray and global hotkey aren't exercised end-to-end in CI.** JUDGE drives the
  renderer windows in headless Chromium, which has no system-tray host, can't deliver
  an OS-global hotkey, and (here) can't run the Electron main process at all — the
  Electron binary is not fetchable in this environment. So `globalShortcut`
  registration, the tray icon's live count-up, and a real hotkey press are confirmed
  under MANUAL, not asserted via `electronApp.evaluate()`. The *decision* the hotkey
  and tray click both invoke — stop / resume / start — is pure (`src/toggle.ts`) and
  is unit-tested in CI (`gui/test/toggle.test.ts`), so only the OS wiring, not the
  behaviour, rests on MANUAL.
- **JUDGE's subjective line is captured, not machine-scored.** `DESKTOP_FEEL` is
  recorded as unscored (`pass: null`) — the harness produces the screenshots and a
  human/LLM scores them against `judge-rubric.md`; it is never auto-passed. The
  deterministic facts (empty-state copy, count-up, accent discipline scanned across
  all chrome, flags-in-context) are machine-checked and gate CI.
- **Long-form cadence is sampled, not exhaustive.** The real 60-then-30 schedule is
  verified in a long-running pass; day-to-day regression uses a compressed cadence.
- **"Near-instantly" is a soft bound.** File-watch propagation is checked against a
  generous latency budget, observed not guaranteed under arbitrary load.
- **JUDGE is advisory on look-and-feel.** Scored by rubric and spot-checked; it gates
  presentation but never a billable number.
