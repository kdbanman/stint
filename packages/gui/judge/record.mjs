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
 * Chromium build + ffmpeg). If this host cannot record — Playwright returns no video() handle
 * or no .webm file is produced — we do NOT fake anything: we print a clear MISSING-CAPABILITY
 * report and exit non-zero so the calling agent surfaces it instead of silently shipping a
 * stub.
 *
 * Usage:
 *   node packages/gui/judge/record.mjs                # record every known fixture
 *   node packages/gui/judge/record.mjs <reqId> [...]  # record only the named recipe(s)
 *   node packages/gui/judge/record.mjs --list         # list the recipe ids and exit
 *
 * Publishing to GIF: the produced .webm is a gitignored working artifact; the committed evidence
 * is a .gif per recipe (e.g. `§20 R04` → `20-r04.gif`). Install ffmpeg (`apt-get install -y
 * ffmpeg`) and convert at the recordings' convention (full resolution, 50/3 fps, palette):
 *   ffmpeg -y -i "§20 R04.webm" -vf "fps=50/3,palettegen=stats_mode=diff" /tmp/pal.png
 *   ffmpeg -y -i "§20 R04.webm" -i /tmp/pal.png \
 *     -lavfi "fps=50/3,paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" 20-r04.gif
 */
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
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
  UPDATE_FIXTURE,
} from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(here, '..', 'renderer');
// acceptance/evidence/recordings/<reqId>.webm — the QA-evidence home the per-req agents read.
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
  const STEP_MS = 18;
  const STEPS = 14;
  const PRE_MS = 380;
  const POST_MS = 360;

  // Move the synthetic+real pointer to an element's centre in small visible steps.
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

// Convert a finished .webm to a committed, ASCII-named animated GIF via the documented two-pass
// palette pipeline — slowed to ~0.5x (setpts=2.0*PTS) with a ~1.5s hold on the final frame
// (tpad), 15fps, lanczos scale, sierra2_4a dither for quality. Returns the GIF path on success,
// or throws so the caller surfaces the conversion gap (we never ship a faked GIF).
function convertToGif(webmPath, gifPath) {
  const palette = gifPath.replace(/\.gif$/, '') + '.pal.png';
  const vf =
    'setpts=2.0*PTS,fps=15,scale=iw:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=1.5';
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
  return gifPath;
}

// Is an `ffmpeg` runnable on PATH? (Capability honesty — if not, we keep the .webm and report
// the gap rather than silently shipping no GIF.)
function ffmpegAvailable() {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  return r.status === 0;
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
      // Dwell on the running surface: only edit-or-stop — the start panel is hidden (issue #51).
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
      // The start panel is back: open the disclosure and start the next task with details.
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
      // Dwell on the RUNNING state, advancing the pinned clock so the count-up visibly ticks.
      await wait(page, 400);
      for (let i = 1; i <= 3; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 400);
      }
      // Make Stop actually close the open row: flip the injected snapshot to idle so the
      // post-stop getState() reload paints the nothing-running state (faithful to core stop).
      await page.evaluate(() => {
        const idle = { status: { running: false, entry: null }, days: [], sleepFlaggedIds: [], settings: window.__STATE__.settings };
        const prevToggle = window.stint.toggle;
        window.stint.toggle = () => {
          window.__STATE__ = idle;
          return prevToggle();
        };
      });
      // Click the primary Stop button in the running Timer card.
      await page.click('[data-view="timer"]:not([hidden]) #timer-stop');
      // Wait for the card to settle into the idle state (count-up halted, nothing running).
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
      // Route to the Timer view and dwell on the RUNNING surface: the Active-Timer card shows
      // Stop + the live-edit strip, the start panel is HIDDEN (no start affordance while
      // running — issue #51), and there is NO Switch button.
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('#timer-card.running');
      await page.waitForSelector('#timer-stop:not([hidden])');
      await page.waitForFunction(() => !!document.querySelector('#start-panel')?.hidden);
      await page.waitForFunction(() => !document.querySelector('#switch') && !document.querySelector('#timer-switch'));
      await wait(page, 800);

      // STOP the open row → idle. A scoped toggle override flips the snapshot idle (faithful
      // to core's stop) so the post-stop load() repaints the idle card AND the start panel.
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

      // Open the `Details` disclosure → the inline attribute form reveals (idle-only surface).
      await page.click('#start-panel #start-toggle');
      await page.waitForSelector('#start-form:not([hidden])', { state: 'attached' });
      await wait(page, 400);

      // Fill the core-entry attribute set the form carries. The Billable box starts UNCHECKED
      // (clientless ⇒ non-billable) and AUTO-CHECKS as the client lands — the §05 R07
      // client-keyed default, visibly exercised; we leave it untouched so the payload omits
      // billable and core derives the default.
      await page.fill('#start-desc', 'invoice prep');
      await wait(page, 300);
      await page.fill('#start-client', 'Globex');
      await page.waitForFunction(() => document.querySelector('#start-bill')?.checked === true);
      await wait(page, 500);
      await page.fill('#start-project', 'Billing');
      await page.fill('#start-tags', 'admin');
      await wait(page, 500);

      // Press 'Start' → the whole payload goes over `start`; startStopsOpen makes the
      // submitted attributes the single fresh open row, so the repaint paints the running
      // card with the entered description/label.
      await page.click('#start-go');
      await page.waitForSelector('#timer-card.running');
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'invoice prep',
      );
      await wait(page, 400);

      // Step the pinned clock so the fresh entry's 00:00:0x visibly ticks — the start carried
      // its attributes into a LIVE timer; with it running again the start panel hides once
      // more (only edit-or-stop), and still no Switch button anywhere.
      for (let i = 1; i <= 3; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 350);
      }
      await page.waitForFunction(() => !!document.querySelector('#start-panel')?.hidden);
      await page.waitForFunction(() => !document.querySelector('#switch') && !document.querySelector('#timer-switch'));
      await wait(page, 1200);
    },
  },

  // §09 R01 (G3) — a CUSTOM range is a pair of PLAIN DATES on BOTH surfaces the requirement
  // touches: the Reports builder and the Entries toolbar. There is no time-of-day, no
  // datetime-local, and no standalone visual range-picker modal for the entry-range chrome —
  // just two `type="date"` fields whose raw YYYY-MM-DD strings ARE the range. This recording
  // walks both surfaces in one take, driving the SAME selectors the REPORTS_VIEW and
  // ENTRY_LIST_SEARCH judge scenes gate:
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
  //   (B) ENTRIES TOOLBAR — route to Entries (the default day-grouped calendar), pick the
  //       toolbar's Custom… preset (revealing #el-custom-range), and TYPE the plain-date pair
  //       into #el-range-from / #el-range-to (2026-06-23 → 2026-06-23). There is NO Apply
  //       button — setting both dates drives a LIVE listEntries carrying { fromDate, toDate }
  //       as raw strings, and the calendar narrows on the spot to the two in-range entries.
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
      // Open the inline builder.
      await page.click('#rep-new');
      await page.waitForSelector('#rep-builder:not([hidden])', { state: 'attached' });
      await wait(page, 400);
      // Pick Custom… → the two plain date fields reveal (hidden until chosen).
      await page.click('#rep-preset-seg .preset[data-preset="custom"]');
      await page.waitForSelector('#rep-custom-range:not([hidden])', { state: 'attached' });
      await wait(page, 500);
      // Name the report and TYPE the plain-date pair — no time-of-day anywhere.
      await page.fill('#rep-name', 'June window');
      await page.fill('#rep-range-from', '2026-06-01');
      await page.fill('#rep-range-to', '2026-06-07');
      await wait(page, 700);
      // Save → the new card lands with its spec summary printing the verbatim date pair.
      await page.click('#rep-save');
      await page.waitForFunction(() => document.querySelectorAll('#rep-defs .def').length === 3);
      await page.waitForFunction(
        () => !!window.__SAVED_REPORT__ && window.__SAVED_REPORT__.rangeSpec?.kind === 'absolute',
      );
      await page.evaluate(() => window.__recCaption && window.__recCaption('Saved: Custom 2026-06-01 – 2026-06-07 (plain dates, no time)'));
      await wait(page, 1200);
      // Run the fresh custom card → the grouped run-output paints under the resolved-range header.
      await page.click('#rep-defs .def:last-child .def-run');
      await page.waitForFunction(
        () => !document.querySelector('#rep-run')?.hidden && document.querySelectorAll('#rep-run-rows .report-grp').length > 0,
      );
      await wait(page, 1400);

      // ===== (B) ENTRIES TOOLBAR — the same plain-date pair, applied LIVE (no Apply) =====
      // The Entries view is now the readonly day-column CALENDAR (the day-grouped list retired),
      // so wait for its events (.dcol .ev) rather than the old `#entries .day` grouping.
      await page.click('.nav-item[data-view="entries"]');
      await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length > 0);
      await page.evaluate(() => window.__recCaption && window.__recCaption('Entries — Custom… is a plain date pair, applied live (no Apply)'));
      await wait(page, 700);
      // Pick the toolbar's Custom… preset → the two plain date fields reveal.
      await page.click('#el-preset-seg .preset[data-preset="custom"]');
      await page.waitForSelector('#el-custom-range:not([hidden])', { state: 'attached' });
      await wait(page, 500);
      // TYPE the plain-date pair → setting BOTH dates drives a LIVE listEntries carrying the raw
      // { fromDate, toDate } strings; the calendar narrows on the spot (no Apply button exists).
      await page.fill('#el-range-from', '2026-06-23');
      await wait(page, 400);
      await page.fill('#el-range-to', '2026-06-23');
      await page.waitForFunction(
        () => window.__LIST_REQ__?.fromDate === '2026-06-23' && window.__LIST_REQ__?.toDate === '2026-06-23',
      );
      await wait(page, 1600);
    },
  },

  // §05 R05 — manual add by DRAG on the unified form's INLINE interval picker (G5/G7, §12 R07/R15).
  // Drives the REAL renderer end to end: open the Add-entry disclosure — the unified add form mounts
  // the inline interval picker IN FLOW (window.STP / timepicker.js — month view → single-day
  // hour-line column, no modal, no Apply) — DRAG the "me" rectangle body (start+stop move together,
  // 5-min snap) and DRAG the bottom resize edge (stop only, 5-min snap); every drag writes the
  // picked span LIVE into the authoritative #add-from/#add-to fields (text stays authoritative),
  // then Save (the SOLE commit) and SHOW the new completed backfill entry appear in the Entries list.
  //
  // The add form lives in the Entries view (the GUI default view), under the toolbar's "Add entry"
  // disclosure; the picker is the SAME shared component the Timer-view/edit paths reuse. The page is
  // pinned to UTC so the seeded UTC other-entries land on a deterministic local day, and the drag
  // pixel deltas ride the shared geometry (track = 720px/24h → 0.5px/min): +30px body ≈ +60min,
  // +15px resize ≈ +30min stop.
  //
  // To SHOW the saved entry appear, this recipe scopes a local override of window.stint.add
  // (exactly like §05 R02 scopes its toggle override): the override records the backfill and
  // also splices a completed row for the chosen span into the injected snapshot, so the
  // post-Save load()/getState repaint paints the new entry into the day-grouped list. The
  // override is set via page.evaluate on THIS page only — no shared fixture or JUDGE scene is
  // touched, and the renderer's unchanged submit path (fromLocal/toLocal → window.stint.add)
  // stays the single source of truth.
  '§05 R05': {
    page: 'index.html',
    state: pickerState,
    contextOpts: { viewport: { width: 760, height: 900 }, timezoneId: 'UTC' },
    drive: async (page) => {
      // Open the Add-entry disclosure in the Entries view (the default view). The unified add form
      // mounts the INLINE interval picker in flow (no modal, no calendar-icon trigger) into
      // #add-picker, seeded from the raw #add-from/#add-to fields; give the backfill a description
      // so the saved row is legible in the list.
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
      await page.waitForSelector('#add-picker .stp-block.me', { state: 'attached' });
      await page.fill('#add-desc', 'invoice prep');
      await wait(page, 700);
      // Bring the "me" span into the scrollable day viewport so the drag is on camera.
      await page.locator('#add-picker .stp-block.me').scrollIntoViewIfNeeded();

      // Helper: the "me" rectangle box, to grab its body centre and bottom edge for dragging.
      const meBox = () =>
        page.evaluate(() => {
          const me = document.querySelector('#add-picker .stp-block.me');
          const r = me.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, cx: r.left + r.width / 2 };
        });

      // DRAG THE BODY DOWN +30px → start+stop advance together (+60min, 5-min snap), written LIVE
      // into #add-from/#add-to. Slow, stepped move so the snap is legible on camera.
      const before = await meBox();
      const grabX = Math.round(before.cx);
      const grabY = Math.round((before.top + before.bottom) / 2);
      await page.mouse.move(grabX, grabY);
      await page.mouse.down();
      await page.mouse.move(grabX, grabY + 30, { steps: 20 });
      await page.mouse.up();
      await wait(page, 700);

      // DRAG THE BOTTOM RESIZE EDGE DOWN +15px → only the stop moves (+30min, 5-min snap), written
      // LIVE into #add-to. Any seeded other-entries on the day paint gray; if the span lands on one,
      // the overlap region paints yellow (warn-only, never blocks).
      const me2 = await meBox();
      await page.mouse.move(Math.round(me2.cx), Math.round(me2.bottom - 1));
      await page.mouse.down();
      await page.mouse.move(Math.round(me2.cx), Math.round(me2.bottom - 1 + 15), { steps: 16 });
      await page.mouse.up();
      await wait(page, 1200);

      // Scope a local add override so the saved backfill SHOWS in the list on repaint (mirrors
      // §05 R02's toggle override). It records the payload AND splices a completed row for the
      // chosen span into the injected snapshot; the unchanged submit path is untouched.
      await page.evaluate(() => {
        window.stint.add = (p) => {
          window.__ADDED__ = p;
          const st = window.__STATE__;
          const fromUtc = new Date(p.fromLocal).toISOString();
          const toUtc = new Date(p.toLocal).toISOString();
          const sec = Math.max(0, Math.round((Date.parse(toUtc) - Date.parse(fromUtc)) / 1000));
          const day = fromUtc.slice(0, 10);
          const row = {
            id: 300,
            description: p.description || null,
            clientLabel: [p.client || null, p.project || null].filter(Boolean).join(' / ') || null,
            startUtc: fromUtc,
            endUtc: toUtc,
            billableSeconds: sec,
            billable: p.billable !== false,
            overlapped: false,
            overlapMinutes: 0,
            overlapRelation: null,
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
      });

      // No Apply — the picker wrote the picked start/stop into the authoritative #add-from/#add-to
      // fields LIVE on every drag (Save entry is the sole commit). Dwell so the live-updated span is
      // legible on camera.
      await wait(page, 1200);

      // Save → the unchanged submit path sends the explicit fromLocal/toLocal over `add`; the
      // form closes and the repaint paints the new completed backfill entry into the list.
      await page.click('#add-go');
      await page.waitForSelector('#add-form[hidden]', { state: 'attached' });
      // Dwell on the Entries list now carrying the saved 'invoice prep' backfill row.
      await page.waitForSelector('text=invoice prep').catch(() => {});
      await wait(page, 1500);
    },
  },

  // §12 R07 (core entry, G5/G7) — the GUI MANUAL-ADD surface is the ONE unified entry form in ADD
  // mode, and the recording shows the R07 beats the requirement gates: (1) opening "Add entry
  // manually" reveals the two-column unified form (left: multiline description + client/project +
  // tags + billable; right: the inline interval picker over the collapsed Start/Stop expander);
  // (2) DRAGGING the picker "me" block sets the span and the raw Start/Stop fields update LIVE
  // (the picker drives the form state, G7) with other entries gray and the overlap band yellow
  // (warn-only); (3) clicking "Save entry" is the SOLE commit — the entry saves over the same
  // `add` path (fromLocal/toLocal → window.stint.add), the new completed backfill row appears in
  // the Entries list, and — because the span overlaps a seeded entry — the non-blocking overlap
  // banner paints (§06 R4: warned, not blocked).
  //
  // Pinned to timezoneId 'UTC' so the pinned-clock default seed (JUDGE_NOW − 1h → now =
  // 22:00–23:00 local on 2026-06-24) lands on the same local day as the seeded other-entries,
  // making the gray/overlap geometry deterministic; initOpts overlap:true makes the post-save
  // WriteAck carry the overlap warning the inline banner surfaces on camera. As before, a scoped
  // window.stint.add override splices the saved row into the injected snapshot so it SHOWS on the
  // repaint, and returns the shared (overlap-carrying) __ACK__ so applyAck() raises the banner;
  // the override is set on THIS page only — no shared fixture or JUDGE scene is touched, and the
  // renderer's unchanged submit path stays the single source of truth.
  '§12 R07': {
    page: 'index.html',
    state: addFormState,
    initOpts: { overlap: true },
    contextOpts: { viewport: { width: 940, height: 960 }, timezoneId: 'UTC' },
    drive: async (page) => {
      // Wait for the initial load() so `state` (and the picker's snapshotEntries) is populated.
      await page.waitForSelector('.entry', { state: 'attached' });
      // (1) Open the unified add form; wait for the inline picker to mount and the client options.
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
      await page.waitForSelector('#add-picker .stp-block.me', { state: 'attached' });
      await page.waitForSelector('#add-client option[value="1"]', { state: 'attached' });
      await wait(page, 700);

      // Fill the LEFT-column attributes so the saved backfill row is legible in the list.
      await page.fill('#add-desc', 'invoice prep');
      await page.selectOption('#add-client', { label: 'Globex' });
      await page.waitForSelector('#add-project:not([disabled]) option[value="21"]', { state: 'attached' });
      await page.selectOption('#add-project', { label: 'Onboarding' });
      await page.click('#add-tag-input');
      await page.fill('#add-tag-input', 'admin');
      await page.press('#add-tag-input', 'Enter');
      await wait(page, 700);

      // (2) DRAG the "me" body up so the span moves earlier and the raw Start/Stop fields update
      // LIVE — the picker drives the form state (G7). Slow, stepped move so the change is legible.
      const meBox = () =>
        page.evaluate(() => {
          const me = document.querySelector('#add-picker .stp-block.me');
          const r = me.getBoundingClientRect();
          return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
        });
      const before = await meBox();
      await page.mouse.move(Math.round(before.cx), Math.round(before.cy));
      await page.mouse.down();
      await page.mouse.move(Math.round(before.cx), Math.round(before.cy - 40), { steps: 20 });
      await page.mouse.up();
      await wait(page, 900);

      // Extend the stop via the bottom resize grip so the span overlaps a seeded entry — the yellow
      // warn band shows the overlap is warned, not blocked.
      const me2 = await page.evaluate(() => {
        const me = document.querySelector('#add-picker .stp-block.me');
        const r = me.getBoundingClientRect();
        return { cx: r.left + r.width / 2, bottom: r.bottom };
      });
      await page.mouse.move(Math.round(me2.cx), Math.round(me2.bottom - 1));
      await page.mouse.down();
      await page.mouse.move(Math.round(me2.cx), Math.round(me2.bottom - 1 + 20), { steps: 16 });
      await page.mouse.up();
      await wait(page, 1200);

      // Scope a local add override so the saved backfill SHOWS in the list on repaint, and return
      // the shared (overlap-carrying) __ACK__ so applyAck() raises the inline overlap banner.
      await page.evaluate(() => {
        window.stint.add = (p) => {
          window.__ADDED__ = p;
          const st = window.__STATE__;
          const fromUtc = new Date(p.fromLocal).toISOString();
          const toUtc = new Date(p.toLocal).toISOString();
          const sec = Math.max(0, Math.round((Date.parse(toUtc) - Date.parse(fromUtc)) / 1000));
          const day = fromUtc.slice(0, 10);
          const row = {
            id: 301,
            description: p.description || null,
            clientLabel: [p.client || null, p.project || null].filter(Boolean).join(' / ') || null,
            startUtc: fromUtc,
            endUtc: toUtc,
            billableSeconds: sec,
            billable: p.billable !== false,
            overlapped: true,
            overlapMinutes: 45,
            overlapRelation: 'overlaps',
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
      });

      // (3) SAVE — "Save entry" is the sole commit; the form closes, the repaint paints the new
      // completed backfill row, and applyAck() raises the non-blocking overlap banner (§06 R4).
      await page.click('#add-go');
      await page.waitForSelector('#add-form[hidden]', { state: 'attached' });
      await page.waitForSelector('text=invoice prep').catch(() => {});
      await page.waitForSelector('#overlap-banner:not([hidden])').catch(() => {});
      await wait(page, 1600);
    },
  },

  // §12 R15 — the INLINE INTERVAL PICKER itself, the umbrella requirement the §05 R05 / §12 R07
  // manual-add scenes are special cases of. This recording exercises the picker through ALL THREE
  // of its sanctioned entry points in one take, plus the durability contract — every one renders IN
  // FLOW (no modal, no backdrop, no Apply) and writes the picked span LIVE into the authoritative
  // text fields, with Save entry the sole commit:
  //
  //   (1) ADD-ENTRY — open the Entries-view Add form; the inline picker is mounted in flow in the
  //       form's right column. DRAG the accent "me" rectangle body (start+stop move together, 5-min
  //       snap — the #add-from/#add-to fields tick LIVE as it snaps), DRAG the bottom handle to
  //       resize the stop; any seeded other-entry on the day paints GRAY and an overlapping span
  //       paints YELLOW (warn-only). Close the add form (this beat is about the picker).
  //
  //   (2) EDIT-CLOSED — click Edit on the closed 'morning sync' row (09:00–11:00); its inline form
  //       mounts the picker carrying BOTH start+stop. The OTHER closed entry ('market research',
  //       14:00–15:00) paints gray; drag the bottom handle DOWN to extend the stop past 14:00 so the
  //       span overlaps it → the yellow warn region paints, written LIVE into the form's .edit-end
  //       field. Cancel (no commit needed — the requirement is the picker, not the edit).
  //
  //   (3) EDIT-RUNNING-START — route to the Timer view; the live-edit strip's Start field
  //       (#le-start) calendar affordance DISCLOSES the picker inline SEEDED START-ONLY (the open
  //       row has no stop, so editing it can never close the timer, §05 R6). Only a thin start
  //       handle shows — no resize, no stop, the block fading into the future. Drag it to a new
  //       start; #le-start updates LIVE (no Apply — the text field is the authoritative commit path).
  //
  //   (4) OVERNIGHT VIA THE EXPANDER — back in the add form, expand the Start/Stop expander (§12
  //       R17) and TYPE a span that crosses midnight directly into the raw text fields
  //       (2026-06-24T22:00 → 2026-06-25T06:00) — the single-day picker's escape hatch and the only
  //       overnight path — proving TEXT ENTRY REMAINS and stays authoritative.
  //
  // The page is pinned to UTC (like the §05 R05 scene) and the state carries a running open entry
  // (id 99, start 2026-06-24T12:00) PLUS the two pickerState closed entries, all on 2026-06-24, so
  // the picker's single-day column draws the gray other-entries deterministically for every entry
  // point. Drag pixel deltas ride the shared geometry (track 720px/24h → 0.5px/min, i.e. 30px/hour).
  // No write IPC is needed — this scene demonstrates the picker affordance and its LIVE write into
  // the authoritative text fields; the add/edit submit paths are proven on camera by §05 R05 / §12 R07.
  '§12 R15': {
    page: 'index.html',
    // Running open entry (no stop) + the two pickerState closed entries, all on 2026-06-24, so
    // every entry point's single-day column shows the gray other-entries. Built inline (not a new
    // shared fixture) so no JUDGE scene drifts; settings are reused from pickerState().
    state: () => {
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
        status: { running: true, entry: { id: 99, description: 'auth refactor', clientLabel: 'Client A / API', startUtc: '2026-06-24T12:00:00Z', billableSeconds: 3600, billable: true, sleptThrough: false, tags: ['deep'] } },
        days: [{ day: '2026-06-24', entries: [open, ...base.days[0].entries] }],
      };
    },
    contextOpts: { viewport: { width: 760, height: 900 }, timezoneId: 'UTC' },
    drive: async (page) => {
      // Helper: the "me" rectangle box within a given picker host, to grab its body centre and
      // bottom edge for dragging.
      const meBox = (hostSel) =>
        page.evaluate((sel) => {
          const me = document.querySelector(`${sel} .stp-block.me`);
          const r = me.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, cx: r.left + r.width / 2 };
        }, hostSel);

      // ===== (1) ADD-ENTRY — the inline picker, mounted in flow; drag body + resize LIVE =====
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
      await page.waitForSelector('#add-picker .stp-block.me', { state: 'attached' });
      await page.fill('#add-desc', 'invoice prep');
      await wait(page, 600);
      await page.locator('#add-picker .stp-block.me').scrollIntoViewIfNeeded();

      // DRAG THE BODY DOWN +30px → start+stop advance together (+60min, 5-min snap), written LIVE
      // into the #add-from/#add-to fields. Slow, stepped move so the snap is legible.
      const a0 = await meBox('#add-picker');
      const aGrabX = Math.round(a0.cx);
      const aGrabY = Math.round((a0.top + a0.bottom) / 2);
      await page.mouse.move(aGrabX, aGrabY);
      await page.mouse.down();
      await page.mouse.move(aGrabX, aGrabY + 30, { steps: 20 });
      await page.mouse.up();
      await wait(page, 700);

      // DRAG THE BOTTOM RESIZE HANDLE DOWN +15px → only the stop moves (+30min, 5-min snap), LIVE.
      // Any seeded other-entry on the day paints gray; an overlapping span paints yellow (warn-only).
      const a1 = await meBox('#add-picker');
      await page.mouse.move(Math.round(a1.cx), Math.round(a1.bottom - 1));
      await page.mouse.down();
      await page.mouse.move(Math.round(a1.cx), Math.round(a1.bottom - 1 + 15), { steps: 16 });
      await page.mouse.up();
      await wait(page, 1300);

      // Close the add form — this scene is about the picker, not the save (proven by §05 R05).
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form[hidden]', { state: 'attached' });
      await wait(page, 500);

      // ===== (2) EDIT-CLOSED — inline edit a closed row; the picker carries start+stop, overlap =====
      // Open the inline Edit form on the closed 'morning sync' row (id 1, 09:00–11:00). The unified
      // editor mounts in the shared view-level host (#entry-form-host), NOT nested in the calendar
      // event (editor rehost, §12 R06) — so the form + its inline picker are read via the plain
      // `.edit-form` selector (only one form is open). Hover the event first to reveal its ops.
      await page.hover('.entry[data-id="1"]');
      await page.click('.entry[data-id="1"] [data-act="edit"]');
      await page.waitForSelector('.edit-form.entry-form .edit-picker .stp-block.me', { state: 'attached' });
      await wait(page, 800);
      await page.locator('.edit-form .edit-picker .stp-resize').scrollIntoViewIfNeeded();
      // The OTHER closed entry ('market research' 14:00–15:00) paints gray. Drag the bottom resize
      // handle DOWN ~+95px (≈ +190min) to extend the stop from 11:00 past 14:00 → the span overlaps
      // it and the yellow warn-only region paints, written LIVE into the form's .edit-end field.
      const e1 = await meBox('.edit-form .edit-picker');
      await page.mouse.move(Math.round(e1.cx), Math.round(e1.bottom - 1));
      await page.mouse.down();
      await page.mouse.move(Math.round(e1.cx), Math.round(e1.bottom - 1 + 95), { steps: 24 });
      await page.mouse.up();
      // Dwell on the gray other-entry + yellow overlap (warn-only) — the write is already live.
      await wait(page, 1300);
      // Cancel the edit form (the requirement is the picker; the edit submit path is proven elsewhere).
      await page.click('.edit-form.entry-form .edit-cancel');
      await page.waitForSelector('.edit-form.entry-form', { state: 'detached' });
      await wait(page, 500);

      // ===== (3) EDIT-RUNNING-START — the INLINE START-ONLY disclosure (§05 R06, no modal) =====
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #live-edit:not([hidden])');
      await wait(page, 600);
      // The running Start field's calendar affordance DISCLOSES the start-only picker inline,
      // in flow below the field — no modal, no backdrop, no Apply. The open row has NO stop,
      // so the running block fades into the future with a START grip only — no resize handle,
      // no end label — editing the open row can never close the timer (§05 R06). (The dedicated
      // 'running-start-only' recipe below is the §05 R06 QA evidence; this beat keeps the R15
      // every-surface tour complete.)
      await page.click('#le-start-pick');
      await page.waitForSelector('#le-start-disc:not([hidden]) .stp-grip', { state: 'attached' });
      await wait(page, 900);
      // DRAG the start grip UP -20px (≈ -40min, 5-min snap): start 12:00 → 11:20, written LIVE
      // into #le-start (no Apply — the text field is the authoritative commit path).
      const grip3 = page.locator('#le-start-disc .stp-grip');
      await grip3.scrollIntoViewIfNeeded();
      const r0 = await grip3.boundingBox();
      const rGrabX = Math.round(r0.x + r0.width / 2);
      const rGrabY = Math.round(r0.y + r0.height / 2);
      await page.mouse.move(rGrabX, rGrabY);
      await page.mouse.down();
      await page.mouse.move(rGrabX, rGrabY - 20, { steps: 16 });
      await page.mouse.up();
      await wait(page, 1000);
      // Collapse the disclosure — the amended start stands in the Start text field.
      await page.click('#le-start-pick');
      await page.waitForSelector('#le-start-disc[hidden]', { state: 'attached' });
      await wait(page, 1200);

      // ===== (4) OVERNIGHT VIA THE EXPANDER — text remains authoritative (§12 R17) =====
      // Back to the Entries view and the Add form; expand the collapsed Start/Stop expander — the
      // single-day picker's exact/overnight escape hatch — and TYPE a span that crosses midnight
      // directly into the raw text fields. The typed span is authoritative; the inline picker's
      // single-day column simply shows the start day.
      await page.click('.nav-item[data-view="entries"]');
      await page.waitForSelector('.view[data-view="entries"]:not([hidden])');
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
      await page.fill('#add-desc', 'overnight deploy');
      // Expand the Start/Stop expander (the overnight path) and type the overnight span.
      await page.click('#add-times-toggle');
      await page.waitForSelector('#add-times-body:not([hidden])', { state: 'attached' });
      await page.fill('#add-from', '2026-06-24T22:00');
      await page.fill('#add-to', '2026-06-25T06:00');
      await wait(page, 800);
      const overnightHandled = await page.evaluate(
        () => !document.querySelector('.stp-backdrop') && document.querySelector('#add-to')?.value === '2026-06-25T06:00',
      );
      if (!overnightHandled) {
        throw new Error('overnight span not preserved via the Start/Stop expander (text should stay authoritative)');
      }
      // Dwell on the typed overnight text values standing as the authoritative span.
      await wait(page, 1600);
    },
  },

  // §12 R17 (core entry) — the unified form's collapsed Start/Stop EXPANDER: the exact-entry escape
  // hatch and the ONLY path for an OVERNIGHT span. The recording opens the unified add form, EXPANDS
  // the collapsed Start/Stop expander (its raw text fields hidden until then), and TYPES a span that
  // crosses midnight (2026-06-24T22:00 → 2026-06-25T02:00) directly into the raw fields; the inline
  // picker column reflects the typed START and its collapsed echo reflects the cross-midnight span
  // ("22:00 – 02:00") while the raw stop keeps the next-day value verbatim (text authoritative,
  // never flattened to same-day). "Save entry" is the sole commit — the overnight backfill PERSISTS
  // over the unchanged `add` IPC and appears on the Entries repaint.
  //
  // Pinned to UTC (like §05 R05 / §12 R07) so the typed instants land on deterministic local days; a
  // scoped window.stint.add override splices the saved overnight row into the injected snapshot so it
  // SHOWS on the repaint, leaving the renderer's unchanged submit path the single source of truth.
  '§12 R17': {
    page: 'index.html',
    state: addFormState,
    contextOpts: { viewport: { width: 940, height: 960 }, timezoneId: 'UTC' },
    drive: async (page) => {
      await page.waitForSelector('.entry', { state: 'attached' });
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
      await page.waitForSelector('#add-picker .stp-echo', { state: 'attached' });
      await page.fill('#add-desc', 'overnight deploy');
      await wait(page, 700);
      // Expand the collapsed Start/Stop expander — the overnight escape hatch (raw text fields).
      await page.click('#add-times-toggle');
      await page.waitForSelector('#add-times-body:not([hidden])', { state: 'attached' });
      await wait(page, 600);
      // Type the cross-midnight span into the raw text fields; the picker reflects it LIVE.
      await page.fill('#add-from', '2026-06-24T22:00');
      await page.fill('#add-to', '2026-06-25T02:00');
      // The picker's collapsed echo reflects the typed overnight span (the shared interval updated).
      await page.waitForFunction(
        () => document.querySelector('#add-picker .stp-echo')?.textContent.trim() === '22:00 – 02:00',
      );
      await wait(page, 1400);
      // Scope an add override so the saved overnight backfill SHOWS on the Entries repaint (mirrors
      // §05 R05). It records the payload AND splices a completed overnight row into the snapshot; the
      // unchanged submit path stays the single source of truth.
      await page.evaluate(() => {
        window.stint.add = (p) => {
          window.__ADDED__ = p;
          const st = window.__STATE__;
          const fromUtc = new Date(p.fromLocal).toISOString();
          const toUtc = new Date(p.toLocal).toISOString();
          const sec = Math.max(0, Math.round((Date.parse(toUtc) - Date.parse(fromUtc)) / 1000));
          const day = fromUtc.slice(0, 10);
          const row = {
            id: 320,
            description: p.description || null,
            clientLabel: null,
            startUtc: fromUtc,
            endUtc: toUtc,
            billableSeconds: sec,
            billable: p.billable !== false,
            overlapped: false,
            overlapMinutes: 0,
            overlapRelation: null,
            sleptThrough: false,
            excludedSeconds: 0,
            rawSeconds: sec,
            tags: [],
          };
          let block = (st.days ||= []).find((d) => d.day === day);
          if (!block) {
            block = { day, entries: [] };
            st.days.unshift(block);
          }
          block.entries.unshift(row);
          return Promise.resolve(window.__ACK__);
        };
      });
      // Save → the unchanged submit path sends the EXACT typed overnight fromLocal/toLocal over `add`;
      // the form closes and the repaint paints the new completed overnight backfill.
      await page.click('#add-go');
      await page.waitForSelector('#add-form[hidden]', { state: 'attached' });
      await page.waitForSelector('text=overnight deploy').catch(() => {});
      await wait(page, 1500);
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
    contextOpts: { viewport: { width: 760, height: 900 }, timezoneId: 'UTC' },
    drive: async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #live-edit:not([hidden])');
      await page.evaluate(() => window.__recCaption && window.__recCaption('Running timer — adjust its start inline (§05 R06)'));
      await wait(page, 900);
      // Expand the start-only disclosure — in flow below the Start field, no modal chrome.
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
      // Drag the start grip UP -30px (-60min, 5-min snap): 21:35 → 20:35, written LIVE into
      // the raw #le-start text field on every step (no Apply anywhere).
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
      // Step the pinned clock so the count-up visibly keeps ticking after the start edit —
      // amending the start never stops the open row (§05 R06).
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

      // Open the inline edit form; the description surfaces in the multiline <textarea rows=3>,
      // seeded with its stored two lines intact. Hover the event first to reveal its ops.
      await page.hover(row);
      await page.click(`${row} [data-act="edit"]`);
      await page.waitForSelector(`${form} .edit-desc`);
      await wait(page, 900);

      // Scope a local edit override that applies the description patch to the injected snapshot
      // (faithful to core's edit), so the post-Save load() repaints from the freshly-typed value.
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

      // Type a fresh TWO-LINE description. Clear the field, type the first line, then a literal
      // Enter (a newline inside a textarea — never a submit) and the second line: the field scrolls
      // and keeps the interior break.
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

      // Reopen in edit mode: the textarea now carries the newly-typed multiline text rendered INTACT.
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

      // Fold the two source rows into one merged entry on the snapshot so the reload SHOWS the
      // merge (spanning earliest start → latest end), faithful to core's merge; the winnerId
      // decides the surviving client (resolved by the main process, never in the renderer).
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

  // §12 R16 — the readonly entries CALENDAR. Over a whole week of fixed-width day columns (each
  // with its per-day billable header total, plus the range chip), the recording: scrolls the strip
  // HORIZONTALLY across the columns (the week does not fit — the columns stay a fixed comfortable
  // width, never stretched/compressed); scrolls the 24h track VERTICALLY to reveal the off-hours
  // entries (scroll, never clip — every hour is reachable though the viewport opens on working
  // hours); and hovers an event to reveal its Delete / Split / Edit ops + the corner checkbox. The
  // empty days sit as present-but-empty columns throughout.
  '§12 R16': {
    page: 'index.html',
    state: entriesCalendarState,
    drive: async (page) => {
      await page.waitForSelector('.dcol .ev');
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Entries — a readonly week calendar (§12 R16)'));
      await wait(page, 1100);
      // Fixed-width day columns with per-day header totals + a range chip; scroll the week.
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Fixed-width day columns, per-day totals + a range chip'));
      await page.evaluate(() => { const s = document.querySelector('.cstrip'); if (s) s.scrollLeft = s.scrollWidth; });
      await wait(page, 900);
      await page.evaluate(() => { const s = document.querySelector('.cstrip'); if (s) s.scrollLeft = 0; });
      await wait(page, 800);
      // The 24h track scrolls — off-hours entries are reachable, never clipped.
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('The 24h track scrolls — off-hours entries stay reachable, never clipped'));
      await page.evaluate(() => { const s = document.querySelector('.cstrip'); if (s) s.scrollTop = 0; });
      await wait(page, 800);
      await page.evaluate(() => { const s = document.querySelector('.cstrip'); if (s) s.scrollTop = s.scrollHeight; });
      await wait(page, 900);
      // Hover an event to reveal its ops + corner checkbox.
      await page.evaluate(() => { const s = document.querySelector('.cstrip'); if (s) s.scrollTop = 240; });
      await page.hover('.entry[data-id="7"]').catch(() => {});
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Hover an event → Delete / Split / Edit + a corner checkbox'));
      await wait(page, 1300);
    },
  },

  // §12 R09 (issue #55) — EVERY Entries-toolbar control narrows the calendar LIVE, with the
  // range chip (#week-total) tracking each selection. Recorded over the multi-week, multi-
  // client, mixed-billable listState fixture (7 entries: this week 5.00h billable + a non-
  // billable lunch, last week 2.00h, last month 1.00h — all-time 8.00h) so "filtered" is
  // visibly different from "shows everything" (the exact blindness that let the dead toolbar
  // ship). The recording drives, in turn: the idle default (the chip reads the WEEK-BOUNDED
  // 5.00h, not the all-time 8.00h — issue #55 Part B), the search box (range + search compose:
  // last week's 'refactor planning' stays excluded), each range preset, the billable toggle,
  // the client + project filters, and the tag filter — each visibly moving the event set AND
  // the chip. Every query rides the strict listEntries mock (rejects a missing `by` exactly
  // like core), so the flow on camera is also the no-query-throws proof. Mirrors the hardened
  // ENTRIES_CALENDAR / LIVE_FILTER judge scenes; same fixture, same selectors.
  '§12 R09': {
    page: 'index.html',
    state: listState,
    contextOpts: { viewport: { width: 900, height: 700 } },
    drive: async (page) => {
      const settle = (n) =>
        page.waitForFunction((c) => document.querySelectorAll('.dcol .ev').length === c, n);
      await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length === 7);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Entries toolbar — every control filters the calendar live (§12 R09)'));
      await wait(page, 1100);
      // Idle default: 7 events over three weeks; the chip is the WEEK's 5.00h, not all-time 8.00h.
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Idle: 7 entries across 3 weeks — "This week" chip reads the week-bounded 5.00h'));
      await wait(page, 1200);

      // SEARCH — narrows to the two IN-WEEK refactor matches (3.50h); the out-of-week match stays out.
      await page.fill('#search', 'refactor');
      await settle(2);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Search "refactor" → 2 in-week matches, chip 3.50h (range + search compose)'));
      await wait(page, 1400);
      await page.fill('#search', '');
      await settle(7);

      // RANGE PRESETS — each chip re-queries; the event set + chip move with the window.
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Range presets — This month: 6 entries, 7.00h'));
      await page.click('#el-preset-seg .preset[data-preset="month"]');
      await settle(6);
      await wait(page, 1100);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Last week: 1 entry, 2.00h'));
      await page.click('#el-preset-seg .preset[data-preset="last-week"]');
      await settle(1);
      await wait(page, 1100);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Today: 3 entries, 3.00h'));
      await page.click('#el-preset-seg .preset[data-preset="today"]');
      await settle(3);
      await wait(page, 1100);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('This week: 5 entries, 5.00h'));
      await page.click('#el-preset-seg .preset[data-preset="week"]');
      await settle(5);
      await wait(page, 1100);

      // BILLABLE TOGGLE — billable drops the lunch (4); non-billable keeps only it (1, 0.00h).
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Billable: 4 entries — the non-billable lunch drops out'));
      await page.click('#el-billable-seg .seg-btn[data-billable="billable"]');
      await settle(4);
      await wait(page, 1100);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Non-billable: only the lunch, chip 0.00h'));
      await page.click('#el-billable-seg .seg-btn[data-billable="non-billable"]');
      await settle(1);
      await wait(page, 1100);
      await page.click('#el-billable-seg .seg-btn[data-billable="all"]');
      await settle(5);

      // CLIENT + PROJECT — Acme keeps 3 (2.50h); its API project narrows to 1 (2.00h).
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Client Acme: 3 entries, 2.50h'));
      await page.waitForSelector('#el-client option[value="1"]', { state: 'attached' });
      await page.selectOption('#el-client', '1');
      await settle(3);
      await wait(page, 1100);
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Project API: 1 entry, 2.00h'));
      await page.waitForSelector('#el-project option[value="11"]', { state: 'attached' });
      await page.selectOption('#el-project', '11');
      await settle(1);
      await wait(page, 1100);
      await page.selectOption('#el-client', '');
      await settle(5);

      // TAG — 'ci' keeps the week's two ci-tagged entries (2.50h).
      await page.evaluate(() =>
        window.__recCaption && window.__recCaption('Tag "ci": 2 entries, 2.50h'));
      await page.fill('#el-tag', 'ci');
      await settle(2);
      await wait(page, 1300);

      // The wire verdict, stamped on camera: every query carried by:'day', zero rejections.
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
  //       (multiline description, client/project, tag chips, billable, the Start/Stop expander) —
  //       the identical add-mode form, now in edit mode (§12 R06); the edited event carries .editing.
  //   (3) exercises §06 R01's confirm gate in the edit-mode footer: the first Delete click ARMS a
  //       worded confirm (nothing removed yet), the explicit confirm then fires window.stint.remove
  //       with the entry id and the event LEAVES the calendar on the repaint. No scoped override is
  //       needed — the shared initScript remove mock splices the row and reloads (as the judge's
  //       CONFIRM_DELETE / UNIFIED_FORM items rely on), so the deletion lands on camera.
  //   (4) §12 R15 (issue #49) — EXACT stored times: opens the NOT-5-min-aligned entry 84
  //       (09:07:33 → 11:03:00Z) and shows the editor rendering the stored start/stop to the
  //       second (no snap-on-open), then clicks Save entry with NO drag and asserts (via
  //       waitForFunction — the recording FAILS if it times out) that the committed patch carries
  //       no startUtc/endUtc: the store's times round-trip unchanged.
  //   (5) reopens entry 84 and drags the bottom stop grip — asserting the DRAGGED stop (and only
  //       it) snaps onto the :05 grid while the untouched start keeps its 09:07:33.
  // No IPC surgery: the whole scene runs over the unmodified renderer + the same window.stint.*
  // channels tt uses; the shared unifiedFormState keeps the recording 1:1 with the JUDGE scene.
  '§12 R06': {
    page: 'index.html',
    state: unifiedFormState,
    contextOpts: { viewport: { width: 940, height: 940 } },
    drive: async (page) => {
      const row = '.entry[data-id="80"]';
      await page.waitForSelector('.dcol .ev');
      await page.waitForSelector(row);
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Hover an event → Delete / Split / Edit + a corner checkbox (§12 R06 / §06 R01)'));
      await wait(page, 700);

      // (1) HOVER the event → the icon-only ops (Delete / Split / Edit) + the corner checkbox reveal.
      // Hover raises entry 80 above its overlapping neighbour (83) so the ops are reachable.
      await page.hover(row);
      await page.waitForSelector(`${row} .ops .op-btn[data-act="edit"]`, { state: 'attached' });
      await page.waitForSelector(`${row} .ops .op-btn[data-act="split"]`, { state: 'attached' });
      await page.waitForSelector(`${row} .ops .op-btn[data-act="delete"]`, { state: 'attached' });
      await page.waitForSelector(`${row} .ck`, { state: 'attached' });
      await wait(page, 1400);

      // (2) CLICK Edit → the ONE unified editor opens in EDIT MODE in the shared view-level host
      // (#entry-form-host), in flow (no modal), seeded from every tt-editable field.
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

      // (3) TWO-STEP DELETE in the edit-mode footer: the first click ARMS a worded confirm (nothing
      // removed yet)…
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Two-step Delete — first arms a worded confirm, nothing removed yet'));
      await page.click('.edit-form.entry-form .ef-delete');
      await page.waitForSelector('.edit-form [data-act="confirm-delete"]', { state: 'attached' });
      await page.waitForSelector('.edit-form .confirm-q', { state: 'attached' });
      await wait(page, 1500);

      // …then the explicit confirm fires remove({id}); the event leaves the calendar on the repaint.
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Confirm — remove fires with the entry id; the event leaves the calendar'));
      await page.click('.edit-form [data-act="confirm-delete"]');
      await page.waitForSelector(row, { state: 'detached' }).catch(() => {});
      await wait(page, 1600);

      // (4) §12 R15 (issue #49) — EXACT stored times: open the NOT-5-min-aligned entry 84
      // (09:07:33 → 11:03:00Z, UTC page). The editor renders the stored times to the second —
      // never snapped to the picker grid — and Save entry with NO drag round-trips them
      // unchanged (the committed patch carries no startUtc/endUtc). The waitForFunction below
      // IS the assertion: the recording fails if the patch ever carries a time key.
      const exactRow = '.entry[data-id="84"]';
      await page.evaluate(() => {
        window.__EDITED__ = null; // beat (3) never edited, but keep the assertion self-contained
      });
      await page.hover(exactRow);
      await page.click(`${exactRow} [data-act="edit"]`);
      await page.waitForSelector('#entry-form-host .edit-form.entry-form[data-id="84"]', { state: 'attached' });
      await page.waitForSelector('.edit-form.entry-form .edit-client option[value="1"]', { state: 'attached' });
      // Expand the Start/Stop expander so the exact seconds are ON CAMERA (09:07:33 / 11:03).
      await page.click('.edit-form .ef-times-toggle');
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

      // (5) Reopen and drag the bottom stop grip: snapping applies ONLY to the actively dragged
      // handle — the stop lands on the :05 grid while the untouched start keeps its 09:07:33.
      await page.hover(exactRow);
      await page.click(`${exactRow} [data-act="edit"]`);
      await page.waitForSelector('.edit-form .edit-picker .stp-resize', { state: 'attached' });
      await page.click('.edit-form .ef-times-toggle');
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Drag the stop grip — only the dragged handle snaps to the 5-min grid'));
      const resizeLoc = page.locator('.edit-form .edit-picker .stp-resize');
      await resizeLoc.scrollIntoViewIfNeeded();
      const rBox = await resizeLoc.boundingBox();
      const rx = Math.round(rBox.x + rBox.width / 2);
      const ry = Math.round(rBox.y + rBox.height / 2);
      await page.mouse.move(rx, ry);
      await page.mouse.down();
      await page.mouse.move(rx, ry + 30, { steps: 10 });
      await page.mouse.up();
      // Assert the drag outcome: the stop snapped onto :05 (whole minute) and the start still
      // carries its exact stored seconds — the recording fails on a timeout here.
      await page.waitForFunction(() => {
        const from = document.querySelector('.edit-form .edit-start')?.value ?? '';
        const to = document.querySelector('.edit-form .edit-end')?.value ?? '';
        return /:33$/.test(from) && to.length === 16 && Number(to.slice(14, 16)) % 5 === 0;
      });
      await wait(page, 1600);
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
      // Open the slept event → the reversible subtract/restore control + struck raw-vs-trimmed.
      await page.hover('.entry[data-id="12"]');
      await page.click('.entry[data-id="12"] [data-act="edit"]');
      await page.waitForSelector('.edit-form .ef-subtract');
      await page.evaluate(() =>
        window.__recCaption &&
        window.__recCaption('Slept entry: raw 4h struck beside the trimmed 3h billable — Restore to reverse'));
      await wait(page, 1300);
      // Restore lifts the exclusion (billable back to raw), then Subtract re-excludes it.
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

      // (1) + Add client — the inline "New client" field opens (the click issue #48 dead-ended).
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

      // (a) PIN from the running timer — the Pin control swaps into the INLINE name field;
      // type the name and commit on Enter. The rail grows by one chip under that name.
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
      // Dwell on (b) the LIST — every favorite is a row in the rail, the new one included.
      await wait(page, 900);

      // (c) RENAME in place — open the newly pinned chip's kebab → Rename; the chip's name
      // swaps into the inline field, Enter commits, and the name repaints.
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

      // (d) UNPIN — open the renamed chip's kebab → Unpin; the chip leaves the rail.
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
    contextOpts: { viewport: { width: 820, height: 980 } },
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
      // Route to the Timer view; the canonical 'auth refactor' open row (Client A / API, tags
      // deep/urgent) is running, the count-up reads a deterministic 01:24:07, and the state dot
      // shows 'running'. Step the pinned clock so the count-up visibly TICKS UP on camera.
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
      // The live-edit strip is seeded from the open entry. The End field is deliberately ABSENT —
      // there is NO #le-end anywhere (the open row has no stop, §05 R06 / §12 R14, the same
      // no-end fact the judge asserts) — then change description + start time + Billable and PROVE
      // the row stays open (still running).
      await page.waitForSelector('#live-edit:not([hidden])');
      await page.waitForFunction(() => !document.querySelector('#live-edit #le-end'));
      // Make each live edit visibly APPLY on the repaint: scope an `edit` override that applies
      // the patch to the open row in __STATE__ (never an endUtc — the row stays open), faithful
      // to core's edit-on-open-row. The renderer's commitLiveEdit still builds the minimal patch
      // and calls window.stint.edit({id,patch}); this override just lets the post-edit load()
      // repaint reflect it on camera. The "no endUtc" invariant is preserved (patch carries none).
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
      // Advance the pinned clock past the 500ms debounce window to flush the single commit.
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
      // Stop closes the open row → idle. Scope a toggle override that flips __STATE__ to idle
      // (faithful to core's stop), so the post-stop load() paints the idle card (count-up halted).
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
      // Confirm no Switch verb survives anywhere in the running Timer view (issue #34).
      await page.waitForFunction(() => !document.querySelector('#switch') && !document.querySelector('#timer-switch'));
      await tickClock(3);
      await wait(page, 600);

      // ---- (4) FAVORITES RAIL — pin, resume, rename, unpin -----------------------------------
      // The rail paints one card per seeded favorite. PIN the running timer → the Pin control
      // swaps into the INLINE name field (issue #52 — no window.prompt in Electron's renderer);
      // type the name, commit on Enter, and a new chip appears.
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
      // The resume handler repaints the rail; drive the same load() the real `changed` broadcast
      // would so the Active-Timer card repaints to the resumed fresh template.
      await page.evaluate(() => (typeof load === 'function' ? load() : null));
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'focus block',
      );
      await page.waitForSelector('#timer-card.running');
      await tickClock(3);
      await wait(page, 600);

      // RENAME via the kebab — open the pinned 'Invoice prep' chip's kebab → Rename; the
      // chip's name swaps into the INLINE field, Enter commits, and the name repaints.
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

      // UNPIN via the kebab — open the renamed chip's kebab → Unpin; the chip leaves the rail.
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
      // Advance the pinned clock a few seconds so the count-up visibly advances on camera.
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
    contextOpts: { viewport: { width: 820, height: 900 } },
    drive: async (page) => {
      // Enter the in-shell Reports view from the sidebar (the sidebar stays present throughout).
      await page.click('.nav-item[data-view="reports"]');
      await page.waitForSelector('[data-view="reports"]:not([hidden])');
      // Dwell on the SAVED-DEFINITIONS list — one card per seeded saved report.
      await page.waitForSelector('#rep-defs .def');
      await wait(page, 1100);

      // Click the single accent primary action: + New report → the inline builder opens.
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
      // Rounding stays OFF (the default) — dwell so the unchecked toggle is legible.
      await page.waitForSelector('#rep-rounding:not(:checked)');
      await wait(page, 500);

      // SAVE the definition → saveReport (parity with `tt report save`); the builder closes and
      // the new card appears in the list.
      await page.click('#rep-save');
      await page.waitForSelector('#rep-builder[hidden]', { state: 'attached' });
      await page.waitForSelector('.def[data-name="Weekly billables — Acme"]');
      await wait(page, 900);

      // RUN the new definition → runReport (parity with `tt report run`); the on-screen grouped
      // summary paints with the grand total and the overlap + unreviewed-sleep flags IN CONTEXT.
      const newCard = page.locator('.def[data-name="Weekly billables — Acme"]');
      await newCard.locator('[data-act="run"]').click();
      await page.waitForSelector('#rep-run:not([hidden])');
      await page.waitForSelector('#rep-run-rows .report-grp');
      // Dwell on the grouped summary: per-line + grand totals, with the flags on their rows.
      await page.waitForSelector('#rep-run-rows .report-flag');
      await wait(page, 1300);

      // EXPORT (the report's OWN, FILTERED scope): Export CSV then JSON → exportEntries with
      // scope 'filtered' + the saved ref; the confirmation line paints (the rows the report shows).
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

      // EXPORT ALL DATA (the RAW scope): the escape hatch set apart at the bottom → exportEntries
      // with scope 'all'; its status carries the honest "(all data)" wording so the two scopes
      // read as genuinely different (issue #72 — a filtered report never silently ships raw rows).
      await page.waitForSelector('#rep-run-export-all:not([hidden])');
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

      // EDIT the card → the builder re-opens on the saved def; change Group by to Project.
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

      // RE-RUN to show the regroup taking effect (runReport over the amended def).
      await newCard.locator('[data-act="run"]').click();
      await page.waitForSelector('#rep-run:not([hidden])');
      await page.waitForFunction(
        () => /Weekly billables — Acme/.test(document.querySelector('#rep-run-caption')?.textContent || ''),
      );
      await wait(page, 1100);

      // RENAME the definition via the card kebab — the kebab swaps IN PLACE into the inline
      // Rename / Delete menu (issue #52: Electron's renderer implements neither window.prompt
      // nor window.confirm, so both affordances are inline controls). Rename swaps the card's
      // name into the inline field; Enter commits renameReport (parity with `tt report
      // rename`) and the card repaints under the new name.
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

      // DELETE the renamed definition via the kebab — Delete ARMS the generic in-window
      // confirm gate (§12 R13); only the explicit confirm fires removeReport (parity with
      // `tt report rm`) and the card leaves the list.
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
    contextOpts: { viewport: { width: 820, height: 900 } },
    drive: async (page) => {
      // Enter the in-shell Reports view from the sidebar; dwell on the saved-definition list
      // (one restyled card per seeded saved report) so the new look reads on camera.
      await page.click('.nav-item[data-view="reports"]');
      await page.waitForSelector('[data-view="reports"]:not([hidden])');
      await page.waitForSelector('#rep-defs .def');
      await wait(page, 1100);

      // + New report → the inline restyled BUILDER opens. Build a definition by clicking each
      // control so the segmented-control / toggle / field styling is legible in motion.
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

      // SAVE → the builder closes and the new card joins the restyled list.
      await page.click('#rep-save');
      await page.waitForSelector('#rep-builder[hidden]', { state: 'attached' });
      await page.waitForSelector('.def[data-name="Weekly billables — Acme"]');
      await wait(page, 700);

      // RUN → the on-screen GROUPED SUMMARY paints: per-line + grand totals, with the overlap
      // and unreviewed-sleep flags surfaced IN CONTEXT on their affected rows. Dwell here so the
      // restyled summary table + status flags are the closing beat.
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
    contextOpts: { viewport: { width: 820, height: 900 } },
    drive: async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      await page.waitForSelector('#settings-panel input.set-hhmm[data-key="workingHoursStart"]');
      await page.evaluate(() => {
        window.__recCaption && window.__recCaption('Settings → Timeline: working hours + picker window (§14)');
        document
          .querySelector('#settings-panel input.set-hhmm[data-key="workingHoursStart"]')
          ?.scrollIntoView({ block: 'center' });
      });
      await wait(page, 1400);

      // Scope a core-faithful setSetting: the injected mock accepts anything, but the REAL
      // channel rejects a malformed HH:MM / inverted pair / out-of-range span — mirror that
      // strictness here so the revert-on-reject beat below is honest. Recipe-scoped only.
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

      // 1) A valid working-hours edit persists and reads back on the repaint (09:00 → 08:00).
      await page.fill('#settings-panel input.set-hhmm[data-key="workingHoursStart"]', '08:00');
      await page.press('#settings-panel input.set-hhmm[data-key="workingHoursStart"]', 'Tab');
      // The change persisted over setSetting and the repaint reads it back from stored truth.
      await page.waitForFunction(
        () =>
          window.__SET_SETTING__?.key === 'workingHoursStart' &&
          document.querySelector('#settings-panel input.set-hhmm[data-key="workingHoursStart"]')?.value ===
            '08:00',
      );
      await wait(page, 900);

      // 2) An INVALID end (06:00 < start) is rejected; the re-render reverts to stored truth.
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

      // 3) Flip the Picker-window mode → Around now: the Around select enables; pick 12 h.
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

      // 4) The consumer beat (post §12 R15/R16): the entries calendar opens to the configured
      // window — a scroll default over the full 24h track, never clipped (G16). Guarded on the
      // data-timeline-track hook so this recipe records meaningfully before those rows land.
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
      // 1) CURRENT VERSION — route to Settings, scroll the Software Update group into view, and
      // dwell on the "Current version" row (stamped APP_VERSION read over getVersion()) and the
      // "Check for updates" row whose subcopy names GitHub Releases as the source.
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      await page.waitForSelector('#update-check');
      // Confirm the Current-version row printed the stamped version before the check (R06/R03).
      await page.waitForFunction(
        () => /2026\.6\.24/.test(document.querySelector('.set-row .ver')?.textContent || ''),
      );
      await page.evaluate(() => document.querySelector('#update-check')?.scrollIntoView({ block: 'center' }));
      await wait(page, 1100);

      // 2) CHECK NOW — click "Check now"; the renderer queries the GitHub Releases bridge
      // (window.stint.update.check), the verdict repaints "Update available · 2026.7.1" with the
      // release link. Wait for the verdict line, then stamp a badge proving the bridge was queried.
      await page.click('#update-check');
      await page.waitForSelector('#update-status .update-result.new');
      await page.waitForFunction(
        () => /2026\.7\.1/.test(document.querySelector('#update-status')?.textContent || ''),
      );
      // Stamp the proof badge: the injected check() set window.__CHECKED__ when the renderer queried
      // it, and the resolved verdict is the "newer version" reply the live GitHub Releases query
      // would give. Presentation-only, scoped to this page (mirrors §12 R03's scoped badge).
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
        // Highlight the release link so the "newer version" verdict is unmistakable on camera.
        const link = document.querySelector('#update-status a[data-update-link]');
        if (link) link.style.outline = '2px solid #2f6fed';
      });
      // Dwell on the verdict (Update available · 2026.7.1 + release link) and the proof badge.
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
      // Route to Settings → Software Update.
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      await wait(page, 500);

      // A check first surfaces the newer release so the guided-install panel (the R04 surface)
      // appears with its "Download & install <version>" primary action.
      await page.waitForSelector('#update-check');
      await page.click('#update-check');
      await page.waitForSelector('#update-download', { state: 'attached' });
      await wait(page, 900);

      // DOWNLOAD: clicking replays the UPDATE_FIXTURE progress frames over onUpdateProgress —
      // the progress bar advances (mid-download 42% 'downloading' frame) and the numbered guided
      // steps repaint live, including the one-time Gatekeeper beat (no Developer ID).
      await page.click('#update-download');
      // Dwell on the mid-download progress so the advancing bar + numbered steps are legible.
      await wait(page, 1100);

      // The terminal 'ready' frame flips the action to "Reveal installer" pointing at the
      // downloaded artifact in the temp folder — the user's hand-off to replace the app.
      await page.waitForSelector('#update-reveal', { state: 'attached' });
      await wait(page, 1200);

      // Final dwell so the recording ends on the completed guided-install panel: Reveal
      // installer + the full numbered steps (incl. Gatekeeper) + the "Updates never touch the
      // database — the artifact downloads to a temp folder" note (R04's no-DB-touch guarantee).
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
    contextOpts: { viewport: { width: 820, height: 900 } },
    drive: async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      // Dwell on the Backups group: Last backup + verified pill, retention picker, restore list.
      await page.waitForSelector('#backups-panel .set-grp');
      await page.waitForSelector('#backups-panel .backup-item');
      await page.evaluate(() =>
        document.querySelector('#backups-panel .set-grp')?.scrollIntoView({ block: 'center' }),
      );
      await wait(page, 1300);

      // CHANGE RETENTION (last 5 → last 10) over the same setSetting channel.
      await page.selectOption('#backups-panel select[data-key="backupRetention"]', '10');
      await page.waitForFunction(() => window.__SET_SETTING__?.key === 'backupRetention');
      await wait(page, 900);

      // Scope a restoreBackup override so the restore visibly lands on the repaint: it records the
      // payload and stamps a fresh Last-backup time, then we re-render to show the panel update.
      await page.evaluate(() => {
        const now = window.__JUDGE_NOW__;
        window.stint.restoreBackup = (p) => {
          window.__RESTORED_BACKUP__ = p;
          window.__STATE__.lastBackupUtc = now;
          window.__STATE__.recoveryNotice = null;
          return Promise.resolve({ recoveredFrom: (p && p.name) || '', quarantinedTo: '/db/timetracker.sqlite.replaced' });
        };
      });

      // RESTORE through the confirm gate: first click ARMS the confirm…
      await page.click('#backups-panel .backup-item .backup-restore');
      await page.waitForSelector('#backups-panel .confirm-restore');
      await wait(page, 900);
      // …the explicit confirm fires restoreBackup({name}); the panel repaints (re-render in onConfirm).
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
    contextOpts: { viewport: { width: 820, height: 900 } },
    drive: async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      // Dwell on the recovery banner (recoveredFrom + quarantinedTo) atop the Backups group.
      await page.waitForSelector('#backups-panel #recovery-notice');
      await page.evaluate(() =>
        document.querySelector('#backups-panel #recovery-notice')?.scrollIntoView({ block: 'center' }),
      );
      await wait(page, 1600);

      // Scope the restore override so the restore lands on the repaint and the notice clears.
      await page.evaluate(() => {
        const now = window.__JUDGE_NOW__;
        window.stint.restoreBackup = (p) => {
          window.__RESTORED_BACKUP__ = p;
          window.__STATE__.lastBackupUtc = now;
          window.__STATE__.recoveryNotice = null;
          return Promise.resolve({ recoveredFrom: (p && p.name) || '', quarantinedTo: '/db/timetracker.sqlite.replaced' });
        };
      });

      // RESTORE from the list through the confirm gate: arm, then confirm → restoreBackup({name}).
      await page.waitForSelector('#backups-panel .backup-item .backup-restore');
      await page.click('#backups-panel .backup-item .backup-restore');
      await page.waitForSelector('#backups-panel .confirm-restore');
      await wait(page, 900);
      await page.click('#backups-panel [data-act="confirm-restore"]');
      await page.waitForFunction(() => !!window.__RESTORED_BACKUP__);
      // The repaint clears the one-shot recovery notice (the user restored a chosen good backup).
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
  // and resizes NARROW (480px) then WIDE (1200px). styles.css pins `.shell .nav` to a 168px
  // flex-none basis and lets `.views { flex: 1; min-width: 0 }` absorb all resize, so the
  // recording SHOWS the sidebar holding a constant width while only the content area reflows.
  // To make the constant width legible on camera (a still frame can't show "it didn't move"),
  // the recipe stamps the live measured `.shell .nav` width into a small on-page badge before
  // and after each resize — it reads a byte-identical 168 at every viewport (the same fact the
  // JUDGE NAV_SHELL FIXED_WIDTH_ON_RESIZE sub-fact gates on, here shown as moving picture).
  '§12 R03': {
    page: 'index.html',
    state: runningState,
    contextOpts: { viewport: { width: 760, height: 620 } },
    drive: async (page) => {
      // A tiny on-page badge that echoes the LIVE measured sidebar width + current viewport, so
      // the constant 168px rail is legible while the content column reflows. Presentation-only,
      // scoped to this recording page (no renderer/CSP change), mirroring the scoped overrides
      // used by §05 R02/R05/R10.
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

      // 1) Tour every view from the one rail — the sidebar is present in each, and the active
      // highlight moves. Open on Entries (default), then visit each view including Reports
      // (now in-shell) and Settings.
      for (const view of ['timer', 'entries', 'clients', 'reports', 'settings']) {
        await page.click(`.nav-item[data-view="${view}"]`);
        await page.waitForSelector(`.view[data-view="${view}"]:not([hidden])`);
        // Confirm the rail is present AND the highlight is on THIS item (active accent moved).
        await page.waitForSelector(`.shell .nav .nav-item[data-view="${view}"].active`);
        await page.evaluate(() => window.__recBadge__());
        await wait(page, 650);
      }

      // 2) Land back on Reports (in-shell) for the resize demonstration, so a content-rich view
      // is visibly reflowing while the rail holds.
      await page.click('.nav-item[data-view="reports"]');
      await page.waitForSelector('.view[data-view="reports"]:not([hidden])');
      await page.evaluate(() => window.__recBadge__());
      await wait(page, 500);

      // 3) RESIZE NARROW (480px). The recordVideo frame tracks the viewport, so the window edge
      // visibly pulls in; the badge keeps reading sidebar 168px (fixed) while the content column
      // narrows. Step it in stages so the reflow is legible on camera.
      for (const w of [640, 560, 480]) {
        await page.setViewportSize({ width: w, height: 620 });
        await page.evaluate(() => window.__recBadge__());
        await wait(page, 550);
      }
      await wait(page, 700);

      // 4) RESIZE WIDE (1200px). The content column expands; the rail still holds 168px.
      for (const w of [700, 950, 1200]) {
        await page.setViewportSize({ width: w, height: 620 });
        await page.evaluate(() => window.__recBadge__());
        await wait(page, 550);
      }
      await wait(page, 800);

      // 5) Final pass: with the wide window, click through the rail once more so the recording
      // ends proving every view still keeps the (constant-width) sidebar at the new size —
      // including Reports in-shell.
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
      // 1) Open on Entries (the default view): show the COMPACT STRIP mirroring the running timer.
      await page.waitForSelector('.view[data-view="entries"]:not([hidden])');
      await page.waitForSelector('#timer-strip.running');
      await page.waitForFunction(
        () => document.querySelector('#strip-desc')?.textContent?.trim() === 'auth refactor',
      );
      // Dwell on the strip and step the pinned clock so its count-up visibly ticks (live timer).
      await wait(page, 700);
      for (let i = 1; i <= 3; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 350);
      }
      await wait(page, 500);

      // 2) Click the strip → route to the Timer view, where the FULL Active-Timer panel paints
      // from the SAME running snapshot (large count-up + state + desc/meta/flags + Stop, no Switch).
      await page.click('#timer-strip');
      await page.waitForSelector('.view[data-view="timer"]:not([hidden]) #timer-card.running');
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'auth refactor',
      );
      await page.waitForSelector('#timer-stop:not([hidden])');
      // §12 R04 — the running card's primary actions are exactly Stop + the favorite pin: confirm
      // the Pin-as-favorite control (#timer-pin) is present/visible alongside Stop…
      await page.waitForSelector('#timer-pin:not([hidden])');
      // …and that Switch is removed — no #timer-switch survives on the full panel (issue #34).
      await page.waitForFunction(() => !document.querySelector('#timer-switch'));
      // Dwell on the full panel and step the clock so its larger count-up ticks on camera too.
      await wait(page, 700);
      for (let i = 4; i <= 6; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 350);
      }
      // Travel the cursor over the two remaining primary actions so the running card's
      // Stop (+ favorite pin) set is legible on camera — the card hosts these and nothing else.
      // Use stepped mouse.move so the synthetic cursor visibly travels to each control.
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

      // 3) Route back to Entries via the nav rail — the same running timer is still the compact
      // strip there, proving the panel moved into Timer while Entries keeps the strip.
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
  // The recording drives the exact reported path over the idle list fixture: touch the
  // Today range preset on the Entries toolbar (the calendar narrows), route to the Timer
  // view (the card reads idle / 00:00:00 / Start), click Start — the toggle mock mutates
  // the snapshot like main's toggleTimer over core (toggleStarts) — and the card flips to
  // running ON CAMERA without any reload: state 'running', the primary reads Stop, and the
  // fresh count-up visibly ticks up from 00:00:00 as the pinned clock steps. The JUDGE
  // CROSS_VIEW_FRESHNESS scene gates the same facts; this recording is its moving evidence.
  'cross-view-freshness': {
    page: 'index.html',
    state: listState,
    initOpts: { toggleStarts: true },
    drive: async (page) => {
      // 1) Entries (the default view): touch a toolbar control — the Today range preset.
      await page.waitForSelector('.view[data-view="entries"]:not([hidden]) #el-preset-seg');
      await wait(page, 600);
      await page.click('#el-preset-seg .preset[data-preset="today"]');
      await page.waitForFunction(() => !!window.__LIST_REQ__);
      await wait(page, 700);
      // 2) Route to the Timer view — the card paints its idle face (00:00:00 / Start).
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('.view[data-view="timer"]:not([hidden]) #timer-card.idle');
      await wait(page, 800);
      // 3) Click Start: the card must flip to running in place — no reload, no rerouting.
      await page.click('#toggle');
      await page.waitForSelector('#timer-card.running');
      await page.waitForFunction(
        () => document.querySelector('#timer-state')?.textContent?.trim() === 'running',
      );
      // 4) Step the pinned clock so the fresh entry's 00:00:0x count-up visibly ticks — the
      // card is the live timer, not a stale paint.
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
      // The running popover: the toggle reads 'Stop', Open Stint is present, and NO #switch exists.
      await page.waitForFunction(
        () => document.querySelector('#toggle')?.textContent?.trim() === 'Stop',
      );
      await page.waitForSelector('#open');
      await page.waitForFunction(() => !document.querySelector('#switch'));
      await wait(page, 800);
      // Step the pinned clock so the popover count-up visibly ticks — the live running timer, with
      // still only Stop + Open Stint on the surface (no Switch).
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
    contextOpts: { viewport: { width: 820, height: 760 } },
    drive: async (page) => {
      // 1) THE RETIREMENT — read off disk whether the standalone page still ships, and stamp the
      // verdict into an on-page badge so it is legible on camera. RENDERER is this file's own
      // notion of the renderer dir (../renderer), the exact dir the real app loads from.
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
      // Dwell on the in-shell window so the badge (retired-on-disk) is readable.
      await page.waitForSelector('.shell .nav');
      await wait(page, 1300);

      // Actually try to open the OLD standalone sidebar-less page by its file:// URL: the
      // browser fails to load it (the file is gone). We tolerate the navigation error and show
      // the failed/empty page for a beat, then return — proving the page is genuinely removed.
      const standaloneUrl = 'file://' + join(RENDERER, 'report.html');
      try {
        await page.goto(standaloneUrl, { waitUntil: 'load', timeout: 4000 });
      } catch {
        // Expected: ERR_FILE_NOT_FOUND — the standalone page no longer exists.
      }
      await wait(page, 1200);

      // 2) THE FOLD-IN — return to the in-shell window; the report function now lives inside the
      // sidebar shell. Re-load index.html and route to Reports via the rail.
      await page.goto(fileUrl('index.html'), { waitUntil: 'load' });
      await page.waitForSelector('.shell .nav');
      await page.click('.nav-item[data-view="reports"]');
      await page.waitForSelector('.view[data-view="reports"]:not([hidden])');
      // The sidebar is STILL present alongside the Reports view (the retired page had none).
      await page.waitForSelector('.shell .nav .nav-item[data-view="reports"].active');
      // The saved-definition list paints in-shell — the report function folded in.
      await page.waitForSelector('#rep-defs .def');
      await wait(page, 1200);

      // RUN one saved definition in-sidebar → the on-screen grouped summary appears (the job the
      // standalone page used to do, now done inside the shell over the same runReport channel).
      const firstCard = page.locator('#rep-defs .def').first();
      await firstCard.locator('[data-act="run"]').click();
      await page.waitForSelector('#rep-run:not([hidden])');
      await page.waitForSelector('#rep-run-rows .report-grp');
      await wait(page, 1300);

      // EXPORT CSV in-sidebar → exportEntries; the confirmation line paints. The sidebar is still
      // present throughout — the contrast with the retired sidebar-less page the recording is about.
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

/**
 * Drive one recipe inside a Playwright context that has recordVideo enabled, then move the
 * produced .webm to acceptance/evidence/recordings/<reqId>.webm. Returns the saved path on
 * success. Throws if the recipe ran but Playwright produced NO video — that throw is what the
 * caller turns into the explicit missing-capability report (we never fabricate a file).
 */
async function recordRecipe(browser, reqId, recipe) {
  // Per-recipe staging dir so Playwright's auto-named .webm cannot collide between recipes;
  // we rename the single produced file to <ascii-slug>.webm afterward. The dir is ASCII-slugged
  // too (the §-prefixed reqId is not filesystem-clean) and matches the .gitignore .stage-* rule.
  const stage = join(RECORDINGS, `.stage-${asciiSlug(reqId)}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  // A recipe may widen/heighten the viewport or pin a timezone (e.g. the §05 R05 picker scene
  // needs a taller column and a UTC page so its seeded other-entries land on the column day);
  // the recordVideo size tracks the viewport so the whole window is captured.
  const viewport = recipe.contextOpts?.viewport ?? { width: 760, height: 620 };
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

  if (!video) {
    rmSync(stage, { recursive: true, force: true });
    throw new Error('Playwright produced no video() handle — this Chromium build cannot record.');
  }
  let produced;
  try {
    produced = await video.path();
  } catch (err) {
    rmSync(stage, { recursive: true, force: true });
    throw new Error(`video.path() failed — no recording was muxed: ${err.message}`);
  }
  if (!produced || !existsSync(produced) || statSync(produced).size === 0) {
    rmSync(stage, { recursive: true, force: true });
    throw new Error('no non-empty .webm file was produced — recording capability is missing here.');
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
  if (!ffmpegAvailable()) {
    return { webm: webmOut, webmBytes, gif: null, gifBytes: 0, gifGap: 'ffmpeg not on PATH' };
  }
  const gifOut = join(RECORDINGS, `${slug}.gif`);
  rmSync(gifOut, { force: true });
  convertToGif(webmOut, gifOut);
  return { webm: webmOut, webmBytes, gif: gifOut, gifBytes: statSync(gifOut).size, gifGap: null };
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
          console.log(`RECORDED ${id.padEnd(22)} ${r.gif} (${r.gifBytes} bytes GIF)`);
        } else {
          console.log(
            `RECORDED ${id.padEnd(22)} ${r.webm} (${r.webmBytes} bytes WEBM; GIF skipped: ${r.gifGap})`,
          );
        }
      } catch (err) {
        failures.push({ id, message: err.message });
        console.error(`FAILED   ${id.padEnd(22)} ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  // If EVERY recipe failed the same way, this host almost certainly cannot record video at
  // all — surface that as a single clear missing-capability verdict (not N scattered errors)
  // so per-req agents can report "no recording capability here" rather than fake an artifact.
  if (saved.length === 0 && failures.length > 0) {
    console.error('\nMISSING CAPABILITY: screen-recording is not available on this host.');
    console.error(
      'No .webm was produced for any recipe. The Playwright recordVideo path needs a ' +
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
