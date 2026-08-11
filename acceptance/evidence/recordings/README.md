# Screen-recording QA evidence — recordings

This directory is the tracked **index** of the §W screen-recording QA evidence. The
GIF binaries themselves are never committed (issue #256) — they live on the public
evidence bucket under
`https://pub-110c939d8c384d6c9e201e5f888c1288.r2.dev/acceptance/evidence/recordings/<name>.gif`,
each ≤5 MB so GitHub renders them through its Camo proxy — the recorder enforces that
ceiling itself, re-encoding down a scale/fps ladder until the file fits (and failing the
recipe rather than shipping an oversized GIF Camo would drop). Regenerate with
`npm run record`, then upload:
`node scripts/upload-evidence.mjs acceptance/evidence/recordings *.gif`.

It holds two kinds of evidence:

1. **Per-requirement GIFs** (below) — the §W screen-recording QA evidence.
   Each `.gif` drives the **real renderer** through the same canned fixtures + pinned
   clock the JUDGE harness uses (`packages/gui/judge/record.mjs`, `npm run record`;
   Playwright `recordVideo` → two-pass palette GIF, slowed ~0.5x with a ~1.5s end-frame
   hold and a visible cursor). They are ASCII-named by the recipe's requirement id — or,
   for the design-layer close-ups, by its design-rule id — and regenerated wholesale
   whenever the GUI changes, so every uploaded GIF shows the current UI at a window size
   the app can actually have. The intermediate `.webm`
   files and the final `.gif`s are both gitignored working artifacts — only this index
   is tracked.
2. **Live MANUAL recordings** — the residual **live, OS-level** half of the MANUAL
   runbook procedures (real sleep/wake, the tray + global hotkey on a real desktop
   session, the live GitHub Releases query, and the OS-level app replacement + one-time
   Gatekeeper approval) that a headless host cannot drive. Those sections are preserved
   verbatim at the end of this file; a live operator drops the recordings in here.

## §W index — the screen-recording QA evidence

One GIF per requirement row (combined rows share one GIF, referenced from each id).
Every row below maps to an uploaded `.gif` (public URL form above) and to the JUDGE item that gates the same
behavior deterministically — the recording is that fact as a moving picture.

| Req id(s) | GIF | What it demonstrates |
|---|---|---|
| §05 R05 / §12 R07 | `05-r05.gif`, `12-r07.gif` | Add an entry entirely by drag ON THE WEEK GRID: the round + button enters select-interval (a snapped start handle follows the cursor), a press-drag sets the span, release opens the reduced unified form above the grid, and Save entry is the sole commit — the saved event appears on the grid. `05-r05` = the add-by-drag core path (plus a stop-grip drag writing the raw Stop field live); `12-r07` = the full R07 chrome — the + expanding on hover, select-interval, the grayed grid, the blank reduced form, a body drag moving both fields, and the overlap warn banner on save. |
| §12 R17 | `12-r17.gif` | Exact / overnight entry through the form's ALWAYS-PRESENT raw Start/Stop fields: open the form from the keyboard path, type an overnight span (22:00 → 02:00 next day) and watch the grid repaint it as one segment per day — Wednesday's running to the column foot, Thursday's from the head down to 02:00 — then Save: the overnight entry persists, counted under its start day. |
| §12 R22 | `12-r22.gif` | The week-only Entries view and its fit-to-width grid: five equal columns filling the view with zero horizontal scroll, today ringed on the grid and in the picker, the selected week as one lifted band, a picker click selecting that day's whole week, the prev/next steppers, and the Show-weekend toggle repainting SEVEN columns that still share the width with no horizontal scroll. |
| §12 R24 | `12-r24.gif` | The pending-changes gate: a CLEAN form swaps subject on a click with no prompt; a DIRTY one blocks on the keep-editing / discard-changes dialog with Keep editing focused and nothing written; Keep editing returns the typed work intact, and only the explicit Discard changes abandons it and performs the swap. |
| §05 R06 / §12 R14 | `running-start-only.gif`, `12-r14.gif` | Running entry: open the inline start-only disclosure, drag the start handle; block shows empty end + future transparency fade; end never populated (`running-start-only`). `12-r14` = the full Timer view end-to-end (live count-up, edit-running-no-stop, stop then start-with-details from the idle-only start panel, favorites pin/resume/rename/unpin). |
| §12 R15 | `12-r15.gif` | The start-only interval picker — the requirement's whole scope, manual add living on the grid: the Timer view's Start field discloses it IN FLOW (no modal, no Apply) on the exact stored start, with one start grip, no end control anywhere, the block dissolving into the future and the ephemeral fine-snap toggle beside the track; dragging the grip writes the Start field live. Ends by asserting the other half of the requirement — the Entries view mounts NO picker: a closed entry's span drags on the grid's own edge grips or is typed in the raw fields. |
| §12 R16 | `12-r16.gif` | The Entries week grid: equal day columns FILLING the view with no horizontal scroll (§12 R22), per-day billable totals in the headers and no range chip anywhere, vertical scroll to the off-hours entries (scroll, never clip), and hover ops on an event; empty days as empty columns. |
| §12 R09 / §17 R11 | `12-r09.gif` | The Entries week's filters over a multi-week fixture (issue #55): each control — search (week + search compose, so last week's match stays out), the billable toggle, client + project, tag — visibly narrows the grid, then the prev-week stepper composes with the search still on. There are no range presets and no range-total chip; the day-header totals are the reflection surface. Ends with the on-camera wire verdict that every `listEntries` query carried `by:'day'` with zero throws. Mirrors the hardened `ENTRIES_CALENDAR` / `LIVE_FILTER` judge scenes. |
| §12 R06 / §06 R01 | `12-r06.gif` | Hover an event → Delete / Split / Edit + corner checkbox appear; click Edit opens the unified editor in edit mode (shared view-level host, seeded); two-step Delete arms a worded confirm then confirms — the event leaves the calendar. Ends on the stored-truth pair (issue #49): a 09:07:33 entry opens to the second and a no-drag Save patches no times, while dragging the selected block's stop grip on the grid snaps the dragged edge alone. |
| §06 R03 | `06-r03.gif` | Multi-select merge: check corner checkboxes on two contiguous events → multi-select mode + merge bar (live count) → disagreeing-field conflict prompt → one merged event spanning earliest start to latest end. |
| §06 R04 / §12 R10 | `12-r10.gif` | Overlap yellow warn bands + slept hatch on the calendar; opening the overlapped event's editor shows the overlap amount/neighbour detail; the slept event's editor shows the reversible Subtract/Restore control with struck raw-vs-trimmed billable. |
| §12 R12 / §14 timeline-settings | `timeline-window-settings.gif` | Change working hours / picker window mode in Settings → Timeline (valid edit persists, inverted pair rejected + reverts, Around-now enables); the configured window drives the default scroll (scroll, never clip). |
| §09 R01 | `09-r01.gif` | Reports custom range as two plain date fields driving the run output — the GUI's one range surface; then Entries, where the recipe asserts on camera that no preset segment and no date field exists at all (week-only, §12 R09) and steps the week to show the only range concept the view has. |
| §05 R10 | `05-r10.gif` | Multiline description typed in the 3-line scrollable field, rendered intact on reopen in the editor. (The CLI 60-char cap / CSV round-trip is transcript/GOLD evidence — no GIF.) |

## Supplementary recordings — core rows & shell tours

§W scope is *all core (`●`) GUI rows ∪ every Rec `▶` row*. These committed GIFs cover the
core-entry and shell/packaging requirements alongside the §W rows above, each mirroring
its JUDGE scene.

| Req id(s) | GIF | What it demonstrates |
|---|---|---|
| §05 R01 | `05-r01.gif` | Start as the GUI core-entry surface — while a timer runs the Timer view offers only edit-or-stop (no start affordance, issue #51); Stop, then start with details (core's `start` verb itself remains the atomic stop-then-start for `tt`; no Switch verb, issue #34). |
| §05 R02 | `05-r02.gif` | Stop the running timer from the Timer view; the count-up halts, nothing running. |
| §12 R05 | `12-r05.gif` | The idle-only Start-with-details form (issue #51): while running the start panel is hidden (only Stop + live-edit); Stop reveals it, the Billable box auto-checks as a client is typed (§05 R07), and submitting opens the new entry (no Switch button). |
| §05 R09 | `05-r09.gif` | Favorites rail: pin the running timer, list, rename in place, unpin — all via the rail + kebab. |
| §05 R09/R10 | `favorites-rail.gif`, `favorites-rail-empty.gif` | One-click Resume starts a favorite (`favorites-rail`); the empty-rail instructional state mentioning `tt fav` (`favorites-rail-empty`). |
| §12 R14 | `timer-view.gif` | Timer-view tour: live count-up ticking, running state, live-edit strip. |
| §07 R01 | `07-r01.gif` | Clients-view reference-data CREATE driven end to end (issue #48): + Add client opens the inline New-client field and the committed name lands in the active list; + Add project nests the new project under its client; + Add tag lands in the active tag strip — each over the same IPC its `tt` subcommand uses. |
| §12 R08 | `12-r08.gif`, `reports-view.gif` | Reports view = saved reports CRUD end-to-end (list → New → build → Save → Run → export CSV/JSON → Edit/regroup → delete); `reports-view` is the tour subset. |
| §12 R11 / §14 | `settings-view.gif` | Settings panel exposes a control for every §14 setting, including the date-format picker. |
| §19 R03 | `19-r03.gif` | Software Update: current version row + Check now → queries GitHub Releases → "Update available" verdict + release link. |
| §19 R04 | `19-r04.gif`, `software-update.gif` | Download & guided install: progress bar, numbered steps incl. the one-time Gatekeeper beat, "never touches the database" note, Reveal installer. |
| §20 R04 | `20-r04.gif` | Backups group: last-backup + verified pill, change retention, restore through the two-step confirm gate. |
| §20 R05 | `20-r05.gif` | Corruption-recovery notice naming the recovered-from backup + the quarantined file; restore reachable through the confirm gate. |
| §12 R03 | `12-r03.gif`, `nav-shell.gif` | Window shell: the sidebar is present in every view and holds a fixed 168px width across resize (`12-r03`); `nav-shell` is the five-view routing tour. |
| §12 R04 | `12-r04.gif` | Active-Timer placement: the full panel lives in the Timer view while Entries keeps the compact strip of the same running timer. |
| §12 R04 / issue #50 | `cross-view-freshness.gif` | Cross-view freshness: after the Entries toolbar's week stepper has been touched (the control that latches the entries query), the Timer view's card still flips idle → running on the spot when Start is pressed (the count-up ticks, no reload) — the regression path the `CROSS_VIEW_FRESHNESS` judge scene gates. |
| §12 R01 | `12-r01.gif` | Tray popover while running: Stop + Open Stint only, no Switch button. |
| §12 (report.html retired) | `12-r-report-html.gif` | The standalone sidebar-less `report.html` is retired; the report function folds into the in-shell Reports view (sidebar present throughout). |

## Design-layer close-ups — the changed idioms

The design layer (`context/design.html`) changed three idioms outright, so each gets a close-up
of its own alongside the per-view tours above. These GIFs are named for the **design-rule id**
they show rather than a PRD row, because the rule is what they evidence — and each recipe
asserts its rule's computed facts against the live tokens while recording, so a regression to
the retired look FAILS the recording instead of quietly re-recording it.

| Rule id(s) | GIF | What it demonstrates |
|---|---|---|
| D12 / V7 | `d12.gif` | Nav selection close-up: the five rail items driven in turn, hovered then clicked — hover is a quiet neutral wash on a still-flat row, while the active item is a **lifted paper chip** (paper fill + chip shadow, ink label, the accent on its icon alone). An on-page badge echoes the live computed chip/lift/label/icon values, and the recipe asserts all four per item — the retired accent-weak marker could not pass. |
| V5 | `v5.gif` | Merge/selection bar close-up: checking two corner boxes raises the selection bar **above** the calendar with a lifted "2 selected" count pill and a **neutral** Merge (Entries spends its one accent-solid primary on its standing Add entry, handed to the form's Save entry while one is open, so Merge never takes it); Merge then opens the disagreeing-field conflict prompt. Position and neutrality are both asserted on the way past. |
| V3 | `v3.gif` | The "me" block close-up on the **week grid** (the pending/selected interval, `paintPendingOverlay`): the dragged span is an accent **outline over a weak accent fill** with ink time pills and accent-bordered paper grips — a body drag moves start+stop together, the bottom grip moves the stop alone, and both write live into the form's Start/Stop fields (the captions echo the actual values). Ends on the running start-only variant in the Timer view: the same block with no end edge, fading into the future behind a start grip. |

To regenerate: `npm run record` (all recipes) or `node packages/gui/judge/record.mjs
"<recipe id>"` for one. `--list` prints every recipe id.

## §16 / §19 R04 — in-app update never touches the database (CHECK INSTALL & UPDATE part (d))

The §16 decided behavior is that the §19 R04 download + guided install replaces the
*application* only and **never touches the database**: a timer left running while the
app is replaced is still open, unchanged, after relaunch.

| Part | Method | Status | Evidence |
|------|--------|--------|----------|
| The **no-DB-touch** invariant across a live open timer — the live `tt.sqlite` byte-identical (sha256 + size) across a SIMULATED app-replacement, the same entry still open with an unchanged id/start on **both** surfaces (`tt` + the core Store the GUI is a surface over), and the derived elapsed continuing to grow | **EXECUTED (headless)** | ✅ CONFIRMED | `acceptance/evidence/cli-transcript.md` → section **"§16 / §19 R04 — in-app update never touches the database (simulated app-replacement)"** |
| The Settings → Software Update **chrome** R03/R04 affordances — version row (R06), Check-now verdict + release link (R03), Download & install → progress bar → guided steps incl. the one-time Gatekeeper beat → Reveal installer (R04) — driven through the real renderer | **EXECUTED (headless, JUDGE)** | ✅ PASS | `acceptance/evidence/judge-report.json` → item **`SOFTWARE_UPDATE`**; screenshot `acceptance/evidence/screenshots/main-software-update.png`; recordings `19-r03.gif` / `19-r04.gif` / `software-update.gif` |
| The **download mechanism** (artifact selection per platform, size-verified stream to the temp dir never beside the DB, progress maths, the guided-step plan incl. Gatekeeper / no-Developer-ID) | GOLD | ✅ pinned offline | `packages/gui/test/update.test.ts`, JUDGE `SOFTWARE_UPDATE` |
| The **live** GitHub artifact download + the **OS-level** app replacement + the one-time Gatekeeper approval, across a real running timer on a real install | **MANUAL (live)** | ⏳ awaits a real desktop operator | a screen recording dropped in this directory (the no-network backstop forbids reaching GitHub from CI, and there is no Playwright host for the OS-level swap — runbook §"This check FAILS if …") |

## §17 R13 — CHECK INSTALL & UPDATE (the install→update umbrella)

R13 is the acceptance umbrella over the whole §19 packaging-installation-update story.
Its components are each proven in their own checks; the pieces that gate **R04**
specifically — part **(c)** the guided download/replace/Gatekeeper + relaunch on the new
version, and part **(d)** the mid-timer update leaving the DB byte-identical — share the
evidence above:

- Part **(c)** guided-install chrome (download → replace → Gatekeeper → reveal): the
  JUDGE `SOFTWARE_UPDATE` item + `main-software-update.png` (headless); the live GitHub
  download + OS Gatekeeper swap is the live MANUAL recording (above).
- Part **(d)** mid-timer update → DB byte-identical: the executed
  `cli-transcript.md` "§16 / §19 R04" section (headless); the live cross-relaunch swap is
  the same live MANUAL recording.
- Parts **(a)** single installer → both surfaces on one version (§19 R02) and **(b)**
  Check now → update-available (§19 R03) are OS-level / live-network realities recorded
  here by the operator; their headless backstops are the `packaging/` static guards
  (GOLD `build-matrix.test.ts`) and the JUDGE `SOFTWARE_UPDATE` Check-now sub-fact.

> A live recording file added to this directory should be named for the check it covers,
> e.g. `check-update-mid-timer.mp4` / `check-install-and-update.mp4`, and should show the
> runbook's numbered steps and their `[ ]` confirmations end-to-end.
