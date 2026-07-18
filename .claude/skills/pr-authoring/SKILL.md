---
name: pr-authoring
description: Author or update a pull request description. Use whenever opening a PR or revising its body.
---

# PR authoring

The description is for the reviewer; the diff is the record. Say what changed and why it's
right — don't re-narrate the diff or the session that produced it.

## Language

- Lead with the change and its reason, in plain sentences a reader outside the session can
  follow. No codenames or shorthand invented mid-session.
- Report verification honestly: what ran and passed, what didn't run and why. Never dress
  up a partial check as a full one.
- Call out deliberate deviations — from the issue, a triage decision, or a reviewer
  suggestion — and the reason, rather than leaving them to be discovered.
- Keep it proportional: a small diff earns a short description.

## Evidence (when the branch carries it)

When the change commits visual evidence (GIFs, screenshots), embed the pieces that
*demonstrate the change* in the description itself — not in a comment.

- Embed by raw URL pinned to the **commit SHA**, not the branch:
  `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>` — it survives branch
  pruning and shows exactly the reviewed state. Re-pin when a push re-records evidence.
- GitHub won't inline-render images much over ~10 MB — link those instead of embedding.
- Re-recording under an unchanged filename? Bust the image cache with `?v=N`.
- After creating or updating the body, **verify the embeds**: read the stored body back
  through the API and confirm it matches what you sent — posting tooling has injected
  backticks into image URLs before, breaking the markdown — and confirm each embed URL
  still returns 200. If the read-back shows a mangled markdown image, resend that embed
  as an HTML `<img src="...">` tag, which has survived where the markdown form didn't.
