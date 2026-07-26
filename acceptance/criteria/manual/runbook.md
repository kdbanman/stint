# MANUAL runbook — the live residue

A check is manual **only where headless CI physically cannot reach** — live network, a
real desktop OS, real wall-clock/power events, or the live Actions run itself. Any other
manual check is a process defect. `context/process.html` §05 owns the normative inventory
of that residue ("Manual — the live residue"); this runbook is the procedures for it and
nothing else. Every procedure below declares the §05 row it serves, and every §05 row has
a procedure here.

Everything else the GUI does is proven headlessly by its BDD / PROP / GOLD / JUDGE mirror.
The **Retired procedures** table at the foot of this file names each procedure that used to
be narrated here and the mirror that proves it now — the fact moved to its one home, it was
not dropped.

Run the GUI with `npm run build && npm run gui` (requires an Electron binary with
bundled Node ≥ 22.5 — see PRD §15). The CLI and GUI share the same database, so
`tt` is used throughout to observe state. An operator (human, or an agent with shell +
GUI access) confirms each step and attaches evidence.

---

## CHECK SLEEP-SPAN — second-accurate spans + working subtract (§10a, §17 R5)

**§05 residue row —** Real sleep/wake spans (§10a)

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

**§05 residue row —** Real sleep/wake spans (§10a)

1. With a timer open, fully quit the app, sleep the machine ~120 s, wake, relaunch.
   - [ ] On launch a SleepSpan (source `gap`) is created from the wall-clock gap and
         the entry is flagged slept-through for review; the gap bounds the dead time.
   - [ ] Because the gap can't tell true sleep from app-closed time, the span is a
         flagged suspicion only — never auto-subtracted (the operator decides).

## CHECK TRAY + GLOBAL HOTKEY (§12 R01/R2)

**§05 residue row —** Tray + global hotkey on a real desktop session (§12 R01/R02)

§12 R01 (G8) requires the tray's **single left-click to open the compact popover only**
— the old 3-item Start/Stop + Open Stint **dropdown action menu is removed**, and the
popover is the sole surface for those actions. It also requires the **glyph itself to state
whether a timer is running**, on every platform. Verify on a real desktop session (no tray
host headless, so this is the gating evidence for both the tray's click behavior and the
rendered mark). Steps 4 and 5 are the two other things only a real desktop session can
show: an OS notification actually arriving, and the OS shortcut actually re-registering.

1. With the app running, observe the tray/menu-bar **glyph** as you start and stop a timer.
   - [ ] **Idle** shows the mark's **two stacked bars**; **running** shows a **single
         fused block** (design.html D20). The change is visible **without hovering** —
         a state you can only discover from the tooltip is a FAIL.
   - [ ] The glyph occupies the same space in both states — the menu bar does not shift.
   - [ ] **macOS only:** the glyph is monochrome and follows light/dark menu-bar
         appearance, and the count-up title runs beside it once per second. On **Linux**
         there is no title — the glyph alone must carry the state (issue #162).
   - [ ] Pressing the global hotkey (default `Ctrl+Alt+T`) from another application
         toggles the timer — stops if running, resumes the last entry if idle — and the
         **glyph flips with it**.
2. Check the app mark outside the tray.
   - [ ] The dock (macOS) / launcher entry (Linux) shows the Stint mark, **not** a
         generic placeholder or the stock Electron logo.
   - [ ] **Linux only:** the main window's taskbar and alt-tab entries show the mark, and
         a check-in notification carries it rather than the desktop's fallback icon.
3. Click the tray icon and observe the click behavior (§12 R01).
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
4. **A check-in notification actually arrives on the real desktop (§10b, §17 R6).** With a
   timer running, compress the cadence (`tt config set first_checkin_min 2` and
   `tt config set checkin_interval_min 1`) and wait for the first check-in.
   - [ ] A real OS notification **appears** on the desktop — not merely scheduled.
   - [ ] It offers **Stop**, **Keep going**, and the inline interval choices
         (`+15m / +30m / +60m / +120m`); picking a choice does **not** stop the timer.
   - [ ] Restore the real defaults afterwards (`first_checkin_min 60`,
         `checkin_interval_min 30`), and confirm once in a long-form run that the first
         notification lands at start + 60 min.

   > Only the notification *arriving on a real desktop* is manual. The cadence itself —
   > first at 60 then every 30, autonomous when ignored, fires once on relaunch, realigns
   > from wake, a picked interval applying to the next gap only — is proven deterministically
   > by PROP `packages/core/test/prop/checkin.test.ts`, and the notification's action set and
   > per-choice override by GOLD `packages/gui/test/checkin-notify.test.ts`.

5. **The global hotkey re-registers live (§14).** In **Settings**, focus the **Global
   hotkey** field and press a new chord (e.g. `Ctrl+Alt+Y`).
   - [ ] `tt config ls` shows `global_hotkey` updated, the **new** chord toggles the timer
         from another application **without a restart**, and the **old** chord no longer
         does — main re-registered the OS shortcut live.

## CHECK SOFTWARE UPDATE — CHECK FOR UPDATES (§19 R03)

**§05 residue row —** Live update check against GitHub Releases (§19 R03)

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
logic is proven offline by GOLD (`packages/gui/test/update.test.ts`); the renderer wiring headless by
JUDGE `SOFTWARE_UPDATE`. This MANUAL CHECK confirms the live query + the
on-screen verdict + the no-DB-write invariant on a real install.

Start a **socket monitor** before step 1 and leave it running for the whole check
(`lsof -i`, `ss -tunap`, or a packet monitor) — step 5 reads it.

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
5. **The offline promise, live (§17 R09).** Re-enable the network, exercise every other feature of
   the app and `tt` for the rest of the session, then read the monitor.
   - [ ] The **only** outbound connection made by the app or `tt` for the whole session is the
         **Check now** request to the GitHub Releases API — the one exception §17 R09 permits.
   - [ ] Neither surface opens a listening socket, and no telemetry or analytics connection appears.

   > The source-level half of §17 R09 runs on every PR: GOLD
   > `packages/core/test/gold/no-network.test.ts` + `scripts/check-no-network.mjs`
   > (`npm run verify:no-network`) scan every shipped surface and the production dependency
   > tree, and pin Electron `net` to exactly one shipped file — this update check — with a
   > deletion test that fails if a second call site appears. Only the live traffic is manual.

> This check **FAILS** if the Current version shown differs from `app.getVersion()` / `tt
> --version`; if **Check now** does not query GitHub Releases or misreports the verdict (calling an
> equal/older release an update, or a newer release up-to-date, against the `YYYY.M.D[.N]` rule);
> if an update-available verdict omits the newer version or its release link; if the check **writes
> the database** (mtime changes — violating §19 R04); if a failed/offline check **crashes** the
> app instead of showing a graceful error; or if any outbound connection other than the update
> check appears on the monitor (§17 R09). R03 is a live-network + GUI reality with no headless
> network AC (the no-network backstop forbids a test reaching GitHub); the pure verdict logic is
> proven offline by GOLD `packages/gui/test/update.test.ts` and the wiring headless by
> JUDGE `SOFTWARE_UPDATE`, so the **live query** itself is confirmed by this
> MANUAL CHECK on a real install.

## CHECK INSTALL — single artifact puts the GUI in Applications/launcher and `tt` on PATH (§19 R02)

**§05 residue row —** OS-level install, app replacement, Gatekeeper (§19 R02/R04)

§19 R02 (decision **G2**) is the single-installer mechanism: **one** artifact per platform, run
**once**, leaves **both** the GUI installed (in Applications on macOS / the app launcher on Linux)
**and** `tt` on `PATH` — with **no separate Node install**, because `tt` runs through the Node
bundled in the GUI app. The mechanism is the `packaging/` tree: `packaging/tt-launcher.sh` is the
on-`PATH` `tt` shim (it finds `packages/cli/dist/bin.js` in the installed bundle and exec's the
bundled Node against it); on macOS the `.pkg` payload installs `Stint.app` into `/Applications`
and its `postinstall.sh` symlinks `tt` (`/usr/local/bin/tt`, falling back to `~/.local/bin/tt`);
on Linux `packaging/linux/install.sh` copies the AppImage to `/opt/stint` (or `~/.local/opt/stint`),
writes a `.desktop` launcher entry, and symlinks `tt` the same way. This check confirms a **single**
install run yields **both** outcomes on each platform, that the built artifacts really launch, and
that uninstall reverses both. The in-app updater (§19 R03/R04), Release publishing (§19 R05), and
versioning (§19 R06) are out of scope here.

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
   - [ ] **No `.exe`, `.msi`, or NSIS installer** was produced on any runner (§19 R01's static half —
         a `win` block or a `windows-latest` matrix entry — already fails CI through GOLD
         `packages/gui/test/build-matrix.test.ts`; this is the built-artifact confirmation).

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

**§05 residue row —** Publish-on-merge actually firing (§19 R05)

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

## CHECK INSTALL & UPDATE (§17 R13) — the installer lands both surfaces on one version, and the in-app updater completes a guided install without touching the DB

**§05 residue row —** OS-level install, app replacement, Gatekeeper (§19 R02/R04)

§17 R13 is the **acceptance umbrella** over the whole §19 packaging-installation-update story: the
single installer puts the GUI in Applications / the app launcher **and** `tt` on `PATH` (§19 R02),
both reporting the **same** `YYYY.M.D[.N]` version (§19 R06); the in-app updater detects a newer
GitHub release (§19 R03) and completes a **download + guided install** (§19 R04) that **never touches
the database** (§16 / §19 R04). The component mechanisms are each proven in their own checks above —
**CHECK INSTALL** (§19 R02) and **CHECK SOFTWARE UPDATE — CHECK FOR UPDATES** (§19 R03) — and
their headless backstops are GOLD `packages/gui/test/update.test.ts` (the `YYYY.M.D[.N]` ordering +
verdicts, the guided-step plan, and the size-verified `downloadUpdate` making zero Store calls),
`packages/cli/test/gold/cli.test.ts` + `packages/core/test/gold/contracts.test.ts` (the one shared
`APP_VERSION`), and JUDGE `SOFTWARE_UPDATE` (the driven Settings → Software Update
group). **This umbrella walks the end-to-end install→update reality as ONE criterion**: a freshly
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
   **both** surfaces (this is the §16 "update arrives mid-timer" lens — the only place a *real*
   app replacement across a *real* running timer is exercised).
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
> (`acceptance/evidence/cli-transcript.md` → "§16 / §19 R04 — in-app update never touches the database",
> which simulates the app-replacement swap and re-reads both surfaces). Part **(a)**'s no-Windows install
> + single-installer bundle is backstopped by the `packaging/` static guards (GOLD
> `packages/gui/test/build-matrix.test.ts`) reported in the transcript's §19 R01 section. The
> residual **live** end-to-end — a clean install of a stamped release, a real GitHub download, the OS-level
> replacement + Gatekeeper, and the relaunch across a running timer — awaits a real desktop operator's
> screen recording in `acceptance/evidence/recordings/` (see that directory's `README.md`).

---

## Retired procedures — where each one is proven now

Every procedure below used to be narrated in this file. None of them is live residue: each
runs headlessly on the PR path through the mirror named beside it, so narrating it here was
a second home for a fact CI already owns (process.html §04 one-home, §05 boundary rule). The
handful of *live* slivers those procedures carried have been folded into the procedures above,
named in the right-hand column.

| Retired procedure | Proven now by |
|---|---|
| CHECK CHECK-IN CADENCE + RELAUNCH (§10b, §17 R6) | PROP `packages/core/test/prop/checkin.test.ts` (first at 60, then every 30 even when ignored, fires once on relaunch, realigns from wake, a picked interval applies to the next gap only); GOLD `packages/gui/test/checkin-notify.test.ts` (Stop / Keep going / interval choices and each choice's override); BDD `features/app_state_durability.feature`. Live sliver — the notification actually arriving on a real desktop — is CHECK TRAY + GLOBAL HOTKEY step 4. |
| CHECK START WITH ATTRIBUTES (§05 R1, §12 R1, §17 R8) | GOLD `packages/gui/test/start.test.ts`; BDD `features/reachable_by_hand.feature` "Start with attributes by hand (the Start form)"; JUDGE `START_ATTRIBUTES`. |
| CHECK MANUAL BACKFILL (GUI) (§05 R5) | BDD `features/tracking.feature` "Backfill creates a completed entry" / "Backfill overlapping an existing entry is allowed"; `features/reachable_by_hand.feature` "Backfill a completed past entry by hand (the Manual-add form)"; JUDGE `UNIFIED_FORM_ADD`. |
| CHECK MANUAL ADD FORM (GUI) (§12 R7, §12 R15/R17, §06 R4) | BDD `features/overlap_and_editing.feature` "Attribute-bearing backfill that overlaps is warned, not blocked"; JUDGE `UNIFIED_FORM_ADD`; parity `acceptance/criteria/parity-matrix.json` bound by `packages/gui/test/parity.test.ts`. |
| CHECK UNIFIED ENTRY FORM — EDIT, SPLIT & DELETE (GUI) (§12 R06) | BDD `features/reachable_by_hand.feature` (edit / split by hand) + `features/overlap_and_editing.feature` (amend without disturbing open state, delete, delete-without-confirmation refused, editing the running start); JUDGE `UNIFIED_FORM`, `SPLIT_AFFORDANCE`, `DELETE_CONFIRM`, `WRITE_REJECTION_FEEDBACK`. |
| CHECK MERGE (GUI) (§06 R3, §12 R6) | BDD `features/overlap_and_editing.feature` merge scenarios (concatenated descriptions, chosen-client override, non-contiguous refused without acknowledgement / folded with it); JUDGE `MERGE_CONFLICT`, `MERGE_GAP`, `MERGE_NOCONFLICT`. |
| CHECK MERGE VIA CALENDAR CHECKBOXES (GUI) (§06 R03, §12 R16) | BDD `features/reachable_by_hand.feature` "Merge a contiguous selection by hand (the calendar corner-checkbox merge)" + the `features/overlap_and_editing.feature` merge scenarios; JUDGE `MERGE_CONFLICT`, `MERGE_NOCONFLICT`, `CALENDAR_LAYOUT`. |
| CHECK OVERLAP BANNER (GUI) (§06 R4, §12) | BDD `features/overlap_and_editing.feature` "Backfill that overlaps an existing entry is warned, not blocked"; JUDGE `OVERLAP_BANNER`. |
| CHECK REPORT BILLABLE TOGGLE (GUI) (§08 R3, §12 R8) | BDD `features/reporting.feature` "The billable filter includes, totals all, or isolates non-billable time"; JUDGE `REPORTS_VIEW` (the billable segment is machine-scored in the builder). |
| CHECK REPORT RANGE PICKER (GUI) (§09 R1, §12 R8) | BDD `features/reports.feature` (This-week / Last-week / custom presets) + `features/reporting.feature` "A custom range is a pair of plain dates covering both boundary days"; GOLD `packages/gui/test/reportview.test.ts` (`resolveDateRange`, half-open window, DST to-day); JUDGE `REPORTS_VIEW`. |
| CHECK REPORT EXPORT (GUI) (§09 R06/R09, §12 R8) | GOLD `packages/gui/test/reportview.test.ts` (`exportPayload` byte-identical to core `toCsv`/`toJsonEntries`; both `resolveExportDefinition` scopes byte-identical to `tt report run` / `tt export`); BDD `features/saved_reports.feature` "A saved report's two export scopes differ" + `features/reachable_by_hand.feature` "Export the range by hand"; JUDGE `REPORTS_VIEW` (both export controls, their scope arguments, and the honest "(all data)" wording). |
| CHECK REPORT BUILDER (GUI) (§09 R4, §12 R8) | BDD `features/reporting.feature` "Rounding rounds the grouped line nearest the increment, not the stored time" + "A report flags two overlapping entries within the range"; GOLD `packages/core/test/gold/contracts.test.ts` (`roundSeconds`); JUDGE `REPORTS_VIEW` (rounding toggle + increment picker). |
| CHECK NO NETWORK (§17 R9) | GOLD `packages/core/test/gold/no-network.test.ts` + `scripts/check-no-network.mjs` (`npm run verify:no-network`) — every shipped surface and the production dependency tree scanned, Electron `net` pinned to one shipped file, with a deletion test guarding the pin. Live sliver — a real socket monitor over a whole session — is CHECK SOFTWARE UPDATE — CHECK FOR UPDATES step 5. |
| CHECK GUI-SEARCH (§09 R7) | BDD `features/search.feature` (description / client / project / tag, case-insensitive, blank query) + `features/entry_list.feature` search rows; JUDGE `LIVE_FILTER`. |
| CHECK ENTRIES CALENDAR — RANGE, FILTERING & SEARCH (GUI) (§12 R9, §12 R16, §17 R8) | BDD `features/entry_list.feature` (range, client / project / tag filters, composed search, per-day + range totals); GOLD `packages/gui/test/entriesquery.test.ts`; JUDGE `ENTRIES_CALENDAR`, `LIVE_FILTER`. |
| CHECK CONFIRM DESTRUCTIVE (GUI) (§12 R13) | GOLD `packages/gui/test/confirm.test.ts` (the two-step gate: armed, not permitted, on the first request); BDD `features/overlap_and_editing.feature` "Deleting an entry without confirmation is refused"; JUDGE `CONFIRM_DELETE`, `CONFIRM_ARCHIVE`, `CONFIRM_DESTRUCTIVE`, `RESTORE_ARCHIVED`. |
| CHECK KEYBOARD & FOCUS (GUI) (§12 R14) | JUDGE `KEYBOARD_FOCUS` (the Tab-walk over the empty + running windows, every visible control reached with a ring), `TARGET_SIZE`, `CLICKABILITY`; GOLD `packages/gui/test/design-guard.test.ts` (the computed contrast + reduced-motion floors). design.html's A-floors carry no MANUAL secondary — no design floor is physical (acceptance.html §07). |
| CHECK ALL CAPABILITIES REACHABLE BY HAND (GUI) (§17 R10) | BDD `features/reachable_by_hand.feature` (twelve by-hand scenarios, run over core AND `tt`); GOLD `acceptance/criteria/parity-matrix.json` bound both directions by `packages/gui/test/parity.test.ts`; JUDGE `PARITY_REACH`. |
| CHECK DESTRUCTIVE CONFIRM + LIVE FILTER (§17 R11) | JUDGE `CONFIRM_DESTRUCTIVE`, `LIVE_FILTER`; GOLD `packages/gui/test/confirm.test.ts`; BDD `features/entry_list.feature` "Per-day and range billable totals over the week — including an empty day". |
| CHECK CLIENTS & PROJECTS MANAGEMENT (GUI) (§12 R11, §07) | BDD `features/reference_data.feature` (create / rename / archive / restore, both records, refusals) + `features/parity.feature` client and project lifecycle scenarios; JUDGE `CLIENTS_VIEW`, `RESTORE_ARCHIVED`. |
| CHECK TAGS MANAGEMENT (GUI) (§12 R11) | BDD `features/reference_data.feature` tag scenarios (create, rename, archive, restore, duplicate refusals); GOLD `packages/gui/test/tags.test.ts`; JUDGE `CLIENTS_VIEW`, `TAG_CHIPS`. |
| CHECK SETTINGS VIEW (GUI) (§12 R11, §14) | BDD `features/settings.feature` (every §14 key editable and read back, plus the rejected pairs) + `features/parity.feature` "Changing a setting and reading it back behaves identically on both surfaces"; JUDGE `SETTINGS_VIEW`. Live sliver — the OS shortcut re-registering without a restart — is CHECK TRAY + GLOBAL HOTKEY step 5. |
| CHECK BUILD MATRIX (§19 R01) | GOLD `packages/gui/test/build-matrix.test.ts` (mac + linux blocks, no `win` block, no Windows-only targets, the pack matrix exactly `[macos-latest, ubuntu-latest]`, no `windows-latest` runner, no `.exe`/`.msi` reference) and the `pack-smoke` / `pack-smoke-mac` jobs in `.github/workflows/ci.yml`, which pack a real Linux and a real macOS app on every PR. The artifacts launching on a real desktop is CHECK INSTALL; the two-artifact release is CHECK PUBLISH-ON-MERGE step 3. |
| CHECK INTEGRITY-ON-OPEN (§20 R03) | BDD `features/integrity_check.feature` "Corrupt database is detected on open and refused before any write" (a genuinely corrupt file, run over core AND `tt`, asserting the bytes are unchanged); JUDGE `RECOVERY_NOTICE`. |
| CHECK BACKUP & RECOVERY (§17 R12, §20 R04/R05) | BDD `features/backup_recovery.feature` (recoverable launch backup, corruption recovered from the latest backup without data loss, explicit named restore setting the current file aside); GOLD `packages/core/test/gold/backup-retention.test.ts`, `packages/gui/test/backupview.test.ts`, `acceptance/criteria/schemas/backup.schema.json`; JUDGE `BACKUPS_SECTION`, `RECOVERY_NOTICE`. |
| CHECK VERSION-SKEW REFUSAL (§20 R09) | GOLD `packages/core/test/gold/migration.test.ts` ("refuses to open a DB from a NEWER schema…" and "Store.open refuses the same future-stamped DB… and writes no launch backup") + `packages/cli/test/gold/cli.test.ts` ("tt status on a future-stamped DB exits 1 with both versions and the remedy on stderr, leaving the directory unchanged"). |
| CHECK SOFTWARE UPDATE — VERSION DISPLAYED (§19 R06) | GOLD `packages/cli/test/gold/cli.test.ts` (`tt --version` prints exactly the stamped `YYYY.M.D[.N]`) + `packages/core/test/gold/contracts.test.ts` (`isReleaseVersion` / `APP_VERSION`, rejecting the `1.0.0` semver and the dev sentinel) + `acceptance/criteria/schemas/version.schema.json`; JUDGE `SOFTWARE_UPDATE` (the Current-version row reads the stamped version). The cross-surface read on a real install is CHECK INSTALL & UPDATE part (a). |
| CHECK UPDATE-MID-TIMER (§16, §19 R04) | GOLD `packages/gui/test/update.test.ts` (the artifact lands in TEMP, never beside the DB; the download flow makes zero Store calls) and the executed no-DB-touch walk in `acceptance/evidence/cli-transcript.md`; JUDGE `SOFTWARE_UPDATE`. The live app replacement across a real running timer is CHECK INSTALL & UPDATE part (d). |
| CHECK BACKUP-ON-LAUNCH (§16, §20 R04) | BDD `features/backup_recovery.feature` "A fresh launch makes a recoverable backup"; GOLD `packages/core/test/gold/backup-retention.test.ts` (retention pruning, including the keep-all edges); JUDGE `BACKUPS_SECTION`. |
| CHECK CORRUPTION-RECOVERY (§16, §20 R03/R05) | BDD `features/integrity_check.feature` + `features/backup_recovery.feature` "A corrupted database is recovered from the latest backup without data loss"; JUDGE `RECOVERY_NOTICE` (the banner naming both `recoveredFrom` and `quarantinedTo`). |
| CHECK INLINE INTERVAL PICKER (GUI) (§12 R15) | JUDGE `UNIFIED_FORM` and `UNIFIED_FORM_ADD` (in-flow chrome with no backdrop and no Apply, month calendar + hour-lined track, body-drag-moves-both / grip-resizes-stop at 5-min snap writing the bound fields live, gray others / inert yellow overlap, Save as sole commit), `TIMER_VIEW` (the running start-only variant), `TIMELINE_WINDOW`. |
| CHECK RUNNING START-ONLY PICKER (§05 R06, §12 R14) | BDD `features/tracking.feature` "Editing the running entry start never closes it and never synthesizes an end" + "A future start on the running entry is rejected and never wedges Stop"; JUDGE `TIMER_VIEW`, `FUTURE_START_GUARD`, `RUNNING_SINGLE_ACTION`. |
| CHECK ENTRIES CALENDAR (§12 R16) | JUDGE `CALENDAR_LAYOUT`, `ENTRIES_CALENDAR` (fixed-width columns, horizontal scroll, the working-hours default that scrolls rather than clips, per-day header totals + range chip, empty columns, hover ops + corner checkbox, click-opens-editor, running future-fade, overlap band, slept hatch, the two-checkbox merge bar); BDD `features/entry_list.feature` "Per-day and range billable totals over the week — including an empty day". |
| CHECK EXACT/OVERNIGHT ENTRY VIA EXPANDER (GUI) (§12 R17) | BDD `features/tracking.feature` "Backfill creates a completed overnight entry" (22:00 → 02:00 next day, one closed entry, 240 billable minutes, run over core AND `tt`); JUDGE `UNIFIED_FORM_EXPANDER`. |
