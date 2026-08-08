---
name: author-qa-gif
description: Author clear, annotated GIFs from a Playwright-driven page, then convert to an optimized GIF with ffmpeg. Use wherever a screen recording is the deliverable and the viewer must follow what is happening on screen — acceptance evidence, feature walkthroughs, QA runs, demos. Pairs with the Chromium-over-real-core driver.
---

# GIF authoring

Turn a scripted Playwright interaction into a GIF a human can follow at a glance:
a **visible cursor** that tracks real mouse moves, a **click ripple** at each press,
and **terse toasts** that narrate intent. Motion is deliberately unhurried so the eye
can follow. Use it anywhere a screen recording is the artifact — acceptance evidence,
walkthroughs, QA — not just one kind of recording.

## Prerequisites

- A Playwright page running the app (see the driver below).
- `ffmpeg` on PATH (`apt-get install -y ffmpeg`) for the WEBM→GIF conversion.
- The helper module: `packages/gui/qa/cine.mjs` (committed apparatus, beside the driver).

## Wiring it into a page

Install the overlay **before** `page.goto(...)`, then build the helpers:

```js
import { installOverlay, makeCine } from './packages/gui/qa/cine.mjs';

await installOverlay(page);          // adds the cursor/ripple/toast overlay (addInitScript)
await page.goto(url);
// Sync Playwright's internal mouse pos with the on-screen cursor start point:
await page.mouse.move(width/2, height/2, { steps: 2 });
const cine = makeCine(page);         // { move, click, hover, type, toast, wait, moveXY }
```

In the driver this is already done: `installOverlay` runs in `makePage`, and
`record(name, fn)` passes `(recordingPage, cine)` to your recipe and handles the GIF
conversion. So a recipe is just:

```js
await ctx.record('reports-walkthrough', async (rp, cine) => {
  await cine.toast("Open <b>Reports</b>", 1500);
  await cine.click('.nav-item[data-view="reports"]');
  await cine.toast("Create a new report", 1500);
  await cine.click('[data-view="reports"] button.primary');
  await cine.type('#rep-name', 'Weekly');
  await cine.click('#rep-save');
  await cine.wait(900);
}, { viewport: { width: 1000, height: 720 } });
```

## Helper API (`makeCine(page)`)

| call | effect |
|------|--------|
| `cine.move(target)` | smooth glide to a selector/locator/`[x,y]` (draws the eye) |
| `cine.click(target)` | glide → small pause → click (ripple fires) → settle |
| `cine.hover(target)` | glide + hover, for hover-reveal affordances |
| `cine.type(sel, text)` | focus + visible per-character typing |
| `cine.toast(text, ms)` | bottom-center caption; `text` may contain `<b>…</b>` |
| `cine.wait(ms)` | passthrough to `page.waitForTimeout` |
| `cine.moveXY(x, y)` | glide to raw viewport coords |

`target` is a CSS string, a Playwright `Locator`, or `[x, y]` viewport coords.

## Authoring tips

- **Toast before you act.** State intent ("Save the report"), do it, then a short
  payoff toast ("Total: 42h 30m"). 1.5–2 s each; keep them one line.
- **Let the cursor travel.** The glide itself is the annotation — don't teleport. Add a
  `wait(600–1000)` after a consequential action so the change is legible.
- **Keep recipes 5–9 s.** Longer GIFs balloon in size and lose the viewer.
- **Emphasis** with `<b>…</b>` (rendered in the app's clay accent).
- **Contrast reads well** — show a before state, then the after, so the change is obvious.

## WEBM → GIF (repo convention)

Same recipe as `packages/gui/judge/record.mjs`: palette then paletteuse at `fps=50/3`.

```bash
ffmpeg -y -i in.webm -vf "fps=50/3,palettegen=stats_mode=diff" pal.png
ffmpeg -y -i in.webm -i pal.png \
  -lavfi "fps=50/3,paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" out.gif
```

The driver's `record()` does this automatically. To keep GIFs small, record at
≤1000×720 and trim dead time; ~5–9 s lands around 0.5–2.5 MB. **Hard ceiling: 5 MB per
file.** For a busy multi-colour frame that still runs large, re-encode at a
smaller `scale=` and/or lower `fps`, or `gifsicle -O3 --lossy=40..120`. Finished GIFs are
uploaded to the evidence bucket (`node scripts/upload-evidence.mjs <prefix> <files…>`),
never committed.

## Verifying a GIF

Never assume it rendered right — extract a frame and look:

```bash
ffmpeg -y -i out.gif -vf "select=eq(n\,45)" -vframes 1 frame.png   # then view frame.png
```

Check the cursor is over the target, a ripple/​toast is visible, and the payoff frame
shows the change.

## The driver (context)

The overlay is engine-agnostic, but its home is the committed QA discovery driver
(`packages/gui/qa/driver.mjs` — see `context/process.html`, QA discovery): the **real
renderer** (`packages/gui/renderer`) in headless Chromium over a **real `@stint/core`
SQLite store**, bridged by `main.ts`'s own IPC handler map (imported, not copied
— guarded by `packages/gui/test/qa-driver.test.ts`). Run it with
`node packages/gui/qa/driver.mjs` (after `npm run build`; `STINT_QA_DIR` overrides the
work dir, default `<tmpdir>/stint-qa`). It watches `<qa-dir>/commands/` for `NNN.mjs`
recipes (each `export default async (ctx) => {}` with `ctx.record`, `ctx.page`,
`ctx.store`, `ctx.cine`) and writes results to `<qa-dir>/responses/`. The driver is
apparatus; the **recipes are scratch** — consumed by the run, never committed.
