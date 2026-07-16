---
name: qa-gif-authoring
description: Author clear, annotated QA GIFs from a Playwright-driven page — a visible cursor that follows the mouse, click ripples, and terse on-screen toasts — then convert to an optimized GIF with ffmpeg. Use when recording GUI bug reproductions or demos where the viewer must see WHAT is clicked and WHY. Pairs with the Chromium-over-real-core QA driver used for Stint GUI QA.
---

# QA GIF authoring

Turn a scripted Playwright interaction into a GIF a human can follow at a glance:
a **visible cursor** that tracks real mouse moves, a **click ripple** at each press,
and **terse toasts** that narrate intent. Motion is deliberately unhurried so the eye
can follow. Built for bug-repro evidence (e.g. sub-issues of a QA sweep).

## Prerequisites

- A Playwright page running the app (see the QA driver below).
- `ffmpeg` on PATH (`apt-get install -y ffmpeg`) for the WEBM→GIF conversion.
- The helper module: `cine.mjs` in this skill directory.

## Wiring it into a page

Install the overlay **before** `page.goto(...)`, then build the helpers:

```js
import { installOverlay, makeCine } from '<skill-dir>/cine.mjs';

await installOverlay(page);          // adds the cursor/ripple/toast overlay (addInitScript)
await page.goto(url);
// Sync Playwright's internal mouse pos with the on-screen cursor start point:
await page.mouse.move(width/2, height/2, { steps: 2 });
const cine = makeCine(page);         // { move, click, hover, type, toast, wait, moveXY }
```

In the Stint QA driver this is already done: `installOverlay` runs in `makePage`, and
`record(name, fn)` passes `(recordingPage, cine)` to your recipe and handles the GIF
conversion. So a recipe is just:

```js
await ctx.record('f1-add-client-dead', async (rp, cine) => {
  await cine.toast("A new user opens <b>Clients</b>", 1500);
  await cine.click('.nav-item[data-view="clients"]');
  await cine.toast("Click <b>+ Add client</b>…", 1600);
  await cine.click('[data-view="clients"] button.primary');
  await cine.wait(700);
  await cine.toast("…nothing happens. The button is dead.", 2000);
  await cine.wait(1400);
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

- **Toast before you act.** State intent ("Click Save with no edits"), do it, then a
  short payoff toast ("Times changed 09:07 → 09:05"). 1.5–2 s each; keep them one line.
- **Let the cursor travel.** The glide itself is the annotation — don't teleport. Add a
  `wait(600–1000)` after a consequential click so the change is legible.
- **Keep recipes 5–9 s.** Longer GIFs balloon in size and lose the viewer.
- **Emphasis** with `<b>…</b>` (rendered in the app's clay accent).
- **Contrast sells a bug**: show the broken path, then the working one (dead "Add client"
  vs. working "Add tag").

## WEBM → GIF (repo convention)

Same recipe as `packages/gui/judge/record.mjs`: palette then paletteuse at `fps=50/3`.

```bash
ffmpeg -y -i in.webm -vf "fps=50/3,palettegen=stats_mode=diff" pal.png
ffmpeg -y -i in.webm -i pal.png \
  -lavfi "fps=50/3,paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" out.gif
```

The driver's `record()` does this automatically. To keep GIFs small, record at
≤1000×720 and trim dead time; ~5–9 s lands around 0.5–2.5 MB.

## Verifying a GIF

Never assume it rendered right — extract a frame and look:

```bash
ffmpeg -y -i out.gif -vf "select=eq(n\,45)" -vframes 1 frame.png   # then view frame.png
```

Check the cursor is over the target, a ripple/​toast is visible, and the payoff frame
shows the change.

## The QA driver (context)

The overlay is engine-agnostic, but it was built alongside a driver that runs the **real
Stint renderer** (`packages/gui/renderer`) in the pre-installed Chromium, bridged to a
**real `@stint/core` SQLite store** via the same `window.stint` IPC map `main.ts`
registers. That driver watches a `commands/` dir for `NNN.mjs` files (each
`export default async (ctx) => {}` with `ctx.record`, `ctx.page`, `ctx.store`, `ctx.cine`)
and writes results to `responses/`. This skill supplies the `cine`/`record` half; keep the
driver in your scratchpad, not the repo.
