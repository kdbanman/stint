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
- **Cleanup on close** — required; see below.

## Verify before you file

- Reproduce the symptom through the **real** entry point (the button/flow a user hits),
  then trace it to a root cause you can point at with `file:line`.
- Distinguish "the backend is correct but the UI ignores it" from "the backend is wrong" —
  call the underlying API directly with the *same* arguments the app sends, not a fixed-up
  version, or you'll file a false bug (or miss a real one).
- A bug invisible with trivial data may be obvious with realistic data — seed accordingly.

## Evidence & cleanup

- Scope evidence **per issue**: commit recordings/stills under
  `acceptance/evidence/issues/issue-<N>/` (a lone file may sit directly in
  `acceptance/evidence/issues/` named for the issue). The issue number isn't known until the
  issue is filed, so file first, then add the evidence and edit the body with its URL.
- Embed by raw URL:
  `https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/<branch>/<path>`. When you
  re-record a file in place, bust GitHub's image cache with `?v=2` (bump N) since the
  filename is unchanged.
- **Every bug issue MUST include a `## Cleanup on close` section** naming its evidence
  path(s), so whoever closes the issue deletes them and the repo doesn't accumulate QA
  GIFs/screenshots. Because evidence is per-issue, cleanup is self-contained. Example:

  ```markdown
  ## Cleanup on close
  Delete this issue's evidence directory: `acceptance/evidence/issues/issue-48/`
  ```

- Keep the throwaway reproduction harness — the local Playwright script that launches and
  drives the app to reproduce the bug — in your scratchpad, not the repo. Only the committed
  evidence and reusable skills (e.g. the `qa-gif-authoring` cursor/ripple/toast overlay)
  belong in version control.

## Pairs with

- `qa-gif-authoring` — for the annotated screen-recording evidence you embed.
