# JUDGE rubric — GUI presentation & discoverability

The JUDGE method (acceptance.html §09) scores the subjective and emergent GUI
qualities that resist assertion. An agent drives the **real renderer** through an
injected `window.stint` mock (`packages/gui/judge/`), captures screenshots + the
accessibility tree, and scores each item below PASS/FAIL with a one-line
justification citing the screenshot. Deterministic sub-facts are asserted by the
harness directly; the genuinely subjective items are scored by an LLM/human over the
captured screenshots. Any FAIL fails the suite; a sample of PASSes is spot-checked.

The harness writes `acceptance/evidence/judge-report.json` and the screenshots in
`acceptance/evidence/screenshots/`. Run it with `npm run judge`.

> Renderer windows run headless via the pre-installed Chromium (Electron's own
> binary is not fetched in this environment). The **tray icon's own title count-up**
> and a **real global-hotkey press** have no host here and are confirmed under
> MANUAL on a real desktop session (acceptance.html §11, residual risk).

| Item | Claim (PASS when true) | PRD | Evidence |
|------|------------------------|-----|----------|
| `EMPTY_STATE` | The empty main window instructs rather than decorates — it names a concrete next action ("press Ctrl+Alt+T" **and** "run `tt start`"). | §12 R5 | `main-empty.png` |
| `TRAY_COUNTUP` | The popover shows a single running timer counting up; between two captures the displayed elapsed increased by ~3s, not reset. (The tray icon's own title count-up is checked under MANUAL.) | §12 R1 | `popover-running-1.png`, `popover-running-2.png` |
| `ACCENT_DISCIPLINE` | The system accent appears on the running state / primary action **only**; the rest of the chrome is monochrome system grays. | §07, §15 | `main-running.png` |
| `FLAG_IN_CONTEXT` | The overlapped entry and the slept-through entry each show their flag **on the affected row** — not in a separate list — with the one-tap subtract present on the slept entry. | §12 R4, §10 R5 | `main-flags.png` |
| `DESKTOP_FEEL` | The window reads as a quiet, minimal desktop app that respects the system (system typography, light/dark following the OS, monochrome with restrained accent) — not a busy or branded web page. | §15 | all screenshots |

**Guardrail.** JUDGE is non-deterministic, so it is never the sole gate on anything
that changes a billable number. It owns presentation and discoverability; the
arithmetic underneath those screens is already nailed by PROP and GOLD.
