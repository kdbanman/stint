---
name: bug-report-authoring
description: Write high-signal bug-report issues after finding a defect (e.g. from an agentic QA sweep). Use when filing GitHub issues for bugs you have reproduced.
---

# Bug-report authoring

How to turn a reproduced defect into an issue a maintainer can act on without re-deriving
your work. One issue per finding; file them as standalone repo issues (not sub-issues)
unless asked otherwise.

## Anatomy of a good bug issue

- **Title** — component + the symptom, not the fix: `GUI: "+ Add client" does nothing`.
- **What happens** — the user-visible symptom, plainly, in the fewest steps to see it.
- **Evidence** — embed a GIF or screenshot (record with the `qa-gif-authoring` skill).
  See *Evidence & cleanup* below.
- **Why (root cause)** — the minimal mechanism with `file:line` pointers, plus the proof
  you actually reproduced it (the exact call/DOM state, before/after values). Point at the
  real code path the app runs — not a convenient proxy you called with different arguments.
- **Suggested fix (optional)** — include only when the fix is obvious. If there's any
  ambiguity about the right approach, leave it out rather than guess.
- **Severity + confidence** — state severity, and be honest about confidence. If you could
  not reproduce something end-to-end (e.g. couldn't run the packaged app), say so and say
  what still needs confirming. Never dress up a code-inspection hunch as a reproduction.
- **Evidence line** — required: name the issue's `qa-evidence` directory; see below.

## Verify before you file

- Reproduce the symptom through the **real** entry point (the button/flow a user hits),
  then trace it to a root cause you can point at with `file:line`.
- Distinguish "the backend is correct but the UI ignores it" from "the backend is wrong" —
  call the underlying API directly with the *same* arguments the app sends, not a fixed-up
  version, or you'll file a false bug (or miss a real one).
- A bug invisible with trivial data may be obvious with realistic data — seed accordingly.

## Evidence & cleanup

- Repro evidence lives on the **`qa-evidence` branch** — an orphan branch that is never
  merged (see `context/process.html`, QA discovery). One `issue-<N>/` directory per issue
  at the branch root. Main's tree and history never carry repro artifacts. The issue
  number isn't known until the issue is filed, so file first, then commit the evidence to
  the branch and edit the body with its URLs.
- Embed by raw URL:
  `https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/qa-evidence/issue-<N>/<file>`.
  When you re-record a file in place, bust GitHub's image cache with `?v=2` (bump N) since
  the filename is unchanged.
- **Every bug issue includes one evidence line** naming its directory so the branch can be
  tidied after the issue closes (pruning 404s the images in the closed issue — optional,
  not mandated). Example:

  ```markdown
  ## Evidence
  Lives on the `qa-evidence` branch at `issue-48/`; prune after close if desired.
  ```

- The reproduction driver is committed apparatus (`packages/gui/qa/driver.mjs` — the real
  renderer over a real core store, guarded by a channel-parity test). The **per-sweep
  recipes** that steer it are scratch: they're consumed by the run and never committed.

## Pairs with

- `qa-gif-authoring` — for the annotated screen-recording evidence you embed.
