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
- **Evidence line** — required: name the issue's evidence-bucket prefix; see below.

## Verify before you file

- Reproduce the symptom through the **real** entry point (the button/flow a user hits),
  then trace it to a root cause you can point at with `file:line`.
- Distinguish "the backend is correct but the UI ignores it" from "the backend is wrong" —
  call the underlying API directly with the *same* arguments the app sends, not a fixed-up
  version, or you'll file a false bug (or miss a real one).
- A bug invisible with trivial data may be obvious with realistic data — seed accordingly.

## Evidence & cleanup

- Repro evidence lives on the **evidence bucket** — the public R2 bucket (see
  `context/process.html`, QA discovery), under one `qa-evidence/issue-<N>/` prefix per
  issue. The repository never carries repro artifacts — no binary evidence is ever
  committed. The issue number isn't known until the issue is filed, so file first, then
  upload the evidence (`node scripts/upload-evidence.mjs qa-evidence/issue-<N> <files…>`)
  and edit the body with its URLs.
- Embed by public URL:
  `https://pub-110c939d8c384d6c9e201e5f888c1288.r2.dev/qa-evidence/issue-<N>/<file>`.
  Keep each file **≤5 MB** — GitHub proxies external images through Camo, which drops
  larger files. When you re-record a file in place, bust GitHub's image cache with
  `?v=2` (bump N) since the filename is unchanged.
- Use **markdown image syntax** (`![alt](url)`), not HTML img tags. If an embed shows up
  as a plain link right after posting, leave it — embeds are repaired asynchronously by
  CI. Do not re-edit the body to fix it.
- **Every bug issue includes one evidence line** naming its prefix so the bucket can be
  tidied after the issue closes (pruning 404s the images in the closed issue — optional,
  not mandated). Example:

  ```markdown
  ## Evidence
  Lives on the evidence bucket at `qa-evidence/issue-48/`; prune after close if desired.
  ```

- The reproduction driver is committed apparatus (`packages/gui/qa/driver.mjs` — the real
  renderer over a real core store, guarded by a channel-parity test). The **per-sweep
  recipes** that steer it are scratch: they're consumed by the run and never committed.

## Pairs with

- `qa-gif-authoring` — for the annotated screen-recording evidence you embed.
