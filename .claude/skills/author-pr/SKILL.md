---
name: author-pr
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

## Evidence (when the change is demonstrated visually)

When the change is demonstrated by visual evidence (GIFs, screenshots), embed the pieces
that *demonstrate the change* in the description itself — not in a comment. Visual
evidence is uploaded to the bucket and embedded from there.

- Upload first: `node scripts/upload-evidence.mjs acceptance/evidence/issue-<N> <files…>`
  (before/after captures for the PR's issue live under `acceptance/evidence/issue-<N>/`).
- Embed by the bucket's public URL:
  `https://pub-110c939d8c384d6c9e201e5f888c1288.r2.dev/acceptance/evidence/issue-<N>/<file>`.
- Keep each file **≤5 MB** (re-encode with a smaller scale / lower fps / gifsicle
  `--lossy`).
- Use **markdown image syntax** (`![alt](url)`), not HTML img tags.
- Re-recording under an unchanged filename? Bust the image cache with `?v=[bumped N]`.
- If you see an embed replaced with a plain link, leave it — it'll be repaired by CI.
