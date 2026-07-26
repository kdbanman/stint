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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChromium } from '../../../scripts/resolve-chromium.mjs';
import { emptyState, runningState, startFormState, addFormState, editingState, unifiedFormState, multilineDescState, splittableState, edgeColumnState, mergeConflictState, mergeAgreeState, mergeGapState, overlapWriteState, clientsState, taggedState, listState, liveState, entriesCalendarState, shortEntriesCalendarState, denseCalendarState, savedReportsState, settingsState, timelineWindowState, timelineAroundState, softwareUpdateState, backupsState, recoveryState, UPDATE_FIXTURE, UPDATE_CHECK_FAILED, timerViewRunningState, timerViewSleptRunningState, timerViewFavoritesState, timerViewEmptyFavoritesState, initScript, JUDGE_NOW } from './fixtures.mjs';
// §17 R8 — the IPC channel set the GUI is an equal surface over. Imported from the built
// main bundle so the PARITY_REACH deterministic sub-fact (every channel has a window.stint
// method) checks the SAME list the preload bridge exposes and parity.test.ts asserts against
// — one source of truth, no hand-copied channel list to drift.
import { CHANNELS } from '../dist/ipc.js';

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

// Every scene page — withPage's and the hand-built ones — comes through here so the probe
// helpers are always installed before the renderer loads.
async function newScenePage(browser, pageOpts) {
  const page = await browser.newPage(pageOpts);
  await page.addInitScript(PROBE_HELPERS);
  return page;
}

async function withPage(browser, state, name, fn, initOpts = {}) {
  const page = await newScenePage(browser, { viewport: { width: 760, height: 620 }, colorScheme: 'light' });
  // Pin the page clock so derived count-ups and the captured evidence are
  // byte-for-byte reproducible; the count-up only advances on explicit fastForward.
  await page.clock.install({ time: new Date(JUDGE_NOW) });
  await page.clock.pauseAt(new Date(JUDGE_NOW));
  await page.addInitScript(initScript(JSON.stringify(state), initOpts));
  await page.goto(fileUrl(name));
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
// `pass` is true/false for the deterministic, gating facts; null marks an item that
// is captured-but-not-machine-scored (the subjective rubric line), so it never
// silently counts as a pass.
function record(item, pass, justification, screenshot) {
  results.push({ item, pass, justification, screenshot });
}

// EMPTY_STATE — the empty main window instructs a concrete next action (§12 R5).
async function sceneEmptyState(browser) {
  await withPage(browser, emptyState(), 'index.html', async (page) => {
    const text = await page.textContent('.empty');
    await page.screenshot({ path: join(EVIDENCE, 'main-empty.png') });
    const ok = /tt start/.test(text) && /Ctrl\+Alt\+T/.test(text);
    record('EMPTY_STATE', ok, `empty state reads: ${JSON.stringify(text.trim())}`, 'main-empty.png');
  });
}

// NAV_SHELL — §12 R3 (G7) + design.html D12: the main window presents a persistent left-hand
// nav with the five views (Timer / Entries / Clients / Reports / Settings); the current view
// is highlighted and each item routes to its view. Beyond order + default-active + routing,
// two hardened G7 guarantees:
//   SIDEBAR_EVERY_VIEW — routing to EACH of the five views keeps the `.shell .nav` rail
//     visible (getBoundingClientRect width>0, not hidden) in ALL five, with exactly one `.view`
//     visible each time — no view escapes the shell.
//   FIXED_WIDTH_ON_RESIZE — the rail's measured width is FIXED across the 480/760/1200px
//     viewports while the `.views` column width changes, proving resize lands on the content
//     area, not the rail (168px is the JUDGE-pinned width, not asserted as a magic number).
//   D12 LIFTED CHIP — selection ≠ accent: the ACTIVE item is a raised paper chip (computed
//     background === --paper, label === --ink, a non-none chip-lift box-shadow) whose ICON —
//     and only its icon — takes the accent (--accent); the four inactive items are flat
//     (box-shadow none, no accent icon). An accent-weak active fill would fail every one
//     of these.
// All the facts fold into the single NAV_SHELL pass. Captures main-nav.png (default viewport)
// and main-nav-wide.png (1200px) as the rubric evidence for the "quiet desktop shell" line.
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

    // design.html D12 — the active item is the LIFTED CHIP, never an accent fill: paper
    // background, ink label, a real chip-lift shadow, accent confined to the icon. Inactive
    // items stay flat (no shadow) with non-accent icons.
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

    // Route to a different view by clicking its nav item; the active marker and the visible
    // view must both move to Settings (client-side routing works, no IPC).
    await page.click('.nav-item[data-view="settings"]');
    const after = await page.evaluate(() => {
      const active = [...document.querySelectorAll('.nav-item.active')].map((b) => b.dataset.view);
      const visibleViews = [...document.querySelectorAll('.view')].filter((v) => !v.hidden).map((v) => v.dataset.view);
      const entriesHidden = !!document.querySelector('.view[data-view="entries"]')?.hidden;
      return { active, visibleViews, entriesHidden };
    });

    // SIDEBAR_EVERY_VIEW: click through every one of the five views and assert the rail stays
    // visible (laid out, non-zero width, not hidden) on each, with exactly one .view shown.
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

    // FIXED_WIDTH_ON_RESIZE: measure the rail (and the views column, to show it is the one that
    // moves) at three viewport widths; the rail must hold ONE fixed width across all three
    // (168px is the JUDGE-pinned width; the assertion pins fixedness, not the number).
    const measure = () =>
      page.evaluate(() => {
        const nav = document.querySelector('.shell .nav');
        const views = document.querySelector('.shell .views');
        return {
          rail: Math.round(nav.getBoundingClientRect().width),
          views: Math.round(views.getBoundingClientRect().width),
        };
      });
    const at760 = await measure();
    await page.setViewportSize({ width: 1200, height: 620 });
    const at1200 = await measure();
    await page.screenshot({ path: join(EVIDENCE, 'main-nav-wide.png') });
    await page.setViewportSize({ width: 480, height: 620 });
    const at480 = await measure();
    // Restore the default viewport so the page state matches the rest of the harness.
    await page.setViewportSize({ width: 760, height: 620 });
    // The rail stays a FIXED width on resize — byte-identical across viewports (whatever that
    // width is; the exact px is a style choice judged visually against the mocks, not pinned to a
    // magic number here, issue #25) — while the views column absorbs the change, so resize lands
    // on the content, not the rail.
    const fixedWidthOnResize =
      at760.rail === at1200.rail &&
      at760.rail === at480.rail &&
      at1200.views !== at760.views &&
      at480.views !== at760.views;

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
      orderOk && defaultOk && routedOk && sidebarEveryView && fixedWidthOnResize && chipOk,
      `nav order ${JSON.stringify(before.labels)}; default active=${before.activeView} (one view shown); ` +
        `D12 lifted chip (paper bg + ink label + accent icon + shadow; inactive flat)=${chipOk} ${JSON.stringify(chip)}; ` +
        `clicking Settings routed: active=${JSON.stringify(after.active)} visible=${JSON.stringify(after.visibleViews)}; ` +
        `sidebar-every-view rail visible on all five=${sidebarEveryView} ` +
        `(${everyView.map((p) => `${p.view}:w${p.railWidth}/${p.railVisible ? 'shown' : 'HIDDEN'}`).join(', ')}); ` +
        `fixed-width-on-resize rail=${at480.rail}/${at760.rail}/${at1200.rail} (480/760/1200) ` +
        `views=${at480.views}/${at760.views}/${at1200.views} → ${fixedWidthOnResize}`,
      'main-nav.png',
    );
  });
}

// KEYBOARD_FOCUS — §12 R14 / §14 + design.html A04 (focus visible): the keyboard-operability
// + focus pass. Every interactive control in the window must be reachable by Tab in reading
// order (the active element never gets trapped on <body> or goes null) AND show a visible
// focus ring when it holds keyboard focus. We drive the REAL renderer on both the empty and
// the running main window: collect the focusable controls (querySelectorAll over button /
// [tabindex] / a[href], minus the hidden ones), Tab-walk from <body>, and assert (a) the walk
// advances through every visible control with activeElement never null/stuck on body, and
// (b) each focused control, under :focus-visible (the keyboard-focus state Playwright's Tab
// walk triggers), paints a ring as a computed-style DELTA: its outline/box-shadow signature
// while focused DIFFERS from its own unfocused baseline. The delta predicate is the A04
// hardening — a persistent decoration (the D12 chip-lift shadow on a selected chip, a static
// border) can never fake a ring, because it is identical focused and unfocused. Captures
// main-focus.png with the primary toggle focused so the ring is visible evidence.
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
      // A04: the focused signature must DIFFER from the control's own unfocused baseline.
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
    const ok =
      empty.focusables > 0 &&
      empty.reached === empty.focusables && // every visible control was reached by Tab…
      empty.ringMisses.length === 0 && // …and each showed a visible ring…
      !empty.trappedOnBody && // …and focus never stuck on <body> (no trap / void)
      running.focusables > 0 &&
      running.reached === running.focusables &&
      running.ringMisses.length === 0 &&
      !running.trappedOnBody;
    record(
      'KEYBOARD_FOCUS',
      ok,
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
    // Deterministic: starts at exactly 01:24:07, advances exactly +3s on fast-forward.
    const ok = t1 === '01:24:07' && delta === 3;
    record('TRAY_COUNTUP', ok, `popover count advanced ${t1} → ${t2} (+${delta}s)`, 'popover-running-2.png');
  });
}

// TRAY_POPOVER_SURFACE — §12 R01 / G8: the compact popover is the SOLE tray action
// surface. The tray's single left-click opens this popover; the dropdown action menu is
// removed (the tray's own click/right-click has no host headless — confirmed under MANUAL).
// The half that IS headless-checkable: every tray action lives IN the popover, and Switch is
// GONE (issue #34 — Start is the atomic stop-then-start, no separate verb). Drive the real
// popover renderer twice and assert the surviving actions are present and NO #switch survives —
//   running snapshot: #toggle reads 'Stop' (aria-pressed=true), #open present, NO #switch;
//   idle snapshot:    #toggle reads 'Start', #open present, NO #switch.
// If Stop / Start / Open Stint is absent — or a #switch element reappears in EITHER state —
// this fails. Since the dropdown is gone, the popover MUST carry Stop/Start + Open Stint.
// Captures popover-tray-surface.png as the evidence that the popover is the one action surface.
async function sceneTrayPopoverSurface(browser) {
  await withPage(browser, runningState(), 'popover.html', async (page) => {
    const runningProbe = await page.evaluate(() => {
      const toggle = document.querySelector('#toggle');
      const open = document.querySelector('#open');
      return {
        toggleLabel: toggle ? toggle.textContent.trim() : null,
        togglePressed: toggle ? toggle.getAttribute('aria-pressed') : null,
        // Switch is removed entirely — the popover must carry NO #switch element while running.
        noSwitch: !document.querySelector('#switch'),
        openPresent: !!open,
        openLabel: open ? open.textContent.trim() : null,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'popover-tray-surface.png') });
    // popover-running.png — the running-popover presentation still, the TRAY_POPOVER_SURFACE
    // rubric evidence the retired SWITCH_AFFORDANCE scene used to capture.
    await page.screenshot({ path: join(EVIDENCE, 'popover-running.png') });

    // The idle snapshot: the same popover offers Start (one-tap) and Open Stint, with no #switch
    // element either — Start is reachable in both states, so the dropdown's Start is not lost.
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
      runningOk && idleOk,
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
// Drive the REAL popover renderer over the running snapshot with the strict-rejecting mock:
// clicking #toggle (Stop) rejects ('stop time is before the entry started'), and the popover
//   SURFACES it — #pop-warning is visible, non-empty, and announced (role=status + aria-live);
//   STAYS OPERABLE — #toggle is still present, enabled and still reads 'Stop' (the running
//     state never wedged; the refusal did not fake a stop), and Open Stint is still there;
//   a SECOND click rejects again and the warning region persists (repeatable, not one-shot).
// Captures popover-reject.png as the rubric evidence.
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
        // Operability: the toggle survives the refusal — present, enabled, still reading
        // 'Stop' (the popover never pretended the stop landed), with Open Stint reachable.
        toggleLive: !!toggle && !toggle.disabled && /Stop/.test(toggle.textContent),
        stillRunning: !!document.querySelector('#pop.running'),
        openPresent: !!open && !open.disabled,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'popover-reject.png') });

    // Repeatable, not one-shot: a second Stop attempt rejects again and the announced
    // region still carries the reason — the popover remains a live surface throughout.
    await page.click('#toggle');
    await page.waitForSelector('#pop-warning', { state: 'visible' });
    const again = await page.evaluate(() => ({
      shown: !document.querySelector('#pop-warning').hidden &&
        document.querySelector('#pop-warning').textContent.trim().length > 0,
      toggleLive: !document.querySelector('#toggle').disabled,
    }));

    const ok =
      refused.shown &&
      refused.announced &&
      // Issue 138: the popover reads the same one mapping site (SU.errMessage), so the
      // Electron-wrapped rejection must land here as the reason ALONE — the tray surface is
      // the smallest region in the app and had the least room for a transport sentence.
      refused.message === 'stop time is before the entry started' &&
      readsClean(refused.message) &&
      refused.toggleLive &&
      refused.stillRunning &&
      refused.openPresent &&
      again.shown &&
      again.toggleLive;
    record(
      'POPOVER_REJECT',
      ok,
      `refused popover toggle surfaced + operable: ${JSON.stringify(refused)}; second attempt ${JSON.stringify(again)}`,
      'popover-reject.png',
    );
  }, { rejectWrites: true });
}

// IN_WINDOW_TIMER (main window) — §12 R04 + R14: the FULL Active-Timer card lives in the
// Timer view, and the Entries view keeps only a COMPACT STRIP that mirrors the running
// count-up/state/desc and links to the Timer view. Drive the real renderer on index.html
// with the running fixture and assert: (a) on the Timer view (reached by clicking the nav
// item) the full #timer-card clock reads the derived count-up and advances +3s across a
// pinned-clock step (same technique as TRAY_COUNTUP), shows the running state, carries the
// running description ('auth refactor') and the client/project label ('Client A / API'), and
// exposes a Stop control with NO Switch (Switch is removed — issue #34; the start-with-details
// form performs the atomic stop-then-start); and (b) on the Entries view the compact
// #timer-strip mirrors the running count-up + state + description but carries NO full-panel
// Stop control (and never a #timer-switch). A third, IDLE page (STATES.md Entries × edge)
// asserts the strip is STILL PAINTED with nothing running — its idle face: 00:00:00 clock,
// state 'idle', empty description (app.js renderTimerStrip's idle branch). The strip clock
// also computes the D06 compact Clock role: 24px, tabular numerals. Fails if the full
// panel stayed on Entries, the card/strip placement regressed, a #timer-switch reappeared,
// or the idle strip vanished/kept stale running data. Captures timer-view.png (the full
// panel), main-timer.png (the Entries strip) and main-timer-idle.png (the idle strip).
async function sceneInWindowTimer(browser) {
  await withPage(browser, runningState(), 'index.html', async (page) => {
    // Entries view (default) first: the compact strip mirrors the running timer and exposes no
    // full-panel Stop control (it lives on the Timer-view card only); no #timer-switch anywhere.
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
        // The strip must NOT carry the full Stop panel control (it belongs to the card).
        noStop: !document.querySelector('#timer-strip #timer-stop'),
        // Switch is removed — no #timer-switch element exists anywhere in the document.
        noSwitch: !document.querySelector('#timer-switch'),
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-timer.png') });

    // Route to the Timer view, where the FULL Active-Timer card lives.
    await page.click('.nav-item[data-view="timer"]');
    const t1 = await page.textContent('#timer-clock');
    await page.screenshot({ path: join(EVIDENCE, 'timer-view.png') });
    // Advance exactly 3s and stay frozen there (pauseAt, not fastForward) so the second
    // read is reproducible — the card's tick() must have advanced the count-up.
    await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + 3000));
    const probe = await page.evaluate(() => {
      const card = document.querySelector('#timer-card');
      // The full card must be hosted INSIDE the Timer view section, not the Entries section.
      const inTimerView = !!card && !!card.closest('.view[data-view="timer"]');
      return {
        inTimerView,
        clock: document.querySelector('#timer-clock')?.textContent ?? null,
        running: !!card && card.classList.contains('running'),
        state: document.querySelector('#timer-state')?.textContent?.trim() ?? null,
        desc: document.querySelector('#timer-desc')?.textContent?.trim() ?? null,
        meta: document.querySelector('#timer-meta')?.textContent?.trim() ?? null,
        hasStop: !!document.querySelector('#timer-stop') && !document.querySelector('#timer-stop').hidden,
        // Switch is removed — there must be NO #timer-switch element anywhere (issue #34).
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

    // The IDLE strip page (STATES.md Entries × edge): with nothing running the Entries view
    // still paints the compact strip in its idle face — 00:00:00, state 'idle', empty desc.
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
      cardOk && stripOk && idleOk,
      `Timer-view card count advanced ${t1} → ${probe.clock} (+${delta}s) ${JSON.stringify(probe)}; ` +
        `Entries strip ${JSON.stringify(strip)}; idle strip ${JSON.stringify(idleStrip)}`,
      'timer-view.png',
    );
  });
}

// CROSS_VIEW_FRESHNESS — §12 R04 (issue #50 regression): the Active-Timer card mirrors
// `tt status` EVEN AFTER an Entries-toolbar control has been touched. The renderer latches a
// module flag once a range/filter/search control is used; pre-fix, load() early-returned into
// the entries-only query and never repainted the shared surfaces, so on the Timer view a
// Start click mutated the DB while the card stayed frozen on its idle face (the app's primary
// action looked dead). Drive the exact reported path over the idle list fixture: (a) touch an
// Entries-toolbar control (the Today range preset — window.__LIST_REQ__ records the query,
// proving the toolbar latched), (b) route to the Timer view (the card paints idle), (c) click
// Start — the toggle mock mutates the snapshot to a running open row (toggleStarts), exactly
// like main's toggleTimer over core — and assert WITHOUT any reload (a window marker set
// before the click must survive) that the card flips to running: state text 'running', the
// card carries .running, the idle-only start panel hides (§12 R05 / issue #51 — the Start
// affordance disappears with it) while the accented #timer-stop primary becomes visible,
// and the count-up ADVANCES (+3s across a pinned-clock step — live, not a stale paint).
// Fails if the card stays idle/frozen after the toolbar was touched — the exact #50
// symptom. Captures timer-cross-view.png.
async function sceneCrossViewFreshness(browser) {
  await withPage(
    browser,
    listState(),
    'index.html',
    async (page) => {
      // (a) Entries view (the default route): touch a toolbar control — the Today range preset.
      await page.click('#el-preset-seg .preset[data-preset="today"]');
      await page.waitForFunction(() => !!window.__LIST_REQ__);
      const latched = await page.evaluate(() => window.__LIST_REQ__ ?? null);
      // (b) Route to the Timer view; the card paints the idle face.
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
      // (d) The count-up ADVANCES from the pinned start across a +3s clock step — the card is
      // the live timer surface, not a one-off stale paint.
      await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + 3000));
      const clock2 = (await page.textContent('#timer-clock')).trim();
      const ok =
        !!latched &&
        latched.preset === 'today' &&
        idle.state === 'idle' &&
        idle.toggle === 'Start' &&
        idle.clock === '00:00:00' &&
        !!after &&
        after.state === 'running' &&
        after.panelHidden &&
        !after.startVisible &&
        after.stopVisible &&
        after.running &&
        after.noReload &&
        after.clock === '00:00:00' &&
        clock2 === '00:00:03';
      record(
        'CROSS_VIEW_FRESHNESS',
        ok,
        `Entries toolbar latched (listEntries query ${JSON.stringify(latched)}); Timer card before Start ` +
          `${JSON.stringify(idle)}; after Start (no reload) ${JSON.stringify(after)}; count-up then ` +
          `advanced ${after ? after.clock : 'n/a'} → ${clock2} across a +3s pinned-clock step`,
        'timer-cross-view.png',
      );
    },
    { toggleStarts: true },
  );
}

// TIMER_VIEW (full Timer view, G5) — §12 R14 / §05 R06: the START-ONLY scene. Routing to the
// Timer view renders the live clock reading the derived count-up (advances +3s across the
// pinned-clock step, not reset) with the live-edit-running strip present (no End input); the
// clock computes the D06 full Clock role — 38px, tabular numerals, the --num stack.
// The card also SAYS it is running (design.html D05/A05, issue #142): the word is in the
// card's rendered innerText, painted by the state line, with an accent-filled dot beside it —
// so the state does not ride on the recoloured count-up alone, as it did until that issue.
// Clicking the Start field's calendar affordance opens the inline START-ONLY picker
// disclosure IN FLOW below the field — zero .stp-backdrop / modal chrome anywhere, the
// container computes position: static — showing the running block with a START drag grip
// ONLY (no .stp-resize end grip, no end label, no end echo field) and the computed future
// transparency fade (mask-image gradient) dissolving the block toward the future; the
// snapshot's other same-day entries paint gray. Dragging the grip UP by a known pixel delta
// (-30px on the 720px/24h track = -60min) advances the raw #le-start text field LIVE by the
// snapped 5-min amount (the exact 21:35:53 → 20:35); the debounced commit then sends an `edit` patch over
// IPC (window.__EDITED__) that carries startUtc but has NO endUtc key — the open row stays
// open, its end never synthesized. The page is pinned to timezoneId 'UTC' so the seeded UTC
// instants land on a deterministic local day/track geometry.
// A second page over the same card scores the ATTRIBUTE-VS-ADVISORY split (design.html D04/D14,
// issue #160): with an open entry that is billable AND slept through, the card's attribute row
// carries both roles at once, and `slept` must take the whole --flag warn triple while `billable`
// — the normal state of nearly every entry — stays the quiet --muted label, with no pill chrome
// and no part of that triple. Scored as one pair, because the bug guarded painted BOTH amber.
async function sceneTimerView(browser) {
  {
    const page = await newScenePage(browser, { viewport: { width: 760, height: 900 }, colorScheme: 'light', timezoneId: 'UTC' });
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
        // §12 R14 (G1): #le-start is a RAW text field, not a native datetime-local.
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
        // Beside the word, the dot: laid out, and carrying the accent that the count-up carries.
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

    // Open the inline start-only disclosure from the Start field's calendar affordance.
    await page.click('#le-start-pick');
    await page.waitForSelector('#le-start-disc:not([hidden]) .stp-grip', { state: 'attached' });
    const disc = await page.evaluate(() => {
      const host = document.querySelector('#le-start-disc');
      const box = host.querySelector('.stp-inline');
      const me = host.querySelector('.stp-block.me.open');
      const cs = me ? getComputedStyle(me) : null;
      const mask = cs ? cs.maskImage || cs.webkitMaskImage || '' : '';
      return {
        // IN FLOW — no modal chrome anywhere: no backdrop, no dialog role, static position.
        inFlow: !!box && getComputedStyle(box).position === 'static',
        noBackdrop: !document.querySelector('.stp-backdrop'),
        noDialog: !host.querySelector('[role="dialog"], [aria-modal]'),
        expanded: document.querySelector('#le-start-pick')?.getAttribute('aria-expanded') === 'true',
        // START-ONLY chrome: a start grip, and NO end grip / end label / end echo anywhere.
        grip: !!host.querySelector('.stp-grip'),
        noResize: !host.querySelector('.stp-resize'),
        noEndLabel: !host.querySelector('.stp-lab-bot'),
        noEndEcho: !host.querySelector('.stp-echo-end'),
        // The running block dissolves into the future — the computed transparency mask.
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
      // Still no end anywhere after the drag — the variant cannot even paint one.
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
    const ok =
      t1 === '01:24:07' &&
      delta === 3 &&
      before.stripPresent &&
      before.noEnd &&
      before.startIsText &&
      before.hasStop &&
      before.noSwitch &&
      // D05/A05 (issue #142) — the word reaches the rendered card, it comes from the state
      // line, and the dot beside it is laid out and accent-filled. Colour alone no longer
      // carries the app's most important state.
      before.cardText.includes('running') &&
      before.statePainted &&
      before.dotVisible &&
      before.dotFill === before.accentRgb &&
      before.clockPx === '38px' &&
      before.clockTnum &&
      before.clockNumStack &&
      disc.inFlow &&
      disc.noBackdrop &&
      disc.noDialog &&
      disc.expanded &&
      disc.grip &&
      disc.noResize &&
      disc.noEndLabel &&
      disc.noEndEcho &&
      disc.fade &&
      disc.others >= 1 &&
      // §12 R15 (issue #49): the strip renders the stored start EXACTLY, to the second — the
      // fixture's open row started 5047s (01:24:07) before the 23:00:00Z pinned clock = 21:35:53.
      disc.startBefore === '2026-06-24 21:35:53' &&
      // issue #159: the rendered value matches NO `T`-separated pattern — it is the string the
      // user selects and retypes, not a serialization — and the placeholder promises exactly it.
      !/\d{4}-\d{2}-\d{2}T/.test(disc.startBefore) &&
      disc.startPlaceholder === 'YYYY-MM-DD HH:mm:ss' &&
      new RegExp(`^${disc.startPlaceholder.replace(/[A-Za-z]/g, '\\d')}$`).test(disc.startBefore) &&
      dragged.startLive === '2026-06-24 20:35:00' &&
      !/\d{4}-\d{2}-\d{2}T/.test(dragged.startLive) &&
      dragged.stillNoEndChrome &&
      dragged.noBackdrop &&
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
    const palettePage = await newScenePage(browser, { viewport: { width: 760, height: 900 }, colorScheme: 'light', timezoneId: 'UTC' });
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
    const paletteOk =
      // Both roles reach the rendered card, each said in a word.
      paint.attrShown &&
      paint.flagShown &&
      paint.attrText === 'billable' &&
      paint.flagText === 'slept' &&
      // The ADVISORY keeps the warn palette whole — text, fill and rule — and its pill shape.
      !!paint.flagPaint &&
      paint.flagPaint.every((v, i) => v === paint.flagTriple[i]) &&
      paint.flagRadius === '999px' &&
      // The ATTRIBUTE is the neutral text role, and carries NO part of the warn chrome: not its
      // text colour, not its fill (transparent, so not --flag-bg), not a rule, not a pill.
      paint.attrColor === paint.muted &&
      paint.attrColor !== paint.flagTriple[0] &&
      paint.attrBg === 'rgba(0, 0, 0, 0)' &&
      paint.attrBorderWidth === '0px' &&
      paint.attrRadius === '0px' &&
      // …nor is it the accent fill the function's own comment was already watching for (§15).
      paint.attrColor !== paint.accent &&
      paint.attrColor !== paint.accentSolid &&
      paint.attrBg !== paint.accentWeak;
    record(
      'TIMER_VIEW',
      ok && paletteOk,
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
// ("Stop appears dead"). Driving the REAL renderer over the future-start guard mock (edit rejects
// a start > now exactly as core's edit() does) plus the state-mutating toggle: typing a next-day
// instant into #le-start and letting the debounced live-edit commit fire raises the announced
// #timer-warning region with the reason and records NOTHING (window.__EDITED__ stays null) — the
// live-edit strip stays present and Stop is still there (the count-up never froze). Correcting the
// start to a valid PAST instant then commits cleanly (the warning clears, __EDITED__ carries the
// corrected startUtc with NO endUtc — the open row stays open), and clicking Stop flips the status
// to idle: the timer never wedged. Pinned to timezoneId 'UTC' so the typed instants map determin-
// istically to UTC. Builds on the WRITE_REJECTION_FEEDBACK precedent (the #65 #timer-warning region).
async function sceneFutureStartGuard(browser) {
  {
    const page = await newScenePage(browser, { viewport: { width: 760, height: 900 }, colorScheme: 'light', timezoneId: 'UTC' });
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
        // The Timer-view region is genuinely on-screen (in the active view), announced, and carries
        // the reason — the surface the mistyped start was typed on (#61's "Stop appears dead" spot).
        shown: !!t && !t.hidden && (rect?.width ?? 0) > 0 && (rect?.height ?? 0) > 0 && t.textContent.trim().length > 0,
        announced: t?.getAttribute('role') === 'status' && t?.hasAttribute('aria-live'),
        message: t?.textContent.trim() ?? '',
        notWritten: window.__EDITED__ == null, // the refused future start recorded nothing
        stillRunning: !!strip && !strip.hidden, // the live-edit strip persists — the count-up never froze
        stopStillThere: !!stop && !stop.hidden, // Stop is still present (no wedge)
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'timer-future-start-reject.png'), fullPage: true });

    // NO WEDGE (correcting): retype a valid PAST instant — the commit succeeds, load() clears the
    // warning, and window.__EDITED__ now carries the corrected startUtc with NO endUtc (row open).
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

    // NO WEDGE (stoppable): click Stop — the toggle resolves and the status flips to idle.
    await page.click('#timer-stop');
    await page.waitForFunction(() => window.__STATE__ && window.__STATE__.status && window.__STATE__.status.running === false);
    const stopped = await page.evaluate(() => ({
      idle: !!(window.__STATE__ && window.__STATE__.status) && window.__STATE__.status.running === false,
    }));

    const ok =
      refused.shown && refused.announced && refused.notWritten && refused.stillRunning && refused.stopStillThere &&
      // Issue 138 — the exact string the design-audit sweep captured from this region was
      // "Error invoking remote method 'edit': StoreError: start time is in the future". The
      // mock rejects in that same wrapped shape now, so the region must read the reason alone.
      refused.message === 'start time is in the future' && readsClean(refused.message) &&
      corrected.warningCleared && corrected.editedStart === '2026-06-24T22:00:00.000Z' && corrected.noEnd &&
      stopped.idle;
    record(
      'FUTURE_START_GUARD',
      ok,
      `future-reject=${JSON.stringify(refused)} corrected=${JSON.stringify(corrected)} stopped=${JSON.stringify(stopped)}`,
      'timer-future-start-reject.png',
    );
    await page.close();
  }
}

// FAVORITES_RAIL — §05 R09 / §12 R14: the Timer view's pinned favorites rail renders one row
// per FavoriteView (name + client/project/billable meta), each with a one-click Resume that
// fires window.stint.startFavorite({name}) exactly once, plus a Pin-as-favorite affordance
// (pinFavorite) and a kebab exposing rename/unpin; the empty-favorites state instructs ('pin a
// favorite' / mentions `tt fav`); the rail chrome is monochrome; and window.stint exposes a
// callable for each of the five favorite channels. The scene also DRIVES a pin, a rename and
// an unpin TO COMPLETION — the pin/rename through the INLINE name affordances (typed +
// committed on Enter; Electron's renderer does not implement window.prompt, so a prompt-based
// flow would silently no-op in the packaged app, issue #52), the unpin through the kebab's
// Unpin action (unpinFavorite fires exactly once and the chip LEAVES the rail) — so every
// kebab verb is machine-scored end to end, not merely present (STATES.md Timer × edge).
// Drive the real renderer twice (seeded + empty) and machine-score the deterministic sub-facts.
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
    // Click the first row's Resume — startFavorite must fire EXACTLY once with that name.
    await page.click('.fav-card [data-act="fav-resume"]');
    await page.waitForFunction(() => Array.isArray(window.__RESUMED__) && window.__RESUMED__.length >= 1);
    const resumed = await page.evaluate(() => window.__RESUMED__);

    // PIN through the INLINE name affordance (issue #52: Electron's renderer does not
    // implement window.prompt, so the Pin control swaps into an inline field committed on
    // Enter). pinFavorite must fire with the typed name + the open-row template ref, and the
    // rail must repaint with the new chip.
    await page.click('#fav-pin');
    await page.waitForSelector('.fav-pin-form .rename-input');
    await page.fill('.fav-pin-form .rename-input', 'Invoice prep');
    await page.press('.fav-pin-form .rename-input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('#fav-rail .fav-card').length === 4);
    const pinned = await page.evaluate(() => ({
      payload: window.__PINNED__ ?? null,
      names: [...document.querySelectorAll('.fav-card .fav-name')].map((n) => n.textContent.trim()),
    }));

    // RENAME through the SAME inline affordance: kebab → Rename swaps the chip's name into
    // the inline field; Enter commits renameFavorite and the chip's NAME CHANGES in the rail.
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

    // UNPIN through the SAME kebab menu (STATES.md Timer × edge): kebab → Unpin fires
    // unpinFavorite EXACTLY once with the chip's ref and the chip LEAVES the rail — back to
    // the three seeded chips, the renamed name gone.
    await page.click('.fav-card:has-text("Client invoicing") [data-act="fav-menu"]');
    await page.click('.fav-card:has-text("Client invoicing") [data-act="fav-unpin"]');
    await page.waitForFunction(() => document.querySelectorAll('#fav-rail .fav-card').length === 3);
    const unpinned = await page.evaluate(() => ({
      calls: (window.__UNPIN_CALLS__ || []).length,
      payload: window.__UNPINNED__ ?? null,
      names: [...document.querySelectorAll('.fav-card .fav-name')].map((n) => n.textContent.trim()),
    }));

    // The empty-favorites variant: the rail paints its instructive empty state.
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

    const ok =
      probe.rows === 3 &&
      probe.names.includes('Standup') &&
      probe.names.includes('Deep work') &&
      probe.hasResume &&
      probe.hasKebab &&
      probe.hasPin &&
      probe.emptyHidden &&
      probe.callableChannels.length === 5 &&
      Array.isArray(resumed) &&
      resumed.length === 1 &&
      resumed[0] &&
      resumed[0].name === 'Standup' &&
      // The inline PIN really landed: pinFavorite fired with the typed name + the open-row
      // template, and the rail repainted with the new chip (issue #52 regression guard).
      !!pinned.payload &&
      pinned.payload.name === 'Invoice prep' &&
      pinned.payload.fromEntryId === 'open' &&
      pinned.names.includes('Invoice prep') &&
      // The inline RENAME really landed: renameFavorite fired with the new name and the
      // chip's name CHANGED in the rail (the old name is gone).
      !!renamed.payload &&
      renamed.payload.name === 'Client invoicing' &&
      renamed.names.includes('Client invoicing') &&
      !renamed.names.includes('Invoice prep') &&
      // The kebab UNPIN really landed: unpinFavorite fired exactly once with the pinned
      // chip's ref (id 93 — the pin mock's 90 + 3 seeded) and the chip LEFT the rail.
      unpinned.calls === 1 &&
      !!unpinned.payload &&
      unpinned.payload.ref === 93 &&
      unpinned.names.length === 3 &&
      !unpinned.names.includes('Client invoicing') &&
      empty.shown &&
      /pin/i.test(empty.text) &&
      /tt fav/i.test(empty.text);
    record(
      'FAVORITES_RAIL',
      ok,
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
//     --accent: white-on-tomato·9 is the prohibited 3.87:1 pair, D04);
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
      // Scan the *entire* chrome: any element painting EITHER accent-family colour as a fill
      // or text colour is a discipline break unless sanctioned (list above).
      const sanctioned = (el) =>
        el.matches('button.primary') ||
        el.closest('button.primary') ||
        el.closest('.entry.running') ||
        el.closest('.pop.running') ||
        el.closest('.pop:not(.idle)') ||
        // §12 R04: the running Active-Timer card / Entries strip — clock + state accents.
        el.closest('.timer-card.running') ||
        el.closest('.timer-strip.running') ||
        // §12 R14: the live-edit-running strip (accent border + header word while running).
        el.closest('.liveedit') ||
        // V3/D11: the "me" block's accent DRAG GRIPS (the block fill is accent-weak, border
        // accent — both unscanned; only the grip bars paint a family colour).
        el.closest('.stp-block.me .stp-resize') ||
        el.matches('.stp-grip') ||
        // D12: the active nav item's ICON only — never the chip or its label.
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
    // The floor (issue 150): every view that marks a standing primary spends its one fill.
    const standingViews = budget.filter((b) => b.view !== 'settings');
    const everyStandingViewSpendsIt = standingViews.every((b) => b.filled.length === 1);
    const budgetOk = everyViewWithinBudget && timerFillCount === 1 && everyStandingViewSpendsIt;
    record(
      'ACCENT_SOLID_BUDGET',
      budgetOk,
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
// the rest of the surfaces the same structure reaches: the Entries add form, the Clients add
// fields, the Reports builder, the RUNNING Timer view (whose standing primary is the other face of
// the same standing action, Stop), and the app's one modal — the merge-conflict prompt, which mounts
// outside the views and would otherwise leave the Entries primary lit behind its backdrop.
// Captures primary-handoff-timer.png (the sharp case) and primary-handoff-reports.png.
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
    // TIMER — idle at rest (#toggle Start), then the two forms the audit reproduced.
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

    // ENTRIES — at rest the standing Add entry carries it; the unified form's Save entry takes it.
    await page.click('.nav-item[data-view="entries"]');
    await page.waitForSelector('[data-view="entries"]:not([hidden]) #add-toggle');
    await at(page, 'entries · at rest');
    await page.click('#add-toggle');
    await page.waitForSelector('#add-form:not([hidden])');
    await at(page, 'entries · add form open');
    await page.click('#add-cancel');
    await page.waitForFunction(() => !!document.querySelector('#add-form')?.hidden);

    // CLIENTS — at rest, with a client rename open (the audit's third state), and with the
    // inline add-client field open.
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

    // REPORTS — the accent moves off the button that merely OPENS the builder onto the Save
    // that commits it.
    await page.click('.nav-item[data-view="reports"]');
    await page.waitForSelector('.reports-view:not([hidden]) #rep-new');
    await at(page, 'reports · at rest');
    await page.click('#rep-new');
    await page.waitForSelector('#rep-builder:not([hidden])');
    await page.screenshot({ path: join(EVIDENCE, 'primary-handoff-reports.png') });
    await at(page, 'reports · builder open');
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
    offenders.length === 0 && states.length === 13,
    `exactly one visible --accent-solid fill in every state (D11): ` +
      states.map((s) => `${s.state}=[${s.lit.join(', ') || 'none'}]`).join('; ') +
      `; states measured=${states.length}/13 offending states=` +
      `[${offenders.map((s) => `${s.state}:${s.lit.length}`).join(', ') || 'none'}]`,
    'primary-handoff-timer.png',
  );
}

// CLICKABILITY — §15 R-clickability / G10: ONE clickability convention across the window.
// Over the running main window, walk every clickable text affordance and assert the
// convention deterministically:
//   POSITIVE — every clickable affordance (button:not(.primary), .nav-item, .nav-link,
//     a[href], [data-act]) carries a NON-transparent background OR a visible border, so
//     none reads as bare prose. Sanctioned sub-affordances (the in-chip .chip-x, the
//     .set-toggle knob, and any control nested inside an already-bordered .chip/.seg/
//     .presets) are whitelisted — the parent IS the affordance.
//   NEGATIVE — known inert text (.wordmark, .day-head, .entry .desc, .entry .time,
//     .summary) carries NO button-like pill fill (its backgroundColor stays transparent
//     or the page/wash colour, never the var(--paper)/var(--wash) affordance fill).
//   ACCENT-PER-VIEW — ONLY the sanctioned accent-family uses carry either --accent or
//     --accent-solid: button.primary (whose FILL is --accent-solid, design.html D11/D04),
//     the running-state surfaces, and the active nav item's ICON only (D12 — the chip
//     itself is a lifted paper chip, so a nav-item accent FILL would be a break). The
//     family never leaks onto an ordinary clickable affordance, and at least one primary
//     action carries the accent-solid fill — the accent stays reserved for the view's
//     primary action(s) (the running view's Stop, mirrored on the card + toolbar, are
//     both the SAME primary Stop action).
async function sceneClickability(browser) {
  await withPage(browser, runningState(), 'index.html', async (page) => {
    await page.screenshot({ path: join(EVIDENCE, 'main-clickability.png') });
    const probe = await page.evaluate(() => {
      const { rgbOf, visible } = window.__probe;
      const accentRgb = rgbOf('--accent');
      const accentSolidRgb = rgbOf('--accent-solid');
      const isTransparent = (c) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
      // A control "carries the affordance" if it paints a non-transparent background OR a
      // visible (non-zero, non-transparent) border on at least one edge.
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
      // Sub-affordances inside an already-bordered control are whitelisted — the parent is
      // the affordance, so the inner glyph/knob need not re-carry the convention.
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
      // POSITIVE: candidate clickable affordances minus the primary (already accent-filled,
      // trivially carries the convention) and the whitelisted sub-affordances.
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
      // NEGATIVE: known inert text must NOT wear a button-like pill fill. The affordance
      // fills are var(--paper)/var(--wash); inert text stays transparent or the page bg.
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
      // ACCENT-PER-VIEW: the only elements that may paint an accent-FAMILY colour (--accent
      // or --accent-solid, as fill or text) are the sanctioned uses — button.primary (fill =
      // --accent-solid, D11), the running state, and the active nav item's ICON only (D12:
      // the chip itself is paper + shadow, so a nav-item fill would be a break). The
      // accent-solid fill must reach at least one primary action and the family never leaks
      // onto an ordinary affordance.
      const accentSanctioned = (el) =>
        el.matches('button.primary') ||
        el.closest('button.primary') ||
        el.closest('.entry.running') ||
        el.closest('.timer-card.running') ||
        // §12 R04: the Entries-view compact strip's running clock/state carry the same
        // sanctioned running-state accent as the full card (the strip mirrors the card).
        el.closest('.timer-strip.running') ||
        // D12: the active nav item's icon — and only the icon — may take the accent.
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
    // §12 R05: the start surface lives in the Timer view (the default route is Entries), so
    // route there first, then open the collapsed disclosure, fill the optional fields, submit.
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #start-toggle');
    await page.click('#start-toggle');
    await page.fill('#start-desc', 'auth refactor');
    await page.fill('#start-client', 'Acme');
    await page.fill('#start-project', 'API');
    await page.fill('#start-tags', 'deep, urgent');
    await page.uncheck('#start-bill');
    await page.screenshot({ path: join(EVIDENCE, 'main-start-form.png') });
    await page.click('#start-go');
    const started = await page.evaluate(() => window.__STARTED__);
    const ok =
      !!started &&
      started.description === 'auth refactor' &&
      started.client === 'Acme' &&
      started.project === 'API' &&
      Array.isArray(started.tags) &&
      started.tags.join(',') === 'deep,urgent' &&
      started.billable === false;
    record(
      'START_ATTRIBUTES',
      ok,
      `Start form sent: ${JSON.stringify(started)}`,
      'main-start-form.png',
    );
  });
}

// START_FORM — §12 R5: the start surface as a whole. The Start offers the inline attribute
// form (description / client / project / tags / billable) so a timer can start carrying its
// attributes immediately (the primary Start stays one-tap behind a disclosure). The surface
// is IDLE-ONLY (issue #51): while a timer runs the whole start panel (#toggle + #start-toggle
// + #start-form) is hidden, so the running Timer view offers only edit-or-stop — no Switch
// affordance either (issue #34; core's start remains the atomic stop-then-start for tt).
// The form's Billable box defaults per the §05 R07 client-keyed rule: it opens unchecked
// (no client), auto-checks when a client is typed, un-checks when it is cleared, and an
// UNTOUCHED box is omitted from the submitted payload so core derives the default — the
// same rule the one-tap #toggle start (a parameterless write) reaches in core. Two
// snapshots in one item: the idle form (startFormState) opened + its five controls present
// + the billable-default dance + an untouched submit carrying NO billable key + primary
// reads 'Start' + no #switch; and the running snapshot (runningState) where the start panel
// is HIDDEN (no visible #start-form / #start-toggle) and there is still no #switch element.
// Captures main-start-form.png (idle form) and main-start-form-running.png (running view).
async function sceneStartForm(browser) {
  await withPage(browser, startFormState(), 'index.html', async (page) => {
    // §12 R05: route to the Timer view (the start surface's home; the default route is
    // Entries), then open the disclosure and confirm every optional attribute control.
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #start-toggle');
    await page.click('#start-toggle');
    await page.waitForSelector('#start-form:not([hidden])', { state: 'attached' });
    const idle = await page.evaluate(() => {
      const form = document.querySelector('#start-form');
      const has = (id) => !!document.querySelector(`#${id}`);
      // The idle primary button reads Start (the one-tap quick start); no Switch affordance exists.
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

    // §05 R07 — the billable default TRACKS the Client field until the user touches the box:
    // typing a client checks it (client ⇒ billable), clearing the field un-checks it.
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

    // The running surface (issue #51): the start panel is HIDDEN while a timer runs — no
    // visible #start-form / #start-toggle / #toggle, only Stop + the live-edit strip — and
    // there is still no #switch element anywhere.
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
      formOk && idleLabelOk && billDefaultOk && runningOk,
      `idle start form fields=${JSON.stringify(idle)}; billable default (§05 R07): unchecked→client checks (${billWithClient})→cleared unchecks (${billCleared}), untouched submit sent ${JSON.stringify(started)}; running surface hides the start panel (only edit-or-stop)=${JSON.stringify(running)}`,
      'main-start-form.png',
    );
  });
}

// RUNNING_SINGLE_ACTION — §12 R05 (issue #51): while a timer runs, the Timer view offers
// ONLY edit-or-stop of the running entry. The whole start panel is hidden — no visible
// #start-form, #start-toggle, or one-tap #toggle — so exactly ONE Description field paints
// (the live-edit strip's #le-desc; the Details form's #start-desc is gone with its panel),
// and the only primary action is Stop beside the live-edit strip. No "start another"
// affordance exists until the running entry is stopped (core's start stays the atomic
// stop-then-start for tt and programmatic callers, §05 R01 — only the GUI surfacing of a
// start control while running is removed).
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
    const ok =
      probe.visibleDescFields === 1 &&
      probe.descFieldId === 'le-desc' &&
      probe.panelHidden &&
      !probe.startFormVisible &&
      !probe.startToggleVisible &&
      !probe.oneTapVisible &&
      probe.stopVisible &&
      probe.liveEditVisible &&
      probe.noSwitch;
    record(
      'RUNNING_SINGLE_ACTION',
      ok,
      `running Timer view offers only edit-or-stop: ${JSON.stringify(probe)}`,
      'timer-running-single-action.png',
    );
  });
}

// UNIFIED_FORM_ADD — §12 R07 (G5/G7): the manual-add surface is the ONE unified entry form in
// ADD mode, inline in the Entries view (no modal). Drive the REAL renderer end to end and assert
// the requirement's gating facts:
//   (a) opening #add-toggle reveals a two-column form — LEFT: a 3-line multiline description
//       textarea + client + project SELECTs + a tag chip host + the billable toggle; RIGHT: the
//       inline interval picker (month calendar + single-day column) over the COLLAPSED Start/Stop
//       expander (raw text fields), and the form carries NO type=datetime-local input (G1);
//   (b) the picker paints other entries gray and an overlapping span yellow (warn-only, inert);
//       accent discipline per design.html D11/V3: the "me" rectangle is the OUTLINE idiom —
//       accent-weak fill + accent border + ink labels (solid accent is reserved for primary
//       actions) — and Save entry is the view's single accent-SOLID-filled primary;
//   (c) DRAGGING the picker "me" block updates the form's start/stop state LIVE (the raw #add-from
//       /#add-to fields change, span preserved) — before any Save (G7);
//   (d) clicking Save entry is the SOLE commit — window.__ADDED__ carries the picked (post-drag)
//       fromLocal/toLocal PLUS description/client/project/tags/billable over the single `add` IPC,
//       the form closes, and the overlapping backfill raises the non-blocking overlap banner (§06 R4).
// Fails if the form is not the unified two-column form, still carries a datetime-local, the picker
// does not drive form state live, or Save is not the sole commit.
//
// The page is pinned to timezoneId 'UTC' so the pinned-clock default seed (JUDGE_NOW − 1h → now =
// 22:00–23:00 local on 2026-06-24) lands on the same local day as the seeded other-entries, making
// the gray/overlap geometry deterministic; overlap:true makes the post-save WriteAck carry the
// overlap warning the inline banner surfaces.
async function sceneUnifiedFormAdd(browser) {
  {
    const page = await newScenePage(browser, { viewport: { width: 940, height: 960 }, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.install({ time: new Date(JUDGE_NOW) });
    await page.clock.pauseAt(new Date(JUDGE_NOW));
    await page.addInitScript(initScript(JSON.stringify(addFormState()), { overlap: true }));
    await page.goto(fileUrl('index.html'));

    // Wait for the initial load() so `state` (and thus the picker's snapshotEntries) is populated
    // before the add form mounts the picker — the two seeded closed entries render as rows first.
    await page.waitForSelector('.entry', { state: 'attached' });

    // (a) open the unified add form and wait for the inline picker to mount + the client options.
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
        // LEFT column.
        descTag: desc ? desc.tagName : null,
        descRows: desc ? Number(desc.getAttribute('rows')) : null,
        clientTag: client ? client.tagName : null,
        projectTag: project ? project.tagName : null,
        hasTagChips: !!q('#add-tag-chips'),
        hasBill: !!q('#add-bill'),
        // RIGHT column: the inline picker (month calendar + single-day column) + the collapsed expander.
        pickerCal: !!q('#add-picker .stp-cal .stp-grid .stp-d'),
        pickerTrack: !!q('#add-picker .stp-track'),
        pickerHours: q('#add-picker') ? q('#add-picker').querySelectorAll('.stp-hour').length : 0,
        pickerMe: !!q('#add-picker .stp-block.me'),
        expanderCollapsed: !!timesToggle && timesToggle.getAttribute('aria-expanded') === 'false' && !!timesBody && timesBody.hidden,
        startText: from ? from.getAttribute('type') : null,
        stopText: to ? to.getAttribute('type') : null,
        // G1: no native datetime-local anywhere on the form.
        noDatetimeLocal: form ? form.querySelectorAll('input[type="datetime-local"]').length === 0 : false,
      };
    });

    // (b) other entries gray + an overlapping span yellow (warn-only, inert); accent facts —
    // design.html D11 / V3: the "me" block is the OUTLINE idiom (accent-weak fill + an accent
    // border + ink labels; solid accent is reserved for primary actions), and Save entry is
    // the view's single accent-SOLID primary. The retired solid-accent me-fill would fail
    // meWeakFill; a Save painted raw --accent (white-on-tomato·9, the prohibited pair) would
    // fail saveSolid.
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
        // V3: accent-weak fill + a ≥1px accent border — the outline idiom, not a solid fill.
        meWeakFill: meCs.backgroundColor === accentWeakRgb,
        meAccentBorder: meCs.borderTopColor === accentRgb && parseFloat(meCs.borderTopWidth) >= 1,
        // The block's time labels stay INK (accent-ink on accent-weak is the prohibited pair).
        meInkLabels: !meLab || getComputedStyle(meLab).color === inkRgb,
        // D11: Save entry is the single accent-solid-filled primary of the view.
        saveSolid: getComputedStyle(document.querySelector('#add-go')).backgroundColor === accentSolidRgb,
      };
    });

    // (c) DRAG the "me" body up ~60px → both start+stop move together, 5-min snapped, LIVE into the
    // raw #add-from/#add-to fields (the form's start/stop state) — before any Save (G7).
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

    // (d) fill the attribute fields, then Save entry (the SOLE commit).
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
    const ok =
      layoutOk &&
      paintOk &&
      liveUpdate &&
      savePatch &&
      commit.formClosed &&
      commit.bannerVisible &&
      /overlap/i.test(commit.bannerText);
    record(
      'UNIFIED_FORM_ADD',
      ok,
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
// Drive the REAL renderer end to end and assert the requirement's gating facts:
//   (a) the expander is COLLAPSED by default — the raw Start/Stop text fields are hidden
//       (#add-times-body[hidden], toggle aria-expanded=false) while a tabular ECHO of the current
//       interval is shown beneath the calendar (.stp-echo, e.g. "22:00 – 23:00");
//   (b) clicking the toggle REVEALS the two raw type=text fields (#add-from/#add-to, NOT native
//       datetime-local, G1);
//   (c) TYPING an overnight span (start 2026-06-24 22:00, stop 2026-06-25 02:00) into those fields
//       feeds the ONE shared interval state — the picker column reflects the typed START (the "me"
//       block sits at 22:00) and the collapsed echo reflects the typed cross-midnight span
//       ("22:00 – 02:00"), while the raw stop field keeps the next-day value verbatim (authoritative,
//       never flattened to same-day);
//   (d) Save entry is the SOLE commit — window.__ADDED__ carries those EXACT overnight
//       fromLocal/toLocal over the single `add` IPC (parity with `tt add --from --to`).
// Fails if the expander fields don't feed the shared interval (the picker/echo stay stale), Save
// reads a stale picker-only value, or the overnight stop is dropped / coerced to the start's day.
//
// Pinned to timezoneId 'UTC' so the pinned-clock default seed (JUDGE_NOW − 1h → 22:00 on
// 2026-06-24) is a deterministic local instant, and the typed 22:00/02:00 map to fixed column
// geometry (720px/24h track → 22:00 = 660px from the track top).
async function sceneUnifiedFormExpander(browser) {
  {
    const page = await newScenePage(browser, { viewport: { width: 940, height: 960 }, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.install({ time: new Date(JUDGE_NOW) });
    await page.clock.pauseAt(new Date(JUDGE_NOW));
    await page.addInitScript(initScript(JSON.stringify(addFormState())));
    await page.goto(fileUrl('index.html'));
    await page.waitForSelector('.entry', { state: 'attached' });

    // (a) open the add form; the inline picker mounts with its collapsed interval echo.
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

    // (b) expand the Start/Stop expander → the two raw text fields are revealed.
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

    // (d) Save entry is the sole commit — __ADDED__ carries the EXACT typed overnight span.
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
    const ok = collapsedOk && fieldsOk && reflectedOk && savedOk;
    record(
      'UNIFIED_FORM_EXPANDER',
      ok,
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
// column — in the view flow (no modal / backdrop / dialog chrome; position:static). The scene
// asserts host identity explicitly: open add mode + record its host, open edit mode + assert the
// edit form mounts in that very same element, and the edited calendar event carries the .editing
// selection state (its content preserved). Drive the real renderer: both a click on the
// entry AND its Edit affordance open it; it seeds EVERY tt-editable field from the entry
// (multiline description textarea, client + project selects pre-selected, tag chips, billable
// checkbox, and the Start/Stop expander's Start+Stop), Save sends a patch of ONLY the changed
// fields over `edit`, and the edit-mode FOOTER carries a Split control plus a two-step Delete
// gate that ARMS (a worded confirm appears, nothing removed) then CONFIRMS (remove fires with
// the entry id). Fails if edit mode is a modal, omits a seeded field, or the footer lacks Split
// or the two-step Delete gate.
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
      // The edit form and the add form share the SAME host element, in flow (not a positioned overlay).
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
        // The form is in the shared view-level host (not inside the calendar event) and carries the
        // edited entry's id; the event it edits carries the .editing selection state.
        inContext: !!form && form.parentElement?.id === 'entry-form-host' && form.dataset.id === '80' &&
          document.querySelector('.entry[data-id="80"]')?.classList.contains('editing') === true,
        // No modal chrome anywhere, and the form host is in normal flow (not a positioned overlay).
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
        // The edit-mode footer's two reachability controls.
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
    // Bottom .stp-resize drag down ~30px (+60min snapped) — ONLY .edit-end advances; .edit-start holds.
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

    // (c) Save commits ONLY the changed fields: amend the description, then Save entry.
    await page.fill(`${editForm} .edit-desc`, 'final draft');
    await page.click(`${editForm} button[type="submit"]`);
    await page.waitForFunction(() => !!window.__EDITED__);
    const edited = await page.evaluate(() => window.__EDITED__);

    // (d) The footer's two-step Delete gate: re-open, arm (a worded confirm appears in the form
    // footer, nothing removed yet), then confirm (remove fires with the entry id).
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
    // Reversible: subtracting again restores — the struck raw duration goes away.
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
    // Reopen and drag the bottom stop grip: the DRAGGED handle — and only it — snaps to :05.
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
    // Save patched ONLY the changed field (description), nothing else.
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
    // §12 R06/G5 — add + edit mount in the SAME view-level host, in flow (no modal).
    const hostShared = addHostIsFormHost && sameHost;
    const ok = hostShared && clickOpens && seeded && pickerOk && footer && savePatch && deleteGate && overlapDetailOk && sleptOk && exactTimesOk;
    record(
      'UNIFIED_FORM',
      ok,
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
// VERBATIM (not flattened to one line). Open the multiline entry's edit form and assert the
// .edit-desc control is a textarea with rows=3, is vertically scrollable (overflow-y:auto), and
// its .value contains the seeded interior '\n' byte-for-byte.
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
    const ok =
      probe.present &&
      probe.tag === 'TEXTAREA' &&
      probe.rows === 3 &&
      probe.value === 'line one\nline two' &&
      probe.hasInteriorNewline &&
      (probe.overflowY === 'auto' || probe.overflowY === 'scroll');
    record(
      'MULTILINE_DESC',
      ok,
      `description control is a 3-line scrollable textarea rendering the stored newline verbatim: ${JSON.stringify(probe)}`,
      'main-multiline-desc.png',
    );
  });
}

// OVERLAP_BANNER — a write that creates an overlap surfaces a non-blocking inline
// banner AT THE MOMENT of the edit, not only the per-row flag (§06 R4, §12). Drive the
// closed row's inline Edit and Save; the overlap-returning write mock makes the renderer
// raise #overlap-banner with overlap wording, announced via role=status. The write still
// committed — the banner is advisory, allowed-but-flagged.
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
      const ok =
        beforeHidden &&
        probe.visible &&
        /overlap/i.test(probe.text) &&
        probe.role === 'status' &&
        probe.ariaLive === 'polite';
      record(
        'OVERLAP_BANNER',
        ok,
        `overlap write raises inline banner (hidden before=${beforeHidden}): ${JSON.stringify(probe)}`,
        'main-overlap-banner.png',
      );
    },
    { overlap: true },
  );
}

// SPLIT_AFFORDANCE — a CLOSED entry exposes a discoverable Split control wired to the
// split capability; the open/running entry does not (§06 R2: only a bounded span can
// be cut). Drive the inline picker on the closed row and assert it calls the split IPC
// with a UTC instant; assert the open row has no Split control at all.
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
      // No horizontal overlap between the ops chip and the corner checkbox, and the chip stays
      // inside its day column.
      const noOverlap = !!chip && !!ck && (chip.left >= ck.right || ck.left >= chip.right);
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
    const ok =
      before.closedHasSplit &&
      !before.openHasSplit &&
      geom.noOverlap &&
      geom.chipInColumn &&
      splitForm.splitInputIsText &&
      splitForm.noDatetimeLocal &&
      !!split &&
      split.id === 30 &&
      typeof split.atUtc === 'string' &&
      Date.parse(split.atUtc) > Date.parse('2026-06-24T09:00:00Z') &&
      Date.parse(split.atUtc) < Date.parse('2026-06-24T11:00:00Z');
    record(
      'SPLIT_AFFORDANCE',
      ok,
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
      contained && chromed && unoccluded,
      `split picker (first column) ${JSON.stringify(split)}; delete confirm (last column) ${JSON.stringify(confirm)}`,
      'main-inline-gate.png',
    );
  });
}

// WRITE_REJECTION_FEEDBACK — §12 R21: a refused core write is surfaced WHERE it was attempted,
// never silently swallowed. Driving the REAL renderer over a STRICT-rejecting mock (the
// strict-listEntries precedent, issue #55 — `rejectWrites` makes edit/split/rename/toggle reject
// with a StoreError-shaped message), assert each site catches-and-displays: the form stays OPEN
// and an ANNOUNCED (role=status + aria-live) message region carries the reason (the Stop/toggle
// rejection routes to the banner area). Folds four facts — edit-mode Save, split confirm, inline
// rename, Stop/toggle. Captures main-edit-reject.png as the rubric evidence.
async function sceneWriteRejectionFeedback(browser) {
  {
    // (a) EDIT-MODE SAVE — open the unified editor, change a field, Save: the `edit` IPC rejects,
    // and the editor stays open with the reason in the announced .ef-warning region (never closed,
    // never a silent no-op). window.__EDITED__ stays unset — the refused write recorded nothing.
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

    // (b) SPLIT CONFIRM — open the inline split picker on a closed row and confirm: the `split`
    // IPC rejects (in-span rule) and the picker stays open with the reason in .split-warning.
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

    // (c) INLINE RENAME — rename a client to a fresh name: the `renameClient` IPC rejects (a name
    // collision, §13) and the inline rename form stays open with the reason in .rename-warning.
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
          // The Timer-view region is visible (in the active view), announced, carries the reason.
          timerShown: !!t && !t.hidden && (rect?.width ?? 0) > 0 && (rect?.height ?? 0) > 0 && t.textContent.trim().length > 0,
          timerAnnounced: t?.getAttribute('role') === 'status' && t?.hasAttribute('aria-live'),
          message: t?.textContent.trim() ?? '',
          // The Entries-view banner mirrors it (block chrome) for that context.
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

    const ok =
      editReject.formOpen && editReject.shown && editReject.announced && editReject.notWritten &&
      splitReject.formOpen && splitReject.shown && splitReject.announced && splitReject.notWritten &&
      renameReject.formOpen && renameReject.shown && renameReject.announced && renameReject.notWritten &&
      toggleReject.timerShown && toggleReject.timerAnnounced && toggleReject.bannerMirrors &&
      copyOk;
    record(
      'WRITE_REJECTION_FEEDBACK',
      ok,
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

  const page = await newScenePage(browser, { viewport: { width: 940, height: 960 }, colorScheme: 'light', timezoneId: 'UTC' });
  await page.clock.install({ time: new Date(JUDGE_NOW) });
  await page.clock.pauseAt(new Date(JUDGE_NOW));
  await page.addInitScript(initScript(JSON.stringify(addFormState()), { rejectWrites: true }));
  await page.goto(fileUrl('index.html'));
  await page.waitForSelector('.entry', { state: 'attached' });
  await noMotion(page); // a paint assertion reads the cascade, never a frozen mid-transition frame

  // (a) REFUSED SAVE — the `add` IPC rejects like core refusing an inverted span, and the form
  // holds its ground: open, announced, nothing written, and painted as the BLOCK it is.
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

  // (c) THE ADVISORY SIBLING — the same form, a backfill that COMMITS onto an overlapping span:
  // the write landed, so its inline banner is the --flag advisory, never the block palette.
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
  const ok =
    refused.formOpen && refused.shown && refused.announced && refused.notWritten &&
    refused.message === 'stop time must be after start time' && readsClean(refused.message) &&
    refusalReadsDanger &&
    advisoryChromeIntact &&
    advisory.shown && advisory.written && /allowed, but flagged/i.test(advisory.text) &&
    advisoryReadsFlag &&
    palettesDiffer;
  record(
    'ADD_REFUSAL_PALETTE',
    ok,
    `refused save=${JSON.stringify(refused)} (danger=${refusalReadsDanger}); reopened=${JSON.stringify(reopened)} ` +
      `(flag base intact=${advisoryChromeIntact}); overlap advisory=${JSON.stringify(advisory)} (flag=${advisoryReadsFlag}); ` +
      `palettes differ=${palettesDiffer}`,
    'add-refusal-palette.png',
  );
}

// MERGE_CONFLICT — selecting two-plus contiguous CLOSED entries reveals the merge
// SELECTION BAR (design.html D11 / V5): a quiet bar ABOVE the calendar whose raised-chip
// count pill reads "N selected" and whose Merge action is a NEUTRAL small button — never
// .primary, because the Entries view's single accent-solid primary is the add form's Save
// entry. Merging entries that DISAGREE on client/billable raises the conflict prompt
// offering the distinct client choices and a billable choice BEFORE committing
// (§06 R3, §12 R6). The prompt is hosted in app.js — the `.editor.conflict-prompt` modal.
// The renderer sends no clientId/projectId — the winning entry's id (winnerId) plus the
// chosen billable go to the main process, which resolves the names. (The selection surface
// moves to the calendar's hover-corner checkboxes when §12 R16's `.ev` events land; until
// then it is driven from the entry rows' `.sel` checkboxes, which app.js still paints.)
//
// The scene closes on the modal's KEYBOARD EXIT (issue 147): the app's only modal ignored
// Escape, so a keyboard user mid-merge had no way out of it — craft checklist §4, "Esc
// closes/cancels the innermost thing". The guard lives here rather than in a scene of its own
// because it is the same prompt on the same fixture, and it is scored on the OUTCOME (gone AND
// unmerged), which is what separates a cancel from a silent confirm.
async function sceneMergeConflict(browser) {
  await withPage(browser, mergeConflictState(), 'index.html', async (page) => {
    // The action bar is hidden with nothing (or one entry) selected.
    const barHiddenInitially = await page.evaluate(() => !!document.querySelector('#merge-bar')?.hidden);
    await page.check('.entry[data-id="40"] .sel');
    const barHiddenWithOne = await page.evaluate(() => !!document.querySelector('#merge-bar')?.hidden);
    await page.check('.entry[data-id="41"] .sel');
    // V5: with 2 selected the selection bar shows ABOVE the calendar host, its #merge-count
    // pill reads "2 selected", and #merge-go is present labelled "Merge" WITHOUT .primary
    // (a neutral small button — an accent-filled "Merge N entries" primary would fail all three).
    const barWithTwo = await page.evaluate(() => {
      const bar = document.querySelector('#merge-bar');
      const count = bar?.querySelector('#merge-count');
      const go = bar?.querySelector('#merge-go');
      return {
        shown: !!bar && !bar.hidden,
        aboveCalendar: !!bar && bar.nextElementSibling?.id === 'entries',
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
    // Click Merge: the selection disagrees, so the app.js-hosted conflict prompt must appear
    // rather than a silent merge.
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
        // Both distinct clients in the selection are offered as winners…
        offersClientA: clientLabels.some((l) => /Client A/.test(l)),
        offersClientB: clientLabels.some((l) => /Client B/.test(l)),
        clientChoiceCount: clientOpts.length,
        // …and a billable choice is offered (the selection disagrees on it too).
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
    const ok =
      barHiddenInitially &&
      barHiddenWithOne &&
      barShownWithTwo &&
      probe.promptShown &&
      probe.offersClientA &&
      probe.offersClientB &&
      probe.clientChoiceCount === 2 &&
      probe.offersBillable &&
      // The prompt appeared BEFORE any merge committed (no payload sent yet).
      !probe.merged &&
      escapeCancels;
    record(
      'MERGE_CONFLICT',
      ok,
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
// choice in two groups. Deterministic sub-facts:
//   • CHOSEN LIFTS — every `.mc-opt.on` computes the `--paper` fill plus a non-none box-shadow;
//   • UNCHOSEN SINKS — every unchosen peer is flat (box-shadow none) and NOT paper, so the lift
//     is a measured contrast rather than a shadow nobody can see;
//   • NO ACCENT ANYWHERE IN THE PROMPT — no `.mc-opt` (chosen or not) and no radio mark paints an
//     accent-family colour as fill, gradient, border or shadow, and the whole modal paints ZERO
//     `--accent-weak` fills;
//   • THE CHIP FOLLOWS THE CHOICE — clicking the other client option moves `.on`, and with it the
//     paper fill and the lift, onto the newly chosen row and off the old one;
//   • COLOUR IS NOT THE SOLE CUE (A05/D05) — the chosen row's radio dot renders, the unchosen
//     rows' do not, so the filled-vs-empty shape carries the state on its own.
// Captures merge-choice-lift.png.
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
    // The chip must FOLLOW the choice: pick the other client and re-read.
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
    // The clicked peer now carries the chip, and the previously chosen client row has given it up.
    const followsOk =
      second.chosenNotPaper === 0 &&
      second.chosenNotLifted === 0 &&
      second.peersLifted === 0 &&
      second.accentedOpts.length === 0 &&
      JSON.stringify(second.chosenLabels) !== JSON.stringify(first.chosenLabels);
    record(
      'MERGE_CHOICE_LIFT',
      shapeOk && liftOk && noAccentOk && dotOk && followsOk,
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
    const ok =
      !probe.conflictPromptShown &&
      !probe.gapConfirmShown &&
      !!probe.merged &&
      Array.isArray(probe.merged.ids) &&
      probe.merged.ids.length === 2 &&
      probe.merged.winnerId === undefined &&
      probe.merged.allowGap === undefined;
    record(
      'MERGE_NOCONFLICT',
      ok,
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
    // The gap gate arms in place of a silent fold: a .confirm-gap affordance, no merge yet.
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
        // Nothing committed yet — a stray first click fabricates no billable time.
        merged: window.__MERGED__,
      };
    });
    // The explicit confirm commits the fold WITH the gap acknowledged.
    await page.click('[data-act="confirm-gap"]');
    const after = await page.evaluate(() => ({ merged: window.__MERGED__ }));
    const ok =
      armed.confirmShown &&
      armed.namesGap &&
      armed.statesSpan &&
      armed.statesGapDuration &&
      armed.hasConfirmBtn &&
      armed.hasCancelBtn &&
      !armed.merged &&
      !!after.merged &&
      Array.isArray(after.merged.ids) &&
      after.merged.ids.length === 2 &&
      after.merged.allowGap === true;
    record(
      'MERGE_GAP',
      ok,
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
    const ok = probe.confirmShown && probe.confirmText && probe.confirmBtn && !probe.removed;
    record('DELETE_CONFIRM', ok, `delete arms a confirm step, no immediate remove: ${JSON.stringify(probe)}`, 'main-edit.png');
  });
}

// CONFIRM_DELETE — §12 R13: destructive actions confirm in the window. A single Delete
// click must surface an in-window confirm and must NOT destroy the entry; only the
// explicit confirm tap removes it, exactly once. Drive the real renderer: click the row's
// Delete, assert (a) the inline confirm appears (the generic .confirm gate with a
// confirm-delete + cancel-delete control), (b) the instrumented window.stint.remove was
// NOT called by that first click (__REMOVE_CALLS__ stays empty — a stray click is safe),
// and (c) clicking the confirm button fires remove exactly once, carrying the entry id.
async function sceneConfirmDelete(browser) {
  await withPage(browser, editingState(), 'index.html', async (page) => {
    const editRow = '.entry[data-id="20"]';
    await page.click(`${editRow} [data-act="delete"]`);
    // The arming click only swaps in the confirm affordance — no removal yet.
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
    // Only the explicit confirm fires remove — exactly once, with the entry id.
    await page.click(`${editRow} [data-act="confirm-delete"]`);
    await page.waitForFunction(() => (window.__REMOVE_CALLS__ || []).length > 0);
    const confirmed = await page.evaluate(() => ({
      removeCalls: (window.__REMOVE_CALLS__ || []).slice(),
    }));
    const ok =
      armed.confirmShown &&
      armed.confirmBtn &&
      armed.cancelBtn &&
      armed.removeCallsAfterArm === 0 && // the stray first click destroyed nothing
      confirmed.removeCalls.length === 1 && // confirm removed exactly once
      confirmed.removeCalls[0] &&
      confirmed.removeCalls[0].id === 20;
    record(
      'CONFIRM_DELETE',
      ok,
      `single Delete click surfaces a confirm and does not remove (calls after arm=${armed.removeCallsAfterArm}); ` +
        `only the explicit confirm removes, exactly once: ${JSON.stringify(confirmed.removeCalls)}`,
      'main-confirm-delete.png',
    );
  });
}

// CONFIRM_DESTRUCTIVE — §17 R11: destructive actions confirm before acting. The §17
// framing of the gate, captured as its own evidence: a single Delete click must surface
// the in-window confirm and the entry must STILL BE PRESENT (no destroy on a stray click);
// only the explicit confirm removes it, after which the entry is GONE from the list. The
// remove mock drops the entry from the snapshot, so the post-confirm reload reflects the
// real deletion — present pre-confirm, absent post-confirm, never on the bare first click.
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
        // The entry is STILL PRESENT after the arming click — nothing destroyed yet.
        stillPresent: !!document.querySelector('.entry[data-id="20"]'),
        removeCallsAfterArm: (window.__REMOVE_CALLS__ || []).length,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-confirm.png') });
    // Only the explicit confirm removes — after which the row is gone from the list.
    await page.click(`${editRow} [data-act="confirm-delete"]`);
    await page.waitForFunction(() => !document.querySelector('.entry[data-id="20"]'));
    const after = await page.evaluate(() => ({
      goneAfterConfirm: !document.querySelector('.entry[data-id="20"]'),
      removeCalls: (window.__REMOVE_CALLS__ || []).slice(),
    }));
    const ok =
      presentBefore &&
      armed.confirmShown &&
      armed.confirmBtn &&
      armed.cancelBtn &&
      armed.stillPresent && // present after the stray first click…
      armed.removeCallsAfterArm === 0 && // …and nothing removed by it
      after.goneAfterConfirm && // gone only after the explicit confirm…
      after.removeCalls.length === 1 && // …which removed exactly once
      after.removeCalls[0] &&
      after.removeCalls[0].id === 20;
    record(
      'CONFIRM_DESTRUCTIVE',
      ok,
      `Delete confirms before acting: present pre-confirm=${armed.stillPresent} (remove calls=${armed.removeCallsAfterArm}); ` +
        `gone post-confirm=${after.goneAfterConfirm}, removed once: ${JSON.stringify(after.removeCalls)}`,
      'main-confirm.png',
    );
  });

  // (SWITCH_AFFORDANCE removed — issue #34. Switch is gone: Start is the atomic stop-then-start,
  // so there is no dedicated Switch control to assert. The popover/timer items above now assert
  // Switch's ABSENCE — no #switch / #timer-switch element survives in any run state — and the
  // running-popover / running-main stills they shared are captured in TRAY_POPOVER_SURFACE
  // (popover-running.png) and ACCENT_DISCIPLINE (main-running.png).)
}

// CLIENTS_VIEW — the Clients nav view lists active clients with their projects nested,
// and offers create/rename/archive in place; archived items drop out of the active list
// (history kept). Click the Clients nav, assert the clients/projects render with the
// rename + archive affordances, that accent discipline holds on the chrome, and that every
// visible icon-only affordance carries an accessible name (design.html D16, machine-gated)
// (§07, §12). The mutators are wired to the same IPC tt's client/project subcommands use.
// The create affordances are DRIVEN, not merely present (issue #48: a duplicate
// id="add-client" dead-ended the "+ Add client" button while every presence-only check
// passed): the scene clicks "+ Add client" and asserts the inline "New client" field
// opens, types a name, and asserts the new client LANDS in the active list off the
// addClient → re-render round trip — then does the same for "+ Add project" (under a
// client row) and "+ Add tag" (the tag strip), asserting each payload over the IPC.
// A second, EMPTY-REFERENCE-DATA page (STATES.md Clients × empty, the emptyRefData
// fixture knob) asserts the never-populated view instructs instead of blanking: the
// "No clients yet" copy mentions `tt client add` and the "No tags yet" copy mentions
// `tt tag add` (app.js renderClients/renderTags empty branches).
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
      // Acme's row carries its two projects nested under it (the project sub-list).
      const acme = clients.find((c) => c.querySelector('.client-name')?.textContent?.trim() === 'Acme');
      const acmeProjects = acme
        ? [...acme.querySelectorAll('.project[data-id] .project-name')].map((p) => p.textContent.trim())
        : [];
      // Rename + Archive affordances are present on a client row and on a project row.
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
    // Drive the create flows end to end (issue #48). (1) "+ Add client": the click opens
    // the inline "New client" field (the fact the duplicate-id bug broke — the button was
    // a getElementById no-op), typing a name and committing sends { name } over addClient
    // and the re-render lands the new client in the active list.
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

    // The EMPTY-REFERENCE-DATA variant (STATES.md Clients × empty): with no clients, no
    // projects and no tags ever created, the view paints BOTH instructive empty states —
    // each naming its `tt` twin — never a blank pane.
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
      // Enter the view at its first control and Tab until focus leaves it again.
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

    const ok =
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
      // …and the D16 accessible-name fact: every visible icon-only affordance is named.
      probe.unnamedIconButtons.length === 0 &&
      // …and the DRIVEN create facts (issue #48): each inline field opened (the waits above
      // would have thrown otherwise), each payload went over the IPC, and each created item
      // landed in its active list.
      created.addedClient?.name === 'Initech' &&
      created.clientNames.includes('Initech') &&
      created.addedProject?.name === 'Mobile' &&
      created.addedProject?.clientId === 1 &&
      created.acmeProjects.includes('Mobile') &&
      created.addedTag?.name === 'billing' &&
      created.tagNames.includes('billing') &&
      // …and the NO-DOUBLE-RENDER facts (issue #66): after the rename/archive writes, every
      // record renders exactly once (no duplicate data-id) and the counts/names track the
      // mutated active list — Acme→Acme Corp, Globex archived (Acme Corp + Initech remain, with
      // Acme's 3 projects), the "urgent" tag archived (deep + billing remain).
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
      !norace.tagNames.includes('urgent') &&
      // …and the EMPTY-REFERENCE-DATA facts (STATES.md Clients × empty): zero rows with both
      // instructive copies painting, each naming its `tt` twin.
      refEmpty.clientRows === 0 &&
      refEmpty.tagRows === 0 &&
      /No clients yet/.test(refEmpty.clientsText) &&
      /tt client add/.test(refEmpty.clientsText) &&
      /No tags yet/.test(refEmpty.tagsText) &&
      /tt tag add/.test(refEmpty.tagsText) &&
      // …and the FOCUS-ORDER fact (issue 161): the Tab-walk over the archived-inclusive view
      // advances in reading order at every step. The stop floor guards the guard — a walk that
      // has gone blind (a selector rename, a view that never routed) finds nothing to disorder
      // and would otherwise pass vacuously.
      focusOrder.stopCount >= 15 &&
      focusOrder.backwards.length === 0;
    // Accent discipline (D16 — the whole view chrome is monochrome; icons take accent only
    // when their item is active) is judged visually against the mock, not gated on a
    // computed-style scan (issue #25) — the offender list is kept in the justification as
    // captured evidence only. The D16 accessible-name fact IS machine-gated above.
    record(
      'CLIENTS_VIEW',
      ok,
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
// history, so it is destructive and takes the same two-step gate as Delete. Drive the real
// renderer: click the referenced Acme client's Archive, assert (a) the inline .confirm-archive
// gate appears (a confirm-archive + cancel-archive control) and Acme is STILL listed, (b) the
// instrumented archiveClient was NOT called by that first click (__ARCHIVE_CLIENT_CALLS__ empty
// — a stray click archives nothing), and (c) the explicit confirm archives exactly once, with
// Acme's id, after which Acme detaches. (An UNREFERENCED client archives directly — that path
// is the Globex archive the CLIENTS_VIEW scene drives.)
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
    const ok =
      armed.confirmShown &&
      armed.confirmBtn &&
      armed.cancelBtn &&
      armed.stillListed &&
      armed.archiveCallsAfterArm === 0 && // the stray first click archived nothing
      confirmed.archiveCalls.length === 1 && // the confirm archived exactly once
      confirmed.archiveCalls[0] &&
      confirmed.archiveCalls[0].id === 1;
    record(
      'CONFIRM_ARCHIVE',
      ok,
      `archiving a referenced client arms a confirm and does not archive (calls after arm=${armed.archiveCallsAfterArm}); ` +
        `only the explicit confirm archives, exactly once: ${JSON.stringify(confirmed.archiveCalls)}`,
      'main-confirm-archive.png',
    );
  });
}

// RESTORE_ARCHIVED — §12 R13: archive is a REVERSIBLE hide. Archived records are out of the
// active list by default; a "Show archived" toggle reveals them (with an "archived" pill) each
// carrying a Restore button, and Restore returns the record to the active list. Drive the real
// renderer: assert the archived client/tag are hidden by default, reveal them, and Restore the
// archived client — asserting the restoreClient payload and that it lands back active.
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
    // Restore the archived client → it moves back into the active list (no longer .archived).
    await page.click('#clients .client.archived[data-id="3"] [data-act="restore-client"]');
    await page.waitForFunction(
      () => !!document.querySelector('#clients .client[data-id="3"]:not(.archived)'),
    );
    const restored = await page.evaluate(() => ({
      restoredPayload: window.__RESTORED_CLIENT__ || null,
      nowActive: !!document.querySelector('#clients .client[data-id="3"]:not(.archived)'),
    }));
    const ok =
      !before.archivedClientShown &&
      !before.archivedTagShown &&
      revealed.archivedClientRestore &&
      revealed.archivedTagRestore &&
      revealed.pill &&
      restored.restoredPayload &&
      restored.restoredPayload.id === 3 &&
      restored.nowActive;
    record(
      'RESTORE_ARCHIVED',
      ok,
      `archived records hidden by default (${JSON.stringify(before)}), revealed with a Restore ` +
        `button on "show archived" (${JSON.stringify(revealed)}), and Restore returns the client ` +
        `to the active list: ${JSON.stringify(restored)}`,
      'main-clients-archived.png',
    );
  });
}

// TAG_CHIPS — an entry's tags show in-context as monochrome chips on its calendar event, and the
// running entry's tags show on the summary line (§07, §12). There is NO per-row Edit-tags control
// (DELETED, #43) — tags are edited in the UNIFIED FORM's chip editor (§12 R06/G6). This scene
// asserts both: (a) the display — the fixture's open event carries 2 tags and its closed event 1,
// so the events paint exactly 3 chips, plus the 2 on the running summary, each tag's text visible;
// and (b) the capability — open the closed entry's unified form, REMOVE a tag chip and ADD a new
// one in the form's chip editor, Save, and the `edit` patch carries the minimal
// addTags/removeTags (and touches ONLY tags). Fails if a per-row tags control survives, or the
// form's chip editor cannot add + remove a tag over the one `edit` commit.
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
        // The retired per-row Edit-tags control must NOT survive on any event (tags edit in the form).
        noPerRowTags: !document.querySelector('[data-act="tags"]'),
        totalRowChips: document.querySelectorAll('#entries .chip').length,
      };
    });

    // (b) Edit tags THROUGH the unified form: open the closed entry (71, tagged 'meeting'), then in
    // the form's chip editor remove 'meeting' and add 'billing', and Save.
    await page.hover('.entry[data-id="71"]');
    await page.click('.entry[data-id="71"] [data-act="edit"]');
    await page.waitForSelector('.edit-form.entry-form .ef-tag-chips', { state: 'attached' });
    const seededChips = await page.evaluate(() =>
      [...document.querySelectorAll('.edit-form .ef-tag-chips .chip')].map((c) => c.textContent.replace('×', '').trim()),
    );
    // Remove the 'meeting' chip via its in-chip × affordance.
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('.edit-form .ef-tag-chips .chip')].find((c) => /meeting/.test(c.textContent));
      chip?.querySelector('.chip-x')?.click();
    });
    // Add 'billing' through the form's add input.
    await page.fill('.edit-form .ef-tag-add', 'billing');
    await page.press('.edit-form .ef-tag-add', 'Enter');
    const workingChips = await page.evaluate(() =>
      [...document.querySelectorAll('.edit-form .ef-tag-chips .chip')].map((c) => c.textContent.replace('×', '').trim()),
    );
    await page.click('.edit-form button[type="submit"]');
    await page.waitForFunction(() => !!window.__EDITED__);
    const edited = await page.evaluate(() => window.__EDITED__);

    const patch = (edited && edited.patch) || {};
    // Save patched ONLY the tags: added 'billing', removed 'meeting', and nothing else rode along.
    const tagsPatchOk =
      !!edited &&
      edited.id === 71 &&
      Array.isArray(patch.addTags) && patch.addTags.join(',') === 'billing' &&
      Array.isArray(patch.removeTags) && patch.removeTags.join(',') === 'meeting' &&
      Object.keys(patch).sort().join(',') === 'addTags,removeTags';
    const ok =
      probe.openRowChips.join(',') === 'deep,urgent' &&
      probe.closedRowChips.join(',') === 'meeting' &&
      probe.summaryChips.join(',') === 'deep,urgent' &&
      probe.noPerRowTags &&
      // 2 (open event) + 1 (closed event) = 3 chips painted across the entries.
      probe.totalRowChips === 3 &&
      seededChips.join(',') === 'meeting' &&
      workingChips.join(',') === 'billing' &&
      tagsPatchOk;
    record(
      'TAG_CHIPS',
      ok,
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
// the sidebar is present). This one scene drives the REAL index.html Reports view under the
// pinned JUDGE clock with the savedReportsState fixture and folds five facts into one pass:
//   (a) the saved-definition list paints ONE card per saved def with its name + spec summary
//       and Run / Edit affordances;
//   (b) clicking + New report (and Edit) opens the inline builder with name / range / group-by
//       / filter / rounding controls;
//   (c) clicking Run paints the grouped run-output summary with overlap + unreviewed-sleep
//       flags ON the affected rows (reusing the REPORT_SUMMARY shape) plus the resolved-range
//       header;
//   (d) Export CSV / Export JSON drive a real exportEntries call carrying the saved ref;
//   (e) the sidebar nav is present with Reports active;
//   (f) §09 R01 (G3): the builder's CUSTOM range is a pair of PLAIN DATES — the two range
//       inputs are type="date" (zero datetime-local anywhere in the builder), the Custom…
//       chip reveals them, and saving a filled custom def fires a saveReport whose captured
//       rangeSpec is exactly { kind:'absolute', fromDate, toDate } (raw YYYY-MM-DD strings,
//       no time component, no 'T'), with the new card's spec summary printing the date pair;
//   (g) issue #52: the card kebab RENAMES and DELETES a saved def TO COMPLETION through the
//       INLINE affordances (an in-place Rename / Delete menu, the shared inline name field
//       committed on Enter, and the generic §12 R13 confirm gate) — Electron's renderer
//       implements neither window.prompt nor window.confirm, so these must be inline — with
//       renameReport / removeReport firing and the list updating each time;
//   (h) STATES.md Reports × empty: a second page with ZERO saved defs (the savedReports:[]
//       fixture knob) paints the visible #rep-defs-empty state reading "No saved reports
//       yet." with no cards — never a blank list.
// Captures reports-list.png (the saved-defs list + builder), reports-run.png (the run
// output) and reports-empty.png (the zero-defs state) for rubric review.
async function sceneReportsView(browser) {
  await withPage(browser, savedReportsState(), 'index.html', async (page) => {
    // Route to the Reports view (the shell router; no IPC) and wait for the saved-defs list.
    await page.click('.nav-item[data-view="reports"]');
    await page.waitForFunction(() => document.querySelectorAll('#rep-defs .def').length > 0);

    // (a) + (e): the saved-definition list + the sidebar/active state.
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
      // with --accent-solid (tomato·11 — a raw --accent fill under a white label is the prohibited
      // 3.87:1 pair, D04). Anything else VISIBLE in the view painting EITHER family colour
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

    // (b): + New report opens the inline builder with all controls; then Cancel and Edit a card.
    await page.click('#rep-new');
    await page.waitForSelector('#rep-builder:not([hidden])', { state: 'attached' });
    const builder = await page.evaluate(() => ({
      name: !!document.querySelector('#rep-name'),
      range: !!document.querySelector('#rep-preset-seg'),
      custom: !!document.querySelector('#rep-custom-range'),
      customHidden: !!document.querySelector('#rep-custom-range')?.hidden,
      // §09 R01 (G3): the custom range is a pair of PLAIN DATE fields — type="date", no
      // time component, and ZERO datetime-local inputs anywhere in the builder.
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

    // (f) §09 R01: clicking Custom… reveals the two plain date fields; filling the pair and
    // saving fires a real saveReport whose captured rangeSpec is EXACTLY the plain-date
    // absolute arm { kind:'absolute', fromDate, toDate } — raw YYYY-MM-DD strings, no 'T'.
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
    // Edit the first card → the builder re-opens populated for that def (showReport).
    await page.click('#rep-defs .def:first-child .def-edit');
    await page.waitForSelector('#rep-builder:not([hidden])', { state: 'attached' });
    const editOpen = await page.evaluate(() => ({
      title: document.querySelector('#rep-builder-title')?.textContent.trim() ?? '',
      name: document.querySelector('#rep-name')?.value ?? '',
      deleteVisible: !document.querySelector('#rep-delete')?.hidden,
    }));
    await page.click('#rep-cancel');
    await page.waitForSelector('#rep-builder[hidden]', { state: 'attached' });

    // (c): Run the first saved report → the grouped run-output paints with flags in context.
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
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'reports-run.png'), fullPage: true });

    // (d) issue #72: TWO export scopes. The report's OWN Export CSV/JSON (beside Run) carry
    // scope 'filtered' + the saved ref — the rows the report shows (byte-identical to
    // `tt report run <name> --csv|--json`).
    await page.click('#rep-export-csv');
    await page.waitForFunction(() => window.__EXPORTED__?.format === 'csv' && window.__EXPORTED__?.scope === 'filtered');
    const afterCsv = await page.evaluate(() => ({ ...window.__EXPORTED__ }));
    await page.click('#rep-export-json');
    await page.waitForFunction(() => window.__EXPORTED__?.format === 'json' && window.__EXPORTED__?.scope === 'filtered');
    const afterJson = await page.evaluate(() => ({ ...window.__EXPORTED__ }));
    // …and Export All Data (set apart at the bottom) carries scope 'all' + the saved ref — every
    // raw entry in the range (byte-identical to `tt export`), its status the honest "(all data)".
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

    // (g) issue #52: RENAME a saved report TO COMPLETION through the INLINE kebab affordance —
    // Electron's renderer implements neither window.prompt nor window.confirm, so the kebab
    // swaps IN PLACE into an inline Rename / Delete menu and the rename goes through the
    // inline name field committed on Enter. renameReport must fire and the LIST must update
    // to the new name.
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

    // …then DELETE it through the same inline menu: Delete only ARMS the generic §12 R13
    // confirm gate (nothing removed yet); the explicit confirm fires removeReport and the
    // LIST updates (the card leaves).
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

    // (h) STATES.md Reports × empty: with ZERO saved defs the list host is empty and the
    // #rep-defs-empty state is genuinely on-screen reading "No saved reports yet.".
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
      // The spec summary reads the stored range + group-by (a recognisable saved-report card).
      list.cards.some((c) => /This week/.test(c.spec) && /project/.test(c.spec));
    const sidebarOk = list.railVisible && list.activeNav.length === 1 && list.activeNav[0] === 'reports';
    // design.html D11 / V6: at rest, + New report is the view's single accent-solid-filled
    // primary and nothing else VISIBLE in the view paints either accent-family colour. Once the
    // builder opens the accent hands off to its commit — PRIMARY_HANDOFF gates that state.
    const accentOk = list.newSolidFilled && !list.otherAccented;
    const builderOk =
      builder.name && builder.range && builder.custom && builder.by && builder.client &&
      builder.project && builder.tag && builder.billable && builder.rounding && builder.increment &&
      ['today', 'week', 'last-week', 'month', 'last-month', 'custom'].every((p) => builder.presets.includes(p)) &&
      ['client', 'project', 'day', 'tag'].every((b) => builder.bys.includes(b));
    // (f) §09 R01 (G3): the custom range is a pair of PLAIN DATE fields (no time component,
    // zero datetime-local in the builder), revealed by Custom…, and the captured saveReport
    // payload's rangeSpec is EXACTLY { kind:'absolute', fromDate, toDate } — plain dates,
    // no 'T', no fromUtc/toUtc instant — with the saved card's summary printing the pair.
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
    const editOk = /Weekly billables/.test(editOpen.title) && /Weekly billables/.test(editOpen.name) && editOpen.deleteVisible;
    const runOk =
      !!run.ranReport && /Weekly billables/.test(String(run.ranReport.ref)) && // Run sent the card's name
      run.rangeHeader.length > 0 && // the resolved-range header paints
      run.groups.some((g) => /Globex/.test(g)) &&
      run.subs.some((s) => /Q3 Strategy/.test(s)) &&
      run.flagInTable >= 2 &&
      run.flagOutside === 0 && // flags IN CONTEXT (none in a separate list)
      run.flagRows.some((r) => /Q3 Strategy/.test(r.label) && r.flags.includes('overlap')) &&
      run.flagRows.some((r) => /Market research/.test(r.label) && r.flags.includes('unreviewed sleep'));
    // (d) issue #72: BOTH export scopes fire correctly — the filtered Export CSV/JSON carry
    // scope 'filtered' + the saved ref, and Export All Data carries scope 'all' + the saved ref
    // and is labelled "Export All Data", its status carrying the honest "(all data)" wording.
    const exportOk =
      afterCsv.format === 'csv' && afterCsv.scope === 'filtered' &&
      afterJson.format === 'json' && afterJson.scope === 'filtered' &&
      afterCsv.savedReportRef === 'Weekly billables — Globex' && // export FROM the saved report (its ref)
      afterJson.savedReportRef === 'Weekly billables — Globex' &&
      afterAllCsv.format === 'csv' && afterAllCsv.scope === 'all' &&
      afterAllJson.format === 'json' && afterAllJson.scope === 'all' &&
      afterAllCsv.savedReportRef === 'Weekly billables — Globex' &&
      afterAllJson.savedReportRef === 'Weekly billables — Globex' &&
      /Export All Data/.test(exportLabels.allCsv || '') &&
      /Export All Data/.test(exportLabels.allJson || '') &&
      /all data/.test(exportLabels.allStatus || '');
    // (g) issue #52: the inline rename/delete really landed — renameReport fired with the
    // old + new names and the list repainted under the new name; Delete armed the confirm
    // gate WITHOUT removing anything, then the explicit confirm fired removeReport and the
    // card left the list (back to the two seeded defs).
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
    // §12 R21: the two Save-refusal sub-facts — an incomplete custom range is a fed-back no-op
    // (zero saveReport, builder open, missing field focused, message shown), and a duplicate name
    // is refused with a message that PERSISTS past the tick (no self-erase), builder still open.
    const refusalOk =
      refuseIncomplete.savedYet === null &&
      refuseIncomplete.builderOpen &&
      refuseIncomplete.toFocused &&
      refuseIncomplete.warnShown &&
      refuseDup.builderOpen &&
      refuseDup.warnPersists &&
      refuseDup.cardCount === 2 &&
      // (i2) §09 R01 — the inverted-range core refusal: nothing saved, builder open, message
      // persists and names the range problem, no card added.
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
    // (h) STATES.md Reports × empty: the zero-defs page shows the visible instructive state.
    const emptyOk =
      defsEmpty.shown && defsEmpty.text === 'No saved reports yet.' && defsEmpty.cards === 0;
    const ok = listOk && sidebarOk && accentOk && builderOk && customOk && editOk && runOk && exportOk && kebabOk && refusalOk && emptyOk;
    record(
      'REPORTS_VIEW',
      ok,
      `reports view: list=${JSON.stringify(list)} builder=${JSON.stringify(builder)} refuse-incomplete=${JSON.stringify(refuseIncomplete)} refuse-duplicate=${JSON.stringify(refuseDup)} refuse-inverted=${JSON.stringify(refuseInverted)} customSave=${JSON.stringify(customSave)} edit=${JSON.stringify(editOpen)} run=${JSON.stringify(run)} export filtered CSV=${JSON.stringify(afterCsv)} JSON=${JSON.stringify(afterJson)} all-data CSV=${JSON.stringify(afterAllCsv)} JSON=${JSON.stringify(afterAllJson)} labels=${JSON.stringify(exportLabels)} inline rename=${JSON.stringify(renamed)} armed=${JSON.stringify(armed)} deleted=${JSON.stringify(deleted)} zero-defs empty=${JSON.stringify(defsEmpty)}`,      'reports-list.png',
    );
  });
}

// ENTRIES_CALENDAR — §12 R09 (toolbar) + §12 R16 (calendar): the Entries TOOLBAR drives the
// readonly entries calendar. There is NO grouping control here — grouped breakdowns moved to
// Reports (§09 R02 / `tt report --by`, G11), so #el-by-seg is ABSENT — but every toolbar QUERY
// still carries the REQUIRED grouping key by:'day' (ListEntriesQuery.by; the calendar's day
// layout — issue #55: a query without it throws in core and the calendar silently shows
// everything). Hardened per the issue-#55 triage: over the MULTI-WEEK, multi-client,
// mixed-billable fixture, EACH toolbar control (range preset, billable toggle, client,
// project, tag, search) is driven in turn and the VISIBLE EVENT COUNT + #week-total are
// asserted to move to the expected subset — counts, not just pixels — with NO listEntries
// call rejecting (window.__LIST_ERRORS__, the mock is strict about `by` exactly like core).
// §09 R01 (G3): the CUSTOM range is a pair of PLAIN DATE fields — #el-range-from/#el-range-to
// are input[type="date"] (no time component), there is NO #el-range-apply button, and setting
// both dates drives a listEntries call carrying the raw { fromDate, toDate } strings (no
// derived fromUtc/toUtc, no 'T') that narrows the calendar LIVE. Deterministic sub-facts are
// machine-scored under the pinned JUDGE clock (Wed 2026-06-24, weekStart monday); the calendar
// looks are captured (entries-search.png / entries-calendar.png).
async function sceneEntriesCalendar(browser) {
  await withPage(browser, listState(), 'index.html', async (page) => {
    const probe = () =>
      page.evaluate(() => ({
        req: { ...(window.__LIST_REQ__ || {}) },
        evCount: document.querySelectorAll('.dcol .ev').length,
        evText: [...document.querySelectorAll('.dcol .ev')].map((e) => e.textContent),
        weekTotal: document.querySelector('#week-total')?.textContent.trim() ?? null,
      }));
    const waitCountAndTotal = (n, total) =>
      page.waitForFunction(
        ({ n, total }) =>
          document.querySelectorAll('.dcol .ev').length === n &&
          document.querySelector('#week-total')?.textContent.trim() === total,
        { n, total },
      );

    // The default load paints the readonly entries calendar (R16) — no toolbar control touched
    // yet. All SEVEN fixture entries lay into their day columns, and the idle chip is the
    // WEEK-BOUNDED billable sum (issue #55 Part B): this week's 5.00h — NOT the all-time 8.00h.
    await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length > 0);
    const before = await page.evaluate(() => ({
      // §12 R09 / G11: the group-by control left the Entries view entirely (no grouping here).
      hasByControl: !!document.querySelector('#el-by-seg'),
      // The surviving toolbar controls are present and discoverable.
      hasPresets: !!document.querySelector('#el-preset-seg'),
      hasBillable: !!document.querySelector('#el-billable-seg'),
      hasClientFilter: !!document.querySelector('#el-client'),
      hasProjectFilter: !!document.querySelector('#el-project'),
      hasTagFilter: !!document.querySelector('#el-tag'),
      hasSearch: !!document.querySelector('#search'),
      // §09 R01 (G3): the two custom-range fields are PLAIN DATE inputs and the toolbar
      // ships NO Apply button (the pair applies live).
      fromType: document.querySelector('#el-range-from')?.type ?? '',
      toType: document.querySelector('#el-range-to')?.type ?? '',
      hasApply: !!document.querySelector('#el-range-apply'),
      evCount: document.querySelectorAll('.dcol .ev').length,
      weekTotal: document.querySelector('#week-total')?.textContent.trim() ?? null,
    }));

    // SEARCH — matches three "refactor" descriptions in the fixture, but only the TWO inside
    // the default week window survive (range + search COMPOSE): last week's 'refactor planning'
    // stays excluded. The events narrow to 2 and #week-total drops to their 3.50h.
    await page.fill('#search', 'refactor');
    await page.waitForFunction(() => window.__LIST_REQ__?.search === 'refactor');
    await waitCountAndTotal(2, '3.50h');
    await page.screenshot({ path: join(EVIDENCE, 'entries-search.png'), fullPage: true });
    const onSearch = await probe();

    // Clear the search — every event returns and the chip returns to the week-bounded default.
    await page.fill('#search', '');
    await waitCountAndTotal(7, '5.00h');

    // RANGE PRESETS — each chip re-queries and the visible subset + chip move with it:
    // month (June: 6 events, 7.00h billable) → last-week (1 event, 2.00h) → last-month
    // (1 event, 1.00h) → today (3 events, 3.00h) → week (5 events, 5.00h).
    await page.click('#el-preset-seg .preset[data-preset="month"]');
    await page.waitForFunction(() => window.__LIST_REQ__?.preset === 'month');
    await waitCountAndTotal(6, '7.00h');
    const onMonth = await probe();
    await page.click('#el-preset-seg .preset[data-preset="last-week"]');
    await page.waitForFunction(() => window.__LIST_REQ__?.preset === 'last-week');
    await waitCountAndTotal(1, '2.00h');
    const onLastWeek = await probe();
    await page.click('#el-preset-seg .preset[data-preset="last-month"]');
    await page.waitForFunction(() => window.__LIST_REQ__?.preset === 'last-month');
    await waitCountAndTotal(1, '1.00h');
    const onLastMonth = await probe();
    await page.click('#el-preset-seg .preset[data-preset="today"]');
    await page.waitForFunction(() => window.__LIST_REQ__?.preset === 'today');
    await waitCountAndTotal(3, '3.00h');
    const onToday = await probe();
    await page.click('#el-preset-seg .preset[data-preset="week"]');
    await page.waitForFunction(() => window.__LIST_REQ__?.preset === 'week');
    await waitCountAndTotal(5, '5.00h');

    // BILLABLE TOGGLE — billable drops the non-billable 'team lunch' (4 events, 5.00h);
    // non-billable keeps ONLY it (1 event, a 0.00h billable sum); all restores the 5.
    await page.click('#el-billable-seg .seg-btn[data-billable="billable"]');
    await page.waitForFunction(() => window.__LIST_REQ__?.billable === 'billable');
    await waitCountAndTotal(4, '5.00h');
    const onBillable = await probe();
    await page.click('#el-billable-seg .seg-btn[data-billable="non-billable"]');
    await page.waitForFunction(() => window.__LIST_REQ__?.billable === 'non-billable');
    await waitCountAndTotal(1, '0.00h');
    const onNonBillable = await probe();
    await page.click('#el-billable-seg .seg-btn[data-billable="all"]');
    await page.waitForFunction(() => window.__LIST_REQ__?.billable === 'all');
    await waitCountAndTotal(5, '5.00h');

    // CLIENT FILTER — Acme (id 1) keeps this week's three Acme entries (2.50h billable)…
    await page.waitForSelector('#el-client option[value="1"]', { state: 'attached' });
    await page.selectOption('#el-client', '1');
    await page.waitForFunction(() => window.__LIST_REQ__?.clientId === 1);
    await waitCountAndTotal(3, '2.50h');
    const onClient = await probe();
    // …PROJECT FILTER — its API project (id 11) narrows to the single 'auth refactor' (2.00h).
    await page.waitForSelector('#el-project option[value="11"]', { state: 'attached' });
    await page.selectOption('#el-project', '11');
    await page.waitForFunction(() => window.__LIST_REQ__?.projectId === 11);
    await waitCountAndTotal(1, '2.00h');
    const onProject = await probe();
    // Reset the client (project resets with it) — the week's 5 return.
    await page.selectOption('#el-client', '');
    await page.waitForFunction(
      () => window.__LIST_REQ__?.clientId === undefined && window.__LIST_REQ__?.projectId === undefined,
    );
    await waitCountAndTotal(5, '5.00h');

    // TAG FILTER — 'ci' keeps the week's two ci-tagged entries (2.50h billable), then clears.
    await page.fill('#el-tag', 'ci');
    await page.waitForFunction(() => window.__LIST_REQ__?.tag === 'ci');
    await waitCountAndTotal(2, '2.50h');
    const onTag = await probe();
    await page.fill('#el-tag', '');
    await page.waitForFunction(() => window.__LIST_REQ__?.tag === undefined);
    await waitCountAndTotal(5, '5.00h');

    // §09 R01 (G3): pick Custom… and fill the two plain date fields with the fixture's
    // earlier day (2026-06-23). Setting BOTH dates drives a real listEntries call carrying
    // the raw { fromDate, toDate } strings LIVE — no Apply click exists — and the visible
    // calendar narrows to the two in-range events (standup / refactor tests, 2.00h).
    await page.click('#el-preset-seg .preset[data-preset="custom"]');
    await page.waitForSelector('#el-custom-range:not([hidden])', { state: 'attached' });
    await page.fill('#el-range-from', '2026-06-23');
    await page.fill('#el-range-to', '2026-06-23');
    await page.waitForFunction(
      () => window.__LIST_REQ__?.fromDate === '2026-06-23' && window.__LIST_REQ__?.toDate === '2026-06-23',
    );
    await waitCountAndTotal(2, '2.00h');
    await page.screenshot({ path: join(EVIDENCE, 'entries-calendar.png'), fullPage: true });
    const onCustom = await probe();

    // Issue #55: NO listEntries call rejected across the whole drive, and EVERY query carried
    // the required by:'day' grouping (the strict mock mirrors core's required-field contract).
    const wire = await page.evaluate(() => ({
      errors: window.__LIST_ERRORS__ || 0,
      reqCount: (window.__LIST_REQS__ || []).length,
      allCarryBy: (window.__LIST_REQS__ || []).every((r) => r && r.by === 'day'),
    }));

    // §12 R09 / G11: the group-by control is gone; the surviving toolbar controls are all present.
    const controlsOk =
      !before.hasByControl &&
      before.hasPresets && before.hasBillable && before.hasClientFilter &&
      before.hasProjectFilter && before.hasTagFilter && before.hasSearch;
    // Issue #55 Part B: the idle chip is the WEEK's billable sum, not the all-time 8.00h.
    const defaultOk = before.evCount === 7 && before.weekTotal === '5.00h';
    const searchOk =
      onSearch.req.search === 'refactor' &&
      onSearch.req.by === 'day' && // the query carries the REQUIRED grouping (issue #55)
      onSearch.evCount === 2 && // narrowed to the two IN-WEEK "refactor" events…
      onSearch.evText.some((t) => /auth refactor/.test(t)) &&
      onSearch.evText.some((t) => /refactor tests/.test(t)) &&
      !onSearch.evText.some((t) => /deploy pipeline/.test(t)) && // …non-matches excluded…
      !onSearch.evText.some((t) => /refactor planning/.test(t)) && // …range + search compose
      onSearch.weekTotal === '3.50h'; // #week-total moved to the matching subset's sum
    const presetsOk =
      onMonth.evCount === 6 && onMonth.weekTotal === '7.00h' &&
      onLastWeek.evCount === 1 && onLastWeek.weekTotal === '2.00h' &&
      onLastWeek.evText.some((t) => /refactor planning/.test(t)) &&
      onLastMonth.evCount === 1 && onLastMonth.weekTotal === '1.00h' &&
      onLastMonth.evText.some((t) => /may retro/.test(t)) &&
      onToday.evCount === 3 && onToday.weekTotal === '3.00h';
    const billableOk =
      onBillable.evCount === 4 && onBillable.weekTotal === '5.00h' &&
      !onBillable.evText.some((t) => /team lunch/.test(t)) &&
      onNonBillable.evCount === 1 && onNonBillable.weekTotal === '0.00h' &&
      onNonBillable.evText.some((t) => /team lunch/.test(t));
    const clientProjectOk =
      onClient.evCount === 3 && onClient.weekTotal === '2.50h' &&
      !onClient.evText.some((t) => /deploy pipeline|refactor tests/.test(t)) && // Globex excluded
      onProject.evCount === 1 && onProject.weekTotal === '2.00h' &&
      onProject.evText.some((t) => /auth refactor/.test(t));
    const tagOk =
      onTag.evCount === 2 && onTag.weekTotal === '2.50h' &&
      onTag.evText.some((t) => /deploy pipeline/.test(t)) &&
      onTag.evText.some((t) => /refactor tests/.test(t));
    // §09 R01 (G3): plain date fields, no Apply, and the live plain-date query narrowed the
    // calendar to the 2026-06-23 pair — the payload carries the raw strings (fromDate/toDate,
    // no 'T', no derived fromUtc/toUtc instant).
    const customRangeOk =
      before.fromType === 'date' && before.toType === 'date' && !before.hasApply &&
      onCustom.req.fromDate === '2026-06-23' && onCustom.req.toDate === '2026-06-23' &&
      onCustom.req.fromUtc === undefined && onCustom.req.toUtc === undefined &&
      !String(onCustom.req.fromDate).includes('T') &&
      onCustom.evCount === 2 && onCustom.weekTotal === '2.00h' &&
      onCustom.evText.some((t) => /standup/.test(t)) &&
      onCustom.evText.some((t) => /refactor tests/.test(t)) &&
      !onCustom.evText.some((t) => /auth refactor|deploy pipeline/.test(t));
    // Issue #55: the whole drive produced zero rejected queries, every one grouped by day.
    const wireOk = wire.errors === 0 && wire.reqCount > 0 && wire.allCarryBy;
    const ok =
      controlsOk && defaultOk && searchOk && presetsOk && billableOk && clientProjectOk &&
      tagOk && customRangeOk && wireOk;
    record(
      'ENTRIES_CALENDAR',
      ok,
      `entries calendar: default=${JSON.stringify(before)} -> search=${JSON.stringify(onSearch)} ` +
        `-> presets month=${onMonth.evCount}/${onMonth.weekTotal} lastWeek=${onLastWeek.evCount}/${onLastWeek.weekTotal} ` +
        `lastMonth=${onLastMonth.evCount}/${onLastMonth.weekTotal} today=${onToday.evCount}/${onToday.weekTotal} ` +
        `-> billable=${onBillable.evCount}/${onBillable.weekTotal} nonBillable=${onNonBillable.evCount}/${onNonBillable.weekTotal} ` +
        `-> client=${onClient.evCount}/${onClient.weekTotal} project=${onProject.evCount}/${onProject.weekTotal} ` +
        `-> tag=${onTag.evCount}/${onTag.weekTotal} -> custom dates=${JSON.stringify(onCustom)} ` +
        `-> wire=${JSON.stringify(wire)}`,
      'entries-calendar.png',
    );
  });
}

// CALENDAR_LAYOUT — §12 R16: the readonly entries CALENDAR structure over the real renderer +
// entriesCalendarState. Drives the calendar-layout half of the requirement (the toolbar-drives-
// calendar half is ENTRIES_CALENDAR above). Deterministic sub-facts, machine-scored under the
// pinned JUDGE clock with the page pinned to timezoneId 'UTC' so the fixture's UTC instants map
// to a stable local-time geometry on the 24h track:
//   • fixed & EQUAL-width day columns (never stretched to fill) — every `.dcol` measures the same
//     comfortable width; the week does not fit, so the strip scrolls horizontally
//     (`.cstrip` scrollWidth > clientWidth);
//   • the viewport DEFAULTS to working hours (scrollTop lands on the 07:00 offset, > 0) over a
//     FULL 24h track (`.dt` ~24h tall) that SCROLLS, never clips — an entry BEFORE working-start
//     (06:00) and one AFTER working-end (19:00) are both in the DOM and reachable;
//   • each `.dh .ds` day header shows that day's billable total (Mon 4.25h, Wed 1.00h) and the
//     toolbar range chip (#week-total) shows the week total (9.25h);
//   • issue #145 — those headers are ON SCREEN at the default paint, not merely in the DOM: the
//     `.dh` band and the `.gut` hour labels STICK to the scrollport, so the working-hours scroll
//     and the horizontal column scroll move the content past them instead of taking them away;
//   • an EMPTY day renders as a present `.dcol` with an empty `.dt`;
//   • §12 R16 (issue #71): a CROSS-MIDNIGHT span (id 8, 22:30→06:15 next day) renders as TWO
//     `.ev` segments sharing its data-id — a start-day segment (22:30 → the track bottom, a true
//     height, never the 18px sliver) and an end-day segment (the track top → 06:15) — while its
//     billable time counts ONLY on its start day (the 22nd's header reads 12.00h, the week 17.00h);
//   • hovering an `.ev` reveals the ops (Delete / Split / Edit) + the corner `.ck` checkbox;
//   • clicking an `.ev` body opens the unified editor in the view-level host (`#entry-form-host
//     .edit-form.entry-form`), and the event carries the `.editing` selection state;
//   • the RUNNING block carries the future-fade gradient with no end edge;
//   • an overlap `.ov` warn band and a slept `.zz` hatch render;
//   • checking two `.ck` boxes reveals the #merge-bar selection bar above the calendar —
//     "2 selected" count pill + a NEUTRAL Merge button (design.html D11 / V5).
// Fails if columns stretch, the viewport clips (an off-hours entry missing), a total/empty column
// regresses, the header band or hour gutter scrolls off screen, or the hover/click/merge wiring
// breaks. Captures main-calendar.png.
async function sceneCalendarLayout(browser) {
  {
    const page = await newScenePage(browser, { viewport: { width: 820, height: 900 }, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.install({ time: new Date(JUDGE_NOW) });
    await page.clock.pauseAt(new Date(JUDGE_NOW));
    await page.addInitScript(initScript(JSON.stringify(entriesCalendarState()), {}));
    await page.goto(fileUrl('index.html'));
    await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length > 0);

    // The 24h track geometry the renderer uses (HOUR_PX=44), replicated to check off-hours
    // positioning: working-start 07:00 → 420 min → ~308px; working-end 18:00 → 1080 min → ~792px.
    const pxPerMin = 44 / 60;
    const workStartPx = 420 * pxPerMin;
    const workEndPx = 1080 * pxPerMin;

    const structure = await page.evaluate(
      ({ workStartPx, workEndPx }) => {
        const cols = [...document.querySelectorAll('.dcol')];
        const colWidths = cols.map((c) => Math.round(c.getBoundingClientRect().width));
        const strip = document.querySelector('.cstrip');
        const track = document.querySelector('.dt');
        const evs = [...document.querySelectorAll('.dcol .ev')];
        const evTop = (el) => parseFloat(el.style.top) || 0;
        const evNum = (el, prop) => Math.round(parseFloat(el.style[prop]) || 0);
        // §12 R16 (issue #71): the cross-midnight entry (data-id 8, 22:30→06:15 next day) renders
        // as TWO segments sharing its id — a start-day segment and an end-day segment. Capture each
        // segment's class + top/height so the rubric can assert the split geometry (start segment
        // reaches the track bottom at a TRUE height; end segment runs from the track top) rather
        // than the single 18px sliver the same-day end-min math used to collapse it to.
        const xmid = [...document.querySelectorAll('.dcol .ev[data-id="8"]')].map((el) => ({
          cls: el.className,
          top: evNum(el, 'top'),
          height: evNum(el, 'height'),
        }));
        // A day header's billable total, keyed by its day-of-month label.
        const dayTotals = {};
        for (const dh of document.querySelectorAll('.dcol .dh')) {
          const dd = dh.querySelector('.dd')?.textContent?.trim();
          dayTotals[dd] = dh.querySelector('.ds')?.textContent?.trim() ?? null;
        }
        // An empty day = a `.dcol` whose `.dt` holds no `.ev`.
        const emptyCols = cols.filter((c) => c.querySelectorAll('.dt .ev').length === 0).length;
        const runEv = document.querySelector('.dcol .ev.run');
        const runBg = runEv ? getComputedStyle(runEv).backgroundImage : '';
        const runBt = runEv ? runEv.querySelector('.bt')?.textContent?.trim() ?? '' : '';
        // §12 R16 / G13, issue #145: the day headers must be ON SCREEN at the post-render scroll
        // position, not merely present in the DOM. This scene used to read the per-day totals out
        // of the markup, which is a CONTROL-level fact — and it passed while the render scrolled
        // the whole 52px header band out of the viewport, leaving seven unlabelled columns with
        // zero visible totals. Measured against the scrollport rect instead: `.dh` is vertically
        // inside `.cstrip`'s box (the axis the working-hours scroll moves), and the header band's
        // own visible height is its full 52px, so a partly-clipped band fails too.
        const stripRect = strip.getBoundingClientRect();
        const gut = document.querySelector('.gut');
        const dhs = [...document.querySelectorAll('.dcol .dh')];
        const vInside = (el) => {
          const r = el.getBoundingClientRect();
          return r.height > 0 && r.top >= stripRect.top - 0.5 && r.bottom <= stripRect.bottom + 0.5;
        };
        // Fully on screen on BOTH axes — the strictest reading of "a reader can see this label".
        // The rightmost columns sit past the horizontal scroll by design (the strip scrolls), so
        // this is a floor, not an equality.
        const fullyVisible = (el) => {
          const r = el.getBoundingClientRect();
          return (
            vInside(el) && r.left >= stripRect.left - 0.5 && r.right <= stripRect.right + 0.5
          );
        };
        return {
          colCount: cols.length,
          colWidths,
          allEqualWidth: colWidths.length > 0 && colWidths.every((w) => w === colWidths[0]),
          fixedWidth: colWidths[0] ?? 0,
          hScroll: !!strip && strip.scrollWidth > strip.clientWidth,
          vScroll: !!strip && strip.scrollHeight > strip.clientHeight,
          scrollTop: strip ? Math.round(strip.scrollTop) : 0,
          trackHeight: track ? Math.round(track.getBoundingClientRect().height) : 0,
          evCount: evs.length,
          // The off-hours entries are present in the DOM (never clipped): one above the working
          // window (top < 07:00 offset) and one below it (top > 18:00 offset).
          hasBeforeWork: evs.some((el) => evTop(el) < workStartPx),
          hasAfterWork: evs.some((el) => evTop(el) > workEndPx),
          dayTotals,
          weekTotal: document.querySelector('#week-total')?.textContent?.trim() ?? null,
          emptyCols,
          overlapBands: document.querySelectorAll('.dcol .ov').length,
          // §12 R10: the overlap warn band carries its amount ("overlap Nm") and the slept hatch
          // carries the moon marker over the affected event.
          overlapTag: document.querySelector('.dcol .ov .otag')?.textContent?.trim() ?? '',
          sleptHatch: document.querySelectorAll('.dcol .ev .zz').length,
          sleptMoon: !!document.querySelector('.dcol .ev .zz use[href="#i-moon"]'),
          runPresent: !!runEv,
          runFade: /gradient/.test(runBg),
          xmid,
          // The full 24h track bottom in px (CAL_DAY_PX = 44 * 24) — the start segment must reach
          // it, proving it runs to local midnight, not to a clipped 18px block.
          trackBottomPx: 44 * 24,
          // The running/open block shows only a START time — no end (no full HH:MM–HH:MM range).
          runNoEnd: /\d{1,2}:\d{2}/.test(runBt) && !/\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}/.test(runBt),
          // issue #145 — the header band and hour gutter AT THE DEFAULT PAINT.
          headerCount: dhs.length,
          headersOnScreen: dhs.filter(vInside).length,
          dayTotalsOnScreen: [...document.querySelectorAll('.dcol .dh .ds')].filter(fullyVisible)
            .length,
          // The mechanism, named so a regression says WHICH half broke: the labels stick to the
          // scrollport instead of riding the scroll.
          dhPosition: dhs[0] ? getComputedStyle(dhs[0]).position : '',
          gutPosition: gut ? getComputedStyle(gut).position : '',
          hourLabelsOnScreen: [...document.querySelectorAll('.gut .hlab')].filter(vInside).length,
        };
      },
      { workStartPx, workEndPx },
    );
    await page.screenshot({ path: join(EVIDENCE, 'main-calendar.png') });

    // issue #145, the other axis: the hour gutter labels the time for EVERY column, so it has to
    // survive the horizontal scroll the fixed-width columns force — the same defect as the header
    // band, ninety degrees round. Scroll the strip fully right, then read the gutter's left edge
    // against the scrollport's (sticky pins the two together) and confirm the header band is still
    // on screen at the same time, so the two axes are proven to compose rather than one at a time.
    const axes = await page.evaluate(() => {
      const strip = document.querySelector('.cstrip');
      strip.scrollLeft = strip.scrollWidth;
      const s = strip.getBoundingClientRect();
      const vInside = (el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.top >= s.top - 0.5 && r.bottom <= s.bottom + 0.5;
      };
      const out = {
        scrolledRight: Math.round(strip.scrollLeft) > 0,
        gutOffset: Math.round(document.querySelector('.gut').getBoundingClientRect().left - s.left),
        headersOnScreen: [...document.querySelectorAll('.dcol .dh')].filter(vInside).length,
        hourLabelsOnScreen: [...document.querySelectorAll('.gut .hlab')].filter(vInside).length,
      };
      strip.scrollLeft = 0; // back to the at-rest position the remaining sub-facts read.
      return out;
    });

    // Hover an event → the ops (Delete / Split / Edit) + the corner checkbox reveal.
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
    // the scroll-into-view reachability of the never-clipped 24h track). The hover changes nothing
    // geometrically (CALENDAR_ENTRY_BLOCK guards that), so the title is where it was at rest.
    await clickEventBody(page, '.entry[data-id="5"]');
    await page.waitForSelector('.edit-form.entry-form', { state: 'attached' });
    const editorOpen = await page.evaluate(
      // The form opens in the view-level host (not inside the event); the event carries .editing.
      () => !!document.querySelector('#entry-form-host .edit-form.entry-form[data-id="5"]') &&
        document.querySelector('.entry[data-id="5"]')?.classList.contains('editing') === true,
    );

    // Checking two corner checkboxes enters multi-select and reveals the merge SELECTION BAR
    // (design.html D11 / V5): above the calendar, "2 selected" in the count pill, and a
    // NEUTRAL small Merge button (no .primary — Entries' accent-solid primary is Save entry).
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
        aboveCalendar: !!bar && bar.nextElementSibling?.id === 'entries',
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

    const columnsOk =
      structure.colCount === 7 &&
      structure.allEqualWidth &&
      structure.fixedWidth >= 110 &&
      structure.fixedWidth <= 140 &&
      structure.hScroll;
    const neverClipOk =
      structure.vScroll &&
      structure.scrollTop > 200 &&
      structure.scrollTop < 500 &&
      structure.trackHeight >= 1000 &&
      structure.hasBeforeWork &&
      structure.hasAfterWork;
    // §12 R16 (issue #71): the 22nd's header carries the cross-midnight span in full (start-day
    // attribution) — 4.25h of same-day work + the 7.75h overnight span = 12.00h — and the week
    // chip sums to 17.00h. The 23rd's header is NOT asserted here, but its total must stay off the
    // overnight span (it shows the end segment without counting it) — pinned by crossMidnightOk +
    // the segment/attribution rule below.
    const totalsOk =
      structure.dayTotals['22'] === '12.00h' &&
      structure.dayTotals['24'] === '1.00h' &&
      structure.weekTotal === '17.00h';
    const emptyOk = structure.emptyCols >= 1;
    // §12 R16 (issue #71): the cross-midnight entry renders as exactly TWO segments sharing id 8.
    // The start segment sits at 22:30 (1350 min → ~990px) and runs to the track bottom (a true
    // ~66px height, never the 18px sliver); the end segment starts at the track top (0) and runs
    // to 06:15 (375 min → ~275px). The two blocks share the one data-id, so the span is one entry.
    const startSeg = structure.xmid.find((s) => /\bseg-start\b/.test(s.cls));
    const endSeg = structure.xmid.find((s) => /\bseg-end\b/.test(s.cls));
    const crossMidnightOk =
      structure.xmid.length === 2 &&
      !!startSeg &&
      !!endSeg &&
      Math.abs(startSeg.top - 990) <= 2 && // 22:30
      startSeg.height > 40 && // a TRUE height, not the 18px floor
      Math.abs(startSeg.top + startSeg.height - structure.trackBottomPx) <= 2 && // reaches midnight
      endSeg.top === 0 && // starts at the day's top edge (00:00)
      Math.abs(endSeg.height - 275) <= 2; // down to 06:15
    // §12 R10: the overlapped event paints a `.ov` warn band whose `.otag` reads "overlap Nm", and
    // the slept event paints a `.zz` hatch carrying the `#i-moon` marker over its excluded portion.
    const flagsOk =
      structure.overlapBands >= 1 &&
      /overlap\s*\d+m/.test(structure.overlapTag) &&
      structure.sleptHatch >= 1 &&
      structure.sleptMoon;
    const runOk = structure.runPresent && structure.runFade && structure.runNoEnd;
    const hoverOk = hover.opsRevealed && hover.hasDelete && hover.hasSplit && hover.hasEdit && hover.hasCheckbox;
    // §12 R16 / G13, issue #145: the labels the calendar paints are VISIBLE at the default paint
    // and stay visible through the scroll on either axis. `totalsOk` above reads the totals out of
    // the DOM; this reads them off the screen — the outcome the requirement is actually about.
    // The header COUNT is exact on the vertical axis (all seven, the axis the defect was on); the
    // per-day totals are a floor on the horizontal one, because the strip is deliberately narrower
    // than the week (columnsOk asserts that scroll): at this scene's 820px viewport the ~573px
    // scrollport holds the 48px gutter plus four 124px columns, and the rest are a scroll away.
    // The pre-fix defect measured ZERO totals on screen and ZERO headers vertically.
    const labelsOnScreenOk =
      structure.dhPosition === 'sticky' &&
      structure.gutPosition === 'sticky' &&
      structure.headersOnScreen === structure.colCount &&
      structure.dayTotalsOnScreen >= 4 &&
      structure.hourLabelsOnScreen > 0 &&
      axes.scrolledRight &&
      Math.abs(axes.gutOffset) <= 1 &&
      axes.headersOnScreen === structure.colCount &&
      axes.hourLabelsOnScreen > 0;
    const ok =
      columnsOk && neverClipOk && totalsOk && emptyOk && flagsOk && runOk && hoverOk &&
      labelsOnScreenOk && crossMidnightOk && editorOpen && mergeHiddenBefore && mergeShown;
    record(
      'CALENDAR_LAYOUT',
      ok,
      `entries calendar layout: structure=${JSON.stringify(structure)}; hover=${JSON.stringify(hover)}; ` +
        `labelsOnScreen=${labelsOnScreenOk} axes=${JSON.stringify(axes)}; ` +
        `crossMidnight=${crossMidnightOk}; editorOpen=${editorOpen}; ` +
        `selection bar hidden-before=${mergeHiddenBefore} shown-after-2=${mergeShown} ${JSON.stringify(mergeBar)}`,
      'main-calendar.png',
    );
    await page.close();
  }
}

// CALENDAR_ACCENT_BUDGET — design.html D11 / §02 principles 1–2, machine-scored (issue #143).
// The Entries calendar is the app's busiest surface, and it used to fill every entry block with
// --accent-weak behind an accent border: the design audit measured 51 accent-tinted blocks and
// ZERO accent-solid primaries — the colour rationed for "the one thing that matters" was the
// wallpaper. This scene pins the budget as an OUTCOME over a realistically dense fixture
// (denseCalendarState: three weeks, 51 blocks, the last one OPEN), because the defect is
// invisible at toy density — a one-day fixture would show almost nothing. Driven at the app's
// 1040×800 default window with the page pinned to UTC, and AT REST: no toolbar control is
// touched, so what is measured is the view as it loads. Deterministic sub-facts:
//   • DENSITY — ≥50 `.ev` blocks paint (the audit's condition, not a toy one);
//   • NO WALLPAPER — not one CLOSED block paints an accent-family colour (--accent /
//     --accent-solid / --accent-weak) as fill, gradient, border or shadow;
//   • NEUTRAL SURFACE + ELEVATION — every closed block computes the --paper fill and a non-none
//     box-shadow: it is paper lifted off the track (§02 principle 2, "depth, not tint"), never a
//     tinted box;
//   • SIGNAL SURVIVES — exactly one block, the RUNNING one, still carries the accent (its
//     future-fade gradient): §02 principle 1 rations the accent for the primary action and the
//     live running state, so the calendar's one live thing is the one accented thing;
//   • ACCENT-SOLID BUDGET — at most one --accent-solid fill visible in the whole view (D11).
//     Zero today; the budget is what #150 spends when it promotes Add entry to the view's
//     primary, so the assertion is ≤1, not ==0.
// Re-tinting the blocks — an accent-weak fill, an accent border, an accent hover wash — flips
// this to false. Captures calendar-accent-budget.png.
async function sceneCalendarAccentBudget(browser) {
  const page = await newScenePage(browser, { viewport: { width: 1040, height: 800 }, colorScheme: 'light', timezoneId: 'UTC' });
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

  const densityOk = probe.evCount >= 50;
  const noWallpaperOk = probe.tintedBlockCount === 0;
  const neutralOk = probe.notPaper === 0 && probe.notLifted === 0;
  const signalOk = probe.runningCount === 1 && probe.runningCarriesAccent;
  const budgetOk = probe.accentSolidFills <= 1;
  record(
    'CALENDAR_ACCENT_BUDGET',
    densityOk && noWallpaperOk && neutralOk && signalOk && budgetOk,
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
// something measured against the fifty neighbours that are not. Deterministic sub-facts:
//   • CHOSEN LIFTS — each of the two `.ck`-selected blocks keeps the `--paper` fill and computes
//     a box-shadow that DIFFERS from the resting rung its unselected neighbours carry (a real
//     rung up the D09 ladder, not the same flat chip);
//   • UNCHOSEN STAYS PUT — the unselected closed blocks still compute the resting shadow, so the
//     contrast the lift depends on exists;
//   • NO ACCENT ON SELECTION — not one selected block, and not one checked checkbox, paints an
//     accent-family colour (`--accent` / `--accent-solid` / `--accent-weak`) as fill, gradient,
//     border or shadow; the checked box is a `--paper` box with an ink tick;
//   • EDITING IS THE SAME IDIOM — clicking a third block opens the unified form and marks it
//     `.editing`, which lifts exactly like `.on` and carries no accent either;
//   • BUDGET HELD — with three blocks in a selection state the calendar strip still paints ZERO
//     `--accent-weak` fills and ≤1 `--accent-solid` (D11), so selection cannot smuggle the
//     accent back onto the surface #143 cleared. (The strip, not the document: the open editor
//     legitimately carries the view's one accent-solid primary and the picker's weak band.)
// Re-accenting any selection site — an accent border, an accent-filled checkbox, an accent
// hairline ring — flips this to false. Captures selection-lift.png.
async function sceneSelectionLift(browser) {
  const page = await newScenePage(browser, { viewport: { width: 1040, height: 800 }, colorScheme: 'light', timezoneId: 'UTC' });
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
  // The third block opens the unified form over its hover Edit affordance, so the `.editing`
  // selection state is on screen beside the two merge-selected ones.
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
  // The `.editing` companion frame — the same lift reached through the editor rather than the
  // checkbox, with the unified form open above it.
  await page.screenshot({ path: join(EVIDENCE, 'selection-lift-editing.png') });
  await page.close();

  const stateOk =
    probe.evCount >= 50 && probe.selectedCount === 2 && probe.editingCount === 1 && probe.editorOpen;
  const liftOk =
    probe.chosenNotPaper === 0 && probe.chosenNotLifted === 0 && !probe.restIsFlat;
  const noAccentOk = probe.accentedSelections.length === 0 && probe.accentedChecks.length === 0;
  const checkOk = probe.checkedCount === 2 && probe.checksArePaper;
  const budgetOk = probe.stripFound && probe.accentWeakFills === 0 && probe.accentSolidFills <= 1;
  record(
    'SELECTION_LIFT',
    stateOk && liftOk && noAccentOk && checkOk && budgetOk,
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
// 10 / 30 / 60 / 180 minutes. Block height is duration-driven (0.733px/min, floored at 18px) while
// content height is fixed by text flow (~55px), so they cross at ~75 minutes and only the sub-75
// blocks can spill. This matters more than usual: the audit first KILLED a narrower version of the
// finding after measuring a 132px block, and a scene seeded with hour-plus entries alone would
// reproduce that mistake exactly. The 180-minute block is the control.
//
// Containment is asserted by HIT-TESTING, not by comparing layout rects. `overflow: hidden` clips
// paint, not layout — a clipped `.bt` still reports a getBoundingClientRect() below the block — so
// a rect comparison would either measure nothing (before the fix it fails for the right reason;
// after it, it still fails) or, worse, pin CSS. `document.elementFromPoint` sees what a user's
// pointer sees, through the real clip chain, which is precisely what broke: the first non-visible
// overflow ancestor used to be `.cstrip`, three levels up, so text painted into the hour rows
// beneath. Deterministic sub-facts, machine-scored:
//   • LIVE — every block hit-tests to ITSELF at its own centre (the probes below are meaningful,
//     not silently off-screen);
//   • CONTAINED — no point just BELOW a block (its own column, +4px and +12px) hit-tests into that
//     entry: nothing of the entry paints in hours it does not own;
//   • SHORTFALL REAL — the 10 / 30 / 60-minute blocks each LAY OUT more content than they have
//     height for (the `.bt` layout box overhangs the block). This is the fixture-realism guard: if
//     someone reseeds the scene with comfortable entries, the containment fact stops proving
//     anything and this fact goes red instead of the scene going quietly green;
//   • CONTROL INTACT — the 180-minute block, which HAS the room, shows all three lines fully
//     inside it: truncation happens only where the duration demands it (§4 deliberate truncation),
//     never as a blanket clip;
//   • NO HOVER SHIFT — the same event's `.bd` title, measured hovered and not, moves ZERO px. The
//     audit's own measurement (763 → 795, +32px) kept as the guard.
// Captures main-calendar-short.png.
async function sceneCalendarEntryBlock(browser) {
  const page = await newScenePage(browser, { viewport: { width: 820, height: 900 }, colorScheme: 'light', timezoneId: 'UTC' });
  await page.clock.install({ time: new Date(JUDGE_NOW) });
  await page.clock.pauseAt(new Date(JUDGE_NOW));
  await page.addInitScript(initScript(JSON.stringify(shortEntriesCalendarState()), {}));
  await page.goto(fileUrl('index.html'));
  await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length === 4);

  const blocks = await page.evaluate(() => {
    const within = (el, root) => !!el && (el === root || root.contains(el));
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
  // The three sub-75-minute blocks must genuinely overflow their height — otherwise the fixture
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
    liveOk && containedOk && shortfallReal && controlIntact && noHoverShift,
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
// Driven over `denseCalendarState` (three weeks, 51 blocks, the last one open) at the app's
// 1040×800 default window, pinned to UTC. Density is the whole guard, per the issue-#55 lesson the
// triage cites: at one day of data the traversal cost is invisible and any stop model looks fine.
// Motion is off (noMotion) so an opacity probe reads the cascade, not a frame of the 0.12s fade.
// Deterministic sub-facts:
//   • FIXTURE REAL — ≥50 blocks carrying ≥150 hover-revealed controls between them, i.e. the
//     ~200-stop calendar the audit measured. Reseeding this scene with one comfortable day
//     reddens this rather than quietly greening the rest;
//   • ONE STOP PER BLOCK — a Tab-walk from the top of the window stops inside the calendar exactly
//     `blocks` times, and EVERY one of those stops is an `.ev` block itself, never a control
//     inside one. Restoring the old model puts the count back at ~200 and fails with the number;
//   • TRAVERSABLE — one Tab cycle from the top of the window walks the WHOLE window and wraps back
//     to `<body>`, spending well under half the stops the blocks' controls would cost. The
//     calendar is the tail of the Entries tab order, so escaping it means reaching that wrap —
//     which the audit's 70-press walk never managed;
//   • NOTHING FOCUSED IS INVISIBLE — every stop of the whole walk has a non-zero EFFECTIVE opacity
//     (its own, multiplied up its ancestors) at the moment it holds focus, and paints a non-`none`
//     outline. `outline` is declared nowhere in styles.css but the one focus rule (GOLD
//     design-guard.test.ts pins that), so a non-none outline under focus IS the D13/A04 ring;
//   • CONTROLS REACHED FROM THE BLOCK — on a sample block, ← / → walk its four controls in DOM
//     order with real key presses, each one inside that block, each at non-zero effective opacity
//     while focused; Escape returns focus to the block; and Tab from a control lands on the NEXT
//     block, not on a control — the stop model holds from inside as well as outside.
// Captures calendar-keyboard-focus.png (a block holding focus, its four controls open).
async function sceneCalendarKeyboard(browser) {
  const page = await newScenePage(browser, { viewport: { width: 1040, height: 800 }, colorScheme: 'light', timezoneId: 'UTC' });
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
  // ← steps back to the control before the last one reached, and Escape leaves the set entirely.
  await page.keyboard.press('ArrowLeft');
  const stepBack = await page.evaluate(ACTIVE);
  await page.keyboard.press('Escape');
  const afterEscape = await page.evaluate(ACTIVE);
  // …and Tab from inside the block leaves it for the NEXT block, never for a control.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Tab');
  const afterTab = await page.evaluate(ACTIVE);
  await page.close();

  const calStops = walk.filter((s) => s.inCalendar);
  const fixtureReal = fixture.blocks >= 50 && fixture.controls >= 150;
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
    fixtureReal && oneStopPerBlock && traversable && invisibleStops.length === 0 && rovingOk && escapeOk && tabLeavesOk,
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

// LIVE_FILTER — §17 R11: a search / filter / group selection is reflected LIVE in BOTH the
// visible list AND the report total, with no getState reload during the keystroke. Hardened
// per the issue-#55 triage over the MULTI-WEEK fixture (seven entries across this week / last
// week / last month, all-time billable 8.00h): the idle chip must be the WEEK-BOUNDED billable
// sum (5.00h — the §12 R16 "This week" chip, NOT the all-time total, issue #55 Part B); a
// "refactor" search then narrows the visible rows to the two IN-WEEK refactor entries (last
// week's 'refactor planning' stays excluded — the query composes range + search) AND
// #week-total settles on the selection's 3.50h — the selected range's billable sum. Clearing
// the search returns both. A final NO-MATCH search (STATES.md Entries × empty) narrows the
// query to nothing and asserts the "No matching entries" empty state paints — the
// query-narrowed-to-nothing copy instructing 'Widen the range…' (app.js emptyEntries),
// DISTINCT from the never-tracked "No entries yet" copy — with zero rows. The strict
// listEntries mock rejects any query missing the required `by` (exactly like core), so the
// whole flow also proves no toolbar query throws.
async function sceneLiveFilter(browser) {
  await withPage(browser, liveState(), 'index.html', async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('#entries .entry').length > 0);
    const before = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#entries .entry').length,
      weekTotal: document.querySelector('#week-total')?.textContent.trim() ?? null,
      // The getState count right before the keystroke — the live update must not reload it.
      getStateCalls: window.__GETSTATE_CALLS__ ?? 0,
    }));
    // Type the search — the list narrows AND the total moves with the same selection.
    await page.fill('#search', 'refactor');
    await page.waitForFunction(() => document.querySelectorAll('#entries .entry').length === 2);
    await page.waitForFunction(
      () => document.querySelector('#week-total')?.textContent.trim() === '3.50h',
    );
    await page.screenshot({ path: join(EVIDENCE, 'main-filtered.png'), fullPage: true });
    const onSearch = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#entries .entry').length,
      weekTotal: document.querySelector('#week-total')?.textContent.trim() ?? null,
      descs: [...document.querySelectorAll('#entries .entry .desc')].map((d) => d.textContent),
      // The absolute getState count after the keystroke — unchanged from `before` proves the
      // list + total updated off the query path, with no snapshot reload during the keystroke.
      getStateCalls: window.__GETSTATE_CALLS__ ?? 0,
      listErrors: window.__LIST_ERRORS__ || 0, // no listEntries call rejected (issue #55)
    }));
    const noReloadOnSearch = onSearch.getStateCalls === before.getStateCalls;
    // Clear the search — both the list and the total return to the full week-bounded default.
    await page.fill('#search', '');
    await page.waitForFunction(() => document.querySelectorAll('#entries .entry').length === 7);
    await page.waitForFunction(
      (t) => document.querySelector('#week-total')?.textContent.trim() === t,
      before.weekTotal,
    );
    const onClear = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#entries .entry').length,
      weekTotal: document.querySelector('#week-total')?.textContent.trim() ?? null,
    }));

    // NO-MATCH (STATES.md Entries × empty): a search matching nothing paints the
    // query-narrowed empty state — "No matching entries" + the widen-the-range instruction —
    // never a blank pane and never the never-tracked "No entries yet" copy.
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
      before.rowCount === 7 &&
      onSearch.rowCount === 2 &&
      onSearch.descs.some((d) => /auth refactor/.test(d)) &&
      onSearch.descs.some((d) => /refactor tests/.test(d)) &&
      !onSearch.descs.some((d) => /deploy pipeline/.test(d)) &&
      // Range + search compose: the out-of-week refactor match stays excluded (issue #55).
      !onSearch.descs.some((d) => /refactor planning/.test(d));
    const totalLiveOk =
      before.weekTotal === '5.00h' && // WEEK-BOUNDED by default — never the all-time 8.00h
      onSearch.weekTotal === '3.50h' && // the total moved to the selection's billable sum…
      onSearch.listErrors === 0 && // …with no listEntries rejection along the way
      onClear.rowCount === 7 &&
      onClear.weekTotal === '5.00h'; // …and returns with the full set when cleared
    // STATES.md Entries × empty: the no-match query paints the instructive widen-the-range
    // copy — distinct from the never-tracked copy — with zero rows and zero query rejections.
    const noMatchOk =
      noMatch.rowCount === 0 &&
      /No matching entries/.test(noMatch.text) &&
      /Widen the range/.test(noMatch.text) &&
      !/No entries yet/.test(noMatch.text) &&
      noMatch.listErrors === 0;
    const ok = listLiveOk && totalLiveOk && noReloadOnSearch && noMatchOk;
    record(
      'LIVE_FILTER',
      ok,
      `live filter: list ${before.rowCount}→${onSearch.rowCount}→${onClear.rowCount} rows, ` +
        `report total ${before.weekTotal}→${onSearch.weekTotal}→${onClear.weekTotal} ` +
        `(week-bounded idle, range+search compose; getState unchanged during the keystroke: ` +
        `${noReloadOnSearch}; listEntries rejections: ${onSearch.listErrors}); ` +
        `no-match empty state ${JSON.stringify(noMatch)}`,
      'main-filtered.png',
    );
  });
}

// SETTINGS_VIEW — §12 R11: the in-window Settings view. Routing to Settings renders an
// editable control for every §14 setting (rounding toggle, rounding increment, week start,
// first check-in, check-in interval, global hotkey, date format), each wired to
// window.stint.setSetting. Drive the real renderer: click the Settings nav, assert all
// seven controls render and that changing the date-format select fires setSetting with the
// matching key/value. Captures main-settings.png as the rubric evidence for the controls'
// look-and-feel, confirms the panel stays accent-disciplined (no stray accent-family paint,
// design.html D11), and asserts the D12 segmented-control selection idiom: the chosen
// .seg-btn is a raised paper chip (paper bg + ink text + chip-lift shadow) with flat peers —
// selection never turns accent.
async function sceneSettingsView(browser) {
  await withPage(browser, settingsState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#settings-panel [data-key]', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-settings.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const panel = document.querySelector('#settings-panel');
      // Every §14 setting key has a control in the panel (by its data-key).
      const keys = [...panel.querySelectorAll('[data-key]')].map((el) => el.dataset.key);
      const has = (k) => keys.includes(k);
      // No stray accent-family fill/text (--accent OR --accent-solid) in the settings chrome
      // except a sanctioned primary (none here at rest) — the controls are inked/monochrome
      // (design.html D11 accent discipline).
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
      // design.html D12 — the segmented-control selection idiom: the chosen .seg-btn is a
      // RAISED PAPER CHIP (computed background --paper, ink text, a non-none chip-lift
      // shadow), never an accent fill; its unchosen peers stay flat (transparent, no shadow).
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
        allSeven:
          has('rounding') &&
          has('roundingIncrementMin') &&
          has('weekStart') &&
          has('firstCheckinMin') &&
          has('checkinIntervalMin') &&
          has('globalHotkey') &&
          has('dateFormat'),
        offenders,
        segChip,
      };
    });

    // Changing the date-format select fires a real setSetting with the chosen key/value.
    await page.selectOption('.set-field[data-key="dateFormat"]', 'iso');
    await page.waitForFunction(() => window.__SET_SETTING__?.key === 'dateFormat');
    const set = await page.evaluate(() => window.__SET_SETTING__);

    const segChipOk =
      probe.segChip.present &&
      probe.segChip.chipPaper &&
      probe.segChip.chipInk &&
      probe.segChip.chipLifted &&
      probe.segChip.peersFlat;
    const ok =
      probe.visible &&
      probe.allSeven &&
      probe.offenders.length === 0 &&
      segChipOk &&
      !!set &&
      set.key === 'dateFormat' &&
      set.value === 'iso';
    record(
      'SETTINGS_VIEW',
      ok,
      `settings panel exposes all seven §14 controls (${JSON.stringify(probe.keys)}), accent discipline holds (offenders=[${probe.offenders.join(', ') || 'none'}]), D12 raised-chip segment selection=${segChipOk} ${JSON.stringify(probe.segChip)}, date-format edit fired setSetting=${JSON.stringify(set)}`,
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
// Captures settings-hotkey-focus.png with the field holding keyboard focus.
async function sceneHotkeyNoTrap(browser) {
  await withPage(browser, settingsState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#settings-panel .set-hotkey');
    // The Backups group renders on its own async pass; wait for the last of the four stranded
    // controls so the walk below cannot pass for want of a control that had not painted yet.
    await page.waitForSelector('.backup-restore');
    // The A04 ring signature, in one place. An outline with style `none` paints nothing, and
    // Chromium versions disagree on the width they report alongside it (0px on one stack, 3px
    // on another) — so a raw `outlineWidth` read makes this scene's justification vary by host,
    // which the R08 judge-report drift gate rightly fails. Fold a none-style outline to 0px:
    // the signature then means the same thing everywhere and stays byte-reproducible.
    await page.evaluate(() => {
      window.__ringSig = (el) => {
        const cs = getComputedStyle(el);
        const w = cs.outlineStyle === 'none' ? '0px' : cs.outlineWidth;
        return `${cs.outlineStyle}|${w}|${cs.outlineColor}|${cs.boxShadow}`;
      };
    });
    // Tag the four controls stranded by issue 135 so the walk identifies them per-element,
    // and record the field's UNFOCUSED outline/box-shadow signature for the A04 delta.
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

    // Where is focus now, and has anything been written? One probe, used after every press.
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

    // (f) + the evidence shot: the field holding keyboard focus, ring painted.
    await focusField();
    const focused = await probe();
    await page.screenshot({ path: join(EVIDENCE, 'settings-hotkey-focus.png'), fullPage: true });
    const ringDelta = focused.onHotkey && focused.sig !== setup.restSig;

    // (a) Tab advances out of the field.
    await page.keyboard.press('Tab');
    const afterTab = await probe();

    // (b) Shift-Tab retreats out of the field — and binds nothing on the way.
    await focusField();
    await page.keyboard.press('Shift+Tab');
    const afterShiftTab = await probe();

    // (c) Escape releases the field — and binds nothing.
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
    const ok =
      setup.allPresent && focused.onHotkey && ringDelta && escaped && retreated && released &&
      reachedAll && captureWorks;
    record(
      'HOTKEY_NO_TRAP',
      ok,
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
// and the ONE viewport derivation they drive. Three machine-scored fact groups:
//   (a) The Settings → Timeline group renders controls for all four data-keys
//       (workingHoursStart / workingHoursEnd / pickerWindowMode / pickerAroundHours),
//       the HH:MM inputs read the STORED (non-default) 09:00 / 15:00, and the Around
//       select is disabled (row class 'off') while the mode is working_hours; flipping
//       the Picker-window segment fires setSetting({key:'pickerWindowMode',
//       value:'around_now'}) over the EXISTING channel (no new IPC) and the re-render
//       enables the Around select.
//   (b) SU.timelineWindow — the single source of the window math (G16; §12 R15's picker
//       and §12 R16's calendar must consume it, never re-derive it) — evaluated in-page
//       under the pinned JUDGE_NOW clock: the working-hours fixture yields exactly
//       540–900 minutes (09:00–15:00) and the around_now/8 fixture yields the page-local
//       JUDGE_NOW ± 4h clamped to the 24h track (deterministic, consumer-independent).
//   (c) The timeline consumers (§12 R15 picker / §12 R16 calendar) open as a FULL-24h
//       scrollable track — scrollHeight > clientHeight, scrollTop matching the configured
//       window: a scroll default, never a clipped one. The consumers mark their scroll
//       container with the `data-timeline-track` hook; until §12 R15/R16 land there is no
//       track in the DOM, so (c) reports "pending" WITHOUT failing — it is re-verified in
//       the post-wave AC pass once the consumer rows land (this scene is their dependency,
//       not the reverse).
async function sceneTimelineWindow(browser) {
  await withPage(browser, timelineWindowState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#settings-panel [data-key="pickerWindowMode"]', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'timeline-window.png'), fullPage: true });

    // (a) the Timeline group's four controls, stored values, and the off/disabled Around row.
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

    // (a, continued) flipping the Picker-window segment persists over the EXISTING setSetting
    // channel and the re-render enables the Around select (row no longer 'off').
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

    // (c) the consumer track — present only once §12 R15/R16 land (data-timeline-track hook).
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

    const ok =
      probe.allFour &&
      probe.startValue === '09:00' &&
      probe.endValue === '15:00' &&
      probe.aroundDisabled &&
      probe.aroundRowOff &&
      probe.labelDimmedBy.length === 0 &&
      probe.labelContrast >= 4.5 &&
      !!set &&
      set.key === 'pickerWindowMode' &&
      set.value === 'around_now' &&
      afterFlip.aroundEnabled &&
      !afterFlip.rowOff &&
      windows.workingOk &&
      windows.aroundOk &&
      windows.calendarOk &&
      (track.present ? track.ok : true);
    record(
      'TIMELINE_WINDOW',
      ok,
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
    const ok = probe.aroundEnabled && !probe.rowOff && probe.aroundValue === '8' && probe.modeOn;
    record(
      'TIMELINE_WINDOW',
      ok,
      `around_now fixture paints the mode segment on (${probe.modeOn}) with the Around select ` +
        `enabled (${probe.aroundEnabled}, row off=${probe.rowOff}) reading the stored span (${probe.aroundValue}h)`,
      'timeline-window.png',
    );
  });
}

// SOFTWARE_UPDATE — §19 R03/R04/R06 (G3): the Settings → Software Update group. Routing to
// Settings (with the GUI-only window.stint.update bridge injected — the SAME getVersion /
// check / download / reveal / onUpdateProgress shape production's preload exposes) renders:
//   VERSION (R06)        — the Current-version row prints the stamped APP_VERSION read over
//                          update.getVersion() (the value tt --version reports; here 2026.6.24).
//   CHECK (R03)          — a "Check now" button whose click calls update.check() and paints the
//                          verdict: an "Update available · <newer version>" result line + the
//                          .pill.new linking the release (here 2026.7.1).
//   GUIDED DOWNLOAD (R04)— a "Download & install <version>" primary action whose click calls
//                          update.download(); the replayed progress frames drive a live
//                          progress bar (.step .bar, ~42% mid-download) and, on the terminal
//                          'ready' frame, flip the action to "Reveal installer" wired to
//                          update.reveal(). The numbered guided steps include the one-time
//                          Gatekeeper / first-launch approval beat (no Developer ID).
//   NO-DB (R04)          — the panel carries the "Updates never touch the database" note (the
//                          artifact downloads to a temp folder, never beside the data).
//   ERROR (R04)          — a SECOND page over the downloadError fixture variant (STATES.md
//                          Settings × error): update.download() REJECTS, and the guided panel
//                          flips to its error phase — head "Update download failed", an
//                          announced .update-result.err reading "The update download failed.",
//                          and the retry "Download & install" action back in place (operable,
//                          never wedged; no Reveal-installer appears).
// All fold into one SOFTWARE_UPDATE pass. Captures main-software-update.png (the available +
// downloading view) and main-software-update-error.png (the error phase) as the rubric
// evidence the SETTINGS_VIEW shot does not cover.
async function sceneSoftwareUpdate(browser) {
  await withPage(
    browser,
    softwareUpdateState(),
    'index.html',
    async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('#software-update .ver', { state: 'attached' });
      // VERSION (R06): the Current-version row prints the bridge's getVersion() value.
      const versionShown = (await page.textContent('#software-update .ver'))?.trim();

      // CHECK (R03): click "Check now" → update.check() resolves the update-available verdict,
      // and the result line + .pill.new paint the newer version + release link.
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

      // GUIDED DOWNLOAD (R04): click "Download & install" → update.download() replays the
      // canned progress frames over onUpdateProgress. The optimistic frame + the replayed
      // 'downloading' frame paint the progress bar; the terminal 'ready' frame flips the action
      // to "Reveal installer" and marks the panel ready.
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
          // The guided steps must include the one-time Gatekeeper / first-launch approval beat.
          gatekeeperStep: steps.some((s) => /Gatekeeper/i.test(s) && /approve once|first launch/i.test(s)),
          // R04 no-DB invariant surfaced to the user: the artifact lands in a temp folder.
          noDbNote: /never touch the database/i.test(note) && /temp/i.test(note),
        };
      });

      // Reveal installer (R04): the 'ready' action calls update.reveal().
      await page.click('#update-reveal');
      await page.waitForFunction(() => window.__REVEALED__ === true);
      const revealed = await page.evaluate(() => window.__REVEALED__ === true);

      // ERROR PHASE (STATES.md Settings × error): a second page whose update.download()
      // REJECTS (the downloadError fixture variant). Check now → Download & install → the
      // rejection flips the panel to its error phase: an announced error line with the
      // renderer's own message, and the retry download action back in place — never a wedge.
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
      // STATES.md Settings × error: the rejected download surfaces the announced error phase
      // with the retry action operable — the failure is worded, never swallowed or wedged.
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
        versionOk && checkOk && downloadOk && errorOk && checkFailureOk,
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

// BACKUPS_SECTION — §20 R04 / §17 R12: the Settings → Backups group. Routing to Settings (with
// the canned listBackups mock + the backupsState snapshot carrying lastBackupUtc + the retention
// count) renders, as DETERMINISTIC Playwright facts (not just PARITY_REACH IPC presence):
//   LAST BACKUP   — the "Last backup" status line prints the newest backup's timestamp + a
//                   "verified" pill (off state.lastBackupUtc).
//   RETENTION     — the retention picker (backupRetention) reflects the snapshot's value (5) and
//                   persists a change over the SAME setSetting channel `tt config set` uses.
//   RESTORE LIST  — one row per window.stint.listBackups() entry (name · createdUtc · size), each
//                   with a Restore… action.
//   RESTORE GATE  — Restore… is destructive, so it goes through the §12 R13 confirm gate: the
//                   first click only ARMS the confirm (restoreBackup NOT yet called); only the
//                   explicit confirm fires window.stint.restoreBackup({name}) — exactly once, with
//                   the chosen backup's name.
//   EMPTY (STATES.md Settings × empty) — a SECOND page over a never-backed-up launch
//                   (lastBackupUtc unset + the backups:[] fixture knob): the group paints BOTH
//                   instructive empty copies — "No backups yet — Stint backs up automatically
//                   on launch." on the Last-backup row and "No backups to restore from yet."
//                   on the restore row — with no rows, no verified pill, and the retention
//                   picker still operable. Captures main-backups.png and main-backups-empty.png.
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

    // RETENTION: change the picker → a real setSetting fires with the matching key/value.
    await page.selectOption('#backups-panel select[data-key="backupRetention"]', '10');
    await page.waitForFunction(() => window.__SET_SETTING__?.key === 'backupRetention');
    const setRet = await page.evaluate(() => window.__SET_SETTING__);

    // RESTORE GATE: the first Restore… click only ARMS the confirm (no restoreBackup yet)…
    await page.click('#backups-panel .backup-item .backup-restore');
    await page.waitForSelector('#backups-panel .confirm-restore', { state: 'attached' });
    const armedNotRestored = await page.evaluate(() => window.__RESTORED_BACKUP__ === undefined);
    // …and ONLY the explicit confirm fires restoreBackup, exactly once, with the row's name.
    await page.click('#backups-panel [data-act="confirm-restore"]');
    await page.waitForFunction(() => !!window.__RESTORED_BACKUP__);
    const restored = await page.evaluate(() => window.__RESTORED_BACKUP__);

    // The EMPTY variant (STATES.md Settings × empty): a never-backed-up launch — no
    // lastBackupUtc on the snapshot and listBackups → []. Both instructive copies paint and
    // the group stays operable (the retention picker still renders).
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

    const ok =
      probe.lastBackupShown &&
      probe.verifiedPill &&
      probe.retentionValue === '5' &&
      probe.rowCount === 2 &&
      probe.eachHasRestore &&
      probe.offenders.length === 0 &&
      !!setRet &&
      setRet.key === 'backupRetention' &&
      setRet.value === 10 &&
      armedNotRestored &&
      !!restored &&
      restored.name === probe.rowNames[0] &&
      // STATES.md Settings × empty: the never-backed-up variant paints BOTH instructive
      // copies with zero rows, no verified pill, and the retention picker still operable.
      backupsEmpty.rows === 0 &&
      !backupsEmpty.verifiedPill &&
      backupsEmpty.retentionPresent &&
      backupsEmpty.empties.some((t) => /No backups yet/.test(t) && /backs up automatically/.test(t)) &&
      backupsEmpty.empties.some((t) => /No backups to restore from yet/.test(t));
    record(
      'BACKUPS_SECTION',
      ok,
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

// RECOVERY_NOTICE — §20 R05 / §17 R12: the corruption-recovery banner. With a snapshot carrying a
// non-null recoveryNotice (the DB was recovered from a backup on launch), routing to Settings
// renders a one-shot banner that names BOTH the backup it recovered from (recoveredFrom) AND the
// quarantined `.corrupted` file it set aside (quarantinedTo), as a deterministic Playwright fact.
// The Backups group + a reachable Restore… still render alongside it. Captures main-recovery.png.
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
    const ok =
      probe.bannerShown &&
      probe.recoveredFromShown &&
      probe.quarantinedShown &&
      probe.restoreReachable;
    record(
      'RECOVERY_NOTICE',
      ok,
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
    // (1) Every CHANNELS entry is exposed as a callable on window.stint.
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
    const ok = methodProbe.missing.length === 0 && allRouted;
    record(
      'PARITY_REACH',
      ok,
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
  const page = await newScenePage(browser, { viewport: { width: 940, height: 960 }, colorScheme: 'light' });
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

  // Entries — the toolbar search, the unified add form, and the Custom range's date pair.
  await page.click('.nav-item[data-view="entries"]');
  await page.click('#add-toggle');
  await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
  await page.click('#el-preset-seg .preset[data-preset="custom"]');
  await page.waitForSelector('#el-custom-range:not([hidden])', { state: 'attached' });
  await sweep('entries (add form + custom range)');
  await page.screenshot({ path: join(EVIDENCE, 'field-labels-entries.png') });

  // Clients — no field at rest; swept anyway so a field added here cannot slip in unswept.
  await page.click('.nav-item[data-view="clients"]');
  await sweep('clients');

  // Reports — the builder's name field and its Custom range.
  await page.click('.nav-item[data-view="reports"]');
  await page.click('#rep-new');
  await page.waitForSelector('#rep-builder:not([hidden])', { state: 'attached' });
  await page.click('#rep-preset-seg .preset[data-preset="custom"]');
  await page.waitForSelector('#rep-custom-range:not([hidden])', { state: 'attached' });
  await sweep('reports (builder + custom range)');
  await page.screenshot({ path: join(EVIDENCE, 'field-labels-reports.png') });

  // Settings — every §14 control, plus the Backups group's retention picker.
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
  const ok = fields.length >= 20 && unnamed.length === 0 && placeholderOnly.length === 0;
  record(
    'FIELD_LABELS',
    ok,
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
  const page = await newScenePage(browser, { viewport: { width: 940, height: 960 }, colorScheme: 'light' });
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

  // Timer — the start-details disclosure (idle-only, §12 R05) holds this view's four fields.
  await page.click('.nav-item[data-view="timer"]');
  await page.waitForSelector('[data-view="timer"]:not([hidden]) #start-toggle');
  await page.click('#start-toggle');
  await page.waitForSelector('#start-form:not([hidden])', { state: 'attached' });
  await sweep('timer (start details)');

  // Entries — the toolbar search (the issue's field), the unified add form, the Custom range.
  await page.click('.nav-item[data-view="entries"]');
  await page.click('#add-toggle');
  await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
  await page.click('#el-preset-seg .preset[data-preset="custom"]');
  await page.waitForSelector('#el-custom-range:not([hidden])', { state: 'attached' });
  await sweep('entries (add form + custom range)');

  // Clients — no field at rest; swept anyway so a field added here cannot slip in unswept.
  await page.click('.nav-item[data-view="clients"]');
  await sweep('clients');

  // Reports — the builder's name field and its Custom range.
  await page.click('.nav-item[data-view="reports"]');
  await page.click('#rep-new');
  await page.waitForSelector('#rep-builder:not([hidden])', { state: 'attached' });
  await page.click('#rep-preset-seg .preset[data-preset="custom"]');
  await page.waitForSelector('#rep-custom-range:not([hidden])', { state: 'attached' });
  await sweep('reports (builder + custom range)');

  // Settings — every §14 control, plus the Backups group's retention picker.
  await page.click('.nav-item[data-view="settings"]');
  await page.waitForSelector('#settings-panel .set-row', { state: 'attached' });
  await sweep('settings');

  // Fact (b): KEYBOARD focus on the issue's own field. Tab to it rather than calling .focus(),
  // so the :focus-visible the D13 idiom hangs off is the one a keyboard user gets.
  await page.click('.nav-item[data-view="entries"]');
  await page.waitForSelector('#search', { state: 'attached' });
  // The toolbar control immediately before the search label — one Tab lands on the field.
  await page.evaluate(() => document.querySelector('#report-btn').focus());
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
  const ok = all.length >= 20 && offenders.length === 0 && widths.length === 1 && focusOk;
  record(
    'FIELD_CHROME',
    ok,
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

  // The five views at rest, over the running window.
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
  const ok = totalTargets > 0 && allViolations.length === 0 && missing.length === 0;
  record(
    'TARGET_SIZE',
    ok,
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
  // (a)+(b): the running window — strip pairing on Entries, card pairing + badge on Timer.
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
  // (c): the calendar's flag markers are worded/iconed, never bare colour.
  const calendar = await withPage(browser, entriesCalendarState(), 'index.html', async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('.dcol .ev').length > 0);
    return page.evaluate(() => ({
      otag: document.querySelector('.dcol .ov .otag')?.textContent.trim() ?? '',
      moon: !!document.querySelector('.dcol .ev .zz use[href="#i-moon"]'),
    }));
  });
  // (d) WARN: raise the overlap advisory (the OVERLAP_BANNER drive) and check words + palette.
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
  // (d) ERR: a refused Stop — worded on the danger palette where it was clicked.
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
  const ok =
    // The strip pairs by its dot — D05 takes a word OR an icon, and the strip's word is the
    // deliberately hidden one (one running indicator per surface, not two).
    pairing.strip.dotVisible &&
    pairing.strip.stateWord === 'running' &&
    // The card must carry BOTH (issue #142): the word is what a screen reader and a colour-
    // blind user get, the dot is the mark beside it. Presence is not enough — it had both in
    // the DOM, display:none, the whole time the bug shipped.
    pairing.card.wordVisible &&
    pairing.card.dotVisible &&
    pairing.card.stateWord === 'running' &&
    /^(non-)?billable$/.test(pairing.card.billableWord) &&
    /overlap\s*\d+m/.test(calendar.otag) &&
    calendar.moon &&
    /overlap/i.test(warn.text) &&
    warn.flagText &&
    warn.flagBg &&
    err.text.length > 0 &&
    err.dangerText &&
    err.dangerBg &&
    err.mirrorsError;
  record(
    'COLOUR_PAIRING',
    ok,
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
 * acceptance/criteria/judge-rubric.md row id(s) a scene proves to the function that
 * drives it; the driver runs them in order and throws if a scene records an item it
 * does not declare — or misses one it does — so rubric↔scene drift fails loud instead
 * of silently accumulating. `node run-judge.mjs --list-items` prints the bound row ids
 * for the bind test without launching a browser.
 */
const SCENES = {
  EMPTY_STATE: { items: ['EMPTY_STATE'], run: sceneEmptyState },
  NAV_SHELL: { items: ['NAV_SHELL'], run: sceneNavShell },
  KEYBOARD_FOCUS: { items: ['KEYBOARD_FOCUS'], run: sceneKeyboardFocus },
  TRAY_COUNTUP: { items: ['TRAY_COUNTUP'], run: sceneTrayCountup },
  TRAY_POPOVER_SURFACE: { items: ['TRAY_POPOVER_SURFACE'], run: sceneTrayPopoverSurface },
  POPOVER_REJECT: { items: ['POPOVER_REJECT'], run: scenePopoverReject },
  IN_WINDOW_TIMER: { items: ['IN_WINDOW_TIMER'], run: sceneInWindowTimer },
  CROSS_VIEW_FRESHNESS: { items: ['CROSS_VIEW_FRESHNESS'], run: sceneCrossViewFreshness },
  TIMER_VIEW: { items: ['TIMER_VIEW'], run: sceneTimerView },
  FUTURE_START_GUARD: { items: ['FUTURE_START_GUARD'], run: sceneFutureStartGuard },
  FAVORITES_RAIL: { items: ['FAVORITES_RAIL'], run: sceneFavoritesRail },
  ACCENT_DISCIPLINE: { items: ['ACCENT_DISCIPLINE', 'ACCENT_SOLID_BUDGET'], run: sceneAccentDiscipline },
  PRIMARY_HANDOFF: { items: ['PRIMARY_HANDOFF'], run: scenePrimaryHandoff },
  CLICKABILITY: { items: ['CLICKABILITY'], run: sceneClickability },
  START_ATTRIBUTES: { items: ['START_ATTRIBUTES'], run: sceneStartAttributes },
  START_FORM: { items: ['START_FORM'], run: sceneStartForm },
  RUNNING_SINGLE_ACTION: { items: ['RUNNING_SINGLE_ACTION'], run: sceneRunningSingleAction },
  UNIFIED_FORM_ADD: { items: ['UNIFIED_FORM_ADD'], run: sceneUnifiedFormAdd },
  UNIFIED_FORM_EXPANDER: { items: ['UNIFIED_FORM_EXPANDER'], run: sceneUnifiedFormExpander },
  UNIFIED_FORM: { items: ['UNIFIED_FORM'], run: sceneUnifiedForm },
  MULTILINE_DESC: { items: ['MULTILINE_DESC'], run: sceneMultilineDesc },
  OVERLAP_BANNER: { items: ['OVERLAP_BANNER'], run: sceneOverlapBanner },
  SPLIT_AFFORDANCE: { items: ['SPLIT_AFFORDANCE'], run: sceneSplitAffordance },
  INLINE_GATE_CONTAINMENT: { items: ['INLINE_GATE_CONTAINMENT'], run: sceneInlineGateContainment },
  WRITE_REJECTION_FEEDBACK: { items: ['WRITE_REJECTION_FEEDBACK'], run: sceneWriteRejectionFeedback },
  ADD_REFUSAL_PALETTE: { items: ['ADD_REFUSAL_PALETTE'], run: sceneAddRefusalPalette },
  MERGE_CONFLICT: { items: ['MERGE_CONFLICT'], run: sceneMergeConflict },
  MERGE_CHOICE_LIFT: { items: ['MERGE_CHOICE_LIFT'], run: sceneMergeChoiceLift },
  MERGE_NOCONFLICT: { items: ['MERGE_NOCONFLICT'], run: sceneMergeNoconflict },
  MERGE_GAP: { items: ['MERGE_GAP'], run: sceneMergeGap },
  DELETE_CONFIRM: { items: ['DELETE_CONFIRM'], run: sceneDeleteConfirm },
  CONFIRM_DELETE: { items: ['CONFIRM_DELETE'], run: sceneConfirmDelete },
  CONFIRM_DESTRUCTIVE: { items: ['CONFIRM_DESTRUCTIVE'], run: sceneConfirmDestructive },
  CLIENTS_VIEW: { items: ['CLIENTS_VIEW'], run: sceneClientsView },
  CONFIRM_ARCHIVE: { items: ['CONFIRM_ARCHIVE'], run: sceneConfirmArchive },
  RESTORE_ARCHIVED: { items: ['RESTORE_ARCHIVED'], run: sceneRestoreArchived },
  TAG_CHIPS: { items: ['TAG_CHIPS'], run: sceneTagChips },
  REPORTS_VIEW: { items: ['REPORTS_VIEW'], run: sceneReportsView },
  ENTRIES_CALENDAR: { items: ['ENTRIES_CALENDAR'], run: sceneEntriesCalendar },
  CALENDAR_LAYOUT: { items: ['CALENDAR_LAYOUT'], run: sceneCalendarLayout },
  CALENDAR_ACCENT_BUDGET: { items: ['CALENDAR_ACCENT_BUDGET'], run: sceneCalendarAccentBudget },
  SELECTION_LIFT: { items: ['SELECTION_LIFT'], run: sceneSelectionLift },
  CALENDAR_ENTRY_BLOCK: { items: ['CALENDAR_ENTRY_BLOCK'], run: sceneCalendarEntryBlock },
  CALENDAR_KEYBOARD: { items: ['CALENDAR_KEYBOARD'], run: sceneCalendarKeyboard },
  LIVE_FILTER: { items: ['LIVE_FILTER'], run: sceneLiveFilter },
  SETTINGS_VIEW: { items: ['SETTINGS_VIEW'], run: sceneSettingsView },
  HOTKEY_NO_TRAP: { items: ['HOTKEY_NO_TRAP'], run: sceneHotkeyNoTrap },
  TIMELINE_WINDOW: { items: ['TIMELINE_WINDOW'], run: sceneTimelineWindow },
  TIMELINE_WINDOW_AROUND: { items: ['TIMELINE_WINDOW'], run: sceneTimelineWindowAround },
  SOFTWARE_UPDATE: { items: ['SOFTWARE_UPDATE'], run: sceneSoftwareUpdate },
  BACKUPS_SECTION: { items: ['BACKUPS_SECTION'], run: sceneBackupsSection },
  RECOVERY_NOTICE: { items: ['RECOVERY_NOTICE'], run: sceneRecoveryNotice },
  PARITY_REACH: { items: ['PARITY_REACH'], run: sceneParityReach },
  FIELD_LABELS: { items: ['FIELD_LABELS'], run: sceneFieldLabels },
  FIELD_CHROME: { items: ['FIELD_CHROME'], run: sceneFieldChrome },
  TARGET_SIZE: { items: ['TARGET_SIZE'], run: sceneTargetSize },
  COLOUR_PAIRING: { items: ['COLOUR_PAIRING'], run: sceneColourPairing },
  DESKTOP_FEEL: { items: ['DESKTOP_FEEL'], run: sceneDesktopFeel },
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
} else {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
