# Screen-recording QA evidence — recordings

This directory holds two kinds of evidence:

1. **Committed per-requirement GIFs** (below) — the §W screen-recording QA evidence.
   Each `.gif` drives the **real renderer** through the same canned fixtures + pinned
   clock the JUDGE harness uses (`packages/gui/judge/record.mjs`, `npm run record`;
   Playwright `recordVideo` → two-pass palette GIF, slowed ~0.5x with a ~1.5s end-frame
   hold and a visible cursor). They are ASCII-named by the recipe's requirement id and
   regenerated wholesale whenever the GUI changes, so every committed GIF shows the
   current UI. The intermediate `.webm` files are gitignored working artifacts.
2. **Live MANUAL recordings** — the residual **live, OS-level** half of the MANUAL
   runbook procedures (real sleep/wake, the tray + global hotkey on a real desktop
   session, the live GitHub Releases query, and the OS-level app replacement + one-time
   Gatekeeper approval) that a headless host cannot drive. Those sections are preserved
   verbatim at the end of this file; a live operator drops the recordings in here.

## §W index — the screen-recording QA evidence

One GIF per requirement row (combined rows share one GIF, referenced from each id).
Every row below maps to a committed `.gif` and to the JUDGE item that gates the same
behavior deterministically — the recording is that fact as a moving picture.

| Req id(s) | GIF | What it demonstrates |
|---|---|---|
| §05 R05 / §12 R07 / §12 R15 | `05-r05.gif`, `12-r07.gif`, `12-r15.gif` | Add an entry entirely by drag on the inline picker (month → day column, body-move + grip-resize on 5-min snap, live form values, Save entry) — the saved event appears on the calendar. `05-r05` = the add-by-drag core path; `12-r07` = the two-column unified add form + overlap warn on save; `12-r15` = the inline picker through all three entry points + the overnight text escape hatch. |
| §12 R17 | `12-r17.gif` | Expander exact/overnight entry: expand Start/Stop, type an exact overnight span (22:00 → 02:00 next day), the picker echo reflects the typed values, Save — the overnight entry persists. |
| §05 R06 / §12 R14 | `running-start-only.gif`, `12-r14.gif` | Running entry: open the inline start-only disclosure, drag the start handle; block shows empty end + future transparency fade; end never populated (`running-start-only`). `12-r14` = the full Timer view end-to-end (live count-up, edit-running-no-stop, stop-then-start, favorites pin/resume/rename/unpin). |
| §12 R16 | `12-r16.gif` | Entries calendar: a week of fixed-width day columns with per-day header totals + range chip, horizontal scroll, vertical scroll to off-hours (scroll, never clip), and hover ops on an event; empty days as empty columns. |
| §12 R06 / §06 R01 | `12-r06.gif` | Hover an event → Delete / Split / Edit + corner checkbox appear; click Edit opens the unified editor in edit mode (shared view-level host, seeded); two-step Delete arms a worded confirm then confirms — the event leaves the calendar. |
| §06 R03 | `06-r03.gif` | Multi-select merge: check corner checkboxes on two contiguous events → multi-select mode + merge bar (live count) → disagreeing-field conflict prompt → one merged event spanning earliest start to latest end. |
| §06 R04 / §12 R10 | `12-r10.gif` | Overlap yellow warn bands + slept hatch on the calendar; opening the overlapped event's editor shows the overlap amount/neighbour detail; the slept event's editor shows the reversible Subtract/Restore control with struck raw-vs-trimmed billable. |
| §12 R12 / §14 timeline-settings | `timeline-window-settings.gif` | Change working hours / picker window mode in Settings → Timeline (valid edit persists, inverted pair rejected + reverts, Around-now enables); the configured window drives the default scroll (scroll, never clip). |
| §09 R01 | `09-r01.gif` | Reports custom range as two plain date fields driving the run output; the Entries toolbar's two plain date fields driving the calendar range live (no Apply). |
| §05 R10 | `05-r10.gif` | Multiline description typed in the 3-line scrollable field, rendered intact on reopen in the editor. (The CLI 60-char cap / CSV round-trip is transcript/GOLD evidence — no GIF.) |

## Supplementary recordings — core rows & shell tours

§W scope is *all core (`●`) GUI rows ∪ every Rec `▶` row*. These committed GIFs cover the
core-entry and shell/packaging requirements alongside the §W rows above, each mirroring
its JUDGE scene.

| Req id(s) | GIF | What it demonstrates |
|---|---|---|
| §05 R01 | `05-r01.gif` | Start as the GUI core-entry surface — starting while a timer runs IS the atomic stop-then-start (no Switch verb). |
| §05 R02 | `05-r02.gif` | Stop the running timer from the Timer view; the count-up halts, nothing running. |
| §12 R05 | `12-r05.gif` | The relocated Start-with-details form stays available while a timer runs; submitting closes the open row and opens the new one in one action (no Switch button). |
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
| §12 R01 | `12-r01.gif` | Tray popover while running: Stop + Open Stint only, no Switch button. |
| §12 (report.html retired) | `12-r-report-html.gif` | The standalone sidebar-less `report.html` is retired; the report function folds into the in-shell Reports view (sidebar present throughout). |

To regenerate: `npm run record` (all recipes) or `node packages/gui/judge/record.mjs
"<recipe id>"` for one. `--list` prints every recipe id.

## §16 / §19 R04 — CHECK UPDATE-MID-TIMER (in-app update never touches the database)

The §16 decided behavior is that the §19 R04 download + guided install replaces the
*application* only and **never touches the database**: a timer left running while the
app is replaced is still open, unchanged, after relaunch.

| Part | Method | Status | Evidence |
|------|--------|--------|----------|
| The **no-DB-touch** invariant across a live open timer — the live `tt.sqlite` byte-identical (sha256 + size) across a SIMULATED app-replacement, the same entry still open with an unchanged id/start on **both** surfaces (`tt` + the core Store the GUI is a surface over), and the derived elapsed continuing to grow | **EXECUTED (headless)** | ✅ CONFIRMED | `acceptance/evidence/cli-transcript.md` → section **"§16 / §19 R04 — in-app update never touches the database (simulated app-replacement)"** |
| The Settings → Software Update **chrome** R03/R04 affordances — version row (R06), Check-now verdict + release link (R03), Download & install → progress bar → guided steps incl. the one-time Gatekeeper beat → Reveal installer (R04) — driven through the real renderer | **EXECUTED (headless, JUDGE)** | ✅ PASS | `acceptance/evidence/judge-report.json` → item **`SOFTWARE_UPDATE`**; screenshot `acceptance/evidence/screenshots/main-software-update.png`; recordings `19-r03.gif` / `19-r04.gif` / `software-update.gif` |
| The **download mechanism** (artifact selection per platform, size-verified stream to the temp dir never beside the DB, progress maths, the guided-step plan incl. Gatekeeper / no-Developer-ID) | GOLD | ✅ pinned offline | `packages/gui/test/update.test.ts`, `packages/gui/test/renderer-static.test.ts` |
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
