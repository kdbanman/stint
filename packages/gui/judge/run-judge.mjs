#!/usr/bin/env node
/**
 * JUDGE harness (acceptance.html §09) — drives the real renderer through an injected
 * window.stint mock, captures screenshots + the accessibility tree, and evaluates
 * the deterministic sub-facts of the rubric. The subjective items (DESKTOP_FEEL,
 * ACCENT discipline as a whole) are scored by an LLM/human over the screenshots;
 * this harness produces that evidence and gates on the crisp PASS/FAIL claims.
 *
 * Renderer windows run headless via the pre-installed Chromium. The tray icon's own
 * count-up and a real global-hotkey press have no host here and stay under MANUAL.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChromium } from '../../../scripts/resolve-chromium.mjs';
import { emptyState, runningState, startFormState, addFormState, editingState, unifiedFormState, multilineDescState, splittableState, edgeColumnState, mergeConflictState, mergeAgreeState, mergeGapState, overlapWriteState, clientsState, taggedState, listState, liveState, entriesCalendarState, shortEntriesCalendarState, denseCalendarState, savedReportsState, settingsState, timelineWindowState, timelineAroundState, softwareUpdateState, backupsState, recoveryState, UPDATE_FIXTURE, UPDATE_CHECK_FAILED, timerViewRunningState, timerViewSleptRunningState, timerViewFavoritesState, timerViewEmptyFavoritesState, initScript, JUDGE_NOW, WINDOW, POPOVER } from './fixtures.mjs';
// §17 R8 — the IPC channel set the GUI is an equal surface over. Imported from the built
// main bundle so the PARITY_REACH deterministic sub-fact (every channel has a window.stint
// method) checks the SAME list the preload bridge exposes and parity.test.ts asserts against
// — one source of truth, no hand-copied channel list to drift.
import { CHANNELS } from '../dist/ipc.js';
// §12 R22 — the same measure-and-clamp the shipped popover applies on show (main.ts
// togglePopover), so popover evidence renders at the window the user gets.
import { popoverWindowSize } from '../dist/popoversize.js';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(here, '..', 'renderer');
const EVIDENCE = join(here, '..', '..', '..', 'acceptance', 'evidence', 'screenshots');

const fileUrl = (name) => 'file://' + join(RENDERER, name);

// The shared in-page probe (window.__probe), injected into every scene page so the
// colour-space and visibility trivia lives once: cssVar reads a custom property off :root,
// toRgb normalizes a token hex to the computed-style rgb() form, rgbOf composes the two, and
// visible is the harness-wide visibility predicate (laid out, not display:none/visibility:
// hidden, outside any [hidden] ancestor). Scene ASSERTIONS and their sanctioned/whitelist
// tables stay inline in each scene — only these mechanics are shared.
const PROBE_HELPERS = `window.__probe = {
  cssVar: (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
  toRgb: (hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')';
  },
  rgbOf: (name) => window.__probe.toRgb(window.__probe.cssVar(name)),
  visible: (el) => {
    if (!el || el.hidden || el.closest('[hidden]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  },
};`;

// Every screenshot filename the harness writes, in write order. Capture filenames are
// hand-chosen per scene, so nothing structural stops two scenes picking the same one —
// last writer wins while both cite it, and no freshness gate notices (issue #283). The
// driver slices this per scene and holds each scene to its declared `captures` list.
const captured = [];

// Every scene page — withPage's and the hand-built ones — comes through here so the probe
// helpers are always installed before the renderer loads, and every capture lands in
// `captured` no matter which page took it.
async function newScenePage(browser, pageOpts) {
  const page = await browser.newPage(pageOpts);
  await page.addInitScript(PROBE_HELPERS);
  const screenshot = page.screenshot.bind(page);
  page.screenshot = (options = {}) => {
    if (options.path) captured.push(basename(options.path));
    return screenshot(options);
  };
  return page;
}

// Fit a popover page's viewport to its rendered card — the auto-size main.ts performs on show.
async function fitPopoverViewport(page) {
  const card = await page.evaluate(() => {
    const c = document.getElementById('pop');
    return { width: c.offsetWidth, height: c.offsetHeight };
  });
  await page.setViewportSize(popoverWindowSize(card));
}

async function withPage(browser, state, name, fn, initOpts = {}) {
  // timezoneId pinned like the explicitly-UTC scenes: the week-only Entries view derives
  // "today" (the default week, the today ring) from the PAGE's zone, so an unpinned page
  // would move those facts with the runner's timezone (CI is UTC; a local run must match).
  const page = await newScenePage(browser, { viewport: name === 'popover.html' ? POPOVER : WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
  // Pin the page clock so derived count-ups and the captured evidence are
  // byte-for-byte reproducible; the count-up only advances on explicit fastForward.
  await page.clock.install({ time: new Date(JUDGE_NOW) });
  await page.clock.pauseAt(new Date(JUDGE_NOW));
  await page.addInitScript(initScript(JSON.stringify(state), initOpts));
  await page.goto(fileUrl(name));
  if (name === 'popover.html') await fitPopoverViewport(page);
  const result = await fn(page);
  await page.close();
  return result;
}

// Issue 138 — what a refused write must never read like. Three internals leaked at once into
// the app's error regions: Electron's `ipcRenderer.invoke` wrapper ("Error invoking remote
// method 'edit': …"), the thrown class name ("StoreError: "), and — from core's own message —
// `tt`'s flag names ("--to must be after --from"), naming controls that exist nowhere in the
// GUI. The mocks now reject in Electron's real wrapped shape (fixtures.mjs __IPC_REJECT__), so
// this predicate is a genuine question about what the USER READS, not about the fixture:
// a non-empty message with none of the three in it. Every rejection scene folds it in.
const TRANSPORT_LEAK = /Error invoking remote method|StoreError|(^|\s)--[a-z]/;
const readsClean = (message) => typeof message === 'string' && message.length > 0 && !TRANSPORT_LEAK.test(message);

// Switch the 120ms paint transitions off for a scene that asserts COLOUR (design.html D10 gives
// every control a background / border-colour / shadow fade). These pages pin the clock, which
// freezes a fade wherever it started, and an in-flight transition's animated value OVERRIDES the
// cascade — so a computed-style probe, or a screenshot, taken after an interaction reads an
// arbitrary intermediate colour instead of the paint the rules declare, at whatever progress the
// frame happened to catch. With motion off, every paint assertion reads the cascade directly and
// the same interaction gives the same colour every run. Only motion is suppressed: that it exists,
// and collapses under prefers-reduced-motion, is A06's own static check.
const noMotion = (page) =>
  page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });

// Click a calendar event's INERT BODY — the "a click anywhere that is not an action control opens
// the unified editor" path (§12 R06). Aiming at a line selector (`.bd`, `.bt`) does not work:
// Playwright aims at an element's CENTRE, and a calendar event's centre-line real estate is
// contested. The ops chip is an overlay that reserves no flow space (issue #151 — hover must not
// move the text under the cursor), so it sits ON the top-right of the first line; the corner
// checkbox holds the top-left; a line below the block's height is clipped away entirely (issue
// #187); and an overlapping neighbour stacks over the block's tail. Which of those applies depends
// on the entry's duration and its neighbours, so the point is FOUND rather than assumed: scan the
// block for a spot that actually hit-tests to its own inert body, exactly as a user's eye does,
// and click there. Throws if the block has no clickable body left — itself worth failing on, since
// the click-to-edit affordance would then be unreachable.
async function clickEventBody(page, selector) {
  // Hit-testing is viewport-relative, so an off-hours event still below the 24h track's fold
  // would probe as empty. Bring it in first — the same scroll a user makes to reach it.
  await page.locator(selector).scrollIntoViewIfNeeded();
  const point = await page.evaluate((sel) => {
    const ev = document.querySelector(sel);
    const r = ev.getBoundingClientRect();
    // The renderer's own exclusion list (app.js wire()): a click on one of these is an action,
    // not a body click, and never opens the form.
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
  if (!point) throw new Error(`no clickable inert body on ${selector} — click-to-edit unreachable`);
  await page.mouse.click(point.x, point.y);
}

const results = [];
// A scene records a NAMED SUB-FACT MAP (issue #185), never a bare boolean: `pass` is every fact
// true, and judge-bind.test.ts binds the names to the rubric row's Sub-facts cell, so an
// assertion added or dropped here fails until the rubric row moves with it. `null` is the
// captured-but-not-machine-scored item, which never silently counts as a pass.
function record(item, facts, justification, screenshot) {
  if (facts !== null && (typeof facts !== 'object' || !Object.keys(facts).length)) {
    throw new Error(`${item}: expected a non-empty {name: boolean} sub-fact map, or null if unscored`);
  }
  const scored = facts && Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, !!v]));
  const pass = scored ? Object.values(scored).every(Boolean) : null;
  results.push({ item, pass, facts: scored ?? null, justification, screenshot });
}

// EMPTY_STATE — the empty main window instructs a concrete next action (§12 R5).
async function sceneEmptyState(browser) {
  await withPage(browser, emptyState(), 'index.html', async (page) => {
    const text = await page.textContent('.empty');
    await page.screenshot({ path: join(EVIDENCE, 'main-empty.png') });
    const namesHotkey = /Ctrl\+Alt\+T/.test(text);
    const namesCliStart = /tt start/.test(text);
    record(
      'EMPTY_STATE',
      { namesHotkey, namesCliStart },
      `empty state reads: ${JSON.stringify(text.trim())}`,
      'main-empty.png',
    );
  });
}

// NAV_SHELL — §12 R3 (G7) + design.html D12: the main window presents a persistent left-hand
// nav with the five views (Timer / Entries / Clients / Reports / Settings); the current view
// is highlighted and each item routes to its view.
async function sceneNavShell(browser) {
  await withPage(browser, emptyState(), 'index.html', async (page) => {
    const before = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.nav-item')];
      const labels = items.map((b) => b.querySelector('.nav-label')?.textContent.trim());
      const views = items.map((b) => b.dataset.view);
      const active = items.filter((b) => b.classList.contains('active'));
      const visibleViews = [...document.querySelectorAll('.view')].filter((v) => !v.hidden).map((v) => v.dataset.view);
      return {
        labels,
        views,
        activeCount: active.length,
        activeView: active[0]?.dataset.view ?? null,
        visibleViews,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-nav.png') });

    const chip = await page.evaluate(() => {
      const { rgbOf } = window.__probe;
      const paper = rgbOf('--paper');
      const ink = rgbOf('--ink');
      const accent = rgbOf('--accent');
      const active = document.querySelector('.nav-item.active');
      const inactive = [...document.querySelectorAll('.nav-item:not(.active)')];
      const cs = active ? getComputedStyle(active) : null;
      return {
        bgIsPaper: !!cs && cs.backgroundColor === paper,
        labelIsInk: !!active && getComputedStyle(active.querySelector('.nav-label')).color === ink,
        iconIsAccent: !!active && getComputedStyle(active.querySelector('.ic')).color === accent,
        lifted: !!cs && cs.boxShadow !== 'none',
        inactiveFlat: inactive.length === 4 && inactive.every((b) => getComputedStyle(b).boxShadow === 'none'),
        inactiveNoAccentIcon: inactive.every((b) => getComputedStyle(b.querySelector('.ic')).color !== accent),
      };
    });
    const chipOk =
      chip.bgIsPaper && chip.labelIsInk && chip.iconIsAccent && chip.lifted &&
      chip.inactiveFlat && chip.inactiveNoAccentIcon;

    await page.click('.nav-item[data-view="settings"]');
    const after = await page.evaluate(() => {
      const active = [...document.querySelectorAll('.nav-item.active')].map((b) => b.dataset.view);
      const visibleViews = [...document.querySelectorAll('.view')].filter((v) => !v.hidden).map((v) => v.dataset.view);
      const entriesHidden = !!document.querySelector('.view[data-view="entries"]')?.hidden;
      return { active, visibleViews, entriesHidden };
    });

    const everyView = [];
    for (const view of ['timer', 'entries', 'clients', 'reports', 'settings']) {
      await page.click(`.nav-item[data-view="${view}"]`);
      const probe = await page.evaluate((v) => {
        const nav = document.querySelector('.shell .nav');
        const cs = nav ? getComputedStyle(nav) : null;
        const r = nav ? nav.getBoundingClientRect() : { width: 0 };
        const visibleViews = [...document.querySelectorAll('.view')]
          .filter((s) => !s.hidden)
          .map((s) => s.dataset.view);
        return {
          view: v,
          railVisible: !!nav && !nav.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0,
          railWidth: Math.round(r.width),
          visibleViews,
        };
      }, view);
      everyView.push(probe);
    }
    const sidebarEveryView =
      everyView.length === 5 &&
      everyView.every((p) => p.railVisible && p.visibleViews.length === 1 && p.visibleViews[0] === p.view);

    const measure = () =>
      page.evaluate(() => {
        const nav = document.querySelector('.shell .nav');
        const views = document.querySelector('.shell .views');
        return {
          rail: Math.round(nav.getBoundingClientRect().width),
          views: Math.round(views.getBoundingClientRect().width),
        };
      });
    const at1040 = await measure();
    await page.setViewportSize({ width: 1440, height: WINDOW.height });
    const at1440 = await measure();
    await page.setViewportSize({ width: 1920, height: WINDOW.height });
    const at1920 = await measure();
    await page.screenshot({ path: join(EVIDENCE, 'main-nav-wide.png') });
    // Restore the default viewport so the page state matches the rest of the harness.
    await page.setViewportSize(WINDOW);
    const fixedWidthOnResize =
      at1040.rail === at1440.rail &&
      at1040.rail === at1920.rail &&
      at1440.views !== at1040.views &&
      at1920.views !== at1440.views;

    const orderOk =
      before.labels.join(',') === 'Timer,Entries,Clients,Reports,Settings' &&
      before.views.join(',') === 'timer,entries,clients,reports,settings';
    const defaultOk =
      before.activeCount === 1 &&
      before.activeView === 'entries' &&
      before.visibleViews.length === 1 &&
      before.visibleViews[0] === 'entries';
    const routedOk =
      after.active.length === 1 &&
      after.active[0] === 'settings' &&
      after.visibleViews.length === 1 &&
      after.visibleViews[0] === 'settings' &&
      after.entriesHidden;
    record(
      'NAV_SHELL',
      { orderOk, defaultOk, routedOk, sidebarEveryView, fixedWidthOnResize, chipOk },
      `nav order ${JSON.stringify(before.labels)}; default active=${before.activeView} (one view shown); ` +
        `D12 lifted chip (paper bg + ink label + accent icon + shadow; inactive flat)=${chipOk} ${JSON.stringify(chip)}; ` +
        `clicking Settings routed: active=${JSON.stringify(after.active)} visible=${JSON.stringify(after.visibleViews)}; ` +
        `sidebar-every-view rail visible on all five=${sidebarEveryView} ` +
        `(${everyView.map((p) => `${p.view}:w${p.railWidth}/${p.railVisible ? 'shown' : 'HIDDEN'}`).join(', ')}); ` +
        `fixed-width-on-resize rail=${at1040.rail}/${at1440.rail}/${at1920.rail} (1040/1440/1920) ` +
        `views=${at1040.views}/${at1440.views}/${at1920.views} → ${fixedWidthOnResize}`,
      'main-nav.png',
    );
  });
}

// KEYBOARD_FOCUS — §12 R14 / §14 + design.html A04 (focus visible): the keyboard-operability
// + focus pass, driven on both the empty and the running main window.
async function sceneKeyboardFocus(browser) {
  const focusWalk = async (page) => {
    // Tag every control that SHOULD receive focus — visible, not disabled, not removed from the
    // tab order — with a UNIQUE marker (data-focus-id). Identity is per-element, not by tag/class:
    // five nav items and six presets are five and six distinct stops, not one apiece, so the
    // walk's "reached" count is the real number of controls — never collapsed by a shared class.
    // Mirrors the browser's own tab-order candidate filter closely enough for the walk.
    const focusables = await page.evaluate(() => {
      const sel = 'button, [tabindex]:not([tabindex="-1"]), a[href], input, select, textarea';
      let n = 0;
      for (const el of document.querySelectorAll(sel)) {
        if (el.hidden || el.disabled) continue;
        // A `tabindex="-1"` element is focusable but NOT in the tab order, and `button` / `input`
        // match the selector above on their own — so the negation has to be re-applied per element
        // or the calendar's block-scoped controls (issue 140) would be counted as stops Tab can
        // never reach, and the walk would fail for finding exactly what it asked for.
        if (el.getAttribute('tabindex') === '-1') continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        // Hidden ancestors (a collapsed form / a routed-away view) take their controls out too.
        if (el.closest('[hidden]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        el.setAttribute('data-focus-id', String(n++));
      }
      return n;
    });
    // A04 delta baseline: capture every marked control's UNFOCUSED outline/box-shadow
    // signature before the walk starts (nothing is focused yet — the walk begins on <body>).
    // A ring is then a CHANGE against this baseline, so a chip's persistent lift shadow —
    // identical focused and unfocused — no longer counts as a ring.
    const baseline = await page.evaluate(() => {
      const map = {};
      for (const el of document.querySelectorAll('[data-focus-id]')) {
        const cs = getComputedStyle(el);
        map[el.getAttribute('data-focus-id')] =
          `${cs.outlineStyle}|${cs.outlineWidth}|${cs.outlineColor}|${cs.boxShadow}`;
      }
      return map;
    });
    // Tab through, recording each control we land on by its unique marker and whether it shows a
    // visible ring under keyboard focus. We stop once every marked control has been reached (the
    // walk has cycled through the whole tab order) or the budget is exhausted. A single body /
    // document focus is the browser's NATURAL wrap point at the end of the cycle, not a trap; a
    // trap is focus that CANNOT advance — two body hits in a row with no control in between, i.e.
    // Tab from <body> failed to move forward.
    const reached = new Set();
    const ringMisses = [];
    let trappedOnBody = false;
    let prevOnBody = false;
    const budget = focusables * 2 + 8;
    for (let i = 0; i < budget; i++) {
      await page.keyboard.press('Tab');
      const step = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) {
          return { onBody: true };
        }
        // Read the control's outline/box-shadow signature RIGHT NOW (it has :focus-visible
        // from the Tab press); the caller compares it against the unfocused baseline — a ring
        // is a DELTA, never a persistent decoration (A04 hardening).
        const cs = getComputedStyle(el);
        const id = el.getAttribute('data-focus-id');
        const label = el.id || `${el.tagName.toLowerCase()}.${el.className || ''}`;
        return {
          onBody: false,
          id,
          label,
          sig: `${cs.outlineStyle}|${cs.outlineWidth}|${cs.outlineColor}|${cs.boxShadow}`,
        };
      });
      if (step.onBody) {
        if (prevOnBody) trappedOnBody = true; // stuck: Tab from body did not advance to a control
        prevOnBody = true;
        continue;
      }
      prevOnBody = false;
      // A control outside the marked set (id === null) means the candidate filter and the real
      // tab order disagree — surface it as a ring miss so the disagreement can't pass silently.
      if (step.id === null) { ringMisses.push(step.label); continue; }
      if (reached.has(step.id)) {
        if (reached.size >= focusables) break; // cycled back around the whole tab order — done
        continue;
      }
      reached.add(step.id);
      if (step.sig === baseline[step.id]) ringMisses.push(step.label);
      if (reached.size >= focusables) break;
    }
    return { focusables, reached: reached.size, ringMisses, trappedOnBody };
  };

  await withPage(browser, emptyState(), 'index.html', async (page) => {
    const empty = await focusWalk(page);
    // §12 R05: the primary toggle moved to the Timer view (the GUI core-entry surface), so
    // route there before focusing it for the ring screenshot (it is not visible on Entries).
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #toggle');
    await page.focus('#toggle');
    await page.screenshot({ path: join(EVIDENCE, 'main-focus.png') });
    const running = await withPage(browser, runningState(), 'index.html', async (rp) => focusWalk(rp));
    // Every visible control reached by Tab, each showing a visible ring, and focus never stuck
    // on <body> (no trap / void) — on both windows.
    const emptyWalkComplete = empty.focusables > 0 && empty.reached === empty.focusables;
    const emptyRingsVisible = empty.ringMisses.length === 0;
    const emptyNoTrap = !empty.trappedOnBody;
    const runningWalkComplete = running.focusables > 0 && running.reached === running.focusables;
    const runningRingsVisible = running.ringMisses.length === 0;
    const runningNoTrap = !running.trappedOnBody;
    record(
      'KEYBOARD_FOCUS',
      {
        emptyWalkComplete,
        emptyRingsVisible,
        emptyNoTrap,
        runningWalkComplete,
        runningRingsVisible,
        runningNoTrap,
      },
      `Tab-walk reached ${empty.reached}/${empty.focusables} controls (empty) and ` +
        `${running.reached}/${running.focusables} (running); ring misses ` +
        `empty=[${empty.ringMisses.join(', ') || 'none'}] running=[${running.ringMisses.join(', ') || 'none'}]; ` +
        `trapped-on-body empty=${empty.trappedOnBody} running=${running.trappedOnBody}`,
      'main-focus.png',
    );
  });
}

// TRAY_COUNTUP (popover) — single running timer counting up; +~3s between captures (§12 R1).
async function sceneTrayCountup(browser) {
  await withPage(browser, runningState(), 'popover.html', async (page) => {
    const t1 = await page.textContent('#count');
    await page.screenshot({ path: join(EVIDENCE, 'popover-running-1.png') });
    // Advance exactly 3s and stay frozen there (pauseAt, not fastForward, so the
    // clock does not resume and the second capture is reproducible).
    await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + 3000));
    const t2 = await page.textContent('#count');
    await page.screenshot({ path: join(EVIDENCE, 'popover-running-2.png') });
    const toSec = (s) => {
      const [h, m, sec] = s.split(':').map(Number);
      return h * 3600 + m * 60 + sec;
    };
    const delta = toSec(t2) - toSec(t1);
    const clockSeeded = t1 === '01:24:07';
    const countsUp = delta === 3;
    record(
      'TRAY_COUNTUP',
      { clockSeeded, countsUp },
      `popover count advanced ${t1} → ${t2} (+${delta}s)`,
      'popover-running-2.png',
    );
  });
}

// TRAY_POPOVER_SURFACE — §12 R01 / G8: the compact popover is the SOLE tray action
// surface. The tray's own click/right-click has no host headless — confirmed under MANUAL.
async function sceneTrayPopoverSurface(browser) {
  await withPage(browser, runningState(), 'popover.html', async (page) => {
    const runningProbe = await page.evaluate(() => {
      const toggle = document.querySelector('#toggle');
      const open = document.querySelector('#open');
      return {
        toggleLabel: toggle ? toggle.textContent.trim() : null,
        togglePressed: toggle ? toggle.getAttribute('aria-pressed') : null,
        noSwitch: !document.querySelector('#switch'),
        openPresent: !!open,
        openLabel: open ? open.textContent.trim() : null,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'popover-tray-surface.png') });
    await page.screenshot({ path: join(EVIDENCE, 'popover-running.png') });

    const idleProbe = await withPage(browser, emptyState(), 'popover.html', async (ip) =>
      ip.evaluate(() => {
        const toggle = document.querySelector('#toggle');
        const open = document.querySelector('#open');
        return {
          toggleLabel: toggle ? toggle.textContent.trim() : null,
          togglePressed: toggle ? toggle.getAttribute('aria-pressed') : null,
          noSwitch: !document.querySelector('#switch'),
          openPresent: !!open,
        };
      }),
    );

    const runningOk =
      runningProbe.toggleLabel === 'Stop' &&
      runningProbe.togglePressed === 'true' &&
      runningProbe.noSwitch &&
      runningProbe.openPresent &&
      /Open Stint/.test(runningProbe.openLabel ?? '');
    const idleOk =
      idleProbe.toggleLabel === 'Start' &&
      idleProbe.togglePressed === 'false' &&
      idleProbe.noSwitch &&
      idleProbe.openPresent;
    record(
      'TRAY_POPOVER_SURFACE',
      { runningOk, idleOk },
      `popover is the sole tray action surface (no Switch) — running: Stop+Open present, no #switch ${JSON.stringify(runningProbe)}; ` +
        `idle: Start + Open present, no #switch ${JSON.stringify(idleProbe)}`,
      'popover-tray-surface.png',
    );
  });
}

// POPOVER_REJECT — §12 R21 / §12 R01 (STATES.md Popover × error): a REFUSED Stop/Start from
// the tray popover is surfaced in the popover's OWN announced message region (#pop-warning,
// popover.js), never a silent no-op — the tray twin of the main window's banner-routed toggle
// rejection (WRITE_REJECTION_FEEDBACK site d, which uses the same rejectWrites toggle mock).
async function scenePopoverReject(browser) {
  await withPage(browser, runningState(), 'popover.html', async (page) => {
    await page.click('#toggle');
    await page.waitForSelector('#pop-warning', { state: 'visible' });
    const refused = await page.evaluate(() => {
      const warn = document.querySelector('#pop-warning');
      const rect = warn?.getBoundingClientRect();
      const toggle = document.querySelector('#toggle');
      const open = document.querySelector('#open');
      return {
        shown: !!warn && !warn.hidden && (rect?.width ?? 0) > 0 && (rect?.height ?? 0) > 0 && warn.textContent.trim().length > 0,
        announced: warn?.getAttribute('role') === 'status' && warn?.hasAttribute('aria-live'),
        message: warn?.textContent.trim() ?? '',
        toggleLive: !!toggle && !toggle.disabled && /Stop/.test(toggle.textContent),
        stillRunning: !!document.querySelector('#pop.running'),
        openPresent: !!open && !open.disabled,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'popover-reject.png') });

    await page.click('#toggle');
    await page.waitForSelector('#pop-warning', { state: 'visible' });
    const again = await page.evaluate(() => ({
      shown: !document.querySelector('#pop-warning').hidden &&
        document.querySelector('#pop-warning').textContent.trim().length > 0,
      toggleLive: !document.querySelector('#toggle').disabled,
    }));

    const refusalAnnounced = refused.shown && refused.announced;
    // Issue 138: the popover reads the same one mapping site (SU.errMessage), so the
    // Electron-wrapped rejection must land here as the reason ALONE — the tray surface is
    // the smallest region in the app and had the least room for a transport sentence.
    const reasonAlone =
      refused.message === 'stop time is before the entry started' && readsClean(refused.message);
    const stillOperable = refused.toggleLive && refused.stillRunning && refused.openPresent;
    const repeatable = again.shown && again.toggleLive;
    record(
      'POPOVER_REJECT',
      { refusalAnnounced, reasonAlone, stillOperable, repeatable },
      `refused popover toggle surfaced + operable: ${JSON.stringify(refused)}; second attempt ${JSON.stringify(again)}`,
      'popover-reject.png',
    );
  }, { rejectWrites: true });
}

// IN_WINDOW_TIMER (main window) — §12 R04 + R14: the FULL Active-Timer card lives in the
// Timer view, and the Entries view keeps only a COMPACT STRIP that mirrors the running
// count-up/state/desc and links to the Timer view. A third, IDLE page (STATES.md Entries ×
// edge) asserts the strip is STILL PAINTED with nothing running.
async function sceneInWindowTimer(browser) {
  await withPage(browser, runningState(), 'index.html', async (page) => {
    const strip = await page.evaluate(() => {
      const el = document.querySelector('#timer-strip');
      // design.html D06 — the strip clock is the compact Clock role: 24px, tabular numerals
      // (computed style, so a stylesheet regression cannot hide behind the right markup).
      const clockCs = getComputedStyle(document.querySelector('#strip-clock'));
      return {
        present: !!el,
        running: !!el && el.classList.contains('running'),
        clock: document.querySelector('#strip-clock')?.textContent?.trim() ?? null,
        clockPx: clockCs.fontSize,
        clockTnum: clockCs.fontVariantNumeric === 'tabular-nums',
        state: document.querySelector('#strip-state')?.textContent?.trim() ?? null,
        desc: document.querySelector('#strip-desc')?.textContent?.trim() ?? null,
        noStop: !document.querySelector('#timer-strip #timer-stop'),
        noSwitch: !document.querySelector('#timer-switch'),
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-timer.png') });

    await page.click('.nav-item[data-view="timer"]');
    const t1 = await page.textContent('#timer-clock');
    await page.screenshot({ path: join(EVIDENCE, 'timer-view.png') });
    // Advance exactly 3s and stay frozen there (pauseAt, not fastForward) so the second
    // read is reproducible — the card's tick() must have advanced the count-up.
    await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + 3000));
    const probe = await page.evaluate(() => {
      const card = document.querySelector('#timer-card');
      const inTimerView = !!card && !!card.closest('.view[data-view="timer"]');
      return {
        inTimerView,
        clock: document.querySelector('#timer-clock')?.textContent ?? null,
        running: !!card && card.classList.contains('running'),
        state: document.querySelector('#timer-state')?.textContent?.trim() ?? null,
        desc: document.querySelector('#timer-desc')?.textContent?.trim() ?? null,
        meta: document.querySelector('#timer-meta')?.textContent?.trim() ?? null,
        hasStop: !!document.querySelector('#timer-stop') && !document.querySelector('#timer-stop').hidden,
        noSwitch: !document.querySelector('#timer-switch'),
      };
    });
    const toSec = (s) => {
      const [h, m, sec] = s.split(':').map(Number);
      return h * 3600 + m * 60 + sec;
    };
    const delta = toSec(probe.clock) - toSec(t1);
    const cardOk =
      probe.inTimerView &&
      t1 === '01:24:07' &&
      delta === 3 &&
      probe.running &&
      probe.state === 'running' &&
      probe.desc === 'auth refactor' &&
      /Client A \/ API/.test(probe.meta) &&
      probe.hasStop &&
      probe.noSwitch;
    const stripOk =
      strip.present &&
      strip.running &&
      strip.clock === '01:24:07' &&
      strip.clockPx === '24px' &&
      strip.clockTnum &&
      strip.state === 'running' &&
      strip.desc === 'auth refactor' &&
      strip.noStop &&
      strip.noSwitch;

    const idleStrip = await withPage(browser, emptyState(), 'index.html', async (ip) => {
      await ip.waitForFunction(() => document.querySelector('#timer-strip')?.classList.contains('idle'));
      await ip.screenshot({ path: join(EVIDENCE, 'main-timer-idle.png') });
      return ip.evaluate(() => {
        const el = document.querySelector('#timer-strip');
        return {
          present: !!el,
          idle: !!el && el.classList.contains('idle') && !el.classList.contains('running'),
          clock: document.querySelector('#strip-clock')?.textContent?.trim() ?? null,
          state: document.querySelector('#strip-state')?.textContent?.trim() ?? null,
          desc: document.querySelector('#strip-desc')?.textContent?.trim() ?? null,
        };
      });
    });
    const idleOk =
      idleStrip.present &&
      idleStrip.idle &&
      idleStrip.clock === '00:00:00' &&
      idleStrip.state === 'idle' &&
      idleStrip.desc === '';
    record(
      'IN_WINDOW_TIMER',
      { cardOk, stripOk, idleOk },
      `Timer-view card count advanced ${t1} → ${probe.clock} (+${delta}s) ${JSON.stringify(probe)}; ` +
        `Entries strip ${JSON.stringify(strip)}; idle strip ${JSON.stringify(idleStrip)}`,
      'timer-view.png',
    );
  });
}

// CROSS_VIEW_FRESHNESS — §12 R04 (issue #50 regression): the Active-Timer card mirrors
// `tt status` EVEN AFTER an Entries-toolbar control has been touched. Drive the exact
// reported path over the idle list fixture.
async function sceneCrossViewFreshness(browser) {
  await withPage(
    browser,
    listState(),
    'index.html',
    async (page) => {
      // Touch the week machinery (the range presets are gone, §12 R09): stepping to the
      // previous week latches the toolbar's entries-only query exactly as a preset used to.
      await page.click('#el-prev-week');
      await page.waitForFunction(() => window.__LIST_REQ__?.fromDate === '2026-06-15');
      const latched = await page.evaluate(() => window.__LIST_REQ__ ?? null);
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-card');
      const idle = await page.evaluate(() => ({
        state: document.querySelector('#timer-state')?.textContent?.trim() ?? null,
        toggle: document.querySelector('#toggle')?.textContent?.trim() ?? null,
        clock: document.querySelector('#timer-clock')?.textContent?.trim() ?? null,
      }));
      // The no-reload marker: a page reload would wipe it, so its survival proves the flip
      // below came from a live repaint of the same document — never a reload/reroute.
      await page.evaluate(() => { window.__NO_RELOAD__ = true; });
      // (c) Click Start. The handler's toggle → load() → render chain is all microtasks; poll
      // from the harness side (real time — the page clock stays pinned) until the card flips.
      await page.click('#toggle');
      let after = null;
      for (let i = 0; i < 40; i++) {
        after = await page.evaluate(() => {
          const visible = (el) => !!el && el.getClientRects().length > 0;
          return {
            state: document.querySelector('#timer-state')?.textContent?.trim() ?? null,
            // §12 R05 (issue #51, merged since this fact was drafted): while running the whole
            // start panel — and the one-tap #toggle inside it — is hidden; the running card's
            // visible primary is #timer-stop. Assert that post-click surface, not the label of
            // a control the user can no longer see.
            panelHidden: !!document.querySelector('#start-panel')?.hidden,
            startVisible: visible(document.querySelector('#toggle')),
            stopVisible: visible(document.querySelector('#timer-stop')),
            running: !!document.querySelector('#timer-card')?.classList.contains('running'),
            clock: document.querySelector('#timer-clock')?.textContent?.trim() ?? null,
            noReload: window.__NO_RELOAD__ === true,
          };
        });
        if (after.state === 'running') break;
        await page.waitForTimeout(50);
      }
      await page.screenshot({ path: join(EVIDENCE, 'timer-cross-view.png') });
      await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + 3000));
      const clock2 = (await page.textContent('#timer-clock')).trim();
      const toolbarLatched =
        !!latched && latched.by === 'day' && latched.fromDate === '2026-06-15' && latched.toDate === '2026-06-21';
      const idleCard = idle.state === 'idle' && idle.toggle === 'Start' && idle.clock === '00:00:00';
      const flipsInPlace =
        !!after &&
        after.state === 'running' &&
        after.panelHidden &&
        !after.startVisible &&
        after.stopVisible &&
        after.running &&
        after.noReload &&
        after.clock === '00:00:00';
      const countsUp = clock2 === '00:00:03';
      record(
        'CROSS_VIEW_FRESHNESS',
        { toolbarLatched, idleCard, flipsInPlace, countsUp },
        `Entries toolbar latched (listEntries query ${JSON.stringify(latched)}); Timer card before Start ` +
          `${JSON.stringify(idle)}; after Start (no reload) ${JSON.stringify(after)}; count-up then ` +
          `advanced ${after ? after.clock : 'n/a'} → ${clock2} across a +3s pinned-clock step`,
        'timer-cross-view.png',
      );
    },
    { toggleStarts: true },
  );
}

// TIMER_VIEW (full Timer view, G5) — §12 R14 / §05 R06: the START-ONLY scene. The page is
// pinned to timezoneId 'UTC' so the seeded UTC instants land on a deterministic local day/track
// geometry.
// A second page over the same card scores the ATTRIBUTE-VS-ADVISORY split (design.html D04/D14,
// issue #160): with an open entry that is billable AND slept through, the card's attribute row
// carries both roles at once, and `slept` must take the whole --flag warn triple while `billable`
// — the normal state of nearly every entry — stays the quiet --muted label, with no pill chrome
// and no part of that triple. Scored as one pair, because the bug guarded painted BOTH amber.
async function sceneTimerView(browser) {
  {
    const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.install({ time: new Date(JUDGE_NOW) });
    await page.clock.pauseAt(new Date(JUDGE_NOW));
    await page.addInitScript(initScript(JSON.stringify(timerViewRunningState()), {}));
    await page.goto(fileUrl('index.html'));

    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-clock');
    const t1 = await page.textContent('#timer-clock');
    const before = await page.evaluate(() => {
      // design.html D06 — the Timer-view clock is the full Clock role: 38px, tabular
      // numerals, on the generated --num stack (all computed style; family lists compare
      // quote/space-normalized because computed fontFamily re-serializes the stack).
      const clockCs = getComputedStyle(document.querySelector('#timer-clock'));
      const famList = (s) => s.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).join('|');
      // Absent rather than thrown: a missing dot or state line is the regression this scene
      // scores, so it must arrive as a false in the record, not an exception that kills the run.
      const dot = document.querySelector('#timer-card .tc-dot');
      const stateEl = document.querySelector('#timer-state');
      return {
        stripPresent: !!document.querySelector('#live-edit') && !document.querySelector('#live-edit').hidden,
        noEnd: !document.querySelector('#live-edit #le-end'),
        startIsText: document.querySelector('#le-start')?.type === 'text',
        hasStop: !!document.querySelector('#timer-stop') && !document.querySelector('#timer-stop').hidden,
        noSwitch: !document.querySelector('#timer-switch'),
        // design.html D05/A05 (issue #142): the card must SAY it is running, not merely hold a
        // #timer-state node that says so. The probe here used to read that node's textContent,
        // which a display:none state line satisfied for as long as the bug shipped — so the
        // OUTCOME is scored instead: the rendered card text (innerText skips display:none
        // subtrees, which is exactly what hid the word), and the word coming from the state
        // line rather than from elsewhere on the card (the IDLE description reads "nothing
        // running", so an unanchored text match would pass on a card that had lost the line).
        // innerText on the ELEMENT could not settle this — the HTML spec falls it back to
        // textContent when the element is not rendered, i.e. exactly in the failing case.
        cardText: document.querySelector('#timer-card').innerText.toLowerCase(),
        statePainted: window.__probe.visible(stateEl) && stateEl.textContent.trim() === 'running',
        dotVisible: window.__probe.visible(dot),
        dotFill: dot ? getComputedStyle(dot).backgroundColor : null,
        accentRgb: window.__probe.rgbOf('--accent'),
        clockPx: clockCs.fontSize,
        clockTnum: clockCs.fontVariantNumeric === 'tabular-nums',
        clockNumStack: famList(clockCs.fontFamily) === famList(window.__probe.cssVar('--num')),
      };
    });
    // Advance the pinned clock +3s — the card's tick() must advance the live count-up (the
    // count-up never stops while the start is being edited, §05 R06).
    await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + 3000));
    const t2 = await page.textContent('#timer-clock');

    await page.click('#le-start-pick');
    await page.waitForSelector('#le-start-disc:not([hidden]) .stp-grip', { state: 'attached' });
    const disc = await page.evaluate(() => {
      const host = document.querySelector('#le-start-disc');
      const box = host.querySelector('.stp-inline');
      const me = host.querySelector('.stp-block.me.open');
      const cs = me ? getComputedStyle(me) : null;
      const mask = cs ? cs.maskImage || cs.webkitMaskImage || '' : '';
      return {
        inFlow: !!box && getComputedStyle(box).position === 'static',
        noBackdrop: !document.querySelector('.stp-backdrop'),
        noDialog: !host.querySelector('[role="dialog"], [aria-modal]'),
        expanded: document.querySelector('#le-start-pick')?.getAttribute('aria-expanded') === 'true',
        grip: !!host.querySelector('.stp-grip'),
        noResize: !host.querySelector('.stp-resize'),
        noEndLabel: !host.querySelector('.stp-lab-bot'),
        noEndEcho: !host.querySelector('.stp-echo-end'),
        fade: /gradient/.test(mask),
        others: host.querySelectorAll('.stp-block.other').length,
        startBefore: document.querySelector('#le-start')?.value ?? null,
        // issue #159: the field the user reads and RETYPES carries no `T` wire separator, and
        // its placeholder describes the very shape it renders — the two agreed on nothing before.
        startPlaceholder: document.querySelector('#le-start')?.placeholder ?? null,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'timer-view-full.png'), fullPage: true });

    // Drag the start grip UP by 30px (720px track / 24h → 0.5px per minute → -60min, 5-min
    // snapped): the raw #le-start text must advance LIVE from the exact 21:35:53 to the
    // snapped 20:35 (UTC page) — the drag is the user's edit, so the dragged handle snaps.
    const grip = page.locator('#le-start-disc .stp-grip');
    await grip.scrollIntoViewIfNeeded();
    const g = await grip.boundingBox();
    const gx = Math.round(g.x + g.width / 2);
    const gy = Math.round(g.y + g.height / 2);
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(gx, gy - 30, { steps: 6 });
    await page.mouse.up();
    const dragged = await page.evaluate(() => ({
      startLive: document.querySelector('#le-start')?.value ?? null,
      stillNoEndChrome: !document.querySelector('#le-start-disc .stp-resize') &&
        !document.querySelector('#le-start-disc .stp-lab-bot'),
      noBackdrop: !document.querySelector('.stp-backdrop'),
    }));

    // Let the debounced live-edit commit settle (scheduleLiveEdit waits 500ms) and assert the
    // committed patch: startUtc present, NO endUtc key (the load-bearing §05 R06 invariant).
    await page.clock.fastForward(600);
    await page.waitForFunction(() => !!window.__EDITED__);
    const edited = await page.evaluate(() => window.__EDITED__);
    const toSec = (s) => { const [h, m, sec] = s.split(':').map(Number); return h * 3600 + m * 60 + sec; };
    const delta = toSec(t2) - toSec(t1);
    const clockLive = t1 === '01:24:07' && delta === 3;
    const clockRole = before.clockPx === '38px' && before.clockTnum && before.clockNumStack;
    const startOnlyStrip =
      before.stripPresent && before.noEnd && before.startIsText && before.hasStop && before.noSwitch;
    // D05/A05 (issue #142) — the word reaches the rendered card, it comes from the state
    // line, and the dot beside it is laid out and accent-filled. Colour alone no longer
    // carries the app's most important state.
    const saysRunning =
      before.cardText.includes('running') &&
      before.statePainted &&
      before.dotVisible &&
      before.dotFill === before.accentRgb;
    const discInFlow = disc.inFlow && disc.noBackdrop && disc.noDialog && disc.expanded;
    const startOnlyPicker =
      disc.grip &&
      disc.noResize &&
      disc.noEndLabel &&
      disc.noEndEcho &&
      disc.fade &&
      disc.others >= 1;
    // §12 R15 (issue #49): the strip renders the stored start EXACTLY, to the second — the
    // fixture's open row started 5047s (01:24:07) before the 23:00:00Z pinned clock = 21:35:53.
    // issue #159: the rendered value matches NO `T`-separated pattern — it is the string the
    // user selects and retypes, not a serialization — and the placeholder promises exactly it.
    const startSeededExactly =
      disc.startBefore === '2026-06-24 21:35:53' &&
      !/\d{4}-\d{2}-\d{2}T/.test(disc.startBefore) &&
      disc.startPlaceholder === 'YYYY-MM-DD HH:mm:ss' &&
      new RegExp(`^${disc.startPlaceholder.replace(/[A-Za-z]/g, '\\d')}$`).test(disc.startBefore);
    const dragWritesLive =
      dragged.startLive === '2026-06-24 20:35:00' &&
      !/\d{4}-\d{2}-\d{2}T/.test(dragged.startLive) &&
      dragged.stillNoEndChrome &&
      dragged.noBackdrop;
    const patchStartOnly =
      !!edited &&
      typeof edited.id === 'number' &&
      !!edited.patch &&
      !('endUtc' in edited.patch) && // the load-bearing invariant — the open row stays open
      edited.patch.startUtc === '2026-06-24T20:35:00.000Z';
    await page.close();

    // design.html D04/D14 (issue #160) — AN ATTRIBUTE IS NOT AN ADVISORY. The same running card,
    // over a fixture whose open entry is billable AND slept through, so both kinds of thing paint
    // in the one attribute row and the distinction itself is what gets measured. `slept` is the
    // advisory and takes the whole --flag warn triple; `billable` — the normal, overwhelmingly
    // common state of a tracked entry — is the quiet neutral --muted label, with no pill chrome
    // and none of the flag triple. Both are worded (D05: colour is never the only signal), and
    // neither is the accent, which stays on the running clock/state and Stop (§15). Scored as one
    // pair on purpose: the shipped bug painted BOTH labels amber, and every check that reads one
    // colour in isolation passes on exactly that — amber `billable` is a perfectly good warn pill.
    const palettePage = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
    await palettePage.clock.install({ time: new Date(JUDGE_NOW) });
    await palettePage.clock.pauseAt(new Date(JUDGE_NOW));
    await palettePage.addInitScript(initScript(JSON.stringify(timerViewSleptRunningState()), {}));
    await palettePage.goto(fileUrl('index.html'));
    await palettePage.click('.nav-item[data-view="timer"]');
    await palettePage.waitForSelector('[data-view="timer"]:not([hidden]) #timer-flags .flag', { state: 'attached' });
    await noMotion(palettePage); // a paint assertion reads the cascade, never a mid-transition frame
    await palettePage.screenshot({ path: join(EVIDENCE, 'timer-card-attr-vs-flag.png'), fullPage: true });
    const paint = await palettePage.evaluate(() => {
      const { rgbOf, visible } = window.__probe;
      const row = document.querySelector('#timer-flags');
      // Selected by ROLE, not by position: the bug was the two roles sharing one class, so a
      // probe that read "the first label in the row" could not have told them apart at all.
      const attr = row?.querySelector('.attr') ?? null;
      const flag = row?.querySelector('.flag') ?? null;
      const csA = attr ? getComputedStyle(attr) : null;
      const csF = flag ? getComputedStyle(flag) : null;
      return {
        attrShown: visible(attr),
        flagShown: visible(flag),
        attrText: attr ? attr.textContent.trim() : '',
        flagText: flag ? flag.textContent.trim() : '',
        attrColor: csA ? csA.color : null,
        attrBg: csA ? csA.backgroundColor : null,
        attrBorderWidth: csA ? csA.borderTopWidth : null,
        attrRadius: csA ? csA.borderTopLeftRadius : null,
        flagPaint: csF ? [csF.color, csF.backgroundColor, csF.borderTopColor] : null,
        flagRadius: csF ? csF.borderTopLeftRadius : null,
        flagTriple: [rgbOf('--flag'), rgbOf('--flag-bg'), rgbOf('--flag-line')],
        muted: rgbOf('--muted'),
        accent: rgbOf('--accent'),
        accentSolid: rgbOf('--accent-solid'),
        accentWeak: rgbOf('--accent-weak'),
      };
    });
    await palettePage.close();
    const attrVsFlag =
      paint.attrShown &&
      paint.flagShown &&
      paint.attrText === 'billable' &&
      paint.flagText === 'slept' &&
      !!paint.flagPaint &&
      paint.flagPaint.every((v, i) => v === paint.flagTriple[i]) &&
      paint.flagRadius === '999px' &&
      paint.attrColor === paint.muted &&
      paint.attrColor !== paint.flagTriple[0] &&
      paint.attrBg === 'rgba(0, 0, 0, 0)' &&
      paint.attrBorderWidth === '0px' &&
      paint.attrRadius === '0px' &&
      paint.attrColor !== paint.accent &&
      paint.attrColor !== paint.accentSolid &&
      paint.attrBg !== paint.accentWeak;
    record(
      'TIMER_VIEW',
      {
        clockLive,
        clockRole,
        startOnlyStrip,
        saysRunning,
        discInFlow,
        startOnlyPicker,
        startSeededExactly,
        dragWritesLive,
        patchStartOnly,
        attrVsFlag,
      },
      `Timer clock ${t1} → ${t2} (+${delta}s); strip ${JSON.stringify(before)}; ` +
        `start-only disclosure ${JSON.stringify(disc)}; grip drag → ${JSON.stringify(dragged)}; ` +
        `edit patch ${JSON.stringify(edited)} (endUtc present: ${edited && edited.patch ? ('endUtc' in edited.patch) : 'n/a'}); ` +
        `attribute-vs-advisory paint ${JSON.stringify(paint)}`,
      'timer-view-full.png',
    );
  }
}

// FUTURE_START_GUARD — §05 R06 / §03 / §16 (issue #61): a MISTYPED FUTURE start on the running
// entry must be REFUSED and surfaced WHERE it was typed, never the silent wedge the bug caused
// ("Stop appears dead"). Pinned to timezoneId 'UTC' so the typed instants map determin-
// istically to UTC. Builds on the WRITE_REJECTION_FEEDBACK precedent (the #65 #timer-warning region).
async function sceneFutureStartGuard(browser) {
  {
    const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.install({ time: new Date(JUDGE_NOW) });
    await page.clock.pauseAt(new Date(JUDGE_NOW));
    await page.addInitScript(initScript(JSON.stringify(runningState()), { futureStartGuard: true, toggleStarts: true }));
    await page.goto(fileUrl('index.html'));

    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-clock');
    // Type a FUTURE instant (the next calendar day, unambiguously after the pinned now) into the
    // running Start field and let the debounced live-edit commit (scheduleLiveEdit, 500ms) fire.
    // Typed in the OLD `T` spelling on purpose (issue #159): the field renders space-separated
    // now, but everything a user already knows how to type must still parse and reach core.
    await page.fill('#le-start', '2026-06-25T10:00');
    await page.clock.fastForward(600);
    await page.waitForSelector('#timer-warning', { state: 'visible' });
    const refused = await page.evaluate(() => {
      const t = document.querySelector('#timer-warning');
      const rect = t?.getBoundingClientRect();
      const strip = document.querySelector('#live-edit');
      const stop = document.querySelector('#timer-stop');
      return {
        shown: !!t && !t.hidden && (rect?.width ?? 0) > 0 && (rect?.height ?? 0) > 0 && t.textContent.trim().length > 0,
        announced: t?.getAttribute('role') === 'status' && t?.hasAttribute('aria-live'),
        message: t?.textContent.trim() ?? '',
        notWritten: window.__EDITED__ == null, // the refused future start recorded nothing
        stillRunning: !!strip && !strip.hidden, // the live-edit strip persists — the count-up never froze
        stopStillThere: !!stop && !stop.hidden, // Stop is still present (no wedge)
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'timer-future-start-reject.png'), fullPage: true });

    await page.fill('#le-start', '2026-06-24T22:00');
    await page.clock.fastForward(600);
    await page.waitForFunction(() => !!window.__EDITED__);
    const corrected = await page.evaluate(() => {
      const t = document.querySelector('#timer-warning');
      const p = window.__EDITED__ && window.__EDITED__.patch;
      return {
        warningCleared: !t || t.hidden || t.textContent.trim().length === 0,
        editedStart: p ? p.startUtc : null,
        noEnd: p ? !('endUtc' in p) : false,
      };
    });

    await page.click('#timer-stop');
    await page.waitForFunction(() => window.__STATE__ && window.__STATE__.status && window.__STATE__.status.running === false);
    const stopped = await page.evaluate(() => ({
      idle: !!(window.__STATE__ && window.__STATE__.status) && window.__STATE__.status.running === false,
    }));

    const refusalAnnounced = refused.shown && refused.announced;
    const nothingWritten = refused.notWritten;
    const noWedge = refused.stillRunning && refused.stopStillThere;
    // Issue 138 — the exact string the audit-design sweep captured from this region was
    // "Error invoking remote method 'edit': StoreError: start time is in the future". The
    // mock rejects in that same wrapped shape now, so the region must read the reason alone.
    const reasonAlone = refused.message === 'start time is in the future' && readsClean(refused.message);
    const correctionCommits =
      corrected.warningCleared && corrected.editedStart === '2026-06-24T22:00:00.000Z' && corrected.noEnd;
    const stoppable = stopped.idle;
    record(
      'FUTURE_START_GUARD',
      { refusalAnnounced, nothingWritten, noWedge, reasonAlone, correctionCommits, stoppable },
      `future-reject=${JSON.stringify(refused)} corrected=${JSON.stringify(corrected)} stopped=${JSON.stringify(stopped)}`,
      'timer-future-start-reject.png',
    );
    await page.close();
  }
}

// FAVORITES_RAIL — §05 R09 / §12 R14: the Timer view's pinned favorites rail. The scene DRIVES
// a pin, a rename and an unpin TO COMPLETION — the pin/rename through the INLINE name affordances
// (typed + committed on Enter; Electron's renderer does not implement window.prompt, so a
// prompt-based flow would silently no-op in the packaged app, issue #52), the unpin through the
// kebab's Unpin action — so every kebab verb is machine-scored end to end, not merely present
// (STATES.md Timer × edge). Drive the real renderer twice (seeded + empty).
async function sceneFavoritesRail(browser) {
  await withPage(browser, timerViewFavoritesState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #fav-rail');
    const probe = await page.evaluate(() => {
      const rail = document.querySelector('#fav-rail');
      const cards = [...rail.querySelectorAll('.fav-card')];
      const api = window.stint || {};
      const favChannels = ['listFavorites', 'pinFavorite', 'renameFavorite', 'unpinFavorite', 'startFavorite'];
      return {
        rows: cards.length,
        names: cards.map((c) => c.querySelector('.fav-name')?.textContent?.trim()),
        hasResume: cards.every((c) => !!c.querySelector('[data-act="fav-resume"]')),
        hasKebab: cards.every((c) => !!c.querySelector('[data-act="fav-menu"]')),
        hasPin: !!document.querySelector('#fav-pin') || !!document.querySelector('#timer-pin'),
        emptyHidden: !!document.querySelector('#fav-empty')?.hidden,
        callableChannels: favChannels.filter((ch) => typeof api[ch] === 'function'),
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'timer-favorites.png') });
    await page.click('.fav-card [data-act="fav-resume"]');
    await page.waitForFunction(() => Array.isArray(window.__RESUMED__) && window.__RESUMED__.length >= 1);
    const resumed = await page.evaluate(() => window.__RESUMED__);

    await page.click('#fav-pin');
    await page.waitForSelector('.fav-pin-form .rename-input');
    await page.fill('.fav-pin-form .rename-input', 'Invoice prep');
    await page.press('.fav-pin-form .rename-input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('#fav-rail .fav-card').length === 4);
    const pinned = await page.evaluate(() => ({
      payload: window.__PINNED__ ?? null,
      names: [...document.querySelectorAll('.fav-card .fav-name')].map((n) => n.textContent.trim()),
    }));

    await page.click('.fav-card:has-text("Invoice prep") [data-act="fav-menu"]');
    await page.click('.fav-card:has-text("Invoice prep") [data-act="fav-rename"]');
    await page.waitForSelector('.fav-card .rename-form .rename-input');
    await page.fill('.fav-card .rename-form .rename-input', 'Client invoicing');
    await page.press('.fav-card .rename-form .rename-input', 'Enter');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.fav-card .fav-name')].some((n) => n.textContent.trim() === 'Client invoicing'),
    );
    const renamed = await page.evaluate(() => ({
      payload: window.__RENAMED_FAV__ ?? null,
      names: [...document.querySelectorAll('.fav-card .fav-name')].map((n) => n.textContent.trim()),
    }));

    await page.click('.fav-card:has-text("Client invoicing") [data-act="fav-menu"]');
    await page.click('.fav-card:has-text("Client invoicing") [data-act="fav-unpin"]');
    await page.waitForFunction(() => document.querySelectorAll('#fav-rail .fav-card').length === 3);
    const unpinned = await page.evaluate(() => ({
      calls: (window.__UNPIN_CALLS__ || []).length,
      payload: window.__UNPINNED__ ?? null,
      names: [...document.querySelectorAll('.fav-card .fav-name')].map((n) => n.textContent.trim()),
    }));

    const empty = await withPage(
      browser,
      timerViewEmptyFavoritesState(),
      'index.html',
      async (ep) => {
        await ep.click('.nav-item[data-view="timer"]');
        await ep.waitForSelector('[data-view="timer"]:not([hidden]) #fav-empty');
        await ep.screenshot({ path: join(EVIDENCE, 'timer-favorites-empty.png') });
        return ep.evaluate(() => {
          const el = document.querySelector('#fav-empty');
          return { shown: !!el && !el.hidden, text: el?.textContent?.trim() ?? '' };
        });
      },
      { favorites: [] },
    );

    const railSeeded =
      probe.rows === 3 &&
      probe.names.includes('Standup') &&
      probe.names.includes('Deep work') &&
      probe.hasResume &&
      probe.hasKebab &&
      probe.hasPin &&
      probe.emptyHidden;
    const channelsCallable = probe.callableChannels.length === 5;
    const resumeFires =
      Array.isArray(resumed) && resumed.length === 1 && resumed[0] && resumed[0].name === 'Standup';
    const pinLands =
      !!pinned.payload &&
      pinned.payload.name === 'Invoice prep' &&
      pinned.payload.fromEntryId === 'open' &&
      pinned.names.includes('Invoice prep');
    const renameLands =
      !!renamed.payload &&
      renamed.payload.name === 'Client invoicing' &&
      renamed.names.includes('Client invoicing') &&
      !renamed.names.includes('Invoice prep');
    // The kebab UNPIN really landed: unpinFavorite fired exactly once with the pinned
    // chip's ref (id 93 — the pin mock's 90 + 3 seeded) and the chip LEFT the rail.
    const unpinLands =
      unpinned.calls === 1 &&
      !!unpinned.payload &&
      unpinned.payload.ref === 93 &&
      unpinned.names.length === 3 &&
      !unpinned.names.includes('Client invoicing');
    const emptyInstructs = empty.shown && /pin/i.test(empty.text) && /tt fav/i.test(empty.text);
    record(
      'FAVORITES_RAIL',
      { railSeeded, channelsCallable, resumeFires, pinLands, renameLands, unpinLands, emptyInstructs },
      `rail ${JSON.stringify(probe)}; resume fired ${JSON.stringify(resumed)}; ` +
        `inline pin ${JSON.stringify(pinned)}; inline rename ${JSON.stringify(renamed)}; ` +
        `kebab unpin ${JSON.stringify(unpinned)}; empty ${JSON.stringify(empty)}`,
      'timer-favorites.png',
    );
  });
}

// ACCENT_DISCIPLINE — design.html D04/D11 (+ PRD §15): the accent FAMILY — --accent
// (tomato·9, the non-text signal: icons, running marks, grips, ring) and --accent-solid
// (tomato·11, the filled-primary background) — is confined to the sanctioned uses; the rest
// of the chrome stays monochrome warm grays. The scan checks BOTH family members as fills
// and text colours; the sanctioned list is the post-transition truth:
//   • button.primary — the per-view filled primary, whose FILL is --accent-solid (never raw
//     --accent: on-accent-on-tomato·9 is the prohibited 3.80:1 pair, D04);
//   • the running-state surfaces (.entry.running / .timer-card.running / .timer-strip.running
//     / the running popover / the live-edit strip) — running clock/state accents;
//   • the picker "me" block's DRAG GRIPS (.stp-block.me .stp-resize's accent bar and the
//     track-level .stp-grip) — V3 made the block itself accent-weak + accent BORDER (neither
//     is scanned here: the scan is bg/colour), so the grips are where the accent signal
//     lives (styles.css comment); the retired solid-accent me-fill would now be an offender;
//   • the active nav item's ICON only (.nav-item.active .ic, D12) — the chip itself is a
//     lifted paper chip (NAV_SHELL gates that), so a nav-item FILL of any accent is a break.
// Deliberately unsanctioned: the .nav-item.active chip as a whole (D12 — selection ≠ accent;
// only its icon may paint accent) and .stp-d.stp-sel (the selected day is a raised paper
// chip, not accent) — either painting a family colour is an offender.
async function sceneAccentDiscipline(browser) {
  await withPage(browser, runningState(), 'index.html', async (page) => {
    await page.screenshot({ path: join(EVIDENCE, 'main-running.png') });
    const probe = await page.evaluate(() => {
      const { rgbOf } = window.__probe;
      const accentRgb = rgbOf('--accent');
      const accentSolidRgb = rgbOf('--accent-solid');
      const primary = getComputedStyle(document.querySelector('button.primary')).backgroundColor;
      const sanctioned = (el) =>
        el.matches('button.primary') ||
        el.closest('button.primary') ||
        el.closest('.entry.running') ||
        el.closest('.pop.running') ||
        el.closest('.pop:not(.idle)') ||
        el.closest('.timer-card.running') ||
        el.closest('.timer-strip.running') ||
        el.closest('.liveedit') ||
        el.closest('.stp-block.me .stp-resize') ||
        el.matches('.stp-grip') ||
        el.closest('.nav-item.active .ic');
      const offenders = [];
      for (const el of document.querySelectorAll('*')) {
        if (sanctioned(el)) continue;
        const cs = getComputedStyle(el);
        if (
          cs.backgroundColor === accentRgb || cs.color === accentRgb ||
          cs.backgroundColor === accentSolidRgb || cs.color === accentSolidRgb
        ) {
          offenders.push(`${el.tagName.toLowerCase()}.${el.className || '(no-class)'}`);
        }
      }
      return { accentRgb, accentSolidRgb, primary, offenders };
    });
    const primaryUsesAccentSolid = probe.primary === probe.accentSolidRgb;
    // Accent discipline ("one rationed accent") is a VISUAL design judgement, not a machine gate.
    // Capture the running window + the computed-style probe as evidence, but score it by looking
    // at the screenshot against the mocks — never by failing on a measured-style scan (issue #25).
    record(
      'ACCENT_DISCIPLINE',
      null,
      `primary=${probe.primary} accent-solid=${probe.accentSolidRgb} (accent=${probe.accentRgb}); ` +
        `primary-fill-uses-accent-solid=${primaryUsesAccentSolid}; ` +
        `accent family seen on [${probe.offenders.join(', ') || 'only sanctioned surfaces'}]`,
      'main-running.png',
    );

    // ACCENT_SOLID_BUDGET — design.html D11, machine-scored: AT MOST ONE accent-solid-filled
    // element per view. Route through the five views on the running window and count the
    // visible elements whose computed background is --accent-solid; every view must count
    // ≤1, and the running Timer view's count is exactly 1 (its Stop primary) — so the rule
    // "one filled primary per view, and the most-likely action carries it" is a gate, not
    // prose. (A second accent-solid fill sneaking into any view flips this false.)
    //
    // The budget has a FLOOR too (issue 150): a view whose most-likely action exists must spend
    // it, or the rationed colour rations nothing. Every view that marks a standing primary —
    // Timer, Entries, Clients, Reports — counts exactly 1 here; Settings marks none (its one
    // primary, the update download, appears only when an update is waiting) and counts 0. Entries
    // used to count zero at rest with its obvious primary drawn as a `.ghost`, and Reports spent
    // its one fill on the button that merely opened the builder; PRIMARY_HANDOFF gates the
    // form-open states this at-rest count cannot see.
    const budget = [];
    // Routing moves the handoff (the view left behind may have held the non-standing primary), so
    // the standing primaries re-paint as the loop walks the views — count the cascade, not a fade.
    // Injected after main-running.png above, so the evidence frame is the untouched surface.
    await noMotion(page);
    for (const view of ['timer', 'entries', 'clients', 'reports', 'settings']) {
      await page.click(`.nav-item[data-view="${view}"]`);
      const count = await page.evaluate(() => {
        const { rgbOf, visible } = window.__probe;
        const accentSolidRgb = rgbOf('--accent-solid');
        const filled = [];
        for (const el of document.querySelectorAll('*')) {
          if (!visible(el)) continue;
          if (getComputedStyle(el).backgroundColor === accentSolidRgb) {
            filled.push(el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${el.className || ''}`);
          }
        }
        return filled;
      });
      budget.push({ view, filled: count });
    }
    const everyViewWithinBudget = budget.every((b) => b.filled.length <= 1);
    const timerFillCount = budget.find((b) => b.view === 'timer')?.filled.length ?? 0;
    const standingViews = budget.filter((b) => b.view !== 'settings');
    const everyStandingViewSpendsIt = standingViews.every((b) => b.filled.length === 1);
    const timerSpendsExactlyOne = timerFillCount === 1;
    record(
      'ACCENT_SOLID_BUDGET',
      { everyViewWithinBudget, timerSpendsExactlyOne, everyStandingViewSpendsIt },
      `exactly one accent-solid fill per view with a standing primary, ≤1 everywhere (D11): ` +
        budget.map((b) => `${b.view}=[${b.filled.join(', ') || 'none'}]`).join('; ') +
        `; every view within budget=${everyViewWithinBudget}; ` +
        `every standing-primary view spends it=${everyStandingViewSpendsIt}; ` +
        `running Timer view carries exactly its Stop primary=${timerFillCount === 1} (count ${timerFillCount})`,
      'main-running.png',
    );
  });
}

// PRIMARY_HANDOFF — design.html D11, machine-scored across STATES (issue 150). ACCENT_SOLID_BUDGET
// above counts the accent-solid fills of each view AT REST; that is where the budget was already
// respected. The break was in the states a view reaches when a form opens: every inline form lit
// its own commit `.primary` while nothing demoted the view's standing primary, so three states
// showed two accent fills at once — and on the Timer view the two identically-sized, identically
// coloured buttons carried the same word, "Start". Because the cause is structural (inline forms
// inherit `.primary`; nothing gave up the standing one), the guard is too: it walks each view that
// HAS a standing primary through rest and through every inline form it can open, and asserts the
// count is EXACTLY ONE every time. The count, never a named selector — pinning "#toggle is the lit
// one" would fight the next restyle (process.html §02) and would not have caught this bug anyway,
// since both buttons matched their own selector. The states are the audit's own reproduction list
// (Timer idle + Details expanded, Timer + pin-as-favourite, Clients + inline rename), extended to
// the rest of the surfaces the same structure reaches: the Entries add form, the Reports builder in
// BOTH its accordion placements (view-level for New, nested in the edited card — §12 R08), the
// Clients add fields, the RUNNING Timer view (whose standing primary is the other face of
// the same standing action, Stop), and the app's one modal — the merge-conflict prompt, which mounts
// outside the views and would otherwise leave the Entries primary lit behind its backdrop.
async function scenePrimaryHandoff(browser) {
  // The one measurement, taken at every stop: visible elements whose computed background is
  // --accent-solid, named so a failure points at the two competing buttons rather than a number.
  const litFills = (page) =>
    page.evaluate(() => {
      const { rgbOf, visible } = window.__probe;
      const accentSolidRgb = rgbOf('--accent-solid');
      const lit = [];
      for (const el of document.querySelectorAll('*')) {
        if (!visible(el)) continue;
        if (getComputedStyle(el).backgroundColor === accentSolidRgb) {
          lit.push(el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${el.className || ''}`);
        }
      }
      return lit;
    });
  const states = [];
  const at = async (page, state) => states.push({ state, lit: await litFills(page) });

  await withPage(browser, emptyState(), 'index.html', async (page) => {
    await noMotion(page);
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #toggle');
    await at(page, 'timer · idle at rest');
    await page.click('#start-toggle');
    await page.waitForSelector('#start-form:not([hidden])');
    // The sharp frame: idle Timer with Details expanded — the state that used to paint two
    // 71×33 accent-solid buttons, both labelled "Start".
    await page.screenshot({ path: join(EVIDENCE, 'primary-handoff-timer.png') });
    await at(page, 'timer · Details expanded');
    await page.click('#start-toggle');
    await page.waitForFunction(() => !!document.querySelector('#start-form')?.hidden);
    await page.click('#fav-pin');
    await page.waitForSelector('.fav-pin-form .rename-input');
    await at(page, 'timer · pin-as-favourite field');
    await page.click('.fav-pin-form .rename-cancel');
    await page.waitForSelector('#fav-pin');

    await page.click('.nav-item[data-view="entries"]');
    await page.waitForSelector('[data-view="entries"]:not([hidden]) #add-toggle');
    await at(page, 'entries · at rest');
    await page.click('#add-toggle');
    await page.waitForSelector('#add-form:not([hidden])');
    await at(page, 'entries · add form open');
    await page.click('#add-cancel');
    await page.waitForFunction(() => !!document.querySelector('#add-form')?.hidden);

    await page.click('.nav-item[data-view="clients"]');
    await page.waitForSelector('#clients:not([hidden]) .client[data-id]');
    await at(page, 'clients · at rest');
    await page.click('#clients .client[data-id] [data-act="rename-client"]');
    await page.waitForSelector('#clients .rename-form .rename-input');
    await at(page, 'clients · inline rename open');
    await page.click('#clients .rename-form .rename-cancel');
    await page.waitForSelector('#clients .client[data-id] .client-name');
    await page.click('#add-client-btn');
    await page.waitForSelector('#clients .client-add .client-add-input');
    await at(page, 'clients · add-client field open');
    await page.click('#clients .client-add .client-add-cancel');
    await page.waitForFunction(() => !document.querySelector('#clients .client-add'));

    await page.click('.nav-item[data-view="reports"]');
    await page.waitForSelector('.reports-view:not([hidden]) #rep-new');
    await at(page, 'reports · at rest');
    await page.click('#rep-new');
    await page.waitForSelector('#rep-builder:not([hidden])');
    await page.screenshot({ path: join(EVIDENCE, 'primary-handoff-reports.png') });
    await at(page, 'reports · builder open');
    // §12 R08 (issue #268): the SAME builder opened nested inside a card via Edit — the
    // accordion moves the commit surface into the card's subtree, and the handoff must still
    // reach it (syncStandingPrimary reads the active VIEW, wherever the form sits in it).
    await page.click('#rep-cancel');
    await page.waitForSelector('#rep-builder[hidden]', { state: 'attached' });
    await page.waitForSelector('#rep-defs .def .def-edit');
    await page.click('#rep-defs .def:first-child .def-edit');
    await page.waitForSelector('#rep-builder:not([hidden])');
    await at(page, 'reports · builder nested in its card (edit)');
  });

  // The RUNNING Timer view, on its own fixture: the same view's standing primary is Stop while a
  // timer runs (the start panel is idle-only, §12 R05), and the favourites rail is reachable in
  // both run states — so Stop and an open pin field are the running twin of the audit's second
  // state, and the handoff has to reach both faces of the standing action.
  await withPage(browser, runningState(), 'index.html', async (page) => {
    await noMotion(page);
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-stop:not([hidden])');
    await at(page, 'timer · running at rest');
    await page.click('#fav-pin');
    await page.waitForSelector('.fav-pin-form .rename-input');
    await at(page, 'timer · running + pin-as-favourite field');
  });

  // The app's one MODAL, on its own fixture: the merge-conflict prompt mounts on <body>, outside
  // the views, so the Entries standing primary sits lit behind its backdrop unless the same rule
  // reaches it. Its Merge is the surface's primary while it is up.
  await withPage(browser, mergeConflictState(), 'index.html', async (page) => {
    await noMotion(page);
    await page.check('.entry[data-id="40"] .sel');
    await page.check('.entry[data-id="41"] .sel');
    await page.click('#merge-go');
    await page.waitForSelector('.editor.conflict-prompt .mc-merge');
    await at(page, 'entries · merge-conflict modal up');
  });

  const offenders = states.filter((s) => s.lit.length !== 1);
  record(
    'PRIMARY_HANDOFF',
    { everyStateExactlyOneFill: offenders.length === 0, allFourteenStatesWalked: states.length === 14 },
    `exactly one visible --accent-solid fill in every state (D11): ` +
      states.map((s) => `${s.state}=[${s.lit.join(', ') || 'none'}]`).join('; ') +
      `; states measured=${states.length}/14 offending states=` +
      `[${offenders.map((s) => `${s.state}:${s.lit.length}`).join(', ') || 'none'}]`,
    'primary-handoff-timer.png',
  );
}

// CLICKABILITY — §15 R-clickability / G10: ONE clickability convention across the window.
// Over the running main window, walk every clickable text affordance and assert the
// convention deterministically.
async function sceneClickability(browser) {
  await withPage(browser, runningState(), 'index.html', async (page) => {
    await page.screenshot({ path: join(EVIDENCE, 'main-clickability.png') });
    const probe = await page.evaluate(() => {
      const { rgbOf, visible } = window.__probe;
      const accentRgb = rgbOf('--accent');
      const accentSolidRgb = rgbOf('--accent-solid');
      const isTransparent = (c) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
      const carriesAffordance = (el) => {
        const cs = getComputedStyle(el);
        if (!isTransparent(cs.backgroundColor)) return true;
        const edges = ['Top', 'Right', 'Bottom', 'Left'];
        for (const e of edges) {
          const w = parseFloat(cs[`border${e}Width`]) || 0;
          if (w > 0 && cs[`border${e}Style`] !== 'none' && !isTransparent(cs[`border${e}Color`])) {
            return true;
          }
        }
        return false;
      };
      const whitelisted = (el) =>
        el.matches('.chip-x') ||
        el.matches('.set-toggle i') ||
        // Native form controls (the multi-select checkbox) render their own UA affordance —
        // the browser draws the checkbox, so it is never bare prose even with no CSS chrome.
        el.matches('input[type="checkbox"], .sel') ||
        !!el.closest('.chip') ||
        !!el.closest('.seg') ||
        !!el.closest('.presets') ||
        // §12 R16 (mockup main.html): the calendar event's hover-ops chip is a raised paper chip
        // (paper bg, 1px line border, 7px radius, raise shadow) — the CHIP carries the affordance,
        // so its inner icon-only op-btns are sub-affordances, exactly like .chip / .seg / .presets.
        !!el.closest('.ops');
      const candidates = [
        ...document.querySelectorAll('button:not(.primary), .nav-item, .nav-link, a[href], [data-act]'),
      ];
      const offenders = [];
      for (const el of candidates) {
        if (!visible(el)) continue;
        if (whitelisted(el)) continue;
        if (!carriesAffordance(el)) {
          offenders.push(`${el.tagName.toLowerCase()}.${el.className || '(no-class)'}`);
        }
      }
      const pillFills = new Set([rgbOf('--paper'), rgbOf('--wash')]);
      const inertSel = '.wordmark, .day-head, .entry .desc, .entry .time, .summary';
      const inertOffenders = [];
      for (const el of document.querySelectorAll(inertSel)) {
        if (!visible(el)) continue;
        const bg = getComputedStyle(el).backgroundColor;
        if (!isTransparent(bg) && pillFills.has(bg)) {
          inertOffenders.push(`${el.tagName.toLowerCase()}.${el.className || '(no-class)'}`);
        }
      }
      const accentSanctioned = (el) =>
        el.matches('button.primary') ||
        el.closest('button.primary') ||
        el.closest('.entry.running') ||
        el.closest('.timer-card.running') ||
        // §12 R04: the Entries-view compact strip's running clock/state carry the same
        // sanctioned running-state accent as the full card (the strip mirrors the card).
        el.closest('.timer-strip.running') ||
        el.closest('.nav-item.active .ic');
      const accentOffenders = [];
      let primaryAccentCount = 0;
      for (const el of document.querySelectorAll('*')) {
        if (!visible(el)) continue;
        const cs = getComputedStyle(el);
        const fills = cs.backgroundColor === accentRgb || cs.backgroundColor === accentSolidRgb;
        if (cs.backgroundColor === accentSolidRgb && el.matches('button.primary')) primaryAccentCount++;
        if (
          !accentSanctioned(el) &&
          (fills || cs.color === accentRgb || cs.color === accentSolidRgb)
        ) {
          accentOffenders.push(`${el.tagName.toLowerCase()}.${el.className || '(no-class)'}`);
        }
      }
      return { offenders, inertOffenders, accentOffenders, primaryAccentCount };
    });
    // §12 R05: the canonical primary action (Start / Stop) now lives in the Timer view (the
    // GUI core-entry surface relocated from the Entries toolbar), so the running Entries view
    // shows its accent only as the running-state strip — not a primary-action FILL. Route to
    // the Timer view and count the primary-action accent there (the running card's Stop is the
    // visible accent-filled primary — the start panel itself is hidden while running, §12 R05 /
    // issue #51). The positive/inert/stray-accent checks stay on the content-rich Entries view
    // above; this only re-homes the "≥1 primary carries accent" fact.
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-stop:not([hidden])');
    const timerPrimaryAccentCount = await page.evaluate(() => {
      const { rgbOf, visible } = window.__probe;
      const accentSolidRgb = rgbOf('--accent-solid');
      let count = 0;
      for (const el of document.querySelectorAll('button.primary')) {
        if (!visible(el)) continue;
        if (getComputedStyle(el).backgroundColor === accentSolidRgb) count++;
      }
      return count;
    });
    const primaryAccentCount = probe.primaryAccentCount + timerPrimaryAccentCount;
    // The clickability convention is a VISUAL judgement (does every affordance read as clickable,
    // does inert text stay bare prose). Capture the screenshot + the computed-style probe as
    // evidence, but score it by looking — not by gating on a measured-style scan (issue #25).
    record(
      'CLICKABILITY',
      null,
      `clickable affordances reading as bare prose=[${probe.offenders.join(', ') || 'none'}]; ` +
        `inert text wearing a pill fill=[${probe.inertOffenders.join(', ') || 'none'}]; ` +
        `stray accent family=[${probe.accentOffenders.join(', ') || 'none'}], accent-solid-filled primary action(s)=${primaryAccentCount} ` +
        `(Entries ${probe.primaryAccentCount} + Timer ${timerPrimaryAccentCount}; expect ≥1, reserved for the primary action)`,
      'main-clickability.png',
    );
  });
}

// START_ATTRIBUTES — the main window's Start offers an optional inline form
// (description/client/project/tags/billable); the primary Start stays one-tap and the
// submitted payload carries every attribute over the start IPC (§05/§12 R1).
async function sceneStartAttributes(browser) {
  await withPage(browser, startFormState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #start-toggle');
    await page.click('#start-toggle');
    await page.fill('#start-desc', 'auth refactor');
    await page.fill('#start-client', 'Acme');
    await page.fill('#start-project', 'API');
    await page.fill('#start-tags', 'deep, urgent');
    await page.uncheck('#start-bill');
    await page.screenshot({ path: join(EVIDENCE, 'main-start-attributes.png') });
    await page.click('#start-go');
    const started = await page.evaluate(() => window.__STARTED__);
    const attributesSent =
      !!started &&
      started.description === 'auth refactor' &&
      started.client === 'Acme' &&
      started.project === 'API' &&
      Array.isArray(started.tags) &&
      started.tags.join(',') === 'deep,urgent';
    const billableSent = started?.billable === false;
    record(
      'START_ATTRIBUTES',
      { attributesSent, billableSent },
      `Start form sent: ${JSON.stringify(started)}`,
      'main-start-attributes.png',
    );
  });
}

// START_FORM — §12 R5: the start surface as a whole. Two snapshots in one item: the idle form
// (startFormState) opened, and the running snapshot (runningState) where the start panel is
// HIDDEN.
async function sceneStartForm(browser) {
  await withPage(browser, startFormState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #start-toggle');
    await page.click('#start-toggle');
    await page.waitForSelector('#start-form:not([hidden])', { state: 'attached' });
    const idle = await page.evaluate(() => {
      const form = document.querySelector('#start-form');
      const has = (id) => !!document.querySelector(`#${id}`);
      const toggleLabel = document.querySelector('#toggle')?.textContent?.trim() ?? null;
      return {
        formVisible: !!form && !form.hidden,
        fields: {
          desc: has('start-desc'),
          client: has('start-client'),
          project: has('start-project'),
          tags: has('start-tags'),
          bill: has('start-bill'),
        },
        toggleLabel,
        noSwitch: !document.querySelector('#switch'),
        // §05 R07: the box opens UNCHECKED — no client is set yet, so the client-keyed
        // default is non-billable (a static `checked` would override the rule).
        billUncheckedOnOpen: !document.querySelector('#start-bill').checked,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-start-form.png') });

    await page.fill('#start-desc', 'auth refactor');
    await page.fill('#start-client', 'Acme');
    const billWithClient = await page.evaluate(() => document.querySelector('#start-bill').checked);
    await page.fill('#start-client', '');
    const billCleared = await page.evaluate(() => document.querySelector('#start-bill').checked);
    await page.fill('#start-client', 'Acme');
    // Submit WITHOUT touching the checkbox: the payload must omit the billable key entirely
    // (tri-state — core's store.start derives billable ?? clientId !== null, §05 R07).
    await page.click('#start-go');
    const started = await page.evaluate(() => window.__STARTED__);
    const billDefaultOk =
      idle.billUncheckedOnOpen &&
      billWithClient === true &&
      billCleared === false &&
      !!started &&
      started.client === 'Acme' &&
      !('billable' in started);

    const running = await withPage(browser, runningState(), 'index.html', async (rp) => {
      await rp.click('.nav-item[data-view="timer"]');
      await rp.waitForSelector('[data-view="timer"]:not([hidden]) #timer-stop:not([hidden])');
      const probe = await rp.evaluate(() => {
        const visible = (sel) => {
          const el = document.querySelector(sel);
          return !!el && el.getClientRects().length > 0;
        };
        return {
          panelHidden: !!document.querySelector('#start-panel')?.hidden,
          startFormVisible: visible('#start-form'),
          startToggleVisible: visible('#start-toggle'),
          stopVisible: visible('#timer-stop'),
          liveEditVisible: visible('#live-edit'),
          noSwitch: !document.querySelector('#switch'),
        };
      });
      await rp.screenshot({ path: join(EVIDENCE, 'main-start-form-running.png') });
      return probe;
    });

    const f = idle.fields;
    const formOk = idle.formVisible && f.desc && f.client && f.project && f.tags && f.bill;
    const idleLabelOk = idle.toggleLabel === 'Start' && idle.noSwitch;
    const runningOk =
      running.panelHidden &&
      !running.startFormVisible &&
      !running.startToggleVisible &&
      running.stopVisible &&
      running.liveEditVisible &&
      running.noSwitch;
    record(
      'START_FORM',
      { formOk, idleLabelOk, billDefaultOk, runningOk },
      `idle start form fields=${JSON.stringify(idle)}; billable default (§05 R07): unchecked→client checks (${billWithClient})→cleared unchecks (${billCleared}), untouched submit sent ${JSON.stringify(started)}; running surface hides the start panel (only edit-or-stop)=${JSON.stringify(running)}`,
      'main-start-form.png',
    );
  });
}

// RUNNING_SINGLE_ACTION — §12 R05 (issue #51): while a timer runs, the Timer view offers
// ONLY edit-or-stop of the running entry.
async function sceneRunningSingleAction(browser) {
  await withPage(browser, runningState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-stop:not([hidden])');
    const probe = await page.evaluate(() => {
      const visible = (el) => !!el && el.getClientRects().length > 0;
      const vis = (sel) => visible(document.querySelector(sel));
      // Count every visible description input in the Timer view — the live-edit strip's
      // #le-desc must be the ONE AND ONLY (a second field is exactly the issue #51 defect).
      const descFields = [
        ...document.querySelectorAll('[data-view="timer"] input[type="text"], [data-view="timer"] textarea'),
      ].filter((el) => {
        const labelled =
          (el.closest('label')?.textContent || '').includes('Description') ||
          (el.getAttribute('placeholder') || '').includes('Description');
        return labelled && visible(el);
      });
      return {
        visibleDescFields: descFields.length,
        descFieldId: descFields[0]?.id ?? null,
        panelHidden: !!document.querySelector('#start-panel')?.hidden,
        startFormVisible: vis('#start-form'),
        startToggleVisible: vis('#start-toggle'),
        oneTapVisible: vis('#toggle'),
        stopVisible: vis('#timer-stop'),
        liveEditVisible: vis('#live-edit'),
        noSwitch: !document.querySelector('#switch') && !document.querySelector('#timer-switch'),
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'timer-running-single-action.png') });
    const oneDescriptionField = probe.visibleDescFields === 1 && probe.descFieldId === 'le-desc';
    const startPanelHidden =
      probe.panelHidden && !probe.startFormVisible && !probe.startToggleVisible && !probe.oneTapVisible;
    const editOrStopRemain = probe.stopVisible && probe.liveEditVisible;
    const noSwitch = probe.noSwitch;
    record(
      'RUNNING_SINGLE_ACTION',
      { oneDescriptionField, startPanelHidden, editOrStopRemain, noSwitch },
      `running Timer view offers only edit-or-stop: ${JSON.stringify(probe)}`,
      'timer-running-single-action.png',
    );
  });
}

// UNIFIED_FORM_ADD — §12 R07 (G5/G7): the manual-add surface is the ONE unified entry form in
// ADD mode, inline in the Entries view (no modal). Driven end to end over the REAL renderer.
//
// The page is pinned to timezoneId 'UTC' so the pinned-clock default seed (JUDGE_NOW − 1h → now =
// 22:00–23:00 local on 2026-06-24) lands on the same local day as the seeded other-entries, making
// the gray/overlap geometry deterministic; overlap:true makes the post-save WriteAck carry the
// overlap warning the inline banner surfaces.
async function sceneUnifiedFormAdd(browser) {
  {
    const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.install({ time: new Date(JUDGE_NOW) });
    await page.clock.pauseAt(new Date(JUDGE_NOW));
    await page.addInitScript(initScript(JSON.stringify(addFormState()), { overlap: true }));
    await page.goto(fileUrl('index.html'));

    // Wait for the initial load() so `state` (and thus the picker's snapshotEntries) is populated
    // before the add form mounts the picker — the two seeded closed entries render as rows first.
    await page.waitForSelector('.entry', { state: 'attached' });

    await page.click('#add-toggle');
    await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
    await page.waitForSelector('#add-picker .stp-track', { state: 'attached' });
    await page.waitForSelector('#add-picker .stp-block.me', { state: 'attached' });
    await page.waitForSelector('#add-client option[value="1"]', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'unified-add.png'), fullPage: true });

    const layout = await page.evaluate(() => {
      const form = document.querySelector('#add-form');
      const q = (sel) => form?.querySelector(sel);
      const desc = q('#add-desc');
      const client = q('#add-client');
      const project = q('#add-project');
      const timesToggle = q('#add-times-toggle');
      const timesBody = q('#add-times-body');
      const from = q('#add-from');
      const to = q('#add-to');
      return {
        visible: !!form && !form.hidden,
        unified: !!form && form.classList.contains('unified-form') && form.dataset.mode === 'add',
        descTag: desc ? desc.tagName : null,
        descRows: desc ? Number(desc.getAttribute('rows')) : null,
        clientTag: client ? client.tagName : null,
        projectTag: project ? project.tagName : null,
        hasTagChips: !!q('#add-tag-chips'),
        hasBill: !!q('#add-bill'),
        pickerCal: !!q('#add-picker .stp-cal .stp-grid .stp-d'),
        pickerTrack: !!q('#add-picker .stp-track'),
        pickerHours: q('#add-picker') ? q('#add-picker').querySelectorAll('.stp-hour').length : 0,
        pickerMe: !!q('#add-picker .stp-block.me'),
        expanderCollapsed: !!timesToggle && timesToggle.getAttribute('aria-expanded') === 'false' && !!timesBody && timesBody.hidden,
        startText: from ? from.getAttribute('type') : null,
        stopText: to ? to.getAttribute('type') : null,
        noDatetimeLocal: form ? form.querySelectorAll('input[type="datetime-local"]').length === 0 : false,
      };
    });

    const paint = await page.evaluate(() => {
      const picker = document.querySelector('#add-picker');
      const { rgbOf } = window.__probe;
      const accentRgb = rgbOf('--accent');
      const accentWeakRgb = rgbOf('--accent-weak');
      const accentSolidRgb = rgbOf('--accent-solid');
      const inkRgb = rgbOf('--ink');
      const overlaps = [...picker.querySelectorAll('.stp-overlap')];
      const me = picker.querySelector('.stp-block.me');
      const meCs = getComputedStyle(me);
      const meLab = me.querySelector('.stp-lab-top, .stp-lab-bot');
      return {
        others: picker.querySelectorAll('.stp-block.other').length,
        overlaps: overlaps.length,
        overlapInert: overlaps.every((el) => getComputedStyle(el).pointerEvents === 'none'),
        meWeakFill: meCs.backgroundColor === accentWeakRgb,
        meAccentBorder: meCs.borderTopColor === accentRgb && parseFloat(meCs.borderTopWidth) >= 1,
        // The block's time labels stay INK (accent-ink on accent-weak is the prohibited pair).
        meInkLabels: !meLab || getComputedStyle(meLab).color === inkRgb,
        saveSolid: getComputedStyle(document.querySelector('#add-go')).backgroundColor === accentSolidRgb,
      };
    });

    const spanMin = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);
    const seed = await page.evaluate(() => ({
      from: document.querySelector('#add-from')?.value,
      to: document.querySelector('#add-to')?.value,
    }));
    const meBox = await page.evaluate(() => {
      const me = document.querySelector('#add-picker .stp-block.me');
      const r = me.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    await page.mouse.move(Math.round(meBox.cx), Math.round(meBox.cy));
    await page.mouse.down();
    await page.mouse.move(Math.round(meBox.cx), Math.round(meBox.cy - 60), { steps: 12 });
    await page.mouse.up();
    const dragged = await page.evaluate(() => ({
      from: document.querySelector('#add-from')?.value,
      to: document.querySelector('#add-to')?.value,
    }));
    const liveUpdate =
      dragged.from !== seed.from &&
      dragged.to !== seed.to &&
      spanMin(dragged.from, dragged.to) === spanMin(seed.from, seed.to); // body drag moves both together

    await page.fill('#add-desc', 'design review');
    await page.selectOption('#add-client', { label: 'Acme' });
    await page.waitForSelector('#add-project:not([disabled]) option[value="11"]', { state: 'attached' });
    await page.selectOption('#add-project', { label: 'API' });
    await page.click('#add-tag-input');
    await page.fill('#add-tag-input', 'deep');
    await page.press('#add-tag-input', 'Enter');
    await page.click('#add-go');
    await page.waitForFunction(() => !!window.__ADDED__);
    await page.waitForSelector('#add-form[hidden]', { state: 'attached' });
    await page.waitForSelector('#overlap-banner:not([hidden])', { state: 'attached' }).catch(() => {});
    const commit = await page.evaluate(() => {
      const banner = document.querySelector('#overlap-banner');
      return {
        added: window.__ADDED__,
        formClosed: !!document.querySelector('#add-form')?.hidden,
        bannerVisible: !!banner && !banner.hidden,
        bannerText: banner ? banner.textContent.trim() : '',
      };
    });
    const a = commit.added || {};
    const savePatch =
      a.fromLocal === dragged.from && // Save sent the LIVE picker-driven span (not the seed, not a re-typed value)
      a.toLocal === dragged.to &&
      a.description === 'design review' &&
      a.client === 'Acme' &&
      a.project === 'API' &&
      Array.isArray(a.tags) &&
      a.tags.includes('deep') &&
      a.billable === true;

    const layoutOk =
      layout.visible &&
      layout.unified &&
      layout.descTag === 'TEXTAREA' &&
      layout.descRows === 3 &&
      layout.clientTag === 'SELECT' &&
      layout.projectTag === 'SELECT' &&
      layout.hasTagChips &&
      layout.hasBill &&
      layout.pickerCal &&
      layout.pickerTrack &&
      layout.pickerHours > 0 &&
      layout.pickerMe &&
      layout.expanderCollapsed &&
      layout.startText === 'text' &&
      layout.stopText === 'text' &&
      layout.noDatetimeLocal;
    const paintOk =
      paint.others >= 1 && paint.overlaps >= 1 && paint.overlapInert &&
      paint.meWeakFill && paint.meAccentBorder && paint.meInkLabels && paint.saveSolid;
    const formCloses = commit.formClosed;
    const overlapBanner = commit.bannerVisible && /overlap/i.test(commit.bannerText);
    record(
      'UNIFIED_FORM_ADD',
      { layoutOk, paintOk, liveUpdate, savePatch, formCloses, overlapBanner },
      `unified add form: layout=${JSON.stringify(layout)}; picker paint=${JSON.stringify(paint)}; ` +
        `live drag seed=${JSON.stringify(seed)}→${JSON.stringify(dragged)} (live=${liveUpdate}); ` +
        `Save sole commit added=${JSON.stringify(a)} (patchOk=${savePatch}); ` +
        `form closed=${commit.formClosed}, overlap banner=${commit.bannerVisible} "${commit.bannerText}"`,
      'unified-add.png',
    );
    await page.close();
  }
}

// UNIFIED_FORM_EXPANDER — §12 R17 (core: core data entry): the unified add form's collapsed
// Start/Stop expander is the exact-entry escape hatch and the ONLY path for an OVERNIGHT span.
//
// Pinned to timezoneId 'UTC' so the pinned-clock default seed (JUDGE_NOW − 1h → 22:00 on
// 2026-06-24) is a deterministic local instant, and the typed 22:00/02:00 map to fixed column
// geometry (720px/24h track → 22:00 = 660px from the track top).
async function sceneUnifiedFormExpander(browser) {
  {
    const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.install({ time: new Date(JUDGE_NOW) });
    await page.clock.pauseAt(new Date(JUDGE_NOW));
    await page.addInitScript(initScript(JSON.stringify(addFormState())));
    await page.goto(fileUrl('index.html'));
    await page.waitForSelector('.entry', { state: 'attached' });

    await page.click('#add-toggle');
    await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
    await page.waitForSelector('#add-picker .stp-block.me', { state: 'attached' });
    await page.waitForSelector('#add-picker .stp-echo', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'unified-form-expander.png'), fullPage: true });
    const collapsed = await page.evaluate(() => {
      const toggle = document.querySelector('#add-times-toggle');
      const body = document.querySelector('#add-times-body');
      const echo = document.querySelector('#add-picker .stp-echo');
      return {
        toggleCollapsed: !!toggle && toggle.getAttribute('aria-expanded') === 'false',
        fieldsHidden: !!body && body.hidden,
        echoPresent: !!echo && echo.textContent.trim().length > 0,
        echoTabular: !!echo && echo.classList.contains('tnum'),
      };
    });

    await page.click('#add-times-toggle');
    await page.waitForSelector('#add-times-body:not([hidden])', { state: 'attached' });
    const fields = await page.evaluate(() => {
      const from = document.querySelector('#add-from');
      const to = document.querySelector('#add-to');
      return {
        fieldsShown: !document.querySelector('#add-times-body')?.hidden,
        fromText: from ? from.getAttribute('type') : null,
        toText: to ? to.getAttribute('type') : null,
      };
    });

    // (c) TYPE an overnight span into the raw fields → the shared interval updates so the picker
    // column reflects the typed start and the collapsed echo reflects the cross-midnight span.
    // Deliberately typed in the `T` spelling the fields no longer RENDER (issue #159): both
    // spellings parse, the picker leaves an untouched field verbatim, and Save sends what was
    // typed — so the format change costs nothing a user already had in muscle memory.
    await page.fill('#add-from', '2026-06-24T22:00');
    await page.fill('#add-to', '2026-06-25T02:00');
    await page.waitForFunction(
      () => document.querySelector('#add-picker .stp-echo')?.textContent.trim() === '22:00 – 02:00',
    );
    const reflected = await page.evaluate(() => {
      const me = document.querySelector('#add-picker .stp-block.me');
      const TRACK_H = window.STP.TRACK_H; // 720px/24h → the geometry the picker draws
      const top = me ? parseFloat(me.style.top) : NaN;
      const startMin = Number.isFinite(top) ? Math.round((top / TRACK_H) * 1440) : null;
      return {
        echo: document.querySelector('#add-picker .stp-echo')?.textContent.trim() ?? '',
        meStartMin: startMin, // the "me" block's top → its start minute-of-day (22:00 = 1320)
        fromValue: document.querySelector('#add-from')?.value,
        toValue: document.querySelector('#add-to')?.value, // the next-day stop kept verbatim
      };
    });

    await page.fill('#add-desc', 'overnight deploy');
    await page.click('#add-go');
    await page.waitForFunction(() => !!window.__ADDED__);
    const added = await page.evaluate(() => window.__ADDED__);

    const collapsedOk = collapsed.toggleCollapsed && collapsed.fieldsHidden && collapsed.echoPresent && collapsed.echoTabular;
    const fieldsOk = fields.fieldsShown && fields.fromText === 'text' && fields.toText === 'text';
    const reflectedOk =
      reflected.echo === '22:00 – 02:00' &&
      reflected.meStartMin === 1320 &&
      reflected.fromValue === '2026-06-24T22:00' &&
      reflected.toValue === '2026-06-25T02:00';
    const savedOk = !!added && added.fromLocal === '2026-06-24T22:00' && added.toLocal === '2026-06-25T02:00';
    record(
      'UNIFIED_FORM_EXPANDER',
      { collapsedOk, fieldsOk, reflectedOk, savedOk },
      `collapsed Start/Stop expander drives the shared interval: ` +
        `collapsed=${JSON.stringify(collapsed)} (ok=${collapsedOk}); expand→fields=${JSON.stringify(fields)} (ok=${fieldsOk}); ` +
        `typed overnight reflected=${JSON.stringify(reflected)} (ok=${reflectedOk}); ` +
        `Save sole commit added=${JSON.stringify(added)} (ok=${savedOk})`,
      'unified-form-expander.png',
    );
    await page.close();
  }
}

// UNIFIED_FORM — §12 R06: editing an entry opens the ONE unified entry form in EDIT MODE in the
// SAME view-level host add mode uses (#entry-form-host) — NOT crammed into the ~124px calendar day
// column — in the view flow (no modal / backdrop / dialog chrome; position:static).
async function sceneUnifiedForm(browser) {
  await withPage(browser, unifiedFormState(), 'index.html', async (page) => {
    const editRow = '.entry[data-id="80"]';
    // The unified form (edit mode) opens in the SAME view-level host add mode uses (#entry-form-host),
    // in the view flow — NOT inside the ~124px calendar day column. Only one form is ever open, so its
    // seeded fields are reachable by the plain `.edit-form.entry-form` selector (no row ancestor).
    const editForm = '.edit-form.entry-form';
    // (b0) Host identity: open ADD mode, record its host; then open EDIT mode and assert the edit
    // form mounts in the very SAME host element (§12 R06/G5 — one host, add + edit). Do this first
    // (a clean page), then cancel both back to the plain calendar for the field probe below.
    await page.click('#add-toggle');
    await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
    const addHostIsFormHost = await page.evaluate(
      () => document.querySelector('#add-form')?.parentElement?.id === 'entry-form-host',
    );
    await page.click('#add-cancel');
    await page.hover(editRow);
    await page.click(`${editRow} [data-act="edit"]`);
    await page.waitForSelector(editForm, { state: 'attached' });
    const sameHost = await page.evaluate(() => {
      const form = document.querySelector('.edit-form.entry-form');
      const host = document.getElementById('entry-form-host');
      const addForm = document.getElementById('add-form');
      return !!form && !!host && form.parentElement === host && addForm?.parentElement === host;
    });
    await page.click(`${editForm} .edit-cancel`);
    await page.waitForSelector(editForm, { state: 'detached' });

    // (a) A click on the entry body (an inert cell, not an action control) opens the form.
    // Entry 83 (15:00–16:00) overlaps entry 80's span (14:00–15:30) on the readonly calendar and,
    // per the mockup's full-width offset-stack layout (main.html §Tue: the later event stacks on
    // top of the earlier one's tail), covers the lower part of entry 80. Reach it the way a user
    // does: move the cursor ONTO the entry first — hover raises it above the overlapping neighbour
    // (`.dt .ev:hover` → z-index) and reveals its affordances — then click its inert body.
    await page.hover(editRow);
    await clickEventBody(page, editRow);
    await page.waitForSelector(editForm, { state: 'attached' });
    const clickOpens = await page.evaluate(
      () => !!document.querySelector('.edit-form.entry-form') &&
        document.querySelector('.entry[data-id="80"]')?.classList.contains('editing') === true,
    );
    // Cancel back to the list so the Edit-affordance path opens a fresh form for the full probe.
    await page.click(`${editForm} .edit-cancel`);
    await page.waitForSelector(editForm, { state: 'detached' });

    // (b) The Edit affordance opens the same form; wait for the async reference-data to fill both
    // the client (Acme=1) and project (API=11) selects so the seeded-select assertions are stable.
    await page.click(`${editRow} [data-act="edit"]`);
    await page.waitForSelector(`${editForm} .edit-client option[value="1"]`, { state: 'attached' });
    await page.waitForSelector(`${editForm} .edit-project option[value="11"]`, { state: 'attached' });
    const probe = await page.evaluate(() => {
      const form = document.querySelector('.edit-form.entry-form');
      const v = (sel) => form?.querySelector(sel);
      const desc = v('.edit-desc');
      const start = v('.edit-start');
      const end = v('.edit-end');
      const bill = v('.edit-bill-box');
      const client = v('.edit-client');
      const project = v('.edit-project');
      const chips = [...(form?.querySelectorAll('.ef-tag-chips .chip') ?? [])].map((c) => c.textContent.replace('×', '').trim());
      return {
        inContext: !!form && form.parentElement?.id === 'entry-form-host' && form.dataset.id === '80' &&
          document.querySelector('.entry[data-id="80"]')?.classList.contains('editing') === true,
        noBackdrop: !document.querySelector('.editor-backdrop'),
        noDialog: !document.querySelector('[role="dialog"]'),
        hostStatic: form ? getComputedStyle(form).position === 'static' : false,
        descTag: desc ? desc.tagName : null,
        descSeeded: desc ? desc.value : null,
        clientSeeded: client ? client.value : null,
        projectSeeded: project ? project.value : null,
        tagChips: chips,
        billSeeded: bill ? bill.checked : null,
        startSeeded: start ? start.value.length > 0 : false,
        endPresent: !!end,
        endSeeded: end ? end.value.length > 0 : false,
        hasSplit: !!v('.ef-split'),
        hasDelete: !!v('.ef-delete'),
        // design.html D11: only Save entry carries the accent-solid fill — it is the single
        // .primary in the footer (the class whose one paint token is --accent-solid).
        footAccent: form ? form.querySelectorAll('.edit-foot .primary').length : 0,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-edit.png') });

    // §12 R15 — the INLINE interval picker mounted in the edit form (successor to the retired
    // picker-modal judge scene). It renders IN FLOW (no .stp-backdrop, no .stp-apply anywhere;
    // the .stp-inline host computes position:static) as a month calendar + a single-day .stp-track
    // with hour lines. Entry 83 (15:00–16:00Z) paints as a gray other block AND, over the shared
    // 15:00–15:30 minutes with entry 80's edited "me" span (14:00–15:30Z), an inert yellow warn band
    // (pointer-events:none — warn-only, never blocks Save). A known BODY drag advances BOTH bound
    // form fields (.edit-start/.edit-end) by the snapped 5-min amount (span preserved); a bottom
    // .stp-resize drag advances ONLY .edit-end. Every write is LIVE into the form's own fields — no
    // commit fires here (the Cancel below discards them; Save entry is the sole commit, tested next,
    // G7). The running-entry start-only variant (.stp-block.me.open mask + start grip only, no
    // .stp-resize/end label/echo, no end value) is asserted by the TIMER_VIEW scene, which drives
    // STP.openStartOnly over the same component.
    await page.waitForSelector(`${editForm} .edit-picker .stp-track`, { state: 'attached' });
    await page.waitForSelector(`${editForm} .edit-picker .stp-block.me`, { state: 'attached' });
    const picker = await page.evaluate(() => {
      const form = document.querySelector('.edit-form.entry-form');
      const host = form.querySelector('.edit-picker');
      const box = host.querySelector('.stp-inline');
      const overlaps = [...host.querySelectorAll('.stp-overlap')];
      return {
        inFlow: !!box && getComputedStyle(box).position === 'static',
        noBackdrop: !document.querySelector('.stp-backdrop'),
        noApply: !document.querySelector('.stp-apply'),
        hasCal: !!host.querySelector('.stp-cal .stp-grid .stp-d'),
        hasTrack: !!host.querySelector('.stp-track'),
        hours: host.querySelectorAll('.stp-hour').length,
        others: host.querySelectorAll('.stp-block.other').length,
        overlaps: overlaps.length,
        overlapInert: overlaps.length > 0 && overlaps.every((el) => getComputedStyle(el).pointerEvents === 'none'),
      };
    });
    // BODY drag up ~60px (720px/24h track → 0.5px/min → −120min, 5-min snapped) — BOTH fields move,
    // span preserved (LIVE into the form's own start/stop state, before any Save).
    const spanMin = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);
    const seedTimes = await page.evaluate(() => ({
      from: document.querySelector('.edit-form .edit-start')?.value,
      to: document.querySelector('.edit-form .edit-end')?.value,
    }));
    await page.locator(`${editForm} .edit-picker .stp-block.me`).scrollIntoViewIfNeeded();
    const meBox = await page.evaluate(() => {
      const r = document.querySelector('.edit-form .edit-picker .stp-block.me').getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    await page.mouse.move(Math.round(meBox.cx), Math.round(meBox.cy));
    await page.mouse.down();
    await page.mouse.move(Math.round(meBox.cx), Math.round(meBox.cy - 60), { steps: 12 });
    await page.mouse.up();
    const bodyDrag = await page.evaluate(() => ({
      from: document.querySelector('.edit-form .edit-start')?.value,
      to: document.querySelector('.edit-form .edit-end')?.value,
    }));
    const bodyOk =
      bodyDrag.from !== seedTimes.from &&
      bodyDrag.to !== seedTimes.to &&
      spanMin(bodyDrag.from, bodyDrag.to) === spanMin(seedTimes.from, seedTimes.to);
    await page.locator(`${editForm} .edit-picker .stp-resize`).scrollIntoViewIfNeeded();
    const resizeBox = await page.evaluate(() => {
      const r = document.querySelector('.edit-form .edit-picker .stp-resize').getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    await page.mouse.move(Math.round(resizeBox.cx), Math.round(resizeBox.cy));
    await page.mouse.down();
    await page.mouse.move(Math.round(resizeBox.cx), Math.round(resizeBox.cy + 30), { steps: 8 });
    await page.mouse.up();
    const resizeDrag = await page.evaluate(() => ({
      from: document.querySelector('.edit-form .edit-start')?.value,
      to: document.querySelector('.edit-form .edit-end')?.value,
    }));
    const resizeOk = resizeDrag.from === bodyDrag.from && resizeDrag.to !== bodyDrag.to;
    const pickerOk =
      picker.inFlow && picker.noBackdrop && picker.noApply && picker.hasCal && picker.hasTrack &&
      picker.hours > 0 && picker.others >= 1 && picker.overlaps >= 1 && picker.overlapInert &&
      bodyOk && resizeOk;

    // Discard the dragged times — Cancel and reopen a FRESH form so the Save-patch test below sees
    // the entry's original (unchanged) times and asserts a description-ONLY patch (Save sole commit).
    await page.click(`${editForm} .edit-cancel`);
    await page.waitForSelector(editForm, { state: 'detached' });
    await page.click(`${editRow} [data-act="edit"]`);
    await page.waitForSelector(`${editForm} .edit-client option[value="1"]`, { state: 'attached' });
    await page.waitForSelector(`${editForm} .edit-picker .stp-block.me`, { state: 'attached' });

    await page.fill(`${editForm} .edit-desc`, 'final draft');
    await page.click(`${editForm} button[type="submit"]`);
    await page.waitForFunction(() => !!window.__EDITED__);
    const edited = await page.evaluate(() => window.__EDITED__);

    await page.click(`${editRow} [data-act="edit"]`);
    await page.waitForSelector(`${editForm} .ef-delete`, { state: 'attached' });
    await page.click(`${editForm} .ef-delete`);
    const armed = await page.evaluate(() => ({
      confirmShown: !!document.querySelector('.edit-form [data-act="confirm-delete"]'),
      question: document.querySelector('.edit-form .confirm-q')?.textContent ?? null,
      removedYet: window.__REMOVED__ === true,
    }));
    await page.click(`${editForm} [data-act="confirm-delete"]`);
    await page.waitForFunction(() => window.__REMOVED__ === true);
    const removed = await page.evaluate(() => ({
      removed: window.__REMOVED__ === true,
      calls: window.__REMOVE_CALLS__ || [],
    }));

    // §12 R10 — the flags surface IN THE EDITOR (the list is gone; the calendar shows only the
    // markers). Open the OVERLAPPED entry (81): the flags region spells out the overlap detail
    // (amount + which neighbour). Then open the SLEPT entry (82): its reversible Subtract/Restore
    // control is present, and after subtracting the raw duration reads struck (04:00:00) beside the
    // trimmed billable (03:00:00); subtracting again restores it (the struck raw disappears).
    // The delete above removed entry 80 + reloaded; wait for that repaint before opening 81/82.
    await page.waitForSelector('.entry[data-id="80"]', { state: 'detached' }).catch(() => {});
    // Hover first so the target event rises above its overlapping neighbour (`.dt .ev:hover` →
    // z-index), then open it via its Edit affordance — same overlap-defeating move as step (a).
    await page.waitForSelector('.entry[data-id="81"] [data-act="edit"]', { state: 'attached' });
    await page.hover('.entry[data-id="81"]');
    await page.click('.entry[data-id="81"] [data-act="edit"]');
    await page.waitForSelector('.edit-form .ef-flags .banner.overlap', { state: 'attached' });
    const overlapDetail = await page.evaluate(
      () => document.querySelector('.edit-form .ef-flags .banner.overlap')?.textContent?.trim() ?? '',
    );
    await page.click('.edit-form .edit-cancel');
    await page.waitForSelector('.edit-form', { state: 'detached' });

    await page.hover('.entry[data-id="82"]');
    await page.click('.entry[data-id="82"] [data-act="edit"]');
    await page.waitForSelector('.edit-form .ef-subtract', { state: 'attached' });
    const sleptBefore = await page.evaluate(() => {
      const form = document.querySelector('.edit-form');
      return {
        subtractLabel: form?.querySelector('.ef-subtract')?.textContent?.trim() ?? '',
        struckBefore: !!form?.querySelector('.ef-dur s.struck'),
      };
    });
    await page.click('.edit-form .ef-subtract');
    await page.waitForSelector('.edit-form .ef-dur s.struck', { state: 'attached' });
    const sleptAfter = await page.evaluate(() => {
      const form = document.querySelector('.edit-form');
      const s = form?.querySelector('.ef-dur s.struck');
      return {
        subtractLabel: form?.querySelector('.ef-subtract')?.textContent?.trim() ?? '',
        struckText: s?.textContent?.trim() ?? '',
        struckLineThrough: s ? getComputedStyle(s).textDecorationLine.includes('line-through') : false,
        durText: form?.querySelector('.ef-dur')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    });
    await page.click('.edit-form .ef-subtract');
    await page.waitForSelector('.edit-form .ef-dur s.struck', { state: 'detached' });
    const sleptRestored = await page.evaluate(
      () => !document.querySelector('.edit-form .ef-dur s.struck'),
    );

    // §12 R15 (issue #49) — EXACT stored times round-trip. Entry 84 (09:07:33 → 11:03:00Z) is
    // deliberately NOT 5-minute-aligned: (1) opening its editor renders the stored start/stop
    // EXACTLY, to the second — never snapped to the picker grid; (2) Save entry with NO drag
    // sends a patch carrying no startUtc/endUtc at all, so the store's times round-trip
    // unchanged; (3) only an actively dragged stop grip snaps — after a bottom-grip drag the
    // stop lands on the :05 grid while the untouched start keeps its seconds. The assertions are
    // shape-relative (seconds suffix + minute-mod-5), so they hold under any whole-minute host
    // timezone offset.
    await page.click('.edit-form .edit-cancel');
    await page.waitForSelector('.edit-form', { state: 'detached' });
    await page.evaluate(() => {
      window.__EDITED__ = null; // beat (c) recorded entry 80's patch — clear it for this probe
    });
    await page.hover('.entry[data-id="84"]');
    await page.click('.entry[data-id="84"] [data-act="edit"]');
    await page.waitForSelector(`${editForm} .edit-client option[value="1"]`, { state: 'attached' });
    await page.waitForSelector(`${editForm} .edit-picker .stp-block.me`, { state: 'attached' });
    const exactSeed = await page.evaluate(() => ({
      from: document.querySelector('.edit-form .edit-start')?.value ?? '',
      to: document.querySelector('.edit-form .edit-end')?.value ?? '',
    }));
    // Capture the exact-times rendering ON CAMERA: expand the Start/Stop disclosure so the raw
    // fields (2026-06-24T09:07:33 / …T11:03) are visible, then screenshot the entry-84 editor —
    // the committed evidence that a stored 09:07:33 opens as 09:07:33, never snapped to 09:05.
    await page.click(`${editForm} .ef-times-toggle`);
    await page.evaluate(() =>
      document.querySelector('.edit-form.entry-form')?.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: join(EVIDENCE, 'main-edit-exact-times.png') });
    await page.click(`${editForm} button[type="submit"]`);
    await page.waitForFunction(() => !!window.__EDITED__);
    const noDragSave = await page.evaluate(() => window.__EDITED__);
    await page.hover('.entry[data-id="84"]');
    await page.click('.entry[data-id="84"] [data-act="edit"]');
    await page.waitForSelector(`${editForm} .edit-picker .stp-resize`, { state: 'attached' });
    await page.locator(`${editForm} .edit-picker .stp-resize`).scrollIntoViewIfNeeded();
    const grip84 = await page.evaluate(() => {
      const r = document.querySelector('.edit-form .edit-picker .stp-resize').getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    await page.mouse.move(Math.round(grip84.cx), Math.round(grip84.cy));
    await page.mouse.down();
    await page.mouse.move(Math.round(grip84.cx), Math.round(grip84.cy + 30), { steps: 8 });
    await page.mouse.up();
    const snapDrag = await page.evaluate(() => ({
      from: document.querySelector('.edit-form .edit-start')?.value ?? '',
      to: document.querySelector('.edit-form .edit-end')?.value ?? '',
    }));
    await page.click(`${editForm} .edit-cancel`);
    await page.waitForSelector(editForm, { state: 'detached' });
    const minuteMod5 = (v) => Number(v.slice(14, 16)) % 5;
    const exactShown =
      /:33$/.test(exactSeed.from) && // the start renders its stored seconds (…09:07:33)
      exactSeed.to.length === 19 && // the stop (…11:03:00) shows its :00 seconds (issue #159)…
      minuteMod5(exactSeed.to) !== 0; // …but sits OFF the 5-min grid — shown unsnapped
    const noDragRoundTrip =
      !!noDragSave &&
      noDragSave.id === 84 &&
      !!noDragSave.patch &&
      !('startUtc' in noDragSave.patch) &&
      !('endUtc' in noDragSave.patch);
    const dragSnaps =
      snapDrag.from === exactSeed.from && // the untouched start keeps its exact seconds
      snapDrag.to.length === 19 && // the dragged stop is a whole minute (…:00 shown)…
      minuteMod5(snapDrag.to) === 0 && // …on the :05 grid
      snapDrag.to !== exactSeed.to;
    const exactTimesOk = exactShown && noDragRoundTrip && dragSnaps;

    const overlapDetailOk = /Overlap:\s*\d+m\s+with\s+(previous|next)\b/.test(overlapDetail);
    const sleptOk =
      /Subtract/i.test(sleptBefore.subtractLabel) &&
      !sleptBefore.struckBefore &&
      sleptAfter.struckLineThrough &&
      /04:00:00/.test(sleptAfter.struckText) &&
      /03:00:00/.test(sleptAfter.durText) &&
      /Restore/i.test(sleptAfter.subtractLabel) &&
      sleptRestored;

    const seeded =
      probe.inContext &&
      probe.noBackdrop &&
      probe.noDialog &&
      probe.hostStatic &&
      probe.descTag === 'TEXTAREA' &&
      probe.descSeeded === 'design review' &&
      probe.clientSeeded === '1' &&
      probe.projectSeeded === '11' &&
      probe.tagChips.join(',') === 'deep' &&
      probe.billSeeded === true &&
      probe.startSeeded &&
      probe.endPresent &&
      probe.endSeeded;
    const footer = probe.hasSplit && probe.hasDelete && probe.footAccent === 1;
    const savePatch =
      !!edited &&
      edited.id === 80 &&
      edited.patch &&
      edited.patch.description === 'final draft' &&
      Object.keys(edited.patch).length === 1;
    const deleteGate =
      armed.confirmShown &&
      /confirm/i.test(armed.question || '') &&
      !armed.removedYet &&
      removed.removed &&
      removed.calls.length === 1 &&
      removed.calls[0].id === 80;
    const hostShared = addHostIsFormHost && sameHost;
    record(
      'UNIFIED_FORM',
      {
        hostShared,
        clickOpens,
        seeded,
        pickerOk,
        footer,
        savePatch,
        deleteGate,
        overlapDetailOk,
        sleptOk,
        exactTimesOk,
      },
      `unified entry form (edit mode) in the SAME view-level host as add mode (#entry-form-host, in ` +
        `flow), seeded, INLINE picker (in-flow, no backdrop/apply, ` +
        `month cal + track + hours, body-drag moves both fields snapped, resize moves only stop, ` +
        `gray others + inert yellow overlap), footer Split + two-step Delete, save patch, ` +
        `§12 R10 flags (overlap detail + reversible subtract), ` +
        `§12 R15 exact times (stored start/stop shown to the second, no-drag Save patches no ` +
        `time, only the dragged stop grip snaps to :05): ` +
        `hostShared=${hostShared} clickOpens=${clickOpens} probe=${JSON.stringify(probe)} ` +
        `picker=${JSON.stringify(picker)} seed=${JSON.stringify(seedTimes)}→body=${JSON.stringify(bodyDrag)}` +
        `(bodyOk=${bodyOk})→resize=${JSON.stringify(resizeDrag)}(resizeOk=${resizeOk}) ` +
        `edited=${JSON.stringify(edited)} armed=${JSON.stringify(armed)} removed=${JSON.stringify(removed)} ` +
        `overlapDetail=${JSON.stringify(overlapDetail)} sleptBefore=${JSON.stringify(sleptBefore)} ` +
        `sleptAfter=${JSON.stringify(sleptAfter)} sleptRestored=${sleptRestored} ` +
        `exactTimes: seed=${JSON.stringify(exactSeed)} noDragSave=${JSON.stringify(noDragSave)} ` +
        `snapDrag=${JSON.stringify(snapDrag)} (shown=${exactShown} roundTrip=${noDragRoundTrip} snap=${dragSnaps})`,
      'main-edit.png',
    );
  });
}

// MULTILINE_DESC — §05 R10 / §12 R07: the entry form's description control is a 3-line
// scrollable <textarea>, and a stored description that carries an embedded newline renders
// VERBATIM (not flattened to one line).
async function sceneMultilineDesc(browser) {
  await withPage(browser, multilineDescState(), 'index.html', async (page) => {
    const editRow = '.entry[data-id="30"]';
    await page.click(`${editRow} [data-act="edit"]`);
    await page.waitForSelector(`.edit-form .edit-desc`, { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-multiline-desc.png') });
    const probe = await page.evaluate(() => {
      const el = document.querySelector('.edit-form .edit-desc');
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      return {
        present: true,
        tag: el.tagName,
        rows: Number(el.getAttribute('rows')),
        value: el.value,
        hasInteriorNewline: el.value.includes('\n'),
        overflowY: cs.overflowY,
        resize: cs.resize,
      };
    });
    const isTextarea = probe.present && probe.tag === 'TEXTAREA' && probe.rows === 3;
    const keepsNewline = probe.value === 'line one\nline two' && probe.hasInteriorNewline;
    const scrollsNotGrows = probe.overflowY === 'auto' || probe.overflowY === 'scroll';
    record(
      'MULTILINE_DESC',
      { isTextarea, keepsNewline, scrollsNotGrows },
      `description control is a 3-line scrollable textarea rendering the stored newline verbatim: ${JSON.stringify(probe)}`,
      'main-multiline-desc.png',
    );
  });
}

// OVERLAP_BANNER — a write that creates an overlap surfaces a non-blocking inline
// banner AT THE MOMENT of the edit, not only the per-row flag (§06 R4, §12). The
// overlap-returning write mock makes the renderer raise #overlap-banner deterministically.
async function sceneOverlapBanner(browser) {
  await withPage(
    browser,
    overlapWriteState(),
    'index.html',
    async (page) => {
      const beforeHidden = await page.evaluate(() => !!document.querySelector('#overlap-banner')?.hidden);
      const editRow = '.entry[data-id="60"]';
      await page.click(`${editRow} [data-act="edit"]`);
      // Save with no field changes is enough — the mock returns the overlap ack on any
      // edit, exercising the renderer's banner path deterministically.
      await page.waitForSelector(`.edit-form .edit-start`, { state: 'attached' });
      await page.click(`.edit-form button[type="submit"]`);
      await page.waitForSelector('#overlap-banner:not([hidden])', { state: 'attached' });
      await page.screenshot({ path: join(EVIDENCE, 'main-overlap-banner.png'), fullPage: true });
      const probe = await page.evaluate(() => {
        const banner = document.querySelector('#overlap-banner');
        return {
          visible: !!banner && !banner.hidden && getComputedStyle(banner).display !== 'none',
          text: banner ? banner.textContent.trim() : '',
          role: banner ? banner.getAttribute('role') : null,
          ariaLive: banner ? banner.getAttribute('aria-live') : null,
        };
      });
      const hiddenBefore = beforeHidden;
      const raisedOnOverlap = probe.visible && /overlap/i.test(probe.text);
      const announced = probe.role === 'status' && probe.ariaLive === 'polite';
      record(
        'OVERLAP_BANNER',
        { hiddenBefore, raisedOnOverlap, announced },
        `overlap write raises inline banner (hidden before=${beforeHidden}): ${JSON.stringify(probe)}`,
        'main-overlap-banner.png',
      );
    },
    { overlap: true },
  );
}

// SPLIT_AFFORDANCE — a CLOSED entry exposes a discoverable Split control wired to the
// split capability; the open/running entry does not (§06 R2: only a bounded span can
// be cut).
async function sceneSplitAffordance(browser) {
  await withPage(browser, splittableState(), 'index.html', async (page) => {
    const closedRow = '.entry[data-id="30"]';
    const before = await page.evaluate(() => ({
      closedHasSplit: !!document.querySelector('.entry[data-id="30"] [data-act="split"]'),
      openHasSplit: !!document.querySelector('.entry[data-id="31"] [data-act="split"]'),
    }));
    // §12 R16 (mockup main.html): the hover-ops chip is now three icon-only 22×22 buttons in a
    // compact raised paper chip (top-right) — it no longer overlaps the top-left corner checkbox,
    // so a PLAIN click reaches the Split button (the earlier offset-click occlusion workaround is
    // gone). Verify the geometry: the ops chip and the `.ck` checkbox do not overlap horizontally.
    await page.hover(closedRow);
    await page.waitForSelector(`${closedRow} .ops .op-btn[data-act="split"]`, { state: 'attached' });
    const geom = await page.evaluate(() => {
      const row = document.querySelector('.entry[data-id="30"]');
      const chip = row?.querySelector('.ops')?.getBoundingClientRect();
      const ck = row?.querySelector('.ck')?.getBoundingClientRect();
      const col = row?.closest('.dt')?.getBoundingClientRect();
      // No overlap between the ops chip and the corner checkbox — beside it at generous
      // column widths, on the row below it once the fit-to-width columns narrow (§12 R16's
      // container-stepped chip) — and the chip stays inside its day column.
      const noOverlap =
        !!chip && !!ck &&
        (chip.left >= ck.right || ck.left >= chip.right || chip.top >= ck.bottom || ck.top >= chip.bottom);
      const chipInColumn = !!chip && !!col && chip.left >= col.left - 0.5 && chip.right <= col.right + 0.5;
      return { noOverlap, chipInColumn };
    });
    await page.click(`${closedRow} [data-act="split"]`);
    await page.screenshot({ path: join(EVIDENCE, 'main-split.png'), fullPage: true });
    // §06 R2 / G4 / G1: the split instant is a SIMPLE PLAIN-TEXT field — the input's type is
    // text, and the split form carries NO native datetime-local anywhere (mirror the unified
    // form's startIsText / noDatetimeLocal idioms). Probe the open split form before confirming.
    const splitForm = await page.evaluate(() => {
      const wrap = document.querySelector('.entry[data-id="30"] .split-at');
      const input = wrap?.querySelector('.split-input');
      return {
        splitInputIsText: input?.getAttribute('type') === 'text',
        noDatetimeLocal: wrap ? wrap.querySelectorAll('input[type="datetime-local"]').length === 0 : false,
      };
    });
    // The inline plain-text field seeds an instant inside the span (the midpoint) and the confirm
    // control sends it over the split IPC as a UTC ISO.
    await page.click(`${closedRow} [data-act="confirm-split"]`);
    const split = await page.evaluate(() => window.__SPLIT__);
    const closedOnly = before.closedHasSplit && !before.openHasSplit;
    const chipGeometry = geom.noOverlap && geom.chipInColumn;
    const rawTextField = splitForm.splitInputIsText && splitForm.noDatetimeLocal;
    const splitsInsideSpan =
      !!split &&
      split.id === 30 &&
      typeof split.atUtc === 'string' &&
      Date.parse(split.atUtc) > Date.parse('2026-06-24T09:00:00Z') &&
      Date.parse(split.atUtc) < Date.parse('2026-06-24T11:00:00Z');
    record(
      'SPLIT_AFFORDANCE',
      { closedOnly, chipGeometry, rawTextField, splitsInsideSpan },
      `closed row exposes Split (open row none=${!before.openHasSplit}); ops chip clears the corner checkbox=${geom.noOverlap}, chip in column=${geom.chipInColumn}; split input is plain text=${splitForm.splitInputIsText}, no datetime-local=${splitForm.noDatetimeLocal}; split IPC: ${JSON.stringify(split)}`,
      'main-split.png',
    );
  });
}

// INLINE_GATE_CONTAINMENT — design.html D09 (issue #146): a transient gate armed FROM a calendar
// event — the split picker (.split-at) and the two-step delete confirm (.confirm) — is a LAYER
// OVER the calendar, not content of the 124px day column whose button armed it. Both shipped laid
// out IN FLOW inside that column and with no surface of their own: the split picker measured 348px
// against a 124px column, running 264px past the column and, in the leftmost one, 16px off the left
// edge of the WINDOW, over a transparent background with a 0px radius and no shadow — a raised
// region reading as loose text floating over the entries.
//
// Driven through the REAL hover affordance on the two EDGE columns (edgeColumnState pins an entry
// to the week's first and last), never asserted off the stylesheet, so the check survives a
// restyle: whatever the gates are made of, each must (a) sit wholly inside the calendar as the
// user can see it — the scroller's visible box clipped to the window — and (b) resolve to a real
// surface on the elevation ladder: an opaque `--paper` fill, a radius, and a shadow. Both edges
// are probed because a clamp that only pulls the left edge in still spills off the right.
//
// (c) is the interaction with issue #145, which pinned the two axes INSIDE this scrollport: the
// day-header band (`.dh`) holds its top edge and the hour gutter (`.gut`) its left, both on opaque
// paper and both outranking the event chrome the gate is mounted in (`.ops` is z-5, the bands 8 and
// 9). Landing in the scrollport is therefore no longer enough to be SEEN — a gate under either band
// is as invisible as one off the window. So each block is scrolled hard into the scrollport's
// TOP-LEFT CORNER before the gate is armed, which is the worst case for both bands at once, and the
// gate is then required to clear their rects AND to hit-test as the topmost element at its own
// corners — the restyle-proof form of "nothing is painted over it".
async function sceneInlineGateContainment(browser) {
  await withPage(browser, edgeColumnState(), 'index.html', async (page) => {
    // The gate's chrome is asserted on COMPUTED colour, and D10 fades background/shadow over
    // 120ms — with the clock pinned, a probe would otherwise read a frozen mid-fade frame.
    await noMotion(page);
    const arm = async (row, act, gate) => {
      // The edge columns are off the default horizontal scroll, and the entries sit on the 24h
      // track — reach them the way a user does before hovering.
      await page.locator(row).scrollIntoViewIfNeeded();
      // Hover the block's own TOP STRIP rather than its centre: the first column's entry carries
      // an overlapping neighbour whose block owns the centre, and Playwright aims at the centre.
      // This is also where a user reaches for the ops chip, which sits on that same first line.
      await page.hover(row, { position: { x: 40, y: 5 } });
      await page.waitForSelector(`${row} .ops .op-btn[data-act="${act}"]`, { state: 'attached' });
      await page.click(`${row} [data-act="${act}"]`);
      await page.waitForSelector(`${row} ${gate}`, { state: 'attached' });
      return page.evaluate(([r, g]) => {
        const el = document.querySelector(`${r} ${g}`);
        const strip = el.closest('.cstrip');
        const box = strip.getBoundingClientRect();
        // The calendar AS SEEN: the scroller's visible box (border box less scrollbar gutters),
        // clipped to the window — the region the gate has to land in to be whole and on screen.
        const view = {
          left: Math.max(box.left, 0),
          top: Math.max(box.top, 0),
          right: Math.min(box.left + strip.clientWidth, document.documentElement.clientWidth),
          bottom: Math.min(box.top + strip.clientHeight, document.documentElement.clientHeight),
        };
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        // rgb() with no alpha component is opaque; rgba(...) carries the alpha the defect had at 0.
        const alpha = Number(/rgba?\(([^)]*)\)/.exec(cs.backgroundColor)?.[1].split(',')[3] ?? 1);
        // The two STICKY axes issue #145 pinned inside this scrollport. Both are opaque and both
        // outrank the gate's own chrome, so overlapping either one hides the gate behind it.
        const overlaps = (a) => {
          if (!a) return false;
          const b = a.getBoundingClientRect();
          return rect.left < b.right - 0.5 && rect.right > b.left + 0.5 &&
            rect.top < b.bottom - 0.5 && rect.bottom > b.top + 0.5;
        };
        // …and the fact that geometry only stands in for: everywhere across the gate, the element
        // the browser actually hits belongs to the gate. Survives any restyle of either band, and
        // catches an occluder the rect test cannot — a layer that overlaps no BAND but is still
        // punched through by chrome drawn above it (the block's own corner checkbox is z-6).
        // Sampled on a grid inset past the layer's own corner radius: a rounded corner is not part
        // of the element, so probing the literal corners would read "occluded" on every pass.
        const pad = Math.max(14, parseFloat(cs.borderTopLeftRadius) + 2);
        const grid = [];
        for (let i = 0; i <= 4; i++) {
          for (let j = 0; j <= 2; j++) {
            grid.push([
              rect.left + pad + ((rect.width - 2 * pad) * i) / 4,
              rect.top + pad + ((rect.height - 2 * pad) * j) / 2,
            ]);
          }
        }
        // Plus the operative half: every control the gate exists to offer must hit-test to ITSELF
        // at its own centre — the property a user has when nothing is painted over the gate.
        const controls = [...el.querySelectorAll('button, input')];
        return {
          inside:
            rect.left >= view.left - 0.5 &&
            rect.right <= view.right + 0.5 &&
            rect.top >= view.top - 0.5 &&
            rect.bottom <= view.bottom + 0.5,
          escapes: {
            left: Math.round(Math.min(0, rect.left - view.left)),
            right: Math.round(Math.max(0, rect.right - view.right)),
          },
          clearsStickyAxes: !overlaps(strip.querySelector('.dh')) && !overlaps(strip.querySelector('.gut')),
          topmost: grid.every(([x, y]) => {
            const hit = document.elementFromPoint(Math.round(x), Math.round(y));
            return !!hit && (hit === el || el.contains(hit));
          }),
          controlsReachable:
            controls.length > 0 &&
            controls.every((c) => {
              const b = c.getBoundingClientRect();
              const hit = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
              return !!hit && (hit === c || c.contains(hit));
            }),
          opaque: alpha > 0,
          paper: cs.backgroundColor === window.__probe.rgbOf('--paper'),
          raised: cs.boxShadow !== 'none',
          rounded: cs.borderTopLeftRadius !== '0px',
          // Reported, not gated: the gate is far wider than the column it sprang from, which is
          // WHY it has to be a positioned layer. A future redesign may legitimately shrink it.
          widthVsColumn: `${Math.round(rect.width)}/${Math.round(el.closest('.dcol').getBoundingClientRect().width)}`,
        };
      }, [row, gate]);
    };

    // (a) the split picker on the FIRST day column — the case the issue measured off the window.
    const split = await arm('.entry[data-id="40"]', 'split', '.split-at');
    await page.screenshot({ path: join(EVIDENCE, 'main-inline-gate.png'), fullPage: true });
    // (b) the delete confirm on the LAST day column — the mirror a left-only clamp would miss.
    const confirm = await arm('.entry[data-id="41"]', 'delete', '.confirm');

    const contained = split.inside && confirm.inside;
    const chromed = [split, confirm].every((g) => g.opaque && g.paper && g.raised && g.rounded);
    const unoccluded = [split, confirm].every((g) => g.clearsStickyAxes && g.topmost && g.controlsReachable);
    record(
      'INLINE_GATE_CONTAINMENT',
      { contained, chromed, unoccluded },
      `split picker (first column) ${JSON.stringify(split)}; delete confirm (last column) ${JSON.stringify(confirm)}`,
      'main-inline-gate.png',
    );
  });
}

// WRITE_REJECTION_FEEDBACK — §12 R21: a refused core write is surfaced WHERE it was attempted,
// never silently swallowed. Driven over a STRICT-rejecting mock (the strict-listEntries
// precedent, issue #55 — `rejectWrites` makes edit/split/rename/toggle reject with a
// StoreError-shaped message). Folds four facts — edit-mode Save, split confirm, inline
// rename, Stop/toggle.
async function sceneWriteRejectionFeedback(browser) {
  {
    const editReject = await withPage(browser, unifiedFormState(), 'index.html', async (page) => {
      const editRow = '.entry[data-id="80"]';
      const editForm = '.edit-form.entry-form';
      await page.hover(editRow);
      await page.click(`${editRow} [data-act="edit"]`);
      await page.waitForSelector(editForm, { state: 'attached' });
      await page.fill(`${editForm} .edit-desc`, 'an edit core will refuse');
      await page.click(`${editForm} button[type="submit"]`);
      await page.waitForSelector(`${editForm} .ef-warning:not([hidden])`, { state: 'attached' });
      await page.screenshot({ path: join(EVIDENCE, 'main-edit-reject.png'), fullPage: true });
      return page.evaluate(() => {
        const form = document.querySelector('.edit-form.entry-form');
        const warn = form?.querySelector('.ef-warning');
        return {
          formOpen: !!form,
          shown: !!warn && !warn.hidden && warn.textContent.trim().length > 0,
          announced: warn?.getAttribute('role') === 'status' && warn?.hasAttribute('aria-live'),
          message: warn?.textContent.trim() ?? '',
          notWritten: window.__EDITED__ == null,
        };
      });
    }, { rejectWrites: true });

    const splitReject = await withPage(browser, splittableState(), 'index.html', async (page) => {
      const row = '.entry[data-id="30"]';
      await page.hover(row);
      await page.waitForSelector(`${row} [data-act="split"]`, { state: 'attached' });
      await page.click(`${row} [data-act="split"]`);
      await page.waitForSelector(`${row} .split-at .split-input`, { state: 'attached' });
      await page.click(`${row} [data-act="confirm-split"]`);
      await page.waitForSelector(`${row} .split-warning:not([hidden])`, { state: 'attached' });
      return page.evaluate(() => {
        const wrap = document.querySelector('.entry[data-id="30"] .split-at');
        const warn = wrap?.querySelector('.split-warning');
        return {
          formOpen: !!wrap && !!wrap.querySelector('.split-input'),
          shown: !!warn && !warn.hidden && warn.textContent.trim().length > 0,
          announced: warn?.getAttribute('role') === 'status' && warn?.hasAttribute('aria-live'),
          message: warn?.textContent.trim() ?? '',
          notWritten: window.__SPLIT__ == null,
        };
      });
    }, { rejectWrites: true });

    const renameReject = await withPage(browser, clientsState(), 'index.html', async (page) => {
      await page.click('.nav-item[data-view="clients"]');
      await page.waitForSelector('#clients:not([hidden]) .client[data-id] .project', { state: 'attached' });
      const rowSel = '#clients .client[data-id]';
      const current = (await page.textContent(`${rowSel} .client-name`)).trim();
      await page.hover(rowSel);
      await page.click(`${rowSel} [data-act="rename-client"]`);
      await page.waitForSelector(`${rowSel} .rename-form .rename-input`, { state: 'attached' });
      await page.fill(`${rowSel} .rename-form .rename-input`, current + ' Renamed');
      await page.click(`${rowSel} .rename-form button[type="submit"]`);
      await page.waitForSelector(`${rowSel} .rename-warning:not([hidden])`, { state: 'attached' });
      return page.evaluate(() => {
        const form = document.querySelector('#clients .client[data-id] .rename-form');
        const warn = form?.querySelector('.rename-warning');
        return {
          formOpen: !!form && !!form.querySelector('.rename-input'),
          shown: !!warn && !warn.hidden && warn.textContent.trim().length > 0,
          announced: warn?.getAttribute('role') === 'status' && warn?.hasAttribute('aria-live'),
          message: warn?.textContent.trim() ?? '',
          notWritten: window.__RENAMED_CLIENT__ == null,
        };
      });
    }, { rejectWrites: true });

    // (d) STOP/TOGGLE — Stop the running entry from the Active-Timer card: the `toggle` IPC
    // rejects (#61) and the rejection routes to the banner AREA, reworded as a block (.error),
    // announced — never a silent no-op. (The tray-popover twin has its own #pop-warning region.)
    const toggleReject = await withPage(browser, runningState(), 'index.html', async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('#timer-stop', { state: 'visible' });
      await page.click('#timer-stop');
      // §12 R21 / issue #61: the refusal must be VISIBLE on the Timer view — the very surface the
      // Stop was clicked on ("Stop appears dead"). #timer-warning is in the active Timer view, so
      // waiting for state:'visible' asserts a genuinely on-screen region (not an off-view banner).
      await page.waitForSelector('#timer-warning', { state: 'visible' });
      return page.evaluate(() => {
        const t = document.querySelector('#timer-warning');
        const b = document.querySelector('#overlap-banner');
        const rect = t?.getBoundingClientRect();
        return {
          timerShown: !!t && !t.hidden && (rect?.width ?? 0) > 0 && (rect?.height ?? 0) > 0 && t.textContent.trim().length > 0,
          timerAnnounced: t?.getAttribute('role') === 'status' && t?.hasAttribute('aria-live'),
          message: t?.textContent.trim() ?? '',
          bannerMirrors: !!b && !b.hidden && b.classList.contains('error') && b.textContent.trim().length > 0,
        };
      });
    }, { rejectWrites: true });

    // (e) issue 138 — WHAT THE USER READS. Each mock rejects in Electron's real wrapped shape,
    // so every one of these four regions is a chance to paint "Error invoking remote method
    // 'edit': StoreError: …" (which the app did). Each must read as the reason alone: the four
    // kernels exactly, with no invoke wrapper, no exception class, no `tt` flag name.
    const copyOk =
      editReject.message === 'entry end must be after its start' &&
      splitReject.message === 'split point must be strictly inside the entry span' &&
      renameReject.message === 'a client named that already exists' &&
      toggleReject.message === 'stop time is before the entry started' &&
      [editReject, splitReject, renameReject, toggleReject].every((r) => readsClean(r.message));

    const editRejected =
      editReject.formOpen && editReject.shown && editReject.announced && editReject.notWritten;
    const splitRejected =
      splitReject.formOpen && splitReject.shown && splitReject.announced && splitReject.notWritten;
    const renameRejected =
      renameReject.formOpen && renameReject.shown && renameReject.announced && renameReject.notWritten;
    const toggleRejected =
      toggleReject.timerShown && toggleReject.timerAnnounced && toggleReject.bannerMirrors;
    record(
      'WRITE_REJECTION_FEEDBACK',
      { editRejected, splitRejected, renameRejected, toggleRejected, copyOk },
      `edit-save=${JSON.stringify(editReject)} split=${JSON.stringify(splitReject)} rename=${JSON.stringify(renameReject)} toggle=${JSON.stringify(toggleReject)} copy-reads-clean=${copyOk}`,
      'main-edit-reject.png',
    );
  }
}

// ADD_REFUSAL_PALETTE — design.html D15 (issue 139): the add form's ONE message region serves
// BOTH message kinds, so the palette — not the region — is what tells them apart. A refused Save
// is a BLOCK (nothing was written, the form is still open) and must read in the --danger notice;
// an overlap is allowed-but-flagged (the entry SAVED) and must read in the --flag advisory. The
// app shipped the inversion: the refusal wore flag chrome, so colour said "saved with a caveat"
// while the sentence said "nothing was written".
//
// Both states are driven on the same form and scored on COMPUTED colour, because a palette is
// exactly the fact a screenshot-only check lets rot: (a) a refused Save paints #add-warning in
// danger; (b) dismissing the form and reopening it returns the region to its flag base chrome —
// the refusal's state class does not outlive the message and repaint the next advisory; (c) an
// overlapping backfill that COMMITS raises its advisory in flag. Fails if a refusal reads flag,
// if the two states resolve to the same triple, or if the refused write records anything.
async function sceneAddRefusalPalette(browser) {
  // Palette probe over one region: the three painted surfaces plus both token triples, so the
  // justification line shows what was measured against what — not just a boolean.
  const probeAddWarning = () => {
    const { rgbOf } = window.__probe;
    const el = document.querySelector('#add-warning');
    const cs = getComputedStyle(el);
    return {
      erred: el.classList.contains('error'),
      color: cs.color,
      background: cs.backgroundColor,
      border: cs.borderTopColor,
      danger: [rgbOf('--danger'), rgbOf('--danger-weak'), rgbOf('--danger')],
      flag: [rgbOf('--flag'), rgbOf('--flag-bg'), rgbOf('--flag-line')],
    };
  };
  const painted = (p) => [p.color, p.background, p.border];
  const same = (a, b) => a.every((v, i) => v === b[i]);

  const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
  await page.clock.install({ time: new Date(JUDGE_NOW) });
  await page.clock.pauseAt(new Date(JUDGE_NOW));
  await page.addInitScript(initScript(JSON.stringify(addFormState()), { rejectWrites: true }));
  await page.goto(fileUrl('index.html'));
  await page.waitForSelector('.entry', { state: 'attached' });
  await noMotion(page); // a paint assertion reads the cascade, never a frozen mid-transition frame

  await page.click('#add-toggle');
  await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
  await page.waitForSelector('#add-picker .stp-track', { state: 'attached' });
  await page.fill('#add-desc', 'a backfill core will refuse');
  await page.click('#add-go');
  await page.waitForSelector('#add-warning:not([hidden])', { state: 'attached' });
  await page.screenshot({ path: join(EVIDENCE, 'add-refusal-palette.png'), fullPage: true });
  const refused = {
    ...(await page.evaluate(probeAddWarning)),
    ...(await page.evaluate(() => {
      const el = document.querySelector('#add-warning');
      return {
        formOpen: !document.querySelector('#add-form').hidden,
        shown: window.__probe.visible(el) && el.textContent.trim().length > 0,
        announced: el.getAttribute('role') === 'status' && el.hasAttribute('aria-live'),
        message: el.textContent.trim(),
        notWritten: window.__ADDED__ == null,
      };
    })),
  };

  // (b) THE REGION'S OTHER STATE — Cancel and reopen: the region is back to its advisory base
  // chrome. (A refusal that left its state class behind would dress the next overlap warning,
  // which is on the same region, as a hard block — the same inversion pointing the other way.)
  await page.click('#add-cancel');
  await page.click('#add-toggle');
  await page.waitForSelector('#add-picker .stp-track', { state: 'attached' });
  const reopened = await page.evaluate(probeAddWarning);
  await page.close();

  const advisory = await withPage(browser, addFormState(), 'index.html', async (p) => {
    await p.waitForSelector('.entry', { state: 'attached' });
    await noMotion(p);
    await p.click('#add-toggle');
    await p.waitForSelector('#add-picker .stp-track', { state: 'attached' });
    await p.click('#add-go');
    await p.waitForSelector('#overlap-banner:not([hidden])', { state: 'attached' });
    return p.evaluate(() => {
      const { rgbOf, visible } = window.__probe;
      const el = document.querySelector('#overlap-banner');
      const cs = getComputedStyle(el);
      return {
        shown: visible(el),
        written: window.__ADDED__ != null,
        text: el.textContent.trim(),
        erred: el.classList.contains('error'),
        color: cs.color,
        background: cs.backgroundColor,
        border: cs.borderTopColor,
        flag: [rgbOf('--flag'), rgbOf('--flag-bg'), rgbOf('--flag-line')],
      };
    });
  }, { overlap: true });

  const refusalReadsDanger = refused.erred && same(painted(refused), refused.danger);
  const advisoryChromeIntact = !reopened.erred && same(painted(reopened), reopened.flag);
  const advisoryReadsFlag =
    !advisory.erred && same([advisory.color, advisory.background, advisory.border], advisory.flag);
  // The two palettes are only a split if they DIFFER — pin it here so a token edit that collapsed
  // danger onto flag could not make every assertion above pass vacuously.
  const palettesDiffer = !same(refused.danger, refused.flag);
  const refusalAnnounced = refused.formOpen && refused.shown && refused.announced && refused.notWritten;
  const reasonAlone =
    refused.message === 'stop time must be after start time' && readsClean(refused.message);
  const advisoryShown = advisory.shown && advisory.written && /allowed, but flagged/i.test(advisory.text);
  record(
    'ADD_REFUSAL_PALETTE',
    {
      refusalAnnounced,
      reasonAlone,
      refusalReadsDanger,
      advisoryChromeIntact,
      advisoryShown,
      advisoryReadsFlag,
      palettesDiffer,
    },
    `refused save=${JSON.stringify(refused)} (danger=${refusalReadsDanger}); reopened=${JSON.stringify(reopened)} ` +
      `(flag base intact=${advisoryChromeIntact}); overlap advisory=${JSON.stringify(advisory)} (flag=${advisoryReadsFlag}); ` +
      `palettes differ=${palettesDiffer}`,
    'add-refusal-palette.png',
  );
}

// MERGE_CONFLICT — selecting two-plus contiguous CLOSED entries reveals the merge SELECTION
// BAR (design.html D11 / V5), and merging entries that DISAGREE on client/billable raises the
// conflict prompt before committing (§06 R3, §12 R6). The prompt is hosted in app.js — the
// `.editor.conflict-prompt` modal. The renderer sends no clientId/projectId — the winning
// entry's id (winnerId) plus the chosen billable go to the main process, which resolves the
// names.
//
// The scene closes on the modal's KEYBOARD EXIT (issue 147): the app's only modal ignored
// Escape, so a keyboard user mid-merge had no way out of it — craft checklist §4, "Esc
// closes/cancels the innermost thing". The guard lives here rather than in a scene of its own
// because it is the same prompt on the same fixture, and it is scored on the OUTCOME (gone AND
// unmerged), which is what separates a cancel from a silent confirm.
async function sceneMergeConflict(browser) {
  await withPage(browser, mergeConflictState(), 'index.html', async (page) => {
    const barHiddenInitially = await page.evaluate(() => !!document.querySelector('#merge-bar')?.hidden);
    await page.check('.entry[data-id="40"] .sel');
    const barHiddenWithOne = await page.evaluate(() => !!document.querySelector('#merge-bar')?.hidden);
    await page.check('.entry[data-id="41"] .sel');
    const barWithTwo = await page.evaluate(() => {
      const bar = document.querySelector('#merge-bar');
      const count = bar?.querySelector('#merge-count');
      const go = bar?.querySelector('#merge-go');
      return {
        shown: !!bar && !bar.hidden,
        aboveCalendar: !!bar && bar.nextElementSibling?.classList.contains('ebody'),
        countText: count?.textContent.trim() ?? '',
        goLabel: go?.textContent.trim() ?? '',
        goNeutral: !!go && !go.classList.contains('primary'),
      };
    });
    const barShownWithTwo =
      barWithTwo.shown &&
      barWithTwo.aboveCalendar &&
      barWithTwo.countText === '2 selected' &&
      barWithTwo.goLabel === 'Merge' &&
      barWithTwo.goNeutral;
    await page.click('#merge-go');
    await page.waitForSelector('.editor.conflict-prompt', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-merge-conflict.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const panel = document.querySelector('.editor.conflict-prompt');
      const clientOpts = [...(panel?.querySelectorAll('.mc-client') ?? [])];
      const clientLabels = clientOpts.map((r) => r.closest('.mc-opt')?.textContent?.trim());
      const billOpts = [...(panel?.querySelectorAll('.mc-bill') ?? [])];
      return {
        promptShown: !!panel,
        offersClientA: clientLabels.some((l) => /Client A/.test(l)),
        offersClientB: clientLabels.some((l) => /Client B/.test(l)),
        clientChoiceCount: clientOpts.length,
        offersBillable: billOpts.length === 2,
        merged: window.__MERGED__,
      };
    });
    // Escape dismisses the prompt as a CANCEL (issue 147). Asserted on the OUTCOME, not just
    // the dismissal: the element must leave the DOM AND __MERGED__ must still be undefined —
    // an Escape that silently confirmed the merge would clear the DOM just the same and pass a
    // "prompt is gone" check on its way to writing the fold nobody asked for.
    await page.keyboard.press('Escape');
    const afterEscape = await page.evaluate(() => ({
      promptShown: !!document.querySelector('.editor.conflict-prompt'),
      backdropShown: !!document.querySelector('.editor-backdrop'),
      // `?? null` so the recorded justification SHOWS the unmerged fact — JSON.stringify drops
      // an undefined value, and "no merge was written" is the half of this that matters.
      merged: window.__MERGED__ ?? null,
    }));
    const escapeCancels = !afterEscape.promptShown && !afterEscape.backdropShown && !afterEscape.merged;
    const barGatedOnTwo = barHiddenInitially && barHiddenWithOne && barShownWithTwo;
    const promptOffersChoices =
      probe.promptShown &&
      probe.offersClientA &&
      probe.offersClientB &&
      probe.clientChoiceCount === 2 &&
      probe.offersBillable;
    const nothingMergedYet = !probe.merged;
    record(
      'MERGE_CONFLICT',
      { barGatedOnTwo, promptOffersChoices, nothingMergedYet, escapeCancels },
      `selection bar hidden until 2 selected, then shows above the calendar with the "2 selected" pill + neutral Merge (${JSON.stringify(barWithTwo)}); conflict prompt offers client choices + billable, no merge committed yet: ${JSON.stringify(probe)}; ` +
        `Escape cancels the prompt — dismissed with nothing merged (${escapeCancels}): ${JSON.stringify(afterEscape)}`,
      'main-merge-conflict.png',
    );
  });
}

// MERGE_CHOICE_LIFT — design.html D12 inside the app's only modal (issue #144). The
// merge-conflict prompt is where D12 was most plainly abandoned: the chosen option filled
// `--accent-weak` behind an accent border and an inset accent hairline, with an accent radio
// dot, against an unchosen sibling sitting at plain paper — a selection that turned accent, in
// the one dialog whose entire job is "which of these do you choose". A CSS comment conceded the
// deviation; the triage on #144 did not preserve it, because a documented exception suppresses
// its own rediscovery. The repaired idiom is the segmented one (`.seg-btn.on`) at dialog scale:
// the dialog body is paper, so the unchosen peers recess to the sunken `--wash` and stay flat
// while the chosen option is the raised paper chip. Driven over `mergeConflictState` — two
// closed contiguous entries disagreeing on client AND billable, so the prompt offers a real
// choice in two groups.
async function sceneMergeChoiceLift(browser) {
  await withPage(browser, mergeConflictState(), 'index.html', async (page) => {
    await page.check('.entry[data-id="40"] .sel');
    await page.check('.entry[data-id="41"] .sel');
    await page.click('#merge-go');
    await page.waitForSelector('.editor.conflict-prompt .mc-opt.on');

    const readOpts = () =>
      page.evaluate(() => {
        const { rgbOf, visible } = window.__probe;
        const triplets = ['--accent', '--accent-solid', '--accent-weak'].map((n) => rgbOf(n).slice(4, -1));
        const paint = (el) => {
          const cs = getComputedStyle(el);
          return [cs.backgroundColor, cs.backgroundImage, cs.borderTopColor, cs.borderRightColor,
            cs.borderBottomColor, cs.borderLeftColor, cs.boxShadow].join(' | ');
        };
        const carriesAccent = (el) => triplets.some((t) => paint(el).includes(t));
        const paperRgb = rgbOf('--paper');
        const accentWeakRgb = rgbOf('--accent-weak');
        const panel = document.querySelector('.editor.conflict-prompt');
        const opts = [...(panel?.querySelectorAll('.mc-opt') ?? [])];
        const chosen = opts.filter((el) => el.classList.contains('on'));
        const peers = opts.filter((el) => !el.classList.contains('on'));
        // The radio dot is the `.rad::after` pseudo-element — read its computed content so the
        // "shape, not colour" cue is asserted rather than assumed.
        const hasDot = (el) => {
          const r = el.querySelector('.rad');
          return !!r && getComputedStyle(r, '::after').content !== 'none';
        };
        let accentWeakFills = 0;
        for (const el of panel?.querySelectorAll('*') ?? []) {
          if (visible(el) && getComputedStyle(el).backgroundColor === accentWeakRgb) accentWeakFills++;
        }
        return {
          optCount: opts.length,
          chosenCount: chosen.length,
          chosenLabels: chosen.map((el) => el.textContent.trim()),
          accentedOpts: opts.filter(carriesAccent).map((el) => `${el.textContent.trim()}:${paint(el)}`),
          chosenNotPaper: chosen.filter((el) => getComputedStyle(el).backgroundColor !== paperRgb).length,
          chosenNotLifted: chosen.filter((el) => getComputedStyle(el).boxShadow === 'none').length,
          peersLifted: peers.filter((el) => getComputedStyle(el).boxShadow !== 'none').length,
          peersOnPaper: peers.filter((el) => getComputedStyle(el).backgroundColor === paperRgb).length,
          chosenDots: chosen.filter(hasDot).length,
          peerDots: peers.filter(hasDot).length,
          accentWeakFills,
        };
      });

    const first = await readOpts();
    await page.screenshot({ path: join(EVIDENCE, 'merge-choice-lift.png'), fullPage: true });
    await page.click('.editor.conflict-prompt .mc-row .opts .mc-opt:not(.on)');
    const second = await readOpts();

    const shapeOk = first.optCount === 4 && first.chosenCount === 2 && second.chosenCount === 2;
    const liftOk =
      first.chosenNotPaper === 0 &&
      first.chosenNotLifted === 0 &&
      first.peersLifted === 0 &&
      first.peersOnPaper === 0;
    const noAccentOk = first.accentedOpts.length === 0 && first.accentWeakFills === 0;
    const dotOk = first.chosenDots === first.chosenCount && first.peerDots === 0;
    const followsOk =
      second.chosenNotPaper === 0 &&
      second.chosenNotLifted === 0 &&
      second.peersLifted === 0 &&
      second.accentedOpts.length === 0 &&
      JSON.stringify(second.chosenLabels) !== JSON.stringify(first.chosenLabels);
    record(
      'MERGE_CHOICE_LIFT',
      { shapeOk, liftOk, noAccentOk, dotOk, followsOk },
      `merge-conflict option selection is the raised paper chip, never accent — ` +
        `first: ${JSON.stringify(first)}; after choosing the other client: ${JSON.stringify(second)}; ` +
        `shape=${shapeOk} chosen-lifts=${liftOk} no-accent=${noAccentOk} radio-dot-cue=${dotOk} ` +
        `chip-follows-the-choice=${followsOk}`,
      'merge-choice-lift.png',
    );
  });
}

// MERGE_NOCONFLICT — selecting two CONTIGUOUS entries that AGREE on client and billable and
// clicking Merge fires the merge DIRECTLY, with no CONFLICT prompt (nothing to resolve) — and
// no gap confirm either, because the selection is contiguous (10:00 == 10:00). This is the
// "no unnecessary question" counterpart, NOT proof that the agree path never gates: a
// NON-contiguous agreeing selection still gates (MERGE_GAP). The payload carries just the ids
// (no winnerId, no allowGap), §06 R3.
async function sceneMergeNoconflict(browser) {
  await withPage(browser, mergeAgreeState(), 'index.html', async (page) => {
    await page.check('.entry[data-id="50"] .sel');
    await page.check('.entry[data-id="51"] .sel');
    await page.click('#merge-go');
    const probe = await page.evaluate(() => ({
      conflictPromptShown: !!document.querySelector('.editor.conflict-prompt'),
      gapConfirmShown: !!document.querySelector('.confirm-gap'),
      merged: window.__MERGED__,
    }));
    const noPrompts = !probe.conflictPromptShown && !probe.gapConfirmShown;
    const mergesDirectly =
      !!probe.merged &&
      Array.isArray(probe.merged.ids) &&
      probe.merged.ids.length === 2 &&
      probe.merged.winnerId === undefined &&
      probe.merged.allowGap === undefined;
    record(
      'MERGE_NOCONFLICT',
      { noPrompts, mergesDirectly },
      `contiguous agreeing selection merges with no conflict prompt and no gap confirm: ${JSON.stringify(probe)}`,
      'main-merge-conflict.png',
    );
  });
}

// MERGE_GAP — selecting two entries that AGREE on client/billable but are NOT contiguous (a
// positive gap sits between them) and clicking Merge must NOT fold silently: the Merge button
// first swaps into a confirm stating the resulting span/duration (§06 R3, §12 R13 precedent).
// Only the explicit "Merge anyway" tap commits, and the payload then carries allowGap so core
// accepts the fold. This is the regression guard for the filed bug — a gapped merge that
// fabricated the whole gap as billable time with one click, no confirmation.
async function sceneMergeGap(browser) {
  await withPage(browser, mergeGapState(), 'index.html', async (page) => {
    await page.check('.entry[data-id="60"] .sel');
    await page.check('.entry[data-id="61"] .sel');
    await page.click('#merge-go');
    await page.waitForSelector('.confirm-gap', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-merge-gap.png'), fullPage: true });
    const armed = await page.evaluate(() => {
      const gate = document.querySelector('.confirm-gap');
      return {
        confirmShown: !!gate,
        // The confirm names the non-contiguity, the resulting span duration (09:00→15:00 =
        // 06:00:00) and the fabricated gap (10:00→14:00 = 04:00:00). Durations are
        // timezone-independent; the wall-clock endpoints are localized, so we assert the spans.
        namesGap: /not contiguous/i.test(gate?.textContent ?? ''),
        statesSpan: /06:00:00/.test(gate?.textContent ?? ''),
        statesGapDuration: /04:00:00/.test(gate?.textContent ?? ''),
        hasConfirmBtn: !!gate?.querySelector('[data-act="confirm-gap"]'),
        hasCancelBtn: !!gate?.querySelector('[data-act="cancel-gap"]'),
        merged: window.__MERGED__,
      };
    });
    await page.click('[data-act="confirm-gap"]');
    const after = await page.evaluate(() => ({ merged: window.__MERGED__ }));
    const gapArmsConfirm =
      armed.confirmShown &&
      armed.namesGap &&
      armed.statesSpan &&
      armed.statesGapDuration &&
      armed.hasConfirmBtn &&
      armed.hasCancelBtn;
    const nothingMergedOnArm = !armed.merged;
    const confirmMergesWithGap =
      !!after.merged &&
      Array.isArray(after.merged.ids) &&
      after.merged.ids.length === 2 &&
      after.merged.allowGap === true;
    record(
      'MERGE_GAP',
      { gapArmsConfirm, nothingMergedOnArm, confirmMergesWithGap },
      `gapped selection gates on a span/duration confirm before folding; only the explicit confirm commits with allowGap: armed=${JSON.stringify(armed)} after=${JSON.stringify(after)}`,
      'main-merge-gap.png',
    );
  });
}

// DELETE_CONFIRM — Delete is destructive, so the first click only arms a confirm
// affordance; the entry is not removed until an explicit confirm tap (§06 R1).
async function sceneDeleteConfirm(browser) {
  await withPage(browser, editingState(), 'index.html', async (page) => {
    const editRow = '.entry[data-id="20"]';
    await page.click(`${editRow} [data-act="delete"]`);
    const probe = await page.evaluate(() => {
      const row = document.querySelector('.entry[data-id="20"]');
      const confirm = row?.querySelector('.confirm-delete');
      return {
        confirmShown: !!confirm,
        confirmText: confirm ? /Confirm/.test(confirm.textContent) : false,
        confirmBtn: !!row?.querySelector('[data-act="confirm-delete"]'),
        removed: window.__REMOVED__ === true,
      };
    });
    const armShowsConfirm = probe.confirmShown && probe.confirmText && probe.confirmBtn;
    const nothingRemovedOnArm = !probe.removed;
    record(
      'DELETE_CONFIRM',
      { armShowsConfirm, nothingRemovedOnArm },
      `delete arms a confirm step, no immediate remove: ${JSON.stringify(probe)}`,
      'main-edit.png',
    );
  });
}

// CONFIRM_DELETE — §12 R13: destructive actions confirm in the window. A single Delete
// click must surface an in-window confirm and must NOT destroy the entry; only the
// explicit confirm tap removes it, exactly once.
async function sceneConfirmDelete(browser) {
  await withPage(browser, editingState(), 'index.html', async (page) => {
    const editRow = '.entry[data-id="20"]';
    await page.click(`${editRow} [data-act="delete"]`);
    const armed = await page.evaluate(() => {
      const row = document.querySelector('.entry[data-id="20"]');
      const confirm = row?.querySelector('.confirm');
      return {
        confirmShown: !!confirm,
        confirmBtn: !!row?.querySelector('[data-act="confirm-delete"]'),
        cancelBtn: !!row?.querySelector('[data-act="cancel-delete"]'),
        removeCallsAfterArm: (window.__REMOVE_CALLS__ || []).length,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-confirm-delete.png') });
    await page.click(`${editRow} [data-act="confirm-delete"]`);
    await page.waitForFunction(() => (window.__REMOVE_CALLS__ || []).length > 0);
    const confirmed = await page.evaluate(() => ({
      removeCalls: (window.__REMOVE_CALLS__ || []).slice(),
    }));
    const armsWithoutRemoving =
      armed.confirmShown &&
      armed.confirmBtn &&
      armed.cancelBtn &&
      armed.removeCallsAfterArm === 0; // the stray first click destroyed nothing
    const confirmRemovesOnce =
      confirmed.removeCalls.length === 1 && // confirm removed exactly once
      confirmed.removeCalls[0] &&
      confirmed.removeCalls[0].id === 20;
    record(
      'CONFIRM_DELETE',
      { armsWithoutRemoving, confirmRemovesOnce },
      `single Delete click surfaces a confirm and does not remove (calls after arm=${armed.removeCallsAfterArm}); ` +
        `only the explicit confirm removes, exactly once: ${JSON.stringify(confirmed.removeCalls)}`,
      'main-confirm-delete.png',
    );
  });
}

// CONFIRM_DESTRUCTIVE — §17 R11: destructive actions confirm before acting. The §17
// framing of the gate, captured as its own evidence. The remove mock drops the entry from
// the snapshot, so the post-confirm reload reflects the real deletion.
async function sceneConfirmDestructive(browser) {
  await withPage(browser, editingState(), 'index.html', async (page) => {
    const editRow = '.entry[data-id="20"]';
    const presentBefore = await page.evaluate(() => !!document.querySelector('.entry[data-id="20"]'));
    await page.click(`${editRow} [data-act="delete"]`);
    const armed = await page.evaluate(() => {
      const row = document.querySelector('.entry[data-id="20"]');
      return {
        confirmShown: !!row?.querySelector('.confirm'),
        confirmBtn: !!row?.querySelector('[data-act="confirm-delete"]'),
        cancelBtn: !!row?.querySelector('[data-act="cancel-delete"]'),
        stillPresent: !!document.querySelector('.entry[data-id="20"]'),
        removeCallsAfterArm: (window.__REMOVE_CALLS__ || []).length,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-confirm.png') });
    await page.click(`${editRow} [data-act="confirm-delete"]`);
    await page.waitForFunction(() => !document.querySelector('.entry[data-id="20"]'));
    const after = await page.evaluate(() => ({
      goneAfterConfirm: !document.querySelector('.entry[data-id="20"]'),
      removeCalls: (window.__REMOVE_CALLS__ || []).slice(),
    }));
    const armsWithoutRemoving =
      armed.confirmShown &&
      armed.confirmBtn &&
      armed.cancelBtn &&
      armed.stillPresent && // present after the stray first click…
      armed.removeCallsAfterArm === 0; // …and nothing removed by it
    const confirmRemovesOnce =
      after.goneAfterConfirm && // gone only after the explicit confirm…
      after.removeCalls.length === 1 && // …which removed exactly once
      after.removeCalls[0] &&
      after.removeCalls[0].id === 20;
    record(
      'CONFIRM_DESTRUCTIVE',
      { presentBefore, armsWithoutRemoving, confirmRemovesOnce },
      `Delete confirms before acting: present pre-confirm=${armed.stillPresent} (remove calls=${armed.removeCallsAfterArm}); ` +
        `gone post-confirm=${after.goneAfterConfirm}, removed once: ${JSON.stringify(after.removeCalls)}`,
      'main-confirm.png',
    );
  });

}

// CLIENTS_VIEW — the Clients nav view lists active clients with their projects nested,
// and offers create/rename/archive in place; archived items drop out of the active list
// (history kept) (§07, §12). The mutators are wired to the same IPC tt's client/project
// subcommands use.
// The create affordances are DRIVEN, not merely present (issue #48: a duplicate
// id="add-client" dead-ended the "+ Add client" button while every presence-only check
// passed).
// A second, EMPTY-REFERENCE-DATA page (STATES.md Clients × empty, the emptyRefData
// fixture knob) asserts the never-populated view instructs instead of blanking.
async function sceneClientsView(browser) {
  await withPage(browser, clientsState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="clients"]');
    // The view renders its clients/projects from the async listClients/listProjects mock;
    // wait for at least one project sub-row before probing.
    await page.waitForSelector('#clients:not([hidden]) .client .project', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-clients.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const view = document.querySelector('#clients');
      const clients = [...document.querySelectorAll('#clients .client[data-id]')];
      const names = clients.map((c) => c.querySelector('.client-name')?.textContent?.trim());
      const acme = clients.find((c) => c.querySelector('.client-name')?.textContent?.trim() === 'Acme');
      const acmeProjects = acme
        ? [...acme.querySelectorAll('.project[data-id] .project-name')].map((p) => p.textContent.trim())
        : [];
      const clientRename = !!acme?.querySelector('[data-act="rename-client"]');
      const clientArchive = !!acme?.querySelector('[data-act="archive-client"]');
      const projRename = !!acme?.querySelector('.project [data-act="rename-project"]');
      const projArchive = !!acme?.querySelector('.project [data-act="archive-project"]');
      const addProject = !!acme?.querySelector('[data-act="add-project"]');
      const addClient = !!document.querySelector('#add-client-btn');
      // Accent discipline (§15/D16): no element inside the Clients chrome paints the accent
      // as a fill/text colour except a sanctioned .primary confirm (none open by default) —
      // create icons included (accent only when an item is active, D16).
      const { rgbOf, visible: isVisible } = window.__probe;
      const accentRgb = rgbOf('--accent');
      // SVG's el.className is an SVGAnimatedString — stringify via the class ATTRIBUTE so an
      // offending icon prints its real classes, not "[object SVGAnimatedString]".
      const cls = (el) => (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '');
      const offenders = [];
      for (const el of view ? view.querySelectorAll('*') : []) {
        if (el.matches('button.primary') || el.closest('button.primary')) continue;
        const cs = getComputedStyle(el);
        if (cs.backgroundColor === accentRgb || cs.color === accentRgb) {
          offenders.push(`${el.tagName.toLowerCase()}.${cls(el) || '(no-class)'}`);
        }
      }
      // design.html D16 — every visible icon-only affordance in the view carries a non-empty
      // accessible name (aria-label, title, or text); a bare glyph is unusable to AT.
      const unnamedIconButtons = [];
      for (const el of view ? view.querySelectorAll('.iconbtn') : []) {
        if (!isVisible(el)) continue;
        const name =
          (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
        if (!name) unnamedIconButtons.push(`${el.tagName.toLowerCase()}.${cls(el) || '(no-class)'}`);
      }
      return {
        visible: !!view && !view.hidden,
        names,
        acmeProjects,
        clientRename,
        clientArchive,
        projRename,
        projArchive,
        addProject,
        addClient,
        offenders,
        unnamedIconButtons,
      };
    });
    await page.click('#add-client-btn');
    await page.waitForSelector('#clients-list .client-add input[placeholder="New client"]');
    await page.fill('#clients-list .client-add .client-add-input', 'Initech');
    await page.click('#clients-list .client-add button[type="submit"]');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#clients .client-name')].some(
        (n) => n.textContent.trim() === 'Initech',
      ),
    );
    // (2) "+ Add project" on Acme's row: inline "New project" field → commit → the project
    // lands nested under Acme, the payload carrying Acme's id (the renderer resolves no names).
    await page.click('#clients .client[data-id="1"] [data-act="add-project"]');
    await page.waitForSelector(
      '#clients .client[data-id="1"] .project-add input[placeholder="New project"]',
    );
    await page.fill('#clients .client[data-id="1"] .project-add .project-add-input', 'Mobile');
    await page.click('#clients .client[data-id="1"] .project-add button[type="submit"]');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#clients .client[data-id="1"] .project-name')].some(
        (n) => n.textContent.trim() === 'Mobile',
      ),
    );
    // (3) "+ Add tag" on the tag strip: inline "New tag" field → commit → the tag lands in
    // the active strip (addTag wraps core's ensureTag; parity with `tt tag add`).
    await page.click('#add-tag');
    await page.waitForSelector('#tags-list .tag-add input[placeholder="New tag"]');
    await page.fill('#tags-list .tag-add .tag-new-input', 'billing');
    await page.click('#tags-list .tag-add button[type="submit"]');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#tags-list .tag-row-name')].some(
        (n) => n.textContent.trim() === 'billing',
      ),
    );
    const created = await page.evaluate(() => ({
      addedClient: window.__ADDED_CLIENT__ ?? null,
      addedProject: window.__ADDED_PROJECT__ ?? null,
      addedTag: window.__ADDED_TAG__ ?? null,
      clientNames: [...document.querySelectorAll('#clients .client-name')].map((n) =>
        n.textContent.trim(),
      ),
      acmeProjects: [
        ...document.querySelectorAll('#clients .client[data-id="1"] .project-name'),
      ].map((n) => n.textContent.trim()),
      tagNames: [...document.querySelectorAll('#tags-list .tag-row-name')].map((n) =>
        n.textContent.trim(),
      ),
    }));
    await page.screenshot({ path: join(EVIDENCE, 'main-clients-created.png'), fullPage: true });
    // Issue #66: a rename / archive used to DOUBLE the whole list — the write handler called
    // renderClients directly AND the write's changed-broadcast scheduled a second run, and the two
    // interleaved (both cleared #clients-list, then both awaited per-client listProjects, then both
    // appended), so every client, project and tag landed twice (6 cards for 3 clients). Drive a tag
    // archive, a client archive, and — LAST, so no solo render rebuilds the list clean behind it —
    // a client RENAME, whose two racing renders leave the doubled DOM in place. Then flush the
    // microtask queue (a macrotask boundary drains both renders) and assert cardinality: each
    // record renders EXACTLY ONCE (no duplicate data-id) and the counts/names match the mutated
    // active list. The fixture's onChange now fires after each mutator, so this scene reproduces
    // the broadcast race — without the re-entrancy guard the rename doubles and these assertions
    // FAIL (verified by reverting the guard: clientCount 4, dupClientIds [1,99]).
    // (1) Archive the "urgent" tag (id 2): it drops out of the active strip.
    await page.click('#tags-list .tag-row[data-id="2"] [data-act="archive-tag"]');
    await page.waitForSelector('#tags-list .tag-row[data-id="2"]', { state: 'detached' });
    // (2) Archive Globex (id 2): it drops out of the active list (history kept).
    await page.click('#clients .client[data-id="2"] [data-act="archive-client"]');
    await page.waitForSelector('#clients .client[data-id="2"]', { state: 'detached' });
    // (3) Rename Acme (id 1) → "Acme Corp", LAST: open the inline field, commit over renameClient.
    // This write's direct renderClients races the changed-broadcast renderClients — the exact
    // double-render pair — with nothing after it to repaint the list clean. The .first() locators
    // keep the drive robust even if a regression has already doubled the DOM, so the scene reaches
    // the cardinality assertion and FAILS there cleanly rather than hanging on a strict-mode match.
    const acmeRow = page.locator('#clients .client[data-id="1"]').first();
    await acmeRow.locator('[data-act="rename-client"]').click();
    await acmeRow.locator('.rename-form .rename-input').fill('Acme Corp');
    await acmeRow.locator('.rename-form button[type="submit"]').click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#clients .client[data-id="1"] .client-name')].some(
        (n) => n.textContent.trim() === 'Acme Corp',
      ),
    );
    const norace = await page.evaluate(async () => {
      // Drain the microtask queue so BOTH racing renders complete before we count. The JUDGE page
      // clock is PAUSED (page.clock.pauseAt), so setTimeout never fires here — but the renders'
      // awaits are all microtasks (the mock IPC returns Promise.resolve), so yielding the queue
      // enough times settles them. The doubled DOM (if the guard is missing) is fully materialised
      // before the count; with the guard the superseded run has bailed, leaving one clean paint.
      for (let i = 0; i < 100; i++) await Promise.resolve();
      const dupes = (els) => {
        const ids = [...els].map((e) => e.dataset.id);
        return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
      };
      const clientEls = document.querySelectorAll('#clients .client[data-id]');
      const projectEls = document.querySelectorAll('#clients .project[data-id]');
      const tagEls = document.querySelectorAll('#tags-list .tag-row[data-id]');
      return {
        clientCount: clientEls.length,
        projectCount: projectEls.length,
        tagCount: tagEls.length,
        clientNames: [...clientEls].map((e) => e.querySelector('.client-name')?.textContent?.trim()),
        tagNames: [...tagEls].map((e) => e.querySelector('.tag-row-name')?.textContent?.trim()),
        dupClientIds: dupes(clientEls),
        dupProjectIds: dupes(projectEls),
        dupTagIds: dupes(tagEls),
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-clients-mutated.png'), fullPage: true });

    const refEmpty = await withPage(
      browser,
      clientsState(),
      'index.html',
      async (ep) => {
        await ep.click('.nav-item[data-view="clients"]');
        await ep.waitForSelector('#clients:not([hidden]) .clients-empty', { state: 'attached' });
        await ep.waitForSelector('#tags-list .tags-empty', { state: 'attached' });
        await ep.screenshot({ path: join(EVIDENCE, 'main-clients-empty.png'), fullPage: true });
        return ep.evaluate(() => ({
          clientsText:
            document.querySelector('#clients-list .clients-empty')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          tagsText:
            document.querySelector('#tags-list .tags-empty')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          clientRows: document.querySelectorAll('#clients .client[data-id]').length,
          tagRows: document.querySelectorAll('#tags-list .tag-row[data-id]').length,
        }));
      },
      { emptyRefData: true },
    );

    // FOCUS ORDER FOLLOWS THE VISUAL ORDER (design.html A04, the craft checklist's §4 keyboard
    // clause) — the Clients view is the one surface where the design audit reported it broken
    // (issue 161: "the tag rows are visited bottom-first", 976,763 → 938,623). The DOM order was
    // never wrong; the MEASUREMENT was. The audit read each focus stop's VIEWPORT-relative y,
    // and Tabbing to a control below the fold scrolls it into view, so the next stop's viewport y
    // is SMALLER than the previous one's even though it sits lower on the page. Reproduced on this
    // branch: at a viewport short enough to scroll, the Clients walk reads 398 → 210 viewport-
    // relative and 398 → 444 page-relative, from the same two adjacent, correctly ordered rows.
    // So this is the guard the finding was really asking for, written so it cannot repeat the
    // mistake: each stop is measured RELATIVE TO the #clients section's own box in the same frame,
    // which a scroll moves together with the control, and asserted to advance in READING order —
    // down the page, and left-to-right within a row. Walked with "show archived" ON, the view's
    // one real ordering hazard: archived clients and archived tags are appended in a SECOND pass
    // after every active row, so a regression that painted them anywhere but last would break the
    // order here first.
    const focusOrder = await withPage(browser, clientsState(), 'index.html', async (fp) => {
      await fp.click('.nav-item[data-view="clients"]');
      await fp.waitForSelector('#clients:not([hidden]) .client .project', { state: 'attached' });
      await fp.click('#show-archived');
      await fp.waitForSelector('#clients .client.archived[data-id="3"]', { state: 'attached' });
      await fp.waitForSelector('#tags-list .tag-row.archived[data-id="3"]', { state: 'attached' });
      await fp.focus('#show-archived');
      const stops = [];
      for (let i = 0; i < 200; i++) {
        const stop = await fp.evaluate(() => {
          const el = document.activeElement;
          const view = document.querySelector('#clients');
          if (!el || !view || !view.contains(el)) return null;
          const r = el.getBoundingClientRect();
          const v = view.getBoundingClientRect();
          const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
          return {
            x: Math.round(r.left - v.left + r.width / 2),
            y: Math.round(r.top - v.top + r.height / 2),
            name: `${el.dataset.act || el.id || (typeof el.className === 'string' ? el.className : el.tagName.toLowerCase())}[${name.slice(0, 20)}]`,
          };
        });
        if (!stop) break;
        stops.push(stop);
        await fp.keyboard.press('Tab');
      }
      // Two stops share a visual ROW when their centres sit within 8px — comfortably under the
      // ~47px pitch between rows, and comfortably over the few px by which controls of different
      // heights miscentre against each other. A row's controls must then run left-to-right; any
      // other pair must run down the page.
      const SAME_ROW = 8;
      const backwards = [];
      for (let i = 1; i < stops.length; i++) {
        const [a, b] = [stops[i - 1], stops[i]];
        const sameRow = Math.abs(b.y - a.y) <= SAME_ROW;
        if (sameRow ? b.x < a.x : b.y < a.y) {
          backwards.push(`${a.name}@(${a.x},${a.y}) → ${b.name}@(${b.x},${b.y})`);
        }
      }
      return { stopCount: stops.length, backwards, firstStop: stops[0]?.name ?? null, lastStop: stops.at(-1)?.name ?? null };
    });

    const viewSeeded =
      probe.visible &&
      probe.names.includes('Acme') &&
      probe.names.includes('Globex') &&
      probe.acmeProjects.includes('API') &&
      probe.acmeProjects.includes('Web') &&
      probe.clientRename &&
      probe.clientArchive &&
      probe.projRename &&
      probe.projArchive &&
      probe.addProject &&
      probe.addClient &&
      probe.unnamedIconButtons.length === 0;
    const createsLand =
      created.addedClient?.name === 'Initech' &&
      created.clientNames.includes('Initech') &&
      created.addedProject?.name === 'Mobile' &&
      created.addedProject?.clientId === 1 &&
      created.acmeProjects.includes('Mobile') &&
      created.addedTag?.name === 'billing' &&
      created.tagNames.includes('billing');
    const noRaceOnMutate =
      norace.dupClientIds.length === 0 &&
      norace.dupProjectIds.length === 0 &&
      norace.dupTagIds.length === 0 &&
      norace.clientCount === 2 &&
      norace.projectCount === 3 &&
      norace.tagCount === 2 &&
      norace.clientNames.includes('Acme Corp') &&
      !norace.clientNames.includes('Globex') &&
      norace.tagNames.includes('deep') &&
      norace.tagNames.includes('billing') &&
      !norace.tagNames.includes('urgent');
    const emptyInstructs =
      refEmpty.clientRows === 0 &&
      refEmpty.tagRows === 0 &&
      /No clients yet/.test(refEmpty.clientsText) &&
      /tt client add/.test(refEmpty.clientsText) &&
      /No tags yet/.test(refEmpty.tagsText) &&
      /tt tag add/.test(refEmpty.tagsText);
    // The FOCUS-ORDER fact (issue 161): the Tab-walk over the archived-inclusive view advances
    // in reading order at every step. The stop floor guards the guard — a walk that has gone
    // blind (a selector rename, a view that never routed) finds nothing to disorder and would
    // otherwise pass vacuously.
    const focusOrderReads = focusOrder.stopCount >= 15 && focusOrder.backwards.length === 0;
    // Accent discipline (D16 — the whole view chrome is monochrome; icons take accent only
    // when their item is active) is judged visually against the mock, not gated on a
    // computed-style scan (issue #25) — the offender list is kept in the justification as
    // captured evidence only. The D16 accessible-name fact IS machine-gated above.
    record(
      'CLIENTS_VIEW',
      { viewSeeded, createsLand, noRaceOnMutate, emptyInstructs, focusOrderReads },
      `clients listed with nested projects, rename/archive in place: ${JSON.stringify(probe)}; ` +
        `create flows driven — Add client/Add project/Add tag each opened its inline field, ` +
        `committed over the IPC, and landed in the active list: ${JSON.stringify(created)}; ` +
        `rename/archive writes render each record exactly once (issue #66, no duplicate data-id): ${JSON.stringify(norace)}; ` +
        `empty reference data instructs (No clients yet / No tags yet): ${JSON.stringify(refEmpty)}; ` +
        `the Tab-walk over the archived-inclusive view advances in reading order, measured against ` +
        `the view's own box so a scroll cannot fake a backwards step (issue 161): ${JSON.stringify(focusOrder)}`,
      'main-clients.png',
    );
  });
}

// CONFIRM_ARCHIVE — §12 R13: archiving a REFERENCED client/project hides a record that carries
// history, so it is destructive and takes the same two-step gate as Delete. (An UNREFERENCED
// client archives directly — that path is the Globex archive the CLIENTS_VIEW scene drives.)
async function sceneConfirmArchive(browser) {
  await withPage(browser, clientsState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="clients"]');
    await page.waitForSelector('#clients:not([hidden]) .client[data-id="1"]', { state: 'attached' });
    await page.click('#clients .client[data-id="1"] [data-act="archive-client"]');
    const armed = await page.evaluate(() => {
      const row = document.querySelector('#clients .client[data-id="1"]');
      return {
        confirmShown: !!row?.querySelector('.confirm-archive'),
        confirmBtn: !!row?.querySelector('[data-act="confirm-archive"]'),
        cancelBtn: !!row?.querySelector('[data-act="cancel-archive"]'),
        stillListed: !!row,
        archiveCallsAfterArm: (window.__ARCHIVE_CLIENT_CALLS__ || []).length,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-confirm-archive.png'), fullPage: true });
    await page.click('#clients .client[data-id="1"] [data-act="confirm-archive"]');
    await page.waitForSelector('#clients .client[data-id="1"]', { state: 'detached' });
    const confirmed = await page.evaluate(() => ({
      archiveCalls: (window.__ARCHIVE_CLIENT_CALLS__ || []).slice(),
    }));
    const armsWithoutArchiving =
      armed.confirmShown &&
      armed.confirmBtn &&
      armed.cancelBtn &&
      armed.stillListed &&
      armed.archiveCallsAfterArm === 0; // the stray first click archived nothing
    const confirmArchivesOnce =
      confirmed.archiveCalls.length === 1 && // the confirm archived exactly once
      confirmed.archiveCalls[0] &&
      confirmed.archiveCalls[0].id === 1;
    record(
      'CONFIRM_ARCHIVE',
      { armsWithoutArchiving, confirmArchivesOnce },
      `archiving a referenced client arms a confirm and does not archive (calls after arm=${armed.archiveCallsAfterArm}); ` +
        `only the explicit confirm archives, exactly once: ${JSON.stringify(confirmed.archiveCalls)}`,
      'main-confirm-archive.png',
    );
  });
}

// RESTORE_ARCHIVED — §12 R13: archive is a REVERSIBLE hide. Archived records are out of the
// active list by default; a "Show archived" toggle reveals them (with an "archived" pill) each
// carrying a Restore button, and Restore returns the record to the active list.
async function sceneRestoreArchived(browser) {
  await withPage(browser, clientsState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="clients"]');
    await page.waitForSelector('#clients:not([hidden]) .client[data-id="1"]', { state: 'attached' });
    const before = await page.evaluate(() => ({
      archivedClientShown: !!document.querySelector('#clients .client.archived[data-id="3"]'),
      archivedTagShown: !!document.querySelector('#tags-list .tag-row.archived[data-id="3"]'),
    }));
    await page.click('#show-archived');
    await page.waitForSelector('#clients .client.archived[data-id="3"]', { state: 'attached' });
    const revealed = await page.evaluate(() => ({
      archivedClientRestore: !!document.querySelector(
        '#clients .client.archived[data-id="3"] [data-act="restore-client"]',
      ),
      archivedTagRestore: !!document.querySelector(
        '#tags-list .tag-row.archived[data-id="3"] [data-act="restore-tag"]',
      ),
      pill: !!document.querySelector('#clients .client.archived[data-id="3"] .pill'),
    }));
    await page.screenshot({ path: join(EVIDENCE, 'main-clients-archived.png'), fullPage: true });
    await page.click('#clients .client.archived[data-id="3"] [data-act="restore-client"]');
    await page.waitForFunction(
      () => !!document.querySelector('#clients .client[data-id="3"]:not(.archived)'),
    );
    const restored = await page.evaluate(() => ({
      restoredPayload: window.__RESTORED_CLIENT__ || null,
      nowActive: !!document.querySelector('#clients .client[data-id="3"]:not(.archived)'),
    }));
    const archivedHidden = !before.archivedClientShown && !before.archivedTagShown;
    const toggleRevealsRestore =
      revealed.archivedClientRestore && revealed.archivedTagRestore && revealed.pill;
    const restoreReactivates =
      restored.restoredPayload && restored.restoredPayload.id === 3 && restored.nowActive;
    record(
      'RESTORE_ARCHIVED',
      { archivedHidden, toggleRevealsRestore, restoreReactivates },
      `archived records hidden by default (${JSON.stringify(before)}), revealed with a Restore ` +
        `button on "show archived" (${JSON.stringify(revealed)}), and Restore returns the client ` +
        `to the active list: ${JSON.stringify(restored)}`,
      'main-clients-archived.png',
    );
  });
}

// TAG_CHIPS — an entry's tags show in-context as monochrome chips on its calendar event, and the
// running entry's tags show on the summary line (§07, §12). There is NO per-row Edit-tags control
// (DELETED, #43) — tags are edited in the UNIFIED FORM's chip editor (§12 R06/G6).
async function sceneTagChips(browser) {
  await withPage(browser, taggedState(), 'index.html', async (page) => {
    await page.screenshot({ path: join(EVIDENCE, 'main-tags.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const openRow = document.querySelector('.entry[data-id="70"]');
      const closedRow = document.querySelector('.entry[data-id="71"]');
      const summary = document.querySelector('#summary');
      const chipText = (root) =>
        [...(root?.querySelectorAll('.chip') ?? [])].map((c) => c.textContent.trim());
      return {
        openRowChips: chipText(openRow),
        closedRowChips: chipText(closedRow),
        summaryChips: chipText(summary),
        noPerRowTags: !document.querySelector('[data-act="tags"]'),
        totalRowChips: document.querySelectorAll('#entries .chip').length,
      };
    });

    await page.hover('.entry[data-id="71"]');
    await page.click('.entry[data-id="71"] [data-act="edit"]');
    await page.waitForSelector('.edit-form.entry-form .ef-tag-chips', { state: 'attached' });
    const seededChips = await page.evaluate(() =>
      [...document.querySelectorAll('.edit-form .ef-tag-chips .chip')].map((c) => c.textContent.replace('×', '').trim()),
    );
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('.edit-form .ef-tag-chips .chip')].find((c) => /meeting/.test(c.textContent));
      chip?.querySelector('.chip-x')?.click();
    });
    await page.fill('.edit-form .ef-tag-add', 'billing');
    await page.press('.edit-form .ef-tag-add', 'Enter');
    const workingChips = await page.evaluate(() =>
      [...document.querySelectorAll('.edit-form .ef-tag-chips .chip')].map((c) => c.textContent.replace('×', '').trim()),
    );
    await page.click('.edit-form button[type="submit"]');
    await page.waitForFunction(() => !!window.__EDITED__);
    const edited = await page.evaluate(() => window.__EDITED__);

    const patch = (edited && edited.patch) || {};
    const tagsPatchOk =
      !!edited &&
      edited.id === 71 &&
      Array.isArray(patch.addTags) && patch.addTags.join(',') === 'billing' &&
      Array.isArray(patch.removeTags) && patch.removeTags.join(',') === 'meeting' &&
      Object.keys(patch).sort().join(',') === 'addTags,removeTags';
    const chipsOnEvents =
      probe.openRowChips.join(',') === 'deep,urgent' &&
      probe.closedRowChips.join(',') === 'meeting' &&
      probe.summaryChips.join(',') === 'deep,urgent' &&
      probe.noPerRowTags &&
      // 2 (open event) + 1 (closed event) = 3 chips painted across the entries.
      probe.totalRowChips === 3;
    const editorSeedsChips = seededChips.join(',') === 'meeting' && workingChips.join(',') === 'billing';
    record(
      'TAG_CHIPS',
      { chipsOnEvents, editorSeedsChips, tagsPatchOk },
      `tags render as chips on events + running summary; NO per-row tags control; edited via the ` +
        `unified form's chip editor (remove 'meeting', add 'billing') over one edit patch: ` +
        `${JSON.stringify(probe)} seeded=${JSON.stringify(seededChips)} working=${JSON.stringify(workingChips)} ` +
        `edited=${JSON.stringify(edited)} (tagsPatchOk=${tagsPatchOk})`,
      'main-tags.png',
    );
  });
}

// REPORTS_VIEW — §12 R08 / §09 R08–R09 (G11): the in-shell Reports view is the PRIMARY
// surface for SAVED report definitions (it replaces the retired standalone report.html, so
// the sidebar is present). The view is an ACCORDION (issue #268): run-output and the EDIT
// builder expand INSIDE the card they belong to, exactly one card expanded at a time,
// collapse discards the results; only the New-report builder (no card yet) and the
// run-independent Export All Data block live at view level. This one scene drives the REAL
// index.html Reports view under the pinned JUDGE clock with the savedReportsState fixture,
// plus a second page with ZERO saved defs (the savedReports:[] fixture knob) for STATES.md
// Reports × empty.
async function sceneReportsView(browser) {
  await withPage(browser, savedReportsState(), 'index.html', async (page) => {
    // The accordion's 0fr→1fr expand rides a real transition (~160ms); the probes and the
    // evidence frames must read the settled layout, not a mid-expand slice.
    await noMotion(page);
    await page.click('.nav-item[data-view="reports"]');
    await page.waitForFunction(() => document.querySelectorAll('#rep-defs .def').length > 0);

    const list = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#rep-defs .def')].map((d) => ({
        name: d.querySelector('.dname')?.textContent.trim() ?? '',
        spec: d.querySelector('.dspec')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
        hasRun: !!d.querySelector('.def-run'),
        hasEdit: !!d.querySelector('.def-edit'),
      }));
      const nav = document.querySelector('.shell .nav');
      const r = nav ? nav.getBoundingClientRect() : { width: 0 };
      const active = [...document.querySelectorAll('.nav-item.active')].map((b) => b.dataset.view);
      // Accent discipline (design.html D11 / V6): AT REST — the state probed here, with the
      // builder closed — the view's single accent affordance is the + New report primary, FILLED
      // with --accent-solid (tomato·11 — a raw --accent fill under an on-accent label is the prohibited
      // 3.80:1 pair, D04). Anything else VISIBLE in the view painting EITHER family colour
      // (--accent or --accent-solid, fill or text) is a break. Visibility is part of the claim:
      // the closed builder's own commit (#rep-save) is the accent-solid primary of the
      // builder-open state (PRIMARY_HANDOFF), and getComputedStyle reports its fill even inside a
      // display:none subtree — a control nobody can see paints nothing.
      const { rgbOf, visible } = window.__probe;
      const accentRgb = rgbOf('--accent');
      const accentSolidRgb = rgbOf('--accent-solid');
      const inFamily = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        return (
          cs.backgroundColor === accentRgb || cs.color === accentRgb ||
          cs.backgroundColor === accentSolidRgb || cs.color === accentSolidRgb
        );
      };
      const newBtn = document.querySelector('#rep-new');
      const otherAccented = [...document.querySelectorAll('.reports-view *')]
        .filter((el) => el !== newBtn && !el.closest('#rep-new') && visible(el))
        .some((el) => inFamily(el));
      return {
        cards,
        railVisible: !!nav && r.width > 0,
        activeNav: active,
        newSolidFilled: !!newBtn && getComputedStyle(newBtn).backgroundColor === accentSolidRgb,
        otherAccented,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'reports-list.png'), fullPage: true });

    // (a2) §09 R06 / §12 R08 — PRE-RUN, COMPUTED state (issue #262). Before ANY report has
    // run: the run-scoped FILTERED export row is genuinely invisible (computed style, not the
    // hidden attribute — `.report-export { display:flex }` once outspecified the UA's
    // `[hidden] { display:none }`, so the row rendered while its markup said hidden and its
    // buttons silently no-oped), while Export All Data is VISIBLE and WORKING: it is standing
    // chrome with no disarmed state — clicking it pre-run fires a real exportEntries call with
    // scope 'all' and NO saved ref (the whole record needs no report), and the status paints
    // the honest "(all data)" ack.
    const preRun = await page.evaluate(() => {
      const { visible } = window.__probe;
      return {
        runVisible: visible(document.querySelector('#rep-run')),
        filteredVisible: visible(document.querySelector('#rep-run-export')),
        allVisible: visible(document.querySelector('#rep-run-export-all')),
        allCsvVisible: visible(document.querySelector('#rep-export-all-csv')),
      };
    });
    await page.click('#rep-export-all-csv');
    await page.waitForFunction(() => window.__EXPORTED__?.scope === 'all' && window.__EXPORTED__?.format === 'csv');
    await page.waitForFunction(
      () => /all data/.test(document.querySelector('#rep-export-all-status')?.textContent || ''),
    );
    const preRunExport = await page.evaluate(() => ({
      payload: { ...window.__EXPORTED__ },
      status: document.querySelector('#rep-export-all-status')?.textContent.trim() ?? '',
    }));

    await page.click('#rep-new');
    await page.waitForSelector('#rep-builder:not([hidden])', { state: 'attached' });
    const builder = await page.evaluate(() => ({
      // §12 R08: a NEW report has no card yet, so its builder opens at view level — nested
      // under no .def (Edit's builder nests; that is editOpen's probe below).
      nestedIn: document.querySelector('#rep-builder')?.closest('.def')?.dataset.name ?? null,
      name: !!document.querySelector('#rep-name'),
      range: !!document.querySelector('#rep-preset-seg'),
      custom: !!document.querySelector('#rep-custom-range'),
      customHidden: !!document.querySelector('#rep-custom-range')?.hidden,
      fromType: document.querySelector('#rep-range-from')?.type ?? '',
      toType: document.querySelector('#rep-range-to')?.type ?? '',
      datetimeLocals: document.querySelectorAll('#rep-builder input[type="datetime-local"]').length,
      by: !!document.querySelector('#rep-by-seg'),
      client: !!document.querySelector('#rep-client'),
      project: !!document.querySelector('#rep-project'),
      tag: !!document.querySelector('#rep-tag'),
      billable: !!document.querySelector('#rep-billable-seg'),
      rounding: !!document.querySelector('#rep-rounding'),
      increment: !!document.querySelector('#rep-rounding-increment'),
      presets: [...document.querySelectorAll('#rep-preset-seg .preset')].map((c) => c.dataset.preset),
      bys: [...document.querySelectorAll('#rep-by-seg .seg-btn')].map((b) => b.dataset.by),
    }));

    // (h) §12 R21 / §09 R01 — REFUSAL: an incomplete custom range is refused with FEEDBACK, not a
    // silent no-op. Name it, pick Custom…, fill ONLY From, Save → ZERO saveReport calls, the
    // builder STAYS open, the missing field (#rep-range-to) takes focus, and #rep-warning carries
    // a persistent message (a renderer-local refusal that never reaches core, so #65's catch can't
    // cover it — it needs its own feedback).
    await page.click('#rep-preset-seg .preset[data-preset="custom"]');
    await page.waitForSelector('#rep-custom-range:not([hidden])', { state: 'attached' });
    await page.fill('#rep-name', 'Temp report');
    await page.fill('#rep-range-from', '2026-06-01');
    await page.click('#rep-save');
    await page.waitForSelector('#rep-warning:not([hidden])', { state: 'attached' });
    const refuseIncomplete = await page.evaluate(() => ({
      savedYet: window.__SAVED_REPORT__ ?? null, // no saveReport call reached core
      builderOpen: !document.querySelector('#rep-builder')?.hidden,
      toFocused: document.activeElement?.id === 'rep-range-to',
      warnShown: !document.querySelector('#rep-warning')?.hidden &&
        (document.querySelector('#rep-warning')?.textContent.trim().length ?? 0) > 0,
    }));

    // (i) §12 R21 / §13 — REFUSAL: a duplicate report name is refused by core, and the error
    // PERSISTS past the tick (the old setCustomValidity dance erased its own message same-tick).
    // Complete the range, name it an EXISTING def, Save → saveReport rejects → #rep-warning stays
    // visible with the reason, the builder stays open, and no third card appears.
    await page.fill('#rep-range-to', '2026-06-07');
    await page.fill('#rep-name', 'Weekly billables — Globex');
    await page.click('#rep-save');
    await page.waitForSelector('#rep-warning:not([hidden])', { state: 'attached' });
    // Let a tick pass — a self-erasing message would be gone by now; a persistent one stays.
    await page.waitForTimeout(50);
    const refuseDup = await page.evaluate(() => ({
      builderOpen: !document.querySelector('#rep-builder')?.hidden,
      warnPersists: !document.querySelector('#rep-warning')?.hidden &&
        (document.querySelector('#rep-warning')?.textContent.trim().length ?? 0) > 0,
      message: document.querySelector('#rep-warning')?.textContent.trim() ?? '',
      cardCount: document.querySelectorAll('#rep-defs .def').length, // still the two seeded defs
    }));

    // (i2) §12 R21 / §09 R01 — REFUSAL: an INVERTED custom range (From strictly after To) is
    // refused by CORE — such a range only ever resolves to an empty window, so it is rejected
    // rather than stored (the guarantee §14 gives working hours, for report ranges). BOTH dates
    // are present, so this is a genuine core refusal (not the renderer-local incomplete-range
    // check of (h)): saveReport rejects, #rep-warning carries the reason and PERSISTS past the
    // tick, the builder stays open, and no card appears. A fresh (non-duplicate) name isolates
    // the RANGE rejection from the duplicate-name one. (A same-day from == to would be ACCEPTED —
    // the report rule is ≤, unlike the entry rule's strict <; that boundary is pinned in BDD/GOLD.)
    await page.click('#rep-preset-seg .preset[data-preset="custom"]');
    await page.waitForSelector('#rep-custom-range:not([hidden])', { state: 'attached' });
    await page.fill('#rep-name', 'Backwards range');
    await page.fill('#rep-range-from', '2026-06-30');
    await page.fill('#rep-range-to', '2026-06-01');
    await page.click('#rep-save');
    await page.waitForSelector('#rep-warning:not([hidden])', { state: 'attached' });
    await page.waitForTimeout(50); // a self-erasing message would be gone by now; a persistent one stays
    const refuseInverted = await page.evaluate(() => ({
      savedYet: window.__SAVED_REPORT__ ?? null, // core rejected before any save landed
      builderOpen: !document.querySelector('#rep-builder')?.hidden,
      warnPersists: !document.querySelector('#rep-warning')?.hidden &&
        (document.querySelector('#rep-warning')?.textContent.trim().length ?? 0) > 0,
      message: document.querySelector('#rep-warning')?.textContent.trim() ?? '',
      cardCount: document.querySelectorAll('#rep-defs .def').length, // still the two seeded defs
    }));

    await page.click('#rep-preset-seg .preset[data-preset="custom"]');
    await page.waitForSelector('#rep-custom-range:not([hidden])', { state: 'attached' });
    await page.fill('#rep-name', 'June window');
    await page.fill('#rep-range-from', '2026-06-01');
    await page.fill('#rep-range-to', '2026-06-07');
    await page.click('#rep-save');
    await page.waitForFunction(() => !!window.__SAVED_REPORT__);
    await page.waitForFunction(() => document.querySelectorAll('#rep-defs .def').length === 3);
    const customSave = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#rep-defs .def')].map((d) => ({
        name: d.querySelector('.dname')?.textContent.trim() ?? '',
        spec: d.querySelector('.dspec')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
      }));
      return { payload: window.__SAVED_REPORT__ ?? null, cards };
    });
    // Save closes the builder itself (closeBuilder), so no Cancel is needed here.
    await page.waitForSelector('#rep-builder[hidden]', { state: 'attached' });
    await page.click('#rep-defs .def:first-child .def-edit');
    await page.waitForSelector('#rep-builder:not([hidden])', { state: 'attached' });
    const editOpen = await page.evaluate(() => ({
      title: document.querySelector('#rep-builder-title')?.textContent.trim() ?? '',
      name: document.querySelector('#rep-name')?.value ?? '',
      deleteVisible: !document.querySelector('#rep-delete')?.hidden,
      // §12 R08: EDIT joins the accordion — the builder nests inside the edited card's
      // subtree, and that card is the one expanded card.
      nestedIn: document.querySelector('#rep-builder')?.closest('.def')?.dataset.name ?? null,
      openCards: [...document.querySelectorAll('#rep-defs .def.open')].map((c) => c.dataset.name),
    }));
    await page.click('#rep-cancel');
    await page.waitForSelector('#rep-builder[hidden]', { state: 'attached' });

    await page.click('#rep-defs .def:first-child .def-run');
    await page.waitForFunction(() => !document.querySelector('#rep-run')?.hidden && document.querySelectorAll('#rep-run-rows .report-grp').length > 0);
    const run = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('#rep-run-rows .report-grp td:first-child')].map((t) => t.textContent.replace(/\s+/g, ' ').trim());
      const subs = [...document.querySelectorAll('#rep-run-rows .report-sub td:first-child')].map((t) => t.textContent.replace(/\s+/g, ' ').trim());
      const flagRows = [...document.querySelectorAll('#rep-run-rows tr')]
        .filter((tr) => tr.querySelector('.report-flag'))
        .map((tr) => ({ label: tr.querySelector('td:first-child')?.textContent.replace(/\s+/g, ' ').trim() ?? '', flags: [...tr.querySelectorAll('.report-flag')].map((f) => f.textContent.trim()) }));
      const flagOutside = [...document.querySelectorAll('.report-flag')].filter((f) => !f.closest('#rep-run-rows')).length;
      return {
        ranReport: window.__RUN_REPORT__ ?? null,
        rangeHeader: document.querySelector('#rep-run-range')?.textContent.trim() ?? '',
        grand: document.querySelector('#rep-run-grand')?.textContent.trim() ?? '',
        groups,
        subs,
        flagRows,
        flagInTable: document.querySelectorAll('#rep-run-rows .report-flag').length,
        flagOutside,
        // §12 R08 (issue #268) — the accordion: the run-output (and its filtered export row)
        // sit INSIDE the ran card's subtree, that card is the ONLY expanded one, the filtered
        // row carries no scope label (the nesting states the scope), and the run-independent
        // Export All Data block stays view-level — inside no card.
        inCard: document.querySelector('#rep-run')?.closest('.def')?.dataset.name ?? null,
        exportInCard: document.querySelector('#rep-run-export')?.closest('.def')?.dataset.name ?? null,
        openCards: [...document.querySelectorAll('#rep-defs .def.open')].map((c) => c.dataset.name),
        scopeLabelGone: !document.querySelector('#rep-run-export .report-export-scope'),
        allDataInCard: document.querySelector('#rep-run-export-all')?.closest('.def')?.dataset.name ?? null,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'reports-run.png'), fullPage: true });

    // (d) issue #72: TWO export scopes. The report's OWN Export CSV/JSON (beside Run, revealed
    // by the run) carry scope 'filtered' + the saved ref — the rows the report shows
    // (byte-identical to `tt report run <name> --csv|--json`). The run also makes the filtered
    // row COMPUTED-visible (the pre-run probe above proved it computed-invisible before).
    const postRunVisible = await page.evaluate(() => {
      const { visible } = window.__probe;
      return {
        filteredVisible: visible(document.querySelector('#rep-run-export')),
        allVisible: visible(document.querySelector('#rep-run-export-all')),
      };
    });
    await page.click('#rep-export-csv');
    await page.waitForFunction(() => window.__EXPORTED__?.format === 'csv' && window.__EXPORTED__?.scope === 'filtered');
    const afterCsv = await page.evaluate(() => ({ ...window.__EXPORTED__ }));
    await page.click('#rep-export-json');
    await page.waitForFunction(() => window.__EXPORTED__?.format === 'json' && window.__EXPORTED__?.scope === 'filtered');
    const afterJson = await page.evaluate(() => ({ ...window.__EXPORTED__ }));
    // …and Export All Data (set apart at the bottom) carries scope 'all' and NO saved ref even
    // with a run on screen — the whole record (byte-identical to no-flag `tt export`), its
    // status the honest "(all data)".
    await page.click('#rep-export-all-csv');
    await page.waitForFunction(() => window.__EXPORTED__?.format === 'csv' && window.__EXPORTED__?.scope === 'all');
    const afterAllCsv = await page.evaluate(() => ({ ...window.__EXPORTED__ }));
    await page.click('#rep-export-all-json');
    await page.waitForFunction(() => window.__EXPORTED__?.format === 'json' && window.__EXPORTED__?.scope === 'all');
    const afterAllJson = await page.evaluate(() => ({ ...window.__EXPORTED__ }));
    const exportLabels = await page.evaluate(() => ({
      filteredCsv: document.querySelector('#rep-export-csv')?.textContent.trim(),
      filteredJson: document.querySelector('#rep-export-json')?.textContent.trim(),
      allCsv: document.querySelector('#rep-export-all-csv')?.textContent.trim(),
      allJson: document.querySelector('#rep-export-all-json')?.textContent.trim(),
      allStatus: document.querySelector('#rep-export-all-status')?.textContent.trim(),
    }));

    // (d2) §12 R08 (issue #268) — ONE report "run" at a time, and collapse DISCARDS. Running
    // a SECOND report moves the run-output into ITS card: the first card collapses (its body
    // empties — the results were adopted away, not copied), the second is the only .open
    // card. Then the close control collapses the accordion entirely and the results are
    // discarded — the run-output is computed-invisible again, its rows GONE (a re-view costs
    // a re-run), the filtered export row disarmed with it, Export All Data still standing.
    await page.click('.def[data-name="Monthly — all clients by client"] .def-run');
    await page.waitForFunction(
      () => document.querySelector('#rep-run')?.closest('.def')?.dataset.name === 'Monthly — all clients by client',
    );
    const secondRun = await page.evaluate(() => {
      const { visible } = window.__probe;
      const firstBody = document.querySelector('.def[data-name="Weekly billables — Globex"] .def-body-inner');
      return {
        openCards: [...document.querySelectorAll('#rep-defs .def.open')].map((c) => c.dataset.name),
        inCard: document.querySelector('#rep-run')?.closest('.def')?.dataset.name ?? null,
        runVisible: visible(document.querySelector('#rep-run')),
        firstCardBodyEmpty: !!firstBody && firstBody.childElementCount === 0,
      };
    });
    await page.click('#rep-run-close');
    await page.waitForFunction(() => document.querySelectorAll('#rep-defs .def.open').length === 0);
    const collapsed = await page.evaluate(() => {
      const { visible } = window.__probe;
      return {
        openCount: document.querySelectorAll('#rep-defs .def.open').length,
        runVisible: visible(document.querySelector('#rep-run')),
        filteredVisible: visible(document.querySelector('#rep-run-export')),
        rowsDiscarded: document.querySelectorAll('#rep-run-rows tr').length === 0,
        allVisible: visible(document.querySelector('#rep-run-export-all')),
      };
    });

    await page.click('.def[data-name="June window"] .def-kebab');
    await page.waitForSelector('.def .def-menu');
    await page.click('.def-menu [data-act="def-rename"]');
    await page.waitForSelector('#rep-defs .rename-form .rename-input');
    await page.fill('#rep-defs .rename-form .rename-input', 'June window v2');
    await page.press('#rep-defs .rename-form .rename-input', 'Enter');
    await page.waitForFunction(() => !!document.querySelector('.def[data-name="June window v2"]'));
    const renamed = await page.evaluate(() => ({
      payload: window.__RENAMED_REPORT__ ?? null,
      names: [...document.querySelectorAll('#rep-defs .def .dname')].map((n) => n.textContent.trim()),
    }));

    await page.click('.def[data-name="June window v2"] .def-kebab');
    await page.waitForSelector('.def .def-menu');
    await page.click('.def-menu [data-act="def-delete"]');
    await page.waitForSelector('[data-act="confirm-report-delete"]');
    const armed = await page.evaluate(() => ({
      stillListed: !!document.querySelector('.def[data-name="June window v2"]'),
      removedYet: window.__REMOVED_REPORT__ ?? null,
    }));
    await page.click('[data-act="confirm-report-delete"]');
    await page.waitForFunction(() => !document.querySelector('.def[data-name="June window v2"]'));
    const deleted = await page.evaluate(() => ({
      payload: window.__REMOVED_REPORT__ ?? null,
      count: document.querySelectorAll('#rep-defs .def').length,
    }));

    const defsEmpty = await withPage(
      browser,
      savedReportsState(),
      'index.html',
      async (ep) => {
        await ep.click('.nav-item[data-view="reports"]');
        await ep.waitForSelector('#rep-defs-empty:not([hidden])', { state: 'attached' });
        await ep.screenshot({ path: join(EVIDENCE, 'reports-empty.png'), fullPage: true });
        return ep.evaluate(() => {
          const el = document.querySelector('#rep-defs-empty');
          const rect = el?.getBoundingClientRect();
          return {
            shown: !!el && !el.hidden && (rect?.width ?? 0) > 0 && (rect?.height ?? 0) > 0,
            text: el?.textContent?.trim() ?? '',
            cards: document.querySelectorAll('#rep-defs .def').length,
          };
        });
      },
      { savedReports: [] },
    );

    const listOk =
      list.cards.length === 2 &&
      list.cards.every((c) => c.name.length > 0 && c.spec.length > 0 && c.hasRun && c.hasEdit) &&
      list.cards.some((c) => /Weekly billables/.test(c.name)) &&
      list.cards.some((c) => /This week/.test(c.spec) && /project/.test(c.spec));
    const sidebarOk = list.railVisible && list.activeNav.length === 1 && list.activeNav[0] === 'reports';
    const accentOk = list.newSolidFilled && !list.otherAccented;
    const builderOk =
      builder.name && builder.range && builder.custom && builder.by && builder.client &&
      builder.project && builder.tag && builder.billable && builder.rounding && builder.increment &&
      ['today', 'week', 'last-week', 'month', 'last-month', 'custom'].every((p) => builder.presets.includes(p)) &&
      ['client', 'project', 'day', 'week', 'month', 'tag'].every((b) => builder.bys.includes(b)) &&
      builder.nestedIn === null; // a NEW report's builder opens at view level (no card yet)
    const savedSpec = customSave.payload && customSave.payload.rangeSpec;
    const customOk =
      builder.fromType === 'date' && builder.toType === 'date' && builder.datetimeLocals === 0 &&
      builder.customHidden && // the date pair stays tucked behind Custom… until chosen
      !!savedSpec && savedSpec.kind === 'absolute' &&
      savedSpec.fromDate === '2026-06-01' && savedSpec.toDate === '2026-06-07' &&
      Object.keys(savedSpec).sort().join(',') === 'fromDate,kind,toDate' &&
      !String(savedSpec.fromDate).includes('T') && !String(savedSpec.toDate).includes('T') &&
      customSave.cards.some(
        (c) => c.name === 'June window' && c.spec.includes('2026-06-01') && c.spec.includes('2026-06-07'),
      );
    const editOk =
      /Weekly billables/.test(editOpen.title) && /Weekly billables/.test(editOpen.name) && editOpen.deleteVisible &&
      // §12 R08: Edit's builder nests inside the edited card — the one expanded card.
      editOpen.nestedIn === 'Weekly billables — Globex' &&
      editOpen.openCards.length === 1 && editOpen.openCards[0] === 'Weekly billables — Globex';
    const runOk =
      !!run.ranReport && /Weekly billables/.test(String(run.ranReport.ref)) && // Run sent the card's name
      run.rangeHeader.length > 0 && // the resolved-range header paints
      run.groups.some((g) => /Globex/.test(g)) &&
      run.subs.some((s) => /Q3 Strategy/.test(s)) &&
      run.flagInTable >= 2 &&
      run.flagOutside === 0 && // flags IN CONTEXT (none in a separate list)
      run.flagRows.some((r) => /Q3 Strategy/.test(r.label) && r.flags.includes('overlap')) &&
      run.flagRows.some((r) => /Market research/.test(r.label) && r.flags.includes('unreviewed sleep')) &&
      // §12 R08 (issue #268): the results are visually scoped to the report that ran them —
      // run-output + filtered exports inside the ran card's subtree, exactly one card open,
      // no scope label (the nesting states it), Export All Data outside every card.
      run.inCard === 'Weekly billables — Globex' &&
      run.exportInCard === 'Weekly billables — Globex' &&
      run.openCards.length === 1 && run.openCards[0] === 'Weekly billables — Globex' &&
      run.scopeLabelGone &&
      run.allDataInCard === null;
    const preRunExportOk =
      // Computed OUTCOME, not attribute (the issue-262 false green): pre-run, no run-output
      // and no filtered exports are actually painted…
      !preRun.runVisible && !preRun.filteredVisible &&
      // …while Export All Data is standing chrome — laid out, and a click WORKS: a real
      // exportEntries call, scope 'all', whole record (no saved ref), honest "(all data)" ack.
      preRun.allVisible && preRun.allCsvVisible &&
      preRunExport.payload.scope === 'all' && preRunExport.payload.format === 'csv' &&
      preRunExport.payload.savedReportRef === undefined &&
      /all data/.test(preRunExport.status);
    const exportOk =
      // The run reveals the filtered row as a computed outcome (Export All stays standing).
      postRunVisible.filteredVisible && postRunVisible.allVisible &&
      afterCsv.format === 'csv' && afterCsv.scope === 'filtered' &&
      afterJson.format === 'json' && afterJson.scope === 'filtered' &&
      afterCsv.savedReportRef === 'Weekly billables — Globex' && // export FROM the saved report (its ref)
      afterJson.savedReportRef === 'Weekly billables — Globex' &&
      afterAllCsv.format === 'csv' && afterAllCsv.scope === 'all' &&
      afterAllJson.format === 'json' && afterAllJson.scope === 'all' &&
      afterAllCsv.savedReportRef === undefined && // the whole record consults no report, run or not
      afterAllJson.savedReportRef === undefined &&
      /Export All Data/.test(exportLabels.allCsv || '') &&
      /Export All Data/.test(exportLabels.allJson || '') &&
      /all data/.test(exportLabels.allStatus || '');
    const oneOpenOk =
      // Running a second report moves the results into ITS card — the first card collapses
      // and its body is genuinely empty (adopted away, not copied)…
      secondRun.openCards.length === 1 &&
      secondRun.openCards[0] === 'Monthly — all clients by client' &&
      secondRun.inCard === 'Monthly — all clients by client' &&
      secondRun.runVisible &&
      secondRun.firstCardBodyEmpty &&
      // …and closing collapses the accordion entirely, DISCARDING the results: no open card,
      // run-output + filtered exports computed-invisible, the painted rows gone (a re-view
      // costs a re-run), while Export All Data stands untouched.
      collapsed.openCount === 0 &&
      !collapsed.runVisible &&
      !collapsed.filteredVisible &&
      collapsed.rowsDiscarded &&
      collapsed.allVisible;
    const kebabOk =
      !!renamed.payload &&
      renamed.payload.name === 'June window' &&
      renamed.payload.newName === 'June window v2' &&
      renamed.names.includes('June window v2') &&
      !renamed.names.includes('June window') &&
      armed.stillListed &&
      armed.removedYet === null && // arming alone deletes nothing (§12 R13)
      !!deleted.payload &&
      deleted.payload.name === 'June window v2' &&
      deleted.count === 2;
    const refusalOk =
      refuseIncomplete.savedYet === null &&
      refuseIncomplete.builderOpen &&
      refuseIncomplete.toFocused &&
      refuseIncomplete.warnShown &&
      refuseDup.builderOpen &&
      refuseDup.warnPersists &&
      refuseDup.cardCount === 2 &&
      refuseInverted.savedYet === null &&
      refuseInverted.builderOpen &&
      refuseInverted.warnPersists &&
      /before/i.test(refuseInverted.message) &&
      // Issue 138: the builder's #rep-warning reads through the same SU.errMessage, so the
      // Electron-wrapped rejection arrives as the reason alone — the report builder is where
      // the `[object Object]` fork lived (#168) and it must not grow a transport fork either.
      refuseInverted.message === 'report range end must not be before its start' &&
      readsClean(refuseInverted.message) &&
      refuseInverted.cardCount === 2;
    const emptyOk =
      defsEmpty.shown && defsEmpty.text === 'No saved reports yet.' && defsEmpty.cards === 0;
    record(
      'REPORTS_VIEW',
      {
        listOk,
        sidebarOk,
        accentOk,
        builderOk,
        customOk,
        editOk,
        runOk,
        preRunExportOk,
        exportOk,
        oneOpenOk,
        kebabOk,
        refusalOk,
        emptyOk,
      },
      `reports view: list=${JSON.stringify(list)} pre-run=${JSON.stringify(preRun)} pre-run all-data export=${JSON.stringify(preRunExport)} builder=${JSON.stringify(builder)} refuse-incomplete=${JSON.stringify(refuseIncomplete)} refuse-duplicate=${JSON.stringify(refuseDup)} refuse-inverted=${JSON.stringify(refuseInverted)} customSave=${JSON.stringify(customSave)} edit=${JSON.stringify(editOpen)} run=${JSON.stringify(run)} post-run visibility=${JSON.stringify(postRunVisible)} export filtered CSV=${JSON.stringify(afterCsv)} JSON=${JSON.stringify(afterJson)} all-data CSV=${JSON.stringify(afterAllCsv)} JSON=${JSON.stringify(afterAllJson)} labels=${JSON.stringify(exportLabels)} second run=${JSON.stringify(secondRun)} collapsed=${JSON.stringify(collapsed)} inline rename=${JSON.stringify(renamed)} armed=${JSON.stringify(armed)} deleted=${JSON.stringify(deleted)} zero-defs empty=${JSON.stringify(defsEmpty)}`,      'reports-list.png',
    );
  });
}

// ENTRIES_CALENDAR — §12 R09 (the week-only toolbar + week picker) over §12 R16 (the week
// grid). The Entries view shows EXACTLY ONE WEEK: the month-calendar week picker (entry-dot
// days, today ring, selected-week band, a roving-grid keyboard path, no live-timer
// treatment), the prev/next-week steppers, the filters/search on the toolbar's right, and
// the Show-weekend toggle over the persisted show_weekend row. The range concept is GONE:
// no presets, no custom date pair, no range-total chip, no Reports shortcut. Hardened per
// the issue-#55 triage: over the MULTI-WEEK, multi-client, mixed-billable fixture, EACH
// control is driven in turn and the VISIBLE EVENT COUNT is asserted to move to the expected
// subset — counts, not just pixels — with NO listEntries call rejecting
// (window.__LIST_ERRORS__, the mock is strict about `by` exactly like core). Deterministic
// sub-facts are machine-scored under the pinned JUDGE clock (Wed 2026-06-24, weekStart
// monday, show_weekend off).
async function sceneEntriesCalendar(browser) {
  await withPage(browser, listState(), 'index.html', async (page) => {
    const probe = () =>
      page.evaluate(() => ({
        evCount: document.querySelectorAll('.dcol .ev').length,
        evText: [...document.querySelectorAll('.dcol .ev')].map((e) => e.textContent),
        weekLabel: document.querySelector('#el-week-label')?.textContent ?? '',
        wsFirst: document.querySelector('#week-picker .d.ws.first')?.dataset.day ?? null,
        wsLast: document.querySelector('#week-picker .d.ws.last')?.dataset.day ?? null,
      }));
    const waitCount = (n) =>
      page.waitForFunction((n) => document.querySelectorAll('.dcol .ev').length === n, n);

    // The default load paints the CURRENT week (Mon Jun 22 – Fri Jun 26 shown, weekend off) off
    // the snapshot — the five in-week fixture entries lay into their day columns. The retired
    // controls stay retired (#264 chip/shortcut, and now the whole range machinery).
    await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length > 0);
    // The picker's entry dots arrive from one async unfiltered listEntries read — wait for them
    // so the dot facts read a settled picker.
    await page.waitForFunction(() => document.querySelectorAll('#week-picker .edot').length > 0);
    const before = await page.evaluate(() => ({
      hasByControl: !!document.querySelector('#el-by-seg'),
      hasRangeChip: !!document.querySelector('#week-total'),
      hasReportShortcut: !!document.querySelector('#report-btn'),
      hasPresets: !!document.querySelector('#el-preset-seg'),
      hasDatePair: !!document.querySelector('#el-custom-range, #el-range-from, #el-range-to, #el-range-apply'),
      hasPrev: !!document.querySelector('#el-prev-week'),
      hasNext: !!document.querySelector('#el-next-week'),
      hasBillable: !!document.querySelector('#el-billable-seg'),
      hasClientFilter: !!document.querySelector('#el-client'),
      hasProjectFilter: !!document.querySelector('#el-project'),
      hasTagFilter: !!document.querySelector('#el-tag'),
      hasSearch: !!document.querySelector('#search'),
      weekLabel: document.querySelector('#el-week-label')?.textContent ?? '',
      // §12 R09: the filters sit to the RIGHT of the toolbar — the spacer pushes them past
      // the week label. Asserted on the controls sharing the label's row (the toolbar wraps
      // at the 1040 minimum, exactly as the mockup's own toolbar does; a wrapped row cannot
      // be "right of" a label it is below).
      filtersRight: (() => {
        const label = document.querySelector('#el-week-label')?.getBoundingClientRect();
        if (!label) return false;
        return ['#el-billable-seg', '#el-client', '#el-tag', '#search', '#el-weekend'].every((s) => {
          const r = document.querySelector(s)?.getBoundingClientRect();
          return !!r && (r.left > label.right || r.top > label.bottom - 1);
        });
      })(),
      // the week picker (one month calendar beside the grid)
      monthLabel: document.querySelector('#week-picker .wk-hd .m')?.textContent ?? '',
      dotDays: [...document.querySelectorAll('#week-picker .d')]
        .filter((d) => d.querySelector('.edot'))
        .map((d) => d.dataset.day),
      todayCell: document.querySelector('#week-picker .d.today')?.dataset.day ?? null,
      todayRing: (() => {
        const tn = document.querySelector('#week-picker .d.today .tn2');
        return !!tn && getComputedStyle(tn).boxShadow !== 'none';
      })(),
      wsBand: [...document.querySelectorAll('#week-picker .d.ws')].map((d) => d.dataset.day),
      wsFirst: document.querySelector('#week-picker .d.ws.first')?.dataset.day ?? null,
      wsLast: document.querySelector('#week-picker .d.ws.last')?.dataset.day ?? null,
      // §12 R09: the picker renders NO live/running-timer treatment.
      pickerRunMarks: document.querySelectorAll('#week-picker .run-dot, #week-picker .dot').length,
      // the weekend toggle at the toolbar's right, off by default (§14)
      weekendRole: document.querySelector('#el-weekend')?.getAttribute('role') ?? '',
      weekendChecked: document.querySelector('#el-weekend')?.getAttribute('aria-checked') ?? '',
      dayCols: document.querySelectorAll('.dcol').length,
      evCount: document.querySelectorAll('.dcol .ev').length,
    }));

    // PREV WEEK — the visible week steps back to Jun 15–21: one event (last week's 'refactor
    // planning'), the label and the picker's selected-week band move with it.
    await page.click('#el-prev-week');
    await waitCount(1);
    const onPrev = await probe();
    // NEXT WEEK — steps forward again to the current week; the default five return.
    await page.click('#el-next-week');
    await waitCount(5);
    const onNext = await probe();

    // PICKER CLICK — clicking ANY day selects that day's WHOLE week: Jun 17 (a Wednesday)
    // selects Jun 15–21.
    await page.click('#week-picker .d[data-day="2026-06-17"]');
    await waitCount(1);
    const onPicked = await probe();

    // PICKER KEYBOARD — the roving grid: the picked cell holds the grid's one tabindex="0";
    // ArrowRight moves the active cell to the 18th, ArrowDown to the 25th, and Enter selects
    // that day's week (the current week — the five events return).
    await page.focus('#week-picker .d[data-day="2026-06-17"]');
    await page.keyboard.press('ArrowRight');
    const afterRight = await page.evaluate(() => document.activeElement?.dataset?.day ?? null);
    await page.keyboard.press('ArrowDown');
    const afterDown = await page.evaluate(() => document.activeElement?.dataset?.day ?? null);
    await page.keyboard.press('Enter');
    await waitCount(5);
    const onKeyed = await probe();

    // SEARCH — matches three "refactor" descriptions in the fixture, but only the TWO inside
    // the selected week survive (week + search COMPOSE): last week's 'refactor planning'
    // stays excluded. The events narrow to 2.
    await page.fill('#search', 'refactor');
    await page.waitForFunction(() => window.__LIST_REQ__?.search === 'refactor');
    await waitCount(2);
    await page.screenshot({ path: join(EVIDENCE, 'entries-search.png'), fullPage: true });
    const onSearch = await probe();
    await page.fill('#search', '');
    await waitCount(5);

    // BILLABLE TOGGLE — billable drops the non-billable 'team lunch' (4 events);
    // non-billable keeps ONLY it (1 event); all restores the 5.
    await page.click('#el-billable-seg .seg-btn[data-billable="billable"]');
    await page.waitForFunction(() => window.__LIST_REQ__?.billable === 'billable');
    await waitCount(4);
    const onBillable = await probe();
    await page.click('#el-billable-seg .seg-btn[data-billable="non-billable"]');
    await page.waitForFunction(() => window.__LIST_REQ__?.billable === 'non-billable');
    await waitCount(1);
    const onNonBillable = await probe();
    await page.click('#el-billable-seg .seg-btn[data-billable="all"]');
    await page.waitForFunction(() => window.__LIST_REQ__?.billable === 'all');
    await waitCount(5);

    // CLIENT FILTER — Acme (id 1) keeps this week's three Acme entries…
    await page.waitForSelector('#el-client option[value="1"]', { state: 'attached' });
    await page.selectOption('#el-client', '1');
    await page.waitForFunction(() => window.__LIST_REQ__?.clientId === 1);
    await waitCount(3);
    const onClient = await probe();
    // …PROJECT FILTER — its API project (id 11) narrows to the single 'auth refactor'.
    await page.waitForSelector('#el-project option[value="11"]', { state: 'attached' });
    await page.selectOption('#el-project', '11');
    await page.waitForFunction(() => window.__LIST_REQ__?.projectId === 11);
    await waitCount(1);
    const onProject = await probe();
    // Reset the client (project resets with it) — the week's 5 return.
    await page.selectOption('#el-client', '');
    await page.waitForFunction(
      () => window.__LIST_REQ__?.clientId === undefined && window.__LIST_REQ__?.projectId === undefined,
    );
    await waitCount(5);

    // TAG FILTER — 'ci' keeps the week's two ci-tagged entries, then clears.
    await page.fill('#el-tag', 'ci');
    await page.waitForFunction(() => window.__LIST_REQ__?.tag === 'ci');
    await waitCount(2);
    const onTag = await probe();
    await page.fill('#el-tag', '');
    await page.waitForFunction(() => window.__LIST_REQ__?.tag === undefined);
    await waitCount(5);

    // SHOW-WEEKEND TOGGLE — drives the PERSISTED show_weekend row over the same setSetting
    // channel the Settings view uses (§12 R09/§14), and the grid follows: five columns off,
    // seven on, no stored data touched. The captured payload proves the persisted row is the
    // mechanism, not a local flag.
    await page.click('#el-weekend');
    await page.waitForFunction(() => document.querySelectorAll('.dcol').length === 7);
    const onWeekend = await page.evaluate(() => ({
      setSetting: window.__SET_SETTING__ ?? null,
      checked: document.querySelector('#el-weekend')?.getAttribute('aria-checked') ?? '',
      dayCols: document.querySelectorAll('.dcol').length,
      weekLabel: document.querySelector('#el-week-label')?.textContent ?? '',
    }));
    await page.screenshot({ path: join(EVIDENCE, 'entries-calendar.png'), fullPage: true });
    await page.click('#el-weekend');
    await page.waitForFunction(() => document.querySelectorAll('.dcol').length === 5);
    const offWeekend = await page.evaluate(() => ({
      setSetting: window.__SET_SETTING__ ?? null,
      checked: document.querySelector('#el-weekend')?.getAttribute('aria-checked') ?? '',
      weekLabel: document.querySelector('#el-week-label')?.textContent ?? '',
    }));

    // Issue #55: NO listEntries call rejected across the whole drive, EVERY query carried the
    // required by:'day' grouping, and every windowed query carried the week's PLAIN-DATE pair
    // (raw YYYY-MM-DD strings, never a derived instant — the §09 R01 vocabulary).
    const wire = await page.evaluate(() => ({
      errors: window.__LIST_ERRORS__ || 0,
      reqCount: (window.__LIST_REQS__ || []).length,
      allCarryBy: (window.__LIST_REQS__ || []).every((r) => r && r.by === 'day'),
      allPlainDates: (window.__LIST_REQS__ || []).every(
        (r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.fromDate)) && /^\d{4}-\d{2}-\d{2}$/.test(String(r.toDate)),
      ),
    }));

    const controlsOk =
      // the whole range machinery is GONE with the week-only view (#265), the #264 retirements
      // with it — and no grouping control returns.
      !before.hasByControl && !before.hasRangeChip && !before.hasReportShortcut &&
      !before.hasPresets && !before.hasDatePair &&
      // the R09 controls are present, the filters/search/toggle to the toolbar's RIGHT
      before.hasPrev && before.hasNext && before.hasBillable && before.hasClientFilter &&
      before.hasProjectFilter && before.hasTagFilter && before.hasSearch && before.filtersRight;
    const weekDefaultOk =
      before.evCount === 5 && // the current week's five entries, not the fixture's seven
      before.dayCols === 5 && // Mon–Fri, weekend hidden (§14 default)
      before.weekLabel === 'Jun 22 – 26, 2026';
    const pickerOk =
      before.monthLabel === 'June 2026' &&
      // entry-dot days: exactly the June days carrying entries (17, 23, 24 — May's stays off
      // this month's grid); dots are unfiltered by design
      before.dotDays.join(',') === '2026-06-17,2026-06-23,2026-06-24' &&
      before.todayCell === '2026-06-24' && before.todayRing &&
      // the selected week highlighted as ONE unit — all seven days, weekend included
      before.wsBand.length === 7 &&
      before.wsFirst === '2026-06-22' && before.wsLast === '2026-06-28' &&
      before.pickerRunMarks === 0 && // no live-timer treatment (§12 R09)
      before.weekendRole === 'switch' && before.weekendChecked === 'false';
    const stepOk =
      onPrev.evCount === 1 &&
      onPrev.evText.some((t) => /refactor planning/.test(t)) &&
      onPrev.weekLabel === 'Jun 15 – 19, 2026' &&
      onPrev.wsFirst === '2026-06-15' && onPrev.wsLast === '2026-06-21' &&
      onNext.evCount === 5 && onNext.wsFirst === '2026-06-22';
    const pickerSelectOk =
      onPicked.evCount === 1 &&
      onPicked.wsFirst === '2026-06-15' && onPicked.wsLast === '2026-06-21' &&
      onPicked.weekLabel === 'Jun 15 – 19, 2026';
    const pickerKeysOk =
      afterRight === '2026-06-18' && afterDown === '2026-06-25' &&
      onKeyed.evCount === 5 && onKeyed.wsFirst === '2026-06-22';
    const searchOk =
      onSearch.evCount === 2 && // narrowed to the two IN-WEEK "refactor" events…
      onSearch.evText.some((t) => /auth refactor/.test(t)) &&
      onSearch.evText.some((t) => /refactor tests/.test(t)) &&
      !onSearch.evText.some((t) => /deploy pipeline/.test(t)) && // …non-matches excluded…
      !onSearch.evText.some((t) => /refactor planning/.test(t)); // …week + search compose
    const billableOk =
      onBillable.evCount === 4 &&
      !onBillable.evText.some((t) => /team lunch/.test(t)) &&
      onNonBillable.evCount === 1 &&
      onNonBillable.evText.some((t) => /team lunch/.test(t));
    const clientProjectOk =
      onClient.evCount === 3 &&
      !onClient.evText.some((t) => /deploy pipeline|refactor tests/.test(t)) && // Globex excluded
      onProject.evCount === 1 &&
      onProject.evText.some((t) => /auth refactor/.test(t));
    const tagOk =
      onTag.evCount === 2 &&
      onTag.evText.some((t) => /deploy pipeline/.test(t)) &&
      onTag.evText.some((t) => /refactor tests/.test(t));
    const weekendOk =
      onWeekend.setSetting?.key === 'showWeekend' && onWeekend.setSetting?.value === true &&
      onWeekend.checked === 'true' && onWeekend.dayCols === 7 &&
      onWeekend.weekLabel === 'Jun 22 – 28, 2026' &&
      offWeekend.setSetting?.key === 'showWeekend' && offWeekend.setSetting?.value === false &&
      offWeekend.checked === 'false' && offWeekend.weekLabel === 'Jun 22 – 26, 2026';
    const wireOk = wire.errors === 0 && wire.reqCount > 0 && wire.allCarryBy && wire.allPlainDates;
    record(
      'ENTRIES_CALENDAR',
      {
        controlsOk,
        weekDefaultOk,
        pickerOk,
        stepOk,
        pickerSelectOk,
        pickerKeysOk,
        searchOk,
        billableOk,
        clientProjectOk,
        tagOk,
        weekendOk,
        wireOk,
      },
      `week-only entries toolbar: default=${JSON.stringify(before)} -> prev=${JSON.stringify(onPrev)} ` +
        `next=${onNext.evCount}@${onNext.wsFirst} -> picked=${JSON.stringify(onPicked)} ` +
        `-> keys right=${afterRight} down=${afterDown} enter=${onKeyed.evCount}@${onKeyed.wsFirst} ` +
        `-> search=${onSearch.evCount} -> billable=${onBillable.evCount}/${onNonBillable.evCount} ` +
        `-> client=${onClient.evCount} project=${onProject.evCount} -> tag=${onTag.evCount} ` +
        `-> weekend on=${JSON.stringify(onWeekend)} off=${JSON.stringify(offWeekend)} ` +
        `-> wire=${JSON.stringify(wire)}`,
      'entries-calendar.png',
    );
  });
}

// CALENDAR_LAYOUT — §12 R16: the week-grid structure over the real renderer +
// entriesCalendarState. Drives the grid half of the requirement (the toolbar/picker half is
// ENTRIES_CALENDAR above): fit-to-width columns with NO horizontal scroll, taller 60px hours
// over the full 24h track, the today indicator, per-day header totals (start-day attribution),
// cross-midnight segments — including the hidden-day rule (§16): a segment on a day the grid
// does not show is simply not drawn, and the Show-weekend toggle reveals it without changing
// any total. Machine-scored under the pinned JUDGE clock with the page pinned to timezoneId
// 'UTC' so the fixture's UTC instants map to a stable local-time geometry on the 24h track.
async function sceneCalendarLayout(browser) {
  {
    const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.install({ time: new Date(JUDGE_NOW) });
    await page.clock.pauseAt(new Date(JUDGE_NOW));
    await page.addInitScript(initScript(JSON.stringify(entriesCalendarState()), {}));
    await page.goto(fileUrl('index.html'));
    await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length > 0);

    // The 24h track geometry the renderer uses (HOUR_PX=60 — the §12 R16 taller hours): working
    // hours 07:00–18:00 → 420–1080 min → 420–1080 px at 1px/min.
    const pxPerMin = 60 / 60;
    const workStartPx = 420 * pxPerMin;
    const workEndPx = 1080 * pxPerMin;

    const structure = await page.evaluate(
      ({ workStartPx, workEndPx }) => {
        const cols = [...document.querySelectorAll('.dcol')];
        const colWidths = cols.map((c) => c.getBoundingClientRect().width);
        const strip = document.querySelector('.cstrip');
        const track = document.querySelector('.dt');
        const evs = [...document.querySelectorAll('.dcol .ev')];
        const evTop = (el) => parseFloat(el.style.top) || 0;
        const evNum = (el, prop) => Math.round(parseFloat(el.style[prop]) || 0);
        const segsOf = (id) => [...document.querySelectorAll(`.dcol .ev[data-id="${id}"]`)].map((el) => ({
          cls: el.className,
          top: evNum(el, 'top'),
          height: evNum(el, 'height'),
        }));
        const dayTotals = {};
        const dayHasTotal = {};
        for (const dh of document.querySelectorAll('.dcol .dh')) {
          const dd = dh.querySelector('.dd')?.textContent?.trim();
          dayTotals[dd] = dh.querySelector('.ds')?.textContent?.trim() ?? null;
          dayHasTotal[dd] = !!dh.querySelector('.ds');
        }
        const emptyCols = cols.filter((c) => c.querySelectorAll('.dt .ev').length === 0).length;
        const runEv = document.querySelector('.dcol .ev.run');
        const runBg = runEv ? getComputedStyle(runEv).backgroundImage : '';
        const runBt = runEv ? runEv.querySelector('.bt')?.textContent?.trim() ?? '' : '';
        // §12 R16 / G13, issue #145: the day headers must be ON SCREEN at the post-render scroll
        // position, not merely present in the DOM — the sticky header band keeps the totals and
        // the hour labels visible while the working-hours scroll moves the track beneath them.
        const stripRect = strip.getBoundingClientRect();
        const gut = document.querySelector('.gut');
        const dhs = [...document.querySelectorAll('.dcol .dh')];
        const vInside = (el) => {
          const r = el.getBoundingClientRect();
          return r.height > 0 && r.top >= stripRect.top - 0.5 && r.bottom <= stripRect.bottom + 0.5;
        };
        const fullyVisible = (el) => {
          const r = el.getBoundingClientRect();
          return vInside(el) && r.left >= stripRect.left - 0.5 && r.right <= stripRect.right + 0.5;
        };
        // The taller hours, read off the painted gutter: consecutive hour labels sit 60px apart.
        const hlabTops = [...document.querySelectorAll('.gut .hlab')].map((el) => parseFloat(el.style.top));
        const today = document.querySelector('.dcol .dh .dd.today');
        return {
          colCount: cols.length,
          colSpread: colWidths.length ? Math.max(...colWidths) - Math.min(...colWidths) : 0,
          minColWidth: colWidths.length ? Math.round(Math.min(...colWidths)) : 0,
          // §12 R16: fit to width — the columns + gutter FILL the strip and nothing scrolls
          // horizontally at the default window.
          hScroll: !!strip && strip.scrollWidth > strip.clientWidth + 1,
          vScroll: !!strip && strip.scrollHeight > strip.clientHeight,
          scrollTop: strip ? Math.round(strip.scrollTop) : 0,
          trackHeight: track ? Math.round(track.getBoundingClientRect().height) : 0,
          hourStepPx: hlabTops.length > 1 ? hlabTops[1] - hlabTops[0] : 0,
          evCount: evs.length,
          hasBeforeWork: evs.some((el) => evTop(el) < workStartPx),
          hasAfterWork: evs.some((el) => evTop(el) > workEndPx),
          dayTotals,
          dayHasTotal,
          emptyCols,
          overlapBands: document.querySelectorAll('.dcol .ov').length,
          overlapTag: document.querySelector('.dcol .ov .otag')?.textContent?.trim() ?? '',
          sleptHatch: document.querySelectorAll('.dcol .ev .zz').length,
          sleptMoon: !!document.querySelector('.dcol .ev .zz use[href="#i-moon"]'),
          runPresent: !!runEv,
          runFade: /gradient/.test(runBg),
          // §12 R16: the TODAY indicator — the ink ring on the date numeral (Wed 24 under the
          // pinned clock), one and only one, distinct from selection.
          todayCount: document.querySelectorAll('.dcol .dh .dd.today').length,
          todayText: today?.textContent?.trim() ?? null,
          todayRing: !!today && getComputedStyle(today).boxShadow !== 'none',
          // Both-shown cross-midnight (id 8, Mon 22:30 → Tue 06:15) and the weekend-crossing
          // span (id 9, Fri 22:30 → Sat 06:15) whose Sat segment must NOT be drawn (weekend off).
          xmid: segsOf('8'),
          hiddenSegs: segsOf('9'),
          trackBottomPx: 60 * 24,
          runNoEnd: /\d{1,2}:\d{2}/.test(runBt) && !/\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}/.test(runBt),
          headerCount: dhs.length,
          headersOnScreen: dhs.filter(vInside).length,
          dayTotalsOnScreen: [...document.querySelectorAll('.dcol .dh .ds')].filter(fullyVisible).length,
          dayTotalsCount: document.querySelectorAll('.dcol .dh .ds').length,
          dhPosition: dhs[0] ? getComputedStyle(dhs[0]).position : '',
          gutPosition: gut ? getComputedStyle(gut).position : '',
          hourLabelsOnScreen: [...document.querySelectorAll('.gut .hlab')].filter(vInside).length,
        };
      },
      { workStartPx, workEndPx },
    );
    await page.screenshot({ path: join(EVIDENCE, 'main-calendar.png') });

    // §12 R09/R16/§16: the Show-weekend toggle reveals the weekend columns AND the weekend
    // segment of the Fri→Sat span — without giving Sat's header a total (start-day attribution,
    // asserted per §16\'s "hiding a segment never changes attribution or any total") and still
    // with no horizontal scroll at seven columns. Toggled back off so the hover/editor/merge
    // probes below run at the default five-column paint.
    await page.click('#el-weekend');
    await page.waitForFunction(() => document.querySelectorAll('.dcol').length === 7);
    const weekend = await page.evaluate(() => {
      const strip = document.querySelector('.cstrip');
      const cols = [...document.querySelectorAll('.dcol')].map((c) => c.getBoundingClientRect().width);
      const segs = [...document.querySelectorAll('.dcol .ev[data-id="9"]')].map((el) => ({
        cls: el.className,
        top: Math.round(parseFloat(el.style.top) || 0),
        height: Math.round(parseFloat(el.style.height) || 0),
      }));
      const satHead = [...document.querySelectorAll('.dcol .dh')].find(
        (dh) => dh.querySelector('.dd')?.textContent?.trim() === '27',
      );
      return {
        dayCols: cols.length,
        colSpread: cols.length ? Math.max(...cols) - Math.min(...cols) : 0,
        hScroll: !!strip && strip.scrollWidth > strip.clientWidth + 1,
        segs,
        satHasTotal: !!satHead?.querySelector('.ds'),
        friTotal: [...document.querySelectorAll('.dcol .dh')]
          .find((dh) => dh.querySelector('.dd')?.textContent?.trim() === '26')
          ?.querySelector('.ds')?.textContent?.trim() ?? null,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-calendar-weekend.png') });
    await page.click('#el-weekend');
    await page.waitForFunction(() => document.querySelectorAll('.dcol').length === 5);

    await page.hover('.entry[data-id="7"]');
    await page.waitForTimeout(250);
    const hover = await page.evaluate(() => {
      const ev = document.querySelector('.entry[data-id="7"]');
      // §12 R16 (mockup main.html): the hover ops are icon-only `.op-btn` buttons in the `.ops`
      // raised paper chip (they carry the reveal via opacity, so they stay clickable at rest).
      const opsBtn = ev?.querySelector('.ops .op-btn');
      return {
        opsRevealed: opsBtn ? parseFloat(getComputedStyle(opsBtn).opacity) > 0.5 : false,
        hasDelete: !!ev?.querySelector('[data-act="delete"]'),
        hasSplit: !!ev?.querySelector('[data-act="split"]'),
        hasEdit: !!ev?.querySelector('[data-act="edit"]'),
        hasCheckbox: !!ev?.querySelector('.ck'),
      };
    });

    // Clicking an event body opens the unified editor (an off-hours event, so this also exercises
    // the scroll-into-view reachability of the never-clipped 24h track).
    await clickEventBody(page, '.entry[data-id="5"]');
    await page.waitForSelector('.edit-form.entry-form', { state: 'attached' });
    const editorOpen = await page.evaluate(
      () => !!document.querySelector('#entry-form-host .edit-form.entry-form[data-id="5"]') &&
        document.querySelector('.entry[data-id="5"]')?.classList.contains('editing') === true,
    );

    const mergeHiddenBefore = await page.evaluate(() => !!document.querySelector('#merge-bar')?.hidden);
    await page.check('.entry[data-id="7"] .ck');
    await page.check('.entry[data-id="2"] .ck');
    await page.waitForFunction(() => !document.querySelector('#merge-bar')?.hidden);
    const mergeBar = await page.evaluate(() => {
      const bar = document.querySelector('#merge-bar');
      const count = bar?.querySelector('#merge-count');
      const go = bar?.querySelector('#merge-go');
      return {
        shown: !!bar && !bar.hidden,
        aboveCalendar: !!bar && bar.nextElementSibling?.classList.contains('ebody'),
        countText: count?.textContent.trim() ?? '',
        goLabel: go?.textContent.trim() ?? '',
        goNeutral: !!go && !go.classList.contains('primary'),
      };
    });
    const mergeShown =
      mergeBar.shown &&
      mergeBar.aboveCalendar &&
      mergeBar.countText === '2 selected' &&
      mergeBar.goLabel === 'Merge' &&
      mergeBar.goNeutral;

    // §12 R16/R22: five fit-to-width columns (Mon–Fri, weekend hidden) sharing the strip
    // equally, NO horizontal scroll — at the 1040 default the equal share is well past any
    // legibility concern and there is no floor to hold.
    const columnsOk =
      structure.colCount === 5 &&
      structure.colSpread <= 1 &&
      structure.minColWidth > 60 &&
      !structure.hScroll;
    const tallHoursOk = structure.hourStepPx === 60 && structure.trackHeight === 1440;
    const neverClipOk =
      structure.vScroll &&
      structure.scrollTop > 300 &&
      structure.scrollTop < 550 &&
      structure.trackHeight >= 1400 &&
      structure.hasBeforeWork &&
      structure.hasAfterWork;
    const todayOk = structure.todayCount === 1 && structure.todayText === '24' && structure.todayRing;
    // §12 R16 (issue #71): the 22nd's header carries the cross-midnight span in full (start-day
    // attribution) — 4.25h of same-day work + the 7.75h overnight span = 12.00h — and the 26th
    // counts its weekend-crossing span whole (7.75h) though only the start segment draws. A
    // zero-total day paints NO figure (the mockup's authored quiet header).
    const totalsOk =
      structure.dayTotals['22'] === '12.00h' &&
      structure.dayTotals['24'] === '1.00h' &&
      structure.dayTotals['26'] === '7.75h' &&
      structure.dayHasTotal['25'] === false;
    const emptyOk = structure.emptyCols >= 1;
    // §12 R16 (issue #71): the cross-midnight entry renders as exactly TWO segments sharing id 8.
    // The start segment sits at 22:30 (1350 min → 1350px at 60px hours) and runs to the track
    // bottom (a true 90px height, never the 18px sliver); the end segment starts at the track
    // top (0) and runs to 06:15 (375 min → 375px). The two blocks share the one data-id.
    const startSeg = structure.xmid.find((s) => /\bseg-start\b/.test(s.cls));
    const endSeg = structure.xmid.find((s) => /\bseg-end\b/.test(s.cls));
    const crossMidnightOk =
      structure.xmid.length === 2 &&
      !!startSeg &&
      !!endSeg &&
      Math.abs(startSeg.top - 1350) <= 2 && // 22:30
      startSeg.height > 60 && // a TRUE height, not the 18px floor
      Math.abs(startSeg.top + startSeg.height - structure.trackBottomPx) <= 2 && // reaches midnight
      endSeg.top === 0 && // starts at the day\'s top edge (00:00)
      Math.abs(endSeg.height - 375) <= 2; // down to 06:15
    // §12 R09/R16/§16: the Fri→Sat span draws ONLY its start-day segment while the weekend is
    // hidden — the Sat segment is simply not drawn, never a clipped sliver in the start column.
    const hiddenStart = structure.hiddenSegs.find((s) => /\bseg-start\b/.test(s.cls));
    const hiddenSegOk =
      structure.hiddenSegs.length === 1 &&
      !!hiddenStart &&
      Math.abs(hiddenStart.top - 1350) <= 2 &&
      Math.abs(hiddenStart.top + hiddenStart.height - structure.trackBottomPx) <= 2;
    // …and the toggle REVEALS it: seven fit-to-width columns (still no horizontal scroll), the
    // Sat seg-end from the track head down to 06:15, Sat\'s header still total-less, Fri\'s
    // unchanged — hiding/showing a segment never moves a total.
    const wkendEnd = weekend.segs.find((s) => /\bseg-end\b/.test(s.cls));
    const weekendRevealOk =
      weekend.dayCols === 7 &&
      weekend.colSpread <= 1 &&
      !weekend.hScroll &&
      weekend.segs.length === 2 &&
      !!wkendEnd &&
      wkendEnd.top === 0 &&
      Math.abs(wkendEnd.height - 375) <= 2 &&
      !weekend.satHasTotal &&
      weekend.friTotal === '7.75h';
    const flagsOk =
      structure.overlapBands >= 1 &&
      /overlap\s*\d+m/.test(structure.overlapTag) &&
      structure.sleptHatch >= 1 &&
      structure.sleptMoon;
    const runOk = structure.runPresent && structure.runFade && structure.runNoEnd;
    const hoverOk = hover.opsRevealed && hover.hasDelete && hover.hasSplit && hover.hasEdit && hover.hasCheckbox;
    // §12 R16 / G13, issue #145: the labels the grid paints are VISIBLE at the default paint —
    // the header band and the hour gutter are sticky, so the working-hours scroll moves the
    // track past them, never the labels off screen. (The horizontal half of #145 retired with
    // the horizontal scroll itself: the columns fit the width now.)
    const labelsOnScreenOk =
      structure.dhPosition === 'sticky' &&
      structure.gutPosition === 'sticky' &&
      structure.headersOnScreen === structure.colCount &&
      structure.dayTotalsOnScreen === structure.dayTotalsCount &&
      structure.hourLabelsOnScreen > 0;
    record(
      'CALENDAR_LAYOUT',
      {
        columnsOk,
        tallHoursOk,
        neverClipOk,
        todayOk,
        totalsOk,
        emptyOk,
        flagsOk,
        runOk,
        hoverOk,
        labelsOnScreenOk,
        crossMidnightOk,
        hiddenSegOk,
        weekendRevealOk,
        editorOpen,
        mergeHiddenBefore,
        mergeShown,
      },
      `week grid layout: structure=${JSON.stringify(structure)}; weekend=${JSON.stringify(weekend)}; ` +
        `hover=${JSON.stringify(hover)}; labelsOnScreen=${labelsOnScreenOk}; ` +
        `crossMidnight=${crossMidnightOk} hiddenSeg=${hiddenSegOk} weekendReveal=${weekendRevealOk}; ` +
        `editorOpen=${editorOpen}; selection bar hidden-before=${mergeHiddenBefore} ` +
        `shown-after-2=${mergeShown} ${JSON.stringify(mergeBar)}`,
      'main-calendar.png',
    );
    await page.close();
  }
}

// WINDOW_GEOMETRY — §12 R22 (issue #126): the app uses the window it is given, and every
// surface fits the window it ships in. Outcomes, not controls, at real geometry:
//   • the week-only grid FITS TO WIDTH at every size (§12 R16): at the 1040×800 default the
//     five shown columns share the width equally with NO horizontal scroll, and at 1920 the
//     same columns GROW to absorb the resize — every description that ellipsised at 1040
//     renders its full natural width at 1920;
//   • the seven-column weekend-on grid fits the SAME 1040 window — still equal shares, still
//     no horizontal scroll (there is no floor width and no sanctioned horizontal scroll left
//     in this view);
//   • WINDOW (1040×800 — the default AND the minimum): the unified add form, expander open,
//     commits without scrolling — Save entry fully inside the viewport — and the exact-times
//     fields sit inside their picker column with no document-level horizontal overflow
//     (ex-issue #146: #add-to ran 14px past the window); the edit form's same row likewise;
//   • the popover at its auto-sized window (the shipped clamp): card and both actions fully
//     inside, nothing to scroll.
async function sceneWindowGeometry(browser) {
  const measureCalendar = (page) =>
    page.evaluate(() => {
      const strip = document.querySelector('.cstrip');
      const cols = [...document.querySelectorAll('.dcol')];
      const widths = cols.map((c) => c.getBoundingClientRect().width);
      return {
        count: cols.length,
        minWidth: widths.length ? Math.round(Math.min(...widths)) : 0,
        spread: widths.length ? Math.max(...widths) - Math.min(...widths) : 0,
        hScroll: strip.scrollWidth > strip.clientWidth + 1,
        truncatedDescs: [...document.querySelectorAll('.dcol .ev .bd')].filter(
          (b) => b.scrollWidth > b.clientWidth,
        ).length,
      };
    });

  {
    const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.install({ time: new Date(JUDGE_NOW) });
    await page.clock.pauseAt(new Date(JUDGE_NOW));
    await page.addInitScript(initScript(JSON.stringify(entriesCalendarState()), {}));
    await page.goto(fileUrl('index.html'));
    await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length > 0);
    const weekAtDefault = await measureCalendar(page);
    await page.setViewportSize({ width: 1920, height: WINDOW.height });
    const weekAtWide = await measureCalendar(page);
    await page.screenshot({ path: join(EVIDENCE, 'calendar-wide.png') });
    // Back to the minimum, then weekend ON: seven columns must fit the SAME window.
    await page.setViewportSize(WINDOW);
    await page.click('#el-weekend');
    await page.waitForFunction(() => document.querySelectorAll('.dcol').length === 7);
    const weekendAtDefault = await measureCalendar(page);
    await page.close();

    // The unified form at the 1040×800 minimum: committable without scrolling, and the
    // exact-times fields inside their column in BOTH modes (ex-issue #146).
    const addFit = await withPage(browser, addFormState(), 'index.html', async (page) => {
      await page.waitForSelector('.entry', { state: 'attached' });
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
      await page.waitForSelector('#add-picker .stp-track', { state: 'attached' });
      await page.click('#add-times-toggle');
      await page.waitForSelector('#add-times-body:not([hidden])', { state: 'attached' });
      const probe = await page.evaluate(() => {
        const r = (el) => el.getBoundingClientRect();
        const save = document.querySelector('#add-go');
        const col = document.querySelector('#add-form .uf-picker').getBoundingClientRect();
        return {
          scrollY: window.scrollY,
          saveInViewport:
            r(save).top >= 0 && r(save).bottom <= window.innerHeight && r(save).right <= window.innerWidth,
          saveBottom: Math.round(r(save).bottom),
          fieldsInColumn:
            r(document.querySelector('#add-from')).right <= col.right + 0.5 &&
            r(document.querySelector('#add-to')).right <= col.right + 0.5,
          noHOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        };
      });
      await page.screenshot({ path: join(EVIDENCE, 'min-window-add.png') });
      return probe;
    });
    const editFit = await withPage(browser, unifiedFormState(), 'index.html', async (page) => {
      await page.waitForSelector('.dcol .ev', { state: 'attached' });
      await page.evaluate(() => document.querySelector('.entry[data-id="80"] [data-act="edit"]').click());
      await page.waitForSelector('.edit-form.entry-form', { state: 'attached' });
      await page.click('.edit-form .ef-times-toggle');
      return page.evaluate(() => {
        const r = (el) => el.getBoundingClientRect();
        const col = document.querySelector('.edit-form .uf-picker').getBoundingClientRect();
        return {
          fieldsInColumn:
            r(document.querySelector('.edit-form .edit-start')).right <= col.right + 0.5 &&
            r(document.querySelector('.edit-form .edit-end')).right <= col.right + 0.5,
          noHOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        };
      });
    });

    // The popover at the window main.ts gives it (withPage applies the shipped clamp on load).
    const popFit = await withPage(browser, runningState(), 'popover.html', async (page) => {
      const probe = await page.evaluate(() => {
        const inside = (el) => {
          const r = el.getBoundingClientRect();
          return r.left >= -0.5 && r.top >= -0.5 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5;
        };
        return {
          cardInside: inside(document.getElementById('pop')),
          toggleInside: inside(document.getElementById('toggle')),
          openInside: inside(document.getElementById('open')),
          noOverflow:
            document.documentElement.scrollWidth <= window.innerWidth &&
            document.documentElement.scrollHeight <= window.innerHeight,
          window: { w: window.innerWidth, h: window.innerHeight },
        };
      });
      await page.screenshot({ path: join(EVIDENCE, 'popover-fit.png') });
      return probe;
    });

    const weekOk =
      weekAtDefault.count === 5 &&
      weekAtDefault.spread <= 1 &&
      !weekAtDefault.hScroll &&
      weekAtWide.count === 5 &&
      weekAtWide.spread <= 1 &&
      !weekAtWide.hScroll &&
      weekAtWide.minWidth > weekAtDefault.minWidth + 100 && // the resize lands on the columns
      weekAtDefault.truncatedDescs > 0 &&
      weekAtWide.truncatedDescs === 0;
    const weekendOk =
      weekendAtDefault.count === 7 &&
      weekendAtDefault.spread <= 1 &&
      !weekendAtDefault.hScroll;
    const addOk = addFit.scrollY === 0 && addFit.saveInViewport && addFit.fieldsInColumn && addFit.noHOverflow;
    const editOk = editFit.fieldsInColumn && editFit.noHOverflow;
    const popOk = popFit.cardInside && popFit.toggleInside && popFit.openInside && popFit.noOverflow;
    record(
      'WINDOW_GEOMETRY',
      { weekOk, weekendOk, addOk, editOk, popOk },
      `week@1040=${JSON.stringify(weekAtDefault)} week@1920=${JSON.stringify(weekAtWide)} → ${weekOk}; ` +
        `weekend-on@1040=${JSON.stringify(weekendAtDefault)} → ${weekendOk}; ` +
        `add-form@minimum=${JSON.stringify(addFit)} → ${addOk}; edit-form=${JSON.stringify(editFit)} → ${editOk}; ` +
        `popover=${JSON.stringify(popFit)} → ${popOk}`,
      'calendar-wide.png',
    );
  }
}

// CALENDAR_ACCENT_BUDGET — design.html D11 / §02 principles 1–2, machine-scored (issue #143).
// The Entries week grid is the app's busiest surface, and it used to fill every entry block with
// --accent-weak behind an accent border: the design audit measured a calendar of accent-tinted
// blocks and ZERO accent-solid primaries — the colour rationed for "the one thing that matters"
// was the wallpaper. This scene pins the budget as an OUTCOME over a realistically dense fixture
// (denseCalendarState: the current week's elapsed days full — 17 blocks, the last one OPEN; the
// week-only view of §12 R09 caps the visible surface at one week, so a busy week IS the app's
// densest screen), because the defect is invisible at toy density. Driven at the app's 1040×800
// default window with the page pinned to UTC, and AT REST: no toolbar control is touched, so
// what is measured is the view as it loads.
async function sceneCalendarAccentBudget(browser) {
  const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
  await page.clock.install({ time: new Date(JUDGE_NOW) });
  await page.clock.pauseAt(new Date(JUDGE_NOW));
  await page.addInitScript(initScript(JSON.stringify(denseCalendarState()), {}));
  await page.goto(fileUrl('index.html'));
  await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length > 0);

  const probe = await page.evaluate(() => {
    const { rgbOf, visible } = window.__probe;
    // The accent FAMILY as bare "r, g, b" triplets, so an rgba() re-encoding of the same colour
    // (the retired `color-mix(--accent 35%, transparent)` border computed to rgba(229,77,46,.35))
    // is caught alongside the opaque form.
    const triplets = ['--accent', '--accent-solid', '--accent-weak'].map((n) => rgbOf(n).slice(4, -1));
    const paint = (el) => {
      const cs = getComputedStyle(el);
      return [cs.backgroundColor, cs.backgroundImage, cs.borderTopColor, cs.borderRightColor,
        cs.borderBottomColor, cs.borderLeftColor, cs.boxShadow].join(' | ');
    };
    const carriesAccent = (el) => triplets.some((t) => paint(el).includes(t));
    const blocks = [...document.querySelectorAll('.dcol .ev')];
    const running = blocks.filter((el) => el.classList.contains('run'));
    const closed = blocks.filter((el) => !el.classList.contains('run'));
    const paperRgb = rgbOf('--paper');
    const accentWeakRgb = rgbOf('--accent-weak');
    const accentSolidRgb = rgbOf('--accent-solid');
    let accentWeakFills = 0;
    let accentSolidFills = 0;
    for (const el of document.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const bg = getComputedStyle(el).backgroundColor;
      if (bg === accentWeakRgb) accentWeakFills++;
      if (bg === accentSolidRgb) accentSolidFills++;
    }
    return {
      evCount: blocks.length,
      dayColumns: document.querySelectorAll('.dcol').length,
      // The offenders, named — a failure justification points at the blocks, not just a count.
      tintedBlocks: closed.filter(carriesAccent).map((el) => `${el.dataset.id}:${paint(el)}`).slice(0, 5),
      tintedBlockCount: closed.filter(carriesAccent).length,
      notPaper: closed.filter((el) => getComputedStyle(el).backgroundColor !== paperRgb).length,
      notLifted: closed.filter((el) => getComputedStyle(el).boxShadow === 'none').length,
      runningCount: running.length,
      runningCarriesAccent: running.length === 1 && carriesAccent(running[0]),
      // The audit's own two numbers, recomputed here so the report carries the before/after.
      accentWeakFills,
      accentSolidFills,
    };
  });
  await page.screenshot({ path: join(EVIDENCE, 'calendar-accent-budget.png') });
  await page.close();

  const densityOk = probe.evCount >= 15;
  const noWallpaperOk = probe.tintedBlockCount === 0;
  const neutralOk = probe.notPaper === 0 && probe.notLifted === 0;
  const signalOk = probe.runningCount === 1 && probe.runningCarriesAccent;
  const budgetOk = probe.accentSolidFills <= 1;
  record(
    'CALENDAR_ACCENT_BUDGET',
    { densityOk, noWallpaperOk, neutralOk, signalOk, budgetOk },
    `entries calendar accent budget over the dense fixture: ${JSON.stringify(probe)}; ` +
      `density=${densityOk} no-wallpaper=${noWallpaperOk} neutral-surface+lift=${neutralOk} ` +
      `running-is-the-signal=${signalOk} accent-solid≤1=${budgetOk}`,
    'calendar-accent-budget.png',
  );
}

// SELECTION_LIFT — design.html D12, machine-scored on the Entries calendar (issue #144).
// "A chosen thing lifts — a raised paper chip with a shadow — it does not turn accent." The
// calendar broke it at all three of its selection sites: a merge-selected block took an accent
// border plus an inset accent hairline, the corner checkbox that made the choice filled solid
// accent, and the block open in the editor (`.editing`) took the same accent ring. This scene
// pins the repaired idiom as an OUTCOME over the same three-week `denseCalendarState` the
// CALENDAR_ACCENT_BUDGET guard uses (51 blocks, the last one open), at the 1040×800 default
// window with the page pinned to UTC — density matters here too, because "lifted" only means
// something measured against the fifty neighbours that are not.
async function sceneSelectionLift(browser) {
  const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
  await page.clock.install({ time: new Date(JUDGE_NOW) });
  await page.clock.pauseAt(new Date(JUDGE_NOW));
  await page.addInitScript(initScript(JSON.stringify(denseCalendarState()), {}));
  await page.goto(fileUrl('index.html'));
  await page.waitForFunction(() => document.querySelectorAll('.dcol .ev .ck').length > 2);

  // Three CLOSED blocks: two get merge-selected, the third is opened in the editor. Taken from
  // the DOM so the scene never hardcodes fixture ids.
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('.dcol .ev')]
      .filter((el) => !el.classList.contains('run') && el.querySelector('.ck'))
      .slice(0, 3)
      .map((el) => el.dataset.id),
  );
  await page.check(`.ev[data-id="${ids[0]}"] .ck`);
  await page.check(`.ev[data-id="${ids[1]}"] .ck`);
  await page.waitForSelector(`.ev[data-id="${ids[1]}"].on`);
  // The primary evidence frame: the calendar itself, two blocks chosen among forty-nine that are
  // not. Captured BEFORE the editor opens, because the form pushes the strip out of the viewport.
  await page.locator('.cstrip').scrollIntoViewIfNeeded();
  // Park the pointer clear of the strip so the hover ops chip retracts and the frame shows the
  // resting selection, not a block under the cursor.
  await page.mouse.move(600, 20);
  // …and drop focus off the last checkbox, so the focus-within ops chip retracts too.
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: join(EVIDENCE, 'selection-lift.png') });
  await page.click(`.ev[data-id="${ids[2]}"] [data-act="edit"]`);
  await page.waitForSelector('.ev.editing');
  await page.locator('.cstrip').scrollIntoViewIfNeeded();

  const probe = await page.evaluate((sel) => {
    const { rgbOf, visible } = window.__probe;
    // Same accent-family triplet scan CALENDAR_ACCENT_BUDGET uses, so an rgba() re-encoding of
    // an accent is caught alongside the opaque form.
    const triplets = ['--accent', '--accent-solid', '--accent-weak'].map((n) => rgbOf(n).slice(4, -1));
    const paint = (el) => {
      const cs = getComputedStyle(el);
      return [cs.backgroundColor, cs.backgroundImage, cs.borderTopColor, cs.borderRightColor,
        cs.borderBottomColor, cs.borderLeftColor, cs.boxShadow].join(' | ');
    };
    const carriesAccent = (el) => triplets.some((t) => paint(el).includes(t));
    const paperRgb = rgbOf('--paper');
    const accentWeakRgb = rgbOf('--accent-weak');
    const accentSolidRgb = rgbOf('--accent-solid');

    const blocks = [...document.querySelectorAll('.dcol .ev')];
    const closed = blocks.filter((el) => !el.classList.contains('run'));
    const chosen = closed.filter((el) => el.classList.contains('on') || el.classList.contains('editing'));
    const plain = closed.filter((el) => !el.classList.contains('on') && !el.classList.contains('editing'));
    // The resting rung, read off the live surface rather than named: whatever the untouched
    // majority computes IS "not lifted", so the comparison stays token-free.
    const restShadow = plain.length ? getComputedStyle(plain[0]).boxShadow : '';
    const checks = [...document.querySelectorAll('.dcol .ev .ck')].filter((el) => el.checked);

    let accentWeakFills = 0;
    let accentSolidFills = 0;
    // Counted over the CALENDAR STRIP, not the document: the third block is open in the unified
    // form, and that form legitimately carries the view's one accent-solid primary (Save entry)
    // and the picker's accent-weak "me" band. The claim under test is that SELECTION did not put
    // the accent back on the surface #143 cleared, so the strip is the surface to measure.
    const strip = document.querySelector('.cstrip');
    for (const el of strip?.querySelectorAll('*') ?? []) {
      if (!visible(el)) continue;
      const bg = getComputedStyle(el).backgroundColor;
      if (bg === accentWeakRgb) accentWeakFills++;
      if (bg === accentSolidRgb) accentSolidFills++;
    }
    return {
      evCount: blocks.length,
      stripFound: !!strip,
      selectedCount: closed.filter((el) => el.classList.contains('on')).length,
      editingCount: blocks.filter((el) => el.classList.contains('editing')).length,
      editorOpen: !!document.querySelector('#entry-form-host .edit-form.entry-form'),
      // The offenders, named — a failure points at the element, not just a count.
      accentedSelections: chosen.filter(carriesAccent).map((el) => `${el.dataset.id}:${paint(el)}`),
      chosenNotPaper: chosen.filter((el) => getComputedStyle(el).backgroundColor !== paperRgb).length,
      chosenNotLifted: chosen.filter((el) => getComputedStyle(el).boxShadow === restShadow).length,
      chosenShadow: chosen.length ? getComputedStyle(chosen[0]).boxShadow : '',
      restShadow,
      restIsFlat: restShadow === 'none',
      checkedCount: checks.length,
      accentedChecks: checks.filter(carriesAccent).map(paint),
      checksArePaper: checks.every((el) => getComputedStyle(el).backgroundColor === paperRgb),
      accentWeakFills,
      accentSolidFills,
      selIds: sel,
    };
  }, ids);
  await page.screenshot({ path: join(EVIDENCE, 'selection-lift-editing.png') });
  await page.close();

  const stateOk =
    probe.evCount >= 15 && probe.selectedCount === 2 && probe.editingCount === 1 && probe.editorOpen;
  const liftOk =
    probe.chosenNotPaper === 0 && probe.chosenNotLifted === 0 && !probe.restIsFlat;
  const noAccentOk = probe.accentedSelections.length === 0 && probe.accentedChecks.length === 0;
  const checkOk = probe.checkedCount === 2 && probe.checksArePaper;
  const budgetOk = probe.stripFound && probe.accentWeakFills === 0 && probe.accentSolidFills <= 1;
  record(
    'SELECTION_LIFT',
    { stateOk, liftOk, noAccentOk, checkOk, budgetOk },
    `calendar selection over the dense fixture: ${JSON.stringify(probe)}; ` +
      `states=${stateOk} chosen-lifts-off-the-rest=${liftOk} no-accent-on-selection=${noAccentOk} ` +
      `checkbox-is-paper=${checkOk} accent-budget-held=${budgetOk}`,
    'selection-lift.png',
  );
}

// CALENDAR_ENTRY_BLOCK — §12 R16 / design.html D09 + §4 (issues #187, #151): a calendar event
// CONTAINS its own content, and hovering one moves nothing. Both halves are one fix — the ops chip
// is an overlay that reserves no flow space, so the block can clip to its duration without the
// hover padding shoving text out of the bottom — so one scene guards both.
//
// The fixture (shortEntriesCalendarState) seeds the four durations the design audit measured —
// 10 / 30 / 45 / 180 minutes (the audit's 60-minute case became 45 when the week grid's 60px
// hours gave a 60-minute block room for its content). Block height is duration-driven (1px/min,
// floored at 18px) while content height is fixed by text flow (~55px), so they cross at ~55
// minutes and only the sub-55 blocks can spill. This matters more than usual: the audit first KILLED a narrower version of the
// finding after measuring a 132px block, and a scene seeded with hour-plus entries alone would
// reproduce that mistake exactly. The 180-minute block is the control.
//
// Containment is asserted by HIT-TESTING, not by comparing layout rects. `overflow: hidden` clips
// paint, not layout — a clipped `.bt` still reports a getBoundingClientRect() below the block — so
// a rect comparison would either measure nothing (before the fix it fails for the right reason;
// after it, it still fails) or, worse, pin CSS. `document.elementFromPoint` sees what a user's
// pointer sees, through the real clip chain, which is precisely what broke: the first non-visible
// overflow ancestor used to be `.cstrip`, three levels up, so text painted into the hour rows
// beneath.
async function sceneCalendarEntryBlock(browser) {
  const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
  await page.clock.install({ time: new Date(JUDGE_NOW) });
  await page.clock.pauseAt(new Date(JUDGE_NOW));
  await page.addInitScript(initScript(JSON.stringify(shortEntriesCalendarState()), {}));
  await page.goto(fileUrl('index.html'));
  await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length === 4);

  const blocks = await page.evaluate(() => {
    const within = (el, root) => !!el && (el === root || root.contains(el));
    // Park the scrollport on the fixture's own 08:00–16:00 span first: at the 60px hours the
    // default working-hours scroll leaves the 13:00–16:00 control block's foot below the
    // viewport, and an off-screen probe reads null instead of the block (a scroll, not a clip
    // — the same reachability the layout scene asserts).
    const strip = document.querySelector('.cstrip');
    strip.scrollTop = 8 * 60;
    return [...document.querySelectorAll('.dcol .ev')].map((ev) => {
      const r = ev.getBoundingClientRect();
      const midX = Math.round(r.left + r.width / 2);
      // Does the block hit-test to itself? If not, it is off-screen and its spill probes are void.
      const self = document.elementFromPoint(midX, Math.round(r.top + r.height / 2));
      // Two probes below the foot: one hugging the edge, one a line further down — the audit
      // measured spills of 11px (60 min) to 37px (10 min), so both depths are in range.
      const below = [4, 12].map((dy) => {
        const hit = document.elementFromPoint(midX, Math.round(r.bottom + dy));
        return { dy, intoEntry: within(hit, ev), tag: hit ? hit.className || hit.tagName : null };
      });
      const line = (sel) => {
        const el = ev.querySelector(sel);
        if (!el) return null;
        const lr = el.getBoundingClientRect();
        return { top: Math.round(lr.top - r.top), bottom: Math.round(lr.bottom - r.top) };
      };
      return {
        id: ev.dataset.id,
        height: Math.round(r.height),
        selfHit: within(self, ev),
        below,
        bd: line('.bd'),
        bc: line('.bc'),
        bt: line('.bt'),
      };
    });
  });

  // The hover half (#151). The 180-minute control block has room for every line, so a shift would
  // be a pure hover artefact, not a truncation side effect: measure its title, hover, measure again.
  // Measured against the calendar strip's own SCROLL CONTENT rather than the viewport, because
  // Playwright's hover scrolls its target into view when it has to and a viewport reading books
  // that scroll as a layout shift — the same viewport-vs-page measuring error issue 161 turned out
  // to be. It surfaced here the moment the Entries toolbar above the calendar grew 2px, which
  // moved the block 2px past the fold and gave the hover a scroll to do. The claim under test is
  // that hovering moves the block nothing RELATIVE TO THE PAGE, so measure it that way: subtract
  // the strip's own box (which scrolls with its contents) and add back its scrollTop.
  const titleTop = () =>
    page.evaluate(() => {
      const ev = document.querySelector('.dcol .ev[data-id="204"]');
      const strip = document.querySelector('.cstrip');
      const s = strip.getBoundingClientRect();
      const at = (el) => Math.round(el.getBoundingClientRect().top - s.top + strip.scrollTop);
      return { title: at(ev.querySelector('.bd')), block: at(ev) };
    });
  const atRest = await titleTop();
  await page.hover('.dcol .ev[data-id="204"]');
  await page.waitForFunction(
    () => parseFloat(getComputedStyle(document.querySelector('.dcol .ev[data-id="204"] .ops .op-btn')).opacity) > 0.5,
  );
  const hovered = await titleTop();
  await page.screenshot({ path: join(EVIDENCE, 'main-calendar-short.png') });
  await page.close();

  const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
  const liveOk = blocks.length === 4 && blocks.every((b) => b.selfHit);
  const containedOk = blocks.every((b) => b.below.every((p) => !p.intoEntry));
  // The three sub-55-minute blocks must genuinely overflow their height — otherwise the fixture
  // stopped exercising the defect and `containedOk` is proving nothing.
  const shortfallReal = ['201', '202', '203'].every((id) => {
    const b = byId[id];
    return !!b && !!b.bt && b.bt.bottom > b.height;
  });
  const control = byId['204'];
  const controlIntact =
    !!control &&
    [control.bd, control.bc, control.bt].every((l) => !!l && l.top >= 0 && l.bottom <= control.height);
  const titleShift = Math.abs(hovered.title - atRest.title);
  const blockShift = Math.abs(hovered.block - atRest.block);
  const noHoverShift = titleShift === 0 && blockShift === 0;
  record(
    'CALENDAR_ENTRY_BLOCK',
    { liveOk, containedOk, shortfallReal, controlIntact, noHoverShift },
    `short-entry blocks=${JSON.stringify(blocks)}; live=${liveOk} contained=${containedOk} ` +
      `shortfall-real=${shortfallReal} control-intact=${controlIntact}; ` +
      `hover title ${atRest.title}->${hovered.title} (delta ${titleShift}px), ` +
      `block ${atRest.block}->${hovered.block} (delta ${blockShift}px)`,
    'main-calendar-short.png',
  );
}

// CALENDAR_KEYBOARD — §12 R14 · design.html A04, machine-scored over the dense fixture (issue 140).
// "Focus visible on every interactive element, NEVER FULLY OBSCURED." The calendar broke it twice
// over. Each entry block hid four controls behind hover — the merge checkbox and Delete / Split /
// Edit — and all four were top-level tab stops, so on the design audit's three-week seed the Tab
// key walked ~200 of them before reaching anything else in the view. Fifty of those stops were the
// merge checkbox, at `opacity: 0` (`.ck` had `:hover` / `:checked` / `.on` clauses and no focus
// clause at all, while `.op-btn` beside it already took its opacity from `.ev:focus-within`) —
// and `opacity` takes the outline with it, so the focus ring did not paint either: the focused
// control and its indicator invisible together. Hence the effective-opacity probe below.
//
// The fix is a roving focus: the BLOCK is the one tab stop, its controls are `tabindex="-1"` and
// are reached with ← / → from the focused block, and `.ev:focus-within` opens the whole set — so
// arriving at an entry is also how a keyboard user learns the controls are there.
//
// Driven over `denseCalendarState` (the dense current week — 17 blocks, the last one open; the
// week-only view caps the surface at one week, so a busy week is the densest calendar the app can
// show) at the app's 1040×800 default window, pinned to UTC. Density is the whole guard, per the
// issue-#55 lesson the triage cites: at one day of data the traversal cost is invisible and any
// stop model looks fine.
// Motion is off (noMotion) so an opacity probe reads the cascade, not a frame of the 0.12s fade.
async function sceneCalendarKeyboard(browser) {
  const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light', timezoneId: 'UTC' });
  await page.clock.install({ time: new Date(JUDGE_NOW) });
  await page.clock.pauseAt(new Date(JUDGE_NOW));
  await page.addInitScript(initScript(JSON.stringify(denseCalendarState()), {}));
  await page.goto(fileUrl('index.html'));
  await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length > 0);
  await noMotion(page);

  // The in-page reader every probe below shares: what the active element IS, whether it is in the
  // calendar strip, and — the A04 question — whether it can actually be SEEN while it holds focus.
  const ACTIVE = () => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return { body: true };
    // Effective opacity: a control at opacity 1 inside a container at 0 is still invisible, so the
    // whole ancestor chain multiplies in. This is exactly what the old .ck failed.
    let opacity = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      opacity *= parseFloat(getComputedStyle(n).opacity);
    }
    const cs = getComputedStyle(el);
    const block = el.closest('.dcol .ev');
    return {
      body: false,
      label: el.dataset && el.dataset.act ? el.dataset.act : String(el.className || '') || el.tagName,
      inCalendar: !!el.closest('.cstrip'),
      isBlock: block === el,
      blockId: block ? block.dataset.id : null,
      opacity,
      ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
    };
  };

  const fixture = await page.evaluate(() => ({
    blocks: document.querySelectorAll('.dcol .ev').length,
    controls: document.querySelectorAll('.dcol .ev .ck, .dcol .ev .op-btn').length,
  }));

  // The walk: one full Tab cycle from the top of the window, ending where the browser wraps back
  // to <body>. The calendar is the tail of the Entries tab order, so "escaping" it means reaching
  // that wrap — what the audit's 70-press walk never managed. The budget is set past the OLD stop
  // count so a regression still terminates and gets MEASURED: the justification then carries the
  // real number rather than an exhausted budget.
  await page.evaluate(() => document.body.focus());
  const walk = [];
  const budget = fixture.controls + 60;
  let wrapped = false;
  for (let i = 0; i < budget; i++) {
    await page.keyboard.press('Tab');
    const step = await page.evaluate(ACTIVE);
    if (step.body) {
      wrapped = true; // the tab order came back around — the whole window has been walked
      break;
    }
    walk.push(step);
  }

  // The roving half, driven with REAL key presses on a block early enough to sit in frame.
  const sampleId = await page.evaluate(() => document.querySelectorAll('.dcol .ev')[3].dataset.id);
  await page.focus(`.dcol .ev[data-id="${sampleId}"]`);
  const expected = await page.evaluate(
    (id) => [...document.querySelectorAll(`.dcol .ev[data-id="${id}"] .ck, .dcol .ev[data-id="${id}"] .op-btn`)]
      .map((el) => el.dataset.act),
    sampleId,
  );
  const roving = [];
  for (let i = 0; i < expected.length; i++) {
    await page.keyboard.press('ArrowRight');
    roving.push(await page.evaluate(ACTIVE));
  }
  await page.screenshot({ path: join(EVIDENCE, 'calendar-keyboard-focus.png') });
  await page.keyboard.press('ArrowLeft');
  const stepBack = await page.evaluate(ACTIVE);
  await page.keyboard.press('Escape');
  const afterEscape = await page.evaluate(ACTIVE);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Tab');
  const afterTab = await page.evaluate(ACTIVE);
  await page.close();

  const calStops = walk.filter((s) => s.inCalendar);
  const fixtureReal = fixture.blocks >= 15 && fixture.controls >= 45;
  const oneStopPerBlock = calStops.length === fixture.blocks && calStops.every((s) => s.isBlock);
  // The traversal cost, stated as the ratio the fix changed: the calendar spends one stop per
  // ENTRY, not one per control, so walking past it costs well under half of what its controls
  // would — and the cycle closes rather than running out the budget inside the strip.
  const traversable = wrapped && calStops.length > 0 && calStops.length * 3 <= fixture.controls;
  const invisibleStops = walk.filter((s) => s.opacity <= 0 || !s.ring).map((s) => s.label);
  const rovingOrder = roving.map((s) => s.label);
  const rovingOk =
    rovingOrder.join(',') === expected.join(',') &&
    roving.every((s) => s.blockId === sampleId && !s.isBlock && s.opacity > 0 && s.ring);
  const escapeOk =
    stepBack.blockId === sampleId &&
    !stepBack.isBlock &&
    stepBack.label === expected[expected.length - 2] &&
    afterEscape.isBlock &&
    afterEscape.blockId === sampleId;
  const tabLeavesOk = afterTab.isBlock && afterTab.blockId !== sampleId;
  record(
    'CALENDAR_KEYBOARD',
    {
      fixtureReal,
      oneStopPerBlock,
      traversable,
      noInvisibleStops: invisibleStops.length === 0,
      rovingOk,
      escapeOk,
      tabLeavesOk,
    },
    `dense calendar: ${fixture.blocks} blocks holding ${fixture.controls} hover-revealed controls; ` +
      `one Tab cycle = ${walk.length} stops (wrapped back to body: ${wrapped}), ${calStops.length} ` +
      `of them in the calendar, all of them blocks: ${calStops.every((s) => s.isBlock)}; ` +
      `stops focused at zero opacity or with no ring: [${invisibleStops.join(', ') || 'none'}]; ` +
      `roving on block ${sampleId} reached [${rovingOrder.join(', ')}] (expected [${expected.join(', ')}]), ` +
      `ArrowLeft -> ${JSON.stringify(stepBack.label)}, Escape -> block=${afterEscape.isBlock}, ` +
      `Tab out -> block ${afterTab.blockId}; fixture-real=${fixtureReal} one-stop-per-block=` +
      `${oneStopPerBlock} traversable=${traversable} roving=${rovingOk} escape=${escapeOk} ` +
      `tab-leaves=${tabLeavesOk}`,
    'calendar-keyboard-focus.png',
  );
}

// LIVE_FILTER — §17 R11: a search / filter selection is reflected LIVE on the visible
// week grid, with no getState reload during the keystroke. Hardened per the issue-#55
// triage over the MULTI-WEEK fixture (seven entries across this week / last week / last
// month — the week-only view paints the current week's FIVE at rest, §12 R09). The strict
// listEntries mock rejects any query missing the required `by` (exactly like core), so the
// whole flow also proves no toolbar query throws. The toolbar's range-total chip is retired
// (#264, §12 R09): the culled totalLiveOk fact stays culled — the day-header totals keep
// their own guard in CALENDAR_LAYOUT's totalsOk.
async function sceneLiveFilter(browser) {
  await withPage(browser, liveState(), 'index.html', async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('#entries .entry').length > 0);
    const before = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#entries .entry').length,
      getStateCalls: window.__GETSTATE_CALLS__ ?? 0,
    }));
    await page.fill('#search', 'refactor');
    await page.waitForFunction(() => document.querySelectorAll('#entries .entry').length === 2);
    await page.screenshot({ path: join(EVIDENCE, 'main-filtered.png'), fullPage: true });
    const onSearch = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#entries .entry').length,
      descs: [...document.querySelectorAll('#entries .entry .desc')].map((d) => d.textContent),
      getStateCalls: window.__GETSTATE_CALLS__ ?? 0,
      listErrors: window.__LIST_ERRORS__ || 0, // no listEntries call rejected (issue #55)
    }));
    const noReloadOnSearch = onSearch.getStateCalls === before.getStateCalls;
    await page.fill('#search', '');
    await page.waitForFunction(() => document.querySelectorAll('#entries .entry').length === 5);
    const onClear = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#entries .entry').length,
    }));

    await page.fill('#search', 'no-such-entry-xyzzy');
    await page.waitForFunction(() =>
      /No matching entries/.test(document.querySelector('#entries .empty')?.textContent ?? ''),
    );
    await page.screenshot({ path: join(EVIDENCE, 'main-no-matching.png'), fullPage: true });
    const noMatch = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#entries .entry').length,
      text: document.querySelector('#entries .empty')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      listErrors: window.__LIST_ERRORS__ || 0,
    }));

    const listLiveOk =
      before.rowCount === 5 &&
      onSearch.rowCount === 2 &&
      onSearch.descs.some((d) => /auth refactor/.test(d)) &&
      onSearch.descs.some((d) => /refactor tests/.test(d)) &&
      !onSearch.descs.some((d) => /deploy pipeline/.test(d)) &&
      !onSearch.descs.some((d) => /refactor planning/.test(d)) &&
      onSearch.listErrors === 0 && // no listEntries rejection along the way…
      onClear.rowCount === 5; // …and clearing returns the week's full set
    const noMatchOk =
      noMatch.rowCount === 0 &&
      /No matching entries/.test(noMatch.text) &&
      /Try another week/.test(noMatch.text) &&
      !/No entries yet/.test(noMatch.text) &&
      noMatch.listErrors === 0;
    record(
      'LIVE_FILTER',
      { listLiveOk, noReloadOnSearch, noMatchOk },
      `live filter: list ${before.rowCount}→${onSearch.rowCount}→${onClear.rowCount} rows ` +
        `(range+search compose; getState unchanged during the keystroke: ` +
        `${noReloadOnSearch}; listEntries rejections: ${onSearch.listErrors}); ` +
        `no-match empty state ${JSON.stringify(noMatch)}`,
      'main-filtered.png',
    );
  });
}

// SETTINGS_VIEW — §12 R11: the in-window Settings view. Routing to Settings renders an
// editable control for every §14 setting, each wired to window.stint.setSetting.
async function sceneSettingsView(browser) {
  await withPage(browser, settingsState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#settings-panel [data-key]', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-settings.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const panel = document.querySelector('#settings-panel');
      const keys = [...panel.querySelectorAll('[data-key]')].map((el) => el.dataset.key);
      const has = (k) => keys.includes(k);
      const { rgbOf } = window.__probe;
      const accentRgb = rgbOf('--accent');
      const accentSolidRgb = rgbOf('--accent-solid');
      const offenders = [];
      for (const el of panel.querySelectorAll('*')) {
        if (el.matches('button.primary') || el.closest('button.primary')) continue;
        const cs = getComputedStyle(el);
        if (
          cs.backgroundColor === accentRgb || cs.color === accentRgb ||
          cs.backgroundColor === accentSolidRgb || cs.color === accentSolidRgb
        ) {
          offenders.push(`${el.tagName.toLowerCase()}.${el.className || '(no-class)'}`);
        }
      }
      const paperRgb = rgbOf('--paper');
      const inkRgb = rgbOf('--ink');
      const on = panel.querySelector('.seg .seg-btn.on');
      const offPeers = [...panel.querySelectorAll('.seg .seg-btn:not(.on)')];
      const onCs = on ? getComputedStyle(on) : null;
      const segChip = {
        present: !!on,
        chipPaper: !!onCs && onCs.backgroundColor === paperRgb,
        chipInk: !!onCs && onCs.color === inkRgb,
        chipLifted: !!onCs && onCs.boxShadow !== 'none',
        peersFlat:
          offPeers.length > 0 &&
          offPeers.every((b) => {
            const cs = getComputedStyle(b);
            return cs.boxShadow === 'none' && cs.backgroundColor === 'rgba(0, 0, 0, 0)';
          }),
      };
      return {
        visible: !document.querySelector('.view[data-view="settings"]').hidden,
        keys,
        allControls:
          has('rounding') &&
          has('roundingIncrementMin') &&
          has('weekStart') &&
          has('firstCheckinMin') &&
          has('checkinIntervalMin') &&
          has('globalHotkey') &&
          has('dateFormat') &&
          has('timeZone') &&
          // §14 / §12 R09/R23 — the Entries-calendar group: the show-weekend toggle and
          // the fine/coarse snap-minutes inputs (the Timeline group's four keys are
          // asserted by the dedicated TIMELINE_WINDOW scene).
          has('showWeekend') &&
          has('snapFineMinutes') &&
          has('snapCoarseMinutes'),
        offenders,
        segChip,
      };
    });

    await page.selectOption('.set-field[data-key="dateFormat"]', 'iso');
    await page.waitForFunction(() => window.__SET_SETTING__?.key === 'dateFormat');
    const set = await page.evaluate(() => window.__SET_SETTING__);

    const segChipOk =
      probe.segChip.present &&
      probe.segChip.chipPaper &&
      probe.segChip.chipInk &&
      probe.segChip.chipLifted &&
      probe.segChip.peersFlat;
    const allControlsPresent = probe.visible && probe.allControls;
    const accentDiscipline = probe.offenders.length === 0;
    const editFiresSetSetting = !!set && set.key === 'dateFormat' && set.value === 'iso';
    record(
      'SETTINGS_VIEW',
      { allControlsPresent, accentDiscipline, segChipOk, editFiresSetSetting },
      `settings panel exposes all eleven §14 controls incl. the Entries-calendar group (${JSON.stringify(probe.keys)}), accent discipline holds (offenders=[${probe.offenders.join(', ') || 'none'}]), D12 raised-chip segment selection=${segChipOk} ${JSON.stringify(probe.segChip)}, date-format edit fired setSetting=${JSON.stringify(set)}`,
      'main-settings.png',
    );
  });
}

// HOTKEY_NO_TRAP — WCAG 2.2 §2.1.2 (no keyboard trap) + design.html A04, over the one control
// in the app that captures raw keystrokes: the Settings global-hotkey field. A capture field
// binds a chord by swallowing the key, so it needs an explicit hatch for the traversal keys or
// focus enters and never leaves — issue 135, where `preventDefault()` ran as the handler's first
// statement and stranded the four controls after the field in DOM order (Date & number format,
// Check now, Backup retention, Restore…). KEYBOARD_FOCUS's Tab-walk cannot see this: it walks the
// default view, where the whole Settings section sits behind [hidden] and its controls are out of
// the tab order. So this scene walks focus from INSIDE the field:
//   (a) Tab from the field advances — activeElement leaves and lands on the next control;
//   (b) Shift-Tab from the field retreats — and writes NOTHING. This is the sharp end of the
//       regression: `toAccelerator` reads Shift-Tab as the chord 'Shift+Tab', so the unfixed
//       field did not merely trap focus, it silently rebound the global hotkey to Shift+Tab on
//       the way. The setSetting spy must still be untouched after the press;
//   (c) Escape releases the field (craft checklist §4 — Esc cancels the innermost thing, which
//       for a capture field is the capture) and likewise binds nothing;
//   (d) a plain Tab-walk starting in the field reaches all four of the stranded controls;
//   (e) capture itself is UNBROKEN — a real chord (Ctrl+Shift+J) still persists as the Electron
//       accelerator 'CommandOrControl+Shift+J'. The hatch must not have disarmed the field;
//   (f) A04: the field paints a ring under :focus-visible as a computed DELTA against its own
//       unfocused signature (the same predicate KEYBOARD_FOCUS uses, applied to the tabindex'd
//       <span> that the bare `:focus-visible` outline rule exists to cover).
async function sceneHotkeyNoTrap(browser) {
  await withPage(browser, settingsState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#settings-panel .set-hotkey');
    // The Backups group renders on its own async pass; wait for the last of the four stranded
    // controls so the walk below cannot pass for want of a control that had not painted yet.
    await page.waitForSelector('.backup-restore');
    // The A04 ring signature, in one place. An outline with style `none` paints nothing, and
    // Chromium versions disagree on the width they report alongside it (0px on one stack, 3px
    // on another) — so a raw `outlineWidth` read makes the signature, and the facts compared
    // from it, vary by host. Fold a none-style outline to 0px: the signature then means the
    // same thing everywhere and stays byte-reproducible.
    await page.evaluate(() => {
      window.__ringSig = (el) => {
        const cs = getComputedStyle(el);
        const w = cs.outlineStyle === 'none' ? '0px' : cs.outlineWidth;
        return `${cs.outlineStyle}|${w}|${cs.outlineColor}|${cs.boxShadow}`;
      };
    });
    const setup = await page.evaluate(() => {
      const targets = {
        dateFormat: 'select.set-field[data-key="dateFormat"]',
        updateCheck: '#update-check',
        backupRetention: 'select.set-field[data-key="backupRetention"]',
        backupRestore: '.backup-restore',
      };
      const present = {};
      for (const [name, sel] of Object.entries(targets)) {
        const el = document.querySelector(sel);
        if (el) el.setAttribute('data-trap-probe', name);
        present[name] = !!el;
      }
      return {
        present,
        allPresent: Object.values(present).every(Boolean),
        restSig: window.__ringSig(document.querySelector('#settings-panel .set-hotkey')),
      };
    });

    const probe = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        const onBody = !el || el === document.body || el === document.documentElement;
        return {
          onHotkey: !!el && el.classList && el.classList.contains('set-hotkey'),
          onBody,
          probe: el && el.getAttribute ? el.getAttribute('data-trap-probe') : null,
          label: onBody ? '(body)' : el.id || `${el.tagName.toLowerCase()}.${el.className || ''}`,
          sig: onBody ? null : window.__ringSig(el),
          wrote: window.__SET_SETTING__ ?? null,
        };
      });
    // Arrive the way a keyboard user does: focus the control BEFORE the field and Tab in. Not a
    // detail — a programmatic .focus() on a tabindex'd <span> does not match `:focus-visible` in
    // Chromium, so only a keyboard arrival paints the ring (f) checks. It also proves the field
    // is reachable going forwards, not merely escapable.
    const focusField = async () => {
      await page.focus('select.set-field[data-key="checkinIntervalMin"]');
      await page.keyboard.press('Tab');
    };

    await focusField();
    const focused = await probe();
    await page.screenshot({ path: join(EVIDENCE, 'settings-hotkey-focus.png'), fullPage: true });
    const ringDelta = focused.onHotkey && focused.sig !== setup.restSig;

    await page.keyboard.press('Tab');
    const afterTab = await probe();

    await focusField();
    await page.keyboard.press('Shift+Tab');
    const afterShiftTab = await probe();

    await focusField();
    await page.keyboard.press('Escape');
    const afterEscape = await probe();

    // (d) a Tab-walk that STARTS in the field reaches all four stranded controls. The budget is
    // the four stops plus slack for the intervening ones; a trap exhausts it having reached none.
    await focusField();
    const reached = new Set();
    const path = [];
    for (let i = 0; i < 12 && reached.size < 4; i++) {
      await page.keyboard.press('Tab');
      const step = await probe();
      path.push(step.label);
      if (step.probe) reached.add(step.probe);
    }

    // (e) capture still works: a real chord persists as an Electron accelerator. Last, because
    // persist() re-renders the panel and replaces the field's node.
    await focusField();
    await page.keyboard.press('Control+Shift+J');
    await page.waitForFunction(() => window.__SET_SETTING__?.key === 'globalHotkey').catch(() => {});
    const captured = await page.evaluate(() => window.__SET_SETTING__ ?? null);

    const escaped = !afterTab.onHotkey && !afterTab.onBody;
    const retreated = !afterShiftTab.onHotkey && afterShiftTab.wrote === null;
    const released = !afterEscape.onHotkey && afterEscape.wrote === null;
    const reachedAll = reached.size === 4;
    const captureWorks =
      !!captured && captured.key === 'globalHotkey' && captured.value === 'CommandOrControl+Shift+J';
    const allPresent = setup.allPresent;
    const focusLandsOnHotkey = focused.onHotkey;
    record(
      'HOTKEY_NO_TRAP',
      { allPresent, focusLandsOnHotkey, ringDelta, escaped, retreated, released, reachedAll, captureWorks },
      `Tab INTO .set-hotkey from the control before it landed on the field (${focused.onHotkey}); ` +
        `Tab from .set-hotkey advanced to ${afterTab.label} (escaped=${escaped}); ` +
        `Shift-Tab retreated to ${afterShiftTab.label} writing nothing (${retreated}); ` +
        `Escape released to ${afterEscape.label} writing nothing (${released}); ` +
        `Tab-walk from the field reached ${reached.size}/4 stranded controls ` +
        `[${[...reached].join(', ') || 'none'}] via ${JSON.stringify(path)}; ` +
        `capture intact — Ctrl+Shift+J persisted ${JSON.stringify(captured)} (${captureWorks}); ` +
        `A04 focus-ring delta on the field=${ringDelta} (rest ${setup.restSig} → focused ${focused.sig})`,
      'settings-hotkey-focus.png',
    );
  });
}

// TIMELINE_WINDOW — §14 / §12 R12 / §12 R15 / §12 R16 / G16: the timeline-window settings
// and the ONE viewport derivation they drive. SU.timelineWindow is the single source of the
// window math (G16; §12 R15's picker and §12 R16's calendar must consume it, never re-derive
// it) and is evaluated in-page under the pinned JUDGE_NOW clock. The timeline consumers mark
// their scroll container with the `data-timeline-track` hook; this scene drives Settings only,
// where no consumer mounts, so `consumerTrack` reports "pending" WITHOUT failing.
async function sceneTimelineWindow(browser) {
  await withPage(browser, timelineWindowState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#settings-panel [data-key="pickerWindowMode"]', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'timeline-window.png'), fullPage: true });

    const probe = await page.evaluate(() => {
      const panel = document.querySelector('#settings-panel');
      const keys = [...panel.querySelectorAll('[data-key]')].map((el) => el.dataset.key);
      const start = panel.querySelector('input.set-hhmm[data-key="workingHoursStart"]');
      const end = panel.querySelector('input.set-hhmm[data-key="workingHoursEnd"]');
      const around = panel.querySelector('select[data-key="pickerAroundHours"]');
      const aroundRow = around ? around.closest('.set-row') : null;
      // Issue 155 — the off row's LABEL, measured as rendered. The select is genuinely
      // `disabled`, which is design.html §07's recorded A01 exemption; `.set-k` beside it is
      // ordinary readable text and has no exemption to claim. The row used to carry the dim
      // (`.set-row.off { opacity: 0.5 }`), which composited the label to 3.19:1 — a defect no
      // token check could see, because no token was wrong: --ink on --paper is 16:1 and the
      // ancestor was what darkened it. So this reads the label the way the audit did — its own
      // colour composited through the WHOLE ancestor opacity chain, against the first opaque
      // surface under it — and holds the result to A01's 4.5:1. Re-dimming the row anywhere up
      // that chain reddens the row, and design-guard's token pairing keeps scoring the rest.
      const label = aroundRow ? aroundRow.querySelector('.set-k') : null;
      const dimmedBy = [];
      let effOpacity = 1;
      for (let n = label; n && n !== document.documentElement; n = n.parentElement) {
        const o = parseFloat(getComputedStyle(n).opacity);
        effOpacity *= o;
        if (o !== 1) dimmedBy.push(`${n.className || n.tagName}@${o}`);
      }
      const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      let surface = [255, 255, 255];
      for (let n = label; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !/^rgba\(0, 0, 0, 0\)$|transparent/.test(bg)) {
          surface = rgb(bg);
          break;
        }
      }
      const lum = (c) =>
        c
          .map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
          .reduce((a, ch, i) => a + [0.2126, 0.7152, 0.0722][i] * ch, 0);
      const shown = label
        ? rgb(getComputedStyle(label).color).map((c, i) => c * effOpacity + surface[i] * (1 - effOpacity))
        : surface;
      const [hi, lo] = [lum(shown), lum(surface)].sort((a, b) => b - a);
      return {
        allFour: ['workingHoursStart', 'workingHoursEnd', 'pickerWindowMode', 'pickerAroundHours'].every(
          (k) => keys.includes(k),
        ),
        startValue: start ? start.value : null,
        endValue: end ? end.value : null,
        aroundDisabled: !!(around && around.disabled),
        aroundRowOff: !!(aroundRow && aroundRow.classList.contains('off')),
        labelDimmedBy: dimmedBy,
        labelContrast: label ? Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 : 0,
      };
    });

    await page.click('#settings-panel .set-seg[data-key="pickerWindowMode"] .seg-btn[data-value="around_now"]');
    await page.waitForFunction(() => window.__SET_SETTING__?.key === 'pickerWindowMode');
    const set = await page.evaluate(() => window.__SET_SETTING__);
    await page.waitForFunction(() => {
      const around = document.querySelector('#settings-panel select[data-key="pickerAroundHours"]');
      return !!around && !around.disabled;
    });
    const afterFlip = await page.evaluate(() => {
      const around = document.querySelector('#settings-panel select[data-key="pickerAroundHours"]');
      const row = around ? around.closest('.set-row') : null;
      return { aroundEnabled: !!around && !around.disabled, rowOff: !!(row && row.classList.contains('off')) };
    });

    // (b) SU.timelineWindow, evaluated in-page under the pinned clock. The working-hours
    // fixture is exact (540–900); the around_now/8 expectation is computed from the SAME
    // page-local rendering of JUDGE_NOW the helper sees (now ± 240min, clamped to [0,1440]),
    // so the fact holds in any runner timezone.
    const windows = await page.evaluate(() => {
      const nowIso = window.__JUDGE_NOW__;
      const working = window.SU.timelineWindow(
        { workingHoursStart: '09:00', workingHoursEnd: '15:00', pickerWindowMode: 'working_hours', pickerAroundHours: 8 },
        nowIso,
        null,
      );
      const around = window.SU.timelineWindow(
        { workingHoursStart: '09:00', workingHoursEnd: '15:00', pickerWindowMode: 'around_now', pickerAroundHours: 8 },
        nowIso,
        null,
      );
      const now = new Date(nowIso);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const clamp = (m) => Math.max(0, Math.min(1440, Math.round(m)));
      const expectedAround = { startMin: clamp(nowMin - 240), endMin: clamp(nowMin + 240) };
      // The entries calendar always defaults to working hours (§12 R16): forcing the mode
      // on an around_now snapshot must reproduce the working-hours window.
      const calendar = window.SU.timelineWindow(
        { workingHoursStart: '09:00', workingHoursEnd: '15:00', pickerWindowMode: 'working_hours', pickerAroundHours: 8 },
        nowIso,
        null,
      );
      return {
        working,
        around,
        expectedAround,
        workingOk: working.startMin === 540 && working.endMin === 900,
        aroundOk: around.startMin === expectedAround.startMin && around.endMin === expectedAround.endMin,
        calendarOk: calendar.startMin === 540 && calendar.endMin === 900,
      };
    });

    const track = await page.evaluate(() => {
      const el = document.querySelector('[data-timeline-track]');
      if (!el) return { present: false, ok: false };
      const scrollable = el.scrollHeight > el.clientHeight;
      // The scroll window sits at the configured start: scrollTop/scrollHeight ≈ startMin/1440.
      const expected = window.SU.timelineWindow(window.__STATE__.settings, window.__JUDGE_NOW__, null);
      const frac = el.scrollTop / el.scrollHeight;
      const ok = scrollable && Math.abs(frac - expected.startMin / 1440) < 0.02;
      return { present: true, ok, scrollable, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight };
    });

    const groupSeeded = probe.allFour && probe.startValue === '09:00' && probe.endValue === '15:00';
    const aroundDisabledUndimmed =
      probe.aroundDisabled &&
      probe.aroundRowOff &&
      probe.labelDimmedBy.length === 0 &&
      probe.labelContrast >= 4.5;
    const modeFlipEnablesAround =
      !!set &&
      set.key === 'pickerWindowMode' &&
      set.value === 'around_now' &&
      afterFlip.aroundEnabled &&
      !afterFlip.rowOff;
    const windowMath = windows.workingOk && windows.aroundOk && windows.calendarOk;
    const consumerTrack = track.present ? track.ok : true;
    record(
      'TIMELINE_WINDOW',
      { groupSeeded, aroundDisabledUndimmed, modeFlipEnablesAround, windowMath, consumerTrack },
      `Timeline group renders all four keys (allFour=${probe.allFour}) with stored 09:00–15:00 ` +
        `(${probe.startValue}–${probe.endValue}); Around disabled while working_hours ` +
        `(disabled=${probe.aroundDisabled}, row off=${probe.aroundRowOff}) with its LABEL ` +
        `undimmed (dimmed ancestors=[${probe.labelDimmedBy.join(', ') || 'none'}], as-rendered ` +
        `contrast ${probe.labelContrast}:1 ≥ 4.5); mode flip fired ` +
        `setSetting=${JSON.stringify(set)} and enabled Around (${afterFlip.aroundEnabled}); ` +
        `SU.timelineWindow working=${JSON.stringify(windows.working)} (exact 540–900: ${windows.workingOk}), ` +
        `around_now/8=${JSON.stringify(windows.around)} vs expected ${JSON.stringify(windows.expectedAround)} ` +
        `(${windows.aroundOk}), calendar-forced-working-hours ok=${windows.calendarOk}; ` +
        (track.present
          ? `consumer track scrollable+positioned=${track.ok} (scrollTop=${track.scrollTop}/${track.scrollHeight})`
          : `consumer track pending §12 R15/R16 (no [data-timeline-track] yet — re-verified post-wave)`),
      'timeline-window.png',
    );
  });
}

// TIMELINE_WINDOW around_now snapshot — the Settings view painted FROM an around_now
// fixture: the Around select renders enabled with the stored span selected (the inverse
// of the working_hours-disabled fact above), proving the off/disabled state follows the
// STORED mode, not a hardcoded default. Folded into the TIMELINE_WINDOW rubric row.
async function sceneTimelineWindowAround(browser) {
  await withPage(browser, timelineAroundState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#settings-panel select[data-key="pickerAroundHours"]', { state: 'attached' });
    const probe = await page.evaluate(() => {
      const around = document.querySelector('#settings-panel select[data-key="pickerAroundHours"]');
      const row = around ? around.closest('.set-row') : null;
      const seg = document.querySelector(
        '#settings-panel .set-seg[data-key="pickerWindowMode"] .seg-btn[data-value="around_now"]',
      );
      return {
        aroundEnabled: !!around && !around.disabled,
        rowOff: !!(row && row.classList.contains('off')),
        aroundValue: around ? around.value : null,
        modeOn: !!(seg && seg.classList.contains('on')),
      };
    });
    const aroundFixturePaints = probe.aroundEnabled && !probe.rowOff && probe.aroundValue === '8' && probe.modeOn;
    record(
      'TIMELINE_WINDOW',
      { aroundFixturePaints },
      `around_now fixture paints the mode segment on (${probe.modeOn}) with the Around select ` +
        `enabled (${probe.aroundEnabled}, row off=${probe.rowOff}) reading the stored span (${probe.aroundValue}h)`,
      'timeline-window.png',
    );
  });
}

// SOFTWARE_UPDATE — §19 R03/R04/R06 (G3): the Settings → Software Update group, driven with
// the GUI-only window.stint.update bridge injected — the SAME getVersion / check / download /
// reveal / onUpdateProgress shape production's preload exposes. A SECOND page over the
// downloadError fixture variant (STATES.md Settings × error) drives the guided panel's error
// phase, and a THIRD drives a failed check. All fold into one SOFTWARE_UPDATE pass.
async function sceneSoftwareUpdate(browser) {
  await withPage(
    browser,
    softwareUpdateState(),
    'index.html',
    async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('#software-update .ver', { state: 'attached' });
      const versionShown = (await page.textContent('#software-update .ver'))?.trim();

      await page.click('#update-check');
      await page.waitForSelector('#software-update .update-result.new', { state: 'attached' });
      await page.waitForSelector('#update-download', { state: 'attached' });
      const afterCheck = await page.evaluate(() => {
        const result = document.querySelector('#software-update .update-result');
        const link = document.querySelector('#software-update .update-result a[data-update-link]');
        const pill = document.querySelector('#software-update a.pill.new[data-update-link]');
        const dl = document.querySelector('#update-download');
        return {
          checked: window.__CHECKED__ === true,
          resultText: result?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          resultIsNew: !!result && result.classList.contains('new'),
          linkHref: link?.getAttribute('href') ?? null,
          linkOpensExternally:
            link?.getAttribute('target') === '_blank' && /noopener/.test(link?.getAttribute('rel') ?? ''),
          pillPresent: !!pill,
          downloadLabel: dl?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
        };
      });
      await page.screenshot({ path: join(EVIDENCE, 'main-software-update.png'), fullPage: true });

      await page.click('#update-download');
      await page.waitForSelector('#update-reveal', { state: 'attached' });
      const afterDownload = await page.evaluate(() => {
        const panel = document.querySelector('#update-panel');
        const head = panel?.querySelector('.uhd')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        const steps = [...(panel?.querySelectorAll('.steps .step') ?? [])].map((s) =>
          s.textContent.replace(/\s+/g, ' ').trim(),
        );
        const reveal = document.querySelector('#update-reveal');
        const note = panel?.querySelector('.restore-note')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        return {
          downloaded: window.__DOWNLOADED__ === true,
          head,
          steps,
          revealPresent: !!reveal,
          gatekeeperStep: steps.some((s) => /Gatekeeper/i.test(s) && /approve once|first launch/i.test(s)),
          noDbNote: /never touch the database/i.test(note) && /temp/i.test(note),
        };
      });

      await page.click('#update-reveal');
      await page.waitForFunction(() => window.__REVEALED__ === true);
      const revealed = await page.evaluate(() => window.__REVEALED__ === true);

      const errorPhase = await withPage(
        browser,
        softwareUpdateState(),
        'index.html',
        async (ep) => {
          await ep.click('.nav-item[data-view="settings"]');
          await ep.waitForSelector('#software-update .ver', { state: 'attached' });
          await ep.click('#update-check');
          await ep.waitForSelector('#update-download', { state: 'attached' });
          await ep.click('#update-download');
          await ep.waitForSelector('#update-panel .update-result.err', { state: 'attached' });
          await ep.screenshot({ path: join(EVIDENCE, 'main-software-update-error.png'), fullPage: true });
          return ep.evaluate(() => {
            const panel = document.querySelector('#update-panel');
            const err = panel?.querySelector('.update-result.err');
            const retry = document.querySelector('#update-download');
            return {
              downloadFailed: window.__DOWNLOAD_FAILED__ === true,
              neverCompleted: window.__DOWNLOADED__ !== true,
              head: panel?.querySelector('.uhd')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
              errShown: !!err && err.textContent.trim().length > 0,
              errAnnounced: err?.getAttribute('role') === 'status',
              errMessage: err?.textContent?.trim() ?? '',
              retryPresent: !!retry && !retry.disabled,
              noReveal: !document.querySelector('#update-reveal'),
            };
          });
        },
        { update: { ...UPDATE_FIXTURE, downloadError: true } },
      );

      // FAILED CHECK (STATES.md Settings × error; issue 138) — a third page whose Check now
      // resolves the ERROR verdict. This is the surface that reported
      // `net::ERR_NAME_NOT_RESOLVED` to a user: the check forwarded whatever Electron's `net`
      // threw, and Chromium throws error CODES. The result line must read the SHIPPING
      // sentence (imported, not re-typed) and name no transport at all, with Check now back
      // in place — a failed check is worded and retryable, never a dead button.
      const checkFailure = await withPage(
        browser,
        softwareUpdateState(),
        'index.html',
        async (cp) => {
          await cp.click('.nav-item[data-view="settings"]');
          await cp.waitForSelector('#software-update .ver', { state: 'attached' });
          await cp.click('#update-check');
          await cp.waitForSelector('#software-update .update-result.err', { state: 'attached' });
          await cp.screenshot({ path: join(EVIDENCE, 'main-software-update-check-error.png'), fullPage: true });
          return cp.evaluate(() => {
            const err = document.querySelector('#software-update .update-result.err');
            const retry = document.querySelector('#update-check');
            return {
              checked: window.__CHECKED__ === true,
              shown: !!err && err.textContent.trim().length > 0,
              announced: err?.getAttribute('role') === 'status',
              message: err?.textContent?.trim() ?? '',
              retryPresent: !!retry && !retry.disabled,
              noDownload: !document.querySelector('#update-download'),
            };
          });
        },
        { update: { ...UPDATE_FIXTURE, checkFails: true } },
      );

      const versionOk = versionShown === UPDATE_FIXTURE.version;
      const checkOk =
        afterCheck.checked &&
        afterCheck.resultIsNew &&
        new RegExp(`update available`, 'i').test(afterCheck.resultText) &&
        afterCheck.resultText.includes(UPDATE_FIXTURE.verdict.latestVersion) &&
        afterCheck.linkHref === UPDATE_FIXTURE.verdict.releaseUrl &&
        afterCheck.linkOpensExternally &&
        afterCheck.pillPresent &&
        (afterCheck.downloadLabel ?? '').includes(UPDATE_FIXTURE.verdict.latestVersion);
      const downloadOk =
        afterDownload.downloaded &&
        /Downloaded/.test(afterDownload.head) &&
        afterDownload.head.includes(UPDATE_FIXTURE.verdict.latestVersion) &&
        afterDownload.steps.length === UPDATE_FIXTURE.steps.length &&
        afterDownload.gatekeeperStep &&
        afterDownload.noDbNote &&
        afterDownload.revealPresent &&
        revealed;
      const errorOk =
        errorPhase.downloadFailed &&
        errorPhase.neverCompleted &&
        /Update download failed/.test(errorPhase.head) &&
        errorPhase.errShown &&
        errorPhase.errAnnounced &&
        errorPhase.errMessage === 'The update download failed.' &&
        errorPhase.retryPresent &&
        errorPhase.noReveal;
      // Issue 138 — a failed CHECK reads as copy, not as a Chromium error code.
      const checkFailureOk =
        checkFailure.checked &&
        checkFailure.shown &&
        checkFailure.announced &&
        checkFailure.message === UPDATE_CHECK_FAILED &&
        !/net::|ERR_[A-Z_]+/.test(checkFailure.message) &&
        checkFailure.retryPresent &&
        checkFailure.noDownload;
      record(
        'SOFTWARE_UPDATE',
        { versionOk, checkOk, downloadOk, errorOk, checkFailureOk },
        `version row=${JSON.stringify(versionShown)} (R06); Check now → ${JSON.stringify(afterCheck)} (R03); ` +
          `Download & install → ${JSON.stringify(afterDownload)}, reveal fired=${revealed} (R04); ` +
          `rejected download → error phase ${JSON.stringify(errorPhase)}; ` +
          `failed check → ${JSON.stringify(checkFailure)} (issue 138)`,
        'main-software-update.png',
      );
    },
    { update: UPDATE_FIXTURE },
  );
}

// BACKUPS_SECTION — §20 R04 / §17 R12: the Settings → Backups group, driven with the canned
// listBackups mock + the backupsState snapshot carrying lastBackupUtc + the retention count, as
// DETERMINISTIC Playwright facts (not just PARITY_REACH IPC presence). A SECOND page over a
// never-backed-up launch (lastBackupUtc unset + the backups:[] fixture knob) covers STATES.md
// Settings × empty.
async function sceneBackupsSection(browser) {
  await withPage(browser, backupsState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#backups-panel .set-grp', { state: 'attached' });
    await page.waitForSelector('#backups-panel .backup-item', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-backups.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const host = document.querySelector('#backups-panel');
      const rows = [...host.querySelectorAll('.backup-item')];
      const ret = host.querySelector('select[data-key="backupRetention"]');
      // No stray accent-family paint (--accent OR --accent-solid) in the Backups chrome
      // (design.html D11 — accent stays on the primary action only).
      const { rgbOf } = window.__probe;
      const accentRgb = rgbOf('--accent');
      const accentSolidRgb = rgbOf('--accent-solid');
      const offenders = [];
      for (const el of host.querySelectorAll('*')) {
        if (el.matches('button.primary') || el.closest('button.primary')) continue;
        const cs = getComputedStyle(el);
        if (
          cs.backgroundColor === accentRgb || cs.color === accentRgb ||
          cs.backgroundColor === accentSolidRgb || cs.color === accentSolidRgb
        ) {
          offenders.push(`${el.tagName.toLowerCase()}.${el.className || '(no-class)'}`);
        }
      }
      return {
        lastBackupShown: /2026/.test(host.querySelector('.ver')?.textContent ?? ''),
        verifiedPill: !!host.querySelector('.ok'),
        retentionValue: ret ? ret.value : null,
        rowCount: rows.length,
        rowNames: rows.map((r) => r.dataset.name),
        eachHasRestore: rows.every((r) => !!r.querySelector('.backup-restore')),
        offenders,
      };
    });

    await page.selectOption('#backups-panel select[data-key="backupRetention"]', '10');
    await page.waitForFunction(() => window.__SET_SETTING__?.key === 'backupRetention');
    const setRet = await page.evaluate(() => window.__SET_SETTING__);

    await page.click('#backups-panel .backup-item .backup-restore');
    await page.waitForSelector('#backups-panel .confirm-restore', { state: 'attached' });
    const armedNotRestored = await page.evaluate(() => window.__RESTORED_BACKUP__ === undefined);
    await page.click('#backups-panel [data-act="confirm-restore"]');
    await page.waitForFunction(() => !!window.__RESTORED_BACKUP__);
    const restored = await page.evaluate(() => window.__RESTORED_BACKUP__);

    const backupsEmpty = await withPage(
      browser,
      emptyState(),
      'index.html',
      async (ep) => {
        await ep.click('.nav-item[data-view="settings"]');
        await ep.waitForSelector('#backups-panel .set-grp', { state: 'attached' });
        await ep.waitForSelector('#backups-panel .set-empty', { state: 'attached' });
        await ep.screenshot({ path: join(EVIDENCE, 'main-backups-empty.png'), fullPage: true });
        return ep.evaluate(() => {
          const host = document.querySelector('#backups-panel');
          const empties = [...host.querySelectorAll('.set-empty')].map((e) =>
            e.textContent.replace(/\s+/g, ' ').trim(),
          );
          return {
            empties,
            rows: host.querySelectorAll('.backup-item').length,
            verifiedPill: !!host.querySelector('.ok'),
            retentionPresent: !!host.querySelector('select[data-key="backupRetention"]'),
          };
        });
      },
      { backups: [] },
    );

    const groupSeeded =
      probe.lastBackupShown &&
      probe.verifiedPill &&
      probe.retentionValue === '5' &&
      probe.rowCount === 2 &&
      probe.eachHasRestore &&
      probe.offenders.length === 0;
    const retentionEditFires = !!setRet && setRet.key === 'backupRetention' && setRet.value === 10;
    const restoreGated = armedNotRestored && !!restored && restored.name === probe.rowNames[0];
    const neverBackedUpEmpty =
      backupsEmpty.rows === 0 &&
      !backupsEmpty.verifiedPill &&
      backupsEmpty.retentionPresent &&
      backupsEmpty.empties.some((t) => /No backups yet/.test(t) && /backs up automatically/.test(t)) &&
      backupsEmpty.empties.some((t) => /No backups to restore from yet/.test(t));
    record(
      'BACKUPS_SECTION',
      { groupSeeded, retentionEditFires, restoreGated, neverBackedUpEmpty },
      `backups group: last-backup+verified=${probe.lastBackupShown}/${probe.verifiedPill}, ` +
        `retention=${probe.retentionValue} (edit fired ${JSON.stringify(setRet)}), ` +
        `restore list rows=${probe.rowCount} ${JSON.stringify(probe.rowNames)} (each Restore… present=${probe.eachHasRestore}); ` +
        `confirm gate: armed-not-restored=${armedNotRestored}, confirmed restore=${JSON.stringify(restored)}; ` +
        `stray accent=[${probe.offenders.join(', ') || 'none'}]; ` +
        `never-backed-up empty ${JSON.stringify(backupsEmpty)}`,
      'main-backups.png',
    );
  });
}

// RECOVERY_NOTICE — §20 R05 / §17 R12: the corruption-recovery banner. With a snapshot carrying
// a non-null recoveryNotice (the DB was recovered from a backup on launch), routing to Settings
// renders a one-shot banner, as a deterministic Playwright fact.
async function sceneRecoveryNotice(browser) {
  await withPage(browser, recoveryState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#backups-panel #recovery-notice', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-recovery.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const banner = document.querySelector('#backups-panel #recovery-notice');
      const text = banner?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      return {
        bannerShown: !!banner,
        text,
        recoveredFromShown: /timetracker\.sqlite\.bak-20260627T101500Z/.test(text),
        quarantinedShown: /\.corrupted-20260627T120500Z/.test(text),
        restoreReachable: !!document.querySelector('#backups-panel .backup-restore'),
      };
    });
    const bannerNamesBoth = probe.bannerShown && probe.recoveredFromShown && probe.quarantinedShown;
    const restoreReachable = probe.restoreReachable;
    record(
      'RECOVERY_NOTICE',
      { bannerNamesBoth, restoreReachable },
      `recovery banner shown=${probe.bannerShown} naming recoveredFrom=${probe.recoveredFromShown} ` +
        `+ quarantinedTo=${probe.quarantinedShown}; Restore… still reachable=${probe.restoreReachable}; ` +
        `text=${JSON.stringify(probe.text)}`,
      'main-recovery.png',
    );
  });
}

// PARITY_REACH — §17 R8: the rendered window surfaces an affordance for EVERY capability,
// so nothing tt can do is unreachable from the GUI. Two parts in one item:
//   (1) DETERMINISTIC sub-fact (machine-scored): the injected window.stint — the same
//       preload surface production exposes — provides a callable method for EVERY IPC
//       channel in CHANNELS (the parity-matrix's GUI side). A channel with no method is a
//       capability the renderer literally cannot invoke; this fails the moment one appears
//       without a backing method, guarding every future channel addition.
//   (2) REACH evidence (subjective, scored over screenshots): the persistent left-nav
//       routes to each of the five views (Timer / Entries / Clients / Reports / Settings)
//       and each view exposes its actions — captured as one screenshot per view so a
//       human/LLM can confirm the discoverable affordance for each capability class.
async function sceneParityReach(browser) {
  await withPage(browser, emptyState(), 'index.html', async (page) => {
    const methodProbe = await page.evaluate((channels) => {
      const api = window.stint || {};
      const missing = channels.filter((ch) => typeof api[ch] !== 'function');
      return { exposed: channels.filter((ch) => typeof api[ch] === 'function').length, total: channels.length, missing };
    }, CHANNELS);

    // (2) Route to each of the five views and screenshot it as the reach evidence. The nav is
    // client-side (no IPC), so this is deterministic; the per-view shots feed rubric review.
    const VIEWS = ['timer', 'entries', 'clients', 'reports', 'settings'];
    const routed = [];
    for (const view of VIEWS) {
      await page.click(`.nav-item[data-view="${view}"]`);
      const shown = await page.evaluate(
        (v) => {
          const sec = document.querySelector(`.view[data-view="${v}"]`);
          const navActive = document.querySelector('.nav-item.active')?.dataset.view ?? null;
          return { visible: !!sec && !sec.hidden, navActive };
        },
        view,
      );
      await page.screenshot({ path: join(EVIDENCE, `parity-${view}.png`) });
      routed.push({ view, ...shown });
    }
    const allRouted = routed.every((r) => r.visible && r.navActive === r.view);
    const everyChannelPresent = methodProbe.missing.length === 0;
    record(
      'PARITY_REACH',
      { everyChannelPresent, allRouted },
      `window.stint exposes ${methodProbe.exposed}/${methodProbe.total} channels ` +
        `(missing=[${methodProbe.missing.join(', ') || 'none'}]); nav reaches all five views ` +
        `(${routed.map((r) => `${r.view}:${r.visible ? 'shown' : 'hidden'}`).join(', ')})`,
      'parity-settings.png',
    );
  });
}

/**
 * The in-page field-label sweep (FIELD_LABELS). Collects every VISIBLE form control inside the
 * currently-routed view and records, per control, HOW it is named — which is the whole question
 * design.html D13 asks. Three naming idioms count, and they are the three the app actually uses:
 *
 *   label       — a wrapping `<label>` or a `label[for=id]` carrying visible text (the D13 idiom);
 *   labelledby  — `aria-labelledby` resolving to a VISIBLE element;
 *   row-heading — the control-bar / settings-row idiom, where the visible name is the row's
 *                 heading (`.report-lab` before a `.report-row`, `.set-k` inside a `.set-row`)
 *                 and `aria-label` carries the programmatic half.
 *
 * `placeholder` is deliberately NOT an idiom: a placeholder disappears on the first keystroke,
 * which is the defect (issue 136). `aria-label` alone is not one either — it names the control for
 * a screen reader and for nobody else, and D13 asks for a visible label.
 *
 * `field` marks the population D13's visible-label rule governs: the bordered-box controls the
 * rule describes ("one border, one radius, one focus idiom") — text inputs, selects, textareas.
 * A checkbox is not one of those: it is named by the word beside it, and the calendar's corner
 * select box is an ICON-ONLY affordance, which design.html D16 / A02 govern instead — those owe
 * an accessible name, not a visible label. So the sweep asks BOTH populations for a name and only
 * the fields for a visible one.
 *
 * Scope: form controls (`input` / `select` / `textarea`). The Settings global-hotkey CAPTURE
 * control is a `[tabindex]` span rather than a field, and is covered by HOTKEY_NO_TRAP.
 */
function sweepFieldLabels() {
  const { visible } = window.__probe;
  const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const view = document.querySelector('.views .view:not([hidden])');
  const controls = [...(view?.querySelectorAll('input, select, textarea') ?? [])]
    .filter((el) => el.type !== 'hidden')
    .filter(visible);
  const fields = controls.map((el) => {
    const own = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
    // A wrapping label's text includes the control's own; a `<select>` contributes its option
    // list, so strip every descendant control's text before reading the label's own words.
    const labelText = (() => {
      if (!own || !visible(own)) return '';
      const clone = own.cloneNode(true);
      for (const c of clone.querySelectorAll('input, select, textarea')) c.remove();
      return text(clone);
    })();
    const byText = (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((t) => t && visible(t))
      .map(text)
      .join(' ')
      .trim();
    const headEl = el.closest('.set-row')?.querySelector('.set-k')
      ?? (el.closest('.report-row')?.previousElementSibling?.classList?.contains('report-lab')
        ? el.closest('.report-row').previousElementSibling
        : null);
    const headText = headEl && visible(headEl) ? text(headEl) : '';
    const idiom = labelText ? 'label' : byText ? 'labelledby' : headText ? 'row-heading' : 'none';
    return {
      label: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${typeof el.className === 'string' ? el.className : ''}`,
      idiom,
      name: labelText || byText || headText,
      field: !(el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')),
      // The programmatic name, ignoring `placeholder` and `title` — the four start-* fields had
      // none at all, which is the "no accessible name" half of the issue.
      named: !!(el.getAttribute('aria-label')?.trim() || labelText || byText),
      // A persistent, on-screen element names it — the "no visible label" half.
      visiblyNamed: !!(labelText || byText || headText),
    };
  });
  return { total: fields.length, fields };
}

// FIELD_LABELS — design.html D13 (and A01, whose field-border exemption is CONDITIONED on the
// label being there): every field carries a VISIBLE label. Issue 136 measured four fields with no
// accessible name AT ALL (the start form's description / client / project / tags) and three more
// named only by a placeholder + an invisible `aria-label` (#add-desc, #search, #rep-name) — so the
// name either vanished on the first keystroke or never existed. Nothing could catch it: the GOLD
// design guard scores tokens, contrast and spacing, and label presence is a structural fact about
// the DRIVEN DOM. This scene drives the real renderer through all five views and, in each, sweeps
// every visible form control for TWO facts: EVERY control has a programmatic name that is not its
// placeholder (D13's floor, and D16/A02's for the icon-shaped ones), and every FIELD — the bordered
// controls D13's rule describes, so not the checkboxes — has a persistent VISIBLE element supplying
// that name. The views are driven into the states that
// hold fields — the Timer start-details disclosure, the Entries add form + Custom range, the
// Reports builder + Custom range, and Settings; the Clients view carries no field at rest (its
// create/rename micro-forms are transient surfaces of their own and are not swept here).
// Every row-heading-idiom control is NAMED in the justification, so that population stays
// reviewable the way TARGET_SIZE's spacing exceptions do.
async function sceneFieldLabels(browser) {
  const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light' });
  await page.clock.install({ time: new Date(JUDGE_NOW) });
  await page.clock.pauseAt(new Date(JUDGE_NOW));
  await page.addInitScript(initScript(JSON.stringify(addFormState())));
  await page.goto(fileUrl('index.html'));
  await page.waitForSelector('.entry', { state: 'attached' });

  const surfaces = [];
  const sweep = async (surface) => surfaces.push({ surface, ...(await page.evaluate(sweepFieldLabels)) });

  // Timer — the start-details disclosure holds the four fields the issue found nameless. It is
  // idle-only (§12 R05), and this snapshot is idle.
  await page.click('.nav-item[data-view="timer"]');
  await page.waitForSelector('[data-view="timer"]:not([hidden]) #start-toggle');
  await page.click('#start-toggle');
  await page.waitForSelector('#start-form:not([hidden])', { state: 'attached' });
  await sweep('timer (start details)');
  await page.screenshot({ path: join(EVIDENCE, 'field-labels-timer.png') });

  // Entries — the week-only toolbar's filter/search fields (visible-label idiom, §12 R09)
  // plus the unified add form (the range concept — and its custom date pair — is gone, #265).
  await page.click('.nav-item[data-view="entries"]');
  await page.click('#add-toggle');
  await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
  await sweep('entries (toolbar + add form)');
  await page.screenshot({ path: join(EVIDENCE, 'field-labels-entries.png') });

  // Clients — no field at rest; swept anyway so a field added here cannot slip in unswept.
  await page.click('.nav-item[data-view="clients"]');
  await sweep('clients');

  await page.click('.nav-item[data-view="reports"]');
  await page.click('#rep-new');
  await page.waitForSelector('#rep-builder:not([hidden])', { state: 'attached' });
  await page.click('#rep-preset-seg .preset[data-preset="custom"]');
  await page.waitForSelector('#rep-custom-range:not([hidden])', { state: 'attached' });
  await sweep('reports (builder + custom range)');
  await page.screenshot({ path: join(EVIDENCE, 'field-labels-reports.png') });

  await page.click('.nav-item[data-view="settings"]');
  await page.waitForSelector('#settings-panel .set-row', { state: 'attached' });
  await sweep('settings');
  await page.close();

  const all = surfaces.flatMap((s) => s.fields.map((f) => ({ surface: s.surface, ...f })));
  const fields = all.filter((f) => f.field);
  const unnamed = all.filter((f) => !f.named).map((f) => `${f.surface}:${f.label}`);
  const placeholderOnly = fields.filter((f) => !f.visiblyNamed).map((f) => `${f.surface}:${f.label}`);
  const rowIdiom = fields.filter((f) => f.idiom === 'row-heading').map((f) => `${f.label} → '${f.name}'`);
  // Guard-the-guard: an empty sweep satisfies both emptiness assertions vacuously. The five views
  // hold well over 20 visible fields across these states, so a sweep that has gone blind fails.
  record(
    'FIELD_LABELS',
    {
      sweepReal: fields.length >= 20,
      everyFieldNamed: unnamed.length === 0,
      noPlaceholderOnly: placeholderOnly.length === 0,
    },
    `D13 sweep over ${all.length} visible controls, ${fields.length} of them fields ` +
      `(${surfaces.map((s) => `${s.surface}=${s.total}`).join(', ')}): ` +
      `no accessible name at all (every control, D13 + D16)=[${unnamed.join('; ') || 'none'}]; ` +
      `field named but not by a visible element (placeholder / aria-label only)=[${placeholderOnly.join('; ') || 'none'}]; ` +
      `row-heading idiom (visible name in the row heading, aria-label the programmatic half)=[${rowIdiom.join('; ') || 'none'}]`,
    'field-labels-timer.png',
  );
}

/**
 * The in-page field-chrome sweep (FIELD_CHROME). Reads, per visible field in the currently-
 * routed view, the four facts design.html D13 states about what a field looks like — the
 * border, the radius, the padding grid D07 puts under it, and (for the one field asked to
 * hold focus) the focus idiom.
 *
 * `field` is the same population FIELD_LABELS scores: the bordered-box controls D13's rule
 * describes (text inputs, selects, textareas), never the checkboxes.
 *
 * Every fact is read off the COMPUTED style, which is the whole point. A field inherits a
 * complete set of these declarations from the UA stylesheet whether the app writes them or
 * not, so "what does styles.css say" and "what does the field look like" are different
 * questions — and a static scan of the source can only answer the first one.
 *
 * This is NOT a px/hex pin on named selectors (process.html §02 forbids those — they fight
 * every restyle and prove nothing about how the app looks). Every value compared here is
 * resolved from the token layer at probe time (`--rule-strong`, `--r1`), so a restyle that
 * moves a token moves the expectation with it; the one literal, the 4px grid, is D07 itself.
 * Border WIDTH is deliberately not pinned to a number — it is scored for uniformity, which
 * is what "one border" means and what a leaked UA border breaks.
 */
function sweepFieldChrome() {
  const { visible, cssVar, rgbOf } = window.__probe;
  const onGrid = (v) => {
    const n = parseFloat(v);
    return n === 0 || n === 2 || n % 4 === 0;
  };
  const ruleStrong = rgbOf('--rule-strong');
  const radius = cssVar('--r1');
  const view = document.querySelector('.views .view:not([hidden])');
  const fields = [...(view?.querySelectorAll('input, select, textarea') ?? [])]
    .filter((el) => !['hidden', 'checkbox', 'radio'].includes(el.type))
    .filter(visible);
  return fields.map((el) => {
    const cs = getComputedStyle(el);
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const widths = sides.map((s) => cs[`border${s}Width`]);
    const styles = sides.map((s) => cs[`border${s}Style`]);
    const colours = sides.map((s) => cs[`border${s}Color`]);
    const pads = sides.map((s) => cs[`padding${s}`]);
    const radii = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((c) => cs[`border${c}Radius`]);
    return {
      label: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${typeof el.className === 'string' ? el.className : ''}`,
      // ONE border: a single hairline, same on all four sides, drawn solid in --rule-strong.
      // The UA's own text-control border is `2px inset rgb(118, 118, 118)` — it fails the
      // style and the colour clause, and its width is compared against the app's own below.
      oneBorder:
        parseFloat(widths[0]) > 0 &&
        widths.every((w) => w === widths[0]) &&
        styles.every((s) => s === 'solid') &&
        colours.every((c) => c === ruleStrong),
      width: widths[0],
      border: `${widths[0]} ${styles[0]} ${colours[0]}`,
      // ONE radius: 8px on all four corners (the UA leaves a text control square).
      oneRadius: radii.every((r) => r === radius),
      radius: radii[0],
      // D07's grid, over the COMPUTED padding — where an unreset UA `padding: 1px 2px` shows up.
      onGrid: pads.every(onGrid),
      padding: pads.join(' '),
    };
  });
}

// FIELD_CHROME — design.html D13 ("One border (rule-strong), one radius (8px), one focus
// idiom: accent border + the 3px ring") + D07's grid under its padding, machine-scored over
// the DRIVEN DOM. Issue 149: the toolbar search box painted TWO nested fields. The border,
// radius and padding sat on the `.search` <span> WRAPPING the input, and nothing reset the
// input itself — so Chromium's UA chrome (a `2px inset` border, square corners, an off-grid
// `padding: 1px 2px`) rendered a second, smaller field inside the designed one, and D13's
// focus idiom landed on that inner box: a square accent rectangle floating inside a rounded
// grey one. `#search`'s 1px paddings were the only off-grid values in the running app.
//
// Nothing could catch it. GOLD `design-guard.test.ts` scores the 4px grid over the AUTHORED
// values in styles.css, and every authored value was on-grid — these came from the UA
// stylesheet, which a static scan of the source cannot see. That is the limit of the static
// half rather than a bug in it: this case belongs to the driven-DOM half of design.html §08's
// split, which is where this scene puts it. FIELD_LABELS drives the same five views for the
// same field population and asks how each is NAMED; this one asks what each LOOKS LIKE.
//
// Two facts. (a) The SWEEP — every visible field in all five views, each routed into the state
// that holds its fields, resolves to one solid --rule-strong border of one width on all four
// sides (and the same width as every other field in the app — "one border" across the window,
// scored as agreement so a restyle that thickens them all stays legal), an --r1 radius on all
// four corners, and computed padding on the 4px grid. No exemptions: the app
// really does paint every one of its fields the same, so a field that differs is news. (b) The
// FOCUS IDIOM lands on the field itself — Tab to #search and the accent border and 3px ring
// resolve on the element that holds focus, which still carries D13's 8px radius. Fact (b) is
// what a wrapper-styled field can never satisfy, and is why the fix moves the chrome onto the
// input rather than resetting the input's border and leaving the wrapper as the box.
async function sceneFieldChrome(browser) {
  const page = await newScenePage(browser, { viewport: WINDOW, colorScheme: 'light' });
  await page.clock.install({ time: new Date(JUDGE_NOW) });
  await page.clock.pauseAt(new Date(JUDGE_NOW));
  await page.addInitScript(initScript(JSON.stringify(addFormState())));
  await page.goto(fileUrl('index.html'));
  await page.waitForSelector('.entry', { state: 'attached' });
  // D10 gives border-colour a 120ms fade; with the clock pinned, a probe taken mid-transition
  // reads an arbitrary intermediate colour instead of the cascade. Same reason ACCENT_DISCIPLINE
  // switches motion off.
  await noMotion(page);

  const surfaces = [];
  const sweep = async (surface) => surfaces.push({ surface, fields: await page.evaluate(sweepFieldChrome) });

  await page.click('.nav-item[data-view="timer"]');
  await page.waitForSelector('[data-view="timer"]:not([hidden]) #start-toggle');
  await page.click('#start-toggle');
  await page.waitForSelector('#start-form:not([hidden])', { state: 'attached' });
  await sweep('timer (start details)');

  // Entries — the week-only toolbar's filter/search fields plus the unified add form (the
  // range concept and its custom date pair are gone, #265).
  // Entries — the week-only toolbar's filter/search fields plus the unified add form (the
  // range concept and its custom date pair are gone, #265). Opening the form focuses its
  // description; drop that focus before sweeping, or the focused field's accent border reads
  // as a chrome offender.
  await page.click('.nav-item[data-view="entries"]');
  await page.click('#add-toggle');
  await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
  await page.evaluate(() => document.activeElement?.blur());
  await sweep('entries (toolbar + add form)');

  // Clients — no field at rest; swept anyway so a field added here cannot slip in unswept.
  await page.click('.nav-item[data-view="clients"]');
  await sweep('clients');

  await page.click('.nav-item[data-view="reports"]');
  await page.click('#rep-new');
  await page.waitForSelector('#rep-builder:not([hidden])', { state: 'attached' });
  await page.click('#rep-preset-seg .preset[data-preset="custom"]');
  await page.waitForSelector('#rep-custom-range:not([hidden])', { state: 'attached' });
  await sweep('reports (builder + custom range)');

  await page.click('.nav-item[data-view="settings"]');
  await page.waitForSelector('#settings-panel .set-row', { state: 'attached' });
  await sweep('settings');

  // Fact (b): KEYBOARD focus on the issue's own field. Tab to it rather than calling .focus(),
  // so the :focus-visible the D13 idiom hangs off is the one a keyboard user gets.
  await page.click('.nav-item[data-view="entries"]');
  await page.waitForSelector('#search', { state: 'attached' });
  // The toolbar control immediately before the search label — one Tab lands on the field
  // (#el-tag, the last filter of the week-only toolbar's right rail).
  await page.evaluate(() => document.querySelector('#el-tag').focus());
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const el = document.querySelector('#search');
    const cs = getComputedStyle(el);
    const accent = window.__probe.rgbOf('--accent');
    return {
      onField: document.activeElement === el,
      accentBorder: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor]
        .every((c) => c === accent),
      ring: cs.boxShadow !== 'none' && cs.boxShadow !== '',
      radius: cs.borderTopLeftRadius,
      // The ring must be the FIELD's; a wrapper that still painted a box would leave the
      // element the user sees bordered undressed.
      wrapperBare: (() => {
        const w = el.parentElement;
        const ws = getComputedStyle(w);
        return parseFloat(ws.borderTopWidth) === 0 && ws.boxShadow === 'none';
      })(),
    };
  });
  await page.screenshot({
    path: join(EVIDENCE, 'field-chrome-search-focus.png'),
    clip: await page.evaluate(() => {
      const r = document.querySelector('.search-field').getBoundingClientRect();
      return { x: r.left - 16, y: r.top - 14, width: r.width + 32, height: r.height + 28 };
    }),
  });
  await page.close();

  const all = surfaces.flatMap((s) => s.fields.map((f) => ({ surface: s.surface, ...f })));
  const offenders = all
    .filter((f) => !f.oneBorder || !f.oneRadius || !f.onGrid)
    .map((f) => `${f.surface}:${f.label} border=${f.border} radius=${f.radius} padding=${f.padding}`);
  // "One border" across the app, not just within each field: every field draws its hairline at
  // the SAME width as every other. Scored as agreement rather than against a pinned px value,
  // so a restyle that thickens every field's border stays legal and one field that disagrees
  // does not (which is what a leaked UA border is).
  const widths = [...new Set(all.map((f) => f.width))];
  const focusOk = focus.onField && focus.accentBorder && focus.ring && focus.wrapperBare;
  // Guard-the-guard: the five views hold well over 20 visible fields in these states, so a
  // sweep that has gone blind fails instead of passing on an empty set.
  record(
    'FIELD_CHROME',
    {
      sweepReal: all.length >= 20,
      oneFieldGrammar: offenders.length === 0,
      oneBorderWidth: widths.length === 1,
      focusOk,
    },
    `D13/D07 sweep over ${all.length} visible fields ` +
      `(${surfaces.map((s) => `${s.surface}=${s.fields.length}`).join(', ')}): ` +
      `not one solid --rule-strong border + --r1 radius + on-grid padding=[${offenders.join('; ') || 'none'}]; ` +
      `border widths in use across every field=[${widths.join(', ')}]; ` +
      `#search under keyboard focus: on the field=${focus.onField}, accent border on all four sides=` +
      `${focus.accentBorder}, 3px ring=${focus.ring}, radius=${focus.radius}, wrapper paints nothing=${focus.wrapperBare}`,
    'field-chrome-search-focus.png',
  );
}

// TARGET_SIZE — design.html A03: every interactive target measures at least 24×24 CSS px, or
// stands at least 24px clear of its nearest interactive neighbour. A machine sweep collects
// every VISIBLE interactive control (button / a[href] / input / select / textarea / tabbable /
// [data-act]) and measures it, with two rules about WHAT the box is:
//   • a control nested inside another interactive control is a SUB-AFFORDANCE — the parent is
//     the target the sweep measures;
//   • a checkbox/radio wrapped in a <label> is activated by the WHOLE LABEL, so the LABEL's box
//     is the target — the 13px native glyph is a paint detail, not the thing a pointer aims at.
// An undersized control passes only via the SPACING exception (≥24px edge-to-edge from every
// other target — the reading design.html A03 states, stricter than the SC's 24px-circle test)
// or the INLINE exception (an inline link inside a line of text). Both floors are INCLUSIVE:
// the ops chip's op-btn is exactly 24×24 against a 0px gap and stays a pass, by design.
//
// Issue 148 measured eight targets under the floor, three of them (the corner select checkbox,
// the tag remover, the picker's 31 day cells) with 0–2px of neighbour spacing to fall back on.
// Nothing caught them, for three separate reasons this scene now closes:
//   (a) the day cells measured 23.84px and the sweep ROUNDED before comparing, so they read as
//       24 — the comparison is now against the raw CSS px;
//   (b) the tag remover was a <b> with a click listener, matching no interactive selector at
//       all — the fix (a real button) is what puts it in front of this sweep, so the sweep
//       ASSERTS it is present, and a regression back to bare prose fails here as well as at
//       the keyboard;
//   (c) the undersized controls live on TRANSIENT surfaces — the add form, the unified editor
//       and its inline picker, the reports builder, the Timer start-details disclosure — which
//       the old five-views-at-rest route never opened. The route now drives them.
// The gate is ZERO unsanctioned undersized targets across all nine surfaces; the
// spacing-sanctioned ones are named in the justification so each stays reviewable.
function sweepTargets() {
  const sel = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [data-act]';
  const { visible } = window.__probe;
  const targets = [...document.querySelectorAll(sel)]
    .filter(visible)
    .filter((el) => !el.parentElement?.closest('button, a[href], [data-act]'));
  const boxes = targets.map((el) => {
    const box = el.matches('input[type="checkbox"], input[type="radio"]') && el.closest('label')
      ? el.closest('label')
      : el;
    const r = box.getBoundingClientRect();
    const name = el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${typeof el.className === 'string' ? el.className : ''}`;
    return {
      el,
      label: box === el ? name : `${name} (label)`,
      rect: r,
      // Raw CSS px, never rounded: 23.84 is under the floor and must read as under it.
      w: r.width,
      h: r.height,
    };
  });
  const undersized = (b) => b.w < 24 || b.h < 24;
  // Edge-to-edge distance between two boxes: 0 when they touch or overlap.
  const spacing = (a, b) => Math.hypot(
    Math.max(a.left - b.right, b.left - a.right, 0),
    Math.max(a.top - b.bottom, b.top - a.bottom, 0),
  );
  const round = (n) => Math.round(n * 10) / 10;
  const violations = [];
  const spacingSanctioned = [];
  for (const b of boxes) {
    if (!undersized(b)) continue;
    let nearest = Infinity;
    let who = 'nothing';
    for (const o of boxes) {
      if (o.el === b.el) continue;
      const d = spacing(b.rect, o.rect);
      if (d < nearest) { nearest = d; who = o.label; }
    }
    const entry = { label: b.label, w: round(b.w), h: round(b.h), near: round(nearest), who };
    if (nearest >= 24) { spacingSanctioned.push(entry); continue; }
    if (b.el.matches('a') && getComputedStyle(b.el).display === 'inline') continue; // inline-text exemption
    violations.push(entry);
  }
  const swept = boxes.map((b) => b.label);
  return { total: boxes.length, violations, spacingSanctioned, swept };
}
async function sceneTargetSize(browser) {
  const perSurface = [];
  const sweep = async (page, surface) => perSurface.push({ surface, ...(await page.evaluate(sweepTargets)) });

  await withPage(browser, runningState(), 'index.html', async (page) => {
    for (const view of ['entries', 'timer', 'clients', 'reports', 'settings']) {
      await page.click(`.nav-item[data-view="${view}"]`);
      await sweep(page, view);
      if (view === 'entries') await page.screenshot({ path: join(EVIDENCE, 'main-target-size.png') });
    }
  });

  // The Entries add form — the inline picker's day grid, a tag chip with its remover, the
  // Billable label, and the calendar's hover-corner select checkbox beside its ops chip.
  await withPage(browser, addFormState(), 'index.html', async (page) => {
    await page.waitForSelector('[data-view="entries"]:not([hidden]) #add-toggle');
    await page.click('#add-toggle');
    await page.waitForSelector('#add-picker .stp-block.me', { state: 'attached' });
    await page.fill('#add-tag-input', 'deep');
    await page.press('#add-tag-input', 'Enter');
    await page.waitForSelector('#add-tag-chips .chip-x', { state: 'attached' });
    await sweep(page, 'entries (add form)');
    await page.screenshot({ path: join(EVIDENCE, 'target-size-add-form.png') });
  });

  // The unified editor — the same picker and tag editor mounted in the edit form.
  await withPage(browser, unifiedFormState(), 'index.html', async (page) => {
    await page.locator('[data-act="edit"]').first().click();
    await page.waitForSelector('.entry-form .edit-picker .stp-block.me', { state: 'attached' });
    await sweep(page, 'entries (unified editor)');
  });

  // The Timer view's start-details disclosure (idle-only) and the Reports builder — the two
  // remaining surfaces that hold a labelled checkbox.
  await withPage(browser, addFormState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #start-toggle');
    await page.click('#start-toggle');
    await page.waitForSelector('#start-form:not([hidden])', { state: 'attached' });
    await sweep(page, 'timer (start details)');
    await page.click('.nav-item[data-view="reports"]');
    await page.click('#rep-new');
    await page.waitForSelector('#rep-builder:not([hidden])', { state: 'attached' });
    await page.click('#rep-preset-seg .preset[data-preset="custom"]');
    await sweep(page, 'reports (builder)');
  });

  // The popover is its own renderer — sweep both of its tray actions too.
  await withPage(browser, runningState(), 'popover.html', async (pp) => sweep(pp, 'popover'));

  const totalTargets = perSurface.reduce((s, v) => s + v.total, 0);
  const allViolations = perSurface.flatMap((v) =>
    v.violations.map((x) => `${v.surface}:${x.label} ${x.w}x${x.h} — ${x.near}px from ${x.who}`),
  );
  const sanctioned = perSurface.flatMap((v) =>
    v.spacingSanctioned.map((x) => `${x.label} ${x.w}x${x.h} (${x.near}px clear)`),
  );
  // Guard-the-guard: the three targets issue 148 measured under the floor must be IN the swept
  // set. `.chip-x` is the load-bearing one — as a <b> it matched no selector, so an empty sweep
  // of it would have "passed" this scene forever.
  const swept = new Set(perSurface.flatMap((v) => v.swept.map((s) => s.split(' ')[0])));
  const missing = ['button.chip-x', 'input.ck', 'button.stp-d'].filter(
    (want) => ![...swept].some((s) => s.startsWith(want)),
  );
  record(
    'TARGET_SIZE',
    {
      sweepReal: totalTargets > 0,
      noUndersizedTargets: allViolations.length === 0,
      noneAbsent: missing.length === 0,
    },
    `A03 sweep over ${totalTargets} visible targets across ${perSurface.length} surfaces ` +
      `(${perSurface.map((v) => `${v.surface}=${v.total}`).join(', ')}): ` +
      `under 24×24 with less than 24px of clearance=[${allViolations.join('; ') || 'none'}]; ` +
      `swept but absent (the tag remover, the select checkbox, a picker day cell)=[${missing.join(', ') || 'none'}]; ` +
      `spacing-exception (undersized, ≥24px clear of every other target)=[${[...new Set(sanctioned)].join('; ') || 'none'}]`,
    'main-target-size.png',
  );
}

// COLOUR_PAIRING — design.html D05 / A05 (WCAG 1.4.1): colour is never the sole signal —
// every semantic colour carries a word or icon beside it. Machine facts, one per pairing
// the design names (the recorded exemption "run-dot when paired with its label" is exactly
// what fact (a) proves holds):
//   (a) the run-dot sits BESIDE the literal word 'running', and — the part this scene used to
//       miss — BOTH are read as RENDERED, not merely present. Reading textContent alone passed
//       a Timer card whose state word and dot were `display: none` for as long as issue #142
//       shipped: the card signalled running by a recoloured clock and nothing else, which is
//       the one thing D05 forbids. The pairing is now scored per running surface — the Entries
//       strip carries a visible dot (its word stays hidden; D05 asks word OR icon), and the
//       Timer card, the surface whose whole purpose is the timer, carries BOTH;
//   (b) billable-ness is WORDED, not colour-only — the running card's attribute row carries
//       the literal 'billable' / 'non-billable' label (a quiet `.attr`, not the warn `.flag`
//       pill it wore until issue #160 — the wording is this scene's claim, the palette split
//       is TIMER_VIEW's);
//   (c) the calendar's overlap band carries the worded .otag ('overlap Nm') and the slept
//       hatch carries the #i-moon icon marker — the yellow band / hatch never stand alone;
//   (d) the WARN advisory is worded on the flag palette (the overlap banner's sentence over
//       --flag/--flag-bg), and the ERR block is worded on the DANGER palette
//       (--danger/--danger-weak) with the Entries mirror carrying .error — two palettes,
//       both carrying words, so neither state ever rides on colour alone (D15).
async function sceneColourPairing(browser) {
  const pairing = await withPage(browser, runningState(), 'index.html', async (page) => {
    const strip = await page.evaluate(() => ({
      dotVisible: window.__probe.visible(document.querySelector('#timer-strip.running .strip-dot')),
      wordVisible: window.__probe.visible(document.querySelector('#timer-strip.running .state')),
      stateWord: document.querySelector('#timer-strip.running .state')?.textContent.trim() ?? '',
    }));
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('.timer-card.running', { state: 'attached' });
    const card = await page.evaluate(() => ({
      dotVisible: window.__probe.visible(document.querySelector('.timer-card.running .tc-dot')),
      wordVisible: window.__probe.visible(document.querySelector('.timer-card.running .state')),
      stateWord: document.querySelector('.timer-card.running .state')?.textContent.trim() ?? '',
      // The whole attribute row, whatever class each label carries: this scene's claim is that
      // billable-ness is SAID, and D04/D14 (issue #160) moved the saying of it off the warn
      // `.flag` pill onto the quiet `.attr` label. Which palette each role takes is TIMER_VIEW's
      // assertion; here the row is read by position so a palette move can never mute the word.
      billableWord:
        [...document.querySelectorAll('.timer-card .flags > *')]
          .map((f) => f.textContent.trim())
          .find((t) => /billable/.test(t)) ?? '',
    }));
    await page.screenshot({ path: join(EVIDENCE, 'main-colour-pairing.png') });
    return { strip, card };
  });
  const calendar = await withPage(browser, entriesCalendarState(), 'index.html', async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length > 0);
    return page.evaluate(() => ({
      otag: document.querySelector('.dcol .ov .otag')?.textContent.trim() ?? '',
      moon: !!document.querySelector('.dcol .ev .zz use[href="#i-moon"]'),
    }));
  });
  const warn = await withPage(
    browser,
    overlapWriteState(),
    'index.html',
    async (page) => {
      await page.click('.entry[data-id="60"] [data-act="edit"]');
      await page.waitForSelector('.edit-form .edit-start', { state: 'attached' });
      await page.click('.edit-form button[type="submit"]');
      await page.waitForSelector('#overlap-banner:not([hidden])', { state: 'attached' });
      return page.evaluate(() => {
        const { rgbOf } = window.__probe;
        const b = document.querySelector('#overlap-banner');
        const cs = getComputedStyle(b);
        return {
          text: b.textContent.trim(),
          flagText: cs.color === rgbOf('--flag'),
          flagBg: cs.backgroundColor === rgbOf('--flag-bg'),
        };
      });
    },
    { overlap: true },
  );
  const err = await withPage(
    browser,
    runningState(),
    'index.html',
    async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('#timer-stop', { state: 'visible' });
      await page.click('#timer-stop');
      await page.waitForSelector('#timer-warning', { state: 'visible' });
      return page.evaluate(() => {
        const { rgbOf } = window.__probe;
        const t = document.querySelector('#timer-warning');
        const cs = getComputedStyle(t);
        return {
          text: t?.textContent.trim() ?? '',
          dangerText: cs.color === rgbOf('--danger'),
          dangerBg: cs.backgroundColor === rgbOf('--danger-weak'),
          mirrorsError: !!document.querySelector('#overlap-banner.error'),
        };
      });
    },
    { rejectWrites: true },
  );
  // The strip pairs by its dot — D05 takes a word OR an icon, and the strip's word is the
  // deliberately hidden one (one running indicator per surface, not two).
  const stripPairs = pairing.strip.dotVisible && pairing.strip.stateWord === 'running';
  // The card must carry BOTH (issue #142): the word is what a screen reader and a colour-
  // blind user get, the dot is the mark beside it. Presence is not enough — it had both in
  // the DOM, display:none, the whole time the bug shipped.
  const cardPairs =
    pairing.card.wordVisible && pairing.card.dotVisible && pairing.card.stateWord === 'running';
  const billableWorded = /^(non-)?billable$/.test(pairing.card.billableWord);
  const calendarMarkersWorded = /overlap\s*\d+m/.test(calendar.otag) && calendar.moon;
  const warnWorded = /overlap/i.test(warn.text) && warn.flagText && warn.flagBg;
  const errWorded = err.text.length > 0 && err.dangerText && err.dangerBg && err.mirrorsError;
  record(
    'COLOUR_PAIRING',
    { stripPairs, cardPairs, billableWorded, calendarMarkersWorded, warnWorded, errWorded },
    `D05/A05 pairing: run-dot beside 'running', both as RENDERED (strip=${JSON.stringify(pairing.strip)}, card=${JSON.stringify({ stateWord: pairing.card.stateWord, wordVisible: pairing.card.wordVisible, dotVisible: pairing.card.dotVisible })}); ` +
      `billable worded ('${pairing.card.billableWord}'); overlap band worded ('${calendar.otag}') + slept hatch carries #i-moon (${calendar.moon}); ` +
      `warn advisory worded on flag palette=${JSON.stringify(warn)}; err block worded on danger palette=${JSON.stringify(err)}`,
    'main-colour-pairing.png',
  );
}

// DESKTOP_FEEL — subjective; NOT machine-scored. `pass: null` so it is never
// counted as an automated pass; the screenshots are the evidence a human/LLM
// scores against acceptance/criteria/judge-rubric.md.
async function sceneDesktopFeel() {
  record(
    'DESKTOP_FEEL',
    null,
    'unscored here — screenshots captured for rubric/human scoring (main-empty, main-running, main-timer, main-calendar, main-edit, main-tags, main-report-client, main-report-day, main-focus, popover-running)',
    'main-running.png',
  );
}

/**
 * The declarative rubric-row -> scene table (issue #85). Each entry binds the
 * acceptance/criteria/judge-rubric.md row id(s) a scene proves, and the screenshot
 * file(s) it writes (issue #283), to the function that drives it; the driver runs them
 * in order and throws if a scene records an item — or writes a capture — it does not
 * declare, or misses one it does, so rubric↔scene and capture↔scene drift fail loud
 * instead of silently accumulating. `node run-judge.mjs --list-items` prints the bound
 * row ids and `--list-captures` the scene→capture pairs for the bind test, no browser.
 * Captures must be unique across scenes (judge-bind.test.ts): a shared filename means
 * last writer wins while every citation of it points at the other scene's state.
 */
const SCENES = {
  EMPTY_STATE: { items: ['EMPTY_STATE'], captures: ['main-empty.png'], run: sceneEmptyState },
  NAV_SHELL: { items: ['NAV_SHELL'], captures: ['main-nav.png', 'main-nav-wide.png'], run: sceneNavShell },
  KEYBOARD_FOCUS: { items: ['KEYBOARD_FOCUS'], captures: ['main-focus.png'], run: sceneKeyboardFocus },
  TRAY_COUNTUP: { items: ['TRAY_COUNTUP'], captures: ['popover-running-1.png', 'popover-running-2.png'], run: sceneTrayCountup },
  TRAY_POPOVER_SURFACE: { items: ['TRAY_POPOVER_SURFACE'], captures: ['popover-tray-surface.png', 'popover-running.png'], run: sceneTrayPopoverSurface },
  POPOVER_REJECT: { items: ['POPOVER_REJECT'], captures: ['popover-reject.png'], run: scenePopoverReject },
  IN_WINDOW_TIMER: { items: ['IN_WINDOW_TIMER'], captures: ['main-timer.png', 'timer-view.png', 'main-timer-idle.png'], run: sceneInWindowTimer },
  CROSS_VIEW_FRESHNESS: { items: ['CROSS_VIEW_FRESHNESS'], captures: ['timer-cross-view.png'], run: sceneCrossViewFreshness },
  TIMER_VIEW: { items: ['TIMER_VIEW'], captures: ['timer-view-full.png', 'timer-card-attr-vs-flag.png'], run: sceneTimerView },
  FUTURE_START_GUARD: { items: ['FUTURE_START_GUARD'], captures: ['timer-future-start-reject.png'], run: sceneFutureStartGuard },
  FAVORITES_RAIL: { items: ['FAVORITES_RAIL'], captures: ['timer-favorites.png', 'timer-favorites-empty.png'], run: sceneFavoritesRail },
  ACCENT_DISCIPLINE: { items: ['ACCENT_DISCIPLINE', 'ACCENT_SOLID_BUDGET'], captures: ['main-running.png'], run: sceneAccentDiscipline },
  PRIMARY_HANDOFF: { items: ['PRIMARY_HANDOFF'], captures: ['primary-handoff-timer.png', 'primary-handoff-reports.png'], run: scenePrimaryHandoff },
  CLICKABILITY: { items: ['CLICKABILITY'], captures: ['main-clickability.png'], run: sceneClickability },
  START_ATTRIBUTES: { items: ['START_ATTRIBUTES'], captures: ['main-start-attributes.png'], run: sceneStartAttributes },
  START_FORM: { items: ['START_FORM'], captures: ['main-start-form.png', 'main-start-form-running.png'], run: sceneStartForm },
  RUNNING_SINGLE_ACTION: { items: ['RUNNING_SINGLE_ACTION'], captures: ['timer-running-single-action.png'], run: sceneRunningSingleAction },
  UNIFIED_FORM_ADD: { items: ['UNIFIED_FORM_ADD'], captures: ['unified-add.png'], run: sceneUnifiedFormAdd },
  UNIFIED_FORM_EXPANDER: { items: ['UNIFIED_FORM_EXPANDER'], captures: ['unified-form-expander.png'], run: sceneUnifiedFormExpander },
  UNIFIED_FORM: { items: ['UNIFIED_FORM'], captures: ['main-edit.png', 'main-edit-exact-times.png'], run: sceneUnifiedForm },
  MULTILINE_DESC: { items: ['MULTILINE_DESC'], captures: ['main-multiline-desc.png'], run: sceneMultilineDesc },
  OVERLAP_BANNER: { items: ['OVERLAP_BANNER'], captures: ['main-overlap-banner.png'], run: sceneOverlapBanner },
  SPLIT_AFFORDANCE: { items: ['SPLIT_AFFORDANCE'], captures: ['main-split.png'], run: sceneSplitAffordance },
  INLINE_GATE_CONTAINMENT: { items: ['INLINE_GATE_CONTAINMENT'], captures: ['main-inline-gate.png'], run: sceneInlineGateContainment },
  WRITE_REJECTION_FEEDBACK: { items: ['WRITE_REJECTION_FEEDBACK'], captures: ['main-edit-reject.png'], run: sceneWriteRejectionFeedback },
  ADD_REFUSAL_PALETTE: { items: ['ADD_REFUSAL_PALETTE'], captures: ['add-refusal-palette.png'], run: sceneAddRefusalPalette },
  MERGE_CONFLICT: { items: ['MERGE_CONFLICT'], captures: ['main-merge-conflict.png'], run: sceneMergeConflict },
  MERGE_CHOICE_LIFT: { items: ['MERGE_CHOICE_LIFT'], captures: ['merge-choice-lift.png'], run: sceneMergeChoiceLift },
  MERGE_NOCONFLICT: { items: ['MERGE_NOCONFLICT'], captures: [], run: sceneMergeNoconflict },
  MERGE_GAP: { items: ['MERGE_GAP'], captures: ['main-merge-gap.png'], run: sceneMergeGap },
  DELETE_CONFIRM: { items: ['DELETE_CONFIRM'], captures: [], run: sceneDeleteConfirm },
  CONFIRM_DELETE: { items: ['CONFIRM_DELETE'], captures: ['main-confirm-delete.png'], run: sceneConfirmDelete },
  CONFIRM_DESTRUCTIVE: { items: ['CONFIRM_DESTRUCTIVE'], captures: ['main-confirm.png'], run: sceneConfirmDestructive },
  CLIENTS_VIEW: { items: ['CLIENTS_VIEW'], captures: ['main-clients.png', 'main-clients-created.png', 'main-clients-mutated.png', 'main-clients-empty.png'], run: sceneClientsView },
  CONFIRM_ARCHIVE: { items: ['CONFIRM_ARCHIVE'], captures: ['main-confirm-archive.png'], run: sceneConfirmArchive },
  RESTORE_ARCHIVED: { items: ['RESTORE_ARCHIVED'], captures: ['main-clients-archived.png'], run: sceneRestoreArchived },
  TAG_CHIPS: { items: ['TAG_CHIPS'], captures: ['main-tags.png'], run: sceneTagChips },
  REPORTS_VIEW: { items: ['REPORTS_VIEW'], captures: ['reports-list.png', 'reports-run.png', 'reports-empty.png'], run: sceneReportsView },
  ENTRIES_CALENDAR: { items: ['ENTRIES_CALENDAR'], captures: ['entries-search.png', 'entries-calendar.png'], run: sceneEntriesCalendar },
  CALENDAR_LAYOUT: { items: ['CALENDAR_LAYOUT'], captures: ['main-calendar.png', 'main-calendar-weekend.png'], run: sceneCalendarLayout },
  WINDOW_GEOMETRY: { items: ['WINDOW_GEOMETRY'], captures: ['calendar-wide.png', 'min-window-add.png', 'popover-fit.png'], run: sceneWindowGeometry },
  CALENDAR_ACCENT_BUDGET: { items: ['CALENDAR_ACCENT_BUDGET'], captures: ['calendar-accent-budget.png'], run: sceneCalendarAccentBudget },
  SELECTION_LIFT: { items: ['SELECTION_LIFT'], captures: ['selection-lift.png', 'selection-lift-editing.png'], run: sceneSelectionLift },
  CALENDAR_ENTRY_BLOCK: { items: ['CALENDAR_ENTRY_BLOCK'], captures: ['main-calendar-short.png'], run: sceneCalendarEntryBlock },
  CALENDAR_KEYBOARD: { items: ['CALENDAR_KEYBOARD'], captures: ['calendar-keyboard-focus.png'], run: sceneCalendarKeyboard },
  LIVE_FILTER: { items: ['LIVE_FILTER'], captures: ['main-filtered.png', 'main-no-matching.png'], run: sceneLiveFilter },
  SETTINGS_VIEW: { items: ['SETTINGS_VIEW'], captures: ['main-settings.png'], run: sceneSettingsView },
  HOTKEY_NO_TRAP: { items: ['HOTKEY_NO_TRAP'], captures: ['settings-hotkey-focus.png'], run: sceneHotkeyNoTrap },
  TIMELINE_WINDOW: { items: ['TIMELINE_WINDOW'], captures: ['timeline-window.png'], run: sceneTimelineWindow },
  TIMELINE_WINDOW_AROUND: { items: ['TIMELINE_WINDOW'], captures: [], run: sceneTimelineWindowAround },
  SOFTWARE_UPDATE: { items: ['SOFTWARE_UPDATE'], captures: ['main-software-update.png', 'main-software-update-error.png', 'main-software-update-check-error.png'], run: sceneSoftwareUpdate },
  BACKUPS_SECTION: { items: ['BACKUPS_SECTION'], captures: ['main-backups.png', 'main-backups-empty.png'], run: sceneBackupsSection },
  RECOVERY_NOTICE: { items: ['RECOVERY_NOTICE'], captures: ['main-recovery.png'], run: sceneRecoveryNotice },
  PARITY_REACH: { items: ['PARITY_REACH'], captures: ['parity-timer.png', 'parity-entries.png', 'parity-clients.png', 'parity-reports.png', 'parity-settings.png'], run: sceneParityReach },
  FIELD_LABELS: { items: ['FIELD_LABELS'], captures: ['field-labels-timer.png', 'field-labels-entries.png', 'field-labels-reports.png'], run: sceneFieldLabels },
  FIELD_CHROME: { items: ['FIELD_CHROME'], captures: ['field-chrome-search-focus.png'], run: sceneFieldChrome },
  TARGET_SIZE: { items: ['TARGET_SIZE'], captures: ['main-target-size.png', 'target-size-add-form.png'], run: sceneTargetSize },
  COLOUR_PAIRING: { items: ['COLOUR_PAIRING'], captures: ['main-colour-pairing.png'], run: sceneColourPairing },
  DESKTOP_FEEL: { items: ['DESKTOP_FEEL'], captures: [], run: sceneDesktopFeel },
};

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const exe = resolveChromium();
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  for (const [name, scene] of Object.entries(SCENES)) {
    const before = results.length;
    const shotsBefore = captured.length;
    await scene.run(browser);
    const recorded = [...new Set(results.slice(before).map((r) => r.item))];
    const missing = scene.items.filter((i) => !recorded.includes(i));
    const undeclared = recorded.filter((i) => !scene.items.includes(i));
    if (missing.length || undeclared.length) {
      throw new Error(
        `scene ${name} drifted from its declared rubric rows — ` +
          `missing: [${missing.join(', ')}] undeclared: [${undeclared.join(', ')}]`,
      );
    }
    // The capture side of the declaration (issue #283): the scene wrote exactly the files
    // it declares, so the --list-captures listing the bind test asserts uniqueness over is
    // the truth about what a judge run writes, not a parallel hand-copied list.
    const wrote = [...new Set(captured.slice(shotsBefore))];
    const unwritten = scene.captures.filter((f) => !wrote.includes(f));
    const unregistered = wrote.filter((f) => !scene.captures.includes(f));
    if (unwritten.length || unregistered.length) {
      throw new Error(
        `scene ${name} drifted from its declared captures — ` +
          `declared but not written: [${unwritten.join(', ')}] written but not declared: [${unregistered.join(', ')}]`,
      );
    }
  }

  await browser.close();

  const report = {
    suite: 'JUDGE — GUI presentation & discoverability',
    // Pinned to the fixture clock so the committed report verifies byte-for-byte.
    fixtureClock: JUDGE_NOW,
    note:
      'pass:true/false are machine-checked deterministic facts; pass:null items are ' +
      'captured-not-scored and are routed to human/LLM rubric review, never auto-passed.',
    results,
  };
  mkdirSync(dirname(join(EVIDENCE, '..', 'judge-report.json')), { recursive: true });
  writeFileSync(join(EVIDENCE, '..', 'judge-report.json'), JSON.stringify(report, null, 2) + '\n');

  const label = (p) => (p === null ? 'UNSCORED' : p ? 'PASS' : 'FAIL');
  for (const r of results) {
    console.log(`${label(r.pass).padEnd(8)} ${r.item.padEnd(18)} ${r.justification}`);
  }
  const failed = results.filter((r) => r.pass === false);
  if (failed.length) {
    console.error(`\n${failed.length} JUDGE item(s) failed.`);
    process.exit(1);
  }
  const unscored = results.filter((r) => r.pass === null).length;
  console.log(
    `\nAll ${results.length - unscored} machine-scored JUDGE items passed; ` +
      `${unscored} subjective item(s) left for rubric/human review. ` +
      'Screenshots in acceptance/evidence/screenshots/.',
  );
}

if (process.argv.includes('--list-items')) {
  // The bind-test listing mode (the record.mjs precedent): every rubric row id the
  // scene table declares, one per line, no browser.
  for (const id of [...new Set(Object.values(SCENES).flatMap((s) => s.items))]) console.log(id);
} else if (process.argv.includes('--list-captures')) {
  // The capture listing (issue #283): every screenshot each scene declares it writes, one
  // tab-separated scene→file pair per line, no browser. judge-bind.test.ts asserts no file
  // has two writers; the driver's per-scene drift check holds these declarations to what a
  // run actually writes.
  for (const [name, scene] of Object.entries(SCENES))
    for (const file of scene.captures) console.log(`${name}\t${file}`);
} else {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
