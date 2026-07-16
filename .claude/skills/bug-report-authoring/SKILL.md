---
name: bug-report-authoring
description: Write high-signal bug-report issues after finding a defect (e.g. from an agentic QA sweep) — a repeatable structure, honest severity/confidence, embedded screen-recording evidence, and a mandatory cleanup list so evidence files don't accumulate in the repo. Use when filing GitHub issues for bugs you have reproduced.
---

# Bug-report authoring

How to turn a reproduced defect into an issue a maintainer can act on without re-deriving
your work. One issue per finding. File them as standalone repo issues (not sub-issues)
unless asked otherwise, and apply a discovery label (e.g. `Agentic QA Discovery`) so the
batch is findable and prunable later.

## Anatomy of a good bug issue

- **Title** — component + the symptom, not the fix: `GUI: "+ Add client" does nothing`.
- **What happens** — the user-visible symptom, plainly, in the fewest steps to see it.
- **Evidence** — embed a GIF or screenshot (record with the `qa-gif-authoring` skill).
  See *Evidence & cleanup* below.
- **Why (root cause)** — the minimal mechanism with `file:line` pointers, plus the proof
  you actually reproduced it (the exact call/DOM state, before/after values). Point at the
  real code path the app runs — not a convenient proxy you called with different arguments.
- **Suggested fix** — one or two concrete options; keep it short.
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

- Commit recordings/stills under a batch-scoped dir, e.g. `acceptance/evidence/<batch>/`,
  and embed them by raw URL: `https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/<branch>/<path>`.
  When you re-record an existing file, bust GitHub's image cache with `?v=2` (bump N) since
  the filename is unchanged.
- **Every bug issue MUST include a `## Cleanup on close` section** listing the evidence
  artifacts committed for it, so whoever closes the issue can delete them and the repo
  doesn't accumulate QA GIFs/screenshots. List the issue's own files, and note when the
  whole batch dir (and its README) can go — once every issue in the batch is closed. Example:

  ```markdown
  ## Cleanup on close
  Remove the evidence committed for this issue:
  - `acceptance/evidence/issue-37-qa/f1-add-client-dead.gif`

  Once every `Agentic QA Discovery` issue from this batch is closed, the whole
  `acceptance/evidence/issue-37-qa/` directory (and its README) can be deleted.
  ```

- Keep the driver/harness in your scratchpad, not the repo — only the committed evidence
  (and any reusable skill) belongs in version control.

## Pairs with

- `qa-gif-authoring` — for the annotated screen-recording evidence you embed.
