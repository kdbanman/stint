# MANUAL evidence — recordings

This directory holds the evidence artifacts (screen recordings, command logs, and
completion confirmations) for the MANUAL runbook procedures in
`acceptance/criteria/manual/runbook.md` whose **live, OS-level** half cannot be driven in CI.

Each procedure is split into the part a headless host CAN execute (captured
deterministically in the checked-in evidence below) and the residual **live** part —
real sleep/wake, the tray + global hotkey on a real desktop session, the live GitHub
Releases query, and the OS-level app replacement + one-time Gatekeeper approval — that
only a real desktop operator can record here.

## §16 / §19 R04 — CHECK UPDATE-MID-TIMER (in-app update never touches the database)

The §16 decided behavior is that the §19 R04 download + guided install replaces the
*application* only and **never touches the database**: a timer left running while the
app is replaced is still open, unchanged, after relaunch.

| Part | Method | Status | Evidence |
|------|--------|--------|----------|
| The **no-DB-touch** invariant across a live open timer — the live `tt.sqlite` byte-identical (sha256 + size) across a SIMULATED app-replacement, the same entry still open with an unchanged id/start on **both** surfaces (`tt` + the core Store the GUI is a surface over), and the derived elapsed continuing to grow | **EXECUTED (headless)** | ✅ CONFIRMED | `acceptance/evidence/cli-transcript.md` → section **"§16 / §19 R04 — in-app update never touches the database (simulated app-replacement)"** |
| The Settings → Software Update **chrome** R03/R04 affordances — version row (R06), Check-now verdict + release link (R03), Download & install → progress bar → guided steps incl. the one-time Gatekeeper beat → Reveal installer (R04) — driven through the real renderer | **EXECUTED (headless, JUDGE)** | ✅ PASS | `acceptance/evidence/judge-report.json` → item **`SOFTWARE_UPDATE`**; screenshot `acceptance/evidence/screenshots/main-software-update.png` |
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
