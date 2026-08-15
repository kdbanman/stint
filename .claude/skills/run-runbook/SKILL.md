---
name: run-runbook
description: >-
  Run the agent-executable subset of the MANUAL runbook
  (acceptance/criteria/manual/runbook.md) from an agent session — the shell
  checks, the live GitHub Releases query, and the publish-on-merge
  observation CI's no-network backstop cannot make — then hand off the
  irreducibly physical residue as a checklist for a human on a real desktop.
  Use when asked to run, execute, or verify the manual runbook, or any of its
  CHECK procedures, from a session.
---

# Run the MANUAL runbook (agent pass)

The runbook's operator is "human, **or an agent with shell + GUI access**"
(`acceptance/criteria/manual/runbook.md` preamble; `context/acceptance.html` §03/§10).
This skill is the agent pass: a session has the shell and the live network CI's
no-network backstop forbids, so it can run part of the residue `context/process.html`
§05 keeps manual — but it has no tray host, no real power events, no OS install
surface. Three verdicts per runbook step:

- **run** — agent-executable here; execute it and record the output.
- **cite** — a mirror already executes it on the PR path; point at the mirror,
  never re-drive it by hand.
- **hand off** — irreducibly physical; goes on the human checklist verbatim.

The runbook owns the procedures and their FAIL conditions — this skill maps its
steps to verdicts and adds nothing. On conflict the runbook wins; when a
procedure changes, re-derive this map from its text. A pass **never shrinks the
§05 inventory**: a run/cite verdict here is the residue's agent-reachable half,
not a reclassification, and a hand-off step is never marked confirmed by a
session.

## Preflight

- `npm ci && npm run build` — the CLI is `node packages/cli/dist/bin.js`
  (`npm run tt`).
- Confirm the session reaches `api.github.com` and has `gh` (or equivalent
  GitHub API access). No network → every **run** verdict that is live moves to
  the report as blocked, not silently skipped.

## The pass

Walk the runbook top to bottom. Per CHECK:

### CHECK SLEEP-SPAN · CHECK MISSED-SLEEP RECONCILE (§10a)

Real suspend/resume and `powerMonitor` deltas: **hand off**, both procedures
whole. Cite the §05 mirrors — BDD/PROP over injected clocks,
`packages/core/test/prop/sleep.test.ts`. Never fake a suspend to force a
verdict.

### CHECK TRAY + GLOBAL HOTKEY (§12 R01/R02)

Tray glyph, popover click on a real tray, dock/launcher mark, an OS
notification arriving, the hotkey from another application: **hand off**,
steps 1–5. Cite `packages/gui/test/tray.test.ts`, the JUDGE popover scenes,
PROP `packages/core/test/prop/checkin.test.ts`, GOLD
`packages/gui/test/checkin-notify.test.ts`.

### CHECK SOFTWARE UPDATE — CHECK FOR UPDATES (§19 R03)

- Step 2's live half — **run**: query the endpoint the app queries
  (`GET https://api.github.com/repos/kdbanman/stint/releases`, headers
  `User-Agent: Stint-Updater`, `Accept: application/vnd.github+json` — the
  fetcher in `packages/gui/src/update.ts`). Confirm: the API answers 2xx with a
  JSON array; the latest published (non-draft, non-prerelease) release carries a
  date-shaped tag (`vYYYY.M.D[.N]`) and an `html_url`;
  drafts/prereleases are distinguishable in the payload. That proves the live
  contract the shipped fetcher parses — the verdict *logic* (ordering,
  draft-skipping, up-to-date vs update-available) is GOLD
  `packages/gui/test/update.test.ts` and the on-screen chrome is JUDGE
  `SOFTWARE_UPDATE`: **cite**, don't recompute beyond the one live comparison.
- Step 3's DB invariant — **run** `npm run evidence`: the transcript section
  "§16 / §19 R04 — in-app update never touches the database" executes the
  sha256/mtime invariant across a simulated app replacement, and the drift gate
  fails on any change. Same mirror CI gates — running it here confirms it on
  this checkout, it is not a new proof.
- Step 5's source half — **run** `npm run verify:no-network`.
- Steps 1 and 4 in-app, and the real-install halves of 3/5 (a packaged app's
  version row, the live network-unplugged error, the whole-session socket
  monitor): **hand off**. Cite JUDGE `SOFTWARE_UPDATE` — it drives the version
  row, the verdict chrome, and the failed-check graceful copy headlessly.

### CHECK INSTALL (§19 R02)

- Pre-flight step 0 — **run** on Linux:
  `npm --workspace @stint/gui run pack:smoke`, then inspect
  `packages/gui/dist-pack/linux-unpacked/resources/` (asar-packed:
  `npx @electron/asar list resources/app.asar`; else `resources/app/`) for the
  four facts: `packages/cli/dist/bin.js` + `program.js` bundled,
  `packaging/tt-launcher.sh` bundled, `node_modules/commander` at the app root,
  no `.exe`/`.msi`/NSIS artifact anywhere under `dist-pack`.
- Steps 1–5 (macOS `.pkg`, Linux `install.sh`, fresh-shell `PATH`, uninstall
  reversing both): **hand off**. Cite GOLD
  `packages/gui/test/build-matrix.test.ts` + the `packaging/` static guards.

### CHECK PUBLISH-ON-MERGE (§19 R05)

- Steps 1–4 — **run** against the real upstream repo (`gh` or the API): the
  latest merge to `main` has a green `Release build matrix` run with all four
  jobs (`version`, both `pack` legs, `publish`); a new release exists tagged
  `vYYYY.M.D[.N]` targeting that merge commit; exactly two assets — one macOS,
  one Linux, no Windows artifact; `isDraft` and `isPrerelease` both false
  (e.g. `gh run list --workflow release.yml --branch main`,
  `gh release view <tag> --json isDraft,isPrerelease,assets,tagName`).
- Step 5 (install the published artifact, cross-check the version on both
  surfaces): **hand off**. Cite the release-wiring GOLD guard in
  `packages/gui/test/build-matrix.test.ts`.

### CHECK INSTALL & UPDATE (§17 R13)

The live end-to-end — a clean install of a stamped release, a real GitHub
download, the OS-level replacement + one-time Gatekeeper, relaunch across a
running timer: **hand off**, parts (a)–(d). The headless-drivable parts are
already routed by the procedure's own "Executed evidence" note (JUDGE
`SOFTWARE_UPDATE`, the `npm run evidence` transcript section, the
build-matrix guards) — **cite**; the evidence run and bundle inspection above
double as this umbrella's agent-reachable slice.

## Evidence

- The pass produces a **text report**, delivered on the surface that
  commissioned the run (issue or PR comment, or the session's summary): per
  CHECK, per step — verdict, the command run, the confirmation or failure.
  Never commit it: `acceptance/evidence/` in the tree carries only
  suite-generated text (process.html §02 R08), and a hand-captured report is
  neither.
- Binary side-evidence (a screenshot, a capture) goes to the evidence bucket
  (`node scripts/upload-evidence.mjs <prefix> <files…>`, ≤5 MB each), embedded
  by public URL — never committed.
- A step that **fails** is a finding: file it with `author-bug-report`,
  evidence under `qa-evidence/issue-N/`.
- The human residue's recordings land per
  `acceptance/evidence/recordings/README.md` — on the bucket under
  `acceptance/evidence/recordings/`, named for the check, showing the runbook's
  numbered steps and `[ ]` confirmations.

## The human-residue checklist

End every pass by emitting exactly what remains for a human on a real desktop —
the irreducibly physical core, by runbook step:

- [ ] Real sleep/wake: CHECK SLEEP-SPAN (all) and CHECK MISSED-SLEEP
      RECONCILE (all) — real suspend/resume, `powerMonitor` deltas, the
      launch-gap reconcile.
- [ ] Tray glyph state + popover click behavior + dock/launcher mark on a real
      desktop session: CHECK TRAY + GLOBAL HOTKEY steps 1–3.
- [ ] An OS check-in notification actually arriving, with its action set:
      CHECK TRAY + GLOBAL HOTKEY step 4.
- [ ] The global hotkey toggling from another application, and re-registering
      live on rebind: CHECK TRAY + GLOBAL HOTKEY steps 1 and 5.
- [ ] The single installer end-to-end on each platform, uninstall reversing
      both surfaces: CHECK INSTALL steps 1–5.
- [ ] A real install's Software Update residue: the packaged version row, the
      live offline graceful error, the whole-session socket monitor:
      CHECK SOFTWARE UPDATE steps 1, 4, 5.
- [ ] The published artifact installed and its version cross-checked on both
      surfaces against the release tag: CHECK PUBLISH-ON-MERGE step 5.
- [ ] The install→update umbrella live — clean install, real download,
      app replacement + one-time Gatekeeper, relaunch across a running timer:
      CHECK INSTALL & UPDATE parts (a)–(d).

Reproduce this list in the pass report, checking nothing — the boxes are the
human operator's to tick, with a recording per the recordings README.
