# Architecture review — the systems that build Stint

Produced for issue #20 by an adversarial two-agent review: a skeptic interrogating
a researcher over four rounds of pointed questions and file:line-evidenced answers,
with Matt Pocock's improve-codebase-architecture, codebase-design, and grilling
skills as the goals-and-taste reference. Dated 2026-07-17; all file:line and doc-§
references are as of `main` at commit 2466d43.

**Charter.** The product's requirements and functionality are not under review and
every fix below preserves them. Under review are the four systems that carry them:
the code architecture (`packages/`), the verification apparatus (`acceptance/`,
`features/`, `scripts/`, CI), the SDLC/process machinery (`.claude/skills/`,
`context/process.html`), and the `context/` spec docs themselves as artifacts.
Vocabulary throughout is the codebase-design glossary: **module**, **interface**,
**depth**, **seam**, **adapter**, **leverage**, **locality**, the **deletion test**.

---

## 1. The system, mapped

### 1.1 Code

One SQLite file in WAL mode; all reads and writes go through `@stint/core`; every
write is one `BEGIN IMMEDIATE` transaction. The keystone invariant — a running
timer is just the one row whose `end_utc` is null — makes "running" a row state,
so two independent surfaces can drive the live timer without coordinating.

| Module | Interface | Behind it |
|---|---|---|
| `@stint/core` `Store` (packages/core/src/store.ts, 1,569 lines) | ~62 public methods: transitions, saved reports, favorites, reference data, sleep, settings, backups | All SQL, all transactions, all money math (rounding lives only in report.ts:47) |
| Schema (packages/core/src/db.ts) | `openDb`/`migrate` | DDL, triggers, the one-open-entry index, additive-only migrations |
| `tt` CLI (packages/cli/src/program.ts, 1,383 lines) | 50 `.command()` registrations | Flag→core mapping only; exit codes in bin.ts:46–62; formatting in format.ts calls core helpers |
| GUI main (packages/gui/src/main.ts, 921 lines) | 42 IPC channels (ipc.ts:6–84) + tray/hotkey/powerMonitor/check-in glue | Handlers delegate to Store; view derivations in liveview.ts / reportview.ts / timerview.ts (unit-tested TS) |
| GUI renderer (packages/gui/renderer/, 9 files, 7,308 lines) | `window.stint[channel]` via preload | Untyped classic-script vanilla JS; cannot import core, so display rules are mirrored |

The Electron process split forces a real seam at IPC: `preload.ts:17–19` generates
the renderer api mechanically from the channel list; payloads are `unknown` on
both sides with hand casts per handler (main.ts:408 onward). The renderer's
inability to import core produces three acknowledged mirrors of core display
rules (packages/gui/renderer/util.js:5–18, :228–281), one of which has drifted
(see Bad, B4).

### 1.2 Verification apparatus

Five complementary AC methods, mapped in acceptance/criteria/COVERAGE.md:

| Method | Runs | Interface it tests through |
|---|---|---|
| BDD (features/, 17 features, 117 scenarios) | each scenario twice: CoreWorld and CliWorld | one `World` interface (world.ts:134), two adapters; 157 steps bind only to the interface |
| PROP (packages/core/test/prop/) | fast-check over real `Store` on real node:sqlite (memory and file-backed) | the shipping code path, not extractions |
| GOLD (cli.test.ts 93 tests, contracts, migration; 9 JSON schemas) | exact CLI/CSV/JSON contract | 193 inline exact-value expectations |
| JUDGE (packages/gui/judge/run-judge.mjs, 3,249 lines) | Playwright Chromium over the real renderer, mocked `window.stint`, pinned clock | hard CI gate for deterministic sub-facts; subjective rows recorded `pass: null`, never auto-passed (run-judge.mjs:3223) |
| MANUAL (acceptance/criteria/manual/runbook.md) | real power events, tray, hotkey, Gatekeeper | the OS residue no harness reaches |

Around these: parity-matrix.json (42 hand-written rows) bound bidirectionally to
CHANNELS and the built commander tree by parity.test.ts:101–158; guard scripts
(no-network, no-auto-publish, packaging); generated evidence committed under
acceptance/evidence/ (103 files, 100 binary; recordings alone 137 MB of a 393 MB
`.git`); record.mjs (2,923 lines) regenerating 33 operator-run, non-gating GIFs.

Mass, from `npm run metrics`: implementation 15,349 lines; tests 11,834;
verification 12,335 — a 1.57 : 1 apparatus-to-implementation ratio. The judge
harness alone (run-judge + record + fixtures, 7,903 lines) is 217% of core src.

### 1.3 SDLC / process

context/process.html is the binding process spec: principles (§02), the agentic
process and model ladder (§03), doc authoring rules (§04), the
automatic-vs-manual enforcement inventory (§05), QA discovery (§06), governance
(§07). Six repo skills under .claude/skills/ hold the procedures
(change-requirements, requirements-transition, qa-sweep, qa-gif-authoring,
bug-report-authoring, triage-qa-findings). Large requirement changes run through
the requirements-transition skill: file-disjoint waves, per-wave checkpoint
commits, subagents, one PR, human merge gate. CI is fast (≈2 min per PR run,
ubuntu-only); release.yml packs macOS + Linux and publishes on every merge to
main. Governance discipline is observable: 31 PR merges, 3 direct commits (the
repo's first three).

### 1.4 The doc set

Six styled-HTML spec docs under context/ (2,563 lines, ~364 KB): concept, prd
(with §17 acceptance criteria and ~132 inline per-requirement status markers),
glossary, acceptance, architecture (self-declared non-normative consolidation),
process. Ten HTML mockups plus design-system.html carry visual truth. Markdown
everywhere else: skills, COVERAGE.md, runbook, README. README states the
ghost-distribution goal: the specification half (context/, acceptance/criteria/,
CLAUDE.md, .claude/, README) is meant to be complete enough to regenerate the
software.

---

## 2. Good decisions

**G1 — The keystone invariant: a running timer is an open row.** README.md:66–73,
db.ts. Elapsed time is always derived, never stored. This one modeling decision
is why two surfaces need no coordination protocol, no daemon, no lock manager —
the deepest single source of leverage in the repo. Everything cross-surface
follows from it.

**G2 — One-open-entry enforced in the storage layer, twice, with recorded
rationale.** Abort triggers (db.ts:112–126) plus a partial unique index over the
constant `(1)` (db.ts:140), the constant chosen because SQLite treats NULLs as
distinct — rationale recorded at db.ts:128–139. A PROP test drops the triggers
and proves the index alone rejects a raw second open INSERT
(prop/invariants.test.ts:122–144). The invariant holds even against hand-written
SQL: locality of enforcement at the deepest layer that can hold it.

**G3 — Money math and write orchestration have one home.** Name→id resolution is
one core rule used by both surfaces (program.ts:119, :352, :395; gui/main.ts:457,
gui/start.ts:29); rounding exists only in core (report.ts:47). The skeptic's
opening suspicion — that both surfaces reimplement orchestration — was refuted
for stored truth and writes. `program.ts`'s 1,383 lines are commander plumbing,
not logic.

**G4 — The BDD world: one interface, two adapters.** World interface at
world.ts:134; CoreWorld (:430) and CliWorld (:1025); 157 step definitions bind
only to `World`, zero per-step surface branching; every scenario runs twice.
Two adapters = a real seam, and parity is proven from one copy of the spec.
CliWorld shelling the built binary and re-parsing `--json` output is legitimate
consumption of the GOLD-pinned contract, not duplication.

**G5 — PROP suites test through the shipping interface.** Real `Store` over real
node:sqlite per generated case (invariants, editing, sleep, appstate — appstate
file-backed with raw read-back, appstate.test.ts:44–47); the pure-function
properties import shipping core functions, not reimplementations
(prop/overlap.test.ts:10). The extracted-pure-functions-while-bugs-live-in-callers
anti-pattern was checked for and is absent.

**G6 — The sleep/check-in seam.** Detection (OS-bound, unavoidably GUI:
powerMonitor glue is ~12 lines, main.ts:873–884) is separated from math and
persistence (core checkin.ts pure cadence engine; Store sleep methods), with
MANUAL covering only the true OS residue (runbook.md:15, :28, :36). The repo's
cleanest seam: what varies by platform sits alone on one side; what affects
billed time sits clock-injected and property-tested on the other.

**G7 — The no-network posture is requirement-consistent and its guard is
honest.** The carve-out is specified (PRD §17 R9: user-initiated update check
only, no data sent); check-no-network.mjs documents its own blind spot in a
comment (:47–53); the updater fires only from renderer-initiated IPC (no
auto-check exists); `check-no-auto-publish.mjs` guards a specific historical
failure and records the story (:5–20). Guards with recorded reasons.

**G8 — Minimal production dependencies, stated and enforced.** Principle in
process.html §02 R07 and architecture.html §01; enforced as the three-entry
allowlist `@stint/core`, `commander`, `electron` (check-no-network.mjs:54).
Small dependency interface = small trust surface, no native build step.

**G9 — backup.ts is a deep module.** Small interface (launch backup, backupNow,
list, restore); behind it: WAL checkpoint before copy (backup.ts:169), SHA-256
content dedup with recorded hash-not-size rationale (:155–159, :177), retention
setting end-to-end, restore that validates before closing the live handle,
quarantines the current file, and reopens the original on failure
(store.ts:250–270). Because `tt` is process-per-command, every invocation re-runs
the launch backup and integrity gate — leverage from the process model.

**G10 — One CSV producer for both surfaces.** toCsv/CSV_COLUMNS in core
export.ts (:9, :30) serve `tt export` and the GUI's exportPayload
(reportview.ts:197), making exports byte-identical by construction rather than
by test.

**G11 — The binding-test pattern.** Four instances of "assert two homes agree or
fail loud": parity.test.ts (CHANNELS ↔ parity-matrix ↔ commander tree,
bidirectional, honesty-checked allow-set, :101–158); qa-driver.test.ts (driver's
handler port ↔ CHANNELS); build-matrix.test.ts (electron-builder.yml ↔ both
Actions workflows ↔ pack scripts); cli.test.ts:592–599 (prd.html §11 labels ↔
CLI commands — a genuine spec↔code binding). This is the repo's own antidote to
its own disease (see B1); the pattern is excellent, its non-generalization is
the problem.

**G12 — The judge gates only what it can decide.** Deterministic sub-facts fail
CI hard (run-judge.mjs:3234–3238, ci.yml:120–139); subjective rubric rows are
recorded `pass: null` and routed to a human — never auto-passed. No fake
authority.

**G13 — The acceptance strategy is honest about itself.** acceptance.html picks
five methods with an explicit minimal-overlap rule, demotes recordings to
"courtesy demonstration… never the proof" (§12), and keeps an itemized
residual-risk ledger (§14). The GIF layer, initially suspected dead weight, has a
named consumer (the human merge gate — PR #39 embeds five recordings; the
runbook points at the recordings dir) and a recorded doctrine.

**G14 — Determinism over retries in CI.** ≈2-minute PR runs, no retry loops; the
judge is deterministic by pinned clock and mocked seam rather than flake-managed.
Last 10 runs all first-attempt.

**G15 — Governance discipline is real.** 31 PR merges, 3 direct commits (the
first three ever). The transition skill's guards map to recorded incidents
(never-advance-on-red, never-loosen-a-gate, checkpoint/resume — consumed once,
on its own induced crash).

---

## 3. Questionable decisions

Each entry: decision — evidence — judgment — fix reference (§5).

**Q1 — `Store` as one ~62-method class.** store.ts:144–1569. The interface hides
SQL and transactions (each method is deep-ish individually), but 62 methods on
one seam means every caller and test sees the whole surface, and the class mixes
six concerns (transitions, reports, favorites, reference data, sleep, settings).
Not shallow — the deletion test says complexity would reappear in both surfaces —
but wide. Cost is discoverability and test-surface size, not correctness. → F12.

**Q2 — The IPC seam is untyped and its primary map is unguarded.** Payloads are
`unknown` both sides (preload.ts:18) with per-handler `as` casts (main.ts:408
onward); the handlers map is `Record<string, …>` bound with a non-null assertion
(main.ts:403, :718–720). A channel added to CHANNELS without a handler compiles
clean and fails at first invoke. The QA driver's *copy* of the map is
bidirectionally test-bound to CHANNELS (qa-driver.test.ts:23–31); the original
is not — the port is guarded, the source isn't. → F5.

**Q3 — No old-reader refusal on a newer database.** migrate() returns silently
when `user_version >= SCHEMA_VERSION` (db.ts:323–324) — per PRD §20 R08 — so a
stale `tt` symlink or old AppImage opens a future-schema file and proceeds.
Safety rests entirely on the additive-only migration policy; a future
column-repurposing migration breaks old binaries silently. The one-installer
mitigation (PRD §19 R02) narrows but does not close the seam. No recorded
rationale for accepting silent old-reader access. → F6.

**Q4 — The cross-process story is never exercised.** The headline claim — "the
CLI and the running app cooperate" via `BEGIN IMMEDIATE` + busy_timeout
(README.md:66–68, architecture.html §04) — is verified by configuration
inspection (open-invariants.test.ts:46–49; contracts.test.ts:344–370) plus the
DB-level index. No test ever races two OS processes; BDD CliWorld spawns are
strictly sequential (spawnSync, world.ts:1038); SQLITE_BUSY is never provoked.
The architecture's central concurrency claim has no behavioral evidence. → F7.

**Q5 — renderer-static.test.ts pins source text.** 38 tests, 447 expects,
regexes over renderer source (:33, :61, :100) pinning exact expressions and
local variable names. Recorded rationale exists (header :1–5: cheap per-commit
guards; the visual judgment belongs to JUDGE) and it respects the no-style-pinning
rule (process.html §02). But it tests past the interface: renaming a local
breaks it; code going unreachable doesn't. Brittle where it should be
behavioral. → F3, F4.

**Q6 — Committed evidence, discipline-refreshed.** acceptance/evidence/ is
regenerated in CI but only uploaded as artifacts, never compared to the
committed copies; the 33 GIFs are operator-regenerated per GUI change by
discipline alone (process.html §05). Recordings are 137 MB — ~35% of repository
weight — serving one reviewer's glance under a doctrine that says they prove
nothing. Load-bearing (human merge gate) but priced like proof. → F2, F11.

**Q7 — prd.html carries ~132 hand-maintained status markers.** 102 implemented /
27 done / 3 partial, inline in requirement prose; nothing checks them against
the tree; sync is manual ("Sync doc status to the landed waves", e28cbf9). A
third meta-layer with the same drift disease as COVERAGE.md and §05 — and in
tension with §04's own stateless-authoring rule. → F1.

**Q8 — architecture.html sits outside the change fan-out.** A deliberate second
rendering of PRD facts (commit 4e1ab28), non-normative, with a cut-and-link
principle — but the change-requirements skill never names it (SKILL.md:42–43,
:99–118 enumerate prd/concept/glossary/acceptance only). Consistency is
discipline-only. → F9.

**Q9 — The JSON contract has four producer classes.** serialize.ts (5 shapes),
core export.ts, inline `toJson` callbacks at four command sites (program.ts:804,
:853, :898, :1098), and `config ls` dumping the raw settings object
(program.ts:1145). Nine schemas exist; none for client/project/tag/config/sleep-ls.
The "GOLD ⇒ schemas" coverage story is stronger than reality for the inline
shapes — they are pinned by snapshots only. → F13.

**Q10 — Sleep accuracy silently degrades for CLI-only use, undocumented.** The
GUI is the sole detector; `tt sleep ls/subtract` operate only on spans a GUI
session created (world.ts:186–189 documents the asymmetry for tests). No user
doc states it (README.md:41–42 tours `tt sleep` without the caveat). The seam is
right (G6); the undocumented product consequence is not. No recorded
consider-and-reject for CLI-session gap detection. → F14.

**Q11 — Incident-bred process hardening was deleted, not ported.** Four
dead-agent/null-result guards (commits b11eaaf, 53df6ac, fa397f8, 7e19f7c) lived
in the JS orchestrator, retired as "consumed scaffolding" (1dcce43); the prose
skill designs for eight other failure modes but not that one, and the
file-disjoint-waves *why* survives only in a deleted script's diff. Incident
knowledge lost in a format port. → F8, F10.

**Q12 — Post-merge-only failure classes remain.** Nothing runs on macOS before
merge (PR-side macOS coverage is config-static, build-matrix.test.ts:76); the
publish step and same-day tag collisions are post-merge by nature
(release.yml:129–130 documents manual recovery); release.yml has no failure
alerting beyond the red run. The founding incident — release pack "failed on
every merge while CI stayed green" — is the recorded cautionary tale, and its
class is only partially closed. → F15.

**Q13 — metrics:check fails the deletion test — and knows it.** The reconcile
gate's unique catch is an uncategorized new file; what that protects is the
census's own arithmetic ("Vanity metrics, lovingly counted",
sloc-report.mjs). Never fired in anger per git history. Honest about being
celebratory; still a CI gate whose deletion would lose nothing but a
self-portrait. Keep or demote consciously. → F16.

**Q14 — Small stated-fact inconsistencies.** "No network, ever" survives
unqualified in PRD §13 and README.md:29 while §17 R9 qualifies it; the
requirements-transition stage list is duplicated compressed in process.html §03
(will drift on stage change); the update-library decision (hand-rolled vs
electron-updater) is unrecorded even though the foreclosing constraint —
no code-signing — is recorded (PRD §19 R04, update.ts:13–15); the electron
net-module scan exemption is module-wide, with nothing pinning update.ts as the
sole `net.request` site; the named-restore path is absent from the BDD parity
feature (World has no restore method). → F17, F18, F13, F15.

**Q15 — Ghost distribution is aspirational, and nothing measures the gap.**
The goal lives only in README (§"A goal: ghost distribution", README.md:150–160),
uniformly aspirational ("aims to", "meant to be") — honest. The audit shows
semantics are well specified (the audit's first pass over-claimed: the 60-char
list cap, the backup stamp and quarantine prefixes, and the status line's shape
all turned out to be spec'd — prd.html §05 R10/§11, backup.schema.json:5,
glossary.html:384/:596, concept.html:129). What leaks is exact presentation
strings and magic numbers: the exit-code 1-vs-2 discrimination (bin.ts:46–62;
spec says only "0 / non-zero"); Store refusal wording (e.g. "an entry is already
open" db.ts:117, "nothing is running" store.ts:344 — source-only, pinned by a
mix of one exact string and ~23 loose regexes); the 90-second gap-reconcile threshold
(store.ts:1227 vs the spec's "a gap large enough to imply the machine slept");
the `iso` date-format mode's existence (settings.ts:139–145); the friendlyHotkey
transform as a rule; the report human-table layout (GOLD-pinned only,
cli.test.ts:446). Structurally: there are no .snap files — every GOLD pin is an
inline expect() in packages/*/test/gold/, and `packages/*/test` sits outside
README's spec-half enumeration (README.md:152–156; that paragraph also omits
features/, which README's own Layout section lists under "The specification" at
:89 — the two enumerations disagree). So the "artefact is the criterion" artifacts live uniformly
in the rendering half the goal proposes to discard. The one audit instrument
(issue #27) ran once. → F19.

---

## 4. Bad decisions

**B1 — ~15 hand-synced homes for one GUI intent, with the antidote in hand and
never generalized.** Measured on the Switch removal (issue #34): the deliver
commit touched 65 files; the same intent was hand-edited in PRD, glossary,
acceptance.html, four mockups, the rubric, judge scenes, judge fixtures,
record recipes, renderer, renderer-static regexes, parity matrix, parity-test
alias map, COVERAGE.md, runbook, BDD feature/steps/world, and PROP tests —
~14–16 statements — and a fourth commit (6f45125) still had to clean leftovers
the process missed. This is the repo's deepest locality failure: a change to one
intent has no single home, so cost and drift risk scale with the count of
copies. The five-method redundancy is a principled bet at the method tier
(acceptance.html's minimal-overlap rule), but at the artifact tier no doc
acknowledges, bounds, or counts the multiplication — while the repo itself
invented the exact antidote (the four binding tests, G11) and observed at least
five drift incidents without generalizing it. Under-mechanized, not
unprincipled — but the cost is measured and recurring. → F1.

**B2 — A phantom gate, specified three times.** process.html §02 R08 requires
"Regenerated evidence must not drift… fails on any difference"; §05 lists it as
an automatic per-PR check; §09 names it. No such comparison exists:
generate-evidence.mjs writes unconditionally, ci.yml:57–58 runs it with no
`git diff --exit-code`, screenshots and judge-report are uploaded but never
compared to committed copies. By the process spec's own definition this is a
false green. And the enabling condition is general: nothing pins §05's
"automatic" inventory rows to real ci.yml steps (build-matrix.test.ts pins three
of nine), so a second phantom could appear undetected. One already did. → F2.

**B3 — Hand-maintained meta-documents drift in both directions, and nothing
checks them.** COVERAGE.md still declares three gaps open ("currently lack a
verifying test", COVERAGE.md:98) that were closed 2026-06-30 — issue #35 done,
all three tests exist (renderer-isolation.test.ts, backup-retention.test.ts,
migration.test.ts). Same disease as B2's inventory row and Q7's status markers:
the meta-layer asserts states of the apparatus that the apparatus doesn't
confirm. A coverage map that can be wrong in either direction stops being
evidence. → F1.

**B4 — The renderer is the largest, least-guarded code area, and its defining
constraint is unexamined.** 7,308 lines of untyped vanilla JS; no checkJs, and
`packages/gui/renderer/**` is in the ESLint global ignore list
(eslint.config.js:9–18). Its only recorded rationale is a two-line comment
("Classic script… so it loads over file:// in the packaged app", util.js:1–2).
The constraint is not essential: CSP is `script-src 'self'`
(renderer/index.html:7–8), which permits a *built* local script, and the
mirrored core functions (time.ts, entrylist.ts) are dependency-free — an
esbuild IIFE emit or preload bridge would satisfy file:// and contextIsolation.
The consequence shipped: the renderer mirrors core display rules
(fmtDur clamps where core signs, util.js:5–12 vs time.ts:146–155; deriveView
"thin mirror" guarded only by source regexes, util.js:228–281,
renderer-static.test.ts:274–285), and the search haystack drifted — the GUI
matches the joined "Client / Project" label (util.js:240) where PRD §09 and core
(entrylist.ts:42) match fields separately. That is a shipped cross-surface spec
violation that the entire parity apparatus missed, because the renderer sits
behind a mocked seam and text regexes. An unrecorded tooling choice created a
permanent duplication tax and a parity blind spot. → F3, F4.

**B5 — run-judge.mjs is one ~3,180-line imperative function.** Four top-level
functions; `main()` holds every scene inline, punctuated by 38 `record()` calls;
no declarative scene table; the rubric rows live as prose in judge-rubric.md and
are hand-mirrored by the blocks. The verification apparatus's biggest artifact
(with fixtures, 137% of core src) is its shallowest module — the interface (what
scene proves which rubric row) is exactly as complex as the implementation.
record.mjs proves the better shape exists in-repo: a requirement-id → recipe map
over a generic driver (record.mjs:349–352, :2766, :2841). The Switch removal
cost 184 lines in run-judge and 512 in record for one intent. → F4.

**B6 — The one gate we watched fail was deleted instead of strengthened.** The
§Z absence check — the transition's "confirm no retired term survives" step —
was a prose instruction to an LLM agent in the retired orchestrator, not a scan.
It missed a dead-but-green alias, an unchecked COVERAGE.md row, and a
binary-filename leftover (commit 6f45125 names the failure). No post-mortem, no
issue, no guard added — and the check did not survive the port to the prose
skill at all (current Stage 7 has no absence step; grep "absence": zero hits).
Judgment was used where determinism was needed; then the judgment step was
dropped too. → F8.

**B7 — The spec docs are styled HTML by unrecorded default.** The six prose
specs (2,563 lines, ~364 KB) render as raw source on GitHub and mobile;
CLAUDE.md documents a third-party htmlpreview workaround with a known-broken
https variant — a mitigation for a decision no doc records (the choice is
commits 2–3 of the repo; process.html §04 governs style, not format). The repo
is format-inconsistent with its own definitions: process.html defines a skill as
a "versioned Markdown procedure"; COVERAGE.md, the runbook, README, and all six
skills are Markdown. The mockups' HTML is self-justifying (they *are* the design
artifact); the prose specs' HTML buys typography and costs every reader, every
diff, and every agent parse. An unrecorded decision with a recurring tax and a
documented workaround is the wrong way round. → F17.

---

## 5. Fixes, ordered by leverage

Every fix preserves requirements and functionality. F1–F4 are the high-leverage
tier; the repo has already invented the mechanism for F1 (G11) and the shape for
F4 (record.mjs) — they need generalizing, not inventing.

| # | Fix | Addresses | Why this order |
|---|---|---|---|
| F1 | **Generalize the binding-test pattern to every meta-layer.** New small tests, one per pair: process.html §05 automatic rows ↔ ci.yml step names; COVERAGE.md gap rows ↔ existence of the named test files; judge-rubric row ids ↔ `record()` ids in run-judge.mjs; PRD status markers ↔ tree (or delete the markers per §04's own stateless rule — binding *or* removal, never hand-sync). Same shape as parity.test.ts. | B1, B3, Q7 | One pattern, already proven in-repo four times, retires the whole hand-sync disease class instead of one instance. |
| F2 | **Implement or delete the evidence-drift gate.** Implement: `npm run evidence && git diff --exit-code acceptance/evidence/cli-transcript.md` in ci.yml (text, cheap). For screenshots, either add a hash compare or amend process.html §02/§05/§09 to say what is true. Either path ends the false green. | B2, Q6 | A process spec that asserts a nonexistent gate undermines trust in every other row of §05. Hours of work. |
| F3 | **Deepen the renderer seam: bundle core's pure display functions.** One esbuild IIFE emit of formatDuration/formatHours/elapsedSeconds/matchesQuery/groupEntries into the renderer (CSP-compatible, isolation-safe); delete the three mirrors. Fix the search-haystack drift immediately as a one-line prelude (match description, clientName, projectName, tags separately per PRD §09) — it is a shipped spec violation independent of the refactor. Then enable checkJs (or convert renderer to TS) and remove the ESLint ignore. Record the renderer-build decision this time. | B4 | Deletes a permanent duplication tax at its root, fixes a live parity bug, and puts static guards on the repo's largest code area. |
| F4 | **Give run-judge.mjs the record.mjs shape.** Scene table keyed by rubric id, generic driver; the F1 rubric↔scene binding test then falls out for free. renderer-static.test.ts shrinks to the few wiring facts no judge scene covers, retiring the source-text regexes. | B5, Q5 | Turns the apparatus's biggest artifact from its shallowest module into a deep one; per-change edit cost drops from hundreds of lines to a table row. |
| F5 | **Type the IPC seam.** Per-channel payload/result type map in ipc.ts; handlers as `Record<Channel, Handler>`; drop the `!` and the casts. Minimum viable: a CHANNELS↔handlers bidirectional test, exactly like qa-driver.test.ts already does for the copy. | Q2 | Compile-time drift detection on the only seam Electron forces. |
| F6 | **Refuse-forward on the schema seam.** `user_version > SCHEMA_VERSION` → refuse with a "built for an older schema" message; spec it as a PRD §20 amendment; one migration test (plant a higher user_version). | Q3 | Turns a silent future data hazard into a loud refusal; ~10 lines. |
| F7 | **One real contention test.** Spawn two `tt` processes (or a Store + a spawned tt) racing `start` on one file; assert exactly one open entry and a clean refusal/retry under busy_timeout. | Q4 | The architecture's central cross-process claim gets its first behavioral evidence. |
| F8 | **Restore the absence check as a deterministic step.** Scripted grep over tree + filenames with a recorded allowlist, in requirements-transition Stage 7; write the 6f45125 post-mortem into the skill so the incident buys something. | B6 | The gate already failed once in production use; determinize it where judgment failed. |
| F9 | **Add architecture.html to the change-requirements fan-out.** One line in Step 0's skim list and Step 2's rewrite list. | Q8 | Cheapest fix in the review. |
| F10 | **Port the lost hardening into the prose skill.** Dead-agent/null-result guards and the file-disjoint-waves rationale, recovered from the deleted orchestrator's history, stated as skill rules. | Q11 | Four incidents were paid for; keep the receipts. |
| F11 | **Move recordings out of git.** Release assets, LFS, or CI artifacts with links from the runbook/PRs; keep the doctrine and the recipes. | Q6 | Removes ~35% of repo weight that proves nothing by its own doctrine. |
| F12 | **Split Store's interface by concern — internally.** Keep one facade if both surfaces prefer it, but compose it from transitions/reports/reference/sleep/settings sub-modules with their own tests. Not urgent; do it when the next concern lands. | Q1 | Width managed before it grows; no caller churn. |
| F13 | **One producer home for CLI JSON.** Move the four inline `toJson` builders and the `config ls` dump into serialize.ts; add the five missing schemas. | Q9, Q14 | Makes the GOLD story true: every shape schema-pinned, one producer class. |
| F14 | **Document the sleep asymmetry.** One README sentence and a PRD §10a note: spans exist only when the GUI was running. (Detecting gaps on `tt` open would be a requirements change — out of scope here.) | Q10 | Honest product docs for CLI-heavy users. |
| F15 | **Louden the release path.** A failure step in release.yml that opens an issue; optionally a weekly macOS pack-smoke on schedule to pull the mac breakage class pre-release. Add a named-restore scenario to backup_recovery.feature (World gains one method). | Q12, Q14 | The founding incident's class is still half-open. |
| F16 | **Decide metrics:check's status.** Keep as a gate with a one-line §05 note naming it a self-portrait, or demote to non-gating report. Either is fine; the current ambiguity isn't. | Q13 | Gates should gate something. |
| F17 | **Record the unrecorded decisions.** Short decision notes (in process.html or a decisions section): styled-HTML spec format (or a stated migration intent), the hand-rolled updater, accepting old-reader access (superseded if F6 lands), the statement-multiplication bet at the artifact tier. Delete "ever" from PRD §13 / README's network line to match §17 R9. | B7, Q14, Q3 | Unrecorded decisions cannot be re-litigated or defended; both states are failures. |
| F18 | **De-duplicate the transition stage list.** process.html §03's row points to the skill's stage list instead of compressing it. | Q14 | One home per fact, applied to process.html itself. |
| F19 | **Make ghost distribution measurable.** Either extract the leaking presentation strings and magic numbers (refusal wording, exit-code map, the 90-second gap threshold, the `iso` mode, report-table layout) into acceptance/criteria/, or amend README's spec-half enumeration to include the GOLD pins and reconcile its two enumerations (the Layout section lists features/; the ghost-distribution paragraph omits it) — then add a recurring audit criterion (issue #27's instrument, scheduled). | Q15 | An aspiration nothing measures will silently stay false. |

---

*Method note: four question rounds, ~22 questions; suspicions were dropped when
evidence refuted them (PROP interfaces, sleep seam, no-network posture, GIF
consumers) and escalated only when file:line evidence confirmed them. Verdicts
cite the evidence they rest on; where enforcement could not be inspected from
the clone (GitHub branch-protection settings), the review says so rather than
guessing.*
