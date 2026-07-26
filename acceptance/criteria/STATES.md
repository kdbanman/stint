# UI state inventory

This is a UI state inventory — a per-surface × per-state coverage matrix adapting Scott
Hurff's "UI Stack" onto the seven GUI surfaces already specified in PRD §12; it audits
existing requirement coverage against the shipped renderer, it does not add new
requirements. The four states: **ideal** (happy-path render, real data), **empty**
(zero-data / never-populated render), **error** (a refused write or invalid input
surfaced in place), **edge** (a boundary or compound case — cross-midnight, overlap,
open disclosure, etc.); **loading is N/A everywhere** — every paint is a synchronous
repaint off `getState()`, and the app's sole busy affordance is the Settings "Check now"
button's text swap to "Checking…" (the `#update-check` click handler in
`packages/gui/renderer/settings.js`). Every
cell below must name its evidence — a BDD feature, a JUDGE scene id, a screenshot under
`acceptance/evidence/screenshots/`, or a MANUAL runbook check — or carry an explicit
waiver with a reason; a new view or state added without a row here is a coverage bug.

## Timer view (`index.html` `data-view="timer"`, `app.js`)

| State | What it looks like | Evidence | Notes/Waiver |
|---|---|---|---|
| **Ideal** — idle card | 00:00:00 clock, Start primary, idle-only start panel visible | JUDGE `START_FORM`, `RUNNING_SINGLE_ACTION` (idle snapshot) — `main-start-form.png` | |
| **Ideal** — running card | Live count-up, description, client/project, accented Stop, no Switch | JUDGE `TIMER_VIEW`, `IN_WINDOW_TIMER` — `timer-view.png`, `timer-view-full.png` | |
| **Error** — refused Stop (`#timer-warning`) | Announced region names the refusal — the reason alone, no IPC wrapper / exception class / CLI flag (issue 138); strip/Stop stay live, no wedge | JUDGE `WRITE_REJECTION_FEEDBACK` (site d), `FUTURE_START_GUARD` — `main-edit-reject.png`, `timer-future-start-reject.png` | |
| **Edge** — live-edit strip (running only) | Raw text `#le-start`, no `#le-end`, count-up keeps advancing while edited | JUDGE `TIMER_VIEW` — `timer-view-full.png` | |
| **Edge** — inline start-only picker disclosure | Opens in flow under the field, start grip only, future-fade mask | JUDGE `TIMER_VIEW` — `timer-view-full.png` | |
| **Edge** — start panel hidden while running | `#start-panel`/`#toggle` hidden; exactly one Description field (`#le-desc`) | JUDGE `RUNNING_SINGLE_ACTION` — `timer-running-single-action.png` | |
| **Edge** — accent handoff with a form open (Details / pin-as-favourite) | The standing Start — or Stop, while running — reverts to secondary (paper + border); the open form's commit is the view's one accent fill, never two buttons reading "Start" (D11) | JUDGE `PRIMARY_HANDOFF` (issue 150) — `primary-handoff-timer.png` | |
| **Ideal** — favorites rail populated | One row per favorite, Resume + kebab, monochrome chrome | JUDGE `FAVORITES_RAIL` — `timer-favorites.png` | |
| **Edge** — pin-as-favorite form | Pin affordance present, fires `pinFavorite` on submit | JUDGE `FAVORITES_RAIL` (inline pin driven to completion: the typed name committed on Enter fires `pinFavorite` and the chip lands in the rail) — `timer-favorites.png` | |
| **Edge** — favorites kebab (rename/unpin) | Kebab exposes rename/unpin per row | JUDGE `FAVORITES_RAIL` (kebab rename and unpin each driven to completion: `renameFavorite` renames the chip in place; `unpinFavorite` fires exactly once and the chip leaves the rail) — `timer-favorites.png`; GOLD `parity.test.ts` (channels callable) | |
| **Empty** — `#fav-empty` | "pin a favorite" copy + mentions `tt fav` | JUDGE `FAVORITES_RAIL` — `timer-favorites-empty.png` | |

## Entries view (`index.html` `data-view="entries"`, `app.js`)

| State | What it looks like | Evidence | Notes/Waiver |
|---|---|---|---|
| **Ideal** — compact timer strip, running | Mirrors running count-up/desc, no Stop control | JUDGE `IN_WINDOW_TIMER` — `main-timer.png` | |
| **Edge** — compact timer strip, idle | 00:00:00, empty description, still painted (`app.js` `renderTimerStrip`'s idle branch) | JUDGE `IN_WINDOW_TIMER` (idle page) — `main-timer-idle.png` | |
| **Edge** — overlap warn banner (`#overlap-banner`) | "This entry overlaps N… allowed, but flagged" — the write SAVED, so it reads in the `--flag` advisory palette | JUDGE `OVERLAP_BANNER` — `main-overlap-banner.png`; `ADD_REFUSAL_PALETTE` (the flag triple asserted against the refusal's danger triple, issue 139) | |
| **Error** — `.banner.error` variant | Refused write reworded as a block on the same banner region | JUDGE `WRITE_REJECTION_FEEDBACK` (site d) — `main-edit-reject.png` | |
| **Ideal** — unified add form | Two-column card, inline picker, Save-only commit | JUDGE `UNIFIED_FORM_ADD` — `unified-add.png`; BDD `reachable_by_hand.feature` "Backfill a completed past entry by hand" | |
| **Edge** — add-form Start/Stop expander (overnight span) | Collapsed echo → raw fields; cross-midnight span feeds shared state | JUDGE `UNIFIED_FORM_EXPANDER` — `unified-form-expander.png` | |
| **Error** — refused add Save (`#add-warning.error`) | Form stays open, nothing written, announced region names the refusal — and paints the `--danger` block palette, not the `--flag` advisory it wore (issue 139, D15) | JUDGE `ADD_REFUSAL_PALETTE` — `add-refusal-palette.png` | |
| **Edge** — `#add-warning` back to its advisory base | Cancel + reopen drops the `error` state class, so the region returns to `--flag` chrome and a refusal cannot repaint the next advisory | JUDGE `ADD_REFUSAL_PALETTE` — `add-refusal-palette.png` | The region serves both kinds; this is the second half of the D15 split |
| **Ideal** — unified edit form | Seeded fields, inline picker, footer Split + Delete | JUDGE `UNIFIED_FORM` — `main-edit.png`; BDD `reachable_by_hand.feature` "Edit any field of an entry by hand" | |
| **Edge** — sleep subtract/restore + struck raw duration | `.ef-subtract` toggles; raw duration strikes through, trimmed billable shown | JUDGE `UNIFIED_FORM` (§12 R10 sub-facts) — `main-edit.png`; BDD `overlap_and_editing.feature` "Subtracting slept time trims billable and is reversible" | |
| **Ideal** — range/filter/search toolbar | Presets, Custom date pair, client/project/tag/billable filters, search | JUDGE `ENTRIES_CALENDAR`, `LIVE_FILTER` — `entries-calendar.png`, `main-filtered.png` | |
| **Ideal** — readonly calendar at realistic density | Three weeks of ordinary work — 51 neutral paper blocks lifted off the track, the one running block the only accent on screen | JUDGE `CALENDAR_ACCENT_BUDGET` (issue 143) — `calendar-accent-budget.png` | |
| **Edge** — readonly calendar (cross-midnight, `.ov` overlap band, `.zz` sleep hatch, hover ops chip) | Two segments sharing an id; yellow warn band; hatched excluded span; Delete/Split/Edit + `.ck` on hover | JUDGE `CALENDAR_LAYOUT` (issue #71 sub-fact) — `main-calendar.png` | |
| **Edge** — multi-select + merge bar (contiguous, agreeing) | Two `.ck` checks reveal `#merge-bar`; direct merge, no prompt | JUDGE `MERGE_NOCONFLICT` — `main-merge-conflict.png` | |
| **Edge** — selected / editing blocks on the calendar | Chosen blocks lift a rung off the flat ones, ink-ticked checkbox, no accent anywhere (D12) | JUDGE `SELECTION_LIFT` (issue 144) — `selection-lift.png`, `selection-lift-editing.png` | |
| **Edge** — accent handoff with the unified form open | The standing Add entry reverts to secondary; Save entry is the view's one accent fill (D11) | JUDGE `PRIMARY_HANDOFF` (issue 150) | |
| **Edge** — inline gap confirm (non-contiguous, agreeing) | Merge swaps to `.confirm-gap` naming span + fabricated gap | JUDGE `MERGE_GAP` — `main-merge-gap.png` | |
| **Edge** — inline split form | Hover Split opens instant picker defaulting to midpoint | JUDGE `SPLIT_AFFORDANCE` — `main-split.png`; BDD `reachable_by_hand.feature` "Split an entry by hand" | |
| **Edge** — two-step delete gate | Arm click shows confirm, no `remove` call; explicit confirm removes once | JUDGE `CONFIRM_DELETE`, `DELETE_CONFIRM` — `main-confirm-delete.png`, `main-confirm.png`; BDD "Deleting an entry without confirmation is refused" | |
| **Empty** — "No entries yet" | Never-tracked instruct copy ("press Ctrl+Alt+T" / `tt start`) | JUDGE `EMPTY_STATE` — `main-empty.png`; `app.js` `emptyState()` | |
| **Empty** — "No matching entries" | Query-narrowed-to-nothing instruct copy ("Widen the range…") | JUDGE `LIVE_FILTER` (no-match search) — `main-no-matching.png`; `app.js` `emptyEntries()` | |

## Merge-conflict modal (the app's only modal, `.editor.conflict-prompt` in `app.js`)

| State | What it looks like | Evidence | Notes/Waiver |
|---|---|---|---|
| **Ideal** — conflicting merge prompt | Distinct client/project choices + a billable choice before commit | JUDGE `MERGE_CONFLICT` — `main-merge-conflict.png`; BDD "Merge resolving to a chosen client overrides the first-entry default" | |
| **Ideal** — the chosen option's paint | Chosen option is a raised paper chip with an ink radio dot; peers recess to wash and stay flat (D12) | JUDGE `MERGE_CHOICE_LIFT` (issue 144) — `merge-choice-lift.png` | |
| **Edge** — the Entries view behind the backdrop | That view's standing primary reverts to secondary, so the modal's Merge is the only accent fill on screen (D11) | JUDGE `PRIMARY_HANDOFF` (issue 150) | |
| **Edge** — agreeing merge (no prompt) | Merge fires directly, no `.editor.conflict-prompt` | JUDGE `MERGE_NOCONFLICT` — `main-merge-conflict.png`; BDD "Merge concatenates descriptions and keeps the first entry's client" | |
| **Error** — non-contiguous merge without acknowledgement | Refused, originals survive unmerged | BDD `overlap_and_editing.feature` "Merging a non-contiguous selection without acknowledgement is refused (the originals survive)" | Core-level refusal; same `confirmInline` gate as `MERGE_GAP`, no separate GUI screenshot |
| **Empty** — N/A | Modal only renders on a ≥2-entry conflicting selection | — | Waived — no zero-data variant exists for a conditionally-mounted modal |

## Clients view (`index.html` `data-view="clients"`, `app.js`)

| State | What it looks like | Evidence | Notes/Waiver |
|---|---|---|---|
| **Ideal** — client cards, active list | Clients with nested projects, create/rename/archive in place | JUDGE `CLIENTS_VIEW` — `main-clients.png`; BDD `reachable_by_hand.feature` "Create reference data by hand" | |
| **Edge** — inline rename (client/project) | Row swaps to a rename input, commits over `renameClient`/`renameProject` | BDD `reachable_by_hand.feature` "Rename and archive reference data by hand" | Not separately machine-driven by JUDGE (only Add is driven, issue #48 guard) |
| **Edge** — inline add (client/project/tag) | "+ Add …" opens an input, commits, lands in the active list | JUDGE `CLIENTS_VIEW` (issue #48 driven-not-present guard) — `main-clients-created.png` | |
| **Edge** — accent handoff with an inline field open | + Add client reverts to secondary; the rename/add commit is the view's one accent fill (D11) | JUDGE `PRIMARY_HANDOFF` (issue 150) | |
| **Error** — archive-referenced confirm gate | Archive click arms `.confirm-archive`, no call until explicit confirm | JUDGE `CONFIRM_ARCHIVE` — `main-confirm-archive.png` | |
| **Ideal** — unreferenced archive (direct) | Archive commits with no confirm step | JUDGE `CLIENTS_VIEW` (Globex path) — `main-clients.png` | |
| **Edge** — archived restore list | "Show archived" toggle reveals archived rows with `.pill` + Restore | JUDGE `RESTORE_ARCHIVED` — `main-clients-archived.png` | |
| **Ideal** — tags strip | Active tags with rename/archive in place | JUDGE `TAG_CHIPS` — `main-tags.png`; BDD "Tag lifecycle by hand" | |
| **Empty** — "No clients yet" | Instruct copy, mentions `tt client add` (`app.js` `renderClients`' empty branch) | JUDGE `CLIENTS_VIEW` (empty-reference-data page) — `main-clients-empty.png` | |
| **Empty** — "No tags yet" | Instruct copy, mentions `tt tag add` (`app.js` `renderTags`' empty branch) | JUDGE `CLIENTS_VIEW` (empty-reference-data page) — `main-clients-empty.png` | |

## Reports view (`index.html` `data-view="reports"`, `reports.js`)

| State | What it looks like | Evidence | Notes/Waiver |
|---|---|---|---|
| **Ideal** — saved-definition list | One card per def: name, spec summary, Run/Edit | JUDGE `REPORTS_VIEW` — `reports-list.png`; BDD "Build a grouped report by hand" | |
| **Empty** — `#rep-defs-empty` | "No saved reports yet." (`index.html` `#rep-defs-empty`) | JUDGE `REPORTS_VIEW` (zero-saved-defs page) — `reports-empty.png` | |
| **Edge** — card kebab (rename/delete) | Swaps in place to Rename/Delete, Delete behind the confirm gate | JUDGE `REPORTS_VIEW` (Edit/Delete sub-fact); BDD `saved_reports.feature` "Renaming then deleting a saved report removes it from the list" | |
| **Ideal** — builder (new/edit) | Range presets + Custom date pair, group-by, filters, rounding | JUDGE `REPORTS_VIEW` — `reports-list.png`, `reports-run.png` | |
| **Edge** — accent handoff with the builder open | + New report reverts to secondary; the builder's Save — the commit, not the control that opened the form — is the view's one accent fill (D11) | JUDGE `PRIMARY_HANDOFF` (issue 150) — `primary-handoff-reports.png` | |
| **Error** — `#rep-warning`, incomplete custom range | No-op save, builder stays open, missing field takes focus | JUDGE `REPORTS_VIEW` (§12 R21 sub-facts) | |
| **Error** — `#rep-warning`, duplicate name | Refused, message persists past the tick, no third card | JUDGE `REPORTS_VIEW` (§12 R21 sub-facts); BDD "A duplicate report name is refused and persists nothing" | |
| **Edge** — inverted / same-day custom range | Inverted rejected & stores nothing; same-day accepted | BDD `saved_reports.feature` "A saved report with an inverted custom range is rejected…", "…same-day … custom range is accepted" | Not separately GUI-machine-scored |
| **Ideal** — run output table | Grouped totals, resolved-range header, overlap/sleep flags in context | JUDGE `REPORTS_VIEW` — `reports-run.png` | |
| **Edge** — export blocks with status lines | Filtered CSV/JSON vs. bottom "Export All Data" (all-data wording) | JUDGE `REPORTS_VIEW` (issue #72 sub-facts) — `reports-run.png`; BDD "Export the range by hand" | |

## Settings view (`index.html` `data-view="settings"`, `settings.js`)

| State | What it looks like | Evidence | Notes/Waiver |
|---|---|---|---|
| **Ideal** — grouped setting rows | Editable control per §14 setting, persists over `setSetting` | JUDGE `SETTINGS_VIEW` — `main-settings.png`; BDD `settings.feature` (per-setting round-trip); "Change a setting by hand" | |
| **Edge** — disabled `.off` row (Around span) | Row dims, select disabled while Picker window = Working hours | JUDGE `TIMELINE_WINDOW` — `timeline-window.png` | |
| **Edge** — Check-now busy text swap | Button disables, reads "Checking…" | The `#update-check` click handler in `settings.js` | This is the app's one loading affordance (see preamble); not separately screenshotted |
| **Ideal** — update-available pill | "Update available · vX" + `.pill.new` link | JUDGE `SOFTWARE_UPDATE` — `main-software-update.png` | |
| **Edge** — guided download/downloading phase | Live progress bar, numbered steps incl. Gatekeeper beat | JUDGE `SOFTWARE_UPDATE` — `main-software-update.png` | |
| **Error** — guided panel error phase | Download failure flips panel to an error phase (the `bridge.download()` catch in `settings.js`) | JUDGE `SOFTWARE_UPDATE` (rejecting-download page) — `main-software-update-error.png` | |
| **Error** — failed update check | Result line reads the authored `UPDATE_CHECK_FAILED` sentence, never the transport's `net::ERR_*` code; Check now still enabled | JUDGE `SOFTWARE_UPDATE` (failed-check page, issue 138) — `main-software-update-check-error.png` | |
| **Ideal** — Backups: verified pill + Last-backup status | "Last backup …" line with a "verified" pill | JUDGE `BACKUPS_SECTION` — `main-backups.png` | |
| **Empty** — Backups: no-backups-yet copy | "No backups yet…" / "No backups to restore from yet." (`settings.js:421,445`) | JUDGE `BACKUPS_SECTION` (never-backed-up page) — `main-backups-empty.png` | |
| **Edge** — restore list + per-item confirm | One row per backup, Restore… arms then confirms exactly once | JUDGE `BACKUPS_SECTION` — `main-backups.png` | |
| **Error** — one-shot corruption-recovery banner (`.banner.recovery`) | Names both `recoveredFrom` and `quarantinedTo` | JUDGE `RECOVERY_NOTICE` — `main-recovery.png`; BDD `backup_recovery.feature` "A corrupted database is recovered from the latest backup without data loss" | |

## Tray popover (`popover.html`, `popover.js`)

| State | What it looks like | Evidence | Notes/Waiver |
|---|---|---|---|
| **Ideal** — idle popover | Bare dot, 00:00:00, "nothing running" | JUDGE `TRAY_POPOVER_SURFACE` (idle snapshot) — `popover-tray-surface.png` | |
| **Ideal** — running popover | Count-up, "since HH:MM", description, client/project, tags | JUDGE `TRAY_COUNTUP`, `TRAY_POPOVER_SURFACE` — `popover-running-1.png`, `popover-running-2.png`, `popover-running.png` | |
| **Error** — refused toggle (`#pop-warning`) | Announced region shows the refusal message (the `#toggle` handler's catch painting `#pop-warning`, `popover.js`) | JUDGE `POPOVER_REJECT` — `popover-reject.png` | |
| **Empty** — N/A | Popover is binary idle/running, no zero-data variant | — | Waived — no empty state applies |

## How this wires into COVERAGE.md

COVERAGE.md carries a row under the §12 section pointing here as the GUI presentation
layer's per-view × per-state proof; STATES.md is not edited into COVERAGE.md.
