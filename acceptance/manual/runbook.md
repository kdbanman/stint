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

> The pure cadence math is already proven deterministically in
> `packages/core/test/prop/checkin.test.ts` and shown in the evidence transcript;
> this runbook confirms the wall-clock firing on real hardware.

## CHECK TRAY + GLOBAL HOTKEY (§12 R1/R2)

1. With the app running, observe the tray/menu-bar title.
   - [ ] While a timer runs, the tray title counts up once per second.
   - [ ] Pressing the global hotkey (default `Ctrl+Alt+T`) from another application
         toggles the timer — stops if running, resumes the last entry if idle.
   - [ ] Clicking the tray opens the popover with the running timer; one click stops it.

## CHECK NO NETWORK (§17 R9)

1. Run the app + `tt` through a full session under a network monitor
   (`lsof -i`, `ss -tunap`, or a packet monitor), exercising every feature.
   - [ ] Zero outbound connections from the app or `tt` for the whole session.
   - [ ] The app opens no listening or outbound sockets; no telemetry, update-check,
         or analytics code path exists.

> A cheap GOLD backstop runs in CI (`npm run verify:no-network`) — scanning the
> shipped source and production dependency tree for any networking import or
> outbound-request code path. This live-traffic confirmation stays manual.
