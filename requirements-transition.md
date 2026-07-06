# requirements-transition.md — issue #43 work-list (calendar picker / entries calendar)

TEMPORARY transition artifact. Maps `context/prd-old.html` → `context/prd.html` for the
`requirements-transition` workflow. Deleted at the §Z swap. Unlike the timeless context
docs, this file deliberately speaks in NEW/MODIFIED/DELETED — that is its job.

## §0 How the workflow consumes this file

The workflow's Inventory phase parses every row of every §2 table into its WORKLIST
schema. Column legend (one row per requirement id; every column present on every row):

| Column | Meaning |
|---|---|
| ID | Stable requirement id (`§12 R15`, `§11 tt-list`, `§14 timeline-settings`). |
| Change | `NEW` / `MODIFIED` / `DELETED`. |
| Core | `●` iff core per §C (drives mandatory recording + recording scope). |
| Surfaces | Any of `core` / `cli` / `gui` / `docs` (schema also admits `packaging`/`CI`; unused here). |
| Summary | One-line intent. |
| Files | Implementation + AC files/areas to create/edit/delete. |
| Mockup | Mockup file(s) under `context/mockups/` depicting it; `—` if none. Every NEW/MODIFIED gui row names ≥1. |
| AC | Executable AC methods: `BDD` / `PROP` / `GOLD` / `JUDGE` / `MANUAL`. Empty for docs-only rows. |
| Rec | `▶` iff a screen recording is required in QA evidence (§W). Every changed/new GUI row is ▶. |

**DELETED rows** carry the artifacts to remove in Files, and their §Z forbidden-survivor
greps must come up empty at swap. DELETED rows have no Mockup (the new mockups simply
never show the artifact) and their AC is the grep + the successor row's AC.

## §1 Global decisions

Verbatim from the authoring brief; these shape multiple rows below.

| ID | Decision |
|---|---|
| G1 | Native `datetime-local` popovers are gone from every entry start/stop surface. The interval picker (calendar + day column) is the only interactive picking surface. |
| G2 | The calendar is the primary picking surface; raw Start/Stop text fields live in a collapsed expander — the exact-entry escape hatch and the only path for overnight spans. Both write the same values. |
| G3 | Custom *range* pickers (Entries toolbar, Reports) are plain date inputs (no time). |
| G4 | Split keeps a simple text instant input; the control is labelled "Split". |
| G5 | ONE unified entry form, add + edit modes, inline in the Entries view (no modal): left column = multiline description (3 lines, scrollable), client, project below client, tags, billable; right half = the inline interval picker. |
| G6 | Edit-mode footer: Split + two-step Delete. Merge = hover-corner checkbox on calendar events; any checked box enters multi-select mode → merge bar → §06 R03 conflict prompt. There is no separate per-row "Edit tags" control (tags edit in the form). |
| G7 | The inline picker updates form state live; "Save entry" is the only commit. |
| G8 | Running entry: start-only drag handle, empty end, block fades into the future via a transparency gradient — in the picker and the entries calendar. |
| G9 | Descriptions may contain newlines (stored verbatim; CSV export quotes them). `tt list` renders the first line capped at 60 chars with `…`; `--json` is full fidelity. |
| G10 | Entries view content = readonly calendar: one fixed comfortable-width day column per day in range (never stretched/compressed), horizontal scroll when the range doesn't fit, viewport tall enough for a work day. Hover = Delete / Split / Edit + corner checkbox; click = open the unified editor. |
| G11 | There is no grouping in the Entries view and no `tt list --by`. Grouped breakdowns live in Reports (`tt report --by` + GUI Reports). |
| G12 | Overlaps render as yellow warn bands on the calendar; detail in the editor. Sleep subtract/restore lives in the editor; slept events get a visual marker (hatched segment) on the calendar. |
| G13 | Toolbar range-total chip stays; per-day billable totals sit in day-column headers; empty days render as empty columns. |
| G14 | Tray popover unchanged. |
| G15 | Settings (key-value rows, no schema migration): `working_hours_start` / `working_hours_end` (HH:MM, defaults 07:00/18:00, start<end) shared by both surfaces; `picker_window_mode` (`working_hours` default \| `around_now`); `picker_around_hours` (total hours centered on now, default 8, range 1–24). Settings view gains a Timeline group; `tt config` parity is automatic. |
| G16 | The window is a scroll default, not clipping: full 24h track in a scrollable viewport. The picker centers on the edited interval when editing, else the configured window; the entries calendar always defaults to working hours. |
| G17 | Core labels: §05 R05, §06 R01, §12 R07 stay core; the Start/Stop expander is itself core (only overnight-backfill path). Timeline-window settings are NOT core (display preference — record the exclusion where core labeling is discussed). |
| G18 | Mockups: main.html (calendar view: week, multi-select merge, Today panels), edit-entry.html (unified form: edit / expanded expander / running variants), timer.html (inline start-adjust disclosure), settings.html (Timeline group), reports.html (custom range date fields). time-range-picker.html is retired at swap. |
| G19 | Timeless docs — the new docs read as if the product was always this way; history lives in git. Captured as a process.html principle. |

## §C Core requirement classification

**Core** (prd.html §03): a requirement is core iff it (a) ensures data integrity,
(b) protects against data loss, or (c) enables core data entry. Core rows carry `●`
and get a screen recording in QA evidence.

**Existing core badges are unchanged by this transition.** Verified against
`context/prd.html` core-badge occurrences: §04 R01–R03/R05–R06 · §05 R01/R02/R05 ·
§06 R01/R04 · §09 R04/R06 · §11 `tt start`/`tt stop`/`tt add`/`tt export` ·
§12 R05/R07/R08/R13/R14 · §13 · §17 R02/R03/R04/R07/R12 · §20 (all).

**Net-new core in this transition:** exactly one — **§12 R17 exact time entry** (the
Start/Stop expander): it is the only path for overnight backfill, hence core data entry (G17).

**Recorded exclusion:** the §14 timeline-window settings (`working_hours_*`,
`picker_window_mode`, `picker_around_hours`) are **NOT core** — a display preference
shaping default viewports, not integrity-or-loss. prd.html §03 records the exclusion.

## §2 Section-by-section changes

Old-text citations reference `context/prd-old.html`.

### §05 Timer & entries

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|---|---|---|---|---|---|---|---|---|
| §05 R05 | MODIFIED | ● | gui, docs | Manual add: from/to chosen on the unified form's inline interval picker (§12 R15); expander (§12 R17) is the exact/overnight path; overlap warned inline, allowed. Old: GUI backfill via the add form's `datetime-local` fields + standalone picker modal. | `packages/gui/renderer/app.js`, `packages/gui/renderer/timepicker.js`, `packages/gui/renderer/index.html`; `features/tracking.feature`; `packages/gui/judge/*` (UNIFIED_FORM scene) | edit-entry.html | BDD, JUDGE, MANUAL | ▶ |
| §05 R06 | MODIFIED | | gui, docs | Running entry editable; start via the start-only picker variant (future-fade, G8); end does not exist until stop — empty, never a synthetic "now". Old: running start edited via `datetime-local`/picker modal. | `packages/gui/renderer/timepicker.js`, `packages/gui/renderer/app.js`; `features/tracking.feature`; judge TIMER start-only scene | timer.html, edit-entry.html | BDD, JUDGE, MANUAL | ▶ |
| §05 R10 | NEW | | core, cli, gui, docs | Multiline descriptions (G9): newlines stored verbatim, no surface flattens stored text; CSV export quotes for round-trip (§09 R06); `tt list` human table = first line capped 60 chars + `…`, `--json` full fidelity (§11); form field = 3-line scrollable multiline input (§12 R07). | `packages/core/src/*` (export quoting path), `packages/cli/src/format.ts`, `packages/gui/renderer/app.js`, `packages/gui/renderer/index.html`; `features/entry_list.feature`; GOLD CSV/list contracts | edit-entry.html | GOLD, BDD, JUDGE | ▶ |

### §06 Editing

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|---|---|---|---|---|---|---|---|---|
| §06 R01 | MODIFIED | ● | gui, docs | Edit/delete run through the unified editor (§12 R06); confirm gate = edit-mode footer's two-step Delete. Old: per-row kebab → row-inline edit form / modal editor. | `packages/gui/renderer/app.js`, `packages/gui/renderer/index.html`, `packages/gui/renderer/styles.css` (successor to deleted `editor.js`); `features/overlap_and_editing.feature` | edit-entry.html | BDD, JUDGE, MANUAL | ▶ |
| §06 R02 | MODIFIED | | gui, docs | Split at an instant; control labelled "Split", lives in the edit-mode footer, instant entered as plain text (G4). Old: split hosted in the modal editor. | `packages/gui/renderer/app.js`; `features/overlap_and_editing.feature` | edit-entry.html | BDD, JUDGE | ▶ |
| §06 R03 | MODIFIED | | gui, docs | Merge selection made by checking hover-corner checkboxes on calendar events → multi-select mode → merge bar (§12 R16); conflict prompt unchanged. Old: row-checkbox selection in the entry list; prompt hosted in `editor.js`. | `packages/gui/renderer/app.js` (merge-conflict host moves here from `editor.js`), `packages/gui/renderer/styles.css`; `features/overlap_and_editing.feature` | main.html, merge-conflict.html | BDD, JUDGE, MANUAL | ▶ |
| §06 R04 | MODIFIED | ● | gui, docs | Overlap warned, not blocked; renders as yellow warn bands on the entries calendar (§12 R16) and in the picker (§12 R15); detail (amount + neighbour) in the editor (§12 R10). Old: list-row warn styling + picker-modal bands. | `packages/gui/renderer/app.js`, `packages/gui/renderer/timepicker.js`, `packages/gui/renderer/styles.css`; `features/overlap_and_editing.feature`; judge ENTRIES_CALENDAR/UNIFIED_FORM scenes | main.html, edit-entry.html | BDD, JUDGE | ▶ |

### §09 Reports & export

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|---|---|---|---|---|---|---|---|---|
| §09 R01 | MODIFIED | | gui, docs | Custom range = a pair of plain dates, no time — two date fields in the Reports builder (§12 R08) and the Entries toolbar (§12 R09) (G3). Old: custom range via the visual range-picker modal. | `packages/gui/renderer/reports.js`, `packages/gui/renderer/app.js` (Entries toolbar); `features/reporting.feature`; judge REPORTS_VIEW scene | reports.html, main.html | BDD, JUDGE | ▶ |

### §11 CLI specification

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|---|---|---|---|---|---|---|---|---|
| §11 tt-list | MODIFIED | | cli, core, docs | `tt list` human table renders a description's first line capped at 60 chars with `…` (§05 R10); `--json` full fidelity; no grouping flag — grouped breakdowns are `tt report --by` (G11). Old: flat table, full description cell. | `packages/cli/src/program.ts`, `packages/cli/src/format.ts`; `features/entry_list.feature`; GOLD list contract | — | GOLD, BDD | |
| §11 tt-list `--by` | DELETED | | cli, core | Remove the `--by <grouping>` option from the `list` subcommand and its grouped-table rendering; narrow `@stint/core` `entrylist.ts` grouping API to its Reports usage. Grep-empty at §Z: `--by` in `program.ts`'s `list` block. | `packages/cli/src/program.ts` (list block), `packages/core/src/entrylist.ts`; `features/entry_list.feature` (drop grouping scenarios) | — | GOLD, BDD | |

### §12 GUI specification

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|---|---|---|---|---|---|---|---|---|
| §12 R06 | MODIFIED | | gui, docs | Inline entry editing through the unified editor, identical to add mode, inline in the Entries view (no modal); every `tt edit` field editable; split/merge/delete reachable (footer + calendar). Old: row-inline edit form + modal editor + per-row Edit-tags control. | `packages/gui/renderer/app.js`, `packages/gui/renderer/index.html`, `packages/gui/renderer/styles.css`; `features/reachable_by_hand.feature`; judge UNIFIED_FORM scene | edit-entry.html | BDD, JUDGE, MANUAL | ▶ |
| §12 R07 | MODIFIED | ● | gui, docs | Manual add form = the unified entry form in add mode (G5): multiline description, client, project, tags, billable left; inline interval picker + expander right; picker updates form state live, Save entry sole commit (G7). Old: dedicated add form with `datetime-local` fields. | `packages/gui/renderer/app.js`, `packages/gui/renderer/index.html`, `packages/gui/renderer/timepicker.js`, `packages/gui/renderer/styles.css`; `features/tracking.feature`, `features/reachable_by_hand.feature`; judge UNIFIED_FORM scene | edit-entry.html, main.html | BDD, JUDGE, MANUAL | ▶ |
| §12 R09 | MODIFIED | | gui, docs | Entries range presets + custom date fields, filters + search applied live to the entries calendar (R16). No grouping — grouping left this view entirely (G11). Old R09 "Entry list: grouping, filtering & search" grouped the list by day/client/project/tag via the `#entries-ctrl` group-by control. | `packages/gui/renderer/app.js`; `features/entry_list.feature`, `features/search.feature`; judge ENTRIES_CALENDAR scene | main.html | BDD, JUDGE | ▶ |
| §12 R10 | MODIFIED | | gui, docs | Flags in context on the calendar: overlap = yellow warn band, slept = hatched segment (G12); detail + sleep subtract/restore (reversible, strike-through) in the unified editor. Old: list-row flag chips + sleep review on the row. | `packages/gui/renderer/app.js`, `packages/gui/renderer/styles.css`; judge ENTRIES_CALENDAR/UNIFIED_FORM scenes; `acceptance/criteria/judge-rubric.md` | main.html, edit-entry.html, sleep-review.html | JUDGE, BDD | ▶ |
| §12 R12 | MODIFIED | | gui, core, cli, docs | Settings view exposes every §14 setting including the new Timeline group (working hours, picker window mode, around-now span — G15); `tt config` parity automatic. | `packages/gui/renderer/settings.js`, `packages/gui/renderer/index.html`; `packages/core/src/settings.ts`; `features/settings.feature`; judge TIMELINE_WINDOW scene | settings.html | BDD, GOLD, JUDGE | ▶ |
| §12 R14 | MODIFIED | ● | gui, docs | Full Timer view: running start adjusted via an inline start-only disclosure of the picker below the Start field (no modal), block fading into the future (G8). Old: running start via `datetime-local` + picker modal. | `packages/gui/renderer/app.js`, `packages/gui/renderer/timepicker.js`; `features/tracking.feature`; judge Timer-view scene | timer.html | BDD, JUDGE, MANUAL | ▶ |
| §12 R15 | MODIFIED | | gui, docs | Inline interval picker: month calendar → single-day column; draggable rectangle (body = move, bottom grip = resize stop, 5-min snap); other entries gray, overlaps yellow warn-only; live form-state updates, Save commits (G7); default viewport per §14 window settings (G16); start-only + future-fade variant for running entries (G8). Old R15 "Visual time-range picker": a click-opened modal with backdrop + Apply. | `packages/gui/renderer/timepicker.js`, `packages/gui/renderer/app.js`, `packages/gui/renderer/styles.css`; judge UNIFIED_FORM scene (successor to TIME_RANGE_PICKER); `acceptance/criteria/MANUAL` runbook (drag rows) | edit-entry.html, timer.html | JUDGE, BDD, MANUAL | ▶ |
| §12 R16 | NEW | | gui, docs | Readonly entries calendar (G10/G12/G13): fixed-width day columns, horizontal scroll, working-hours default viewport (scroll, never clip), day-header billable totals, range-total chip, empty columns, hover Delete/Split/Edit + corner checkbox, click opens editor, running block future-fade, multi-select merge entry point (§06 R03). | `packages/gui/renderer/app.js`, `packages/gui/renderer/styles.css`, `packages/gui/renderer/index.html`; judge ENTRIES_CALENDAR scene (new); `features/entry_list.feature`, `features/reachable_by_hand.feature` | main.html | JUDGE, BDD, MANUAL | ▶ |
| §12 R17 | NEW | ● | gui, docs | Exact time entry: the unified form's collapsed Start/Stop expander — raw text fields beneath the picker; exact-entry escape hatch and the ONLY path for overnight spans; expander and picker drive the same form values; Save commits either way (G2). | `packages/gui/renderer/timepicker.js`, `packages/gui/renderer/app.js`; `features/tracking.feature` (overnight backfill); judge UNIFIED_FORM scene; MANUAL runbook (overnight-via-expander) | edit-entry.html | BDD, JUDGE, MANUAL | ▶ |
| §12 R18–R20 | MODIFIED | | docs | Docs-only renumber: old R16 Empty states → R18, old R17 Theme & accessibility → R19, old R18 No standalone report page → R20. No code impact; cross-references updated in the new docs. | `context/prd.html` (landed) | — | | |
| §12 picker modal chrome | DELETED | | gui | Standalone picker modal/backdrop/Apply chrome removed from `timepicker.js` + `styles.css` (`stp-backdrop`, `stp-apply`); the picker renders only inline (G5). Successor: §12 R15. | `packages/gui/renderer/timepicker.js`, `packages/gui/renderer/styles.css` | — | JUDGE | |
| §12 entries group-by control | DELETED | | gui | The Entries-view group-by control (`#entries-ctrl` grouping) removed; no grouping in the Entries view (G11). Successor: §12 R09/R16 + Reports grouping (§09 R02). | `packages/gui/renderer/app.js`, `packages/gui/renderer/index.html` | — | JUDGE | |
| §12 per-row Edit-tags control | DELETED | | gui | The per-row "Edit tags" action removed; tags edit in the unified form (G6). Successor: §12 R06. | `packages/gui/renderer/app.js` (`data-act="tags"`), `packages/gui/renderer/styles.css` | — | JUDGE | |
| §12 row-inline edit form | DELETED | | gui | The entry-row inline edit form removed; the unified editor is the only edit surface. Successor: §12 R06. | `packages/gui/renderer/app.js`, `packages/gui/renderer/index.html`, `packages/gui/renderer/styles.css` | — | JUDGE, BDD | |
| §12 modal editor | DELETED | | gui | `packages/gui/renderer/editor.js` (modal editor over edit/split/merge/remove IPC) deleted. Its merge-conflict dialog host MUST move to `app.js` (calendar multi-select path, §06 R03) BEFORE deletion. File removed at §Z. | `packages/gui/renderer/editor.js`, `packages/gui/renderer/index.html` (script tag), `packages/gui/renderer/styles.css` | — | JUDGE, BDD | |
| §12 native datetime-local | DELETED | | gui | Native `datetime-local` inputs removed from every entry start/stop surface (G1); the picker + expander are the only entry-time inputs. (Plain date inputs for *ranges* remain per G3.) | `packages/gui/renderer/app.js`, `packages/gui/renderer/index.html`, `packages/gui/renderer/timepicker.js`, `packages/gui/renderer/styles.css` | — | JUDGE | |
| §12 judge scenes TIME_RANGE_PICKER / ADD_FORM_PICKER | DELETED | | gui | The two picker-modal judge scenes reworked away; successors: UNIFIED_FORM (form + inline picker + expander), ENTRIES_CALENDAR (calendar), TIMELINE_WINDOW (§14 viewport). | `packages/gui/judge/run-judge.mjs`, `packages/gui/judge/fixtures.mjs`, `packages/gui/judge/record.mjs`; `acceptance/criteria/judge-rubric.md` | — | JUDGE | |

### §14 Settings

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|---|---|---|---|---|---|---|---|---|
| §14 timeline-settings | NEW | | core, cli, gui, docs | Three settings rows (G15, key-value, no schema migration): `working_hours_start`/`working_hours_end` (HH:MM, 07:00/18:00, start<end), `picker_window_mode` (`working_hours` \| `around_now`), `picker_around_hours` (1–24, default 8). Validated as strictly as existing keys; shape the picker/calendar default viewports (G16). NOT core (§C exclusion). `tt config` parity automatic. | `packages/core/src/settings.ts` (+ `types.ts` if typed), `packages/gui/renderer/settings.js`; `features/settings.feature`; GOLD settings contract; judge TIMELINE_WINDOW scene | settings.html | GOLD, BDD, JUDGE | ▶ |

### §17 Acceptance criteria

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|---|---|---|---|---|---|---|---|---|
| §17 R14 | MODIFIED | | docs, cli, core | Retitled "Parity for favorites & saved reports" (was "Parity for new entities" — a timeless doc names the entities). The backing feature file renames to match: `features/parity_new_entities.feature` → `features/parity_favorites_saved_reports.feature` (references in COVERAGE.md, prd.html §17 R14 follow). | `features/parity_new_entities.feature` (rename), `acceptance/criteria/COVERAGE.md` | — | BDD | |
| §17 R10/R11 | MODIFIED | | docs | Acceptance wording re-based on the calendar + Reports grouping split: R10 names the unified form / picker / expander / calendar as the by-hand set; R11 asserts live search/filter on the *entries calendar* and grouping live in *Reports*. Old text referenced list grouping and the range picker with a stale TODO note. Docs landed in prd.html; verified by the §12 rows' AC. | `context/prd.html` (landed), `acceptance/criteria/COVERAGE.md` | — | | |

### §18 UI mockups & prototypes

Docs rows (mockups authored with the new docs; workflow verifies sync per prd.html §18).

| ID | Change | Core | Surfaces | Summary | Files | Mockup | AC | Rec |
|---|---|---|---|---|---|---|---|---|
| §18 main.html | MODIFIED | | docs | Entries view mockup now shows the readonly week calendar: fixed-width day columns, per-day totals, warn bands, slept hatch, hover controls + checkbox, merge bar, Add Entry Manually. Backs §12 R03–R04/R07/R09–R10/R13/R16, §06 R03–R04. | `context/mockups/main.html` | main.html | | |
| §18 edit-entry.html | MODIFIED | | docs | Unified form mockup: add + edit modes, multiline description, inline interval picker, collapsed expander, edit-mode footer (Split, two-step Delete), overlap warning, running start-only/future-fade variant. Backs §05 R05/R06/R10, §06, §12 R06/R07/R13/R15/R17. | `context/mockups/edit-entry.html` | edit-entry.html | | |
| §18 timer.html | MODIFIED | | docs | Timer view mockup gains the inline start-only picker disclosure below the Start field with future-fade. Backs §05 R06, §12 R14/R15. | `context/mockups/timer.html` | timer.html | | |
| §18 settings.html | MODIFIED | | docs | Settings mockup gains the Timeline group (working hours, picker window mode, around-now span). Backs §14, §12 R12. | `context/mockups/settings.html` | settings.html | | |
| §18 reports.html | MODIFIED | | docs | Reports mockup's custom range = two plain date fields (G3). Backs §09 R01, §12 R08. | `context/mockups/reports.html` | reports.html | | |
| §18 time-range-picker.html | DELETED | | docs | The standalone picker mockup is retired (G18); the picker is depicted inline in edit-entry.html/timer.html. §18 table has no row for it. File deleted at §Z. | `context/mockups/time-range-picker.html` | — | | |

## §W Screen-recording QA evidence

Scope: **all core (`●`) GUI rows ∪ every Rec ▶ row**. Recordings are GUI-only — where a
row's `tt` side is CLI (§11, `tt config` parity), the CLI transcript is the evidence, no
GIF. ASCII-named, slowed (~0.5x) GIFs with end-frame hold + visible cursor, committed
under `acceptance/evidence/recordings/`, indexed by requirement id.

| Req id(s) | The GIF must show |
|---|---|
| §05 R05 / §12 R07 / §12 R15 | Add an entry entirely by drag on the inline picker (month → day column, body-move + grip-resize on 5-min snap, live form values, Save entry) — the saved event appears on the calendar. |
| §12 R17 | Expander exact/overnight entry: expand Start/Stop, type an exact overnight span, picker reflects the typed values, Save — the overnight entry persists. |
| §05 R06 / §12 R14 | Running entry: open the inline start-only disclosure, drag the start handle; block shows empty end + future transparency fade; end never populated. |
| §12 R16 | Entries calendar: a week of fixed-width day columns with per-day header totals + range chip, horizontal scroll, then Today — a single-column day; empty days as empty columns. |
| §12 R06 / §06 R01 | Hover an event → Delete / Split / Edit + corner checkbox appear; click opens the unified editor in edit mode; two-step Delete arms then confirms. |
| §06 R03 | Multi-select merge: check corner checkboxes on contiguous events → multi-select mode + merge bar → conflict prompt → merged event. |
| §06 R04 / §12 R10 | Overlap yellow warn bands on calendar + picker with the amount/neighbour detail in the editor; slept-hatch marker and reversible subtract in the editor. |
| §12 R12 / §14 timeline-settings | Change working hours / window mode in Settings → Timeline; reopen the picker/calendar — the default scroll window follows the new setting (scroll, never clip). |
| §09 R01 | Reports custom range as two plain date fields driving the run output; the Entries toolbar's two date fields driving the calendar range. |
| §05 R10 | Multiline description typed in the 3-line scrollable field, rendered intact in the editor (CLI cap/CSV round-trip is transcript/GOLD evidence, no GIF). |

## §R Review stages

Mirrors the workflow's Review phase — two separate passes, both must gate green before
Recordings/PR/Swap; findings feed the bounded Improve loop, which must not regress AC.

1. **AC-evidence-sufficiency review (adversarial critic).** For every §2 row: does each
   mapped AC method have concrete, passing evidence that would *fail if the behavior
   regressed* (not vacuous, not testing the mock)? DELETED rows: the forbidden-survivor
   greps are empty and the successor's AC covers the migrated behavior. **Gate:** every
   row's evidence judged sufficient; every gap fixed or explicitly re-planned.
2. **Code-quality & architecture review** (improve-codebase-architecture lineage):
   deletion test (does removed-concept code truly leave no residue), shallow modules,
   leaky seams (renderer re-deriving core logic, duplicated window math between picker
   and calendar), parity discipline (no new IPC without a parity row). **Gate:** no
   open finding above nit level.

## §Z Swap / cleanup

Fires only on a full, all-green, unscoped run: every row has passing AC evidence, both
§R reviews clean, recordings committed.

**Delete:**

- `context/prd-old.html`, `context/glossary-old.html`, `context/acceptance-old.html`, `context/process-old.html`
- `context/mockups/time-range-picker.html`
- `packages/gui/renderer/editor.js` — only after its merge-conflict host has moved to `app.js` (§12 modal-editor row)
- `requirements-transition.md` (this file)

**Reference fixes (point only at new docs/entities):**

- `README.md` — verify no `-old.html` / retired-surface references.
- `CLAUDE.md` — the Files-table mockup list names `time-range-picker`; drop it. (Audited: that is CLAUDE.md's only stale reference — the rest of its mockup list and doc map already match the new set.)
- `acceptance/criteria/COVERAGE.md` — retitle §17 R14, rename the parity feature reference, drop `time-range-picker`/`datetime-local`/TIME_RANGE_PICKER/ADD_FORM_PICKER references for their successors.
- `acceptance/criteria/parity-matrix.json` — `listEntries` row notes lose grouping; no picker row (it adds zero capabilities).
- `features/parity_new_entities.feature` → `features/parity_favorites_saved_reports.feature` (§17 R14).

**Forbidden-survivor greps — all must come up empty at swap** (repo-wide unless scoped):

| Grep | Scope / note |
|---|---|
| `time-range-picker` | repo-wide (docs, mockups, code, criteria) |
| `datetime-local` | `packages/gui/renderer/` entry-time surfaces + criteria (plain *date* range inputs per G3 are fine) |
| `--by` | the `list` subcommand block of `packages/cli/src/program.ts` (report's `--by` stays) |
| `editor.js` | repo-wide (file gone, no script tag / doc reference) |
| `Edit tags` | `packages/gui/renderer/` |
| `stp-backdrop` / `stp-apply` | `packages/gui/renderer/` (modal chrome gone) |
| Entries group-by (`entries-ctrl` grouping / list `groupBy` wiring) | `packages/gui/renderer/` |
| `TIME_RANGE_PICKER` / `ADD_FORM_PICKER` | `packages/gui/judge/`, `acceptance/criteria/` |
| `parity_new_entities` | repo-wide (renamed) |
| `-old.html` | repo-wide references (the files themselves deleted above) |
