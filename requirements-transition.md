# Requirements transition — refuse-newer schema gate (#88) + sleep-detection residency (#91)

Two small PRD amendments from arch-review triage, batched per the issues' triage
comments: one new behavior (§20 R09 refuse-on-newer) and one recorded decision
(§10a detection residency). The new `context/prd.html` / `context/acceptance.html`
are authored; `context/prd-old.html` / `context/acceptance-old.html` coexist
until §Z. `concept.html` and `glossary.html` are untouched (no new concept).

## §0 How the transition consumes this file

Column legend, identical to the standing skill's contract:

- **ID** — stable requirement id.
- **Change** — `NEW` / `MODIFIED` / `DELETED`.
- **Core** — `●` iff the requirement meets the §C definition.
- **Surfaces** — `core` / `cli` / `gui`.
- **Files** — implementation/apparatus files the transition must touch
  (the `context/` doc text is already authored; do not re-author it).
- **Mockup** — mockup file(s) covering the requirement, or `—` with the
  §1 decision that exempts it.
- **AC** — `BDD` / `PROP` / `GOLD` / `JUDGE` / `MANUAL`, or `—`.
- **Rec** — `▶` if the row demands a §W screen recording beyond the
  core-●-GUI default.

## §1 Global decisions

| ID | Decision |
|----|----------|
| G1 | An old binary opening a newer-schema DB (`user_version > SCHEMA_VERSION`) refuses the open **entirely** — reads included. No read-only mode. (#88) |
| G2 | The refusal is the new **§20 R09 "Refuse newer schemas"**, core-badged. The error names both versions and the remedy ("run the newer binary"); no write occurs. |
| G3 | Surfacing: core throws on open; CLI uses the existing error path (stderr + non-zero exit); GUI shows a **native error dialog then quits** — the §20 R05 dialog convention. Mockup exemption recorded: a native OS dialog is not a GUI view (same standing as the R05 recovery dialog, which has no mockup). |
| G4 | §10a gains a **detection-residency** item: all detection (powerMonitor events, launch-gap reconciliation, the last-seen heartbeat) is GUI-resident by design; the CLI is review-only; consequence stated — CLI-only use accrues no sleep spans and no check-ins; the rejected alternative (CLI-session gap detection) is recorded with its reason. (#91) |
| G5 | README tour: the caveat rides the `tt sleep ls` inline comment. |
| G6 | AC: R09 → GOLD old-reader/new-file case in `core/test/gold/migration.test.ts` + COVERAGE.md row. The §10a item → no executable AC; recorded-decision prose guarded by sync-assessment; COVERAGE.md marks it so. |
| G7 | One transition run, one PR carries both issues. |
| G8 | Authoring-time discovery: §20 R08's "at **or beyond** the current version makes no change" contradicted R09, so R08 is MODIFIED — wording carve-out only ("at the current version…; one beyond it is refused — R09"), no behavior or test change. |

## §C Core requirement classification

Definition (unchanged, PRD §03): core iff (a) ensures data integrity,
(b) protects against data loss, or (c) enables core data entry.

- **New core:** §20 R09 — (a)/(b): forecloses silent corruption of billing
  data by a stale binary; joins §20 where every requirement is core.
- **Relabeled existing:** none.
- **Exclusions:** the §10a detection-residency item is **not** core — it
  records an accuracy-affecting design decision, and §10's standing note
  already rules sleep accuracy an accuracy concern, not integrity-or-loss.

## §2 Section-by-section changes

### §10 Running-timer hygiene (sleep-span flagging, "§10a")

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|----|--------|------|----------|---------|-------|--------|----|----|
| §10a item 7 (detection residency) | NEW | — | core, cli, gui (doc-only; records existing behavior, zero behavior change) | Detection is GUI-resident; CLI review-only; CLI-only-use consequence stated; rejected alternative recorded | `README.md` (tt sleep ls inline-comment caveat, G5); `packages/core/test/bdd/world.ts` (sleep-seeding workaround comment cites the clause instead of re-explaining the asymmetry); `acceptance/criteria/COVERAGE.md` (§10 row notes the recorded-decision item, G6) | — (no GUI change) | — (G6) | — |

### §16 Decided edge cases

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|----|--------|------|----------|---------|-------|--------|----|----|
| §16 version-skew row | NEW | — | — | Situation-table row pointing at §20 R09; spec text only, behavior carried by the R09 row | — | — | — | — |

### §20 Data durability & integrity hardening

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|----|--------|------|----------|---------|-------|--------|----|----|
| §20 R08 | MODIFIED | ● | core | Wording carve-out only (G8): "at" the current version is a no-op; "beyond" is refused per R09. No behavior/test change; existing GOLD migration coverage stands | — | — | GOLD (existing, unchanged) | — |
| §20 R09 | NEW | ● | core, cli, gui | Refuse the open when `user_version > SCHEMA_VERSION`, before any read or write; error names both versions + remedy; CLI non-zero exit, GUI native dialog + quit | `packages/core/src/db.ts` (max-version half of the gate beside the `migrate()` early-return; a typed open-refusal error in the `DbOpenError` family); `packages/core/test/gold/migration.test.ts` (old-reader/new-file case: planted future `user_version` → open refused, file bytes untouched); `packages/gui/src/main.ts` (catch around `Store.open` in `init()` → native error dialog naming versions + remedy, then quit — today the throw is unhandled); `packages/cli` (no new surface expected — `bin.ts`'s existing catch carries it; verify the message reaches stderr with non-zero exit); `acceptance/criteria/COVERAGE.md` (§20 summary row + an R09 detail row alongside the existing R08 row) | — (G3) | GOLD | — |

### Docs already authored (verify, don't re-author)

| Artifact | State |
|----------|-------|
| `context/prd.html` | NEW doc authored: §10a item 7, §16 version-skew row, §20 R08 carve-out, §20 R09 |
| `context/acceptance.html` | NEW doc authored: §-map rows for 20 R08 (previously missing — drift fixed in passing) and 20 R09 |
| `context/prd-old.html`, `context/acceptance-old.html` | Legacy docs, deleted at §Z |

## §W Screen-recording QA evidence

Default scope (core `●` GUI rows ∪ `▶` rows) nets: **no recordings this
transition.** R09 is core with a GUI surface, but that surface is a native OS
error dialog outside the QA driver's reach (Chromium drives the renderer, not
Electron dialog chrome) — the same class as the §20 R05 recovery dialog, which
has no recording either. Stated here explicitly so the empty §W reads as a
decision, not an omission. The §10a item is doc-only.

## §R Review stages

The standing two reviews (transition skill Stage 4), no additions:

1. **AC-evidence-sufficiency review** — special attention: the GOLD
   old-reader/new-file case must prove the refused open left the file
   byte-for-byte untouched (not merely that an error was thrown), and must
   plant `user_version` via raw PRAGMA, not by importing the new code path.
2. **Code-quality & architecture review** — special attention: the GUI
   catch must not swallow the §20 R01/R03 open-failure classes that today
   surface loudly; the refusal error must stay distinguishable from them.

## §Z Swap / cleanup

When every requirement has passing AC evidence and both reviews are clean:

- Delete `context/prd-old.html`.
- Delete `context/acceptance-old.html`.
- Delete `requirements-transition.md` (this file).
- Absence check: no doc, test name, or comment still claims a
  newer-schema open "makes no change" / proceeds silently (the retired R08
  wording); `git grep -i "at or beyond the current version"` returns nothing.
