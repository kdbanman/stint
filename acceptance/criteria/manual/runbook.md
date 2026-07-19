# MANUAL runbook — physical & OS-level guarantees

The MANUAL method (acceptance.html §10) covers what genuinely cannot be faked in CI:
real sleep/wake, notification cadence over wall-clock time, the no-network promise,
and the tray + global hotkey on a real desktop session. Setup is scripted as far as
possible; an operator (human, or an agent with shell + GUI access) confirms each
step and attaches evidence.

Run the GUI with `npm run build && npm run gui` (requires an Electron binary with
bundled Node ≥ 22.5 — see PRD §15). The CLI and GUI share the same database, so
`tt` is used throughout to observe state.

---

## CHECK SLEEP-SPAN — second-accurate spans + working subtract (§10a, §17 R5)

1. `tt start "deep work" --client "Client A"`
2. Record start. Sleep the machine: `systemctl suspend` (or `rtcwake -m mem -s 120`,
   or the platform's sleep).
3. Wake after ~120 s. Note the suspend/resume times from the system log
   (`journalctl -u systemd-suspend` or Console.app).
   - [ ] The open entry is flagged slept-through (`tt sleep ls` lists it, source `event`).
   - [ ] `(resume − suspend)` matches the `powerMonitor` delta within 1 s.
   - [ ] `tt sleep subtract <id>` moves those seconds into `excluded_seconds`;
         billable duration drops by exactly the span; raw duration is unchanged.
   - [ ] Subtract is reversible — re-running restores the prior `excluded_seconds`.

## CHECK MISSED-SLEEP RECONCILE — wall-clock gap on launch (§10a, source=gap)

1. With a timer open, fully quit the app, sleep the machine ~120 s, wake, relaunch.
   - [ ] On launch a SleepSpan (source `gap`) is created from the wall-clock gap and
         the entry is flagged slept-through for review; the gap bounds the dead time.
   - [ ] Because the gap can't tell true sleep from app-closed time, the span is a
         flagged suspicion only — never auto-subtracted (the operator decides).

## CHECK CHECK-IN CADENCE + RELAUNCH (§10b, §17 R6)

1. Start a timer. (Use a compressed test cadence via `tt config set first_checkin_min 2`
   and `tt config set checkin_interval_min 1` to avoid waiting 60 min, but verify the
   real 60-then-30 defaults once in a long-form run.)
   - [ ] First check-in fires at start + first-interval; then every interval.
   - [ ] Ignoring one still fires the next on time (autonomous).
   - [ ] Quit the app across a due check-in, relaunch: it fires **once** on relaunch,
         then resumes cadence (no backlog).
   - [ ] After a long sleep, the next check-in realigns from wake — no flood.
   - [ ] When a check-in fires, the notification offers **Stop**, **Keep going**, and an
         inline set of interval choices (the OS-notification form of the "dropdown":
         `+15m / +30m / +60m / +120m`). Picking a choice (e.g. **+15m**) does **not** stop
         the timer and reschedules **only the next** check-in to that many minutes out;
         the check-in after that reverts to the configured default interval. Verify under
         the compressed test cadence: pick a choice, confirm the next fires at the picked
         interval and the one after returns to the default `checkin_interval_min`.

> The pure cadence math is already proven deterministically in
> `packages/core/test/prop/checkin.test.ts` and shown in the evidence transcript;
> this runbook confirms the wall-clock firing on real hardware.

## CHECK TRAY + GLOBAL HOTKEY (§12 R01/R2)

§12 R01 (G8) requires the tray's **single left-click to open the compact popover only**
— the old 3-item Start/Stop + Open Stint **dropdown action menu is removed**, and the
popover is the sole surface for those actions. Verify on a real desktop session (no
tray host headless, so this is the gating evidence for the tray's own click behavior).

1. With the app running, observe the tray/menu-bar title.
   - [ ] While a timer runs, the tray title counts up once per second.
   - [ ] Pressing the global hotkey (default `Ctrl+Alt+T`) from another application
         toggles the timer — stops if running, resumes the last entry if idle.
2. Click the tray icon and observe the click behavior (§12 R01).
   - [ ] A single **LEFT-click** opens the **compact popover only** — **no dropdown
         menu appears**.
   - [ ] The popover shows **Stop** while a timer runs, **Start** while idle, and
         **Open Stint** in both states — and **no Switch button** in either state.
   - [ ] One click on the popover's Stop/Start toggles the timer; Open Stint opens the
         main window.
   - [ ] A **RIGHT-click** yields at most a **minimal Quit-only OS menu** — it has **no
         Start / Stop / Open Stint** items.
   - [ ] There is **no 3-item dropdown action menu anywhere** (a left-click that shows a
         menu, or any timer action reachable from a tray dropdown, is a FAIL).

## CHECK START WITH ATTRIBUTES (§05 R1, §12 R1, §17 R8)

1. In the running app **with no timer running** (the start panel is idle-only — while a
   timer runs the Timer view offers only edit-or-stop, §12 R5 / issue #51), open the main
   window and reveal the Start form ("+ with details"). Enter a description, a **new**
   client and **new** project name, and two comma-separated tags.
   - [ ] The primary Start above stays a one-tap action (the form is opt-in, collapsed
         by default).
   - [ ] The **Billable** box was unchecked when the form opened and **checked itself as
         the client name landed** (the §05 R7 client-keyed default). Now **uncheck** it
         (the explicit override) and Submit.
   - [ ] A new entry opens immediately carrying the description, client/project label,
         and tags; it shows as non-billable.
   - [ ] The named client and project were created on demand (they appear in
         `tt client ls` / `tt project ls`).
2. From the CLI, `tt list --all --json` (or `tt status --json`).
   - [ ] The open entry's description, client, project, tags, and `billable: false`
         match exactly what the GUI form sent — the GUI attributed start and
         `tt start ... --client --project --tag --no-bill` are the same write through
         core (cross-surface parity).

> The Electron-free resolution is unit-proven in `packages/gui/test/start.test.ts`
> and the form wiring is screenshotted under JUDGE (`START_ATTRIBUTES`); this runbook
> confirms the real app shows the attributed entry and that `tt` reports it identically.

## CHECK MANUAL BACKFILL (GUI) (§05 R5)

The GUI's manual-add form is the equal-surface counterpart to `tt add`: it creates a
*completed* entry from explicit from/to times, resolving client/project names and
converting local time to UTC through the same core path the CLI uses.

1. In a real desktop session, open the main window and click **Add entry** in the
   toolbar. The inline backfill form appears.
2. Enter a description, optionally a client/project and tags, then set **From** and
   **To** to a past range earlier today (e.g. 09:00 → 10:30 local) and click **Save
   entry**.
   - [ ] The form closes and a new completed entry appears in the correct day column
         with the duration matching the from/to range (e.g. 1h 30m).
   - [ ] `tt list --all` shows the same entry with the same client/project, tags, and
         billable flag — the GUI add and `tt add` are the same write through core.
3. Add a second entry whose range **overlaps** the first (e.g. 10:00 → 11:00).
   - [ ] The entry still saves (the form closes) and the non-blocking overlap banner
         surfaces inline above the list (allowed-but-flagged wording), and both rows show
         the `overlap` flag in the list — overlap is warned, not blocked (§06 R4).
4. Open the form again and set **To** *before* **From**, then Save.
   - [ ] The save is rejected and the validation message ("--to must be after --from")
         shows in the form rather than crashing; no entry is created.

> The backfill arithmetic and validation are proven surface-neutrally over core+tt by
> the BDD "Backfill creates a completed entry" scenario and by GOLD/PROP; the form
> wiring is screenshotted under JUDGE (`ADD_FORM`) and bound back to `tt add` by the
> parity matrix. This runbook confirms the real app lands the entry in the right day
> group with the right duration and surfaces the overlap warning.

## CHECK MANUAL ADD FORM (GUI) — the unified entry form (add mode): drag-to-set span, Save as the sole commit, overlap warned-not-blocked (§12 R7, §12 R15/R17, §06 R4)

The §12 R7 manual-add surface is the **one unified entry form in ADD mode** — the same
two-column form edit mode uses. A human must be able to backfill a *complete* past entry
**with the terminal closed throughout**: drag the inline picker to set the span (the
Start/Stop values update live), fill the attributes, and click **Save entry** as the
*only* commit; an overlapping span is warned inline, not blocked.

1. In a real desktop session, open the main window and click **Add entry manually** in the
   Entries toolbar. The **two-column unified form** appears inline (no modal): on the LEFT a
   multiline **description** field, **client** and **project** selects, a **tag** chip input,
   and the **Billable** toggle; on the RIGHT the **inline interval picker** (a month calendar
   + a single-day column) over a collapsed **Start / Stop (exact times)** expander.
   - [ ] The form is inline in the window (no separate dialog/modal), and there is **no
         native date-time popover** anywhere on it.
2. **Drag the picker** to set the span: drag the accent block's **body** to move the whole
   span, and its **bottom edge** to set the stop (5-minute snap). Then fill a **description**,
   pick a **client** *and* **project**, add one or more **tags**, and set **Billable**.
   - [ ] As you drag, the **Start/Stop values update live** (expand the Start/Stop expander
         to watch them change) — the picker drives the form state; you never opened a second
         dialog to pick the time.
3. Click **Save entry** — the *only* commit.
   - [ ] The form closes and the completed entry appears on the **entries calendar** in the
         right day, with its client/project label, tag chips, billable state, and a duration
         matching the dragged span — all from the one form, no follow-up edit needed.
   - [ ] `tt list --all` (and `tt report`) show the identical entry — same client/project,
         tags, billable, and span. The GUI add and `tt add` are the same core write (parity:
         the `add` IPC channel ↔ `tt add`).
4. Open the form again and set a span that **overlaps** the entry you just created (e.g. drag
   the block over it). Save.
   - [ ] The entry **still saves** (the form closes) — overlap is *not* a block; the picker
         paints the overlap as a **yellow warn band** while the drag proceeds.
   - [ ] The non-blocking overlap banner appears inline above the calendar (the same
         allowed-but-flagged advisory the edit/start paths raise), and both overlapping rows
         carry the `overlap` flag in a report covering the day.

> The warned-not-blocked behaviour is proven surface-neutrally over core+tt by the BDD
> "Attribute-bearing backfill that overlaps is warned, not blocked" scenario; the GUI
> unified form (add mode) — its two-column field set, the inline picker driving the span
> live, Save as the sole commit, and the inline overlap banner — is screenshotted under
> JUDGE (`UNIFIED_FORM_ADD`, `unified-add.png`) and bound back to `tt add` by the parity
> matrix. This runbook confirms a human can land the full-attribute entry from the one form,
> terminal closed, at parity with `tt add`, and that an overlapping span is warned but saved.

## CHECK UNIFIED ENTRY FORM — EDIT, SPLIT & DELETE (GUI) (§12 R06)

Confirms the §12 R06 unified entry form (**edit mode**) end-to-end on a **real desktop**
against a **real DB**: one form — the same one add mode uses — surfaces every `tt`-editable
field **inline** in the Entries view (no modal), and its edit-mode footer reaches Split and a
two-step Delete. Every change round-trips to the same DB `tt` reads (the Electron host + the
OS-level DB round-trip have no Playwright host, so this is MANUAL). Run with `tt` in a second
terminal pointed at the same database.

1. Seed a closed entry: `tt add "design review" --from "2h ago" --to "1h ago" --client "Acme" --project API --tag deep`.
2. In the running main window, on the entries calendar **hover the event and click its Edit
   affordance** — then repeat, this time **clicking the event itself**.
   - [ ] **Both** open the **same unified entry form in edit mode**, and it opens **INLINE in
         the Entries view — no modal, no backdrop/dim** (the form sits in the view, in flow).
   - [ ] The form is **seeded from the entry**: a multiline **Description**, **Client** +
         **Project** selects (pre-selected), the **tag chips** (`deep`), the **Billable**
         toggle, and — under the collapsed **Start / Stop (exact times)** expander — the
         seeded **Start** and **Stop**.
3. Amend **each** field — edit the description, pick a different client/project, add and remove
   a tag, flip Billable, expand Start/Stop and nudge a time — then click **Save entry**.
   - [ ] Only **Save entry** carries the accent; Split, Cancel and Delete are quiet.
   - [ ] `tt list --json` shows **every changed field persisted**; the GUI and the DB agree
         (Save went through the same `edit` path `tt` uses, sending only the changed fields).
4. Re-open the form and, in the footer, click **Split**; in the plain-text instant field
   (`YYYY-MM-DDTHH:mm`, seeded to the span's midpoint — a simple text input, **no native
   date-time picker**, G4/G1), type an instant **inside** the span and confirm.
   - [ ] `tt list` shows **two contiguous** entries that exactly tile the original span (the
         boundary is the picked instant; no time is lost or gained), cross-checking `tt split`.
   - [ ] Picking an instant **outside** the span is rejected (core would reject it too).
5. Open the form on the **open (running)** entry and nudge its **Start**, then Save.
   - [ ] The open entry stays open — `tt status` still reports it running (the running variant
         has **no End**, so the patch never carries `endUtc`).
6. Re-open the form on any entry and, in the footer, click **Delete**.
   - [ ] The first click does **not** remove the entry — it **arms** a "Confirm delete?"
         affordance with a **Cancel**.
   - [ ] Click **Cancel**: the entry survives, the control returns to **Delete**.
   - [ ] Click **Delete** then the explicit **confirm**: the entry disappears from the GUI
         **and** from `tt list` — cross-checking `tt rm` (a stray first click never deletes).

> The edit/split/delete *behaviour* is proven surface-neutrally over core+tt by the BDD
> scenarios in `features/reachable_by_hand.feature` + `features/overlap_and_editing.feature`;
> the unified form (edit mode) is screenshotted headless under JUDGE (`UNIFIED_FORM`,
> `main-edit.png`) and guarded statically (`renderer-static.test.ts`). This runbook confirms
> the real inline form (no modal), the client/project selects, the footer Split, the two-step
> Delete, and the round-trip to `tt` on a real desktop — the OS residual no headless host covers.

## CHECK MERGE (GUI) — multi-select + conflict prompt folds entries into one (§06 R3, §12 R6)

1. Open the main window with at least two **adjacent closed** entries on the same day
   that **disagree** on client/billable — e.g.
   `tt add "api work" --from "3h ago" --to "2h ago" --client "Client A" --project API`
   then `tt add "internal sync" --from "2h ago" --to "1h ago" --no-billable` (no client).
   Confirm both events show on the entries calendar (in their day columns), each exposing a
   hover-corner **select** checkbox.
2. Tick the first entry's checkbox.
   - [ ] The **Merge** action stays hidden with only one entry selected.
3. Tick the second entry's checkbox.
   - [ ] The **Merge** action appears and reads **"Merge 2 entries"**.
4. Click **Merge**.
   - [ ] Because the two entries disagree, an inline **conflict prompt** appears asking
         which **client / project** to keep (offering each distinct client as a choice)
         **and** which **billable** value to keep — *before* anything is merged.
5. Pick the winning client/project and billable, then confirm **Merge**.
   - [ ] One merged row replaces the two, spanning the full combined time.
   - [ ] `tt list` shows the merged entry with the **chosen** client/project/billable,
         the two **descriptions concatenated**, and the **tags unioned** — the GUI and
         the DB agree (the merge went through the same `merge` path `tt` uses).
6. Now select two **contiguous** entries (one's end equals the next's start exactly) that
   **agree** on client and billable and click **Merge**.
   - [ ] No **conflict** prompt appears **and no gap confirm appears** — the merge fires
         directly (nothing to resolve, nothing fabricated). This is the no-*unnecessary*-
         question path, not proof the agree path never gates — step 7 gates a gapped agree.
7. Now select two **non-contiguous** entries (a positive **gap** between them — e.g. one
   09:00–10:00 and one 14:00–15:00) that **agree** on client and billable, then click
   **Merge**.
   - [ ] The merge does **not** fire on the first click. The **Merge** button swaps into a
         **confirm stating the resulting span and duration** (09:00 → 15:00, 6h) and the
         **gap** it would fold into billable time (4h), with a **Cancel**.
   - [ ] **Cancel** leaves both entries untouched — nothing merged, no time fabricated.
   - [ ] Click **Merge** again, then the explicit **Merge anyway**: one merged row replaces
         the two, spanning 09:00 → 15:00. `tt list` shows the 6h span — the gap was folded
         only because it was acknowledged. (The `tt` parity: `tt merge <a> <b>` exits
         non-zero naming the gap/span and suggesting `--allow-gap`; `tt merge <a> <b>
         --allow-gap` folds it.)

> The merge *behaviour* (concatenated descriptions, unioned tags, conflict override) is
> proven surface-neutrally over core+tt by the BDD merge scenarios in
> `features/overlap_and_editing.feature` and the GOLD merge-override contract; the GUI
> multi-select + conflict prompt is screenshotted under JUDGE (`MERGE_CONFLICT`,
> `main-merge-conflict.png`) and guarded statically (`renderer-static.test.ts`); the
> contiguity gate is guarded surface-neutrally by the BDD gapped-merge scenarios and by
> JUDGE (`MERGE_GAP`, `main-merge-gap.png`). This runbook confirms the real checkboxes, the
> live prompt, the gap confirm, and the round-trip to `tt` on a real desktop.

## CHECK MERGE VIA CALENDAR CHECKBOXES (GUI) — corner-checkbox selection on the entries calendar (§06 R03, §12 R16)

The merge selection surface is the **readonly entries calendar** (§12 R16): each closed
event carries a **hover-corner checkbox**, and checking any box enters **multi-select
mode** — every closed event reveals its checkbox and the per-event hover Delete/Split/Edit
are suppressed while selecting. The conflict prompt is hosted in `app.js`. Running (open) events have no end, so they offer no checkbox.

1. Open the main window (Entries view) with at least two **adjacent closed** entries on the
   same day that **disagree** on client/billable — e.g.
   `tt add "api work" --from "3h ago" --to "2h ago" --client "Client A" --project API`
   then `tt add "internal sync" --from "2h ago" --to "1h ago" --no-billable` (no client).
2. Hover the first event and **check its corner checkbox**.
   - [ ] The calendar enters **multi-select mode**: every closed event now shows its corner
         checkbox, and the hover Delete/Split/Edit affordances are suppressed.
   - [ ] The selection bar's **Merge** action stays hidden with only one event checked.
3. Check the second (contiguous) event's corner checkbox.
   - [ ] The selection bar appears and reads **"Merge 2 entries"** (the live count).
4. Click **Merge**.
   - [ ] Because the two entries disagree, the **conflict prompt** (a modal, not an inline
         panel) appears asking which **client / project** to keep and which **billable**
         value to keep — *before* anything is merged.
5. Pick the winning client/project and billable, then confirm **Merge**.
   - [ ] Exactly **one merged event** replaces the two on the calendar, spanning
         **earliest start → latest end**.
   - [ ] `tt list` shows the merged entry with the **chosen** client/project/billable, the
         two **descriptions concatenated**, and the **tags unioned** — the GUI and the DB
         agree (the merge went through the same `merge` path `tt` uses).
6. Uncheck all boxes (or complete the merge): the calendar **exits multi-select mode** and
   the per-event hover affordances return.

> The corner-checkbox selection + app.js-hosted prompt is screenshotted under JUDGE
> (`MERGE_CONFLICT` / `MERGE_NOCONFLICT`) and recorded under §W (`§06 R03`); the merge
> *arithmetic* (concatenated descriptions, unioned tags, winner override) is proven
> surface-neutrally over core+tt by the BDD merge scenarios in
> `features/overlap_and_editing.feature`.

## CHECK OVERLAP BANNER (GUI) (§06 R4, §12)

Confirms the **at-write-time** overlap signal: a write that creates an overlap surfaces
a non-blocking inline banner at the moment of the edit (the harness drives this through a
mock; this confirms the live wiring on a real DB).

1. Create two entries where one will overlap the other:
   `tt add "morning" --from "10:00" --to "12:00" --client "Client A"`.
2. In the running app, open the **morning** entry's inline **Edit** and change its
   **Start** so it overlaps a second existing entry (or add the second entry first via
   the **Add entry** form with overlapping times). Save.
   - [ ] An inline **banner** appears at the top of the window reading roughly *"This
         entry overlaps N other entr… — allowed, but flagged in reports."*
   - [ ] The write **still committed** — the banner does not block the edit; the entry
         shows its new time.
   - [ ] The affected row now carries the durable **overlap** flag (the banner is the
         transient signal; the row flag is the durable one).
   - [ ] The banner **auto-clears** on the next non-overlapping write/refresh (edit
         another entry so it no longer overlaps, or reload state) — it is transient.
   - [ ] A screen reader announces the banner (it is `role=status` / `aria-live=polite`).

> The overlap *detection* (warned, not blocked; both entries flagged downstream) is
> proven surface-neutrally over core+tt by the BDD scenario "Backfill that overlaps an
> existing entry is warned, not blocked" in `features/overlap_and_editing.feature`, and
> the GUI banner is screenshotted headless under JUDGE (`OVERLAP_BANNER`,
> `main-overlap-banner.png`). This runbook confirms the banner fires from a real write on
> a live desktop session.

## CHECK REPORT BILLABLE TOGGLE (GUI) (§08 R3, §12 R8)

Confirms the report builder's three-way **Billable** filter on a live DB, and that each
position matches the equivalent `tt report` output (cross-surface parity that JUDGE's
headless mock cannot exercise — JUDGE proves the affordance with a canned `report` mock).

1. Seed this week with a billable and a non-billable entry:
   `tt add "client work" --from "Mon 09:00" --to "Mon 14:00" --client "Acme"` (billable),
   and `tt add "admin" --from "Tue 10:00" --to "Tue 13:00"` (clientless ⇒ non-billable).
2. In the running app, open the **Report** view (the *This week* button in the toolbar).
   - [ ] The **Billable** control shows three segments — **Billable only**, **All**,
         **Non-billable** — with **Billable only** active by default.
   - [ ] The grouped total reads the **billable-only** figure (5h 00m here) and matches
         `tt report --week` (default billable-only).
3. Click **All**.
   - [ ] Only **All** is now marked active; the total grows to include the non-billable
         time (8h 00m here) and matches `tt report --week --all`; the rows now include the
         non-billable group.
4. Click **Non-billable**.
   - [ ] Only **Non-billable** is now marked active; the total shows just the
         non-billable time (3h 00m here) and matches `tt report --week --non-billable`.

> The billable-filter arithmetic itself is core's `filterByBillable` (PROP/GOLD/BDD over
> core + `tt`); this runbook confirms the GUI toggle is wired to the same `report`
> capability and agrees with `tt report --all` / `--non-billable` on a real session. JUDGE
> screenshots the affordance headless (`REPORT_BILLABLE_TOGGLE`, `report-billable.png`).

## CHECK REPORT RANGE PICKER (GUI) (§09 R1, §12 R8)

Confirms the report view's date-range picker on a live DB drives the same windows `tt`
resolves — preset *and* custom — so the GUI picker and `tt report` agree (cross-surface
parity, R8, that JUDGE's canned `report` mock cannot exercise).

1. Seed a couple of entries spanning two weeks against a known DB:
   `tt add "this-week work" --from "Mon 09:00" --to "Mon 14:00" --client "Acme"` and
   `tt add "last-week work" --from "Mon 09:00 -7d" --to "Mon 12:00 -7d" --client "Globex"`
   (adjust the `-7d` offsets to land the second entry clearly in the previous week).
2. In the running app, open the **Report** view (the *This week* button in the toolbar).
   - [ ] A row of range chips shows **Today / This week / Last week / This month /
         Last month / Custom…**, with **This week** active by default.
   - [ ] The resolved-range header reads the same window as `tt report --week` (its
         `range.from_utc → range.to_utc`), and the grouped total + rows match
         `tt report --week` exactly.
3. Click **Last week**.
   - [ ] Only **Last week** is now active; the resolved-range header and the rows change to
         the previous week, matching `tt report --last-week` (header window, total, and
         per-client rows all agree).
4. Click **Today**, **This month**, **Last month** in turn.
   - [ ] Each repaints the resolved-range header + rows to match the corresponding
         `tt report --today` / `--month` / `--last-month` output.
5. Click **Custom…** and enter the **two plain dates** (§09 R1 / G3: a from-day and a
   to-day, `YYYY-MM-DD`, **no time component** — the two fields are date pickers, not
   datetime inputs) covering only the last-week entry's day(s), then Save and **Run** the
   definition.
   - [ ] The resolved-range header covers **the from-day from 00:00 local through the END
         of the to-day** (the window closes at 00:00 local the day *after* the to-day —
         the to-day is included in full), and the total/rows match
         `tt report --range <FROM> <TO>` for those same resolved local-midnight bounds.
   - [ ] An entry late in the evening of the to-day is **included**; one on the following
         day is **excluded** (inclusive end day, half-open window).

> The preset→window resolution lives in core's `resolveRange` (BDD `features/reports.feature`
> runs the same This-week / Last-week / custom / group-by-client contract over core AND tt),
> and the plain-date pair → local-midnight window rule lives once in `gui/src/reportview.ts`
> `resolveDateRange` (BDD `features/reporting.feature` "A custom range is a pair of plain
> dates covering both boundary days" proves the window surface-neutrally; GOLD
> `gui/test/reportview.test.ts` pins the local-midnight/inclusive-end-day/DST math); this
> runbook confirms the GUI picker calls into it and agrees with `tt report --<preset>` /
> `--range` on a real session. JUDGE screenshots the affordance headless
> (`REPORTS_VIEW`, `reports-list.png` / `reports-run.png`).

## CHECK REPORT EXPORT (GUI) — the TWO export scopes each match their `tt` twin (§09 R06/R09, §12 R8)

Confirms the Reports view's **two distinct exports** (issue #72) each write a real file through
the OS save dialog whose **bytes match the matching `tt` command** — the cross-surface byte-for-
byte parity JUDGE cannot exercise (the native save dialog has no Playwright host, the same
rationale as the global-hotkey MANUAL case). The two scopes are **the report's own filtered
export** (the rows it shows) and **Export All Data** (every raw entry in the range).

1. Seed a few entries this week against a known DB, e.g.:
   `tt add "auth refactor" --from "Mon 09:00" --to "Mon 12:00" --client "Acme" --project "API" --tag deep`
   and `tt add "admin" --from "Tue 09:00" --to "Tue 09:30" --no-bill`.
   Then save a **billable-only** report over this week:
   `tt report save "This week" --week --by client` (the default filter is billable).
2. In the running app, open the **Reports** view (the *This week* button in the toolbar), and
   **Run** the "This week" saved report.
   - [ ] The on-screen grouped summary shows the **billable** entries with their per-line totals
         and a grand total (the non-billable `admin` is **absent** — it fails the report's filter),
         and any overlap / unreviewed-sleep entries carry their flag **inline on the affected row**
         (not in a separate list).
3. In the run-output, click the report's own **Export CSV**, accept the suggested filename in the
   native save dialog, and save.
   - [ ] A status line confirms the write (`Exported N entries to <path>.`).
   - [ ] `diff <path> <(tt report run "This week" --csv)` reports **no differences** — the file is
         the **filtered** rows the report shows (the billable `auth refactor` only; **no `admin`**).
4. Click the report's **Export JSON**, save to a second file.
   - [ ] `diff <path.json> <(tt report run "This week" --json)` reports **no differences**.
5. Scroll to the **bottom** of the view and click **Export All Data (CSV)**, save to a third file.
   - [ ] The status line reads `Exported N entries (all data) to <path>.` (the honest "all data"
         wording, so the raw scope is never mistaken for the report's rows).
   - [ ] `diff <path> <(tt export --week --csv)` reports **no differences** — the file is **every**
         raw entry in the range, **including the non-billable `admin`** (billable='all', no narrowing).
6. Click **Export All Data (JSON)**, save to a fourth file.
   - [ ] `diff <path.json> <(tt export --week --json)` reports **no differences**.
7. Cancel the save dialog on a further Export click (either scope).
   - [ ] No file is written and the status line reads `Export canceled.` (the cancel path
         is non-destructive — the renderer never reaches `fs`; main owns the write).

> The export bytes themselves are core's `toCsv` / `toJsonEntries` (GOLD `gold/contracts.test.ts`
> + the GUI `reportview.test.ts` proves `exportPayload` and both `resolveExportDefinition` scopes
> are byte-identical to them); this runbook confirms the GUI round-trips through main's
> `exportEntries` handler + the OS save dialog and lands, for each scope, a file equal to its `tt`
> twin on a real session. JUDGE screenshots the summary + both export controls headless
> (`REPORTS_VIEW`, `reports-run.png`) but cannot drive the native save dialog.

## CHECK REPORT BUILDER (GUI) — rounding the line + flags, cross-checked against `tt report` (§09 R4, §12 R8)

Confirms the report view's **Rounding** control and the on-screen grouped summary match
`tt report` for the SAME range on a real session — the cross-surface agreement the
surface-neutral BDD (`features/reporting.feature`) proves on core + tt, here exercised
through the real GUI chrome against a real DB. Rounding rounds the displayed grouped line
**nearest** the chosen increment (NOT always up) and **never** alters stored time.

1. Seed a 1h 37m (97-minute) entry plus an overlapping pair against a known DB, e.g.:
   `tt add "long block" --from "Mon 09:00" --to "Mon 10:37" --client "Acme" --project "API"`,
   `tt add "review" --from "Tue 09:00" --to "Tue 11:00" --client "Acme" --project "API"` and
   `tt add "call" --from "Tue 09:30" --to "Tue 10:00" --client "Acme" --project "API"` (the
   second pair overlaps on Tuesday).
2. In the running app, open the **Report** view and leave the range on **This week**.
   - [ ] The on-screen grand total and the "long block" line read the **exact** time (1h 37m)
         while the Rounding toggle is **off**, matching `tt report --week` (no `--round`).
   - [ ] The overlapping Tuesday pair carries the **overlap flag inline on the affected rows**
         (not a separate list), matching the `overlapped_entry_ids` in `tt report --week --json`.
3. Turn the Rounding toggle **on** (default increment *nearest 15 min*).
   - [ ] The "long block" line moves to **1h 30m** — 97m rounds DOWN to the nearest 15, not up —
         matching `tt report --week --round 15`. The Tuesday lines are unchanged at clean totals.
   - [ ] Switch the increment to *nearest 30 min*: the line stays **1h 30m** (nearest 30 of
         1h 37m), matching `tt report --week --round 30`.
4. Confirm rounding is display-only: with rounding still on, run `tt list --all` (or reopen the
   entry editor).
   - [ ] The "long block" entry's **stored** billable duration is still **1h 37m** (5820s) — the
         rounded line never wrote back to the entry (PRD §09 R4 / §17 R4).

> The rounding arithmetic is core's `roundSeconds` over the grouped line (GOLD
> `gold/contracts.test.ts` + the §17 R4 stored-time-untouched PROP); the GUI toggle/increment
> only choose it and persist through `setSetting` (the same `tt config set` uses). JUDGE
> screenshots the toggle headless (`ROUNDING_TOGGLE`, `reports-rounding.png`) and the BDD
> (`features/reporting.feature`) proves the rounded line + overlap flag on core AND tt; this
> runbook confirms the two surfaces agree end-to-end on a real desktop the headless host cannot.

## CHECK NO NETWORK (§17 R9)

1. Run the app + `tt` through a full session under a network monitor
   (`lsof -i`, `ss -tunap`, or a packet monitor), exercising every feature.
   - [ ] Zero outbound connections from the app or `tt` for the whole session.
   - [ ] The app opens no listening or outbound sockets; no telemetry, update-check,
         or analytics code path exists.

> A cheap GOLD backstop runs in CI (`npm run verify:no-network`) — scanning the
> shipped source and production dependency tree for any networking import or
> outbound-request code path. This live-traffic confirmation stays manual.

## CHECK GUI-SEARCH — live free-text narrowing of the history list (§09 R7)

The search filter itself is core's `listEntries({ search })`, proven surface-neutral on
core AND tt by `features/search.feature` (matches description / client / project / tag,
case-insensitively, composes with a range) and pinned by GOLD (`gold/contracts.test.ts`,
`cli/test/gold/cli.test.ts`). The renderer wiring (the search box re-querying the `search`
IPC and repainting) is OS-presentation that headless CI does not assert; this confirms it
on a real session.

1. Seed a few entries this week against a known DB, e.g.:
   `tt add "auth refactor" --from "Mon 09:00" --to "Mon 11:00" --client "Acme" --project "Billing" --tag deep`
   and `tt add "deploy pipeline" --from "Mon 11:00" --to "Mon 12:00" --client "Globex" --project "Ops" --tag ci`.
2. In the running app, on the Timer view, type `refactor` into the toolbar search box.
   - [ ] The day-grouped list narrows **live** to just "auth refactor" as you type (no
         Enter / button needed).
3. Clear the box, then type `globex` (a client name) and `ci` (a tag).
   - [ ] Each narrows the list to the entry whose client / tag matches — search hits
         description, client, project, AND tag, not just the description.
   - [ ] Matching is case-insensitive (`GLOBEX` narrows the same as `globex`).
4. Clear the search box entirely.
   - [ ] The full day-grouped list is restored (an empty query falls back to the whole
         window, exactly as first loaded).

> Cross-surface agreement: the same queries against `tt list --search <query>` /
> `tt report --search <query>` return the same entries / totals (full parity, §17 R8).

## CHECK ENTRIES CALENDAR — RANGE, FILTERING & SEARCH (GUI) — the §12 R9 toolbar at parity (§12 R9, §12 R16, §17 R8)

The filtering/search model is core's `buildEntryList` + `store.listEntries`, proven
surface-neutral on core AND tt by `features/entry_list.feature` (range/client/project/tag
filters) + `features/search.feature` (free-text search — run TWICE) and pinned by GOLD
(`core/test/entrylist.test.ts`, `cli/test/gold/cli.test.ts` `tt list --search`). There is
**no grouping** in the Entries view — grouped breakdowns live in Reports (§09 R2 /
`tt report --by`, G11); the toolbar only narrows *which* entries the readonly calendar
(§12 R16) lays into its day columns. The renderer wiring (the Entries toolbar re-querying
`window.stint.listEntries` and repainting the calendar) is OS-presentation headless CI does
not fully assert; this confirms it live and cross-checks it against `tt list` with
equivalent flags.

1. Seed a few entries this week against a known DB, e.g.:
   `tt add "auth refactor" --from "Mon 09:00" --to "Mon 11:00" --client "Acme" --project "Billing" --tag deep`,
   `tt add "deploy pipeline" --from "Tue 11:00" --to "Tue 12:00" --client "Globex" --project "Ops" --tag ci`,
   `tt add "standup" --from "Tue 08:00" --to "Tue 08:30" --client "Acme" --project "Billing" --tag meeting`.
2. In the running app, open the Entries view.
   - [ ] The content is the **readonly entries calendar** (§12 R16) — fixed-width day columns
         with per-day billable totals in the headers and a range-total chip — and there is
         **no Group-by control** (grouping left this view for Reports, §09 R2 / G11).
3. Pick a **range preset** (e.g. This week), then switch to **Custom…** and enter the **two
   plain dates** (§09 R1 / G3: from-day and to-day, no time component) covering only one day.
   - [ ] The list narrows **live as soon as both dates are set** — there is no Apply button.
   - [ ] Only the in-range entries remain (the to-day included in full, the next day
         excluded); the preset/custom window matches `tt list --week` /
         `tt list --range FROM TO` over the same resolved local-midnight bounds.
4. Apply a **client**, then a **project**, then a **tag** filter.
   - [ ] The list narrows to the chosen client / project / tag, matching
         `tt list --client … / --project … / --tag …`.
5. Type into the **search** box (e.g. `refactor`, then a client name, then a tag).
   - [ ] The visible calendar events narrow **live** (no Enter needed) to the matching
         entries; matching is case-insensitive and hits description / client / project / tag,
         matching `tt list --search <query>` (composed with the active range + filters).
6. Clear the search and reset the controls to **This week / no filters**.
   - [ ] The plain readonly calendar is restored, identical to the first load.

> Cross-surface agreement (full parity, §17 R8): every Entries-view range/filter/search
> reproduces `tt list --range/--client/--project/--tag/--search` exactly — the GUI
> toolbar reaches nothing tt cannot.

## CHECK CONFIRM DESTRUCTIVE (GUI) — a destructive action confirms in the window (§12 R13)

§12 R13 requires that destructive actions confirm in the window — the GUI counterpart to
`tt rm`'s confirm / `--force` — so **no entry is destroyed on a single stray click without
a confirm step**. The confirm gate is a renderer-only fact the surface-neutral BDD harness
cannot express (core/tt have no dialog); the destructive op itself (`tt rm`) is already
BDD-covered. JUDGE `CONFIRM_DELETE` (`main-confirm-delete.png`) and the renderer-static
guard prove the gate in headless CI; this confirms it on a real desktop/DB.

1. Open the main window with at least one entry (or `tt add "design review" --from "2h ago"
   --to "30m ago" --client "Acme"`). Confirm the event shows in its day column, and note the
   row count in `tt list`.
2. On the entry's calendar event, click **Delete** (the event's hover Delete, or the unified
   editor's footer Delete).
   - [ ] The entry is **not** removed — the button swaps into an in-window confirm
         affordance ("Confirm delete?") with a destructive **Delete** and a **Cancel**.
   - [ ] `tt list` still shows the entry (the stray first click destroyed nothing).
3. Click **Cancel**.
   - [ ] The confirm affordance reverts to the plain **Delete** button; the entry survives,
         in the GUI **and** in `tt list`.
4. Click **Delete** again, then the confirm **Delete**.
   - [ ] The entry disappears from the GUI **and** from `tt list` — removed exactly once,
         only after the explicit confirm.

> The referenced **client/project archive** confirmation (R13's second clause — archiving a
> client/project that still labels entries) reuses the same in-window confirm gate, but is
> **deferred until the Clients management view (§12 R10) lands** — there is no GUI archive
> control to confirm yet, so only entry Delete is reachable for this check today. When the
> Clients view ships, extend this procedure to cover archive-when-referenced.

## CHECK KEYBOARD & FOCUS (GUI) — the window is fully operable from the keyboard (§12 R14)

§12 R14 requires every control to be **keyboard-reachable and focus-visible**, and the window
to be **fully operable from the keyboard** while respecting the OS theme. JUDGE
`KEYBOARD_FOCUS` (`main-focus.png`) Tab-walks the empty + running main windows in headless
Chromium and asserts every visible control is reached and shows a ring; the renderer-static
guard pins the `:focus-visible` ring + the toggle's aria hooks per commit. This MANUAL check
covers what headless Chromium **cannot**: the **real OS focus ring** (the platform's own
high-contrast halo, which Chromium does not render headless), real **assistive-technology**
announcements, and the **popover** (no tray host in CI), on a real desktop session — matching
the tray/hotkey residual-risk pattern.

Run with **no mouse** — keyboard only — on a real desktop. Have at least one slept entry and
one closed entry in range (`tt add "design review" --from "3h ago" --to "1h ago"`), plus a
running timer for part of the walk (`tt start "auth refactor"`).

1. Open the **main window** and press **Tab** repeatedly from the top.
   - [ ] Focus moves through the controls in **reading order**: the left nav rail
         (Timer → Entries → … → Settings), then the toolbar (Start/Stop, This week, the
         disclosures, search), then each entry row's actions (Subtract sleep / Edit / Edit
         tags / Split / Delete), then the merge bar — **never skipping** a control and never
         jumping out of order.
   - [ ] **Every** focused control shows a **clearly visible focus ring** (the OS/system ring),
         and the ring is the **neutral** gray on ordinary controls — only the **primary**
         Start/Stop (and the running clock/state) carries the **accent** (accent discipline).
   - [ ] Focus is **never lost into the void** — it never lands on nothing / the bare window
         background, and never gets **trapped** so Tab stops advancing.
2. With a control focused, press **Enter** and **Space**.
   - [ ] The control **activates** (e.g. Start/Stop toggles the timer; This week opens the
         report; an entry's Delete arms its confirm) — exactly as a click would.
3. Open a disclosure/editor (e.g. **+ with details**, or a row's **Edit**) from the keyboard,
   then press **Esc** / Tab back out.
   - [ ] Focus moves **into** the revealed form and back **out** sensibly — no trap, and the
         previously-focused control (or a sane fallback) holds focus after a re-render (a `tt`
         write that repaints the list must not dump focus into the void).
4. Open the **tray popover** (click the tray, or the global hotkey) and Tab through it.
   - [ ] **Stop/Start** and **Open Stint** are each reachable in order with a visible ring,
         and Enter/Space activates each.
5. With a screen reader on (VoiceOver / Narrator / Orca), focus the **Start/Stop** toggle and
   toggle the timer.
   - [ ] The screen reader **announces the toggle's state** — its accessible name flips
         between "Start timer" and "Stop timer" and its **pressed/running** state is announced
         (the `aria-label` + `aria-pressed` the renderer keeps current), so the running/idle
         state is conveyed without sight.
6. Switch the OS between **light and dark** while the window is
   open.
   - [ ] The window follows the theme and the focus ring stays visible/legible in both, and the
         accent ring on the primary action stays legible against both themes.

## CHECK ALL CAPABILITIES REACHABLE BY HAND (GUI) — the whole workflow with the terminal closed (§17 R10)

R10 is the end-to-end completeness claim: a non-terminal freelancer can do **everything**
`@stint/core` offers from the **window alone**. The CI nets prove each capability is real
and at parity (BDD `features/reachable_by_hand.feature` over core + tt), that every GUI
channel has a by-hand-equivalent tt path (GOLD `parity-matrix.json`), and that each view
renders its controls (renderer-static + JUDGE screenshots). This MANUAL walk is the human
confirmation that the *real desktop app*, **with no terminal open**, threads all of them
together — the dimension headless CI cannot drive (real OS, real DB, real dialogs).

> Close every terminal/`tt` shell first. **Do not run `tt` at any point in this check** — if
> a step forces you to the terminal, R10 has a gap. (You may open one read-only `tt list`
> shell on a *second machine / after the walk* purely to cross-check, never to perform a step.)

1. From an **empty** main window, read the Timer view's empty state, then use the **Start
   form** to start a timer with a **description**, a **client created on the fly**, a
   **project** scoped to that client, a **tag**, and the **billable** toggle — then Start.
   - [ ] The timer starts immediately fully attributed; no later edit was needed (§12 R5).
     With the timer now running, look for a start control.
   - [ ] The Timer view offers **only edit-or-stop of the running entry** — the start
         panel (one-tap Start + the form) is hidden and exactly one Description field
         (the live-edit strip's) paints (§12 R5 / issue #51). Press **Stop**, then start
         a **second entry** from the reappeared Start form (new description) — switching
         by hand is stop, then start; no separate switch verb exists.
2. Open the **Manual-add** form and **backfill** a completed past entry from explicit
   from/to times plus a description + client/project + tag.
   - [ ] The completed entry appears in the list, fully attributed, no terminal used (§12 R7).
3. Open a row's **editor** and (a) **amend** a field, (b) **Split** a span at an instant,
   (c) multi-select two adjacent rows and **Merge** them (resolving the conflict prompt if
   the selection disagrees), (d) **Delete** a row through its two-step confirm.
   - [ ] Each of edit / split / merge / delete completes entirely in the window (§12 R6/R13).
4. In the **Entries** view, apply a **range preset** (or a Custom plain-date range) and a
   **client/project/tag filter**, and type in the **search** box — grouping lives in Reports,
   not here (G11).
   - [ ] The readonly entries calendar (§12 R16) narrows and searches live — no terminal (§12 R9).
5. In the **Reports** view, pick a range, choose a **group-by**, toggle **billable** and
   **rounding**, read the on-screen grouped totals, then use the report's own **Export CSV /
   JSON** (its filtered rows) and the bottom **Export All Data** (every raw entry in the range).
   - [ ] The summary updates; both scopes write files via the OS save dialog, each with an
         honest status line ("Exported N entries" vs "…(all data)") (§12 R8, §09 R06/R09).
6. In the **Clients** view, **create / rename / archive** a client and a project, and from
   the **Tags** strip **create / rename / archive** a tag.
   - [ ] Each mutation lands; archived records drop from the active pickers but referenced
         entries keep their labels — all by hand (§12 R10).
7. In the **Settings** view, change **every §14 setting** (rounding + increment, week start,
   first check-in, check-in interval, global hotkey, date format).
   - [ ] Each setting persists immediately and the relevant control reflects it (§12 R11).
9. Final tally:
   - [ ] You completed start-with-attributes → backfill → edit/split/merge/delete →
         entries range/filter/search → report builder + CSV/JSON export → client/project/tag
         create/rename/archive → every setting **without once opening a terminal**. R10 holds.

## CHECK DESTRUCTIVE CONFIRM + LIVE FILTER (§17 R11)

R11 has two halves, both renderer facts the headless JUDGE drives but only the **real
desktop window** confirms with a real OS theme/DB/dialog: (a) destructive actions
**confirm before acting** — no entry is destroyed on a single stray click; and (b)
**search / filter** selections on the Entries calendar are reflected **live in the calendar
AND its total** (and grouping selections live in the Reports totals), recomputed from the
in-memory snapshot with no reload. JUDGE proves both headless
(`CONFIRM_DESTRUCTIVE` → `main-confirm.png`, `LIVE_FILTER` → `main-filtered.png`); this is
the by-hand confirmation on a real window.

1. With a few entries in the list, click a row's **Delete**.
   - [ ] The button swaps into an explicit confirm affordance ("Confirm delete?" + a
         destructive Delete + a Cancel); the entry is **still present** — nothing was
         destroyed by that first click.
2. Click **Cancel**.
   - [ ] The original Delete button is restored untouched and the entry remains.
3. Click **Delete** again, then the explicit **confirm**.
   - [ ] The entry is removed — and only now. Cross-check with a read-only `tt list` (on a
         second machine / after the walk) that exactly that entry is gone.
4. (When the Clients view's archive control ships) archive a client/project that is **still
   referenced** by a past entry.
   - [ ] Archiving asks for confirmation first; confirming hides it from the active pickers
         while the referenced entry keeps its label (the same confirm gate, reused).
5. In the **Entries** view, watch the **This week** total (`#week-total`) and the list while
   you **type in the search box**.
   - [ ] On each keystroke the visible rows narrow to the matches **and** the total updates
         in lockstep to the billable sum of the surviving rows — instantly, no flicker or reload.
6. Toggle the **billable** filter on the Entries toolbar.
   - [ ] The visible calendar events and the total re-sum live, and the figure matches
         `tt list` / `tt report` run with the equivalent flags for the same selection.
7. Clear the search and reset the filters.
   - [ ] The list and the total both return to the full week — the live view and the plain
         load agree.

## CHECK CLIENTS & PROJECTS MANAGEMENT (GUI) — create / rename / archive in-window at parity (§12 R10, §07)

§12 R10's Clients view manages reference data **entirely in the window** — create, rename, and
archive clients and their projects — at parity with `tt client` / `tt project`. Archiving is a
**reversible hide**: an archived client/project drops from the active pickers/lists but referenced
past entries keep their label (history is preserved). The mutator behaviour is proven
surface-neutrally over core + tt by `features/reference_data.feature`; the view is screenshotted
headless under JUDGE (`main-clients.png`). This runbook confirms the real in-place editors and the
round-trip to `tt` on a real desktop/DB. Run with `tt` in a second terminal on the same database.

1. In the running app, click the **Clients** nav item. With no clients it reads an instructive
   empty state. Click **Add client** and name a new client (e.g. "Globex").
   - [ ] The client appears in the list, and `tt client ls` shows it (the GUI add and `tt client
         add` are the same write).
2. On the new client's row, click **Add project** and name a project (e.g. "Billing").
   - [ ] The project appears under that client, and `tt project ls --client Globex` shows it.
3. Click the client's **Rename**, change the name in the inline editor, and commit (Enter).
   - [ ] The row shows the new name immediately, and `tt client ls` reflects the rename — no
         separate window, no terminal.
4. Rename the **project** the same way.
   - [ ] `tt project ls` shows the renamed project; any entry already labelled with it still
         resolves to the new name (the label is resolved, not copied).
5. Attribute a past entry to this client/project so it is **referenced**
   (`tt add "billing work" --from "2h ago" --to "1h ago" --client Globex --project Billing`), then
   click the project's **Archive**, then the client's **Archive**.
   - [ ] Each archived item **drops out** of the Clients view's active list and out of the active
         pickers (the Add-entry / Start form client/project lists), matching `tt client ls` /
         `tt project ls` (which exclude archived by default).
   - [ ] The **referenced past entry keeps its label** — `tt list --all` still shows it attributed
         to the (now archived) client/project; archiving hid the record without rewriting history
         (`tt client ls --all` / the include-archived path still lists it).

> Create/rename/archive parity is proven over core + tt by `features/reference_data.feature` and
> the parity matrix rows (`addClient`/`renameClient`/`archiveClient` ↔ `tt client …`,
> `addProject`/`renameProject`/`archiveProject`/`listProjects` ↔ `tt project …`); JUDGE screenshots
> the view headless (`CLIENTS_VIEW`, `main-clients.png`). This runbook confirms the live in-place
> editors and that archiving hides-but-keeps on a real DB the headless host cannot drive.

## CHECK TAGS MANAGEMENT (GUI) — the tag strip create / rename / archive at parity (§12 R10)

The Clients view's **Tags strip** manages the cross-cutting tag vocabulary in-window — list,
create, rename, archive — at parity with `tt tag`. Tags are otherwise born on the fly when applied
to an entry; the strip is the explicit **manage-them-first** path. Archiving a tag hides it from the
active list/pickers while entries already carrying it keep it (history preserved). Parity is proven
over core + tt by `features/reference_data.feature`; the strip ships inside the Clients view, so it
is screenshotted headless under JUDGE alongside it (`CLIENTS_VIEW` / `main-clients.png`). This
runbook confirms the live editors and the round-trip to `tt`.

1. In the **Clients** view, find the **Tags** strip below the clients list. With no tags it reads
   an instructive empty state. Click **Add tag** and name one (e.g. "deep").
   - [ ] The tag appears in the strip, and `tt tag ls` shows it (the GUI add and `tt tag add` are
         the same create-or-return write).
2. Click the tag's **Rename**, change the name inline, and commit.
   - [ ] The strip shows the new name immediately and `tt tag ls` reflects the rename.
3. Apply the tag to a past entry (`tt add "tagged work" --from "2h ago" --to "1h ago" --tag deep`),
   then click the tag's **Archive**.
   - [ ] The tag **drops out** of the active strip and out of the active tag pickers, matching
         `tt tag ls` (which excludes archived by default).
   - [ ] The **entry already carrying the tag keeps it** — `tt list --all` still shows the entry
         tagged; archiving hid the tag from pickers without stripping history.

> Tag create/rename/archive parity is proven over core + tt by `features/reference_data.feature`
> and the parity rows (`listTags`/`addTag`/`renameTag`/`archiveTag` ↔ `tt tag …`); JUDGE screenshots
> the strip headless inside the Clients view (`CLIENTS_VIEW`, `main-clients.png`) and pins its
> controls via the renderer-static guard. This runbook confirms the live in-place editors and the
> hide-but-keep on a real DB.

## CHECK SETTINGS VIEW (GUI) — every §14 setting persists to the same DB `tt config` reads (§12 R11, §14)

§12 R11's in-window Settings view exposes **every §14 setting** as an editable control, each
persisting over the **same `setSetting` IPC `tt config set` uses** (parity-covered — no new
channel), so an edit is immediately the new truth on **both** surfaces. Most of the arithmetic each
setting drives is already proven elsewhere (rounding/week-start in reporting, check-in cadence in
the cadence PROP); this MANUAL check covers what the headless host **cannot**: the live
**re-registration of the global hotkey**, the **date-format** mode re-painting
the real window against the real OS theme, and the round-trip of every control to the same DB `tt`
reads. Run with `tt` in a second terminal on the same database.

1. In the running app, click the **Settings** nav item. The panel shows the §14 settings grouped
   **Reporting / Check-ins / System**: Rounding (toggle) + Rounding increment, Week start, First
   check-in, Check-in interval, Global hotkey, Date / number format.
   - [ ] Each control is **pre-filled** from current state (the same values `tt config ls` prints).
2. Change **each** control once — flip Rounding on, pick a different increment, switch Week start,
   change First check-in and Check-in interval.
   - [ ] After each change `tt config ls` shows the **new** value **immediately** (changes save on
         change, no Save button) — the GUI edit and `tt config set <key> <value>` write the same row.
3. Focus the **Global hotkey** field and press a new chord (e.g. `Ctrl+Alt+Y`).
   - [ ] The field shows the new accelerator, `tt config ls` shows `global_hotkey` updated, and the
         **new** hotkey toggles the timer from another application **without a restart** (main
         re-registers the OS shortcut live); the **old** chord no longer toggles.
4. Set **Date / number format** to **ISO (24-hour)**.
   - [ ] Times rendered across the window (entry rows, the timer card, report headers) repaint to
         the **24-hour ISO** form **live**; switching back to **System locale** restores the locale
         rendering. `tt config ls` shows `date_format` flipped both times.
5. From the other terminal, change a setting via `tt` (`tt config set rounding_increment_min 30`)
   while the Settings view is open.
   - [ ] The open panel **re-reads and updates** the affected control on the external change — the
         two surfaces stay in lockstep (the view re-renders off fresh state on every change).

> The setSetting parity (the GUI Settings view ↔ `tt config set`, every §14 key) is the
> `setSetting` parity-matrix row; JUDGE screenshots the panel headless (`SETTINGS_VIEW`,
> `main-settings.png`) and the renderer-static guard pins the field set. This runbook confirms the
> live hotkey re-registration, the date-format repaint against the real OS theme, and
> the cross-surface round-trip on a real desktop/DB the headless host cannot exercise.

## CHECK BUILD MATRIX — macOS + Linux only, no Windows (§19 R01)

§19 R01 fixes the distribution build matrix at **macOS + Linux only**: a tagged/manual build
produces installable artifacts for both platforms and **no Windows artifact anywhere**. The
packaging is `electron-builder` driven by `packages/gui/electron-builder.yml` (mac `.dmg` +
linux AppImage/`.deb`, output to the git-ignored `packages/gui/dist-pack/`) via the
`npm --workspace @stint/gui run pack` script, and the `.github/workflows/release.yml` matrix
(`macos-latest`, `ubuntu-latest` — deliberately no `windows-latest`). This check confirms the
two-platform artifacts really build and launch and that Windows is absent. (Publishing the
artifacts as a GitHub Release is §19 R05; the single-installer PATH symlink is §19 R02 — both
out of scope here.)

Run it either by triggering the workflow (`.github/workflows/release.yml` via the **Run
workflow** / `workflow_dispatch` button, or a push to `main`) and inspecting its artifacts, or
locally per platform with `npm ci && npm run build && npm --workspace @stint/gui run pack`.

> **Automated PR-time backstop (since the `app-builder` ENOENT release-pack regression).**
> The full two-platform artifacts only build POST-merge (release.yml), so packaging breakage
> used to reach `main` unseen. Two checks now run on every PR (`.github/workflows/ci.yml`):
> the cheap `npm run verify:packaging` toolchain guard (`scripts/check-packaging.mjs` — asserts
> electron-builder's native `app-builder-bin` helper is installed/executable, the exact thing
> whose absence threw `spawn … app-builder ENOENT`), and the **`pack-smoke`** job, which drives
> `electron-builder --linux dir` (`npm --workspace @stint/gui run pack:smoke`) to a real packed
> Linux app and asserts it appears under `packages/gui/dist-pack/`. A packaging regression now
> fails the PR. The manual launch checks (steps 2–5) and the full AppImage/`.deb`/`.dmg` build
> remain the merge-time/release reality this smoke does not replace.

1. **No Windows in the configuration.** Inspect the two source files. (This step is also
   the **automated CI safety valve** `packages/gui/test/build-matrix.test.ts` — a GOLD-style
   static config guard that **fails CI** if a `win` block or a `windows-latest` matrix entry
   creeps back in; run it standalone with `npx vitest run packages/gui/test/build-matrix.test.ts`.)
   - [ ] `packages/gui/electron-builder.yml` declares `mac` and `linux` target blocks and
         contains **no `win` block** (and no `nsis`/`portable`/`msi` Windows targets).
   - [ ] `.github/workflows/release.yml`'s `strategy.matrix.os` is exactly
         `[macos-latest, ubuntu-latest]` — **no `windows-latest`** entry.
2. **macOS artifact (run on macos-latest / a Mac).**
   - [ ] `npm --workspace @stint/gui run pack` produces a macOS app bundle / `.dmg` under
         `packages/gui/dist-pack/` (and the `release.yml` `stint-macos` artifact carries it).
3. **Linux artifact (run on ubuntu-latest / a Linux box).**
   - [ ] `npm --workspace @stint/gui run pack` produces a Linux AppImage **or** `.deb` under
         `packages/gui/dist-pack/` (and the `release.yml` `stint-linux` artifact carries it).
4. **No Windows artifact.**
   - [ ] No `.exe`, `.msi`, or NSIS installer is produced on any runner, and the workflow run
         has **no Windows job** in the matrix.
5. **The artifacts launch.**
   - [ ] The macOS `.dmg`/app bundle opens the Stint GUI on macOS.
   - [ ] The Linux AppImage/`.deb` opens the Stint GUI on Linux.

> This check **FAILS** if any Windows target appears (a `win` block in `electron-builder.yml`,
> a `windows-latest` matrix entry, or a `.exe`/`.msi`/NSIS artifact) or if either the macOS or
> the Linux artifact is missing. R01 is satisfied only when both platform artifacts build and
> launch and Windows is absent throughout.

## CHECK INTEGRITY-ON-OPEN (§20 R03) — corruption detected before any write

§20 R03 is the gate that makes recovery possible: on every open the database is **integrity-checked
(`PRAGMA quick_check`) BEFORE any write**, and on failure the app/CLI must **not write to the corrupt
file** and must surface the corruption rather than proceed to normal operation on the bad data. This
check isolates that **detect-and-refuse** half — the restore half is verified by **CHECK BACKUP &
RECOVERY (§20 R05)** below, which this hands off to. The executable AC
(`features/integrity_check.feature`, run over core + tt) proves the bare write-refusal headless (a
corrupt, backup-less DB: open refused, file bytes unchanged); this MANUAL check confirms it on a real
install. Run with `tt` available (the database is `timetracker.sqlite` — find it with `tt config ls` /
the default path in PRD §13).

1. With the app **quit**, copy the real database aside so you can compare it afterwards
   (`cp timetracker.sqlite /tmp/tt-before.sqlite`), and note its size + mtime (`ls -l --time-style=full-iso timetracker.sqlite`).
2. Corrupt the database on disk — e.g. zero the SQLite header
   (`dd if=/dev/zero of=timetracker.sqlite bs=1 count=16 conv=notrunc`) **or** truncate it mid-file
   (`truncate -s 100 timetracker.sqlite`) **or** append garbage (`printf 'xxxx' >> timetracker.sqlite`).
3. Open the database through each surface and observe the open is refused **before any write**:
   - [ ] Run `tt status` (or any `tt` command): it **detects the corruption at open**, exits
         **non-zero**, and prints an **integrity/corruption error** on stderr — it does **not** print a
         normal status or silently start fresh.
   - [ ] Launch the GUI: it **detects the corruption on open** and does **not** proceed to normal
         operation on the corrupt file (it surfaces the corruption / recovery flow, never an empty,
         business-as-usual window over the bad data).
   - [ ] The corrupt file is **not modified by the failed open**: its **size and mtime are unchanged**
         versus step 1 (the open read it, found it bad, and wrote nothing to it). *(If a good backup
         exists, recovery from §20 R05 will then quarantine + replace it — that is the next check; R03
         alone must never write to the corrupt file.)*

> R03 is the **before-any-write detection**; the **quarantine + restore-from-backup + user
> notification** is §20 R05, exercised by **CHECK BACKUP & RECOVERY** below. This check fails if any
> write touches the corrupt file before detection, or if either surface proceeds to normal operation
> on a corrupt database instead of surfacing the corruption.

## CHECK BACKUP & RECOVERY (§17 R12, §20 R04/R05) — backup-on-launch, retention, corruption recovery

§20 R04/R05 make Stint loss-resistant: every launch writes a timestamped backup beside the
database **if the data changed** since the last one (keeping the last N, default 5), and every open
**integrity-checks** the database before writing — on failure it quarantines the corrupt file and
restores from the latest good backup, informing the user, **never silently losing data**. The
backups are plain checkpointed copies (`timetracker.sqlite.bak-<UTC>`) that survive even a corrupt
main file. The executable AC (`features/backup_recovery.feature`, run over core + tt) proves the
mechanism headless; this MANUAL check confirms it on a real desktop install — the launch backup
appearing on disk, the Settings → Backups status, retention pruning, the on-open corruption
dialog, and the real round-trip on both surfaces. Run with `tt` in a second terminal on the same
database (find it with `tt config ls` / the default path in PRD §13; below it is `timetracker.sqlite`).

1. Launch the app fresh on a database that has at least one entry (e.g. `tt add "warmup" --from "2h
   ago" --to "1h ago"`, then start the GUI).
   - [ ] A timestamped backup file `timetracker.sqlite.bak-<YYYYMMDDTHHMMSSZ>` appears **beside**
         `timetracker.sqlite`; `tt backup ls` lists it (same file, both surfaces).
   - [ ] **Settings → Backups** shows **"Last backup &lt;ts&gt;"** with a **verified** pill matching
         that newest backup.
2. Relaunch the app **without changing anything**, then make a change (e.g. `tt add …`) and relaunch
   again.
   - [ ] The no-change relaunch creates **no duplicate** backup (`tt backup ls` count unchanged) —
         the launch backup is a no-op when the DB is unchanged.
   - [ ] The relaunch-after-a-change creates **one new** backup, and once more than N (default 5)
         exist, the **oldest is pruned** so exactly N remain. Lower it (`tt config set
         backup_retention 2`) and relaunch a few more times to watch the list prune to 2.
3. Quit the app entirely. Corrupt the database on disk:
   `printf 'x' | dd of=timetracker.sqlite bs=1 seek=30 conv=notrunc` (clobbers a header byte).
   Relaunch the app.
   - [ ] The app **detects the corruption on open** and does **not** start on an empty database.
   - [ ] The corrupt file is **quarantined** as a `timetracker.sqlite.corrupted-<ts>` sibling
         (still on disk — not destroyed), and the latest good backup is **restored** into
         `timetracker.sqlite`.
   - [ ] The app **informs the user** (a recovery dialog / notice naming the backup it restored
         from and the quarantined file).
   - [ ] `tt list --all` shows the **pre-corruption entries intact** — **zero data loss**.
4. Use **Settings → Restore…** to restore a chosen earlier backup (and confirm the **tt mirror**
   `tt backup restore <name>` behind its `--force` confirm gate behaves the same).
   - [ ] Restoring quarantines the **current** file first (a `timetracker.sqlite.replaced-<ts>`
         sibling appears — current data set aside, not lost), then the chosen backup becomes live.
   - [ ] After restore, **both surfaces** read the restored data (`tt list` in the other terminal
         and the GUI's entry list agree) — the restore is the same core operation on both.

> Backup-on-launch + corruption recovery parity is proven over core + tt by
> `features/backup_recovery.feature` and the parity rows (`listBackups`/`restoreBackup` ↔ `tt backup
> ls`/`tt backup restore`); GOLD pins the `tt backup ls --json` shape (`backup.schema.json`) and the
> `now`/`restore` exit contracts. This runbook confirms the live launch backup, retention pruning,
> the on-open corruption dialog, and the real cross-surface round-trip a headless host cannot exercise.

## CHECK SOFTWARE UPDATE — VERSION DISPLAYED (§19 R06)

§19 R06 stamps a single date/build version (`YYYY.M.D`, with a numeric same-day suffix
`YYYY.M.D.N`, e.g. `2026.6.27.2`) into the app and reports it identically on **both equal
surfaces**: the GUI Settings → **Software Update** → **Current version** row and `tt --version`.
The version is the shared `@stint/core` `APP_VERSION` constant (stamped by
`scripts/stamp-version.mjs` before the build, overridable at runtime via `STINT_VERSION`); the
GUI reads it off the `getState` snapshot's `appVersion`, the CLI off `--version`. This check
confirms the two surfaces show the **same** stamped string on a real install (the GOLD contracts
prove the constant + the CLI line headless; this is the cross-surface, on-screen confirmation).
(The check-for-updates / download flow is §19 R03/R04 — out of scope here; this is the version
display only.)

1. Launch the installed (stamped) app and open **Settings → Software Update**.
   - [ ] The **Current version** row shows a `YYYY.M.D` or `YYYY.M.D.N` string (e.g. `2026.6.27`
         or `2026.6.27.2`) — **not** a semver like `1.0.0` and **not** the `0.0.0-dev` sentinel.
2. In a terminal on the same install, run `tt --version`.
   - [ ] It prints a single `YYYY.M.D[.N]` line.
   - [ ] It is **byte-identical** to the version the GUI shows — the two equal surfaces report
         **one** stamped version.

> This check **FAILS** if either surface shows a different string, a non-date version (e.g. the
> old hardcoded `1.0.0`), or the unstamped `0.0.0-dev` sentinel on a real release build. R06 is
> satisfied only when the GUI Settings version and `tt --version` agree on one `YYYY.M.D[.N]`
> value. Proven headless by GOLD (`cli/test/gold/cli.test.ts` version case + `version.schema.json`,
> `core/test/gold/contracts.test.ts` `isReleaseVersion`/`APP_VERSION`).

## CHECK SOFTWARE UPDATE — CHECK FOR UPDATES (§19 R03)

§19 R03 (decision **G3**) adds the **Check for updates** action to GUI **Settings → Software
Update**: alongside the Current version row (R06), a **Check now** button queries the **GitHub
Releases API** and reports either **up to date** (the latest published release tag equals the
running version) or **update available · `<newer version>`** with a **link** to the release,
comparing tags by the §19 R06 `YYYY.M.D[.N]` rule (year → month → day → same-day build suffix).
This is a **GUI/OS-only** capability — there is **no `tt` equivalent** (a CLI install is updated
by the package manager / installer), so, like the tray and the global hotkey, it is **not** a
parity-matrix channel: it rides a separate `update:getVersion` / `update:check` IPC surface,
bridged to the renderer as `window.stint.update`. The check is the app's **single, explicit,
user-initiated outbound request** (Electron's built-in `net` to GitHub — never `node:https` /
global `fetch`; §17 R9), and it **never writes the database** (§19 R04). The download + guided
install is §19 R04 — out of scope here; this is the **check** only. The pure ordering + verdict
logic is proven offline by GOLD (`packages/gui/test/update.test.ts`); the renderer wiring by
`packages/gui/test/renderer-static.test.ts`. This MANUAL CHECK confirms the live query + the
on-screen verdict + the no-DB-write invariant on a real install.

1. **The current version is shown.** Launch the installed app and open **Settings → Software
   Update**.
   - [ ] The **Current version** row shows the packaged app version (`app.getVersion()`), the
         same `YYYY.M.D[.N]` string `tt --version` prints (R06 cross-check).
2. **A check with the network present reports a correct verdict.** With internet access, click
   **Check now**.
   - [ ] The button shows a brief in-progress state, then a result appears.
   - [ ] If the latest **published** GitHub release tag **equals** the current version, it reports
         **up to date**.
   - [ ] If a **newer** published release exists (by the `YYYY.M.D[.N]` rule — e.g. current
         `2026.6.27` vs. release `2026.6.27.3`, or `2026.6.28`), it reports **update available ·
         `<newer version>`** with a **link** to that release (clicking it opens the GitHub release
         page in the browser, not in the app window).
   - [ ] Draft / prerelease GitHub releases are **ignored** — only the latest published, date-shaped
         tag is considered.
3. **The check makes no database write (§19 R04).** Note the database file's modification time
   (e.g. `stat` the `timetracker.sqlite` under the app's data dir) before clicking **Check now**,
   then again after the verdict appears.
   - [ ] The database **mtime is unchanged** — the update check reads no entries and writes nothing.
4. **A check with the network unavailable degrades gracefully.** Disable networking (or block the
   GitHub API) and click **Check now** again.
   - [ ] The app does **not** crash or hang; it shows a **graceful error** message (e.g. it could
         not reach GitHub Releases), and the rest of Settings stays usable.

> This check **FAILS** if the Current version shown differs from `app.getVersion()` / `tt
> --version`; if **Check now** does not query GitHub Releases or misreports the verdict (calling an
> equal/older release an update, or a newer release up-to-date, against the `YYYY.M.D[.N]` rule);
> if an update-available verdict omits the newer version or its release link; if the check **writes
> the database** (mtime changes — violating §19 R04); or if a failed/offline check **crashes** the
> app instead of showing a graceful error. R03 is a live-network + GUI reality with no headless
> network AC (the no-network backstop forbids a test reaching GitHub); the pure verdict logic is
> proven offline by GOLD `packages/gui/test/update.test.ts` and the wiring by
> `packages/gui/test/renderer-static.test.ts`, so the **live query** itself is confirmed by this
> MANUAL CHECK on a real install.

## CHECK INSTALL — single artifact puts the GUI in Applications/launcher and `tt` on PATH (§19 R02)

§19 R02 (decision **G2**) is the single-installer mechanism: **one** artifact per platform, run
**once**, leaves **both** the GUI installed (in Applications on macOS / the app launcher on Linux)
**and** `tt` on `PATH` — with **no separate Node install**, because `tt` runs through the Node
bundled in the GUI app. The mechanism is the `packaging/` tree: `packaging/tt-launcher.sh` is the
on-`PATH` `tt` shim (it finds `packages/cli/dist/bin.js` in the installed bundle and exec's the
bundled Node against it); on macOS the `.pkg` payload installs `Stint.app` into `/Applications`
and its `postinstall.sh` symlinks `tt` (`/usr/local/bin/tt`, falling back to `~/.local/bin/tt`);
on Linux `packaging/linux/install.sh` copies the AppImage to `/opt/stint` (or `~/.local/opt/stint`),
writes a `.desktop` launcher entry, and symlinks `tt` the same way. This check confirms a **single**
install run yields **both** outcomes on each platform, and that uninstall reverses both. It
consumes the artifacts of §19 R01 (the `.pkg`/AppImage built by `electron-builder`); the in-app
updater (§19 R03/R04), Release publishing (§19 R05), and versioning (§19 R06) are out of scope here.

Build the platform artifact first (`npm ci && npm run build && npm --workspace @stint/gui run pack`,
then on macOS `packaging/macos/build-pkg.sh <Stint.app> <version>` to wrap the `.pkg`). Then, per
platform:

### Pre-flight — the bundle actually contains the CLI + launcher
The single installer only works if `electron-builder.yml`'s `files:` glob bundled the CLI entrypoint
and the `packaging/` tree into the app root (the executable guard `packages/gui/test/build-matrix.test.ts`
asserts the glob, but confirm the *built* bundle here):
0. Inspect the freshly built app bundle (macOS: `Stint.app/Contents/Resources/app/…`; Linux: the
   extracted AppImage `…/resources/app/…` or `/opt/stint/resources/app/…`).
   - [ ] **`packages/cli/dist/bin.js` exists** in the bundle (the path `tt-launcher.sh` resolves via
         `CLI_REL`), and `packages/cli/dist/program.js` alongside it.
   - [ ] **`packaging/tt-launcher.sh` exists** in the bundle (on macOS `build-pkg.sh` already FAILED
         the wrap with "ensure packaging/ is included in the electron-builder files glob" if it did not).
   - [ ] **`node_modules/commander`** is present in the app root (bin.js's lone runtime dependency).

### macOS — the `.pkg` double-click path
1. Double-click `Stint-<version>.pkg` and complete the installer (a single run).
   - [ ] **`Stint.app` is present in `/Applications`** and launches the GUI (open it from Finder /
         Launchpad).
2. Open a **new** terminal (fresh shell, so `PATH` is re-read).
   - [ ] `which tt` resolves to a symlink on `PATH` — **`/usr/local/bin/tt`** (or
         **`~/.local/bin/tt`** if `/usr/local/bin` was not writable) — and it points at
         `…/Stint.app/Contents/Resources/app/packaging/tt-launcher.sh`
         (`readlink "$(which tt)"`).
   - [ ] `tt status` runs successfully against the shared DB **with no separate Node installed**
         (verify the bundled-Node path by temporarily ensuring `node` is absent from `PATH`, or
         confirm the launcher exec'd the Electron binary). It reads the same database the GUI shows.

### Linux — the `install.sh` path
3. Run the single installer: `packaging/linux/install.sh <path-to>/Stint-<version>.AppImage`.
   - [ ] A **`.desktop` entry appears** (`/usr/share/applications/stint.desktop` or
         `~/.local/share/applications/stint.desktop`); **Stint shows in the app launcher** and
         launching it opens the GUI.
4. Open a **new** terminal.
   - [ ] `which tt` resolves to a symlink on `PATH` — **`/usr/local/bin/tt`** (or
         **`~/.local/bin/tt`** fallback) — pointing at the installed `…/stint/tt-launcher.sh`
         (`readlink "$(which tt)"`).
   - [ ] `tt status` runs successfully against the shared DB. It reads the same database the GUI
         shows (run `tt add …` and confirm it appears in the GUI, and vice-versa).

### Uninstall reverses both
5. Remove Stint: macOS — delete `/Applications/Stint.app` and the `tt` symlink (or your uninstall
   path); Linux — run `packaging/linux/uninstall.sh`.
   - [ ] The **GUI is gone** (not in `/Applications` / no `.desktop` entry / removed from the
         launcher) **and** `which tt` no longer resolves — **both** the app and the symlink are
         removed.
   - [ ] The time-tracking **database is left untouched** (uninstall removes the app, never the
         user's data).

> This check **FAILS** if, after a **single** install run, **either** the GUI is missing from
> Applications / the app launcher **or** `tt` is not on `PATH` (`which tt` does not resolve, or
> `tt status` fails) — both outcomes must hold from one artifact. It also fails if `tt` requires a
> separately installed Node, or if uninstall leaves either the app or the `tt` symlink behind. R02
> is satisfied only when one install run yields both the launchable GUI and a working on-`PATH`
> `tt`, on macOS (`.pkg`) and Linux (`install.sh`) alike. There is no executable AC for R02 — it is
> an OS-level install reality (no new core API, no IPC channel, no DB table), so the proof is this
> MANUAL procedure plus the syntactically-checked `packaging/` scripts.

## CHECK PUBLISH-ON-MERGE — every merge to main publishes a GitHub Release with both artifacts (§19 R05)

§19 R05 (decision **G4**) makes the public repo the distribution backend: **every merge to `main`**
runs CI that builds both platform artifacts and **publishes a GitHub Release**. The mechanism is the
publish pipeline in `.github/workflows/release.yml` — it runs on `push` to `main` (and
`workflow_dispatch` for a manual re-run), guarded by `if: github.repository == 'kdbanman/stint'` so
forks build but never publish. Four jobs chain: **`version`** computes the `YYYY.M.D[.N]` tag once
(§19 R06's `scripts/stamp-version.mjs`; the same-day suffix `.N` = 1 + the count of release tags
already cut for today's date) and exposes it as an output; the **`pack`** matrix
(`macos-latest` + `ubuntu-latest` — **no `windows-latest`**) stamps that exact version, builds, runs
`npm --workspace @stint/gui run pack` (§19 R01), and uploads the macOS `.dmg` and the Linux
AppImage/`.deb`; **`publish`** (`needs: [version, pack]`, `permissions: contents: write`) downloads
both artifacts and `gh release create`s a **published** (not draft, not prerelease) Release at tag
`vYYYY.M.D[.N]` with exactly the two artifacts attached. This check confirms a real merge actually
publishes — it consumes the R01 build artifacts and the R06 version stamp; the in-app updater that
later consumes the published release is §19 R03/R04 (out of scope here). The existing `ci.yml`
(PR/push verify + judge) is a separate workflow and is **not** folded into this pipeline.

Run it by merging a PR to `main` (or pressing **Run workflow** / `workflow_dispatch` on
`release.yml`) on the real upstream repo, then inspect the Actions run and the Releases page (e.g.
`gh run list --workflow release.yml`, `gh release view <tag> --json isDraft,assets,tagName`).

1. **The workflow runs on the merge.**
   - [ ] A `Release build matrix` run appears for the merge commit on `main` (it is **not** skipped),
         and the `version`, `pack · macos-latest`, `pack · ubuntu-latest`, and `publish` jobs all
         finish **green** (all four jobs succeed).
2. **A new GitHub Release appears, correctly tagged.**
   - [ ] A **new** Release exists tagged **`vYYYY.M.D`** (e.g. `v2026.6.27`) — or **`vYYYY.M.D.N`**
         (e.g. `v2026.6.27.2`) when a same-day release already existed, the suffix incrementing per
         same-day merge.
   - [ ] The release **target** is the merge commit on `main`.
3. **Exactly the two expected artifacts are attached — and no Windows artifact.**
   - [ ] The release has **exactly two** assets: **one macOS** (`.dmg` / app bundle) **and one
         Linux** (AppImage **or** `.deb`).
   - [ ] There is **no `.exe`, `.msi`, or NSIS** asset, and no `windows-latest` job ran (§19 R01).
4. **The release is published, not a draft.**
   - [ ] `gh release view <tag> --json isDraft` reports **`isDraft: false`** (and it is not a
         prerelease) — the release is live on the Releases page, not held as a draft.
5. **The release tag/version matches what the app and `tt` report (§19 R06 cross-check).**
   - [ ] Install the published macOS/Linux artifact, then run `tt --version` and open **Settings →
         Software Update → Current version**: both show the **same** `YYYY.M.D[.N]` string, and it
         **equals the release tag without the leading `v`** (tag `v2026.6.27.2` ⇒ both surfaces show
         `2026.6.27.2`).

> This check **FAILS** if the workflow does **not** run on a merge to `main`, if **any** of the four
> jobs fails, if **no new Release** is created (or it is left a **draft**/prerelease), if either the
> macOS or the Linux artifact is **absent** (or a Windows artifact appears), or if the release
> tag/version disagrees with what the installed app and `tt` report (§19 R06). The publish
> **actually firing** is an Actions/GitHub-Releases reality — no new core API, IPC channel, or DB
> table to unit-test — so that step's proof is this MANUAL procedure observed on the **real upstream
> repo**; CI cannot assert the publish actually firing. The *authoring* of the pipeline that makes it
> fire IS executably guarded: **GOLD** `packages/gui/test/build-matrix.test.ts` ("publish-on-merge
> workflow is wired to publish a Release (§19 R05)") statically asserts `release.yml`'s `push: [main]`
> trigger, the `version → pack → publish` `needs:` chain, the `kdbanman/stint` upstream-only guard,
> and the `publish` job's `contents: write` + non-draft `gh release create` with both artifacts — so
> a regression that drops the trigger, deletes the publish job, or drafts the release **fails CI**
> before it can reach a real merge, leaving only the live firing for this MANUAL check. The pipeline
> itself lives in `.github/workflows/release.yml`.

## CHECK UPDATE-MID-TIMER (§16, §19 R04) — a running entry survives an in-app update untouched

§16's decided behavior for **"Update arrives mid-timer"** is that the in-app update (§19 R04) **never
touches the database**: a timer left running while the app is replaced is **still open, unchanged**
after relaunch, because the update flow replaces the *application* only and migrates/rewrites **no**
data. This is the §16 edge-case lens over §19 R04 (whose no-DB-write invariant on the *check* step is
also asserted in **CHECK SOFTWARE UPDATE — CHECK FOR UPDATES**); here it is exercised across the full
**download + guided install** with a **live open entry**, the one residual a headless host cannot drive
(no real app-replacement, no real running timer across a relaunch). Run with `tt` available on the same
database (find it with `tt config ls` / the default path in PRD §13; below it is `timetracker.sqlite`).

1. Start a live timer and **capture the pre-update state** while it runs:
   `tt start "release work" --client "Acme"`, then note from `tt status --json` the open entry's
   **id** and **`startUtc`**, and capture the on-disk DB **content hash + mtime/size**
   (`sha256sum timetracker.sqlite` and `ls -l --time-style=full-iso timetracker.sqlite`). Confirm the
   tray title is counting up — the entry is genuinely open, not closed.
2. From **Settings → Software Update**, run the **download + guided install** (§19 R04) — or, if no
   newer release is available to install, **simulate the §19 R04 app-replacement step**: quit the GUI,
   replace the app bundle/AppImage in place with the new artifact (the data directory is **not** part
   of the app bundle), and clear Gatekeeper once if prompted (the one-time approval §19 R04 accounts
   for). Do **not** touch the data directory during the swap.
3. Relaunch the updated app and re-observe state on **both** surfaces.
   - [ ] The **same** entry is **still open** — `tt status --json` reports an open entry with the
         **identical id and `startUtc`** captured in step 1 (the update did **not** drop, close, or
         re-create the running entry), and the GUI's running card / tray shows it still counting up.
   - [ ] The live count-up **continues from `now − start`** (elapsed kept growing across the update;
         it did **not** reset to zero or jump).
   - [ ] The DB file is **byte-identical** to the pre-update capture: `sha256sum timetracker.sqlite`
         matches step 1 (and mtime/size unchanged) — **the update touched no data** (a backup-on-launch
         write, if it fires, is a *separate sibling* file, never an in-place rewrite of the live DB;
         confirm the live `timetracker.sqlite` itself is unchanged).

> This check **FAILS** if, after an in-app update completes mid-timer, the previously-open entry is no
> longer open, its id or `startUtc` changed, the elapsed reset, or the live `timetracker.sqlite` is not
> byte-identical to its pre-update capture (i.e. the update flow rewrote, migrated, or otherwise touched
> the database, or dropped the running entry) — any of these violates §16 / §19 R04. There is no
> executable AC for the real app-replacement across a live timer (no Playwright host for the OS-level
> swap, and the no-network backstop forbids reaching GitHub); §19 R04's no-DB-write is pinned headless
> for **both** the *check* step **and the download + guided install** by GOLD
> `packages/gui/test/update.test.ts` (artifact selection, progress maths, the guided-step plan, and the
> size-verified `downloadUpdate` over an injected byte source — asserting the artifact lands in the TEMP
> dir, never beside the database, and the flow makes zero Store calls) and the renderer wiring by
> `packages/gui/test/renderer-static.test.ts`, so the **install-across-a-live-timer** reality is this
> MANUAL CHECK on a real install.
>
> **Executed evidence.** The headless-drivable core of this check — the **no-DB-touch invariant across a
> live open timer** — is run by `npm run evidence` and checked in: `acceptance/evidence/cli-transcript.md`
> → section **"§16 / §19 R04 — in-app update never touches the database (simulated app-replacement)"**
> starts a live timer, captures the open entry + the live DB's sha256/size, simulates the §19 R04
> app-replacement (swap the app bundle, leave the data directory — step 2's "simulate the app-replacement
> step" path), and re-reads **both** surfaces (`tt` + the core Store the GUI is a surface over): it
> confirms the live `tt.sqlite` is byte-identical, the same entry is still open with an unchanged
> id/start, and the derived elapsed continued to grow. The Settings → Software Update **chrome**
> (version row, Check-now verdict + release link, Download & install → progress bar → guided steps incl.
> the one-time Gatekeeper beat → Reveal installer) is exercised through the real renderer by the JUDGE
> harness — item **`SOFTWARE_UPDATE`** in `acceptance/evidence/judge-report.json`, screenshot
> `acceptance/evidence/screenshots/main-software-update.png`. The residual **live** part (the real GitHub
> artifact download + the OS-level app replacement + the one-time Gatekeeper approval, across a real
> running timer on a real install) awaits a real desktop operator's screen recording in
> `acceptance/evidence/recordings/` (see that directory's `README.md` for the execution status table).

## CHECK BACKUP-ON-LAUNCH (§16, §20 R04) — a fresh launch writes a recoverable backup when the DB changed

§16's decided behavior for **"Fresh launch"** is that if the DB **changed since the last backup**, a
**timestamped backup** is written beside it **before any write** (§20 R04), the last **N** (default 5)
are kept, and a launch with **no change** writes **none**. This is the §16 edge-case lens over §20 R04;
the executable AC (`features/backup_recovery.feature`, run over core + tt) proves the mechanism headless,
and the broader live walk is **CHECK BACKUP & RECOVERY** above — this focused check isolates the
**backup-on-launch** edge case: it fires on change, is a valid recoverable copy, is bounded by retention,
and is a no-op when nothing changed. Run with `tt` in a second terminal on the same database (find it
with `tt config ls` / the default path in PRD §13; below it is `timetracker.sqlite`).

1. **A change since the last backup makes one valid timestamped backup on launch.** With the app quit,
   make a change so the DB differs from the last backup (`tt add "warmup" --from "2h ago" --to "1h ago"`),
   then launch the GUI.
   - [ ] A new **`timetracker.sqlite.bak-<YYYYMMDDTHHMMSSZ>`** appears **beside** `timetracker.sqlite`;
         `tt backup ls` lists it (same file on both surfaces) and **Settings → Backups** shows it as the
         newest with a **verified** pill.
   - [ ] The backup is a **valid SQLite database that opens and contains the latest entry**: it opens
         without an integrity error and contains the "warmup" entry just added (e.g. restore a copy of it
         aside and `tt list --all` against it, or use the Settings → Backups verify pill — it must hold
         the post-change data, proving the copy is recoverable, not truncated).
2. **An unchanged launch writes none.** Quit, then relaunch **without changing anything**.
   - [ ] `tt backup ls` count is **unchanged** — the launch backup is a **no-op when the DB is
         unchanged** (no redundant duplicate).
3. **Retention caps at N (default 5); the oldest is pruned.** Make a change and relaunch repeatedly
   (`tt add …` then relaunch) until **more than 5** launch-with-change cycles have run.
   - [ ] At most **N = 5** backups ever remain (`tt backup ls` never exceeds 5); the **6th**
         launch-with-change **prunes the oldest** so exactly 5 remain (the surviving set is the 5 most
         recent timestamps). Optionally lower it (`tt config set backup_retention 2`) and relaunch a few
         more times to watch the list prune to 2.

> This check **FAILS** if a launch after a DB change writes **no** backup, writes one that is **not** a
> valid/recoverable SQLite copy of the latest data, writes a **redundant** backup when nothing changed,
> or lets backups grow **unbounded** past N (the oldest must be pruned) — any of these violates §16 /
> §20 R04. The mechanism is proven surface-neutral over core + tt by `features/backup_recovery.feature`
> and pinned by GOLD `tt backup ls --json` (`backup.schema.json`); this runbook confirms the launch
> backup actually landing on disk, its recoverability, the no-change no-op, and retention pruning on a
> real install the headless host cannot exercise.

## CHECK CORRUPTION-RECOVERY (§16, §20 R03/R05) — a corrupt DB is detected, quarantined, and recovered with no data loss

§16's decided behavior for **"Corruption detected on open"** is: **do not write**; **quarantine** the
corrupt file (`.corrupted`); **restore from the latest good backup**; **inform the user** — never
silently lose data (§20 R03 detects, §20 R05 recovers). This is the §16 edge-case lens over §20 R03/R05;
the detect-and-refuse half is **CHECK INTEGRITY-ON-OPEN (§20 R03)** above and the full mechanism is
**CHECK BACKUP & RECOVERY (§20 R04/R05)** — this focused check walks the §16 edge case end-to-end: with a
**known-good backup present**, a corrupted DB is detected, never written, quarantined, restored from the
latest backup, the user informed, and the pre-corruption data is intact afterward. Run with `tt` in a
second terminal on the same database (find it with `tt config ls` / the default path in PRD §13; below it
is `timetracker.sqlite`).

1. **Establish a known-good backup and capture the pre-corruption data.** With at least one entry in the
   DB (`tt add "billing work" --from "2h ago" --to "1h ago" --client "Acme"`), launch once so a fresh
   backup is written (CHECK BACKUP-ON-LAUNCH), confirm `tt backup ls` lists a recent good backup, and
   note the current entries (`tt list --all --json`). Then **quit the app entirely**.
2. **Deliberately corrupt the live DB while the app is closed** — e.g. clobber a header byte
   (`printf 'x' | dd of=timetracker.sqlite bs=1 seek=30 conv=notrunc`), zero the SQLite header
   (`dd if=/dev/zero of=timetracker.sqlite bs=1 count=16 conv=notrunc`), or truncate it
   (`truncate -s 100 timetracker.sqlite`). Note the corrupt file's size/mtime
   (`ls -l --time-style=full-iso timetracker.sqlite`).
3. **Launch the app** and observe the recovery on **both** surfaces.
   - [ ] The **integrity check fails on open** — the app **detects the corruption** and does **not**
         proceed to normal operation on the bad data / start on an empty DB (and `tt status` likewise
         detects it rather than printing a normal status).
   - [ ] The app **does not write to the corrupt file** before recovery (§20 R03): the quarantined copy
         it sets aside has the **same corrupt bytes** captured in step 2 — nothing was appended/written
         to the bad file before it was moved.
   - [ ] The corrupt file is **quarantined** to a **`timetracker.sqlite.corrupted-<ts>`** sibling (still
         on disk, not destroyed).
   - [ ] The DB is **restored from the latest good backup** into `timetracker.sqlite` (the backup from
         step 1), and the app **informs the user** (a recovery dialog / notice naming the backup it
         restored from and the quarantined file).
4. **The pre-corruption data is intact afterward.**
   - [ ] `tt status` / `tt list --all` show the **pre-corruption entries intact** — the "billing work"
         entry (and any others from step 1) are present, matching the step-1 capture: **zero data loss**.
   - [ ] Both surfaces agree (the GUI entry list and `tt list` in the second terminal show the same
         restored data) — recovery is the same core operation on both.

> This check **FAILS** if a corrupted `timetracker.sqlite` is **not detected** on open, is **opened for
> write** / overwritten before recovery, is **not quarantined** to a `.corrupted` sibling, is **not
> restored** from the latest good backup, the user is **not informed**, or any pre-corruption data is
> **lost** on recovery — any of these violates §16 / §20 R03/R05. The detect-and-refuse + quarantine +
> restore mechanism is proven surface-neutral over core + tt by `features/integrity_check.feature` and
> `features/backup_recovery.feature`; this runbook confirms the on-open corruption dialog, the
> quarantine + restore, and the zero-data-loss round-trip on a real desktop install the headless host
> cannot drive.

## CHECK INSTALL & UPDATE (§17 R13) — the installer lands both surfaces on one version, and the in-app updater completes a guided install without touching the DB

§17 R13 is the **acceptance umbrella** over the whole §19 packaging-installation-update story: the
single installer puts the GUI in Applications / the app launcher **and** `tt` on `PATH` (§19 R02),
both reporting the **same** `YYYY.M.D[.N]` version (§19 R06); the in-app updater detects a newer
GitHub release (§19 R03) and completes a **download + guided install** (§19 R04) that **never touches
the database** (§16 / §19 R04). The component mechanisms are each proven in their own checks above —
**CHECK INSTALL** (§19 R02), **CHECK SOFTWARE UPDATE — VERSION DISPLAYED** (§19 R06), **CHECK
SOFTWARE UPDATE — CHECK FOR UPDATES** (§19 R03), and **CHECK UPDATE-MID-TIMER** (§16 / §19 R04) — and
their headless backstops are GOLD `packages/gui/test/update.test.ts` (the `YYYY.M.D[.N]` ordering +
verdicts), `cli/test/gold/cli.test.ts` + `core/test/gold/contracts.test.ts` (the one shared
`APP_VERSION`), and `packages/gui/test/renderer-static.test.ts` (the Settings → Software Update
wiring). **This umbrella walks the end-to-end install→update reality as ONE criterion**: a freshly
installed app, the same version on both surfaces, a real update detected and applied, and the open
timer + the live DB completely untouched across the swap. It is **MANUAL** because every step is an
OS-level / live-network reality the headless host cannot drive (real `.pkg`/AppImage install, real
GitHub Releases query, real app replacement + Gatekeeper, a running timer across a relaunch), and
because there is **no new core API, IPC channel, or DB table** unique to R13 — it is the integrated
proof that the §19 parts cohere. Run a **clean install** (not a `git` checkout) of a **stamped
release** artifact, with `tt` available in a terminal on the same database (find it with
`tt config ls` / the default path in PRD §13; below it is `timetracker.sqlite`).

### (a) The single installer leaves the GUI launchable AND `tt` on PATH — both on the same version
1. Run the **single** installer once — macOS: double-click `Stint-<version>.pkg`; Linux:
   `packaging/linux/install.sh <path-to>/Stint-<version>.AppImage` — then open a **new** terminal so
   `PATH` is re-read.
   - [ ] **The GUI is launchable**: `Stint.app` is in `/Applications` (macOS) **or** a `stint.desktop`
         entry shows Stint in the app launcher (Linux), and launching it opens the GUI window.
   - [ ] **`tt` is on `PATH`**: `which tt` resolves to a symlink (`/usr/local/bin/tt`, or the
         `~/.local/bin/tt` fallback) — a single install run yielded **both** outcomes (full mechanism
         in **CHECK INSTALL**, §19 R02).
2. Read the version off **both equal surfaces**: open **Settings → Software Update → Current version**
   in the GUI, and run `tt --version` in the terminal.
   - [ ] Both show the **same** `YYYY.M.D[.N]` string (e.g. `2026.6.27` / `2026.6.27.2`) — **not** a
         semver like `1.0.0` and **not** the `0.0.0-dev` sentinel — proving the one stamped
         `APP_VERSION` reaches both surfaces from one installer (§19 R06).

### (b) With a newer release published, "Check now" reports update-available with the newer version
3. Ensure a **newer published** GitHub release exists than the installed version (cut one on the
   upstream repo, or point at a fixture release whose tag is newer by the `YYYY.M.D[.N]` rule), then
   in **Settings → Software Update** click **Check now** with the network present.
   - [ ] The check reports **update available · `<newer version>`** with a link to that release (and
         it would report **up to date** if the latest published tag equalled the current version;
         drafts/prereleases are ignored) — the live GitHub-Releases verdict (§19 R03, full mechanism
         in **CHECK SOFTWARE UPDATE — CHECK FOR UPDATES**).

### (c) The guided install downloads + walks the replace-the-app steps incl. the one-time Gatekeeper, and relaunch shows the new version
4. Start a **live timer first** so part (d) can be observed on the same run:
   `tt start "release work" --client "Acme"`; note from `tt status --json` the open entry's **id** and
   **`startUtc`**, and capture the live DB's **content hash + mtime/size**
   (`sha256sum timetracker.sqlite` and `ls -l --time-style=full-iso timetracker.sqlite`). Confirm the
   tray title is counting up — the entry is genuinely open.
5. From **Settings → Software Update**, run the **download + guided install** (§19 R04): it downloads
   the newer artifact and walks the **replace-the-app** steps, including the **one-time Gatekeeper
   approval** (no Developer ID / notarization dependency — the user clears Gatekeeper once). Follow the
   steps to replace the installed app in place; do **not** touch the data directory during the swap.
   - [ ] The flow **downloads the artifact** and presents the numbered **replace-the-app** guidance,
         including the **one-time Gatekeeper / first-launch approval** note (the guided-install step
         list depicted in `context/mockups/settings.html` — design intent for §19 R04).
6. Relaunch the updated app and re-read the version on **both** surfaces.
   - [ ] **Settings → Software Update → Current version** and `tt --version` now show the **new**
         `YYYY.M.D[.N]` version (the one from step 3), still **identical** across the two surfaces.

### (d) A mid-timer update leaves the open entry and its elapsed — and the DB — completely untouched
7. With the timer that was started in step 4 still the subject, re-observe state after the relaunch on
   **both** surfaces (this is the §16 "update arrives mid-timer" lens, full walk in
   **CHECK UPDATE-MID-TIMER**).
   - [ ] The **same** entry is **still open** — `tt status --json` reports an open entry with the
         **identical id and `startUtc`** captured in step 4, and the GUI running card / tray shows it
         still counting up (the update did **not** drop, close, or re-create the running entry).
   - [ ] The live count-up **continued from `now − start`** (elapsed kept growing across the update;
         it did **not** reset to zero or jump).
   - [ ] The live DB is **byte-identical** to the pre-update capture: `sha256sum timetracker.sqlite`
         matches step 4 (mtime/size unchanged) — **the update touched no data** (a backup-on-launch
         write, if it fires, is a *separate sibling* file, never an in-place rewrite of the live DB).

> This umbrella **FAILS** if any of: (a) the single installer omits the **PATH symlink** (`which tt`
> does not resolve) or leaves the GUI unlaunchable, or the GUI and `tt --version` report **different**
> versions (or a non-`YYYY.M.D[.N]` value); (b) **Check now** **misreports** the verdict against a
> newer published release (calls a newer release up-to-date, or an equal/older one an update), or omits
> the newer version / its link; (c) the guided install does not **download** the artifact, skips the
> **replace-the-app** guidance or the **one-time Gatekeeper** note, or the relaunched version does not
> become the new `YYYY.M.D[.N]`; or (d) the update **touches the DB** — the previously-open entry is no
> longer open, its id/`startUtc` changed, the elapsed reset, or `timetracker.sqlite` is not
> byte-identical to its pre-update capture. R13 is satisfied only when **one** installer lands both
> surfaces on **one** version AND the in-app updater completes a guided install that updates the
> version while leaving the database and the running entry **untouched**. R13 is an integrated
> OS-level / live-network acceptance reality with **no executable AC of its own** (it has no new core
> API, IPC channel, or DB table); the per-part mechanisms are pinned headless by the GOLD + static
> tests named above, so the **whole install→update story cohering** is this MANUAL CHECK on a real,
> stamped install of a published release.
>
> **Executed evidence.** The headless-drivable parts of this umbrella are run + checked in: part **(c)**'s
> guided-install **chrome** (download → progress bar → numbered guided steps incl. the one-time Gatekeeper
> beat → Reveal installer) and **(b)**'s Check-now verdict are exercised through the real renderer by the
> JUDGE item **`SOFTWARE_UPDATE`** (`acceptance/evidence/judge-report.json`; screenshot
> `acceptance/evidence/screenshots/main-software-update.png`), and part **(d)**'s mid-timer
> **DB-byte-identical / still-open entry** invariant is executed by `npm run evidence`
> (`acceptance/evidence/cli-transcript.md` → "§16 / §19 R04 — in-app update never touches the database").
> Part **(a)**'s no-Windows install + single-installer bundle is backstopped by the `packaging/` static
> guards (GOLD `packages/gui/test/build-matrix.test.ts`) reported in the transcript's §19 R01 section. The
> residual **live** end-to-end — a clean install of a stamped release, a real GitHub download, the OS-level
> replacement + Gatekeeper, and the relaunch across a running timer — awaits a real desktop operator's
> screen recording in `acceptance/evidence/recordings/` (see that directory's `README.md`).

## CHECK INLINE INTERVAL PICKER (GUI) (§12 R15)

The §12 R15 interval picker (G5/G7) is an **inline, in-flow** component of the unified entry
form — **no modal, no dimmed backdrop, no Apply button**. It lets the user pick a **start +
stop together** on a single-day calendar column (drag the body to move, drag the bottom grip
to resize the stop, both 5-min snapping); every drag writes the form's **Start/Stop fields
LIVE**, and **Save entry is the only commit**. The text fields stay authoritative everywhere
it appears (add-entry, edit-closed-entry, edit-running-start). Overnight spans use the
collapsed **Start/Stop expander** (§12 R17), not the single-day column.

1. In a real desktop session, open the main window and click **Add entry**.
   - [ ] The unified form opens **inline** (the Entries content moves down to make room — **no
         modal, no dimmed backdrop**), with the interval picker already mounted in the form's
         right column: a **month calendar** beside a **single-day column with hour lines**.
   - [ ] There is **no "Apply"/"Apply range" button** and **no separate calendar-icon trigger**
         — the picker is simply present in flow.
2. **Body-drag moves the whole interval.** Drag the body of the accent rectangle up/down.
   - [ ] **Both** Start and Stop move together with a visible **5-minute snap**, and the
         form's Start/Stop values (in the Start/Stop expander) **update live on every drag**.
3. **Bottom grip resizes only the stop.** Drag the rectangle's **bottom grip** up/down.
   - [ ] Only the **Stop** moves (also 5-min-snapped); the Start stays put, updating the
         Stop field live.
4. **Others gray, overlap yellow (warn-only).** Ensure another entry exists on that day.
   - [ ] Other entries on the day render **gray**; where your span **overlaps** one, the
         overlap region renders **yellow** — and it **never blocks** (Save stays enabled).
5. **Save is the sole commit.** Click **Save entry**.
   - [ ] The entry lands with exactly the dragged times — no separate Apply step was needed,
         and nothing committed until Save.
6. **Edit a closed entry.** Open the inline edit form for a completed entry.
   - [ ] The same inline picker is mounted in the edit form, seeded from that entry's span;
         body-drag/grip-resize write the `.edit-start`/`.edit-end` fields live, and **Save
         entry** commits the amended span (nothing commits until Save).
7. **Running entry — start grip only, future fade, no end.** With a timer running, open the
   Timer view's Start field disclosure.
   - [ ] The running block shows a **start grip only** with the block **fading into the
         future** and **no end control at all** (§05 R06). That surface has its own dedicated
         procedure: run **CHECK RUNNING START-ONLY PICKER** below.
8. **Overnight via the expander.** Expand the **Start/Stop (exact times)** disclosure and
   **type** a span crossing midnight (From today, To tomorrow).
   - [ ] The typed overnight span is accepted and authoritative; the single-day column simply
         shows the start day (the overnight path is the expander, not the column).

> The in-flow chrome (no `.stp-backdrop`, no `.stp-apply`, `position:static` host), the
> month calendar + `.stp-track` with hour lines, the body-drag-moves-both / grip-resizes-stop
> 5-min-snapped LIVE writes into the bound form fields, the gray-others / inert-yellow-overlap
> painting, and Save-as-sole-commit are pinned headless under JUDGE (`UNIFIED_FORM`,
> `main-edit.png`; add mode under `UNIFIED_FORM_ADD`, `unified-add.png`; the running start-only
> variant under `TIMER_VIEW`, `timer-view-full.png`) driving the real renderer. This runbook
> confirms, on a real build, that the picker is inline on every R15 surface, that dragging
> snaps and writes the form fields live, that overlaps warn without blocking, that Save is the
> only commit, and that overnight spans go through the exact-time expander.

## CHECK RUNNING START-ONLY PICKER (§05 R06, §12 R14)

The running entry's start is adjusted through the **inline, start-only disclosure** of the
interval picker below the Timer view's Start field — in flow, no modal — and the running
entry's **end does not exist until it is stopped**: no surface may render or write one, and
the count-up must never stop while the start is being edited.

1. In a real desktop session, start a timer (`tt start "disclosure check"` or the Timer
   view's Start form) and let it run a few minutes. Open the **Timer view**.
   - [ ] The live-edit strip shows the **Start** field as a plain text value
         (`YYYY-MM-DDTHH:mm`) with a **calendar affordance** beside it — the field is **not**
         a native `datetime-local` control (no OS date popover on click).
2. Click the calendar affordance beside **Start**.
   - [ ] The day timeline expands **inline, in flow below the Start field** — the page
         content moves down to make room; there is **no modal, no dimmed backdrop, no
         Apply/Cancel**, and the rest of the window stays fully interactive.
   - [ ] The running entry renders as an accent block that **dissolves into the future** —
         its lower edge fades to transparent (a gradient, not a hard end edge) — with a
         **start drag grip** at its top edge and **no end control anywhere**: no bottom
         resize grip, no end time label, no end text field.
   - [ ] Any other entries from that day render **gray** on the track; the viewport opens
         scrolled to the configured §14 window (scrollable across the full 24 h — the track
         is never clipped).
3. **Drag the grip earlier** (upward), watching the Start field and the running clock.
   - [ ] The grip and block edge move with a visible **5-minute snap**, and every drag step
         writes the **Start text field live** (no Apply — the field is the commit path).
   - [ ] The **count-up never stops or resets** while dragging — it keeps ticking and
         grows to reflect the earlier start after the edit settles.
4. Collapse the disclosure (click the calendar affordance again), then verify from the
   other surface:
   - [ ] `tt status` shows the entry **still running**, with the **amended start** and the
         larger derived elapsed.
   - [ ] `tt list --json` shows the amended `start` and `"end": null` — **empty, never a
         synthetic "now"**; exactly one entry is open.

> The in-flow/no-modal chrome, start-grip-only rendering, computed future-fade mask, the
> live 5-min-snapped write into `#le-start`, and the committed edit patch carrying `startUtc`
> with **no `endUtc` key** are pinned headless under JUDGE (`TIMER_VIEW`,
> `timer-view-full.png`) driving the real renderer; the cross-surface no-close/no-end
> behavior is proven twice (core + `tt`) by `features/tracking.feature` "Editing the running
> entry start never closes it and never synthesizes an end". This runbook confirms the same
> on a real desktop: real drags snap and write live, the block visibly dissolves toward the
> future with no end affordance, the count-up never stops, and `tt` sees the amended start
> with the entry still open and its end empty.

## CHECK ENTRIES CALENDAR (§12 R16) — the readonly calendar scrolls, never clips; columns stay fixed; working hours are the default

The §12 R16 Entries view is a **readonly calendar**: one **fixed comfortable-width day column
per day in range** over a **full 24h track**. The track is a **scroll default, not a clip** — the
viewport opens on **working hours** but every hour stays reachable; the columns keep their width
(never stretched/compressed) and the strip **scrolls horizontally** when the range does not fit.
Grouping is **not** here (it lives in Reports, G11); the day headers carry **per-day billable
totals** and the toolbar carries a **range chip**.

1. In a real desktop session with a week of entries — including a day with **none**, an entry
   **before** your working-hours-start and one **after** your working-hours-end — open the main
   window on the **Entries** view.
   - [ ] The content is a **calendar**: a **fixed-width day column per day** of the This-week
         range, over an hour gutter. The columns are a **comfortable fixed width** — they do
         **not** stretch to fill the window nor compress to cram the week in.
   - [ ] The viewport **opens on working hours** (the first visible hours are around your
         `working_hours_start`), **not** at midnight.
   - [ ] Each **day header** shows that day's **billable total**; the **empty day** shows as a
         **present-but-empty column** (its total reads `0.00h`); the toolbar shows the **range
         chip** with the week's billable total.
2. **Scroll, never clip.**
   - [ ] **Scroll the track up**: the entry **before** working-hours-start (e.g. an early
         06:xx block) comes into view — it was present all along, just above the default window.
   - [ ] **Scroll the track down**: the entry **after** working-hours-end (e.g. a 19:xx block)
         comes into view — nothing was clipped; the full 24h is reachable.
3. **Wide range.** Switch the range to **Custom…** and pick a **span of several weeks**.
   - [ ] The day columns keep the **same fixed comfortable width** and the strip **scrolls
         horizontally** across them — the columns are never squeezed to fit the range.
   - [ ] In-range days with **no** entries still show as **empty columns**.
4. **Reach the editing/merge affordances by hand.**
   - [ ] **Hover** an event: its **Delete / Split / Edit** ops and a **corner checkbox** appear.
   - [ ] **Click** an event body: the **unified editor** opens inline (edit mode).
   - [ ] **Check two events' corner checkboxes**: the **merge bar** appears with the live count.
   - [ ] The **running** entry shows as a block that **fades into the future** with **no end
         edge**; an **overlap** shows a yellow **warn band**; a **slept** span shows a **hatch**.

> The fixed/equal-width columns, the horizontal scroll, the working-hours default that scrolls
> (never clips) with off-hours entries reachable, the per-day header totals + range chip, the
> empty column, the hover ops + corner checkbox, the click-opens-editor, the running future-fade,
> the overlap band + slept hatch, and the two-checkbox merge bar are pinned headless under JUDGE
> (`CALENDAR_LAYOUT`, `main-calendar.png`) driving the real renderer; the per-day + range billable
> totals are proven twice (core + `tt`) by `features/entry_list.feature`. This runbook confirms the
> same on a real desktop: the columns hold their width, the strip scrolls both ways, off-hours
> entries are reachable rather than clipped, and empty days show as empty columns.

## CHECK EXACT/OVERNIGHT ENTRY VIA EXPANDER (GUI) (§12 R17)

The unified form's collapsed **Start/Stop expander** is the exact-entry escape hatch and the
**only path for an overnight span** — the single-day interval picker can't be dragged across
midnight, so a stop dated the **next day** is *typed* into the expander's raw text fields. A
human must be able to type an exact cross-midnight span, see the inline picker and the collapsed
echo reflect the typed values, and Save it as the same entry a drag would produce.

1. In a real desktop session, open the main window, click **Add entry manually**, and give the
   entry a **description** (e.g. `overnight deploy`).
   - [ ] The **Start / Stop (exact times)** expander is **collapsed** by default (its raw text
         fields are hidden) while a **tabular echo** of the current interval (e.g. `22:00 –
         23:00`) shows beneath the month calendar.
2. **Expand** the Start / Stop expander and **type an overnight span** into the raw fields — a
   **Start** of `22:00` today and a **Stop** of `02:00` **the next day** (type the full
   `YYYY-MM-DDTHH:mm` with the stop on tomorrow's date). These are plain **text** fields — there
   is **no native date-time popover**.
   - [ ] As you type, the **inline picker reflects the typed values**: the accent block sits at
         the typed **start** (22:00) on the start's day, and the **collapsed echo reads
         `22:00 – 02:00`** — the same shared interval the picker drag would set.
   - [ ] The **Stop field keeps the next-day value verbatim** — it is *not* rewound to the
         start's day or flattened to a same-day span.
3. Click **Save entry** — the *only* commit.
   - [ ] The form closes and the completed **overnight** entry persists.
   - [ ] `tt list --json` shows **one** entry whose **start** and **stop** are the exact typed
         instants **crossing midnight** (start `22:00`, stop `02:00` the next day — a 240-minute
         span), identical to what a same-day drag commits over the same `add` write (parity: the
         `add` IPC channel ↔ `tt add --from --to`).

> The overnight-capable add is proven surface-neutrally over core+`tt` by the BDD "Backfill
> creates a completed overnight entry" scenario (a 22:00→02:00-next-day span → one closed entry,
> zero open, a 240-minute billable duration, run twice); the GUI expander — collapsed-by-default
> echo, expand-to-raw-text-fields, the typed overnight updating the shared interval so the picker
> + echo reflect it, and Save committing the exact typed values — is screenshotted under JUDGE
> (`UNIFIED_FORM_EXPANDER`, `unified-form-expander.png`) and bound back to `tt add` by the parity
> matrix. This runbook confirms a human can type an exact cross-midnight span, watch the picker
> and echo track it, and Save it as the same entry a drag would, at parity with `tt add`.
