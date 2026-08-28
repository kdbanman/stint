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
| **Ideal** — idle card | 00:00:00 clock, the worded state (`idle`) with a faint dot beside it, Start primary, idle-only start panel visible | JUDGE `START_FORM`, `RUNNING_SINGLE_ACTION` (idle snapshot) — `main-start-form.png` | |
| **Ideal** — running card | Live count-up, the worded state (`running`) with an accent run dot beside it, description, client/project, accented Stop, no Switch | JUDGE `TIMER_VIEW`, `IN_WINDOW_TIMER` — `timer-view.png`, `timer-view-full.png` | The word + dot are the D05/A05 pairing that keeps the state off colour alone — hidden until issue #142 |
| **Edge** — running card attribute row (billable + slept) | `billable` is the quiet `--muted` attribute label; the `slept` advisory beside it keeps the `--flag` warn pill — two kinds of thing, two palettes (D04/D14) | JUDGE `TIMER_VIEW` — `timer-card-attr-vs-flag.png` | All three labels shipped as one amber `.flag` pill until issue #160, so every running card wore the warn palette |
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
| **Ideal** — the + Add-entry button at rest | Round accent capsule bottom-right of the grid; hover expands rightward into "+ Add entry" with the + glyph pinned; keyboard activation opens the form directly with the working-hours default interval | JUDGE `UNIFIED_FORM_ADD` (`fabRest`/`keyboardPath`) — `unified-add.png` | The empty states carry the + too, so manual add stays reachable with no grid (§05 R05) |
| **Edge** — select-interval mode | + clicked: the grid takes the gestures, a start handle follows the cursor at the coarse snap, the fine-snap toggle holds the + button's spot (coarse on every entry); press-drag sets the length, release enters create | JUDGE `UNIFIED_FORM_ADD` (`selectMode`) — `entries-select-interval.png` | Escape returns to rest |
| **Ideal** — unified form, create mode | The reduced form above the grid (blank except the dragged interval), grid grayed, + hidden, the pending interval an accent-outlined block with edge grips, adjustable by dragging anywhere; Save-only commit over the unchanged `add` IPC | JUDGE `UNIFIED_FORM_ADD` (`createBlank`/`liveDrag`/`savePatch`) — `unified-add.png`; BDD `reachable_by_hand.feature` "Backfill a completed past entry by hand" | |
| **Edge** — fine-snap toggle | Ephemeral switch in the + button's spot; on → drags land on the fine grid; never persisted, coarse on every open. The grid resolution is the stored §14 pair, not a literal: `SNAP_RESOLUTION` drives it at a non-default fine 2 / coarse 20 | JUDGE `UNIFIED_FORM_ADD` (`fineSnapOk`); `SNAP_RESOLUTION` (`snap-resolution-grid.png`) | Deliberately not a setting (§14) |
| **Edge** — typed overnight span (§12 R17) | A stop typed onto the next day repaints the pending interval as one segment per shown day; the raw Start/Stop fields are the only overnight path and stay verbatim | JUDGE `UNIFIED_FORM_ADD` (`overnightTyped`) — `unified-add.png`; BDD `tracking.feature` "Backfill creates a completed overnight entry" (core + `tt`) | |
| **Error** — refused Save (`.ef-warning`) | Form stays open, nothing written, announced region names the refusal in the `--danger` block palette; the message persists until the next input on the form | JUDGE `ADD_REFUSAL_PALETTE` — `add-refusal-palette.png` | |
| **Ideal** — unified edit form | Same reduced form above the grid, every field seeded; the selected event's edges drag on the grid (only the dragged edge snaps) and the typed Start/Stop fields drive the block back — one set of values; footer Split + two-step Delete; changed-fields-only Save | JUDGE `UNIFIED_FORM` — `main-edit.png`, `main-edit-exact-times.png`; BDD `reachable_by_hand.feature` "Edit any field of an entry by hand" | |
| **Edge** — pending-changes gate (§12 R24) | A dirty subject swap (another event, an empty-spot create, an external refresh) **or a dirty exit (Cancel, Escape)** blocks on the keep-editing / discard dialog; Keep editing preserves all seven pending fields, each kind arming it alone; only Discard swaps or closes; a clean form swaps in place, a clean Escape closes | JUDGE `PENDING_CHANGES_GATE`, `UNIFIED_FORM` (`cleanSwap`) | DOM-only gate — this row + the JUDGE row are its proof |
| **Edge** — week-move prompt (§12 R24) | A week change with a form open asks `Change entry week?` before carrying the entry to the same weekday of the week opened; Cancel abandons it all, the view stays put; confirm moves the fields only (Save still writes); asks **once per open form**, again for a fresh form or a pending add | JUDGE `WEEK_MOVE_PROMPT` — `main-week-move-prompt.png` | DOM-only gate — this row + the JUDGE row are its proof |
| **Edge** — sleep subtract/restore + struck raw duration | `.ef-subtract` toggles; raw duration strikes through, trimmed billable shown | JUDGE `UNIFIED_FORM` (§12 R10 sub-facts) — `main-edit.png`; BDD `overlap_and_editing.feature` "Subtracting slept time trims the billable duration" + "Subtracting the slept time again restores the billable duration" | |
| **Ideal** — week-only toolbar + week picker | Prev/next-week steppers + week label left; billable/client/project/tag filters, search, Show-weekend toggle right; the month-calendar week picker beside the grid (entry dots, today ring, selected-week band, roving-grid keys) — no range presets, no custom date pair | JUDGE `ENTRIES_CALENDAR`, `LIVE_FILTER` — `entries-calendar.png`, `main-filtered.png` | |
| **Edge** — Show weekend on | Seven fit-to-width columns (still no horizontal scroll); the persisted `show_weekend` row flips over the same `setSetting` the Settings view edits; the hidden weekend segment of a Fri→Sat span appears, its totals unmoved | JUDGE `ENTRIES_CALENDAR` (toggle round-trip), `CALENDAR_LAYOUT` (`weekendRevealOk`) — `main-calendar-weekend.png` | |
| **Ideal** — week grid at realistic density | A busy week — the current week's elapsed days full (17 neutral paper blocks lifted off the track), the one running block the only accent on screen; the week-only view caps the surface at one week, so this is the app's densest screen | JUDGE `CALENDAR_ACCENT_BUDGET` (issue 143) — `calendar-accent-budget.png` | |
| **Edge** — week grid (cross-midnight, hidden-day segment, today ring, `.ov` overlap band, `.zz` sleep hatch, hover ops chip) | Two segments sharing an id on shown days; a weekend-crossing span draws only its start segment while the weekend is hidden (Fri's total whole either way); the ink today ring on the date numeral; yellow warn band; hatched excluded span; Delete/Split/Edit + `.ck` on hover | JUDGE `CALENDAR_LAYOUT` (issue #71 + `hiddenSegOk`/`todayOk`) — `main-calendar.png` | |
| **Edge** — multi-select + merge bar (contiguous, agreeing) | Two `.ck` checks reveal `#merge-bar`; direct merge, no prompt | JUDGE `MERGE_NOCONFLICT` — `main-merge-conflict.png` | |
| **Edge** — selected / editing blocks on the calendar | Merge-chosen blocks lift a rung off the flat ones, ink-ticked checkbox, no accent (D12); the EDITED entry instead leaves the paper ladder for the accent-outlined pending interval with edge grips (§12 R06, mockup edit-entry.html) | JUDGE `SELECTION_LIFT` (issue 144) — `selection-lift.png`, `selection-lift-editing.png` | |
| **Edge** — accent handoff with the unified form open | The + button (the standing primary) hides and demotes; Save entry is the view's one accent fill (D11) | JUDGE `PRIMARY_HANDOFF` (issue 150) | |
| **Edge** — inline gap confirm (non-contiguous, agreeing) | Merge swaps to `.confirm-gap` naming span + fabricated gap | JUDGE `MERGE_GAP` — `main-merge-gap.png` | |
| **Edge** — inline split form | Hover Split opens instant picker defaulting to midpoint | JUDGE `SPLIT_AFFORDANCE` — `main-split.png`; BDD `reachable_by_hand.feature` "Split an entry by hand" | |
| **Edge** — two-step delete gate | Arm click shows confirm, no `remove` call; explicit confirm removes once | JUDGE `CONFIRM_DELETE`, `DELETE_CONFIRM` — `main-confirm-delete.png`, `main-confirm.png`; BDD "Deleting an entry without confirmation is refused" | |
| **Empty** — "No entries yet" | Never-tracked instruct copy ("press Ctrl+Alt+T" / `tt start`) | JUDGE `EMPTY_STATE` — `main-empty.png`; `app.js` `emptyState()` | |
| **Empty** — "No matching entries" | Filter/search-narrowed-to-nothing instruct copy ("Try another week…"); a bare empty week is NOT this state — it paints as a week of empty columns | JUDGE `LIVE_FILTER` (no-match search) — `main-no-matching.png`; `app.js` `emptyEntries()` | |
| **Edge** — minimum window (1040×800, §12 R22) | The reduced unified form commits without scrolling — Save entry inside the viewport, the raw Start/Stop fields inside their own column, no horizontal overflow (both form modes) | JUDGE `WINDOW_GEOMETRY` — `min-window-add.png` | 1040×800 is both the default and the minimum (`main.ts`) |
| **Edge** — wide window (1920) | The fit-to-width columns absorb the resize: equal shares at every width, no horizontal scroll at any size or column count (no floor width — the sanctioned horizontal scroll left with the range concept), descriptions at natural width | JUDGE `WINDOW_GEOMETRY` — `calendar-wide.png` | |

## Merge-conflict modal (the app's only modal, `.editor.conflict-prompt` in `app.js`)

| State | What it looks like | Evidence | Notes/Waiver |
|---|---|---|---|
| **Ideal** — conflicting merge prompt | Distinct client/project choices + a billable choice before commit | JUDGE `MERGE_CONFLICT` — `main-merge-conflict.png`; BDD "Merge resolving to a chosen client overrides the first-entry default" | |
| **Ideal** — the chosen option's paint | Chosen option is a raised paper chip with an ink radio dot; peers recess to wash and stay flat (D12) | JUDGE `MERGE_CHOICE_LIFT` (issue 144) — `merge-choice-lift.png` | |
| **Edge** — the Entries view behind the backdrop | That view's standing primary reverts to secondary, so the modal's Merge is the only accent fill on screen (D11) | JUDGE `PRIMARY_HANDOFF` (issue 150) | |
| **Edge** — agreeing merge (no prompt) | Merge fires directly, no `.editor.conflict-prompt` | JUDGE `MERGE_NOCONFLICT` — `main-merge-conflict.png`; BDD "Merge concatenates descriptions and keeps the first entry's client" | |
| **Edge** — dismissed by Escape | Prompt and backdrop unmount, the Entries view returns untouched and nothing merges (craft checklist §4) | JUDGE `MERGE_CONFLICT` (issue 147 sub-fact) — `main-merge-conflict.png` | |
| **Error** — non-contiguous merge without acknowledgement | Refused, originals survive unmerged | BDD `overlap_and_editing.feature` "Merging a non-contiguous selection without acknowledgement is refused (the originals survive)" | Core-level refusal; same `confirmInline` gate as `MERGE_GAP`, no separate GUI screenshot |
| **Empty** — N/A | Modal only renders on a ≥2-entry conflicting selection | — | Waived — no zero-data variant exists for a conditionally-mounted modal |

## Clients view (`index.html` `data-view="clients"`, `app.js`)

| State | What it looks like | Evidence | Notes/Waiver |
|---|---|---|---|
| **Ideal** — client cards, active list | Clients with nested projects, create/rename/archive in place | JUDGE `CLIENTS_VIEW` — `main-clients.png`; BDD `reachable_by_hand.feature` "Create a client by hand" / "Create a project by hand" / "Create a tag by hand" | |
| **Edge** — inline rename (client/project) | Row swaps to a rename input, commits over `renameClient`/`renameProject` | BDD `reachable_by_hand.feature` "Rename reference data by hand" / "Archive reference data by hand" | Not separately machine-driven by JUDGE (only Add is driven, issue #48 guard) |
| **Edge** — inline add (client/project/tag) | "+ Add …" opens an input, commits, lands in the active list | JUDGE `CLIENTS_VIEW` (issue #48 driven-not-present guard) — `main-clients-created.png` | |
| **Edge** — accent handoff with an inline field open | + Add client reverts to secondary; the rename/add commit is the view's one accent fill (D11) | JUDGE `PRIMARY_HANDOFF` (issue 150) | |
| **Error** — archive-referenced confirm gate | Archive click arms `.confirm-archive`, no call until explicit confirm | JUDGE `CONFIRM_ARCHIVE` — `main-confirm-archive.png` | |
| **Ideal** — unreferenced archive (direct) | Archive commits with no confirm step | JUDGE `CLIENTS_VIEW` (Globex path) — `main-clients.png` | |
| **Edge** — archived restore list | "Show archived" toggle reveals archived rows with `.pill` + Restore | JUDGE `RESTORE_ARCHIVED` — `main-clients-archived.png` | |
| **Ideal** — tags strip | Active tags with rename/archive in place | JUDGE `TAG_CHIPS` — `main-tags.png`; BDD "Rename a tag by hand" / "Archive a tag by hand" | |
| **Empty** — "No clients yet" | Instruct copy, mentions `tt client add` (`app.js` `renderClients`' empty branch) | JUDGE `CLIENTS_VIEW` (empty-reference-data page) — `main-clients-empty.png` | |
| **Empty** — "No tags yet" | Instruct copy, mentions `tt tag add` (`app.js` `renderTags`' empty branch) | JUDGE `CLIENTS_VIEW` (empty-reference-data page) — `main-clients-empty.png` | |

## Reports view (`index.html` `data-view="reports"`, `reports.js`)

| State | What it looks like | Evidence | Notes/Waiver |
|---|---|---|---|
| **Ideal** — saved-definition list | One card per def: name, spec summary, Run/Edit | JUDGE `REPORTS_VIEW` — `reports-list.png`; BDD "Build a grouped report by hand" | |
| **Empty** — `#rep-defs-empty` | "No saved reports yet." (`index.html` `#rep-defs-empty`) | JUDGE `REPORTS_VIEW` (zero-saved-defs page) — `reports-empty.png` | |
| **Edge** — card kebab (rename/delete) | Swaps in place to Rename/Delete, Delete behind the confirm gate | JUDGE `REPORTS_VIEW` (Edit/Delete sub-fact); BDD `saved_reports.feature` "Renaming a saved report keeps it listed under the new name only" + "Deleting a saved report removes it from the list" | |
| **Ideal** — builder (new/edit) | Range presets + Custom date pair, group-by, filters, rounding; Edit nests the builder inside its card (the one expanded card), New opens it below the list | JUDGE `REPORTS_VIEW` (`builderOk`/`editOk` nesting sub-facts) — `reports-list.png`, `reports-run.png` | |
| **Edge** — accent handoff with the builder open | + New report reverts to secondary; the builder's Save — the commit, not the control that opened the form — is the view's one accent fill (D11), in BOTH accordion placements: view-level (New) and nested in the edited card | JUDGE `PRIMARY_HANDOFF` (issue 150; the two Reports builder states) — `primary-handoff-reports.png` | |
| **Error** — `#rep-warning`, incomplete custom range | No-op save, builder stays open, missing field takes focus | JUDGE `REPORTS_VIEW` (§12 R21 sub-facts) | |
| **Error** — `#rep-warning`, duplicate name | Refused, message persists past the tick, no third card | JUDGE `REPORTS_VIEW` (§12 R21 sub-facts); BDD "A duplicate report name is refused and persists nothing" | |
| **Edge** — inverted / same-day custom range | Inverted rejected & stores nothing; same-day accepted | BDD `saved_reports.feature` "A saved report with an inverted custom range is rejected…", "…same-day … custom range is accepted" | Not separately GUI-machine-scored |
| **Ideal** — run output table | Grouped totals, resolved-range header, overlap/sleep flags in context — expanded INSIDE the card that ran them (the accordion, §12 R08) | JUDGE `REPORTS_VIEW` (`runOk` in-card sub-facts) — `reports-run.png` | |
| **Edge** — one card expanded at a time / collapse discards | Running a second report collapses the first card (its body emptied) and expands the second; the close control collapses everything and clears the results — a re-view costs a re-run | JUDGE `REPORTS_VIEW` (`oneOpenOk`, issue #268) | |
| **Edge** — export blocks with status lines | Filtered CSV/JSON inside the expanded card (no scope label — the nesting states it) vs. the view-level bottom "Export All Data" (all-data wording) | JUDGE `REPORTS_VIEW` (issue #72 sub-facts) — `reports-run.png`; BDD "Export the range by hand" | |
| **Ideal** — pre-run export state | Filtered export row computed-invisible; "Export All Data" standing, clickable, whole-record (no run, no ref) | JUDGE `REPORTS_VIEW` (`preRunExportOk`, issue #262); BDD `reporting.feature` "Exporting everything as CSV covers the whole record"; static `renderer-static.test.ts` `[hidden]`-companion gate | |

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
| **Ideal** — Storage group at rest (§12 R25) | File-backed card beside Backups: caption naming the config file's own path + `tt paths`; Database/Backup-folder rows with effective path + source pill agreeing with `tt paths` (`getStoragePaths` ↔ core's one resolver) | JUDGE `STORAGE_GROUP` — `storage-group.png` | |
| **Edge** — env-overridden Storage row | Row says which env var set it ("clear the variable to change it here"), Change… disabled (§07 idiom); Reset to default… on config-set rows only | JUDGE `STORAGE_GROUP` — `storage-group.png` | |
| **Edge** — change dialog: required choice (§12 R26) | As opened: no pre-selection, commit disabled, hint instructs; choice made: chosen card lifts (D12), safety facts in place, commit reachable | JUDGE `STORAGE_CHANGE_CHOICE` — `storage-change-open.png`, `storage-change-choice.png` | |
| **Edge** — change dialog: armed confirm (§12 R13/R26) | `Change and relaunch` arms in place to `Confirm: migrate to <path>` / start-fresh wording; arming writes nothing; re-choice disarms; explicit confirm fires the pipeline once | JUDGE `STORAGE_CHANGE_ARMED` — `storage-change-armed.png` | |
| **Error** — change dialog: in-dialog refusal (§12 R21/R26) | Announced danger block carrying the shipping §20 R12 refusal; dialog stays open, commit disarmed, config untouched, old location still shown | JUDGE `STORAGE_CHANGE_REFUSAL` — `storage-change-refusal.png` | |
| **Error** — dead backup directory (§20 R14) | Announced danger block naming the directory + problem on BOTH the Storage row and the Backups section — never an innocent empty list | JUDGE `STORAGE_CHANGE_REFUSAL` (`backupDirErrorBothSurfaces`) — `storage-backup-dir-error.png` | |
| **Error** — broken config / dead configured DB parent at launch (§20 R10/R11) | NATIVE dialog naming the file + error / the configured path + config file, offering Reset to default / Quit; no fallback opened | GOLD `gui/test/storage.test.ts` (the decision logic); MANUAL runbook `CHECK STORAGE CHANGE` steps 3–4 | Native chrome — no headless host; deliberately no mockup (the R05 dialog convention) |

## Tray popover (`popover.html`, `popover.js`)

| State | What it looks like | Evidence | Notes/Waiver |
|---|---|---|---|
| **Ideal** — idle popover | Bare dot, 00:00:00, "nothing running" | JUDGE `TRAY_POPOVER_SURFACE` (idle snapshot) — `popover-tray-surface.png` | |
| **Ideal** — running popover | Count-up, "since HH:MM", description, client/project, tags | JUDGE `TRAY_COUNTUP`, `TRAY_POPOVER_SURFACE` — `popover-running-1.png`, `popover-running-2.png`, `popover-running.png` | |
| **Error** — refused toggle (`#pop-warning`) | Announced region shows the refusal message (the `#toggle` handler's catch painting `#pop-warning`, `popover.js`) | JUDGE `POPOVER_REJECT` — `popover-reject.png` | |
| **Edge** — auto-sized window (§12 R22) | The window hugs the rendered card (`popoverWindowSize`, max-clamped, sized on show): card, Stop/Start toggle, and Open Stint fully inside | JUDGE `WINDOW_GEOMETRY` — `popover-fit.png` | A warning that grows the card while the popover is already open extends past the sized window until the next show |
| **Empty** — N/A | Popover is binary idle/running, no zero-data variant | — | Waived — no empty state applies |

## How this wires into COVERAGE.md

COVERAGE.md carries a row under the §12 section pointing here as the GUI presentation
layer's per-view × per-state proof; STATES.md is not edited into COVERAGE.md.
