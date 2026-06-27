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
   - [ ] The popover shows **Stop** and **Switch** while a timer runs, **Start** while
         idle, and **Open Stint** in both states.
   - [ ] One click on the popover's Stop/Start toggles the timer; Switch (while running)
         stops-then-starts; Open Stint opens the main window.
   - [ ] A **RIGHT-click** yields at most a **minimal Quit-only OS menu** — it has **no
         Start / Stop / Open Stint** items.
   - [ ] There is **no 3-item dropdown action menu anywhere** (a left-click that shows a
         menu, or any timer action reachable from a tray dropdown, is a FAIL).

## CHECK START WITH ATTRIBUTES (§05 R1, §12 R1, §17 R8)

1. In the running app, open the main window and reveal the Start form ("+ with
   details"). Enter a description, a **new** client and **new** project name, two
   comma-separated tags, and uncheck Billable. Submit.
   - [ ] The primary Start above stays a one-tap action (the form is opt-in, collapsed
         by default).
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
   - [ ] The form closes and a new completed entry appears in the correct day group
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

## CHECK MANUAL ADD FORM (GUI) — full-attribute backfill at parity, overlap warned-not-blocked (§12 R7, §06 R4)

The §12 R7 Manual-add form must create a *complete* past entry from the form alone —
every field `tt add` accepts — and treat an overlapping span as warned, not blocked.

1. In a real desktop session, open the main window, click **Add entry**, and create a
   past entry **entirely from the form**: a description, a **client** *and* **project**,
   one or more **tags**, the **Billable** toggle set, and an explicit **From**/**To** in
   the past (e.g. 13:00 → 14:30 local). Click **Save entry**.
   - [ ] The form closes and the entry appears in the correct day group, with its
         client/project label, tag chips, billable state, and a duration matching the
         from/to range — all set from the form, no follow-up edit needed.
   - [ ] `tt list --all` (and `tt report`) show the identical entry — same
         client/project, tags, billable, and span. The GUI add and `tt add` are the same
         core write (parity: the `add` IPC channel ↔ `tt add`).
2. Open the form again and add another entry whose **From**/**To** **overlaps** the one
   you just created (e.g. 14:00 → 15:00).
   - [ ] The entry **still saves** (the form closes) — overlap is *not* a block.
   - [ ] The non-blocking overlap banner appears inline above the list (the same
         allowed-but-flagged advisory the edit/start paths raise), and both overlapping
         rows carry the `overlap` flag in the list and in a report covering the day.

> The warned-not-blocked behaviour is proven surface-neutrally over core+tt by the BDD
> "Attribute-bearing backfill that overlaps is warned, not blocked" scenario; the GUI
> form's full field set + the inline overlap banner are screenshotted under JUDGE
> (`MANUAL_ADD_FORM`, `main-add-form.png`) and bound back to `tt add` by the parity
> matrix. This runbook confirms the real window lands the full-attribute entry day-grouped
> at parity with `tt add` and that an overlapping span is warned inline but still saved.

## CHECK EDIT RUNNING ENTRY (GUI) — amend the open timer without stopping it (§05 R6)

1. Start a live timer in the GUI (or `tt start "auth refactor" --client "Client A"`).
   Confirm the running row shows a live count-up.
2. On the running entry's row, click **Edit**. The row swaps into an inline edit
   form seeded with the current description and start time.
   - [ ] While the form is open the entry is still shown as running (the running
         indicator/accent stays on the row; the timer has not stopped).
3. Change the **description** and nudge the **start time** a few minutes earlier,
   then click **Save**.
   - [ ] The row returns to display mode with the new description and start time;
         the count-up continues — the entry was **not** closed.
   - [ ] `tt status` still reports the timer as running (no `endUtc`), and
         `tt list` shows the amended description and start time.
4. Click **Edit** again, then **Cancel**.
   - [ ] The form closes with no change; the entry is unchanged and still running.

> The edit-running semantics are proven surface-neutrally over core+tt by the BDD
> scenarios "Editing amends a field without disturbing the open state" and "Editing
> the running entry's start does not stop it"; the GUI affordance is screenshotted
> under JUDGE (`EDIT_RUNNING`, `main-edit-running.png`) and guarded statically
> (`renderer-static.test.ts`: the edit path never sends `endUtc`). This runbook
> confirms the real app keeps the timer open and round-trips the change to `tt`.

## CHECK EDIT/DELETE ENTRIES (GUI) — amend any field in-context, two-step delete (§06 R1)

1. Open the main window with at least one **closed** entry (or `tt add "design
   review" --from "2h ago" --to "30m ago" --client "Acme"`). Confirm the row shows in
   its day group.
2. On the closed entry's row, click **Edit**. The row swaps into an inline edit form
   (not a separate window) seeded from the entry.
   - [ ] The form shows description, **Start**, **End**, **Billable**, and a **client
         select** — all pre-filled from the entry (any field is editable in-context).
3. Change the **description** and nudge the **Start** time a few minutes, optionally
   pick a different **client**, then click **Save**.
   - [ ] The row returns to display mode showing the new values.
   - [ ] `tt list` shows the amended description/start/client — the GUI and the DB
         agree (the edit went through the same `edit` path `tt` uses).
4. Now edit the **open** (running) entry's **Start** and Save (parity with the BDD
   scenario "Editing the running entry's start does not stop it").
   - [ ] The open entry stays open — `tt status` still reports it running (the form
         has no End field for the open row, so the patch never carries `endUtc`).
5. On any row, click **Delete** (the row's or the form's).
   - [ ] The first click does **not** remove the entry — it swaps into a "Confirm
         delete?" affordance with a **Cancel**.
   - [ ] Click **Cancel**: the entry survives, the button returns to **Delete**.
   - [ ] Click **Delete** then **confirm**: the entry disappears from the GUI **and**
         from `tt list`.

> The edit/delete *behaviour* is proven surface-neutrally over core+tt by the BDD
> scenarios in `features/overlap_and_editing.feature`; the GUI affordances are
> screenshotted under JUDGE (`EDIT_INLINE` / `DELETE_CONFIRM`, `main-edit.png`) and
> guarded statically (`renderer-static.test.ts`: an Edit control wired to
> `window.stint.edit`, every field seeded, and Delete routed through a confirm step).
> This runbook confirms real keyboard input, the client select, and the two-step
> delete on a real desktop — the OS residual the headless harness cannot cover.

## CHECK MERGE (GUI) — multi-select + conflict prompt folds entries into one (§06 R3, §12 R6)

1. Open the main window with at least two **adjacent closed** entries on the same day
   that **disagree** on client/billable — e.g.
   `tt add "api work" --from "3h ago" --to "2h ago" --client "Client A" --project API`
   then `tt add "internal sync" --from "2h ago" --to "1h ago" --no-billable` (no client).
   Confirm both rows show in the day group, each with a leading **select** checkbox.
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
6. Now select two **adjacent** entries that **agree** on client and billable and click
   **Merge**.
   - [ ] No conflict prompt appears — the merge fires directly (nothing to resolve).

> The merge *behaviour* (concatenated descriptions, unioned tags, conflict override) is
> proven surface-neutrally over core+tt by the BDD merge scenarios in
> `features/overlap_and_editing.feature` and the GOLD merge-override contract; the GUI
> multi-select + conflict prompt is screenshotted under JUDGE (`MERGE_CONFLICT`,
> `main-merge-conflict.png`) and guarded statically (`renderer-static.test.ts`). This
> runbook confirms the real checkboxes, the live prompt, and the round-trip to `tt` on a
> real desktop.

## CHECK INLINE EDIT, SPLIT & MERGE (GUI) — the consolidated entry editor (§12 R6)

Confirms the §12 R6 editor surface end-to-end on a **real desktop** against a **real DB**:
the per-entry kebab opens one modal exposing every `tt`-editable field, plus Split and
Merge, and every change round-trips to the same DB `tt` reads (the Electron host and the
OS-level DB round-trip have no Playwright host, so this is MANUAL). Run with `tt` in a
second terminal pointed at the same database.

1. Seed a closed entry: `tt add "design review" --from "2h ago" --to "1h ago" --client "Acme" --project API --tag deep`.
2. In the running main window, click the entry row's **⋯ (kebab)** button.
   - [ ] A modal **editor** opens showing **Description**, **Client**, **Project**,
         **Start**, **End**, **Tags** (chips), and a **Billable** toggle — every field
         `tt edit` accepts, all seeded from the entry.
3. Change **each** field — edit the description, pick a different client/project, nudge
   Start/End, add and remove a tag, flip Billable — then click **Save**.
   - [ ] `tt list --json` shows the entry with **every changed field persisted**; the GUI
         and the DB agree (the editor went through the same `edit` path `tt` uses).
4. Re-open the editor and click **Split at instant…**, pick an instant **inside** the span,
   confirm **Split**.
   - [ ] `tt list` shows **two contiguous** entries that exactly tile the original span
         (the split boundary is the picked instant; no time is lost or gained).
   - [ ] Picking an instant **outside** the span is rejected (the editor refuses it and
         core would reject it too).
5. With two **adjacent closed** entries that **disagree** on client/billable selected via
   their row checkboxes, click the toolbar **Merge selected** (or the merge bar).
   - [ ] A **conflict prompt** asks which **client/project** and which **billable** value
         to keep **before** merging; pick the winners and confirm.
   - [ ] `tt list` shows **one merged row** with the **chosen** client/project/billable,
         the two **descriptions concatenated**, and the **tags unioned** (§06 R3) — GUI
         and DB agree.
6. Re-open the editor on any entry, click **Delete**, and confirm the two-step prompt.
   - [ ] The entry is gone from both the GUI and `tt list` — and only after the explicit
         confirm tap (a stray first click never deletes).

> The edit/split/merge/delete *behaviour* is proven surface-neutrally over core+tt by the
> BDD scenarios in `features/overlap_and_editing.feature` and the GOLD merge-override
> contract; the consolidated editor modal is screenshotted headless under JUDGE
> (`INLINE_EDITOR`, `main-editor.png`) and guarded statically (`renderer-static.test.ts`:
> `editor.js` is a pure renderer exposing `openEditor` + the split/merge paths, every
> `tt`-editable field present, no name resolution). This runbook confirms the real kebab,
> the live modal, and the round-trip to `tt` on a real desktop — the parts no headless host
> can drive.

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
5. Click **Custom…**, enter an explicit **from**/**to** spanning only the last-week entry,
   and click **Apply**.
   - [ ] The resolved-range header echoes the entered window and the total/rows match
         `tt report --range <FROM> <TO>` for the same bounds.

> The preset→window resolution lives in core's `resolveRange` (BDD `features/reports.feature`
> runs the same This-week / Last-week / custom / group-by-client contract over core AND tt);
> this runbook confirms the GUI picker calls into it and agrees with `tt report --<preset>` /
> `--range` on a real session. JUDGE screenshots the affordance headless
> (`REPORT_RANGE_PICKER`, `reports-default.png` / `reports-custom.png`).

## CHECK REPORT EXPORT (GUI) — Export CSV / JSON writes a file matching `tt export` (§09 R6, §12 R8)

Confirms the report view's **Export CSV** / **Export JSON** buttons write a real file through
the OS save dialog whose **bytes match `tt export --csv/--json` for the same range** — the
cross-surface byte-for-byte parity JUDGE cannot exercise (the native save dialog has no
Playwright host, the same rationale as the global-hotkey MANUAL case).

1. Seed a few entries this week against a known DB, e.g.:
   `tt add "auth refactor" --from "Mon 09:00" --to "Mon 12:00" --client "Acme" --project "API" --tag deep`
   and `tt add "admin" --from "Tue 09:00" --to "Tue 09:30" --no-billable`.
2. In the running app, open the **Report** view (the *This week* button in the toolbar) and
   leave the range on **This week** (the default).
   - [ ] The on-screen grouped summary shows the seeded entries with their per-line totals
         and a grand total, and any overlap / unreviewed-sleep entries carry their flag
         **inline on the affected row** (not in a separate list).
3. Click **Export CSV**, accept the suggested filename in the native save dialog, and save.
   - [ ] A status line confirms the write (`Exported N entries to <path>.`).
   - [ ] `diff <path> <(tt export --week --csv)` reports **no differences** (the GUI export
         is byte-identical to `tt export --week --csv` — raw entries for the range, the exact
         CSV column contract, both billable and non-billable rows present).
4. Click **Export JSON**, save to a second file.
   - [ ] `diff <path.json> <(tt export --week --json)` reports **no differences**.
5. Cancel the save dialog on a third Export click.
   - [ ] No file is written and the status line reads `Export canceled.` (the cancel path
         is non-destructive — the renderer never reaches `fs`; main owns the write).

> The export bytes themselves are core's `toCsv` / `toJsonEntries` (GOLD `gold/contracts.test.ts`
> + the GUI `reportview.test.ts` proves `exportPayload` is byte-identical to them); this runbook
> confirms the GUI round-trips through main's `exportEntries` handler + the OS save dialog and
> lands a file equal to `tt export` on a real session. JUDGE screenshots the summary + buttons
> headless (`REPORT_SUMMARY`, `reports-summary.png`) but cannot drive the native save dialog.

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

## CHECK ENTRY LIST GROUPING, FILTERING & SEARCH (GUI) — the §12 R9 control bar at parity (§12 R9, §17 R8)

The grouping/filtering/search model is core's `buildEntryList` + `store.listEntries`, proven
surface-neutral on core AND tt by `features/entry_list.feature` (group by day/client/project/
tag, range/client/project/tag filters, free-text search — run TWICE) and pinned by GOLD
(`core/test/entrylist.test.ts`, `cli/test/gold/cli.test.ts` `tt list --by/--search`). The
renderer wiring (the Entries control bar re-querying `window.stint.listEntries` and
repainting the grouped list) is OS-presentation headless CI does not fully assert; this
confirms it live and cross-checks it against `tt list` with equivalent flags.

1. Seed a few entries this week against a known DB, e.g.:
   `tt add "auth refactor" --from "Mon 09:00" --to "Mon 11:00" --client "Acme" --project "Billing" --tag deep`,
   `tt add "deploy pipeline" --from "Tue 11:00" --to "Tue 12:00" --client "Globex" --project "Ops" --tag ci`,
   `tt add "standup" --from "Tue 08:00" --to "Tue 08:30" --client "Acme" --project "Billing" --tag meeting`.
2. In the running app, on the Entries view, use the **Group by** control to switch between
   **Day / Client / Project / Tag**.
   - [ ] The list **regroups live** each time, the group header showing the key + the summed
         billable hours; a multi-tag entry appears under each of its tags under Tag grouping.
   - [ ] Each grouping matches `tt list --by <day|client|project|tag>` (the same buckets,
         the same per-group hours).
3. Pick a **range preset** (e.g. This week), then switch to **Custom…** and enter an explicit
   from/to covering only one day, and Apply.
   - [ ] Only the in-range entries remain; the preset/custom window matches
         `tt list --week` / `tt list --range FROM TO`.
4. Apply a **client**, then a **project**, then a **tag** filter.
   - [ ] The list narrows to the chosen client / project / tag, matching
         `tt list --client … / --project … / --tag …`.
5. Type into the **search** box (e.g. `refactor`, then a client name, then a tag).
   - [ ] The list narrows **live** (no Enter needed) to the matching entries; matching is
         case-insensitive and hits description / client / project / tag, matching
         `tt list --search <query>` (composed with the active grouping + filters).
6. Clear the search and reset the controls to **Day / This week / no filters**.
   - [ ] The plain day-grouped list is restored, identical to the first load.

> Cross-surface agreement (full parity, §17 R8): every Entries-view grouping/filter/search
> reproduces `tt list --by/--range/--client/--project/--tag/--search` exactly — the GUI
> control bar reaches nothing tt cannot.

## CHECK CONFIRM DESTRUCTIVE (GUI) — a destructive action confirms in the window (§12 R13)

§12 R13 requires that destructive actions confirm in the window — the GUI counterpart to
`tt rm`'s confirm / `--force` — so **no entry is destroyed on a single stray click without
a confirm step**. The confirm gate is a renderer-only fact the surface-neutral BDD harness
cannot express (core/tt have no dialog); the destructive op itself (`tt rm`) is already
BDD-covered. JUDGE `CONFIRM_DELETE` (`main-confirm-delete.png`) and the renderer-static
guard prove the gate in headless CI; this confirms it on a real desktop/DB.

1. Open the main window with at least one entry (or `tt add "design review" --from "2h ago"
   --to "30m ago" --client "Acme"`). Confirm the row shows in its day group, and note the
   row count in `tt list`.
2. On the entry's row, click **Delete** (the row's or the consolidated editor's).
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
to be **fully operable from the keyboard** while respecting the OS theme/accent. JUDGE
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
   - [ ] **Stop/Start**, **Switch** (while running), and **Open Stint** are each reachable in
         order with a visible ring, and Enter/Space activates each.
5. With a screen reader on (VoiceOver / Narrator / Orca), focus the **Start/Stop** toggle and
   toggle the timer.
   - [ ] The screen reader **announces the toggle's state** — its accessible name flips
         between "Start timer" and "Stop timer" and its **pressed/running** state is announced
         (the `aria-label` + `aria-pressed` the renderer keeps current), so the running/idle
         state is conveyed without sight.
6. Switch the OS between **light and dark** (and change the system accent) while the window is
   open.
   - [ ] The window follows the theme and the focus ring stays visible/legible in both, and the
         accent ring on the primary action tracks the new system accent.

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
2. **Switch** from the running card to a new entry (new description) in one action.
   - [ ] The previous entry closes and the new one opens as a single Switch (§05 R8).
3. Open the **Manual-add** form and **backfill** a completed past entry from explicit
   from/to times plus a description + client/project + tag.
   - [ ] The completed entry appears in the list, fully attributed, no terminal used (§12 R7).
4. Open a row's **editor** and (a) **amend** a field, (b) **Split** a span at an instant,
   (c) multi-select two adjacent rows and **Merge** them (resolving the conflict prompt if
   the selection disagrees), (d) **Delete** a row through its two-step confirm.
   - [ ] Each of edit / split / merge / delete completes entirely in the window (§12 R6/R13).
5. In the **Entries** view, switch **group-by** (day/client/project/tag), apply a **range
   preset** and a **client/project/tag filter**, and type in the **search** box.
   - [ ] The list regroups, narrows, and searches live — no terminal (§12 R9).
6. In the **Reports** view, pick a range, choose a **group-by**, toggle **billable** and
   **rounding**, read the on-screen grouped totals, then **Export CSV** and **Export JSON**.
   - [ ] The summary updates and both files are written via the OS save dialog (§12 R8, §09 R6).
7. In the **Clients** view, **create / rename / archive** a client and a project, and from
   the **Tags** strip **create / rename / archive** a tag.
   - [ ] Each mutation lands; archived records drop from the active pickers but referenced
         entries keep their labels — all by hand (§12 R10).
8. In the **Settings** view, change **every §14 setting** (rounding + increment, week start,
   first check-in, check-in interval, global hotkey, accent usage, date format).
   - [ ] Each setting persists immediately and the relevant control reflects it (§12 R11).
9. Final tally:
   - [ ] You completed start-with-attributes → backfill → edit/split/merge/delete →
         entries grouping/filter/search → report builder + CSV/JSON export → client/project/tag
         create/rename/archive → every setting **without once opening a terminal**. R10 holds.

## CHECK DESTRUCTIVE CONFIRM + LIVE FILTER (§17 R11)

R11 has two halves, both renderer facts the headless JUDGE drives but only the **real
desktop window** confirms with a real OS theme/DB/dialog: (a) destructive actions
**confirm before acting** — no entry is destroyed on a single stray click; and (b)
**search / filter / group** selections are reflected **live in the list AND the report
total**, recomputed from the in-memory snapshot with no reload. JUDGE proves both headless
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
6. Switch the **group-by** (day ↔ client) and toggle the **billable** filter.
   - [ ] The list regroups and the total re-sums live, and the figure matches `tt report`
         run with the equivalent flags for the same selection.
7. Clear the search and reset the filters.
   - [ ] The list and the total both return to the full week — the live view and the plain
         load agree.

## CHECK IN-WINDOW SWITCH (GUI) — atomic stop-then-start from the card and popover (§05 R8, §12 R4)

§05 R8's Switch is the one-tap **atomic stop-then-start**: it closes the open entry and opens a
fresh one in a single write, with no idle gap between. The §12 R4 Active-Timer card and the tray
**popover** both surface Switch (alongside Stop) while a timer runs; both reuse the `start` IPC,
which maps to `store.start` (= `tt switch`). The atomicity and carry-nothing semantics are proven
surface-neutrally over core + tt by the BDD Switch scenarios in `features/tracking.feature`, and
the card/popover affordances are screenshotted headless under JUDGE (`main-switch.png`,
`popover-running.png`); this runbook confirms the real card button, the **tray popover** (which has
no Playwright host, the same residual as the global hotkey), and the round-trip to `tt` on a real
desktop.

1. Start a live timer (`tt start "auth refactor" --client "Client A"` or the GUI Start). Confirm
   the **Active-Timer card** shows the running clock counting up, the description, and both a
   **Stop** and a **Switch** button.
2. Note the running entry's id (`tt status --json`), then click the card's **Switch**.
   - [ ] The previous entry **closes** and a **new** entry **opens immediately** — the clock keeps
         counting (it does not return to idle), the card still shows *running*.
   - [ ] `tt status` reports a **different** open entry id than before (a new row), and `tt list`
         shows the prior entry now **closed** with an `endUtc` that **equals** the new entry's
         `startUtc` — no gap, no overlap (atomic stop-then-start).
3. Open the **tray popover** (click the tray icon, or press the global hotkey). While the timer
   runs it shows **Stop**, **Switch**, and **Open Stint**. Click the popover's **Switch**.
   - [ ] Same as step 2 from the popover: the open entry rolls over to a fresh one with no idle
         gap, and `tt status` shows the new id while the prior entry is closed at the same instant.
4. Stop the timer; open the popover again.
   - [ ] While **idle**, the popover hides **Switch** (Switch only makes sense mid-timer) and
         shows **Start** — its `aria-label` reads "Start timer" and flips to "Stop timer" when
         running (screen-reader state, §12 R14).

> Switch carries no attributes forward (a one-tap atomic roll-over); the attributed Start/Switch
> *form* is the separate §12 R5 work covered by CHECK START WITH ATTRIBUTES. This check confirms
> only the atomic stop-then-start and its presence on both the card and the tray popover.

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
**re-registration of the global hotkey**, the **accent-usage** and **date-format** modes re-painting
the real window against the real OS theme, and the round-trip of every control to the same DB `tt`
reads. Run with `tt` in a second terminal on the same database.

1. In the running app, click the **Settings** nav item. The panel shows the §14 settings grouped
   **Reporting / Check-ins / System**: Rounding (toggle) + Rounding increment, Week start, First
   check-in, Check-in interval, Global hotkey, Accent usage, Date / number format.
   - [ ] Each control is **pre-filled** from current state (the same values `tt config ls` prints).
2. Change **each** control once — flip Rounding on, pick a different increment, switch Week start,
   change First check-in and Check-in interval.
   - [ ] After each change `tt config ls` shows the **new** value **immediately** (changes save on
         change, no Save button) — the GUI edit and `tt config set <key> <value>` write the same row.
3. Focus the **Global hotkey** field and press a new chord (e.g. `Ctrl+Alt+Y`).
   - [ ] The field shows the new accelerator, `tt config ls` shows `global_hotkey` updated, and the
         **new** hotkey toggles the timer from another application **without a restart** (main
         re-registers the OS shortcut live); the **old** chord no longer toggles.
4. Set **Accent usage** to **Monochrome**.
   - [ ] The window's accent (the primary Start/Stop button + running clock/state) drops to the
         inked/monochrome treatment **live**; setting it back to **System accent** restores the
         system-accent colour on those elements only (accent stays confined to the primary action +
         running state, §15). `tt config ls` shows `accent` flipped both times.
5. Set **Date / number format** to **ISO (24-hour)**.
   - [ ] Times rendered across the window (entry rows, the timer card, report headers) repaint to
         the **24-hour ISO** form **live**; switching back to **System locale** restores the locale
         rendering. `tt config ls` shows `date_format` flipped both times.
6. From the other terminal, change a setting via `tt` (`tt config set rounding_increment_min 30`)
   while the Settings view is open.
   - [ ] The open panel **re-reads and updates** the affected control on the external change — the
         two surfaces stay in lockstep (the view re-renders off fresh state on every change).

> The setSetting parity (the GUI Settings view ↔ `tt config set`, every §14 key) is the
> `setSetting` parity-matrix row; JUDGE screenshots the panel headless (`SETTINGS_VIEW`,
> `main-settings.png`) and the renderer-static guard pins the field set. This runbook confirms the
> live hotkey re-registration, the accent-mode / date-format repaint against the real OS theme, and
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

1. **No Windows in the configuration.** Inspect the two source files.
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
> tag/version disagrees with what the installed app and `tt` report (§19 R06). R05 is an
> Actions/GitHub-Releases reality — there is **no executable AC** (no new core API, IPC channel, or
> DB table), so the proof is this MANUAL procedure observed on the **real upstream repo**; CI cannot
> assert the publish actually firing. The pipeline itself lives in `.github/workflows/release.yml`.
