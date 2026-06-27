# Requirements transition — old → new (work-list)

**Status: ACTIVE TRANSITION.** This document is the single source of truth for an
in-progress requirements change. It enumerates every requirement that is **new**,
**modified**, or **deleted** between the legacy docs (`*-old.html`) and the new
docs (`prd.html`, `concept.html`, `glossary.html`, `acceptance.html`).

It is the **agent work-list**: the `requirements-transition` workflow
(`.claude/workflows/requirements-transition.js`) consumes it to plan, implement,
verify, review, and gather evidence for every pending change, then aggregates the
result into one GitHub PR.

**Lifecycle.** When the workflow has produced passing verification evidence for
every requirement here, it performs the old→new swap: the `*-old.html` files and
**this mapping document** are deleted, and the new docs become the only docs.
Until then, both sets coexist.

> Read this with `prd-old.html` open for the legacy text. New section/req text is
> specified inline below; the new `prd.html` renders it in the legacy house style.

---

## 0. How the workflow consumes this file

Each requirement below carries:

- **ID** — stable handle. Existing requirements keep their `§NN Rmm` id. New
  requirements get a new id in a new or existing section. The new `prd.html`
  renumbers within each section; the **Change** column is authoritative for intent.
- **Change** — `NEW` · `MODIFIED` · `DELETED`.
- **Core** — `●` if this is a **core requirement** (see §C). Core GUI requirements
  and all changed/new GUI requirements get a **screen recording** in QA evidence.
- **Surfaces** — `core` (the @stint/core package), `cli` (`tt`), `gui`. Parity is
  mandatory unless stated (PRD §17 R8).
- **Files** — the implementation surface an agent will touch.
- **Mockup** — the mockup(s) that depict it (every NEW/MODIFIED GUI req maps to ≥1).
- **AC** — executable acceptance method(s): BDD · PROP · GOLD · JUDGE · MANUAL.
- **Rec** — `▶` if a **screen recording** of this requirement is required in the PR
  QA evidence (not part of the executable AC system — see §W).

---

## 1. Global decisions (grill outcomes)

These shape many requirements; recorded once here.

| # | Decision |
|---|----------|
| G1 | **Platforms: macOS + Linux only. Windows support is dropped entirely** — code, build matrix, docs, and the `%APPDATA%` path. |
| G2 | **Single install experience**: one installer artifact (a macOS `.pkg` and a Linux script/package) places the GUI in Applications/the app launcher **and** puts `tt` on `PATH`, in one step. |
| G3 | **In-app updates = download + guided install**: a button checks GitHub Releases, downloads the new artifact, and walks the user through replacing the app. **No Apple Developer ID / notarization dependency** (user clears Gatekeeper once). Lives in **Settings → Software Update**. |
| G4 | **Publishing**: every merge to `main` builds and publishes a new release to **GitHub Releases** (the public repo is the distribution backend). **Date/build versioning**: `YYYY.M.D`, with a build suffix for multiple same-day merges (e.g. `2026.6.27.2`). |
| G5 | **Timer view becomes fully functional**: create/start-with-details, stop/switch, edit the running timer live (attributes + start time, no stop), resume via **pinned favorites**. |
| G6 | **Pinned favorites**: a named, pinned timer template; one-click resume. Full CLI parity. |
| G7 | **Sidebar present in every view, fixed width on resize.** The "This week" summary opens the in-sidebar Reports view; the standalone `report.html` page is retired. |
| G8 | **Menubar single click = compact popover only.** The 3-item dropdown menu is removed. |
| G9 | **New visual time-range picker** selecting **start + stop together** on a single-day calendar column (drag body = move, drag bottom = resize; 5-min snap; other entries gray, overlaps yellow, warn-only). Opens on click of the text field or calendar icon. Default span = existing value, else last-stop→now. Overnight spans use text entry. Text entry remains everywhere. Applies to add-entry, edit-closed-entry, edit-running-start (not split). |
| G10 | **One clickability convention**: all clickable text/links adopt the neutral button background; the accent stays reserved for each view's single primary action (§15 accent discipline preserved). |
| G11 | **Reports = saved, named definitions** (range + group-by + filters + rounding). The Reports view lists them and is the primary place they are created; re-run/edit/export. New lightweight entity in core + schema, with **full CLI parity**. |
| G12 | **Data-loss**: keep hard-delete behind the confirm gate (no trash). **Add automatic timestamped backups + retention + corruption detection/recovery.** |
| G13 | **Core requirements** are a new classification (§C): data integrity, data-loss protection, and core data entry. Labeled across the PRD with a `core` badge. |

---

## C. Core requirement classification

**Definition.** A requirement is **core** iff it does one of:
(a) **ensures data integrity** — atomicity, invariants, immutability of stored truth;
(b) **protects against data loss** — crash-safety, durability, backups, the export
escape hatch, destructive-action confirmation;
(c) **enables core data entry** — creating entries, starting timers, stopping timers,
manual backfill.

Sleep accuracy (§10), the offline/no-network guarantee (§17 R9), and cross-surface
sync (§17 R1) were explicitly considered and ruled **not core** (accuracy / privacy /
consistency, not integrity-or-loss).

**Existing requirements relabeled `core`** (no behavior change, badge only):

- §04 R02 (single file, WAL, all through core), R03 (derived elapsed), R04 (atomic
  `BEGIN IMMEDIATE` transitions), R06 (UTC storage)
- §05 R01 (start), R02 (stop), R05 (manual add)
- §06 R04 (overlap flagged — no silent double-bill)
- §09 R04 (rounding display-only; stored time exact), R06 (export / durability)
- §11 (CLI) `tt start`, `tt stop`, `tt add`, `tt export`
- §12 R05 (start/switch form with attributes), R07 (manual add form), R13 (confirm
  destructive)
- §13 (schema; at-most-one-open invariant)
- §17 R02 (at most one open), R03 (crash never corrupts elapsed), R04 (stored times
  never altered), R07 (export validity)

**New core requirements** are defined in §20 below.

---

## 2. Section-by-section changes

### §02 Concept / §03 Audience (concept-old.html → concept.html)

| ID | Change | Core | Summary | Files | Mockup | AC |
|----|--------|:----:|---------|-------|--------|----|
| concept | MODIFIED | | Drop "Windows" from the cross-platform framing; state **macOS + Linux**. Add a short "Installed like a real app" beat (single installer, app + `tt`, self-updating from GitHub Releases). Note saved reports and favorites in "A day with Stint". Keep the "running timer is just an open row" spine. | `concept.html` | — | — |

### §04 Architecture

| ID | Change | Core | Summary | Files | Mockup | AC |
|----|--------|:----:|---------|-------|--------|----|
| §04 R02–R04, R06 | MODIFIED | ● | Add `core` badge. Text unchanged except: drop Windows from any platform mention; cross-reference §20 hardening reqs. | `prd.html` | — | PROP/GOLD (existing) |
| §04 R05 | MODIFIED | | File-watch propagation: unchanged behavior; note it is **not** a core requirement. | `prd.html` | — | — |

### §05 Timer & entries

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|----|--------|:----:|----------|---------|-------|--------|----|----|
| §05 R01 | MODIFIED | ● | core/cli/gui | Add `core` badge. Behavior unchanged. | core, cli, gui | `timer.html` | BDD/PROP | ▶ |
| §05 R02 | MODIFIED | ● | core/cli/gui | Add `core` badge. | core, cli, gui | `timer.html` | BDD | ▶ |
| §05 R05 | MODIFIED | ● | core/cli/gui | Add `core` badge. Manual add gains the visual range picker in GUI (see §12 R14). | core, cli, gui | `timer.html`, `edit-entry.html` | BDD/GOLD | ▶ |
| §05 R09 | **NEW** | | core/cli/gui | **Favorite (pinned timer)** — a named template capturing description/client/project/tags/billable. Create from any entry or running timer ("pin"); list; rename; unpin. Stored as a new `favorite` table. | core, cli, gui | `timer.html` | BDD/GOLD | ▶ |
| §05 R10 | **NEW** | | core/cli/gui | **Resume from favorite** — one action starts a fresh timer from a favorite's template. CLI: `tt fav start <name>` / `tt start --fav <name>`. | core, cli, gui | `timer.html` | BDD | ▶ |

### §06 Editing

| ID | Change | Core | Summary | Files | Mockup | AC |
|----|--------|:----:|---------|-------|--------|----|
| §06 R01 | MODIFIED | ● | Add `core` badge (the **confirm gate** is the loss-protection). Hard-delete retained (no trash — G12). | core, cli, gui | `edit-entry.html` | BDD |
| §06 R04 | MODIFIED | ● | Add `core` badge. Overlap warned-not-blocked; surfaced. | core, cli, gui | `edit-entry.html`, `time-range-picker.html` | PROP |

### §09 Reports & export — **saved reports (G11)**

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC |
|----|--------|:----:|----------|---------|-------|--------|----|
| §09 R04 | MODIFIED | ● | core | Add `core` badge. Rounding stays display/export-only; stored time exact. | core | `reports.html` | PROP |
| §09 R06 | MODIFIED | ● | core/cli/gui | Add `core` badge — **export is the durability/data-out path**. | core, cli, gui | `reports.html` | GOLD |
| §09 R08 | **NEW** | | core/cli/gui | **Saved report definition** — a named, persistent preset of {range-spec, group-by, filters, rounding}. CRUD: create, list, show/run, rename, edit, delete. New `report` table; range-spec stored as a relative spec (e.g. "this-week") or absolute range. | core, cli, gui | `reports.html` | BDD/GOLD |
| §09 R09 | **NEW** | | core/cli/gui | **Run a saved report** — resolves the definition against current data and renders totals; export (CSV/JSON) from a saved report. | core, cli, gui | `reports.html` | BDD/GOLD |

### §11 CLI specification — parity for new entities

| ID | Change | Core | Summary | Files | Mockup | AC |
|----|--------|:----:|---------|-------|--------|----|
| §11 `tt start/stop/add/export` | MODIFIED | ● | Add `core` badge to these subcommands in the CLI table. | cli | — | GOLD |
| §11 `tt fav` | **NEW** | | `tt fav add\|ls\|rm\|rename\|start <name>` and `tt start --fav <name>`; `--json` on reads. Parity with §05 R09–R10. | cli | — | GOLD |
| §11 `tt report` (saved) | **NEW** | | `tt report save <name> [filters/grouping/range/round]`, `tt report ls`, `tt report show <name>`, `tt report rm <name>`, `tt report run <name> [--csv\|--json]`; `--json` on reads. Parity with §09 R08–R09. The existing ad-hoc `tt report …` query form remains. | cli | — | GOLD |

### §12 GUI specification — the bulk of the change

| ID | Change | Core | Summary | Files | Mockup | AC | Rec |
|----|--------|:----:|---------|-------|--------|----|----|
| §12 R01 | MODIFIED | | **Tray: single left-click opens the compact popover only; remove the dropdown context menu** (G8). Keep right-click → minimal Quit-only menu (OS convention) OR fold Quit into the popover; popover keeps Stop/Switch/Start + Open Stint. | gui (`src/main.ts`) | `main.html` (tray note) | JUDGE/MANUAL | ▶ |
| §12 R03 | MODIFIED | | **Window shell & navigation: the sidebar is present in *every* view and stays a fixed width on resize** (G7). No view escapes the shell. Current view highlighted. | gui (`renderer/*`, `styles.css`) | `main.html`, `timer.html`, `reports.html` | JUDGE | ▶ |
| §12 R04 | MODIFIED | | Active-timer panel moves into the **Timer view** (R14) and remains on Entries as a compact strip. | gui | `timer.html` | JUDGE | ▶ |
| §12 R05 | MODIFIED | ● | Add `core` badge. Start/Switch form (description/client/project/tags/billable) is the GUI core-entry surface; now lives in the Timer view. | gui | `timer.html` | BDD/JUDGE | ▶ |
| §12 R07 | MODIFIED | ● | Add `core` badge. Manual add form uses the new range picker (R15). | gui | `timer.html`, `edit-entry.html` | BDD/JUDGE | ▶ |
| §12 R08 | MODIFIED | ● (export) | **Reports view = saved reports** (G11): lists saved report definitions and is the primary place to create one; build/edit a definition; run; on-screen summary with flags; CSV/JSON export. Replaces the standalone `report.html` (DELETED, R below). Sidebar stays. | gui (`renderer/*`) | `reports.html` | BDD/JUDGE/GOLD | ▶ |
| §12 R13 | MODIFIED | ● | Add `core` badge. Confirm destructive actions in-window. | gui | `edit-entry.html` | JUDGE |  |
| §12 R14 | **NEW** | ● (entry) | **Full Timer view (G5)**: live count-up + state; create/start with details; stop; switch; **edit the running timer live** (attributes + start time, no stop); pinned **favorites** rail with one-click resume (§05 R09–R10). | gui | `timer.html` | BDD/JUDGE | ▶ |
| §12 R15 | **NEW** | | **Visual time-range picker (G9)** — opens on click of a time text field or its calendar icon; month view → single-day column with hour lines; entry is a draggable rectangle (drag body moves start w/ 5-min snap; drag bottom resizes end); other entries gray, overlaps yellow (warn-only). Default span existing-else-last-stop→now. Overnight via text. Used in add-entry, edit-closed, edit-running-start. **Text entry remains** and stays authoritative. | gui (`renderer/*`, new picker component) | `time-range-picker.html`, `edit-entry.html` | JUDGE/MANUAL | ▶ |
| §12 R-report.html | **DELETED** | | The standalone, sidebar-less `report.html` page is removed; its function folds into §12 R08 in-sidebar Reports view (G7). | gui (`renderer/report.html`, `report.js`) | (was) | — |

### §13 Storage & schema

| ID | Change | Core | Summary | Files | Mockup | AC |
|----|--------|:----:|---------|-------|--------|----|
| §13 | MODIFIED | ● | Add `core` badge. **New tables: `favorite`, `report`.** Drop the Windows `%APPDATA%` path; keep Linux `~/.local/share/stint/…` and macOS `~/Library/Application Support/…`. Cross-reference §20 hardening (WAL assert, FK on, integrity_check, at-most-one-open index, backups). | core (`schema`) | — | GOLD (schema) |

### §15 Visual design / accent discipline

| ID | Change | Core | Summary | Files | Mockup | AC |
|----|--------|:----:|---------|-------|--------|----|
| §15 R-clickability | **NEW** | | **One clickability convention (G10)**: every clickable text affordance carries the neutral button background; inert text never does; the accent color stays reserved for each view's single primary action. | gui (`styles.css`) | `main.html`, `reports.html`, `timer.html` | JUDGE |

### §16 Edge cases / §17 Acceptance criteria

| ID | Change | Core | Summary | Files | Mockup | AC |
|----|--------|:----:|---------|-------|--------|----|
| §16 | MODIFIED | | Remove Windows-specific edge cases; add: update-mid-timer (no data touch), backup-on-launch, corruption-detected-on-open recovery. | `prd.html` | — | MANUAL |
| §17 R02–R04, R07 | MODIFIED | ● | Add `core` badge to these acceptance criteria. | — | — | (meta) |
| §17 R12 | **NEW** | ● | **Backups & recovery acceptance**: a fresh launch makes a recoverable backup; a corrupted DB is detected on open and recovered from the latest backup without data loss. | core, gui | `settings.html` | MANUAL/BDD |
| §17 R13 | **NEW** | | **Install & update acceptance**: the installer puts the app in Applications and `tt` on PATH; the in-app updater detects a newer GitHub release and completes a guided install. | gui, packaging | `settings.html` | MANUAL |
| §17 R14 | **NEW** | | **Parity for new entities**: favorites and saved reports are each fully reachable from both `tt` and the GUI. | core, cli, gui | `timer.html`, `reports.html` | BDD |

---

## 19. NEW SECTION — Packaging, installation & updates

> New `prd.html` §19. All requirements here are NEW.

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC |
|----|--------|:----:|----------|---------|-------|--------|----|
| §19 R01 | NEW | | packaging | **Build matrix: macOS + Linux only.** CI builds a macOS app bundle and a Linux artifact (AppImage or `.deb`) from the monorepo. No Windows. | root build config, `packages/gui` (electron-builder or equiv.), CI | `settings.html` | MANUAL |
| §19 R02 | NEW | | packaging/cli/gui | **Single installer (G2)**: one artifact installs the GUI into Applications/app-launcher **and** symlinks `tt` onto `PATH` (e.g. `/usr/local/bin` or `~/.local/bin`) in one step. macOS `.pkg`; Linux install script/package. | packaging, `packages/cli` | `settings.html` | MANUAL |
| §19 R03 | NEW | | gui | **In-app update — check (G3)**: Settings → Software Update shows current version and a "Check for updates" action querying the GitHub Releases API; reports up-to-date or a newer version. | gui (`src/main.ts`, settings renderer) | `settings.html` | MANUAL |
| §19 R04 | NEW | | gui | **In-app update — download + guided install (G3)**: downloads the newer release artifact and walks the user through replacing the app. No code-signing/notarization dependency; the flow accounts for the one-time Gatekeeper approval. Updates never touch the database. | gui | `settings.html` | MANUAL |
| §19 R05 | NEW | | packaging/CI | **Publishing on merge-to-main (G4)**: every merge to `main` runs CI that builds both artifacts and publishes a GitHub Release. | CI (`.github/workflows`) | — | MANUAL |
| §19 R06 | NEW | | packaging/CI | **Date/build versioning (G4)**: release version is `YYYY.M.D`, with a numeric build suffix for multiple same-day releases (`YYYY.M.D.N`). Version is stamped into the app and shown in Settings. | CI, `packages/gui`, `packages/cli` | `settings.html` | GOLD/MANUAL |

---

## 20. NEW SECTION — Data durability & integrity hardening (CORE)

> New `prd.html` §20. **All requirements here are core (●).**

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC |
|----|--------|:----:|----------|---------|-------|--------|----|
| §20 R01 | NEW | ● | core | **DB open invariants**: on every open, assert/enforce `journal_mode=WAL`, `foreign_keys=ON`, a busy timeout, and `synchronous=FULL` (or `NORMAL` under WAL with documented rationale) so committed writes survive power loss. | core (`schema`/open) | — | PROP/GOLD |
| §20 R02 | NEW | ● | core | **At-most-one-open enforced at the DB level** via a partial unique index on `end_utc IS NULL`, in addition to core logic (defense in depth). | core (`schema`) | — | PROP |
| §20 R03 | NEW | ● | core | **Integrity check on open**: run `PRAGMA quick_check`/`integrity_check` at startup; on failure, do not write — trigger recovery (R05). | core | — | MANUAL/BDD |
| §20 R04 | NEW | ● | core/gui | **Automatic backups + retention (G12)**: on launch, if the DB changed since the last backup, write a timestamped copy beside the DB; keep the last N (default 5); expose restore. | core, gui (`settings`) | `settings.html` | BDD/MANUAL |
| §20 R05 | NEW | ● | core/gui | **Corruption recovery (G12)**: on integrity-check failure, quarantine the corrupt file (`.corrupted`) and restore from the latest good backup, informing the user; never silently lose data. | core, gui | `settings.html` | MANUAL/BDD |
| §20 R06 | NEW | ● | core | **Monotonic-time guard**: duration arithmetic tolerates wall-clock skew (NTP/manual changes); `now < start` never yields negative/garbage elapsed. | core | — | PROP |
| §20 R07 | NEW | ● | core | **`app_state` durability**: state needed for reconciliation/schedule (last-seen timestamp, check-in schedule) is persisted in the same transaction as the write that changes it. | core | — | PROP/BDD |

---

## W. Screen-recording QA evidence (workflow tail stage)

**Not part of the executable AC system.** After plan → implement → verify (AC) →
the two reviews (§R) are complete, the workflow gathers **screen recordings** that
demonstrate requirements being exercised, for sharing on the PR. Scope:

1. **All core-flow GUI requirements** — every GUI requirement marked `core` (●):
   §05 R01/R02/R05 (start/stop/add via GUI), §12 R05/R07/R08(export)/R13/R14.
2. **All changed/new GUI requirements** — every `Rec ▶` row above: §12 R01, R03,
   R04, R08, R14, R15; §05 R09/R10 (favorites).
3. **All code-change-adjacent requirements** — any requirement whose
   implementation touched code in this transition and is demonstrable in the GUI,
   including §19 update flow (R03/R04) and §20 backup/restore (R04/R05).

Recordings are attached/linked in the PR as QA evidence under
`acceptance/evidence/recordings/` (git-ignored binaries linked from the PR body),
indexed by requirement id.

---

## R. Review stages (workflow)

After implementation and AC verification, **two separate reviews** run, each
producing feedback that loops back into an improvement pass before recordings:

1. **AC-evidence-sufficiency review** — an adversarial completeness critic per
   requirement: is there a passing executable AC (BDD/PROP/GOLD/JUDGE/MANUAL as
   mapped) **and** is it real evidence (not a stub/skip)? Defaults to *insufficient*
   unless implemented **and** covered **and** reflected in regenerated evidence.
2. **Code-quality & architecture review** — adapted from Matt Pocock's
   *improve-codebase-architecture* method: hunt shallow modules, leaky seams, poor
   locality, cognitive bounce; apply the **deletion test**; rate findings
   `Strong` / `Worth exploring` / `Speculative` with a top recommendation. Feeds an
   improvement pass; must not regress AC.

---

## Z. Swap / cleanup at completion

When every requirement above has passing AC evidence **and** both reviews are clean,
the workflow performs the swap **inside the same PR**:

- Delete `prd-old.html`, `concept-old.html`, `glossary-old.html`,
  `acceptance-old.html`.
- Delete `packages/gui/renderer/report.html` and `report.js` (folded into Reports view).
- Delete the legacy `.claude/workflows/stint-prd-coverage.js` (superseded; used as
  prior art).
- Delete **this file** (`requirements-transition.md`).
- Ensure `README.md`, `CLAUDE.md`, `acceptance/COVERAGE.md`, and
  `acceptance/parity-matrix.json` reference only the new docs and entities.

The human gate is the **PR merge**.
