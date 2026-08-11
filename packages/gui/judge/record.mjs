#!/usr/bin/env node
/**
 * RECORD harness (companion to run-judge.mjs) — produces screen RECORDINGS of the real
 * renderer for per-requirement QA evidence. It reuses the EXACT same setup as the JUDGE
 * harness — the same pre-installed Chromium (resolveChromium), the same renderer files, the
 * same injected window.stint mock (initScript) + canned fixtures, and the same pinned wall
 * clock (JUDGE_NOW) — but with Playwright `recordVideo` enabled, so each run drives a named
 * fixture state through a short scripted interaction and saves a .webm to
 * acceptance/evidence/recordings/<reqId>.webm.
 *
 * This is a SEPARATE entry point: it does NOT change any JUDGE behavior, the rubric, or the
 * judge-report. The JUDGE harness still gates on deterministic PASS/FAIL facts; these
 * recordings are the "show it working" QA evidence per-req agents attach to the transition PR.
 *
 * Capability honesty: video capture needs a Chromium that can record (the full headless
 * Chromium build + ffmpeg). If this host cannot record — Playwright returns no video() handle —
 * we do NOT fake anything: we print a clear MISSING-CAPABILITY report and exit non-zero so the
 * calling agent surfaces it instead of silently shipping a stub. A recording that WAS muxed but
 * whose file is gone or empty is reported as exactly that (issue #250: it usually means another
 * process removed it, not that the host cannot record), never as a capability gap.
 *
 * One recorder per host: the final <slug>.webm/<slug>.gif output names are deliberately stable
 * (the recordings index cites them), so two concurrent runs would interleave one output set. A
 * pid lockfile in the recordings dir refuses to start while a sibling recorder is alive.
 *
 * Usage:
 *   node packages/gui/judge/record.mjs                # record every known fixture
 *   node packages/gui/judge/record.mjs <reqId> [...]  # record only the named recipe(s)
 *   node packages/gui/judge/record.mjs --list         # list the recipe ids and exit
 *
 * Publishing to GIF: the produced .webm is a gitignored working artifact; the uploaded evidence
 * is a .gif per recipe (e.g. `§20 R04` → `20-r04.gif`), kept under the 5 MB GitHub Camo ceiling
 * by convertToGif's re-encode ladder. Install ffmpeg (`apt-get install -y
 * ffmpeg`) and convert at the recordings' convention (full resolution, 50/3 fps, palette):
 *   ffmpeg -y -i "§20 R04.webm" -vf "fps=50/3,palettegen=stats_mode=diff" /tmp/pal.png
 *   ffmpeg -y -i "§20 R04.webm" -i /tmp/pal.png \
 *     -lavfi "fps=50/3,paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" 20-r04.gif
 */
import { chromium } from 'playwright-core';
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyState,
  runningState,
  clientsState,
  multilineDescState,
  addFormState,
  listState,
  entriesCalendarState,
  unifiedFormState,
  flaggedState,
  timerViewRunningState,
  timerViewFavoritesState,
  timerViewEmptyFavoritesState,
  savedReportsState,
  settingsState,
  timelineWindowState,
  mergeConflictState,
  backupsState,
  recoveryState,
  pickerState,
  initScript,
  JUDGE_NOW,
  WINDOW,
  POPOVER,
  UPDATE_FIXTURE,
} from './fixtures.mjs';
// §12 R22 — the shipped popover auto-sizes to its rendered card; recordings apply the same clamp.
import { popoverWindowSize } from '../dist/popoversize.js';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(here, '..', 'renderer');
const RECORDINGS = join(here, '..', '..', '..', 'acceptance', 'evidence', 'recordings');

// Same Chromium resolution as run-judge.mjs — one source of truth for the browser binary, so
// recordings run on the SAME engine the JUDGE screenshots are captured on.
function resolveChromium() {
  const base = '/opt/pw-browsers';
  if (existsSync(base)) {
    const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
    if (dir) {
      const exe = join(base, dir, 'chrome-linux', 'chrome');
      if (existsSync(exe)) return exe;
    }
  }
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

const fileUrl = (name) => 'file://' + join(RENDERER, name);
const wait = (page, ms) => page.waitForTimeout(ms);

// ASCII-only output slug from a requirement/recipe id, so the committed GIF name is filesystem-
// and PR-image safe: "§12 R15" → "12-r15", "§05 R01" → "05-r01", "favorites-rail" → "favorites-rail".
// Strips the section glyph, lowercases, and collapses any non-[a-z0-9] run to a single hyphen.
function asciiSlug(id) {
  return String(id)
    .replace(/§/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The VISIBLE-INTERACTION layer, injected via page.addInitScript so clicks never happen
// invisibly (the recording requirement). It paints, with NO dependency on the renderer's own
// CSS/markup and behind a high z-index so it never perturbs layout or the JUDGE selectors:
//   (a) a synthetic cursor element that follows every `mousemove` (the real pointer Playwright
//       drives — page.mouse.move steps make it visibly travel);
//   (b) a click pulse/ripple spawned at the pointer on every `pointerdown`;
//   (c) a brief outline highlight on the element under the pointer at `pointerdown` (the control
//       about to be interacted with), auto-cleared after a beat;
//   (d) a small caption banner (window.__recCaption(text)) a recipe can set to name the step.
// Pure presentation injected ONLY by the recording entry point — the JUDGE harness does not load
// it, so no judge behavior, rubric, or selector is touched.
const VISIBLE_CURSOR_INIT = `
  (() => {
    const ready = () => {
      if (document.getElementById('__rec_cursor__')) return;
      const root = document.body || document.documentElement;
      if (!root) return;
      const style = document.createElement('style');
      style.textContent = \`
        #__rec_cursor__{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;
          border-radius:50%;border:2px solid rgba(20,20,20,.9);background:rgba(255,255,255,.35);
          box-shadow:0 0 0 1px rgba(255,255,255,.7),0 1px 4px rgba(0,0,0,.35);
          z-index:2147483646;pointer-events:none;transition:transform .04s linear;will-change:left,top;}
        #__rec_cursor__::after{content:'';position:absolute;left:50%;top:50%;width:4px;height:4px;
          margin:-2px 0 0 -2px;border-radius:50%;background:rgba(20,20,20,.9);}
        .__rec_pulse__{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;
          border:2px solid rgba(200,98,62,.9);background:rgba(200,98,62,.25);
          z-index:2147483645;pointer-events:none;animation:__rec_ripple__ .55s ease-out forwards;}
        @keyframes __rec_ripple__{from{transform:scale(.4);opacity:.95;}to{transform:scale(3.2);opacity:0;}}
        .__rec_target__{outline:2px solid rgba(200,98,62,.95)!important;outline-offset:2px!important;
          border-radius:3px;transition:outline-color .1s linear;}
        #__rec_caption__{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);
          max-width:88%;z-index:2147483646;pointer-events:none;font:600 12px/1.45 system-ui,sans-serif;
          color:#fff;background:rgba(20,20,20,.82);padding:6px 12px;border-radius:14px;
          box-shadow:0 1px 6px rgba(0,0,0,.4);opacity:0;transition:opacity .15s linear;white-space:nowrap;}
        #__rec_caption__.__on__{opacity:1;}
      \`;
      document.head.appendChild(style);

      const cur = document.createElement('div');
      cur.id = '__rec_cursor__';
      cur.style.left = '-40px';
      cur.style.top = '-40px';
      root.appendChild(cur);

      const cap = document.createElement('div');
      cap.id = '__rec_caption__';
      root.appendChild(cap);

      let capTimer = 0;
      window.__recCaption = (text) => {
        cap.textContent = text || '';
        cap.classList.toggle('__on__', !!text);
        clearTimeout(capTimer);
        if (text) capTimer = setTimeout(() => cap.classList.remove('__on__'), 2600);
      };

      // (a) the cursor follows the real pointer.
      window.addEventListener(
        'mousemove',
        (e) => {
          cur.style.left = e.clientX + 'px';
          cur.style.top = e.clientY + 'px';
          cur.style.transform = 'scale(1)';
        },
        true,
      );

      // (b) a ripple at the press point + (c) a brief highlight on the pressed element.
      let lastTarget = null;
      let targetTimer = 0;
      window.addEventListener(
        'pointerdown',
        (e) => {
          cur.style.transform = 'scale(.8)';
          const pulse = document.createElement('div');
          pulse.className = '__rec_pulse__';
          pulse.style.left = e.clientX + 'px';
          pulse.style.top = e.clientY + 'px';
          (document.body || root).appendChild(pulse);
          setTimeout(() => pulse.remove(), 600);

          const t = e.target;
          if (t && t.classList && t !== document.body && t !== document.documentElement) {
            if (lastTarget) lastTarget.classList.remove('__rec_target__');
            t.classList.add('__rec_target__');
            lastTarget = t;
            clearTimeout(targetTimer);
            targetTimer = setTimeout(() => {
              t.classList.remove('__rec_target__');
              if (lastTarget === t) lastTarget = null;
            }, 700);
          }
        },
        true,
      );
      window.addEventListener('pointerup', () => { cur.style.transform = 'scale(1)'; }, true);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ready, { once: true });
    } else {
      ready();
    }
    // Re-establish the layer after a full-document navigation (some recipes goto() a second page).
    document.addEventListener('readystatechange', () => { if (document.readyState !== 'loading') ready(); });
  })();
`;

// Wrap a Playwright Page so every scripted interaction is VISIBLE: the synthetic cursor travels
// to the target in small steps (page.mouse.move steps), the about-to-click control is highlighted,
// and there is a ~300–500ms settle beat before and after each click. We decorate the high-level
// actions the recipes use (page.click / page.fill, and locator.click via a locator proxy) so the
// existing recipe scripts need no edits — they just become legible on camera. Direct
// page.mouse.* calls a recipe makes (the picker drags) already move the real pointer, so the
// cursor follows them natively; this only adds the travel+pause around the high-level helpers.
function decoratePage(page) {
  const STEPS = 14;
  const PRE_MS = 380;
  const POST_MS = 360;

  async function travelTo(target) {
    let box = null;
    try {
      box = await target.boundingBox();
    } catch {
      box = null;
    }
    if (!box) return false;
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    await page.mouse.move(x, y, { steps: STEPS });
    return true;
  }

  const rawClick = page.click.bind(page);
  const rawFill = page.fill.bind(page);
  const rawLocator = page.locator.bind(page);

  page.click = async (selector, opts) => {
    const loc = rawLocator(selector).first();
    try {
      await loc.waitFor({ state: 'visible', timeout: 4000 });
    } catch {
      // fall through to the native click (it will surface the real error / auto-wait).
    }
    const travelled = await travelTo(loc);
    if (travelled) await page.waitForTimeout(PRE_MS);
    await rawClick(selector, opts);
    await page.waitForTimeout(POST_MS);
  };

  page.fill = async (selector, value, opts) => {
    const loc = rawLocator(selector).first();
    const travelled = await travelTo(loc);
    if (travelled) await page.waitForTimeout(160);
    await rawFill(selector, value, opts);
    await page.waitForTimeout(160);
  };

  // Locator proxy: a locator's .click() also travels + pauses, so recipes that use
  // page.locator(...).click() (the kebab menus, the favorite Resume) are visible too.
  page.locator = (...args) => {
    const loc = rawLocator(...args);
    return wrapLocator(loc);
  };
  function wrapLocator(loc) {
    return new Proxy(loc, {
      get(t, prop, recv) {
        if (prop === 'click') {
          return async (opts) => {
            const one = t.first();
            try {
              await one.waitFor({ state: 'visible', timeout: 4000 });
            } catch {}
            const travelled = await travelTo(one);
            if (travelled) await page.waitForTimeout(PRE_MS);
            await loc.click(opts);
            await page.waitForTimeout(POST_MS);
          };
        }
        if (prop === 'locator') {
          return (...a) => wrapLocator(Reflect.apply(t.locator, t, a));
        }
        if (prop === 'first' || prop === 'last' || prop === 'nth') {
          return (...a) => wrapLocator(Reflect.apply(t[prop], t, a));
        }
        const v = Reflect.get(t, prop, recv);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }
  return page;
}

// GitHub proxies every image in a README/PR through Camo, which DROPS anything over 5 MB — an
// oversized GIF is a broken image on the index page, not a slow one. The ceiling is therefore a
// hard property of a shippable recording, not a guideline (author-qa-gif skill). The number is
// scripts/upload-evidence.mjs's own LIMIT: that uploader is what actually refuses the file, so a
// looser ceiling here would just move the failure to publish time.
const GIF_MAX_BYTES = 5_000_000;

// The re-encode ladder walked until a recipe's GIF fits GIF_MAX_BYTES. Rung 0 is the documented
// convention (full resolution, 15fps). Below it the rungs give up resolution and frame rate
// together at first, then FRAME RATE ALONE: a recording of a UI is read by pausing on its text,
// so a floor of ~0.6x scale (where the app's 11px labels and time fields still resolve) outranks
// smoothness — a jerkier GIF you can read beats a fluid one you cannot. Every rung keeps the
// ~0.5x slowdown and the end-frame hold, so a shrunk recording still reads at its siblings' pace.
const GIF_RUNGS = [
  { scale: 1, fps: 15 },
  { scale: 0.85, fps: 12 },
  { scale: 0.72, fps: 10 },
  { scale: 0.72, fps: 8 },
  { scale: 0.6, fps: 8 },
  { scale: 0.6, fps: 6 },
];

// Convert a finished .webm to a committed, ASCII-named animated GIF via the documented two-pass
// palette pipeline — slowed to ~0.5x (setpts=2.0*PTS) with a ~1.5s hold on the final frame
// (tpad), lanczos scale, sierra2_4a dither for quality — re-encoding down the rung ladder until
// the file fits under GIF_MAX_BYTES. Returns { path, bytes, rung } on success, or throws so the
// caller surfaces the conversion gap (we never ship a faked GIF).
function convertToGif(webmPath, gifPath) {
  const palette = gifPath.replace(/\.gif$/, '') + '.pal.png';
  // A GIF's bytes track pixels-per-frame × frames, so rung 0's measured size predicts every
  // lower rung to within a small factor. Jumping straight to the first rung that is predicted to
  // fit — and still verifying the real size afterwards, walking on if the prediction was
  // optimistic — keeps the guarantee while skipping the encodes that could only have failed:
  // each rung is two full ffmpeg passes over a ~20s capture, so walking all five costs minutes
  // per recipe across a 40-recipe run.
  const predict = (from, to, bytesAtFrom) =>
    bytesAtFrom *
    (GIF_RUNGS[to].scale / GIF_RUNGS[from].scale) ** 2 *
    (GIF_RUNGS[to].fps / GIF_RUNGS[from].fps);
  let bytes = 0;
  let rung = 0;
  for (; rung < GIF_RUNGS.length; rung++) {
    const { scale, fps } = GIF_RUNGS[rung];
    // scale=iw*<f> with an explicit -1 height keeps the aspect ratio; rung 0's iw*1 is a no-op
    // resize, so the default output stays byte-for-byte what the convention produced before.
    const vf =
      `setpts=2.0*PTS,fps=${fps},scale=iw*${scale}:-1:flags=lanczos,` +
      'tpad=stop_mode=clone:stop_duration=1.5';
    const pass1 = spawnSync(
      'ffmpeg',
      ['-y', '-i', webmPath, '-vf', `${vf},palettegen=stats_mode=diff`, palette],
      { encoding: 'utf8' },
    );
    if (pass1.status !== 0) {
      rmSync(palette, { force: true });
      throw new Error(
        `ffmpeg palettegen failed (status ${pass1.status}): ${(pass1.stderr || pass1.error?.message || '').split('\n').slice(-4).join(' ')}`,
      );
    }
    const pass2 = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-i',
        webmPath,
        '-i',
        palette,
        '-filter_complex',
        `${vf}[v];[v][1:v]paletteuse=dither=sierra2_4a`,
        gifPath,
      ],
      { encoding: 'utf8' },
    );
    rmSync(palette, { force: true });
    if (pass2.status !== 0) {
      throw new Error(
        `ffmpeg paletteuse failed (status ${pass2.status}): ${(pass2.stderr || pass2.error?.message || '').split('\n').slice(-4).join(' ')}`,
      );
    }
    if (!existsSync(gifPath) || statSync(gifPath).size === 0) {
      throw new Error('ffmpeg produced no non-empty GIF.');
    }
    bytes = statSync(gifPath).size;
    if (bytes <= GIF_MAX_BYTES) break;
    // 0.9 of the ceiling as the target, so a prediction that runs a little high still lands
    // under it rather than costing an extra rung.
    const measured = rung;
    while (rung + 1 < GIF_RUNGS.length && predict(measured, rung + 1, bytes) > GIF_MAX_BYTES * 0.9) {
      rung++;
    }
  }
  // The bottom rung still over the ceiling means the recipe itself is too long for a GIF — a
  // recipe-authoring problem (trim the scene), not something to paper over with a smaller frame.
  if (bytes > GIF_MAX_BYTES) {
    throw new Error(
      `GIF is ${bytes} bytes after every re-encode rung — over the ${GIF_MAX_BYTES}-byte Camo ` +
        'ceiling. Shorten the recipe rather than shrinking the frame further.',
    );
  }
  return { path: gifPath, bytes, rung };
}

// Is a GIF-CAPABLE `ffmpeg` runnable on PATH? (Capability honesty — if not, we keep the .webm and
// report the gap rather than silently shipping no GIF.) A bare `-version` probe is not enough:
// Playwright ships its own STRIPPED ffmpeg build (a dozen filters, no gif encoder) which often
// lands first on PATH, answers `-version` happily, and then fails deep inside the palette pass
// with an opaque filtergraph error. So we also require the two filters the conversion is built
// on. Returns null when the pipeline can run, or the reason it cannot.
function ffmpegGap() {
  const version = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (version.status !== 0) return 'ffmpeg not on PATH';
  const filters = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' });
  const out = filters.stdout || '';
  if (!/\bpalettegen\b/.test(out) || !/\bpaletteuse\b/.test(out)) {
    return (
      'the ffmpeg on PATH lacks the palettegen/paletteuse filters — it is a stripped build ' +
      "(Playwright's bundled ffmpeg is one); install a full ffmpeg and put it first on PATH"
    );
  }
  return null;
}

// The picker-day snapshot: a RUNNING open entry (id 99, start 12:00, no stop) alongside
// pickerState's two closed entries, all on 2026-06-24, so every picker entry point — the add
// form, a closed row's editor, and the running row's start-only disclosure — draws its
// single-day column with the same deterministic gray other-entries. Built here (not as a new
// shared fixture in fixtures.mjs) so no JUDGE scene drifts; settings are reused from pickerState.
// Shared by the §12 R15 every-surface tour and the V3 "me"-block close-up.
function pickerDayState() {
  const base = pickerState();
  const open = {
    id: 99,
    description: 'auth refactor',
    clientLabel: 'Client A / API',
    startUtc: '2026-06-24T12:00:00Z',
    endUtc: null,
    billableSeconds: 3600,
    billable: true,
    overlapped: false,
    overlapMinutes: 0,
    overlapRelation: null,
    sleptThrough: false,
    excludedSeconds: 0,
    rawSeconds: 3600,
    tags: ['deep'],
  };
  return {
    ...base,
    status: {
      running: true,
      entry: {
        id: 99,
        description: 'auth refactor',
        clientLabel: 'Client A / API',
        startUtc: '2026-06-24T12:00:00Z',
        billableSeconds: 3600,
        billable: true,
        sleptThrough: false,
        tags: ['deep'],
      },
    },
    days: [{ day: '2026-06-24', entries: [open, ...base.days[0].entries] }],
  };
}

// §12 R07 — the shipped drag-to-create gesture, shared by every recipe that adds an entry by
// hand. A POINTER click on the round + (bottom-right of the week grid) enters select-interval
// mode, the cursor carries a snapped start handle down the named day's column, and a press-drag
// then release opens the unified form seeded with the dragged interval. Offsets are pixels from
// the visible top of the track — the strip opens on the configured working hours — on the grid's
// 60px/hour geometry, so `dragPx: 90` is an hour and a half.
//
// It lives here rather than in each recipe because the gesture is ONE requirement: a recipe that
// drove it by hand would drift from its siblings the next time the chrome moves, which is exactly
// how the retired #add-toggle recipes came to record a form the app no longer had.
async function dragCreate(page, { day, atY = 100, dragPx = 90 }) {
  await page.click('#entries .fab');
  await page.waitForSelector('#entries .calwrap.sel-mode', { state: 'attached' });
  const aim = await page.evaluate((d) => {
    const track = document.querySelector(`#entries .dt[data-day="${d}"]`);
    const r = track.getBoundingClientRect();
    const strip = document.querySelector('.cstrip').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(Math.max(r.top, strip.top)) };
  }, day);
  await page.mouse.move(aim.x, aim.y + atY, { steps: 18 });
  await page.waitForSelector('#entries .shandle', { state: 'attached' });
  await wait(page, 800);
  await page.mouse.down();
  await page.mouse.move(aim.x, aim.y + atY + dragPx, { steps: 18 });
  await page.mouse.up();
  await page.waitForSelector('.entry-form[data-mode="add"]', { state: 'attached' });
  await page.waitForSelector('#entries .ev.me', { state: 'attached' });
}

// The scoped `window.stint.add` override the manual-add recipes share: it records the backfill
// payload AND splices a matching completed row into the injected snapshot, so the post-Save
// load()/getState repaint paints the new entry onto the grid ON CAMERA rather than leaving the
// scene on an empty column. Set via page.evaluate on ONE page — no shared fixture or JUDGE scene
// is touched, and the renderer's unchanged submit path stays the single source of truth.
// `overlapped` drives whether the spliced row wears the §06 R04 warn band.
function installAddSplice(page, { id, overlapped = false, overlapMinutes = 0 }) {
  return page.evaluate(
    (opts) => {
      window.stint.add = (p) => {
        window.__ADDED__ = p;
        const st = window.__STATE__;
        const fromUtc = new Date(p.fromLocal).toISOString();
        const toUtc = new Date(p.toLocal).toISOString();
        const sec = Math.max(0, Math.round((Date.parse(toUtc) - Date.parse(fromUtc)) / 1000));
        const day = fromUtc.slice(0, 10);
        const row = {
          id: opts.id,
          description: p.description || null,
          clientLabel: [p.client || null, p.project || null].filter(Boolean).join(' / ') || null,
          startUtc: fromUtc,
          endUtc: toUtc,
          billableSeconds: sec,
          billable: p.billable !== false,
          overlapped: opts.overlapped,
          overlapMinutes: opts.overlapMinutes,
          overlapRelation: opts.overlapped ? 'overlaps' : null,
          sleptThrough: false,
          excludedSeconds: 0,
          rawSeconds: sec,
          tags: Array.isArray(p.tags) ? p.tags.slice() : [],
        };
        let block = (st.days ||= []).find((d) => d.day === day);
        if (!block) {
          block = { day, entries: [] };
          st.days.unshift(block);
        }
        block.entries.unshift(row);
        return Promise.resolve(window.__ACK__);
      };
    },
    { id, overlapped, overlapMinutes },
  );
}

/**
 * The recording recipes. Each entry maps a requirement id to a short scripted scene over the
 * real renderer: which page to load, which canned fixture state to inject, any initScript
 * options, and a `drive(page)` that performs the interaction the recording should SHOW. The
 * states/selectors mirror the matching JUDGE scenes (FAVORITES_RAIL, TIMER_VIEW, REPORTS_VIEW,
 * SETTINGS_VIEW, SOFTWARE_UPDATE) so a recording demonstrates the same feature the JUDGE item
 * gates — just as a moving picture rather than a still.
 *
 * `reqId` is used verbatim as the output filename (<reqId>.webm); keep it filesystem-safe.
 */
const RECIPES = {
  // §05 R01 — Start as the GUI core-entry surface (`core` badge). With a timer already running
  // (the canonical runningState open row 'auth refactor', reading a deterministic 01:24:07),
  // the recording routes to the Timer view and dwells on the NEW running surface (issue #51):
  // the view offers ONLY edit-or-stop — the start panel is hidden, no start affordance exists
  // while running. It then presses Stop (closing the open row), the start panel appears, and it
  // opens the Start-with-details disclosure, fills the fresh entry's attributes, and submits —
  // so switching by hand in the window is stop, then start, as two visible steps. Core's
  // `start` verb itself remains the atomic stop-then-start for tt and programmatic callers
  // (§05 R01, proven surface-neutrally by BDD); only the GUI surfacing of a start control
  // while running is removed. The pinned JUDGE_NOW clock keeps the count-ups deterministic;
  // we then step the clock so the new entry's 00:00:0x visibly ticks.
  '§05 R01': {
    page: 'index.html',
    state: runningState,
    initOpts: { startStopsOpen: true },
    drive: async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-clock');
      await page.waitForFunction(() => !!document.querySelector('#start-panel')?.hidden);
      await wait(page, 800);
      // Stop the open row (a scoped toggle override flips the snapshot idle, faithful to
      // core's stop, so the post-stop load() repaints the idle card + the start panel).
      await page.evaluate(() => {
        const prevToggle = window.stint.toggle;
        window.stint.toggle = () => {
          const st = window.__STATE__;
          const now = window.__JUDGE_NOW__;
          for (const d of st.days || []) for (const e of d.entries) if (e.endUtc == null) e.endUtc = now;
          window.__STATE__ = { status: { running: false, entry: null }, days: st.days, sleepFlaggedIds: [], settings: st.settings };
          return prevToggle();
        };
      });
      await page.click('[data-view="timer"]:not([hidden]) #timer-stop');
      await page.waitForSelector('#timer-card.idle');
      await page.waitForSelector('#start-panel:not([hidden])');
      await wait(page, 600);
      await page.click('#start-toggle');
      await page.waitForSelector('#start-form:not([hidden])', { state: 'attached' });
      await page.fill('#start-desc', 'invoice prep');
      await page.fill('#start-client', 'Globex');
      await page.fill('#start-project', 'Billing');
      await page.fill('#start-tags', 'admin');
      await wait(page, 600);
      await page.click('#start-go');
      // The repaint shows the fresh entry as the single live count-up; step the pinned clock
      // so its 00:00:0x ticks on camera (the stopped row holds its frozen duration).
      await page.waitForSelector('#timer-card.running');
      await wait(page, 400);
      for (let i = 1; i <= 3; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 350);
      }
      await wait(page, 500);
    },
  },

  // §05 R02 — Stop the running timer through the GUI Timer view. The recording routes to the
  // Timer view on the canonical running snapshot (live count-up reading a deterministic
  // 01:24:07), advances the pinned clock so the count-up visibly TICKS UP on camera (the
  // running state), then clicks the primary Stop button. The stop wiring fires
  // window.stint.toggle() and reloads via getState(); to SHOW the running→idle transition
  // (count-up halted, no open entry) we override toggle to flip the injected snapshot to the
  // idle/nothing-running state — exactly what core's stop does (it closes the open row) — so
  // the reload repaints the idle Timer card. The override is scoped to THIS recipe (set via
  // page.evaluate before the click), so no shared fixture/JUDGE scene is affected.
  '§05 R02': {
    page: 'index.html',
    state: timerViewRunningState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-clock');
      await wait(page, 400);
      for (let i = 1; i <= 3; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 400);
      }
      await page.evaluate(() => {
        const idle = { status: { running: false, entry: null }, days: [], sleepFlaggedIds: [], settings: window.__STATE__.settings };
        const prevToggle = window.stint.toggle;
        window.stint.toggle = () => {
          window.__STATE__ = idle;
          return prevToggle();
        };
      });
      await page.click('[data-view="timer"]:not([hidden]) #timer-stop');
      await page.waitForSelector('#timer-card.idle');
      await page.waitForFunction(
        () => document.querySelector('#timer-state')?.textContent?.trim() === 'idle',
      );
      // Dwell on the idle state, stepping the clock again to PROVE the count-up has halted
      // (00:00:00 stays put — no open entry to advance).
      await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + 6 * 1000));
      await wait(page, 1000);
    },
  },

  // §12 R05 (core) — the GUI CORE-ENTRY surface, the Start form, lives in the Timer view
  // (relocated from the Entries toolbar) and is IDLE-ONLY (issue #51): while a timer runs the
  // Timer view offers ONLY edit-or-stop of the running entry — the start panel (one-tap Start,
  // the `Details` disclosure and its form) is hidden until the entry is stopped, and there is
  // no Switch button either (issue #34). This recording PROVES the contract: the Timer view
  // WHILE RUNNING shows Stop + the live-edit strip with NO start affordance and exactly one
  // Description field; pressing Stop closes the open entry and the start panel appears; the
  // disclosure then opens the inline attribute form, whose Billable box DEFAULTS per the
  // §05 R07 client-keyed rule (typing a client visibly checks it — no static pre-check); and
  // submitting starts the new entry with its attributes in one step.
  //
  // It opens on the canonical runningState (the 'auth refactor' open row, deterministic
  // 01:24:07), routes to the Timer view, and dwells on the RUNNING surface: the Active-Timer
  // card shows Stop and the live-edit strip — the start panel is HIDDEN. Stop (via a scoped
  // toggle override that flips the snapshot idle, faithful to core's stop) repaints the idle
  // card and reveals the start panel. It opens the disclosure (#start-toggle), fills
  // description / client / project / a tag — the Billable box auto-checks as the client lands
  // (§05 R07; left untouched so core derives the default) — and presses 'Start' (#start-go),
  // sending the payload over the SAME `start` IPC tt uses (window.stint.start → core
  // startWithAttributes); with startStopsOpen the injected snapshot gains the fresh open row,
  // so the getState repaint paints the Timer card RUNNING with the entered description/label.
  // We step the pinned clock so the fresh entry's 00:00:0x visibly ticks on camera.
  // startStopsOpen is the same scoped snapshot emulation §05 R01 uses; no JUDGE scene is touched.
  '§12 R05': {
    page: 'index.html',
    state: runningState,
    initOpts: { startStopsOpen: true },
    drive: async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('#timer-card.running');
      await page.waitForSelector('#timer-stop:not([hidden])');
      await page.waitForFunction(() => !!document.querySelector('#start-panel')?.hidden);
      await page.waitForFunction(() => !document.querySelector('#switch') && !document.querySelector('#timer-switch'));
      await wait(page, 800);

      await page.evaluate(() => {
        const prevToggle = window.stint.toggle;
        window.stint.toggle = () => {
          const st = window.__STATE__;
          const now = window.__JUDGE_NOW__;
          for (const d of st.days || []) for (const e of d.entries) if (e.endUtc == null) e.endUtc = now;
          window.__STATE__ = { status: { running: false, entry: null }, days: st.days, sleepFlaggedIds: [], settings: st.settings };
          return prevToggle();
        };
      });
      await page.click('[data-view="timer"]:not([hidden]) #timer-stop');
      await page.waitForSelector('#timer-card.idle');
      await page.waitForSelector('#start-panel:not([hidden])');
      await wait(page, 600);

      await page.click('#start-panel #start-toggle');
      await page.waitForSelector('#start-form:not([hidden])', { state: 'attached' });
      await wait(page, 400);

      await page.fill('#start-desc', 'invoice prep');
      await wait(page, 300);
      await page.fill('#start-client', 'Globex');
      await page.waitForFunction(() => document.querySelector('#start-bill')?.checked === true);
      await wait(page, 500);
      await page.fill('#start-project', 'Billing');
      await page.fill('#start-tags', 'admin');
      await wait(page, 500);

      await page.click('#start-go');
      await page.waitForSelector('#timer-card.running');
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'invoice prep',
      );
      await wait(page, 400);

      for (let i = 1; i <= 3; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 350);
      }
      await page.waitForFunction(() => !!document.querySelector('#start-panel')?.hidden);
      await page.waitForFunction(() => !document.querySelector('#switch') && !document.querySelector('#timer-switch'));
      await wait(page, 1200);
    },
  },

  // §09 R01 (G3) — a CUSTOM range is a pair of PLAIN DATES, and the Reports builder is now the
  // ONE place in the GUI that has a range at all. There is no time-of-day, no datetime-local, and
  // no visual range-picker modal — just two `type="date"` fields whose raw YYYY-MM-DD strings ARE
  // the range. The requirement's own sentence names both halves ("two date fields in the Reports
  // builder … the Entries view is week-only and carries no range controls, §12 R09"), so the
  // recording shows both — the pair that exists and the absence that replaced the retired one:
  //
  //   (A) REPORTS BUILDER — route to Reports, open + New report, pick the Custom… preset (which
  //       reveals #rep-custom-range, hidden until chosen), and TYPE the plain-date pair into
  //       #rep-range-from / #rep-range-to (2026-06-01 → 2026-06-07). Save → the new card lands in
  //       the saved-defs list with its spec summary printing the verbatim date pair ("Custom:
  //       2026-06-01 – 2026-06-07"); the captured saveReport payload's rangeSpec is exactly
  //       { kind:'absolute', fromDate, toDate } — raw dates, no 'T'. Running the fresh custom
  //       card paints the grouped run-output under a resolved-range header, so the plain-date
  //       range is shown resolving to real billable lines.
  //
  //   (B) ENTRIES — the retired half, recorded as an absence. The toolbar's range presets and its
  //       plain-date pair are GONE (#264/#297): the Entries view shows exactly one WEEK, chosen by
  //       the prev/next steppers and the week picker. The beat ASSERTS on camera that no preset
  //       segment and no range field exists anywhere in the view — a re-grown range control would
  //       FAIL this recording rather than be quietly re-recorded — then steps the week back and
  //       forward so the only range concept the view has is seen moving.
  //
  // The listState fixture serves both surfaces from one page load: the Entries calendar reads
  // its day-grouped snapshot while the Reports builder reads the always-seeded SAVED_REPORTS via
  // the initScript listReports mock (independent of the snapshot), and runReport returns the
  // canned flag-carrying summary for any card. No write beyond the real saveReport/listEntries
  // the renderer already issues — no scoped override, no JUDGE scene touched.
  '§09 R01': {
    page: 'index.html',
    state: listState,
    drive: async (page) => {
      // ===== (A) REPORTS BUILDER — the custom range is a pair of plain dates =====
      await page.click('.nav-item[data-view="reports"]');
      await page.waitForFunction(() => document.querySelectorAll('#rep-defs .def').length > 0);
      await page.evaluate(() => window.__recCaption && window.__recCaption('Reports — a custom range is a plain date pair (§09 R01)'));
      await wait(page, 600);
      await page.click('#rep-new');
      await page.waitForSelector('#rep-builder:not([hidden])', { state: 'attached' });
      await wait(page, 400);
      await page.click('#rep-preset-seg .preset[data-preset="custom"]');
      await page.waitForSelector('#rep-custom-range:not([hidden])', { state: 'attached' });
      await wait(page, 500);
      await page.fill('#rep-name', 'June window');
      await page.fill('#rep-range-from', '2026-06-01');
      await page.fill('#rep-range-to', '2026-06-07');
      await wait(page, 700);
      await page.click('#rep-save');
      await page.waitForFunction(() => document.querySelectorAll('#rep-defs .def').length === 3);
      await page.waitForFunction(
        () => !!window.__SAVED_REPORT__ && window.__SAVED_REPORT__.rangeSpec?.kind === 'absolute',
      );
      await page.evaluate(() => window.__recCaption && window.__recCaption('Saved: Custom 2026-06-01 – 2026-06-07 (plain dates, no time)'));
      await wait(page, 1200);
      await page.click('#rep-defs .def:last-child .def-run');
      await page.waitForFunction(
        () => !document.querySelector('#rep-run')?.hidden && document.querySelectorAll('#rep-run-rows .report-grp').length > 0,
      );
      await wait(page, 1400);

      // ===== (B) ENTRIES — no range controls at all; the view is one WEEK =====
      await page.click('.nav-item[data-view="entries"]');
      await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length > 0);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Entries has no range controls — it shows exactly one week (§12 R09)'));
      await wait(page, 900);
      // The absence, asserted rather than merely framed: no preset segment, no from/to pair, no
      // date input of any kind — only the week label the steppers and picker move.
      const rangeChrome = await page.evaluate(() => ({
        presets: document.querySelectorAll('.view[data-view="entries"] .preset, #el-preset-seg').length,
        rangeFields: document.querySelectorAll('#el-range-from, #el-range-to').length,
        dateInputs: document.querySelectorAll('.view[data-view="entries"] input[type="date"]').length,
        weekLabel: document.getElementById('el-week-label')?.textContent?.trim() ?? '',
      }));
      if (rangeChrome.presets || rangeChrome.rangeFields || rangeChrome.dateInputs || !rangeChrome.weekLabel) {
        throw new Error(`Entries still carries range chrome: ${JSON.stringify(rangeChrome)}`);
      }
      await page.evaluate(
        (label) => window.__recCaption && window.__recCaption(`0 presets, 0 date fields — just the week: ${label}`),
        rangeChrome.weekLabel,
      );
      await wait(page, 1400);
      // The week itself is the only range the view has — step back to the previous week (last
      // week's lone 'refactor planning' entry) and forward again.
      await page.click('#el-prev-week');
      await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length === 1);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Prev week — one entry; the week is the range'));
      await wait(page, 1300);
      await page.click('#el-next-week');
      await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length === 5);
      await wait(page, 1500);
    },
  },

  // §05 R05 — manual add (backfill) by DRAG, entirely in the window (§12 R07/R16). The add surface
  // is the week grid itself: the round + button enters select-interval mode, a start handle
  // follows the cursor at the coarse snap, and a press-drag down a day column sets the interval —
  // releasing opens the ONE unified form above the grid, seeded with exactly that span. The
  // recording then drags the pending interval's BOTTOM GRIP to lengthen the stop (only the dragged
  // edge moves, R06/R23) with the raw Stop field ticking LIVE, types a description, and presses
  // Save entry — the sole commit over the unchanged `add` IPC — and the new completed backfill
  // entry appears on the grid.
  //
  // Thursday 25 is the drag target: pickerState's two seeded entries sit on Wednesday 24, so the
  // created span owns a clean column and the geometry stays deterministic. The page is pinned to
  // UTC so those seeded UTC instants are the local wall clock, and the drag deltas ride the grid's
  // 60px/hour track (90px = 1h30m).
  '§05 R05': {
    page: 'index.html',
    state: pickerState,
    contextOpts: { timezoneId: 'UTC' },
    drive: async (page) => {
      await page.waitForSelector('.dcol .ev');
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Add a past entry by hand — the + on the week grid (§05 R05)'));
      await wait(page, 900);
      await dragCreate(page, { day: '2026-06-25', atY: 100, dragPx: 90 });
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Release → the unified form opens above the grid, seeded with the drag'));
      await wait(page, 1200);

      // Lengthen the stop by dragging the pending interval's bottom grip — only the dragged edge
      // moves, and the raw Stop field is written live (R06/R17/R23).
      const grip = await page.evaluate(() => {
        const r = document.querySelector('#entries .grip.b').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      await page.mouse.move(grip.x, grip.y, { steps: 14 });
      await page.mouse.down();
      await page.mouse.move(grip.x, grip.y + 45, { steps: 18 });
      await page.mouse.up();
      const span = await page.evaluate(() => ({
        start: document.querySelector('.entry-form .edit-start').value,
        stop: document.querySelector('.entry-form .edit-end').value,
      }));
      await page.evaluate(
        (s) => window.__recCaption && window.__recCaption(`Drag the stop grip — Stop writes live: ${s.stop}`),
        span,
      );
      await wait(page, 1200);

      await page.fill('.entry-form .edit-desc', 'invoice prep');
      await wait(page, 700);
      await installAddSplice(page, { id: 300 });
      await page.click('.entry-form button[type="submit"]');
      await page.waitForSelector('.entry-form', { state: 'detached' });
      await page.waitForFunction(() => !!window.__ADDED__);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Save entry — the backfill lands on the grid'));
      await wait(page, 1800);
    },
  },

  // §12 R07 (core entry, G5/G7) — the GUI MANUAL-ADD surface is the week grid plus the ONE
  // unified entry form in ADD mode. There is no toolbar "Add entry" disclosure any more: manual
  // add lives on the week grid itself, and the recording shows the R07 beats the requirement
  // gates: (1) at REST the round + sits bottom-right of the grid and its hover expands rightward
  // into "+ Add entry" without the + glyph moving; (2) a POINTER click enters SELECT-INTERVAL
  // mode — the + hides, the ephemeral fine-snap toggle takes its spot, and a snapped start handle
  // with a time pill follows the cursor down a day column; (3) a press-drag and release enters
  // CREATE mode — the ONE unified form expands ABOVE the grid, the grid grays out, and the form is
  // BLANK except the dragged interval (the REDUCED field set: 3-line description, client, project
  // under client, tags, billable, the always-present Start/Stop pair, Save entry / Cancel — and
  // nothing else); (4) the pending interval stays adjustable — a body drag moves both edges
  // together, writing both raw fields live; (5) "Save entry" is the SOLE commit over the unchanged
  // `add` IPC, and because the span overlaps a seeded entry the non-blocking overlap banner paints
  // (§06 R04: warned, not blocked).
  //
  // The strip is scrolled to the evening before the gesture so the drag lands across
  // addFormState's 19:00–20:00 row and the overlap is REAL geometry rather than a claim. Pinned to
  // timezoneId 'UTC' so those seeded UTC instants are the local wall clock; initOpts overlap:true
  // makes the post-save WriteAck carry the warning the inline banner surfaces on camera, and the
  // shared installAddSplice puts the saved row on the grid for the repaint.
  '§12 R07': {
    page: 'index.html',
    state: addFormState,
    initOpts: { overlap: true },
    contextOpts: { timezoneId: 'UTC' },
    drive: async (page) => {
      // Wait for the initial load() so `state` (and the grid's day columns) is populated.
      await page.waitForSelector('.entry', { state: 'attached' });
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Manual add lives on the week grid — the round + (§12 R07)'));
      // The + expands rightward on hover; the glyph itself does not move.
      await page.hover('#entries .fab');
      await page.waitForFunction(() => {
        const fl = document.querySelector('#entries .fab .fl');
        return fl && fl.getBoundingClientRect().width > 60;
      });
      await wait(page, 1100);
      // Bring the evening into view so the dragged span crosses the seeded 19:00–20:00 entry.
      await page.evaluate(() => {
        const strip = document.querySelector('.cstrip');
        if (strip) strip.scrollTop = 17 * 60;
      });
      await wait(page, 500);

      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Click + → select-interval: a snapped start handle follows the cursor'));
      await dragCreate(page, { day: '2026-06-24', atY: 60, dragPx: 120 });
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Release → the reduced form, blank but for the dragged interval; the grid grays'));
      await wait(page, 1500);

      await page.waitForSelector('.entry-form .edit-client option[value="1"]', { state: 'attached' });
      await page.fill('.entry-form .edit-desc', 'invoice prep');
      await page.selectOption('.entry-form .edit-client', { label: 'Globex' });
      await page.waitForSelector('.entry-form .edit-project:not([disabled]) option[value="21"]', { state: 'attached' });
      await page.selectOption('.entry-form .edit-project', { label: 'Onboarding' });
      await page.click('.entry-form .ef-tag-add');
      await page.fill('.entry-form .ef-tag-add', 'admin');
      await page.press('.entry-form .ef-tag-add', 'Enter');
      await wait(page, 800);

      // The pending interval is still adjustable: a body drag carries start and stop together,
      // both raw fields written live (R07/R17).
      const me = await page.evaluate(() => {
        const r = document.querySelector('#entries .ev.me').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      // Downward, so the committed span genuinely runs across the seeded 19:00–20:00 entry —
      // the overlap the banner reports is geometry the viewer can see, not a claim.
      await page.mouse.move(me.x, me.y, { steps: 14 });
      await page.mouse.down();
      await page.mouse.move(me.x, me.y + 30, { steps: 16 });
      await page.mouse.up();
      const span = await page.evaluate(() => ({
        start: document.querySelector('.entry-form .edit-start').value,
        stop: document.querySelector('.entry-form .edit-end').value,
      }));
      await page.evaluate(
        (s) => window.__recCaption && window.__recCaption(`Drag the block — both fields move: ${s.start.slice(11, 16)} – ${s.stop.slice(11, 16)}`),
        span,
      );
      await wait(page, 1300);

      await installAddSplice(page, { id: 301, overlapped: true, overlapMinutes: 45 });
      await page.click('.entry-form button[type="submit"]');
      await page.waitForSelector('.entry-form', { state: 'detached' });
      await page.waitForFunction(() => !!window.__ADDED__);
      await page.waitForSelector('#overlap-banner:not([hidden])').catch(() => {});
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Save entry — overlap is warned inline, never blocked (§06 R04)'));
      await wait(page, 1800);
    },
  },

  // §12 R15 — the START-ONLY INTERVAL PICKER. The requirement narrowed to exactly one component:
  // the running entry's start-adjustment surface in the Timer view, where no week grid exists. It
  // is NOT the manual-add surface any more (that is the grid, R07) and NOT the closed-entry
  // editing surface (that is the grid's edge drags plus the raw fields, R06/R17) — its own closing
  // sentence is "no picker mounts in the Entries view". The recording shows both halves:
  //
  //   (1) THE COMPONENT — the live-edit strip's Start field carries a calendar affordance
  //       (#le-start-pick) that DISCLOSES the picker inline below the field (#le-start-disc):
  //       in flow, no modal, no backdrop, no Apply. It opens on the EXACT stored start (never
  //       snapped on display) and paints a single-day column where the running block carries a
  //       START grip only, dissolving into the future — no end control anywhere, so amending the
  //       start can never close the open row (§05 R06). Dragging the grip writes #le-start LIVE,
  //       the other entries on the day sit gray behind it, and the ephemeral fine-snap toggle sits
  //       beside the track (the only snap chrome, R23).
  //
  //   (2) THE ABSENCE — routing back to Entries and opening a CLOSED entry's editor, the recipe
  //       ASSERTS that no `.stp` picker mounted anywhere in the view: the closed entry's span is
  //       adjusted on the grid itself (its selected block's edge grips) and by the raw Start/Stop
  //       fields. A picker regrown in the Entries view FAILS the recording rather than being
  //       quietly re-recorded.
  //
  // The page is pinned to UTC and the state carries a running open entry (id 99, start
  // 2026-06-24T12:00) PLUS the two pickerState closed entries, all on 2026-06-24, so the picker's
  // single-day column draws its gray other-entries deterministically. Its drag deltas ride the
  // component's own geometry (track 720px/24h → 30px/hour), which is NOT the week grid's 60px/hour
  // — one reason the two surfaces are recorded separately. No write IPC is scoped: the live write
  // into the authoritative Start field is the whole subject.
  '§12 R15': {
    page: 'index.html',
    // The shared picker-day snapshot (running open row + the two pickerState closed entries, all
    // on 2026-06-24), so the disclosure's single-day column shows the gray other-entries.
    state: pickerDayState,
    contextOpts: { timezoneId: 'UTC' },
    drive: async (page) => {
      // ===== (1) THE START-ONLY DISCLOSURE — in flow, start grip only, live write =====
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #live-edit:not([hidden])');
      const seeded = await page.evaluate(() => document.querySelector('#le-start')?.value ?? '');
      await page.evaluate(
        (s) => window.__recCaption && window.__recCaption(`The running start, exactly as stored: ${s}`),
        seeded,
      );
      await wait(page, 900);
      await page.click('#le-start-pick');
      await page.waitForSelector('#le-start-disc:not([hidden]) .stp-grip', { state: 'attached' });
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('The start-only picker discloses in flow — no modal, no Apply (§12 R15)'));
      await wait(page, 1100);
      // No end control exists anywhere in the component — the block simply dissolves into the
      // future behind its `.open` mask, and the ONE grip is the start's.
      const shape = await page.evaluate(() => ({
        block: !!document.querySelector('#le-start-disc .stp-block.me.open'),
        grips: document.querySelectorAll('#le-start-disc .stp-grip').length,
        resizeHandles: document.querySelectorAll('#le-start-disc .stp-resize').length,
        snapCtl: !!document.querySelector('#le-start-disc .stp-snapctl .sw'),
      }));
      if (!shape.block || shape.grips !== 1 || shape.resizeHandles !== 0 || !shape.snapCtl) {
        throw new Error(`start-only picker is not start-only: ${JSON.stringify(shape)}`);
      }
      const grip = page.locator('#le-start-disc .stp-grip');
      await grip.scrollIntoViewIfNeeded();
      const g0 = await grip.boundingBox();
      const gx = Math.round(g0.x + g0.width / 2);
      const gy = Math.round(g0.y + g0.height / 2);
      await page.mouse.move(gx, gy, { steps: 14 });
      await page.mouse.down();
      await page.mouse.move(gx, gy - 30, { steps: 18 });
      await page.mouse.up();
      const dragged = await page.evaluate(() => document.querySelector('#le-start')?.value ?? '');
      await page.evaluate(
        (s) => window.__recCaption && window.__recCaption(`Drag the start grip — Start writes live: ${s}`),
        dragged,
      );
      await wait(page, 1400);
      await page.click('#le-start-pick');
      await page.waitForSelector('#le-start-disc[hidden]', { state: 'attached' });
      await wait(page, 700);

      // ===== (2) NO PICKER MOUNTS IN THE ENTRIES VIEW =====
      await page.click('.nav-item[data-view="entries"]');
      await page.waitForSelector('.view[data-view="entries"]:not([hidden]) .dcol .ev');
      await page.hover('.entry[data-id="1"]');
      await page.click('.entry[data-id="1"] [data-act="edit"]');
      await page.waitForSelector('.entry-form[data-mode="edit"]', { state: 'attached' });
      await page.waitForSelector('#entries .ev.me .grip', { state: 'attached' });
      const entriesPickers = await page.evaluate(() => ({
        pickers: document.querySelectorAll('.view[data-view="entries"] .stp').length,
        gridGrips: document.querySelectorAll('#entries .ev.me .grip').length,
        rawFields: document.querySelectorAll('.entry-form .uf-time').length,
      }));
      if (entriesPickers.pickers || entriesPickers.gridGrips !== 2 || entriesPickers.rawFields !== 2) {
        throw new Error(`Entries should adjust spans on the grid, not a picker: ${JSON.stringify(entriesPickers)}`);
      }
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Entries mounts NO picker — a closed span drags on the grid, or is typed'));
      await wait(page, 1800);
    },
  },

  // V3 (design.html D11) — the "me" BLOCK close-up. The divergence resolved to the MOCK's idiom:
  // the block a user drags is an accent OUTLINE over a WEAK accent fill with INK labels and
  // accent-bordered paper GRIPS — never the retired solid-accent slab. The rule behind it is accent
  // discipline: a solid accent fill marks a view's one primary ACTION, and a time span is data, not
  // an action; the weak fill also keeps the block's own labels readable in ink (a white label on
  // accent-weak would fail the text floor outright).
  //
  // The block's home moved with the transition: the pending/selected interval now paints on the
  // WEEK GRID itself (paintPendingOverlay's `.ev.me`), not inside a form-mounted picker. So the
  // close-up opens the unified editor on the closed 'morning sync' row (09:00–11:00) — whose stored
  // segments are replaced on the grid by the accent-outlined pending block — and works it there:
  // drag the block BODY down (start and stop move together on the coarse snap) and then the bottom
  // accent GRIP (only the stop moves), with the form's Start/Stop text fields updating LIVE on
  // every step — the captions echo the actual field values, so the live write is legible rather
  // than asserted off-camera. It then ends on the RUNNING variant, which is cheap from this
  // fixture: the Timer view's start-only disclosure paints the same idiom with no end edge at all —
  // the block dissolves into the future behind its mask and offers a start grip alone (§05 R06:
  // editing an open row can never close it).
  //
  // Computed oracles ride along at both ends, resolved against the live tokens (never a hardcoded
  // hex), so a regression to the solid-accent slab FAILS the recording: the block's fill must be
  // accent-weak (not accent-solid), its border the full accent, its time pills ink; the running
  // block must carry the `.open` mask class and expose NO resize grip. No write IPC is scoped —
  // the live write into the authoritative text fields is the whole subject, and the add/edit commit
  // paths are proven on camera by §05 R05 / §12 R07.
  'V3': {
    page: 'index.html',
    state: pickerDayState,
    contextOpts: { timezoneId: 'UTC' },
    drive: async (page) => {
      const times = () =>
        page.evaluate(() => {
          const v = (sel) => document.querySelector(sel)?.value || '';
          return { start: v('.entry-form .edit-start').slice(11, 16), end: v('.entry-form .edit-end').slice(11, 16) };
        });
      // Centre the block in the scrollport before measuring it. Its rect is in viewport space
      // whether or not the strip is showing it, so a clipped block hands back coordinates that
      // land above the grid and the drag does nothing (issue #323, when the head band shortened
      // the visible grid). A take whose subject is off-screen is also a take nobody can read.
      const meBox = () =>
        page.evaluate(() => {
          const me = document.querySelector('#entries .ev.me');
          me.scrollIntoView({ block: 'center' });
          const r = me.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, cx: r.left + r.width / 2 };
        });

      // ===== The GRID block: an outline over a weak fill, with ink time pills =====
      await page.waitForSelector('.entry[data-id="1"]');
      await page.hover('.entry[data-id="1"]');
      await page.click('.entry[data-id="1"] [data-act="edit"]');
      await page.waitForSelector('.entry-form[data-mode="edit"]', { state: 'attached' });
      await page.waitForSelector('#entries .ev.me .grip.b', { state: 'attached' });
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('The selected span: an accent OUTLINE over a weak fill, ink pills (V3 / D11)'));
      await wait(page, 1500);

      const blockFacts = await page.evaluate(() => {
        const resolve = (name) => {
          const p = document.createElement('span');
          p.style.color = `var(${name})`;
          document.body.appendChild(p);
          const c = getComputedStyle(p).color;
          p.remove();
          return c;
        };
        const me = document.querySelector('#entries .ev.me');
        const cs = getComputedStyle(me);
        const lab = me.parentElement.querySelector('.tlabel');
        const grip = me.querySelector('.grip.b');
        return {
          fill: cs.backgroundColor,
          border: cs.borderTopColor,
          label: lab ? getComputedStyle(lab).color : '',
          grip: grip ? getComputedStyle(grip).borderTopColor : '',
          accent: resolve('--accent'),
          accentSolid: resolve('--accent-solid'),
          accentWeak: resolve('--accent-weak'),
          ink: resolve('--ink'),
        };
      });
      if (blockFacts.fill !== blockFacts.accentWeak || blockFacts.fill === blockFacts.accentSolid) {
        throw new Error(
          `V3: the "me" block fill is ${blockFacts.fill}, expected the weak accent ${blockFacts.accentWeak}`,
        );
      }
      if (blockFacts.border !== blockFacts.accent) {
        throw new Error(`V3: the "me" block outline is ${blockFacts.border}, expected accent ${blockFacts.accent}`);
      }
      if (blockFacts.label !== blockFacts.ink) {
        throw new Error(`V3: the time pill is ${blockFacts.label}, expected ink ${blockFacts.ink}`);
      }
      if (blockFacts.grip !== blockFacts.accent) {
        throw new Error(`V3: the edge grip's border is ${blockFacts.grip}, expected accent ${blockFacts.accent}`);
      }

      // DRAG THE BODY down +45px (≈ +45min on the grid's 60px/hour track, coarse snap) — start and
      // stop move TOGETHER and both text fields tick live.
      const t0 = await times();
      const b0 = await meBox();
      const bx = Math.round(b0.cx);
      const by = Math.round((b0.top + b0.bottom) / 2);
      await page.mouse.move(bx, by, { steps: 14 });
      await page.mouse.down();
      await page.mouse.move(bx, by + 45, { steps: 20 });
      await page.mouse.up();
      await wait(page, 500);
      const t1 = await times();
      if (t1.start === t0.start || t1.end === t0.end) {
        throw new Error(
          `V3: dragging the block body did not move both fields live (${t0.start}–${t0.end} → ${t1.start}–${t1.end})`,
        );
      }
      await page.evaluate(
        (msg) => window.__recCaption && window.__recCaption(msg),
        `Body drag moves the whole span live — ${t0.start}–${t0.end} → ${t1.start}–${t1.end}`,
      );
      await wait(page, 1300);

      const g1 = await page.evaluate(() => {
        const r = document.querySelector('#entries .ev.me .grip.b').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      await page.mouse.move(g1.x, g1.y, { steps: 12 });
      await page.mouse.down();
      await page.mouse.move(g1.x, g1.y + 30, { steps: 16 });
      await page.mouse.up();
      await wait(page, 500);
      const t2 = await times();
      if (t2.end === t1.end || t2.start !== t1.start) {
        throw new Error(
          `V3: the bottom grip should move the stop alone (${t1.start}–${t1.end} → ${t2.start}–${t2.end})`,
        );
      }
      await page.evaluate(
        (msg) => window.__recCaption && window.__recCaption(msg),
        `The accent grip resizes the stop alone — ${t1.end} → ${t2.end}`,
      );
      await wait(page, 1500);
      await page.click('.entry-form .edit-cancel');
      await page.waitForSelector('.entry-form', { state: 'detached' });
      await wait(page, 500);

      // ===== The RUNNING variant: the same idiom with no end edge (§05 R06) =====
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #live-edit:not([hidden])');
      await page.click('#le-start-pick');
      await page.waitForSelector('#le-start-disc:not([hidden]) .stp-grip', { state: 'attached' });
      await page.locator('#le-start-disc .stp-grip').scrollIntoViewIfNeeded();
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Running: the same block with NO end — it fades into the future, start grip only'));
      const openFacts = await page.evaluate(() => ({
        masked: !!document.querySelector('#le-start-disc .stp-block.me.open'),
        resizeGrips: document.querySelectorAll('#le-start-disc .stp-block.me .stp-resize').length,
      }));
      if (!openFacts.masked) throw new Error('V3: the running block is not the masked `.open` variant');
      if (openFacts.resizeGrips !== 0) {
        throw new Error(`V3: the running block exposes ${openFacts.resizeGrips} resize grip(s); it must expose none`);
      }
      await wait(page, 1600);

      const g = await page.locator('#le-start-disc .stp-grip').boundingBox();
      if (g) {
        const gx = Math.round(g.x + g.width / 2);
        const gy = Math.round(g.y + g.height / 2);
        await page.mouse.move(gx, gy);
        await page.mouse.down();
        await page.mouse.move(gx, gy - 15, { steps: 16 });
        await page.mouse.up();
      }
      await wait(page, 1500);
    },
  },

  // §12 R17 (core entry) — EXACT TIME ENTRY. The unified form's Start and Stop fields are raw text
  // fields, always present in the form (the collapsed Start/Stop expander is retired): the
  // exact-entry escape hatch — type a precise instant rather than drag — and the ONLY path for an
  // OVERNIGHT span. The recording opens the add form by the KEYBOARD path (activating the + with
  // Enter seeds the working-hours default and leaves focus in the form, so the whole scene is
  // typed), then TYPES a span crossing midnight (2026-06-24 22:00:00 → 2026-06-25 02:00:00)
  // straight into the fields.
  //
  // The payoff is that fields and grid drive the SAME form values: the typed stop repaints the
  // pending interval as TWO segments — a seg-start running from 22:00 to Wednesday's foot and a
  // seg-end from Thursday's head down to 02:00 — never a flattened same-day sliver, while the
  // field keeps the next-day text verbatim. The recipe asserts both segments landed before the
  // payoff beat, so a stop silently flattened to same-day FAILS the recording. "Save entry" is the
  // sole commit and the overnight backfill appears on the repaint, spanning both columns.
  //
  // Pinned to UTC (like §05 R05 / §12 R07) so the typed instants land on deterministic local days;
  // the shared installAddSplice puts the saved row on the grid, leaving the renderer's unchanged
  // submit path the single source of truth.
  '§12 R17': {
    page: 'index.html',
    state: addFormState,
    contextOpts: { timezoneId: 'UTC' },
    drive: async (page) => {
      await page.waitForSelector('.entry', { state: 'attached' });
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Exact time entry: the form\'s raw Start/Stop fields (§12 R17)'));
      await wait(page, 900);
      // The keyboard path: activating the + opens the form directly on the working-hours default.
      await page.focus('#entries .fab');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.entry-form[data-mode="add"]', { state: 'attached' });
      await page.waitForSelector('#entries .ev.me', { state: 'attached' });
      await wait(page, 900);

      await page.fill('.entry-form .edit-desc', 'overnight deploy');
      await page.fill('.entry-form .edit-start', '2026-06-24 22:00:00');
      await wait(page, 600);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Type a stop on the NEXT day — the only overnight path'));
      await page.fill('.entry-form .edit-end', '2026-06-25 02:00:00');
      // Fields and grid drive the same values: the typed overnight span repaints as one segment
      // per shown day, never a same-day sliver.
      await page.waitForFunction(() => document.querySelectorAll('#entries .ev.me').length === 2);
      const segs = await page.evaluate(() =>
        [...document.querySelectorAll('#entries .ev.me')].map((m) => ({
          day: m.parentElement.dataset.day,
          part: /seg-start/.test(m.className) ? 'seg-start' : /seg-end/.test(m.className) ? 'seg-end' : 'other',
        })),
      );
      const spansMidnight =
        segs.some((s) => s.day === '2026-06-24' && s.part === 'seg-start') &&
        segs.some((s) => s.day === '2026-06-25' && s.part === 'seg-end');
      if (!spansMidnight) {
        throw new Error(`typed overnight span did not paint one segment per day: ${JSON.stringify(segs)}`);
      }
      // A midnight-crossing span sits at OPPOSITE ends of the 24h track — the start day's foot
      // and the next day's head — so the two segments can never share one viewport. Scroll to
      // each in turn rather than caption a payoff the camera cannot see.
      const scrollStrip = (to) =>
        page.evaluate((t) => {
          const s = document.querySelector('.cstrip');
          if (s) s.scrollTop = t === 'bottom' ? s.scrollHeight : 0;
        }, to);
      await scrollStrip('bottom');
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Wednesday: the span runs from 22:00 down to the column\'s foot'));
      await wait(page, 1700);
      await scrollStrip('top');
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Thursday: it continues from the head down to 02:00 — one entry, two segments'));
      await wait(page, 1700);

      await installAddSplice(page, { id: 320 });
      await page.click('.entry-form button[type="submit"]');
      await page.waitForSelector('.entry-form', { state: 'detached' });
      await page.waitForFunction(() => window.__ADDED__?.toLocal === '2026-06-25 02:00:00');
      await scrollStrip('bottom');
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Save entry — the overnight backfill persists, counted under its start day'));
      await wait(page, 1900);
    },
  },

  // §05 R06 / §12 R14 — the RUNNING entry's inline START-ONLY picker disclosure. On the
  // canonical running snapshot (open row 'auth refactor', started 21:35Z, two closed same-day
  // entries painting gray; page pinned to UTC so the geometry is deterministic), the recording
  // routes to the Timer view, expands the disclosure from the Start field's calendar
  // affordance — IN FLOW below the field, no modal/backdrop — showing the running block with a
  // start grip only and its transparency fade dissolving toward the future (no end grip, no
  // end label, no end field anywhere). It then drags the grip UP -30px (= -60min on the
  // 720px/24h track, 5-min snap: 21:35 → 20:35), each step writing the raw #le-start text
  // LIVE, and finally steps the pinned clock so the count-up visibly keeps ticking — editing
  // the open row never stops it and never synthesizes an end (§05 R06).
  'running-start-only': {
    page: 'index.html',
    state: timerViewRunningState,
    contextOpts: { timezoneId: 'UTC' },
    drive: async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #live-edit:not([hidden])');
      await page.evaluate(() => window.__recCaption && window.__recCaption('Running timer — adjust its start inline (§05 R06)'));
      await wait(page, 900);
      await page.click('#le-start-pick');
      await page.waitForSelector('#le-start-disc:not([hidden]) .stp-grip', { state: 'attached' });
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Start-only picker, in flow: a start grip, no end — the block fades into the future'));
      await wait(page, 1400);
      // Make the debounced live-edit commit visibly APPLY on the repaint: scope an `edit`
      // override that applies the startUtc patch to the open row in __STATE__ (faithful to
      // core's edit-on-open-row — never an endUtc, the row stays open), so the post-commit
      // load() does not snap the Start field back to the stale injected snapshot on camera.
      await page.evaluate(() => {
        window.stint.edit = (p) => {
          window.__EDITED__ = p;
          const st = window.__STATE__;
          const patch = (p && p.patch) || {};
          const apply = (e) => {
            if (e.id === p.id && 'startUtc' in patch) e.startUtc = patch.startUtc;
            // endUtc is NEVER in a live-edit patch — the open row stays open (§05 R06).
          };
          if (st.status?.entry) apply(st.status.entry);
          for (const d of st.days || []) for (const e of d.entries) apply(e);
          return Promise.resolve(window.__ACK__);
        };
      });
      const grip = page.locator('#le-start-disc .stp-grip');
      await grip.scrollIntoViewIfNeeded();
      const g = await grip.boundingBox();
      const gx = Math.round(g.x + g.width / 2);
      const gy = Math.round(g.y + g.height / 2);
      await page.mouse.move(gx, gy);
      await page.mouse.down();
      await page.mouse.move(gx, gy - 30, { steps: 20 });
      await page.mouse.up();
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Drags write Start live (5-min snap) — the end stays empty, never a synthetic now'));
      await wait(page, 1300);
      for (let i = 1; i <= 3; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 400);
      }
      await wait(page, 900);
    },
  },

  // §05 R09 / §12 R14 — the Timer view's pinned favorites rail: it paints one row per
  // favorite, and a one-click Resume starts that favorite. The recording routes to the Timer
  // view, lets the rail render, then clicks the first row's Resume.
  'favorites-rail': {
    page: 'index.html',
    state: timerViewFavoritesState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #fav-rail');
      await wait(page, 500);
      await page.click('.fav-card [data-act="fav-resume"]');
      await wait(page, 600);
    },
  },

  // §05 R10 — Multiline descriptions (G9): a description keeps the line breaks a user types, stored
  // VERBATIM with no surface flattening it. The GUI half is the entry form's description control —
  // a 3-line scrollable multiline <textarea>. This recording opens the Entries view on a seeded
  // CLOSED entry whose description is already two lines ('line one\nline two'), clicks its Edit
  // affordance to reveal the inline form, and shows the description surfaced in the 3-line textarea
  // with its interior break intact. It then TYPES a fresh two-line description into the field (a
  // literal Enter inserts a newline in a textarea — it does not submit the form), Saves, and the
  // entry repaints. Reopening the form in edit mode shows the newly-typed text rendered INTACT —
  // proving the field is genuinely multiline and the stored record kept the newline verbatim. To
  // show the write faithfully (the harness IPC is mocked), this recipe scopes a local
  // window.stint.edit override — mirroring §05 R06's edit override — that applies the description
  // patch to the injected snapshot, so the post-commit load() repaints from the new value rather
  // than snapping back to the stale seed. The CLI-side of R10 (the `tt list` first-line 60-char cap
  // and the CSV round-trip) is transcript/GOLD evidence, so it is not part of this GIF.
  '§05 R10': {
    page: 'index.html',
    state: multilineDescState,
    drive: async (page) => {
      const row = '.entry[data-id="30"]';
      // The unified editor mounts in the shared view-level host (#entry-form-host), NOT nested in
      // the calendar event (editor rehost, §12 R06) — so the seeded fields are read via the plain
      // `.edit-form` selector (only one form is ever open).
      const form = '.edit-form.entry-form';
      await page.waitForSelector(row);
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Multiline description — a 3-line scrollable field, newlines kept verbatim (§05 R10)'));
      await wait(page, 700);

      await page.hover(row);
      await page.click(`${row} [data-act="edit"]`);
      await page.waitForSelector(`${form} .edit-desc`);
      await wait(page, 900);

      await page.evaluate(() => {
        window.stint.edit = (p) => {
          window.__EDITED__ = p;
          const st = window.__STATE__;
          const patch = (p && p.patch) || {};
          const apply = (e) => {
            if (e.id === p.id && 'description' in patch) e.description = patch.description;
          };
          if (st.status?.entry) apply(st.status.entry);
          for (const d of st.days || []) for (const e of d.entries) apply(e);
          return Promise.resolve(window.__ACK__);
        };
      });

      const editDesc = page.locator(`${form} .edit-desc`);
      await editDesc.fill('');
      await editDesc.click();
      await page.keyboard.type('Refactored the auth layer', { delay: 45 });
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Press Enter for a second line — the break is preserved, not flattened'));
      await page.keyboard.press('Enter');
      await page.keyboard.type('Follow-up: write the regression tests', { delay: 45 });
      await wait(page, 1000);

      // Save; the submit reads .value.trim() (interior newlines preserved) and sends the edit patch.
      await page.click(`${form} button[type="submit"]`);
      await page.waitForSelector(form, { state: 'detached' }).catch(() => {});
      await wait(page, 700);

      await page.hover(row);
      await page.click(`${row} [data-act="edit"]`);
      await page.waitForSelector(`${form} .edit-desc`);
      await page.waitForFunction(
        () => (document.querySelector('.edit-form .edit-desc')?.value ?? '').includes('\n'),
      );
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Reopened — both lines render intact, stored verbatim'));
      await wait(page, 1200);
    },
  },

  // §06 R03 — MERGE via multi-select. Two contiguous CLOSED entries that DISAGREE on client
  // (and billable) are armed by checking their corner checkboxes; the selection bar reveals
  // its live "2 selected" count pill beside the NEUTRAL Merge button (design.html D11 / V5),
  // and Merge raises the app.js-hosted conflict prompt
  // (§06 R3, §12 R6). The prompt resolves the
  // disagreeing client/billable field-by-field, then commits { ids, winnerId, billable } over
  // the same merge IPC — no clientId/projectId resolved in the renderer. To SHOW the merged
  // event appear (the IPC is mocked), this recipe scopes a local window.stint.merge override
  // that folds the two source rows into one spanning earliest-start→latest-end on the injected
  // snapshot, so the post-commit load() repaints the single merged entry.
  // (Selection is driven from the entry rows' corner checkboxes; those checkboxes ride the
  // calendar's `.ev` events once §12 R16's readonly entries calendar lands.)
  '§06 R03': {
    page: 'index.html',
    state: mergeConflictState,
    drive: async (page) => {
      await page.waitForSelector('.entry[data-id="40"] .sel');
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Check two contiguous events to arm the merge (§06 R03)'));
      await wait(page, 700);
      await page.check('.entry[data-id="40"] .sel');
      await wait(page, 400);
      await page.check('.entry[data-id="41"] .sel');
      await page.waitForFunction(() => {
        const bar = document.querySelector('#merge-bar');
        const count = document.querySelector('#merge-count');
        return bar && !bar.hidden && count && count.textContent.trim() === '2 selected';
      });
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('The selection bar shows the live count — 2 selected'));
      await wait(page, 900);

      await page.evaluate(() => {
        window.stint.merge = (p) => {
          window.__MERGED__ = p;
          const st = window.__STATE__;
          for (const d of st.days || []) {
            const kept = d.entries.filter((e) => p.ids.includes(e.id));
            if (kept.length < 2) continue;
            const sorted = kept.slice().sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
            const winner = kept.find((e) => e.id === p.winnerId) || sorted[0];
            const merged = {
              ...sorted[0],
              endUtc: sorted[sorted.length - 1].endUtc,
              description: sorted.map((e) => (e.description ?? '').trim()).filter(Boolean).join(' · '),
              clientLabel: winner.clientLabel,
              billable: p.billable ?? sorted[0].billable,
            };
            d.entries = [merged, ...d.entries.filter((e) => !p.ids.includes(e.id))];
          }
          return Promise.resolve(window.__ACK__);
        };
      });

      await page.click('#merge-go');
      await page.waitForSelector('.editor.conflict-prompt');
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Disagreeing selection — resolve the client/billable, then Merge'));
      await wait(page, 1100);
      // Pick the second offered client as the winner, then commit. The radio <input> is a
      // custom-styled control (visually hidden: opacity:0 / 0×0), so click the option LABEL
      // (.mc-row .opts .mc-opt) — clicking it checks the wrapped .mc-client radio via native label
      // behavior — rather than .check() on the hidden input (which fails Playwright's visibility gate).
      const clientOpts = page.locator('.editor.conflict-prompt .mc-row .opts .mc-opt');
      if ((await clientOpts.count()) > 1) await clientOpts.nth(1).click();
      await page.waitForFunction(
        () => document.querySelector('.editor.conflict-prompt .mc-client:checked')?.value === '41',
      );
      await wait(page, 500);
      await page.click('.editor.conflict-prompt .mc-merge');
      await page.waitForSelector('.editor.conflict-prompt', { state: 'detached' }).catch(() => {});
      await page.waitForSelector('.entry[data-id="41"]', { state: 'detached' }).catch(() => {});
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('One merged event remains, spanning earliest start to latest end'));
      await wait(page, 1200);
    },
  },

  // V5 (design.html D11) — the MERGE SELECTION BAR close-up. The divergence resolved to the
  // MOCK's idiom: once two entries are checked, a quiet selection bar appears ABOVE the calendar
  // carrying a lifted "N selected" count pill (the same chip idiom as D12), a spacer, and a
  // NEUTRAL small Merge button — not the retired accent card below the calendar. The reason is
  // accent discipline: the Entries view already spends its ONE accent-solid primary on the add
  // form's Save entry, so Merge, however consequential, stays a neutral button.
  //
  // This close-up drives the same fixture and selectors as the §06 R03 merge scene (the pinned
  // mergeConflictState pair, ids 40/41, whose disagreeing fields open the conflict prompt), but
  // dwells on the BAR rather than the merge outcome: the pointer travels to each corner checkbox
  // so the entry into multi-select is visible, the bar's arrival is held on camera with the live
  // "2 selected" pill, the pointer then travels across the pill and the Merge button, and only
  // then does Merge open the conflict prompt (the commit itself is §06 R03's evidence, so no
  // merge override is scoped here — nothing is written).
  //
  // Two computed oracles ride along, so a regression cannot re-record the retired look: the bar's
  // bottom edge must sit ABOVE the calendar strip's top edge (position, the whole point of V5),
  // and the Merge button must be neutral — no `.primary` class and no accent-solid fill.
  'V5': {
    page: 'index.html',
    state: mergeConflictState,
    drive: async (page) => {
      // Travel the pointer to an element's centre in visible steps (page.check is not one of the
      // decorated high-level actions, and this close-up is about seeing the interaction land).
      const travel = async (sel) => {
        const box = await page.locator(sel).first().boundingBox();
        if (!box) return;
        await page.mouse.move(
          Math.round(box.x + box.width / 2),
          Math.round(box.y + box.height / 2),
          { steps: 16 },
        );
        await wait(page, 320);
      };

      await page.waitForSelector('.entry[data-id="40"] .sel');
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption("Check an event's corner box to enter multi-select (§06 R3 / V5)"));
      await wait(page, 900);

      await travel('.entry[data-id="40"] .sel');
      await page.check('.entry[data-id="40"] .sel');
      await wait(page, 600);
      await travel('.entry[data-id="41"] .sel');
      await page.check('.entry[data-id="41"] .sel');
      await page.waitForFunction(() => {
        const bar = document.querySelector('#merge-bar');
        const count = document.querySelector('#merge-count');
        return bar && !bar.hidden && count && count.textContent.trim() === '2 selected';
      });
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('The selection bar appears ABOVE the calendar — a "2 selected" chip pill'));
      await wait(page, 1400);

      const facts = await page.evaluate(() => {
        const resolve = (name) => {
          const p = document.createElement('span');
          p.style.color = `var(${name})`;
          document.body.appendChild(p);
          const c = getComputedStyle(p).color;
          p.remove();
          return c;
        };
        const bar = document.querySelector('#merge-bar').getBoundingClientRect();
        const calEl = document.querySelector('.cstrip') || document.querySelector('#entries');
        const cal = calEl.getBoundingClientRect();
        const go = document.querySelector('#merge-go');
        return {
          barBottom: bar.bottom,
          calTop: cal.top,
          mergePrimary: go.classList.contains('primary'),
          mergeBg: getComputedStyle(go).backgroundColor,
          accentSolid: resolve('--accent-solid'),
        };
      });
      if (!(facts.barBottom <= facts.calTop + 1)) {
        throw new Error(
          `V5: the selection bar is not above the calendar (bar bottom ${facts.barBottom} vs calendar top ${facts.calTop})`,
        );
      }
      if (facts.mergePrimary || facts.mergeBg === facts.accentSolid) {
        throw new Error(
          `V5: Merge is not neutral (primary=${facts.mergePrimary}, background ${facts.mergeBg})`,
        );
      }

      await travel('#merge-count');
      await wait(page, 700);
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Merge stays a NEUTRAL button — the accent belongs to the view’s one primary'));
      await travel('#merge-go');
      await wait(page, 900);

      await page.click('#merge-go');
      await page.waitForSelector('.editor.conflict-prompt');
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Merge opens the disagreeing-field prompt — resolve, then commit'));
      await wait(page, 1600);
    },
  },

  // §12 R16 — the entries CALENDAR (week grid). Over a whole week of day columns — each carrying
  // its per-day billable header total, and no range chip anywhere (retracted by #295: the day
  // headers and the grid ARE the reflection surface) — the recording: shows the shown week filling
  // the view width with NO horizontal scroll (§12 R22, asserted on camera rather than framed);
  // scrolls the 24h track VERTICALLY to reveal the off-hours entries (scroll, never clip — every
  // hour is reachable though the viewport opens on working hours); and hovers an event to reveal
  // its Delete / Split / Edit ops + the corner checkbox. The empty days sit as present-but-empty
  // columns throughout, and Wednesday wears the today ring.
  '§12 R16': {
    page: 'index.html',
    state: entriesCalendarState,
    drive: async (page) => {
      await page.waitForSelector('.dcol .ev');
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Entries — the week grid (§12 R16)'));
      await wait(page, 1100);
      // The horizontal-scroll beat this recipe used to open on is now a FACT to deny: the week
      // fits, so a re-grown floor width would fail here instead of scrolling past the camera.
      const fit = await page.evaluate(() => {
        const strip = document.querySelector('.cstrip');
        return {
          overflow: strip.scrollWidth - strip.clientWidth,
          columns: document.querySelectorAll('#entries .dcol').length,
          totals: [...document.querySelectorAll('#entries .dcol .dh .ds')].map((t) => t.textContent),
          today: document.querySelectorAll('#entries .dcol .dh .dd.today').length,
          chips: document.querySelectorAll('#week-total').length,
        };
      });
      if (fit.overflow > 1 || fit.chips) {
        throw new Error(`the week grid should fit with no range chip: ${JSON.stringify(fit)}`);
      }
      await page.evaluate(
        (f) => window.__recCaption && window.__recCaption(
          `${f.columns} equal columns filling the view, no horizontal scroll — totals in the headers`),
        fit,
      );
      await wait(page, 1400);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('The 24h track scrolls — off-hours entries stay reachable, never clipped'));
      await page.evaluate(() => { const s = document.querySelector('.cstrip'); if (s) s.scrollTop = 0; });
      await wait(page, 800);
      await page.evaluate(() => { const s = document.querySelector('.cstrip'); if (s) s.scrollTop = s.scrollHeight; });
      await wait(page, 900);
      await page.evaluate(() => { const s = document.querySelector('.cstrip'); if (s) s.scrollTop = 240; });
      await page.hover('.entry[data-id="7"]').catch(() => {});
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Hover an event → Delete / Split / Edit + a corner checkbox'));
      await wait(page, 1500);
    },
  },

  // §12 R22 (with §12 R09) — THE WEEK-ONLY ENTRIES VIEW, and the fit-to-width grid that came with
  // it. The retired view had range presets, a floor column width and a horizontal scrollbar; this
  // one shows exactly one week whose day columns SHARE THE VIEW WIDTH EQUALLY at every window size
  // and every column count. The recording drives the four affordances that make the week navigable
  // and shows the fit surviving each of them:
  //
  //   (1) FIT — five equal columns filling the strip with no horizontal overflow, and TODAY marked
  //       on the grid (the ink ring on Wednesday's date numeral, distinct from selection).
  //   (2) THE WEEK PICKER — the month calendar beside the grid: entry-dot days, its own today ring,
  //       and the selected week highlighted as ONE unit. Clicking any day selects that day's whole
  //       week and the grid follows.
  //   (3) THE STEPPERS — prev/next move by exactly seven days, weekend visibility notwithstanding.
  //   (4) THE WEEKEND TOGGLE — flipping it persists show_weekend over the same setSetting IPC the
  //       Settings control uses and repaints SEVEN columns; the grid still fits, because equal
  //       shares of the width is the rule, not a five-column coincidence.
  //
  // The overflow is measured at every count, so a re-grown floor width fails the recording rather
  // than scrolling quietly past the camera. entriesCalendarState is the CALENDAR_LAYOUT judge
  // scene's own fixture (today on Wed 24, an empty Thursday, a Friday span reaching into the
  // hidden weekend), pinned to UTC so its instants are the local wall clock.
  '§12 R22': {
    page: 'index.html',
    state: entriesCalendarState,
    contextOpts: { timezoneId: 'UTC' },
    drive: async (page) => {
      // Overflow at the current column count — the fact the whole recipe re-checks.
      const fit = () =>
        page.evaluate(() => {
          const strip = document.querySelector('.cstrip');
          const cols = [...document.querySelectorAll('#entries .dcol')];
          const widths = cols.map((c) => Math.round(c.getBoundingClientRect().width));
          return {
            columns: cols.length,
            overflow: strip.scrollWidth - strip.clientWidth,
            spread: widths.length ? Math.max(...widths) - Math.min(...widths) : 0,
            width: widths[0] ?? 0,
            label: document.getElementById('el-week-label')?.textContent?.trim() ?? '',
          };
        });
      const requireFit = async (where) => {
        const f = await fit();
        // 1px of slack for sub-pixel column rounding; anything more is a real scrollbar.
        if (f.overflow > 1 || f.spread > 1) {
          throw new Error(`${where}: the week grid no longer fits its view — ${JSON.stringify(f)}`);
        }
        return f;
      };

      await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length > 0);
      const weekdays = await requireFit('weekdays');
      await page.evaluate(
        (f) => window.__recCaption && window.__recCaption(
          `${f.label} — ${f.columns} equal ${f.width}px columns, zero horizontal scroll (§12 R22)`),
        weekdays,
      );
      await wait(page, 1500);
      // Today is marked ON THE GRID (the header ring), not merely selected.
      const today = await page.evaluate(() => ({
        grid: document.querySelector('#entries .dcol .dh .dd.today')?.textContent ?? '',
        picker: document.querySelector('#week-picker .d.today')?.textContent?.trim() ?? '',
        dots: document.querySelectorAll('#week-picker .edot').length,
        band: document.querySelectorAll('#week-picker .d.ws').length,
      }));
      if (!today.grid || !today.picker || today.band !== 7) {
        throw new Error(`today/selection indicators missing: ${JSON.stringify(today)}`);
      }
      await page.evaluate(
        (t) => window.__recCaption && window.__recCaption(
          `Today ringed on the grid and in the picker (${t.grid}); the selected week is one lifted band`),
        today,
      );
      await wait(page, 1500);

      // (2) THE WEEK PICKER — click a day in the previous week; the whole week follows.
      await page.click('#week-picker .d[data-day="2026-06-17"]');
      await page.waitForFunction(() => document.getElementById('el-week-label')?.textContent?.includes('Jun 15'));
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Click any day in the picker → that day\'s whole week'));
      await requireFit('picker-selected week');
      await wait(page, 1400);

      // (3) THE STEPPERS — seven days at a time, back to the current week.
      await page.click('#el-next-week');
      await page.waitForFunction(() => document.getElementById('el-week-label')?.textContent?.includes('Jun 22'));
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Prev / next step the week by exactly seven days'));
      await wait(page, 1300);

      // (4) THE WEEKEND TOGGLE — seven columns, still sharing the width equally.
      await page.click('#el-weekend');
      await page.waitForFunction(() => document.querySelectorAll('#entries .dcol').length === 7);
      const weekend = await requireFit('weekend shown');
      await page.evaluate(
        (f) => window.__recCaption && window.__recCaption(
          `Show weekend → ${f.columns} columns at ${f.width}px each, still no horizontal scroll`),
        weekend,
      );
      await wait(page, 1700);
      await page.click('#el-weekend');
      await page.waitForFunction(() => document.querySelectorAll('#entries .dcol').length === 5);
      const back = await requireFit('weekend hidden again');
      await page.evaluate(
        (f) => window.__recCaption && window.__recCaption(
          `Off again — back to ${f.columns} columns, the width shared out between them`),
        back,
      );
      await wait(page, 1600);
    },
  },

  // §12 R09 (issue #55) — the Entries WEEK, its filters and its search. The view shows exactly one
  // week and has no range concept: the retired range presets and the retired range-total chip are
  // both gone (#264/#295/#297), so the week is chosen by the prev/next steppers or the week picker
  // and the per-day header totals are the reflection surface every filter moves.
  //
  // Recorded over the multi-week, multi-client, mixed-billable listState fixture (7 entries: this
  // week 5 — four billable plus a non-billable lunch — last week 1, last month 1) so "filtered" is
  // visibly different from "shows everything" (the exact blindness that let the dead toolbar ship).
  // The recording drives, in turn: the idle week, the search box (range + search compose — last
  // week's 'refactor planning' stays excluded even though it matches), the billable toggle, the
  // client + project filters, the tag filter, and finally the week steppers, each visibly moving
  // the event set. Every query rides the strict listEntries mock (rejects a missing `by` exactly
  // like core), so the flow on camera is also the no-query-throws proof, closed out by the wire
  // verdict. Mirrors the hardened ENTRIES_CALENDAR / LIVE_FILTER judge scenes; same fixture, same
  // selectors.
  '§12 R09': {
    page: 'index.html',
    state: listState,
    drive: async (page) => {
      const settle = (n) =>
        page.waitForFunction((c) => document.querySelectorAll('.dcol .ev').length === c, n);
      await settle(5);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Entries — one week, filtered live (§12 R09)'));
      await wait(page, 1100);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Idle: this week\'s 5 entries; the day headers carry the totals'));
      await wait(page, 1200);

      await page.fill('#search', 'refactor');
      await settle(2);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Search "refactor" → 2 in-week matches; last week\'s stays out (week + search compose)'));
      await wait(page, 1400);
      await page.fill('#search', '');
      await settle(5);

      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Billable: 4 entries — the non-billable lunch drops out'));
      await page.click('#el-billable-seg .seg-btn[data-billable="billable"]');
      await settle(4);
      await wait(page, 1200);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Non-billable: only the lunch'));
      await page.click('#el-billable-seg .seg-btn[data-billable="non-billable"]');
      await settle(1);
      await wait(page, 1200);
      await page.click('#el-billable-seg .seg-btn[data-billable="all"]');
      await settle(5);

      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Client Acme: 3 entries'));
      await page.waitForSelector('#el-client option[value="1"]', { state: 'attached' });
      await page.selectOption('#el-client', '1');
      await settle(3);
      await wait(page, 1200);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Project API: 1 entry'));
      await page.waitForSelector('#el-project option[value="11"]', { state: 'attached' });
      await page.selectOption('#el-project', '11');
      await settle(1);
      await wait(page, 1200);
      await page.selectOption('#el-client', '');
      await settle(5);

      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Tag "ci": 2 entries'));
      await page.fill('#el-tag', 'ci');
      await settle(2);
      await wait(page, 1300);
      await page.fill('#el-tag', '');
      await settle(5);

      // The week steppers are the only range control left, and they compose with the filters:
      // stepping back with the search still on shows last week's lone 'refactor planning'.
      await page.fill('#search', 'refactor');
      await settle(2);
      await page.click('#el-prev-week');
      await settle(1);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Prev week, search still on — last week\'s "refactor planning" alone'));
      await wait(page, 1400);

      const wire = await page.evaluate(() => ({
        errors: window.__LIST_ERRORS__ || 0,
        reqs: (window.__LIST_REQS__ || []).length,
        allBy: (window.__LIST_REQS__ || []).every((r) => r && r.by === 'day'),
      }));
      await page.evaluate((w) =>
        window.__recCaption && window.__recCaption(
          `listEntries: ${w.reqs} queries, ${w.errors} throws, all carry by:'day' = ${w.allBy} (issue #55)`),
        wire);
      await wait(page, 1600);
    },
  },

  // §12 R06 / §06 R01 (shared shot) — the readonly calendar's per-event HOVER OPS + the unified
  // editor as the ONE edit surface, with §06 R01's two-step Delete confirm gate. Over
  // unifiedFormState (the SAME seeded snapshot the UNIFIED_FORM judge item drives — the closed
  // 'design review' entry id 80, 14:00–15:30, alongside the seeded neighbours), the recording:
  //   (1) HOVERs the event → its icon-only ops chip reveals Delete / Split / Edit AND a corner
  //       checkbox (`.ops .op-btn[data-act=…]` + `.ck`), exactly what §12 R16's calendar exposes.
  //       (Hovering also raises the event above its overlapping neighbour id 83 so the ops are
  //       reachable — the same z-index reveal the judge relies on.)
  //   (2) CLICKs Edit → the ONE unified entry form opens in EDIT MODE in the shared view-level host
  //       (#entry-form-host, in flow, no modal/backdrop), seeded from every tt-editable field
  //       (multiline description, client/project, tag chips, billable, the always-present raw
  //       Start/Stop pair) — the identical add-mode form, now in edit mode (§12 R06).
  //   (3) exercises §06 R01's confirm gate in the edit-mode footer: the first Delete click ARMS a
  //       worded confirm (nothing removed yet), the explicit confirm then fires window.stint.remove
  //       with the entry id and the event LEAVES the calendar on the repaint. No scoped override is
  //       needed — the shared initScript remove mock splices the row and reloads (as the judge's
  //       CONFIRM_DELETE / UNIFIED_FORM items rely on), so the deletion lands on camera.
  //   (4) issue #49 — EXACT stored times: opens the NOT-snap-aligned entry 84 (09:07:33 →
  //       11:03:00Z) and shows the editor rendering the stored start/stop to the second (no
  //       snap-on-open), then clicks Save entry with NO drag and asserts (via waitForFunction —
  //       the recording FAILS if it times out) that the committed patch carries no
  //       startUtc/endUtc: the store's times round-trip unchanged.
  //   (5) reopens entry 84 and drags the selected interval's bottom stop grip ON THE GRID —
  //       asserting the DRAGGED stop (and only it) snaps onto the coarse grid while the untouched
  //       start keeps its 09:07:33.
  // No IPC surgery: the whole scene runs over the unmodified renderer + the same window.stint.*
  // channels tt uses; the shared unifiedFormState keeps the recording 1:1 with the JUDGE scene.
  '§12 R06': {
    page: 'index.html',
    state: unifiedFormState,
    drive: async (page) => {
      const row = '.entry[data-id="80"]';
      await page.waitForSelector('.dcol .ev');
      await page.waitForSelector(row);
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Hover an event → Delete / Split / Edit + a corner checkbox (§12 R06 / §06 R01)'));
      await wait(page, 700);

      await page.hover(row);
      await page.waitForSelector(`${row} .ops .op-btn[data-act="edit"]`, { state: 'attached' });
      await page.waitForSelector(`${row} .ops .op-btn[data-act="split"]`, { state: 'attached' });
      await page.waitForSelector(`${row} .ops .op-btn[data-act="delete"]`, { state: 'attached' });
      await page.waitForSelector(`${row} .ck`, { state: 'attached' });
      await wait(page, 1400);

      await page.hover(row);
      await page.click(`${row} [data-act="edit"]`);
      await page.waitForSelector('#entry-form-host .edit-form.entry-form[data-id="80"]', { state: 'attached' });
      await page.waitForSelector('.edit-form.entry-form .edit-client option[value="1"]', { state: 'attached' });
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Click Edit → the unified editor opens in edit mode, seeded — the same form as add'));
      await page.evaluate(() =>
        document.querySelector('.edit-form.entry-form')?.scrollIntoView({ block: 'center' }));
      await wait(page, 1700);

      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Two-step Delete — first arms a worded confirm, nothing removed yet'));
      await page.click('.edit-form.entry-form .ef-delete');
      await page.waitForSelector('.edit-form [data-act="confirm-delete"]', { state: 'attached' });
      await page.waitForSelector('.edit-form .confirm-q', { state: 'attached' });
      await wait(page, 1500);

      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Confirm — remove fires with the entry id; the event leaves the calendar'));
      await page.click('.edit-form [data-act="confirm-delete"]');
      await page.waitForSelector(row, { state: 'detached' }).catch(() => {});
      await wait(page, 1600);

      const exactRow = '.entry[data-id="84"]';
      await page.evaluate(() => {
        window.__EDITED__ = null; // beat (3) never edited, but keep the assertion self-contained
      });
      await page.hover(exactRow);
      await page.click(`${exactRow} [data-act="edit"]`);
      await page.waitForSelector('#entry-form-host .edit-form.entry-form[data-id="84"]', { state: 'attached' });
      await page.waitForSelector('.edit-form.entry-form .edit-client option[value="1"]', { state: 'attached' });
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Exact stored times — a 09:07:33 entry opens as 09:07:33, never snapped to 09:05'));
      await page.evaluate(() =>
        document.querySelector('.edit-form.entry-form')?.scrollIntoView({ block: 'center' }));
      await wait(page, 1700);
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Save entry with no drag — the patch carries NO start/stop: stored truth is untouched'));
      await page.click('.edit-form button[type="submit"]');
      await page.waitForFunction(
        () =>
          window.__EDITED__ &&
          window.__EDITED__.id === 84 &&
          !('startUtc' in window.__EDITED__.patch) &&
          !('endUtc' in window.__EDITED__.patch),
      );
      await wait(page, 1400);

      // The edited entry's own span is dragged on the GRID: its stored segments are replaced by
      // the accent-outlined selected interval, whose bottom grip moves the stop alone (§12
      // R06/R23) — the edit-mode half of the same overlay §12 R07's create mode drags.
      await page.hover(exactRow);
      await page.click(`${exactRow} [data-act="edit"]`);
      await page.waitForSelector('#entries .ev.me .grip.b', { state: 'attached' });
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Drag the stop grip on the grid — only the dragged handle snaps to the grid'));
      const gripBox = await page.evaluate(() => {
        const r = document.querySelector('#entries .ev.me .grip.b').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      await page.mouse.move(gripBox.x, gripBox.y, { steps: 14 });
      await page.mouse.down();
      await page.mouse.move(gripBox.x, gripBox.y + 40, { steps: 14 });
      await page.mouse.up();
      await page.waitForFunction(() => {
        const from = document.querySelector('.edit-form .edit-start')?.value ?? '';
        const to = document.querySelector('.edit-form .edit-end')?.value ?? '';
        // 19 chars: the field renders YYYY-MM-DD HH:mm:ss, seconds always (issue #159). The
        // untouched start keeps its :33; the dragged stop lands on the coarse 15-min grid.
        return /:33$/.test(from) && to.length === 19 && Number(to.slice(14, 16)) % 15 === 0;
      });
      await wait(page, 1600);
    },
  },

  // §12 R24 (core, loss protection) — THE PENDING-CHANGES GATE, on screen. The unified form tracks
  // whether its fields differ from their seed; swapping its subject — clicking a different event —
  // is instant when the form is clean and BLOCKED by the keep-editing / discard-changes dialog when
  // it is dirty. The whole point is that typed work is never lost to a stray click, which is a
  // thing to WATCH rather than to read: the recording is the moving half of the
  // PENDING_CHANGES_GATE judge item.
  //
  // Over unifiedFormState (the same seeded snapshot the judge drives — 'design review' id 80 and
  // 'deep work' id 82), the recording plays the contrast three times:
  //
  //   (1) CLEAN SWAP — open entry 80, touch nothing, click entry 82: the fields replace in place,
  //       no dialog. Establishes that the gate is about pending edits, not about clicking.
  //   (2) KEEP EDITING — reopen 80, TYPE into the description, then click 82. The dialog rises with
  //       Keep editing FOCUSED (the non-destructive default), the form's subject still 80 beneath
  //       it, and nothing written. Keep editing returns to the form with the typed text intact —
  //       echoed in the caption from the live field, so preservation is legible, not asserted
  //       off-camera.
  //   (3) DISCARD CHANGES — the same swap attempted again, resolved the other way: the explicit
  //       Discard abandons the typed work and performs the swap, and the form is now seeded from
  //       entry 82 with the typed text gone.
  //
  // Each beat asserts its own facts (dialog present / absent, the subject held, nothing written,
  // the typed text preserved or gone), so a gate that stopped arming — or one that armed and then
  // lost the edits anyway — FAILS the recording instead of being quietly re-recorded. No IPC
  // surgery: the scene runs over the unmodified renderer and the shared fixture mocks.
  '§12 R24': {
    page: 'index.html',
    state: unifiedFormState,
    drive: async (page) => {
      const TYPED = 'costing the migration';
      // The renderer treats a click on an op button / checkbox as an action, not a body click, so
      // the swap must land on the event's own inert body — found by hit-test, exactly as a user's
      // eye does, rather than assumed to be the block's centre.
      const clickEventBody = async (selector) => {
        await page.locator(selector).scrollIntoViewIfNeeded();
        const point = await page.evaluate((sel) => {
          const ev = document.querySelector(sel);
          const r = ev.getBoundingClientRect();
          const inert = (el) =>
            el && ev.contains(el) && !el.closest('[data-act], input, button, a, .confirm, .split-at');
          for (let y = r.top + 3; y < r.bottom - 2; y += 3) {
            for (let x = r.left + 3; x < r.right - 2; x += 3) {
              if (inert(document.elementFromPoint(Math.round(x), Math.round(y)))) {
                return { x: Math.round(x), y: Math.round(y) };
              }
            }
          }
          return null;
        }, selector);
        if (!point) throw new Error(`no clickable inert body on ${selector}`);
        await page.mouse.move(point.x, point.y, { steps: 16 });
        await wait(page, 380);
        await page.mouse.click(point.x, point.y);
      };
      const openEdit = async (id) => {
        await page.hover(`.entry[data-id="${id}"]`);
        await page.click(`.entry[data-id="${id}"] [data-act="edit"]`);
        await page.waitForSelector(`.entry-form[data-mode="edit"][data-id="${id}"]`, { state: 'attached' });
        // The reference data arrives async and patches the seed's select halves; waiting for it
        // keeps the "dirty" below about what was typed and not about a select still filling in.
        await page.waitForSelector('.entry-form .edit-client option[value="1"]', { state: 'attached' });
      };
      const subject = () => page.evaluate(() => document.querySelector('.entry-form')?.dataset.id ?? null);
      const typedNow = () =>
        page.evaluate(() => document.querySelector('.entry-form .edit-desc')?.value ?? '');

      await page.waitForSelector('.dcol .ev');

      // ===== (1) CLEAN SWAP — no prompt, the fields just change =====
      await openEdit(80);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('A CLEAN form swaps subject in place — no prompt (§12 R24)'));
      await wait(page, 750);
      await clickEventBody('.entry[data-id="82"]');
      await page.waitForFunction(() => document.querySelector('.entry-form')?.dataset.id === '82');
      if (await page.$('.gate-backdrop')) throw new Error('a clean swap raised the gate');
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Nothing typed, nothing to lose — "deep work" simply replaces it'));
      await wait(page, 1250);

      // ===== (2) DIRTY SWAP → KEEP EDITING — the typed work comes back untouched =====
      await page.click('.entry-form .edit-cancel');
      await page.waitForSelector('.entry-form', { state: 'detached' });
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Now the same swap, with unsaved edits on the form'));
      await openEdit(80);
      await page.fill('.entry-form .edit-desc', TYPED);
      await page.evaluate(
        (t) => window.__recCaption && window.__recCaption(`Now type something and DON'T save: "${t}"`),
        TYPED,
      );
      await wait(page, 850);
      await clickEventBody('.entry[data-id="82"]');
      await page.waitForSelector('.gate-backdrop .gatecard', { state: 'attached' });
      // Reaching an event further down the day scrolled the page; the gate rides a FIXED
      // backdrop, so scrolling back frames the dialog over the form it is guarding — the
      // pending work has to be visible for "nothing was lost" to be something a viewer can see.
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await wait(page, 300);
      const armed = await page.evaluate(() => ({
        heading: document.querySelector('.gatecard h3')?.textContent ?? '',
        keepFocused: document.activeElement?.classList.contains('gate-keep'),
        subject: document.querySelector('.entry-form')?.dataset.id ?? null,
        nothingWritten: !window.__EDITED__ && !window.__ADDED__,
      }));
      if (!/discard/i.test(armed.heading) || !armed.keepFocused || armed.subject !== '80' || !armed.nothingWritten) {
        throw new Error(`the gate did not arm as specified: ${JSON.stringify(armed)}`);
      }
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('The swap is BLOCKED — Keep editing is focused, nothing written'));
      await wait(page, 1250);
      await page.click('.gatecard .gate-keep');
      await page.waitForSelector('.gate-backdrop', { state: 'detached' });
      const kept = { id: await subject(), desc: await typedNow() };
      if (kept.id !== '80' || kept.desc !== TYPED) {
        throw new Error(`Keep editing lost the pending work: ${JSON.stringify(kept)}`);
      }
      await page.evaluate(
        (t) => window.__recCaption && window.__recCaption(`Keep editing → still entry 80, still "${t}"`),
        kept.desc,
      );
      await wait(page, 1250);

      // ===== (3) THE SAME SWAP, DISCARDED — the only way typed work is abandoned =====
      await clickEventBody('.entry[data-id="82"]');
      await page.waitForSelector('.gate-backdrop .gatecard', { state: 'attached' });
      // Reaching an event further down the day scrolled the page; the gate rides a FIXED
      // backdrop, so scrolling back frames the dialog over the form it is guarding — the
      // pending work has to be visible for "nothing was lost" to be something a viewer can see.
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await wait(page, 300);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Same swap again — this time Discard changes'));
      await wait(page, 850);
      await page.click('.gatecard .gate-discard');
      await page.waitForFunction(() => document.querySelector('.entry-form')?.dataset.id === '82');
      const swapped = { id: await subject(), desc: await typedNow() };
      if (swapped.id !== '82' || swapped.desc === TYPED) {
        throw new Error(`Discard did not perform the swap: ${JSON.stringify(swapped)}`);
      }
      await page.evaluate(
        (d) => window.__recCaption && window.__recCaption(`Discard → the swap happens: entry 82, "${d}"`),
        swapped.desc,
      );
      await wait(page, 1550);
    },
  },

  // §12 R10 (shared shot with §06 R04) — flags in context: MARKERS on the readonly calendar, DETAIL
  // + reversible control in the unified editor. Over a day carrying an overlap pair (10↔11, 30m)
  // and a slept entry (12, raw 4h trimmed to 3h), the recording: shows the yellow `.ov` overlap
  // warn band(s) + the `.zz` slept hatch on the calendar; opens the overlapped event's editor to
  // reveal the overlap DETAIL ("Overlap: 30m with …"); then opens the slept event's editor and
  // toggles the reversible sleep control — Restore lifts the exclusion (billable back to the raw
  // 4h), Subtract slept re-excludes it (the raw 4h reads struck through beside the trimmed 3h).
  '§12 R10': {
    page: 'index.html',
    state: flaggedState,
    drive: async (page) => {
      await page.waitForSelector('.dcol .ev');
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Flags in context — overlap warn bands + a slept hatch on the calendar (§12 R10)'));
      await wait(page, 1200);
      // Open the overlapped event (10, 09:00–11:00) → the editor spells out the overlap detail. The
      // editor mounts in the shared view-level host (#entry-form-host), NOT nested in the calendar
      // event (editor rehost, §12 R06) — so open via hover + its Edit op and read the flags off the
      // plain `.edit-form` selector. Entry 11 (10:00–10:30) is nested at 10's vertical CENTRE, so
      // hover 10 near its TOP (the 09:00 edge, clear of 11) to raise it above 11 and reveal its ops.
      await page.hover('.entry[data-id="10"]', { position: { x: 24, y: 12 } });
      await page.click('.entry[data-id="10"] [data-act="edit"]');
      await page.waitForSelector('.edit-form .ef-flags .banner.overlap');
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Open the entry → the overlap detail: amount + which neighbour'));
      await wait(page, 1300);
      await page.click('.edit-form .edit-cancel');
      await page.waitForSelector('.edit-form', { state: 'detached' });
      await page.hover('.entry[data-id="12"]');
      await page.click('.entry[data-id="12"] [data-act="edit"]');
      await page.waitForSelector('.edit-form .ef-subtract');
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Slept entry: raw 4h struck beside the trimmed 3h billable — Restore to reverse'));
      await wait(page, 1300);
      await page.click('.edit-form .ef-subtract');
      await page.waitForSelector('.edit-form .ef-dur s.struck', { state: 'detached' });
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Restore — the slept time is billable again (no strike)'));
      await wait(page, 1200);
      await page.click('.edit-form .ef-subtract');
      await page.waitForSelector('.edit-form .ef-dur s.struck');
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Subtract slept — reversible: the raw duration is struck once more'));
      await wait(page, 1300);
    },
  },

  // §07 R01 — reference data from the Clients view, CREATE driven end to end (issue #48):
  // "+ Add client" opens the inline "New client" field, a typed name commits over the
  // addClient IPC (parity with `tt client add`) and the new client LANDS in the active
  // list; then a client row's "+ Add project" and the tag strip's "+ Add tag" do the same
  // over addProject / addTag. This recording exists because presence-only checks passed
  // while the button was DEAD — a duplicate id="add-client" bound its click handler to the
  // Add-entry form's Client <select> — so the evidence here is the click WORKING, on
  // camera, over the same stateful fixture mocks the CLIENTS_VIEW JUDGE scene machine-
  // scores (the add mutators append to the canned lists, so each re-render shows the
  // created item like production core would).
  '§07 R01': {
    page: 'index.html',
    state: clientsState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="clients"]');
      await page.waitForSelector('#clients:not([hidden]) .client .project', { state: 'attached' });
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Clients view — create client / project / tag in place (§07 R1)'));
      await wait(page, 1100);

      await page.click('#add-client-btn');
      await page.waitForSelector('#clients-list .client-add input[placeholder="New client"]');
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('+ Add client → the inline New-client field opens'));
      await wait(page, 900);
      await page.fill('#clients-list .client-add .client-add-input', 'Initech');
      await wait(page, 500);
      await page.click('#clients-list .client-add button[type="submit"]');
      await page.waitForFunction(() =>
        [...document.querySelectorAll('#clients .client-name')].some(
          (n) => n.textContent.trim() === 'Initech',
        ));
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Committed over addClient — Initech lands in the active list'));
      await wait(page, 1300);

      // (2) + Add project on Acme's row — the inline field opens in line with Acme's
      // projects; the commit carries Acme's id (the renderer resolves no names).
      await page.click('#clients .client[data-id="1"] [data-act="add-project"]');
      await page.waitForSelector(
        '#clients .client[data-id="1"] .project-add input[placeholder="New project"]',
      );
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption("+ Add project under Acme → the inline New-project field"));
      await wait(page, 900);
      await page.fill('#clients .client[data-id="1"] .project-add .project-add-input', 'Mobile');
      await wait(page, 500);
      await page.click('#clients .client[data-id="1"] .project-add button[type="submit"]');
      await page.waitForFunction(() =>
        [...document.querySelectorAll('#clients .client[data-id="1"] .project-name')].some(
          (n) => n.textContent.trim() === 'Mobile',
        ));
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Committed over addProject — Mobile nests under Acme'));
      await wait(page, 1300);

      // (3) + Add tag on the tag strip — same inline pattern over addTag (`tt tag add`).
      await page.click('#add-tag');
      await page.waitForSelector('#tags-list .tag-add input[placeholder="New tag"]');
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('+ Add tag → the inline New-tag field opens'));
      await wait(page, 900);
      await page.fill('#tags-list .tag-add .tag-new-input', 'billing');
      await wait(page, 500);
      await page.click('#tags-list .tag-add button[type="submit"]');
      await page.waitForFunction(() =>
        [...document.querySelectorAll('#tags-list .tag-row-name')].some(
          (n) => n.textContent.trim() === 'billing',
        ));
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Committed over addTag — billing lands in the active tag strip'));
      await wait(page, 1400);
    },
  },

  // §05 R09 — Favorite (pinned timer): the four R09 capabilities, all inside the Timer view's
  // favorites rail. With a timer running (the canonical 'auth refactor' open row) and three
  // seeded favorites, the recording: (a) PINS the running timer as a favorite — clicks
  // 'Pin as favorite', the prompt resolves to a name, and the new chip appears in the rail
  // (pinFavorite over the injected snapshot, faithful to `tt fav add` capturing the open row);
  // (b) LISTS — the rail now shows every favorite (name + captured description/tags); (c)
  // RENAMEs in place — kebab (⋯) → Rename, the prompt resolves to a new name, the chip's name
  // repaints (renameFavorite, parity with `tt fav rename`); (d) UNPINS — kebab → Unpin removes
  // the chip from the rail (unpinFavorite, parity with `tt fav rm`). Both names are gathered
  // through the INLINE name field (typed, committed on Enter) — Electron's renderer does not
  // implement window.prompt, so the pin/rename affordances are inline controls (issue #52)
  // and the scene drives them like a user. Resume (R10) is recorded separately in
  // 'favorites-rail'.
  '§05 R09': {
    page: 'index.html',
    state: timerViewFavoritesState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #fav-rail');
      await wait(page, 500);

      const before = await page.$$eval('.fav-card', (els) => els.length);
      await page.click('#fav-pin');
      await page.waitForSelector('.fav-pin-form .rename-input');
      await page.fill('.fav-pin-form .rename-input', 'Invoice prep');
      await wait(page, 400);
      await page.press('.fav-pin-form .rename-input', 'Enter');
      await page.waitForFunction(
        (n) => document.querySelectorAll('.fav-card').length === n + 1,
        before,
      );
      await wait(page, 900);

      const pinned = page.locator('.fav-card', { hasText: 'Invoice prep' });
      await pinned.locator('[data-act="fav-menu"]').click();
      await wait(page, 400);
      await pinned.locator('[data-act="fav-rename"]').click();
      await page.waitForSelector('.fav-card .rename-form .rename-input');
      await page.fill('.fav-card .rename-form .rename-input', 'Client invoicing');
      await wait(page, 400);
      await page.press('.fav-card .rename-form .rename-input', 'Enter');
      await page.waitForFunction(
        () => [...document.querySelectorAll('.fav-card .fav-name')].some((n) => n.textContent.trim() === 'Client invoicing'),
      );
      await wait(page, 800);

      const renamed = page.locator('.fav-card', { hasText: 'Client invoicing' });
      await renamed.locator('[data-act="fav-menu"]').click();
      await wait(page, 400);
      await renamed.locator('[data-act="fav-unpin"]').click();
      await page.waitForFunction(
        () => ![...document.querySelectorAll('.fav-card .fav-name')].some((n) => n.textContent.trim() === 'Client invoicing'),
      );
      await wait(page, 900);
    },
  },

  // §05 R09 — the empty-favorites state: the rail instructs the user to pin a favorite and
  // mentions `tt fav`. The recording routes to the Timer view and dwells on the empty state.
  'favorites-rail-empty': {
    page: 'index.html',
    state: timerViewEmptyFavoritesState,
    initOpts: { favorites: [] },
    drive: async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #fav-empty');
      await wait(page, 800);
    },
  },

  // §12 R14 (G5) — the FULL Timer view, end to end, the way the requirement reads it. One
  // continuous scene over the REAL renderer drives every beat the req gates: (1) the LIVE
  // COUNT-UP advancing on a running timer with its description + client/project + tags and the
  // running-state dot; (2) EDIT THE RUNNING TIMER LIVE — change the description AND the start
  // time AND toggle Billable — and SHOW the row stays running (no stop), with the End time
  // deliberately absent ("no stop" pill + "End time not editable while running" note);
  // (3) STOP, then START a NEW timer with details from the Start form (the idle-only start
  // surface — while a timer runs the view offers only edit-or-stop, issue #51; there is no
  // separate switch verb either, issue #34); (4) the pinned FAVORITES rail — PIN the running timer as a favorite,
  // one-click RESUME a favorite to start a fresh timer, and RENAME / UNPIN via the kebab
  // (§05 R09–R10) — confirming no Switch verb survives anywhere in the view.
  //
  // All writes go over the SAME window.stint.* channels tt uses (edit / toggle / start /
  // pinFavorite / startFavorite / renameFavorite / unpinFavorite) — the parity twins of
  // `tt`. Because the canned mocks record-but-don't-mutate the injected snapshot, each beat
  // scopes a LOCAL page.evaluate override (mirroring §05 R02's toggle / §05 R05's add / §05
  // R10's startFavorite overrides) that applies the real effect to window.__STATE__ so the
  // post-write load() repaint SHOWS the change on camera. The overrides are scoped to THIS
  // page only — no shared fixture or JUDGE scene is touched, and the renderer's unchanged
  // commit paths stay the single source of truth. The pinned JUDGE_NOW clock is stepped where
  // a count-up must visibly tick. The two names the rail gathers (pin name, rename name) are
  // typed into the INLINE name fields and committed on Enter — Electron's renderer does not
  // implement window.prompt, so the affordances are inline controls (issue #52).
  '§12 R14': {
    page: 'index.html',
    state: timerViewFavoritesState,
    initOpts: { startStopsOpen: true },
    drive: async (page) => {
      // The pinned fake clock starts paused at JUDGE_NOW. Because this one continuous scene flushes
      // a debounce AND ticks several count-ups, the clock can only move FORWARD (pauseAt cannot go
      // backwards). `nowMs` tracks the current pinned instant; tickClock(n) advances it n seconds,
      // stepping the pinned clock so a count-up visibly ticks on camera, and atNow() reads the
      // current instant (used to start the resumed favorite fresh at the live clock).
      let nowMs = Date.parse(JUDGE_NOW);
      const atNow = () => new Date(nowMs).toISOString();
      const tickClock = async (n, dwell = 320) => {
        for (let i = 0; i < n; i++) {
          nowMs += 1000;
          await page.clock.pauseAt(new Date(nowMs));
          await wait(page, dwell);
        }
      };

      // ---- (1) LIVE COUNT-UP + RUNNING STATE -------------------------------------------------
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-clock');
      await page.waitForSelector('#timer-card.running');
      await page.waitForFunction(
        () => document.querySelector('#timer-state')?.textContent?.trim() === 'running',
      );
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'auth refactor',
      );
      await wait(page, 600);
      await tickClock(3, 350);

      // ---- (2) EDIT THE RUNNING TIMER LIVE — no stop ----------------------------------------
      await page.waitForSelector('#live-edit:not([hidden])');
      await page.waitForFunction(() => !document.querySelector('#live-edit #le-end'));
      await page.evaluate(() => {
        window.stint.edit = (p) => {
          window.__EDITED__ = p;
          const st = window.__STATE__;
          const patch = (p && p.patch) || {};
          const id = p && p.id;
          const apply = (e) => {
            if (e.id !== id) return;
            if ('description' in patch) e.description = patch.description;
            if ('startUtc' in patch) e.startUtc = patch.startUtc;
            if ('billable' in patch) e.billable = patch.billable;
            // endUtc is NEVER in a live-edit patch — the open row stays open.
          };
          if (st.status?.entry) apply(st.status.entry);
          for (const d of st.days || []) for (const e of d.entries) apply(e);
          return Promise.resolve(window.__ACK__);
        };
      });
      await wait(page, 500);

      // 2a — change the DESCRIPTION. The strip debounces a single commit 500ms after the last
      // keystroke (scheduleLiveEdit); the fake clock is PAUSED at JUDGE_NOW, so a real wait never
      // fires that timer — advance the pinned clock past the debounce window to flush the commit.
      // The post-commit load() repaints the card to the new text, and it stays .running (no stop).
      await page.evaluate(() => {
        window.__EDITED__ = null; // isolate this commit so the desc-only assertion is self-contained
      });
      await page.fill('#live-edit #le-desc', 'auth refactor v2');
      await tickClock(1, 0);
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'auth refactor v2',
      );
      // §12 R14/R15 (issue #68) — the DESC-ONLY negative probe: a description edit ALONE commits a
      // patch carrying ONLY `description`. The untouched Start field is BYTE-compared to its seed
      // (never reparsed to a spurious instant — even a DST fall-back-ambiguous wall-clock stays
      // untouched), so NO startUtc; NO endUtc (the open row never closes); NO billable (untouched).
      // This IS the assertion — the recording fails if the strip's converged diff ever leaks a time
      // key on a desc-only edit (the gap this scene's positive-only drag path used to leave open).
      await page.waitForFunction(() => {
        const p = window.__EDITED__ && window.__EDITED__.patch;
        return !!p && p.description === 'auth refactor v2' &&
          !('startUtc' in p) && !('endUtc' in p) && !('billable' in p);
      });
      await page.waitForSelector('#timer-card.running');
      await wait(page, 600);

      // 2b — change the START TIME via the raw text Start field (localInputValue format —
      // §12 R14/G1, no datetime-local); its edits ride the same 500ms debounced commit as the
      // description (and as the inline start-only picker's live drag writes), so advance the
      // pinned clock to flush the `edit` patch carrying startUtc (and never endUtc).
      await page.fill('#live-edit #le-start', '2026-06-24T21:15');
      await page.dispatchEvent('#live-edit #le-start', 'change');
      await tickClock(1, 0);
      await page.waitForFunction(() => !!window.__EDITED__ && 'startUtc' in (window.__EDITED__.patch || {}));
      await page.waitForSelector('#timer-card.running');
      await wait(page, 600);

      // 2c — toggle BILLABLE off (immediate commit). The patch carries billable, never endUtc;
      // the timer keeps running. Dwell so the running strip (with no End field) is legible
      // alongside the still-advancing running card.
      await page.click('#live-edit #le-bill');
      await page.waitForFunction(() => !!window.__EDITED__ && 'billable' in (window.__EDITED__.patch || {}));
      await page.waitForSelector('#timer-card.running');
      await page.waitForFunction(() => !('endUtc' in (window.__EDITED__.patch || {})));
      await wait(page, 900);

      // ---- (3) STOP, then START A NEW TIMER WITH DETAILS -------------------------------------
      await page.evaluate(() => {
        const prevToggle = window.stint.toggle;
        window.stint.toggle = () => {
          const st = window.__STATE__;
          const now = window.__JUDGE_NOW__;
          for (const d of st.days || []) for (const e of d.entries) if (e.endUtc == null) e.endUtc = now;
          window.__STATE__ = {
            status: { running: false, entry: null },
            days: st.days,
            sleepFlaggedIds: [],
            settings: st.settings,
          };
          return prevToggle();
        };
      });
      await page.click('[data-view="timer"]:not([hidden]) #timer-stop');
      await page.waitForSelector('#timer-card.idle');
      await page.waitForFunction(
        () => document.querySelector('#timer-state')?.textContent?.trim() === 'idle',
      );
      await wait(page, 700);

      // START A NEW TIMER WITH DETAILS from the Start form (the relocated core-entry surface —
      // idle-only, so it reappears now the timer is stopped; issue #51, and no Switch verb,
      // issue #34). startStopsOpen makes the submitted attributes the single fresh open row, so
      // the repaint paints the running card with the entered description and the count-up begins.
      await page.click('#start-panel #start-toggle');
      await page.waitForSelector('#start-form:not([hidden])', { state: 'attached' });
      await page.fill('#start-desc', 'invoice prep');
      await page.fill('#start-client', 'Globex');
      await page.fill('#start-project', 'Billing');
      await page.fill('#start-tags', 'admin');
      await wait(page, 400);
      await page.click('#start-go');
      await page.waitForSelector('#timer-card.running');
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'invoice prep',
      );
      await page.waitForFunction(() => !document.querySelector('#switch') && !document.querySelector('#timer-switch'));
      await tickClock(3);
      await wait(page, 600);

      // ---- (4) FAVORITES RAIL — pin, resume, rename, unpin -----------------------------------
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #fav-rail .fav-card');
      const before = await page.$$eval('.fav-card', (els) => els.length);
      await page.click('#fav-pin');
      await page.waitForSelector('.fav-pin-form .rename-input');
      await page.fill('.fav-pin-form .rename-input', 'Invoice prep');
      await wait(page, 400);
      await page.press('.fav-pin-form .rename-input', 'Enter');
      await page.waitForFunction(
        (n) => document.querySelectorAll('.fav-card').length === n + 1,
        before,
      );
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('.fav-card .fav-name')].some(
            (n) => n.textContent.trim() === 'Invoice prep',
          ),
      );
      await wait(page, 800);

      // RESUME a favorite with ONE click → a FRESH timer starts from that favorite's template
      // (atomic replacement). Scope a startFavorite override that flips __STATE__ to a fresh open
      // entry from the named template, started at the CURRENT pinned instant (atNow) so the count-up
      // begins fresh at 00:00:00 and ticks up from there — a live, freshly-started timer.
      await page.evaluate((nowIso) => {
        window.stint.startFavorite = async (p) => {
          (window.__RESUMED__ ||= []).push(p);
          const fav = (window.stint.__FAVORITES__ || []).find((f) => f.name === (p && p.name)) || {};
          const entry = {
            id: 600,
            description: fav.description ?? 'focus block',
            clientLabel: fav.clientId ? 'Client A / Focus' : null,
            startUtc: nowIso,
            endUtc: null,
            billableSeconds: 0,
            billable: fav.billable !== false,
            overlapped: false, overlapMinutes: 0, overlapRelation: null,
            sleptThrough: false, excludedSeconds: 0, rawSeconds: 0,
            tags: Array.isArray(fav.tags) ? fav.tags.slice() : [],
          };
          window.__STATE__ = {
            status: { running: true, entry: { ...entry } },
            days: [{ day: nowIso.slice(0, 10), entries: [entry] }],
            sleepFlaggedIds: [],
            settings: window.__STATE__.settings,
          };
          return Promise.resolve(window.__ACK__);
        };
      }, atNow());
      const deepWork = page.locator('.fav-card', { hasText: 'Deep work' });
      await deepWork.locator('[data-act="fav-resume"]').click();
      // The resume handler repaints the rail; fire the mock's changed-broadcast so the
      // Active-Timer card repaints to the resumed fresh template. Drive it through
      // __FIRE_CHANGED__ — the channel fixtures.mjs deliberately exposes to the harness —
      // rather than calling app.js's top-level `load()` as an accidental global: that
      // reached into the renderer's leaked scope (which #183 exists to remove), and the
      // `typeof load === 'function' ? … : null` guard it needed meant a missing entry point
      // degraded to a silent no-op — a recording that stops driving the repaint still
      // produces a GIF, just the wrong one. This path has no guard and throws if it breaks,
      // and it repaints the way production does: app.js's onChange runs load() AND
      // renderFavorites() on the Timer view.
      await page.evaluate(() => window.stint.__FIRE_CHANGED__());
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'focus block',
      );
      await page.waitForSelector('#timer-card.running');
      await tickClock(3);
      await wait(page, 600);

      const pinned = page.locator('.fav-card', { hasText: 'Invoice prep' });
      await pinned.locator('[data-act="fav-menu"]').click();
      await wait(page, 400);
      await pinned.locator('[data-act="fav-rename"]').click();
      await page.waitForSelector('.fav-card .rename-form .rename-input');
      await page.fill('.fav-card .rename-form .rename-input', 'Client invoicing');
      await wait(page, 400);
      await page.press('.fav-card .rename-form .rename-input', 'Enter');
      await page.waitForFunction(
        () => [...document.querySelectorAll('.fav-card .fav-name')].some((n) => n.textContent.trim() === 'Client invoicing'),
      );
      await wait(page, 700);

      const renamed = page.locator('.fav-card', { hasText: 'Client invoicing' });
      await renamed.locator('[data-act="fav-menu"]').click();
      await wait(page, 400);
      await renamed.locator('[data-act="fav-unpin"]').click();
      await page.waitForFunction(
        () => ![...document.querySelectorAll('.fav-card .fav-name')].some((n) => n.textContent.trim() === 'Client invoicing'),
      );
      await wait(page, 1000);
    },
  },

  // §12 R14 (G5) — the full Timer view: the live count-up advancing, the running state, the
  // running entry's description/client, and the live-edit-running strip. The recording routes
  // to the Timer view, advances the pinned clock so the count-up visibly ticks, and edits the
  // live strip's description (the open row stays open).
  'timer-view': {
    page: 'index.html',
    state: timerViewRunningState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-clock');
      await wait(page, 400);
      for (let i = 1; i <= 3; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 300);
      }
      await page.fill('#live-edit #le-desc', 'auth refactor v2');
      await wait(page, 500);
    },
  },

  // §12 R08 (G11) — Reports view = SAVED reports, end to end. This recording drives the FULL
  // requirement over the REAL in-shell Reports view (the standalone report.html is retired, so
  // the sidebar stays present throughout): it LISTS the seeded saved definitions; clicks the
  // single accent primary '+ New report' and BUILDS a definition (name, range = This week,
  // group by client, billable-only, rounding off); SAVES it so the new card appears in the
  // list; clicks Run and shows the on-screen GROUPED summary with totals AND the overlap +
  // unreviewed-sleep flags surfaced IN CONTEXT on the affected rows; clicks Export CSV then
  // Export JSON and shows the export confirmation line (the mock's exportEntries returns a
  // written-shaped result — no save dialog over file://, so the status line is the confirmation
  // the requirement calls out); clicks Edit on the new card, changes Group by to Project, and
  // re-runs to show the regroup (the card's spec summary now reads 'grouped by project'); then
  // RENAMES the definition via the card kebab (⋮ → the inline Rename / Delete menu → the
  // inline name field committed on Enter, renameReport) and DELETES it (⋮ → Delete → the
  // generic §12 R13 in-window confirm gate), the card leaving the list. Both affordances are
  // INLINE controls — Electron's renderer implements neither window.prompt nor window.confirm
  // (issue #52) — so the scene drives them like a user, no dialog handler. The accent stays
  // confined to '+ New report' the whole time. All CRUD/Run/Export run over the same window.stint.*
  // channels tt uses (saveReport / runReport / exportEntries / editReport / removeReport) — the
  // parity twins of `tt report save|run|edit|rm`. savedReportsState seeds the list; runReport
  // returns the flag-carrying REPORT_SUMMARY so the run-output paints flags in context.
  '§12 R08': {
    page: 'index.html',
    state: savedReportsState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="reports"]');
      await page.waitForSelector('[data-view="reports"]:not([hidden])');
      await page.waitForSelector('#rep-defs .def');
      await wait(page, 1100);

      await page.click('#rep-new');
      await page.waitForSelector('#rep-builder:not([hidden])');
      await wait(page, 500);

      // BUILD the definition: name, range = This week, group by client, billable-only,
      // rounding off (all the defaults except the name, which we type). Click each control so
      // the build is legible on camera even where it matches the default.
      await page.fill('#rep-name', 'Weekly billables — Acme');
      await wait(page, 400);
      await page.click('#rep-preset-seg .preset[data-preset="week"]');
      await wait(page, 300);
      await page.click('#rep-by-seg .seg-btn[data-by="client"]');
      await wait(page, 300);
      await page.click('#rep-billable-seg .seg-btn[data-billable="billable"]');
      await wait(page, 400);
      await page.waitForSelector('#rep-rounding:not(:checked)');
      await wait(page, 500);

      await page.click('#rep-save');
      await page.waitForSelector('#rep-builder[hidden]', { state: 'attached' });
      await page.waitForSelector('.def[data-name="Weekly billables — Acme"]');
      await wait(page, 900);

      const newCard = page.locator('.def[data-name="Weekly billables — Acme"]');
      await newCard.locator('[data-act="run"]').click();
      await page.waitForSelector('#rep-run:not([hidden])');
      await page.waitForSelector('#rep-run-rows .report-grp');
      await page.waitForSelector('#rep-run-rows .report-flag');
      await wait(page, 1300);

      await page.waitForSelector('#rep-run-export:not([hidden])');
      await page.click('#rep-export-csv');
      await page.waitForFunction(
        () => /Exported/.test(document.querySelector('#rep-export-status')?.textContent || ''),
      );
      await wait(page, 1000);
      await page.click('#rep-export-json');
      await page.waitForFunction(
        () => /\.json/.test(document.querySelector('#rep-export-status')?.textContent || ''),
      );
      await wait(page, 1100);

      // EXPORT ALL DATA (the RAW scope): the whole-record escape hatch set apart at the bottom —
      // standing chrome, no run required (issue #262) → exportEntries with scope 'all' and no
      // ref; its status carries the honest "(all data)" wording so the two scopes read as
      // genuinely different (issue #72 — a filtered report never silently ships raw rows).
      await page.waitForSelector('#rep-run-export-all');
      await page.click('#rep-export-all-csv');
      await page.waitForFunction(
        () => /all data/.test(document.querySelector('#rep-export-all-status')?.textContent || ''),
      );
      await wait(page, 900);
      await page.click('#rep-export-all-json');
      await page.waitForFunction(
        () => /\.json/.test(document.querySelector('#rep-export-all-status')?.textContent || ''),
      );
      await wait(page, 1000);

      await newCard.locator('[data-act="edit"]').click();
      await page.waitForSelector('#rep-builder:not([hidden])');
      await page.waitForFunction(
        () => /Edit/.test(document.querySelector('#rep-builder-title')?.textContent || ''),
      );
      await wait(page, 500);
      await page.click('#rep-by-seg .seg-btn[data-by="project"]');
      await wait(page, 400);
      // Save the amendment → editReport (parity with `tt report edit`); the card's spec summary
      // now reads 'by project' (the specSummary wording the judge REPORTS_VIEW item also asserts).
      await page.click('#rep-save');
      await page.waitForSelector('#rep-builder[hidden]', { state: 'attached' });
      await page.waitForFunction(
        () =>
          /by\s+project/i.test(
            document.querySelector('.def[data-name="Weekly billables — Acme"] .dspec')?.textContent || '',
          ),
      );
      await wait(page, 800);

      await newCard.locator('[data-act="run"]').click();
      await page.waitForSelector('#rep-run:not([hidden])');
      await page.waitForFunction(
        () => /Weekly billables — Acme/.test(document.querySelector('#rep-run-caption')?.textContent || ''),
      );
      await wait(page, 1100);

      await newCard.locator('[data-act="menu"]').click();
      await page.waitForSelector('.def .def-menu');
      await wait(page, 400);
      await page.click('.def-menu [data-act="def-rename"]');
      await page.waitForSelector('#rep-defs .rename-form .rename-input');
      await page.fill('#rep-defs .rename-form .rename-input', 'Weekly billables — Acme (final)');
      await wait(page, 400);
      await page.press('#rep-defs .rename-form .rename-input', 'Enter');
      await page.waitForSelector('.def[data-name="Weekly billables — Acme (final)"]');
      await wait(page, 900);

      const renamedCard = page.locator('.def[data-name="Weekly billables — Acme (final)"]');
      await renamedCard.locator('[data-act="menu"]').click();
      await page.waitForSelector('.def .def-menu');
      await wait(page, 400);
      await page.click('.def-menu [data-act="def-delete"]');
      await page.waitForSelector('[data-act="confirm-report-delete"]');
      await wait(page, 500);
      await page.click('[data-act="confirm-report-delete"]');
      await page.waitForFunction(
        () => !document.querySelector('.def[data-name="Weekly billables — Acme (final)"]'),
      );
      await wait(page, 1200);
    },
  },

  // §12 R08 / §09 R08–R09 — the in-shell Reports view: the saved-definition list paints one
  // card per saved report, and + New report / Edit opens the inline builder. The recording
  // routes to Reports and dwells on the saved-report cards.
  'reports-view': {
    page: 'index.html',
    state: savedReportsState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="reports"]');
      await page.waitForSelector('[data-view="reports"]:not([hidden])');
      await page.waitForSelector('#rep-defs .def');
      await wait(page, 1100);

      await page.click('#rep-new');
      await page.waitForSelector('#rep-builder:not([hidden])');
      await wait(page, 500);
      await page.fill('#rep-name', 'Weekly billables — Acme');
      await wait(page, 400);
      await page.click('#rep-preset-seg .preset[data-preset="week"]');
      await wait(page, 300);
      await page.click('#rep-by-seg .seg-btn[data-by="client"]');
      await wait(page, 300);
      await page.click('#rep-billable-seg .seg-btn[data-billable="billable"]');
      await wait(page, 500);

      await page.click('#rep-save');
      await page.waitForSelector('#rep-builder[hidden]', { state: 'attached' });
      await page.waitForSelector('.def[data-name="Weekly billables — Acme"]');
      await wait(page, 700);

      const newCard = page.locator('.def[data-name="Weekly billables — Acme"]');
      await newCard.locator('[data-act="run"]').click();
      await page.waitForSelector('#rep-run:not([hidden])');
      await page.waitForSelector('#rep-run-rows .report-grp');
      await page.waitForSelector('#rep-run-rows .report-flag');
      await wait(page, 1600);
    },
  },

  // §12 R11 / §14 — the Settings view: a control for every setting, including the
  // date-format picker. The recording routes to Settings and dwells on the panel.
  'settings-view': {
    page: 'index.html',
    state: settingsState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      await wait(page, 1000);
    },
  },

  // §12 R12 / §14 timeline-settings (§W — shared shot) — the Settings → Timeline group (G15)
  // and the default viewport it drives (G16). The recording routes to Settings, dwells on the
  // Timeline group (the paired HH:MM working-hours inputs reading the stored 09:00–15:00, the
  // Picker-window segment, the disabled Around select), then SHOWS the four beats:
  //   1) edit Working hours start (a valid HH:MM persists over the existing setSetting channel
  //      and reads back on the repaint);
  //   2) attempt an INVALID end (06:00 — inverts the start<end pair): the write is REJECTED and
  //      the re-render reverts the field to stored truth on camera (the recipe scopes a
  //      setSetting override that validates exactly as core does, so the mock is as strict as
  //      the real channel — recipe-scoped, no JUDGE behavior touched);
  //   3) flip Picker window → Around now: the Around select ENABLES (row loses 'off') and a
  //      12 h span persists;
  //   4) once §12 R15/R16 land, close on the CONSUMER: the entries calendar / picker opens to
  //      the configured window as a scroll default over the full 24h track, never a clipped
  //      one (guarded on the [data-timeline-track] hook; before the consumer rows land the
  //      recording ends on the Settings beat — re-record in the workflow's last phase).
  // The tt half of this requirement (config set/ls parity) is CLI evidence and lives in the
  // transcript (§W: no GIF for CLI surfaces).
  'timeline-window-settings': {
    page: 'index.html',
    state: timelineWindowState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      await page.waitForSelector('#settings-panel input.set-hhmm[data-key="workingHoursStart"]');
      await page.evaluate(() => {
        window.__recCaption?.('Settings → Timeline: working hours + picker window (§14)');
        document
          .querySelector('#settings-panel input.set-hhmm[data-key="workingHoursStart"]')
          ?.scrollIntoView({ block: 'center' });
      });
      await wait(page, 1400);

      await page.evaluate(() => {
        const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
        window.stint.setSetting = (p) => {
          const s = window.__STATE__.settings;
          const next = { ...s, [p.key]: p.value };
          const bad =
            ((p.key === 'workingHoursStart' || p.key === 'workingHoursEnd') &&
              (!HHMM.test(String(p.value)) || next.workingHoursStart >= next.workingHoursEnd)) ||
            (p.key === 'pickerAroundHours' &&
              !(Number.isInteger(p.value) && p.value >= 1 && p.value <= 24)) ||
            (p.key === 'pickerWindowMode' && p.value !== 'working_hours' && p.value !== 'around_now');
          if (bad) return Promise.reject(new Error('invalid setting value'));
          window.__SET_SETTING__ = p;
          s[p.key] = p.value;
          return Promise.resolve();
        };
      });

      await page.fill('#settings-panel input.set-hhmm[data-key="workingHoursStart"]', '08:00');
      await page.press('#settings-panel input.set-hhmm[data-key="workingHoursStart"]', 'Tab');
      await page.waitForFunction(
        () =>
          window.__SET_SETTING__?.key === 'workingHoursStart' &&
          document.querySelector('#settings-panel input.set-hhmm[data-key="workingHoursStart"]')?.value ===
            '08:00',
      );
      await wait(page, 900);

      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('An inverted pair is rejected — the field reverts to stored truth'),
      );
      await page.fill('#settings-panel input.set-hhmm[data-key="workingHoursEnd"]', '06:00');
      await page.press('#settings-panel input.set-hhmm[data-key="workingHoursEnd"]', 'Tab');
      await page.waitForFunction(
        () =>
          document.querySelector('#settings-panel input.set-hhmm[data-key="workingHoursEnd"]')?.value ===
          '15:00',
      );
      await wait(page, 1100);

      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Picker window → Around now: the Around span enables'),
      );
      await page.click('#settings-panel .set-seg[data-key="pickerWindowMode"] .seg-btn[data-value="around_now"]');
      await page.waitForFunction(() => {
        const around = document.querySelector('#settings-panel select[data-key="pickerAroundHours"]');
        return !!around && !around.disabled;
      });
      await wait(page, 800);
      await page.selectOption('#settings-panel select[data-key="pickerAroundHours"]', '12');
      await page.waitForFunction(() => window.__SET_SETTING__?.key === 'pickerAroundHours');
      await wait(page, 1000);

      await page.click('.nav-item[data-view="entries"]');
      await wait(page, 700);
      const hasTrack = await page.evaluate(() => !!document.querySelector('[data-timeline-track]'));
      if (hasTrack) {
        await page.evaluate(() =>
          window.__recCaption &&
          window.__recCaption('The calendar opens to the configured window — scroll, never clip (G16)'),
        );
        await wait(page, 2000);
      } else {
        await page.click('.nav-item[data-view="settings"]');
        await wait(page, 1100);
      }
    },
  },

  // §19 R03 — In-app update CHECK (G3). The requirement: Settings → Software Update shows the
  // CURRENT VERSION and a "Check for updates" action that QUERIES THE GITHUB RELEASES API and
  // reports up-to-date or a newer version. This recording drives exactly that check half over the
  // real renderer + the GUI-only window.stint.update bridge (the same bridge the SOFTWARE_UPDATE
  // JUDGE scene uses), scoped to the R03 beats so the moving picture maps 1:1 to the requirement:
  //
  //   1) CURRENT VERSION — route to Settings and dwell on the Software Update group's
  //      "Current version" row, which prints the stamped APP_VERSION (2026.6.24 from
  //      UPDATE_FIXTURE — the SAME constant `tt --version` reports) read over
  //      window.stint.update.getVersion(). The "Check for updates" row's subcopy names the source
  //      ("Queries GitHub Releases. Updates never touch the database.") — the R03 contract on screen.
  //   2) CHECK NOW (query GitHub Releases) — click #update-check. The renderer fires
  //      window.stint.update.check(), the canned-but-faithful bridge resolves the verdict the live
  //      GitHub Releases query would (status 'update-available', latest 2026.7.1, the release URL),
  //      and the result line + pill repaint "Update available · 2026.7.1" with the release link.
  //      To PROVE the check actually queried the bridge (not a static label), the recipe reads the
  //      window.__CHECKED__ flag the injected check() sets and stamps it into an on-page badge
  //      ("update.check() -> GitHub Releases  CALLED ✓ / verdict: update-available · 2026.7.1"),
  //      legible on camera. The release link (data-update-link) is highlighted so the "newer
  //      version" verdict is unmistakable.
  //
  // This is the CHECK twin of the broader 'software-update' recipe (which also walks the R04
  // download/install panel); §19 R03 is the check action specifically, so this scene stops at the
  // verdict. Presentation-only: the badge is scoped to this recording page (no renderer/CSP
  // change); the version row, the Check-now button, and the verdict all run over the unmodified
  // settings.js + the same window.stint.update.* bridge the JUDGE SOFTWARE_UPDATE item gates.
  '§19 R03': {
    page: 'index.html',
    state: emptyState,
    initOpts: { update: UPDATE_FIXTURE },
    drive: async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      await page.waitForSelector('#update-check');
      await page.waitForFunction(
        () => /2026\.6\.24/.test(document.querySelector('.set-row .ver')?.textContent || ''),
      );
      await page.evaluate(() => document.querySelector('#update-check')?.scrollIntoView({ block: 'center' }));
      await wait(page, 1100);

      await page.click('#update-check');
      await page.waitForSelector('#update-status .update-result.new');
      await page.waitForFunction(
        () => /2026\.7\.1/.test(document.querySelector('#update-status')?.textContent || ''),
      );
      await page.evaluate(() => {
        const v = window.__UPDATE__?.verdict || {};
        const b = document.createElement('div');
        b.id = '__rec_badge__';
        b.style.cssText =
          'position:fixed;top:8px;right:8px;z-index:99999;font:12px/1.5 ui-monospace,monospace;' +
          'background:rgba(20,20,20,.88);color:#fff;padding:8px 11px;border-radius:6px;' +
          'pointer-events:none;white-space:pre;';
        b.textContent =
          `current version       ${v.currentVersion || '—'}\n` +
          `update.check() -> GitHub Releases  ${window.__CHECKED__ ? 'CALLED ✓' : 'not called'}\n` +
          `verdict: ${v.status || '—'} · ${v.latestVersion || '—'}`;
        document.body.appendChild(b);
        const link = document.querySelector('#update-status a[data-update-link]');
        if (link) link.style.outline = '2px solid #2f6fed';
      });
      await wait(page, 1900);
    },
  },

  // §19 R03/R04/R06 — the Settings → Software Update group, driven over the GUI-only update
  // bridge: the current-version row, Check now → update-available, then Download & install →
  // progress → Reveal installer. The recording routes to Settings and walks the update flow.
  'software-update': {
    page: 'index.html',
    state: emptyState,
    initOpts: { update: UPDATE_FIXTURE },
    drive: async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      await wait(page, 400);
      if (await page.$('#update-check')) {
        await page.click('#update-check');
        await wait(page, 600);
      }
      if (await page.$('#update-download')) {
        await page.click('#update-download');
        await page.waitForSelector('#update-reveal', { state: 'attached' }).catch(() => {});
        await wait(page, 600);
      }
    },
  },

  // §19 R04 — In-app update: DOWNLOAD + GUIDED INSTALL (G3). The req-scoped recording (its own
  // <reqId>.webm, distinct from the broader 'software-update' scene) walks the part of the flow
  // R04 owns: AFTER a check has surfaced a newer release, the user clicks "Download & install",
  // the artifact downloads (the progress bar advances over onUpdateProgress frames the
  // UPDATE_FIXTURE replays — a mid-download 'downloading' frame then the terminal 'ready'
  // frame), the numbered GUIDED STEPS render (download → replace the app in /Applications →
  // approve once at first launch, the one-time Gatekeeper beat with NO Developer ID /
  // notarization dependency), the "Updates never touch the database — the artifact downloads to
  // a temp folder" note stays visible (R04's no-DB-touch guarantee), and the action resolves to
  // "Reveal installer" pointing at the downloaded .pkg so the user can replace the app. Same
  // GUI-only update bridge + pinned JUDGE_NOW clock as the JUDGE SOFTWARE_UPDATE scene, so the
  // recording demonstrates the same contract as a moving picture.
  '§19 R04': {
    page: 'index.html',
    state: emptyState,
    initOpts: { update: UPDATE_FIXTURE },
    drive: async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      await wait(page, 500);

      await page.waitForSelector('#update-check');
      await page.click('#update-check');
      await page.waitForSelector('#update-download', { state: 'attached' });
      await wait(page, 900);

      await page.click('#update-download');
      await wait(page, 1100);

      await page.waitForSelector('#update-reveal', { state: 'attached' });
      await wait(page, 1200);

      await page.evaluate(() => {
        const note = document.querySelector('.restore-note');
        if (note) note.scrollIntoView({ block: 'center' });
      });
      await wait(page, 1300);
    },
  },

  // §20 R04 — automatic backups + retention + restore, the Settings → Backups surface (G3/§17 R12).
  // The recording routes to Settings, dwells on the Backups group the way the requirement reads it:
  // the "Last backup" status + "verified" pill (off state.lastBackupUtc), the retention picker, and
  // the restore list painted from window.stint.listBackups() (one row per backup: name · time ·
  // size). It then CHANGES the retention picker (last 5 → last 10, persisted over the same
  // setSetting channel `tt config set backup_retention` uses) and drives a RESTORE end to end
  // through the §12 R13 destructive-action confirm gate: clicking Restore… ARMS the inline confirm
  // (restoreBackup not yet called), then the explicit Restore confirm fires
  // window.stint.restoreBackup({name}). To SHOW the restore land, a scoped restoreBackup override
  // (mirroring §05 R02's toggle override) stamps a fresh "Last backup" + recovery-free state and
  // re-renders, so the post-restore panel repaints on camera. The override is scoped to THIS page
  // only — no shared fixture or JUDGE scene is touched.
  '§20 R04': {
    page: 'index.html',
    state: backupsState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      await page.waitForSelector('#backups-panel .set-grp');
      await page.waitForSelector('#backups-panel .backup-item');
      await page.evaluate(() =>
        document.querySelector('#backups-panel .set-grp')?.scrollIntoView({ block: 'center' }),
      );
      await wait(page, 1300);

      await page.selectOption('#backups-panel select[data-key="backupRetention"]', '10');
      await page.waitForFunction(() => window.__SET_SETTING__?.key === 'backupRetention');
      await wait(page, 900);

      await page.evaluate(() => {
        const now = window.__JUDGE_NOW__;
        window.stint.restoreBackup = (p) => {
          window.__RESTORED_BACKUP__ = p;
          window.__STATE__.lastBackupUtc = now;
          window.__STATE__.recoveryNotice = null;
          return Promise.resolve({ recoveredFrom: (p && p.name) || '', quarantinedTo: '/db/timetracker.sqlite.replaced' });
        };
      });

      await page.click('#backups-panel .backup-item .backup-restore');
      await page.waitForSelector('#backups-panel .confirm-restore');
      await wait(page, 900);
      await page.click('#backups-panel [data-act="confirm-restore"]');
      await page.waitForFunction(() => !!window.__RESTORED_BACKUP__);
      await page.waitForSelector('#backups-panel .backup-item');
      await wait(page, 1400);
    },
  },

  // §20 R05 — corruption recovery NOTICE, the Settings → Backups surface (G3/§17 R12). On a launch
  // where the database was recovered from a backup (the recoveryState snapshot carries a non-null
  // recoveryNotice), the recording routes to Settings and dwells on the one-shot recovery BANNER —
  // it names the backup it recovered from AND the `.corrupted` file it set aside (recoveredFrom +
  // quarantinedTo). Then, to SHOW the surface is actionable, it drives a RESTORE from the list
  // through the §12 R13 confirm gate (arm → confirm → window.stint.restoreBackup), with the same
  // scoped restoreBackup override §20 R04 uses so the post-restore repaint clears the notice on
  // camera (recovered, then the user restored a chosen good backup). Override scoped to THIS page.
  '§20 R05': {
    page: 'index.html',
    state: recoveryState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      await page.waitForSelector('#backups-panel #recovery-notice');
      await page.evaluate(() =>
        document.querySelector('#backups-panel #recovery-notice')?.scrollIntoView({ block: 'center' }),
      );
      await wait(page, 1600);

      await page.evaluate(() => {
        const now = window.__JUDGE_NOW__;
        window.stint.restoreBackup = (p) => {
          window.__RESTORED_BACKUP__ = p;
          window.__STATE__.lastBackupUtc = now;
          window.__STATE__.recoveryNotice = null;
          return Promise.resolve({ recoveredFrom: (p && p.name) || '', quarantinedTo: '/db/timetracker.sqlite.replaced' });
        };
      });

      await page.waitForSelector('#backups-panel .backup-item .backup-restore');
      await page.click('#backups-panel .backup-item .backup-restore');
      await page.waitForSelector('#backups-panel .confirm-restore');
      await wait(page, 900);
      await page.click('#backups-panel [data-act="confirm-restore"]');
      await page.waitForFunction(() => !!window.__RESTORED_BACKUP__);
      await page.waitForSelector('#backups-panel #recovery-notice', { state: 'detached' }).catch(() => {});
      await wait(page, 1400);
    },
  },

  // §12 R03 (G7) — Window shell & navigation: the sidebar is present in EVERY view and stays a
  // FIXED width on resize. The recording opens the window on Entries (the default view) and
  // clicks each nav item in turn (Timer → Entries → Clients → Reports → Settings), showing the
  // left rail staying put and the active highlight (the sanctioned accent-wash on
  // .nav-item.active) MOVING from item to item — including Reports, which is now IN-SHELL (the
  // standalone report.html is retired, §12 R08), so no view escapes the shell. Then it grabs the
  // window edge — Playwright setViewportSize, which resizes the captured recordVideo frame —
  // and resizes WIDE (1920px) then back to the 1040px minimum. styles.css pins `.shell .nav` to a
  // 168px flex-none basis and lets `.views { flex: 1; min-width: 0 }` absorb all resize, so the
  // recording SHOWS the sidebar holding a constant width while only the content area reflows.
  // To make the constant width legible on camera (a still frame can't show "it didn't move"),
  // the recipe stamps the live measured `.shell .nav` width into a small on-page badge before
  // and after each resize — it reads a byte-identical 168 at every viewport (the same fact the
  // JUDGE NAV_SHELL FIXED_WIDTH_ON_RESIZE sub-fact gates on, here shown as moving picture).
  '§12 R03': {
    page: 'index.html',
    state: runningState,
    drive: async (page) => {
      await page.evaluate(() => {
        const b = document.createElement('div');
        b.id = '__rec_badge__';
        b.style.cssText =
          'position:fixed;top:8px;right:8px;z-index:99999;font:12px/1.4 ui-monospace,monospace;' +
          'background:rgba(20,20,20,.85);color:#fff;padding:6px 9px;border-radius:6px;' +
          'pointer-events:none;white-space:pre;';
        document.body.appendChild(b);
        window.__recBadge__ = () => {
          const nav = document.querySelector('.shell .nav');
          const w = nav ? Math.round(nav.getBoundingClientRect().width) : 0;
          b.textContent = `viewport ${window.innerWidth}px\nsidebar  ${w}px (fixed)`;
        };
        window.__recBadge__();
      });

      for (const view of ['timer', 'entries', 'clients', 'reports', 'settings']) {
        await page.click(`.nav-item[data-view="${view}"]`);
        await page.waitForSelector(`.view[data-view="${view}"]:not([hidden])`);
        await page.waitForSelector(`.shell .nav .nav-item[data-view="${view}"].active`);
        await page.evaluate(() => window.__recBadge__());
        await wait(page, 650);
      }

      await page.click('.nav-item[data-view="reports"]');
      await page.waitForSelector('.view[data-view="reports"]:not([hidden])');
      await page.evaluate(() => window.__recBadge__());
      await wait(page, 500);

      for (const w of [1300, 1600, 1920]) {
        await page.setViewportSize({ width: w, height: WINDOW.height });
        await page.evaluate(() => window.__recBadge__());
        await wait(page, 550);
      }
      await wait(page, 700);

      for (const w of [1600, 1300, WINDOW.width]) {
        await page.setViewportSize({ width: w, height: WINDOW.height });
        await page.evaluate(() => window.__recBadge__());
        await wait(page, 550);
      }
      await wait(page, 800);

      for (const view of ['timer', 'reports', 'settings', 'entries']) {
        await page.click(`.nav-item[data-view="${view}"]`);
        await page.waitForSelector(`.shell .nav .nav-item[data-view="${view}"].active`);
        await page.evaluate(() => window.__recBadge__());
        await wait(page, 500);
      }
      await wait(page, 600);
    },
  },

  // §12 R04 — the Active-Timer panel's PLACEMENT contract: the FULL panel moved INTO the Timer
  // view (R14) while the Entries view keeps only a COMPACT STRIP of the same running timer. The
  // recording proves the one-running-timer-shown-two-ways relationship by exercising the move on
  // camera over the canonical runningState ('auth refactor' open row, deterministic 01:24:07):
  //
  //   1) Open on the Entries view (the GUI default, route('entries')) and dwell on the compact
  //      strip (#timer-strip) — it mirrors the running count-up (#strip-clock), the running dot +
  //      state (#strip-state → 'running', .timer-strip.running accent), and the running entry's
  //      description (#strip-desc → 'auth refactor'). The strip carries NO Stop control and NO
  //      flags grid (those are the full panel's). Advancing the pinned clock makes the strip's
  //      count-up visibly TICK, proving it's the live running timer (not a static label).
  //   2) Click the strip itself (it's a button → app.js route('timer')) to navigate to the Timer
  //      view, where the FULL Active-Timer panel paints from the SAME running snapshot: the large
  //      live count-up (#timer-clock), the running state (#timer-state), the description
  //      (#timer-desc → 'auth refactor') + client/project label (#timer-meta → 'Client A / API')
  //      + flags (#timer-flags), and the primary action Stop (#timer-stop) — with NO Switch
  //      control (Switch is removed, issue #34). Advancing the clock again makes the count-up tick.
  //   3) Route back to Entries (via the nav rail) so the recording ENDS showing the same running
  //      timer still represented as the compact strip — demonstrating the panel lives in Timer
  //      while Entries keeps the strip, the two staying in sync off one snapshot.
  //
  // No fixture/override surgery is needed: R04 is pure placement/routing (presentation-only, no
  // IPC), so the unmodified runningState + the real renderer's route()/renderTimerStrip()/
  // renderTimerCard() carry the whole demonstration. The pinned JUDGE_NOW clock keeps both the
  // strip's and the panel's count-ups deterministic; pauseAt steps advance them on camera.
  '§12 R04': {
    page: 'index.html',
    state: runningState,
    drive: async (page) => {
      await page.waitForSelector('.view[data-view="entries"]:not([hidden])');
      await page.waitForSelector('#timer-strip.running');
      await page.waitForFunction(
        () => document.querySelector('#strip-desc')?.textContent?.trim() === 'auth refactor',
      );
      await wait(page, 700);
      for (let i = 1; i <= 3; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 350);
      }
      await wait(page, 500);

      await page.click('#timer-strip');
      await page.waitForSelector('.view[data-view="timer"]:not([hidden]) #timer-card.running');
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'auth refactor',
      );
      await page.waitForSelector('#timer-stop:not([hidden])');
      await page.waitForSelector('#timer-pin:not([hidden])');
      await page.waitForFunction(() => !document.querySelector('#timer-switch'));
      await wait(page, 700);
      for (let i = 4; i <= 6; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 350);
      }
      for (const sel of ['#timer-stop', '#timer-pin']) {
        const box = await page.locator(sel).first().boundingBox();
        if (box) {
          await page.mouse.move(
            Math.round(box.x + box.width / 2),
            Math.round(box.y + box.height / 2),
            { steps: 16 },
          );
          await wait(page, 800);
        }
      }
      await wait(page, 400);

      await page.click('.nav-item[data-view="entries"]');
      await page.waitForSelector('.view[data-view="entries"]:not([hidden]) #timer-strip.running');
      await page.waitForFunction(
        () => document.querySelector('#strip-desc')?.textContent?.trim() === 'auth refactor',
      );
      await wait(page, 1000);
    },
  },

  // §12 R04 / issue #50 — CROSS-VIEW FRESHNESS: the Active-Timer card mirrors `tt status`
  // even after an Entries-toolbar control has been touched (the regression path: pre-fix,
  // a used filter latched the renderer's entries-query flag and starved every later load()
  // of its repaint, so Start clicks mutated the DB while the card stayed frozen on idle).
  // The recording drives the exact reported path over the idle list fixture: touch the week
  // machinery on the Entries toolbar — the range presets that used to stand in for "a toolbar
  // control was touched" retired with the week-only view, so stepping to the previous week
  // latches the toolbar's entries-only query exactly as a preset did, which is also what the
  // CROSS_VIEW_FRESHNESS judge scene now drives — route to the
  // Timer view (the card reads idle / 00:00:00 / Start), click Start — the toggle mock mutates
  // the snapshot like main's toggleTimer over core (toggleStarts) — and the card flips to
  // running ON CAMERA without any reload: state 'running', the primary reads Stop, and the
  // fresh count-up visibly ticks up from 00:00:00 as the pinned clock steps. The JUDGE
  // CROSS_VIEW_FRESHNESS scene gates the same facts; this recording is its moving evidence.
  'cross-view-freshness': {
    page: 'index.html',
    state: listState,
    initOpts: { toggleStarts: true },
    drive: async (page) => {
      await page.waitForSelector('.view[data-view="entries"]:not([hidden]) #el-prev-week');
      await wait(page, 600);
      await page.click('#el-prev-week');
      await page.waitForFunction(() => window.__LIST_REQ__?.fromDate === '2026-06-15');
      await wait(page, 700);
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('.view[data-view="timer"]:not([hidden]) #timer-card.idle');
      await wait(page, 800);
      await page.click('#toggle');
      await page.waitForSelector('#timer-card.running');
      await page.waitForFunction(
        () => document.querySelector('#timer-state')?.textContent?.trim() === 'running',
      );
      await wait(page, 500);
      for (let i = 1; i <= 3; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 350);
      }
      await wait(page, 1000);
    },
  },

  // §12 R01 — the tray popover while running: Stop + Open Stint ONLY, no Switch button (issue
  // #34 — Switch is removed; the popover does not host a quick-start/favorites list either, G4).
  // The recording drives the REAL popover renderer (popover.html) over the canonical runningState
  // (the 'auth refactor' open row, deterministic 01:24:07): it dwells on the running popover —
  // the Stop/Start toggle reads 'Stop' (the running state), the Open Stint link is present, and
  // there is NO #switch element — and steps the pinned clock so the popover count-up visibly TICKS
  // (proving it's the live timer). Then it confirms, on camera, that the popover surface carries
  // exactly Stop + Open Stint and nothing labelled Switch. Presentation/routing only; the popover
  // runs over the same window.stint mock the JUDGE TRAY_POPOVER_SURFACE scene drives.
  '§12 R01': {
    page: 'popover.html',
    state: runningState,
    drive: async (page) => {
      await page.waitForFunction(
        () => document.querySelector('#toggle')?.textContent?.trim() === 'Stop',
      );
      await page.waitForSelector('#open');
      await page.waitForFunction(() => !document.querySelector('#switch'));
      await wait(page, 800);
      for (let i = 1; i <= 3; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 350);
      }
      await page.waitForFunction(() => !document.querySelector('#switch'));
      await wait(page, 1000);
    },
  },

  // The persistent left-nav shell (§12 R3) routing through all five views — a tour recording
  // showing the whole window is reachable from one rail.
  'nav-shell': {
    page: 'index.html',
    state: runningState,
    drive: async (page) => {
      for (const view of ['timer', 'entries', 'clients', 'reports', 'settings']) {
        await page.click(`.nav-item[data-view="${view}"]`);
        await page.waitForSelector(`.view[data-view="${view}"]:not([hidden])`);
        await wait(page, 600);
      }
    },
  },

  // D12 / V7 (design.html) — SELECTION IS NEVER THE ACCENT FILL. This close-up drives the five
  // rail items in sequence, hovering each one before clicking it, so the changed idiom is seen
  // MOVING between items: hover is a quiet neutral wash on a still-flat row, while the ACTIVE row
  // is a LIFTED PAPER CHIP — it rises onto var(--paper) with the sub-card chip shadow
  // (var(--sh-chip)), keeps an INK label, and gives the accent to its ICON only. That last split
  // is the point of the rule: accent-ink on an accent-weak fill is a prohibited pair (4.33:1,
  // below the text floor), so the retired accent-weak marker behind the whole row could never
  // carry an accent label. V7 resolved the mock-vs-impl divergence to NEITHER prior marker — the
  // raised-chip idiom is new to both surfaces, and this is the first recording of it.
  //
  // The recording is self-evidencing twice over. A small on-page badge (presentation-only, the
  // same device §12 R03 uses for the sidebar width) echoes the LIVE computed chip/lift/label/icon
  // values of whichever item is active, so the idiom reads as VALUES on camera and not merely as
  // a picture; and the recipe ASSERTS those same four facts per item against the resolved tokens
  // (paper chip, non-`none` shadow, ink — never accent — label, accent icon). A regression to a
  // flat accent-weak marker therefore FAILS the recording rather than quietly re-recording the
  // retired look. The fixture is the canonical runningState so every view has content to route to.
  'D12': {
    page: 'index.html',
    state: runningState,
    drive: async (page) => {
      await page.waitForSelector('.shell .nav .nav-item.active');

      await page.evaluate(() => {
        const b = document.createElement('div');
        b.id = '__rec_badge__';
        b.style.cssText =
          'position:fixed;top:8px;right:8px;z-index:99999;font:11px/1.5 ui-monospace,monospace;' +
          'background:rgba(20,20,20,.85);color:#fff;padding:6px 9px;border-radius:6px;' +
          'pointer-events:none;white-space:pre;';
        document.body.appendChild(b);
        window.__recBadge__ = () => {
          const el = document.querySelector('.shell .nav .nav-item.active');
          if (!el) {
            b.textContent = 'active nav item  (none)';
            return;
          }
          const cs = getComputedStyle(el);
          const ic = el.querySelector('.ic');
          b.textContent =
            `active  ${el.dataset.view}\n` +
            `chip    ${cs.backgroundColor}\n` +
            `lift    ${cs.boxShadow.replace(/\s+/g, ' ')}\n` +
            `label   ${cs.color}\n` +
            `icon    ${ic ? getComputedStyle(ic).color : '—'}`;
        };
        window.__recBadge__();
      });

      // Read the active item's four D12 facts, resolved against the live tokens (a probe element
      // turns `var(--x)` into the same computed rgb() form getComputedStyle returns, so the
      // comparison is token-vs-token — never a hardcoded hex in the apparatus).
      const chipFacts = (view) =>
        page.evaluate((v) => {
          const resolve = (name) => {
            const p = document.createElement('span');
            p.style.color = `var(${name})`;
            document.body.appendChild(p);
            const c = getComputedStyle(p).color;
            p.remove();
            return c;
          };
          const el = document.querySelector(`.shell .nav .nav-item[data-view="${v}"]`);
          const cs = getComputedStyle(el);
          const ic = el.querySelector('.ic');
          return {
            active: el.classList.contains('active'),
            bg: cs.backgroundColor,
            shadow: cs.boxShadow,
            label: cs.color,
            icon: ic ? getComputedStyle(ic).color : '',
            paper: resolve('--paper'),
            accent: resolve('--accent'),
            ink: resolve('--ink'),
          };
        }, view);

      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Nav selection is a lifted paper chip — never an accent fill (D12 / V7)'));
      await wait(page, 1200);

      // Walk every rail item. Entries is already active on load, so visiting the other four and
      // returning to Entries shows the chip land on all five.
      for (const view of ['timer', 'clients', 'reports', 'settings', 'entries']) {
        const box = await page.locator(`.nav-item[data-view="${view}"]`).first().boundingBox();
        if (box) {
          await page.mouse.move(
            Math.round(box.x + box.width / 2),
            Math.round(box.y + box.height / 2),
            { steps: 16 },
          );
          await wait(page, 420);
        }
        await page.click(`.nav-item[data-view="${view}"]`);
        await page.waitForSelector(`.view[data-view="${view}"]:not([hidden])`);
        await page.waitForSelector(`.shell .nav .nav-item[data-view="${view}"].active`);
        await page.evaluate(() => window.__recBadge__());

        const f = await chipFacts(view);
        if (f.bg !== f.paper) {
          throw new Error(`D12: active ${view} chip is ${f.bg}, expected the paper fill ${f.paper}`);
        }
        if (!f.shadow || f.shadow === 'none') {
          throw new Error(`D12: active ${view} has no chip lift (box-shadow: ${f.shadow})`);
        }
        if (f.label !== f.ink) {
          throw new Error(`D12: active ${view} label is ${f.label}, expected ink ${f.ink}`);
        }
        if (f.icon !== f.accent) {
          throw new Error(`D12: active ${view} icon is ${f.icon}, expected accent ${f.accent}`);
        }
        await wait(page, 560);
      }

      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Paper chip + lift, ink label, accent icon — the same idiom in every view'));
      await wait(page, 1600);
    },
  },

  // §12 R-report.html (G7) — the standalone, SIDEBAR-LESS `report.html` page is REMOVED; its
  // function folds into the in-sidebar Reports view (§12 R08). A deletion has no positive UI of
  // its own, so this recording proves BOTH halves of the requirement on camera:
  //
  //   1) THE RETIREMENT. The renderer no longer ships report.html/report.js. The recipe reads
  //      that fact straight off disk (existsSync over the renderer dir — the same dir the real
  //      app and every other recipe load from) and stamps the result into an on-page badge:
  //      "renderer/report.html  ABSENT (retired)". Then it actually NAVIGATES the window to the
  //      old standalone file:// URL and shows the browser FAILS to load it (no such file) — the
  //      sidebar-less page is genuinely gone, not merely unlinked.
  //   2) THE FOLD-IN. It returns to the in-shell window (index.html) and routes to Reports via
  //      the sidebar — proving the report function now lives INSIDE the shell with the rail
  //      present (the very thing the retired page lacked). The saved-definition list paints, one
  //      card is RUN (the on-screen grouped summary appears), and CSV export fires — i.e. the
  //      whole reporting job the standalone page used to do is reachable in-sidebar. The left
  //      nav stays visible the entire time, the contrast the deletion is about.
  //
  // Presentation-only: the disk check + badge are scoped to this recording page (no renderer/
  // CSP change); all report behavior runs over the real reportview/reports.js + the same
  // window.stint.* channels tt uses. savedReportsState seeds the saved-definition list.
  '§12 R-report.html': {
    page: 'index.html',
    state: savedReportsState,
    drive: async (page) => {
      const standaloneAbsent = !existsSync(join(RENDERER, 'report.html'));
      const reportJsAbsent = !existsSync(join(RENDERER, 'report.js'));
      await page.evaluate(
        ([htmlGone, jsGone]) => {
          const b = document.createElement('div');
          b.id = '__rec_badge__';
          b.style.cssText =
            'position:fixed;top:8px;right:8px;z-index:99999;font:12px/1.5 ui-monospace,monospace;' +
            'background:rgba(20,20,20,.88);color:#fff;padding:8px 11px;border-radius:6px;' +
            'pointer-events:none;white-space:pre;';
          b.textContent =
            `renderer/report.html  ${htmlGone ? 'ABSENT (retired)' : 'present'}\n` +
            `renderer/report.js    ${jsGone ? 'ABSENT (retired)' : 'present'}\n` +
            `Reports -> in-sidebar shell`;
          document.body.appendChild(b);
        },
        [standaloneAbsent, reportJsAbsent],
      );
      await page.waitForSelector('.shell .nav');
      await wait(page, 1300);

      const standaloneUrl = 'file://' + join(RENDERER, 'report.html');
      try {
        await page.goto(standaloneUrl, { waitUntil: 'load', timeout: 4000 });
      } catch {
        // Expected: ERR_FILE_NOT_FOUND — the standalone page no longer exists.
      }
      await wait(page, 1200);

      await page.goto(fileUrl('index.html'), { waitUntil: 'load' });
      await page.waitForSelector('.shell .nav');
      await page.click('.nav-item[data-view="reports"]');
      await page.waitForSelector('.view[data-view="reports"]:not([hidden])');
      await page.waitForSelector('.shell .nav .nav-item[data-view="reports"].active');
      await page.waitForSelector('#rep-defs .def');
      await wait(page, 1200);

      const firstCard = page.locator('#rep-defs .def').first();
      await firstCard.locator('[data-act="run"]').click();
      await page.waitForSelector('#rep-run:not([hidden])');
      await page.waitForSelector('#rep-run-rows .report-grp');
      await wait(page, 1300);

      await page.waitForSelector('#rep-run-export:not([hidden])');
      await page.click('#rep-export-csv');
      await page.waitForFunction(
        () => /Exported/.test(document.querySelector('#rep-export-status')?.textContent || ''),
      );
      await page.waitForSelector('.shell .nav .nav-item[data-view="reports"].active');
      await wait(page, 1300);
    },
  },
};

/** The popover window size the shipped auto-size gives this recipe's fixture (§12 R22). */
async function measuredPopoverViewport(browser, recipe) {
  const page = await browser.newPage({ viewport: POPOVER, colorScheme: 'light' });
  await page.addInitScript(initScript(JSON.stringify(recipe.state()), recipe.initOpts ?? {}));
  await page.goto(fileUrl(recipe.page));
  const card = await page.evaluate(() => {
    const c = document.getElementById('pop');
    return { width: c.offsetWidth, height: c.offsetHeight };
  });
  await page.close();
  return popoverWindowSize(card);
}

/**
 * Drive one recipe inside a Playwright context that has recordVideo enabled, then move the
 * produced .webm to acceptance/evidence/recordings/<reqId>.webm. Returns the saved path on
 * success; throws when no recording survives (we never fabricate a file). A no-video()-handle
 * throw carries `noVideoHandle: true` — the only failure that proves the HOST cannot record —
 * and is what the caller escalates to the explicit missing-capability report.
 */
async function recordRecipe(browser, reqId, recipe) {
  // Per-recipe, per-RUN staging dir: per-recipe so Playwright's auto-named .webm cannot collide
  // between recipes; per-run (mkdtemp's random suffix) so a concurrent record.mjs can never
  // share — or delete — an in-flight directory (issue #250: the old fixed .stage-<slug> path
  // let a second run rmSync the first run's directory mid-mux, which then read as a capability
  // gap). We rename the single produced file to <ascii-slug>.webm afterward. The prefix is
  // ASCII-slugged (the §-prefixed reqId is not filesystem-clean) and matches the .gitignore
  // .stage-* rule.
  const stage = mkdtempSync(join(RECORDINGS, `.stage-${asciiSlug(reqId)}-`));

  // A recipe may pin a timezone (e.g. the §05 R05 picker scene needs a UTC page so its seeded
  // other-entries land on the column day) or sweep the viewport, but it starts at the geometry of
  // the window it is recording — main or popover; the recordVideo size tracks the viewport so the
  // whole window is captured.
  // A popover recipe records at the window main.ts's auto-size would give it (§12 R22), measured
  // off a throwaway page first because the recordVideo frame is fixed at context creation.
  const viewport =
    recipe.contextOpts?.viewport ??
    (recipe.page === 'popover.html' ? await measuredPopoverViewport(browser, recipe) : WINDOW);
  const context = await browser.newContext({
    viewport,
    colorScheme: 'light',
    ...(recipe.contextOpts?.timezoneId ? { timezoneId: recipe.contextOpts.timezoneId } : {}),
    recordVideo: { dir: stage, size: viewport },
  });
  const page = await context.newPage();
  // Same pinned clock as JUDGE so derived count-ups and any time-of-day chrome are
  // reproducible; the count-up only advances on explicit pauseAt/fastForward in a recipe.
  await page.clock.install({ time: new Date(JUDGE_NOW) });
  await page.clock.pauseAt(new Date(JUDGE_NOW));
  const state = recipe.state();
  // The window.stint mock + canned fixture (the SAME initScript the JUDGE harness injects)…
  await page.addInitScript(initScript(JSON.stringify(state), recipe.initOpts ?? {}));
  // …plus the recording-only VISIBLE-INTERACTION layer (synthetic cursor / click pulse /
  // highlight / caption). JUDGE never loads this — only the recording entry point does — so no
  // judge behavior or selector is touched. Decorate the page so high-level clicks/fills travel
  // the cursor and pause around each action, making every interaction legible on camera.
  await page.addInitScript(VISIBLE_CURSOR_INIT);
  decoratePage(page);
  await page.goto(fileUrl(recipe.page));
  await recipe.drive(page);

  const video = page.video();
  // Close the page+context so Playwright finalizes (flushes + muxes) the .webm.
  await page.close();
  await context.close();

  // Three distinguishable failures, diagnosed by what each one actually proves (issue #250):
  // no video() handle and video.path() throwing are evidence about the HOST; a muxed file that
  // is then gone or empty is evidence about the FILESYSTEM (something removed or truncated it
  // after recording worked) and must not be reported in the capability register — an agent that
  // reads "capability is missing" correctly stops retrying, and a serial retry would succeed.
  if (!video) {
    rmSync(stage, { recursive: true, force: true });
    // The only branch that implicates the host outright — main()'s global MISSING-CAPABILITY
    // verdict keys on this marker.
    const err = new Error(
      'Playwright produced no video() handle — this Chromium build cannot record.',
    );
    err.noVideoHandle = true;
    throw err;
  }
  let produced;
  try {
    produced = await video.path();
  } catch (err) {
    rmSync(stage, { recursive: true, force: true });
    throw new Error(`video.path() failed — no recording was muxed: ${err.message}`);
  }
  if (!produced || !existsSync(produced) || statSync(produced).size === 0) {
    const seen = !produced
      ? 'video.path() returned no path'
      : !existsSync(produced)
        ? `the file at ${produced} no longer exists`
        : `the file at ${produced} is empty`;
    rmSync(stage, { recursive: true, force: true });
    throw new Error(
      `recording finished but ${seen} — possibly removed by a concurrent process on this ` +
        'host, NOT proof that recording capability is missing; retry serially.',
    );
  }
  // Stage the .webm under an ASCII-safe name (the .webm itself is git-ignored — the GIF is the
  // committed deliverable, embedded inline in the PR).
  const slug = asciiSlug(reqId);
  const webmOut = join(RECORDINGS, `${slug}.webm`);
  rmSync(webmOut, { force: true });
  renameSync(produced, webmOut);
  rmSync(stage, { recursive: true, force: true });
  const webmBytes = statSync(webmOut).size;

  // Convert to the committed ASCII-named GIF (two-pass palette, ~0.5x, 1.5s end hold). If ffmpeg
  // is unavailable, keep the .webm and report the gap honestly — never ship a faked GIF.
  const gap = ffmpegGap();
  if (gap) {
    return { webm: webmOut, webmBytes, gif: null, gifBytes: 0, gifGap: gap };
  }
  const gifOut = join(RECORDINGS, `${slug}.gif`);
  rmSync(gifOut, { force: true });
  const gif = convertToGif(webmOut, gifOut);
  return { webm: webmOut, webmBytes, gif: gifOut, gifBytes: gif.bytes, gifRung: gif.rung, gifGap: null };
}

// The recorder lock. Constraint: the final <slug>.webm/<slug>.gif names are deliberately
// stable — the recordings index (README.md) cites them — so per-run staging alone cannot make
// concurrent runs safe: two recorders would still interleave their writes into ONE output set
// (issue #250). The lock keeps recorders to one per host at a time. It holds the owner's pid;
// a lock whose pid is dead is stale (a crashed recorder must not brick the next run) and is
// reclaimed via an atomic rename, so exactly one waiting contender wins it.
const LOCK = join(RECORDINGS, '.lock');

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: no such process. Anything else (EPERM) means SOME live process owns the pid.
    return err.code !== 'ESRCH';
  }
}

function acquireRecorderLock() {
  const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  // Two passes: the first may find a stale lock and reclaim it; the second either wins the
  // recreate or finds the live winner of the reclaim race and reports it.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(LOCK, payload, { flag: 'wx' });
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let holder = null;
    try {
      holder = JSON.parse(readFileSync(LOCK, 'utf8'));
    } catch {
      // Unreadable or garbage lock: a crashed or interrupted writer left it — treat as stale.
    }
    if (holder && Number.isInteger(holder.pid) && pidAlive(holder.pid)) {
      console.error(
        `CONCURRENT RUN: another record.mjs (pid ${holder.pid}, started ${holder.startedAt}) ` +
          `holds ${LOCK}. Recordings write stable output names, so two recorders on one host ` +
          'would interleave one output set. This is NOT a missing capability — re-run after ' +
          'the other recorder finishes.',
      );
      process.exit(1);
    }
    // Stale: rename-then-remove so only one contender reclaims it; a loser's rename throws
    // (the file is gone) and it falls through to race for the recreate above.
    const grave = `${LOCK}.stale-${process.pid}`;
    try {
      renameSync(LOCK, grave);
      rmSync(grave, { force: true });
    } catch {
      // Another contender reclaimed it first; retry the acquire.
    }
  }
  console.error(`could not acquire ${LOCK}: it kept reappearing while stale — retry.`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    for (const id of Object.keys(RECIPES)) console.log(id);
    return;
  }
  const requested = argv.filter((a) => !a.startsWith('-'));
  const unknown = requested.filter((id) => !RECIPES[id]);
  if (unknown.length) {
    console.error(`Unknown recipe id(s): ${unknown.join(', ')}`);
    console.error(`Known ids: ${Object.keys(RECIPES).join(', ')}`);
    process.exit(2);
  }
  const ids = requested.length ? requested : Object.keys(RECIPES);

  mkdirSync(RECORDINGS, { recursive: true });
  acquireRecorderLock();
  // 'exit' fires on every in-process termination path, including the process.exit calls below.
  // A kill signal skips it — that is what the stale-pid reclaim above is for.
  process.on('exit', () => rmSync(LOCK, { force: true }));
  // With the lock held there is no live sibling, so any leftover .stage-* dir is a dead run's
  // debris (only a kill mid-recipe skips recordRecipe's own cleanup) — sweep it.
  for (const entry of readdirSync(RECORDINGS)) {
    if (entry.startsWith('.stage-')) {
      rmSync(join(RECORDINGS, entry), { recursive: true, force: true });
    }
  }
  const exe = resolveChromium();
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const saved = [];
  const failures = [];
  try {
    for (const id of ids) {
      try {
        const r = await recordRecipe(browser, id, RECIPES[id]);
        saved.push({ id, ...r });
        if (r.gif) {
          // The rung is printed when it is not the default, so a recording that had to be
          // shrunk to clear the Camo ceiling says so instead of looking like a plain encode.
          const rung = r.gifRung > 0 ? `, re-encode rung ${r.gifRung}` : '';
          console.log(`RECORDED ${id.padEnd(22)} ${r.gif} (${r.gifBytes} bytes GIF${rung})`);
        } else {
          console.log(
            `RECORDED ${id.padEnd(22)} ${r.webm} (${r.webmBytes} bytes WEBM; GIF skipped: ${r.gifGap})`,
          );
        }
      } catch (err) {
        failures.push({ id, message: err.message, noVideoHandle: err.noVideoHandle === true });
        console.error(`FAILED   ${id.padEnd(22)} ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  // Escalate to the global missing-capability verdict ONLY when no recipe produced a video()
  // handle — the one observation that implicates the host itself. A recording that was muxed
  // and then lost proves the opposite (recording worked; the file was removed afterward, e.g.
  // by a concurrent run — issue #250), so "none survived" must never read as "cannot record".
  if (saved.length === 0 && failures.length > 0 && failures.every((f) => f.noVideoHandle)) {
    console.error('\nMISSING CAPABILITY: screen-recording is not available on this host.');
    console.error(
      'Playwright returned no video() handle for any recipe. The recordVideo path needs a ' +
        'Chromium build that can capture video (full headless Chromium + ffmpeg). ' +
        'Nothing was faked — re-run on a host with recording support, or capture the ' +
        'recordings manually per acceptance/criteria/manual/runbook.md.',
    );
    process.exit(1);
  }
  if (failures.length) {
    console.error(`\n${failures.length} recipe(s) failed; ${saved.length} recorded.`);
    process.exit(1);
  }
  const gifs = saved.filter((s) => s.gif).length;
  const gaps = saved.filter((s) => !s.gif);
  console.log(
    `\nAll ${saved.length} recording(s) saved to acceptance/evidence/recordings/ ` +
      `(${gifs} as committed <ascii-slug>.gif).`,
  );
  if (gaps.length) {
    console.error(
      `\nMISSING CAPABILITY: ${gaps.length} recording(s) produced a .webm but NO GIF ` +
        `(${gaps.map((g) => g.gifGap).join('; ')}). Install ffmpeg (apt-get install -y ffmpeg) ` +
        'and re-run; nothing was faked.',
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
