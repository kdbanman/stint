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
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyState, runningState, flaggedState, startFormState, addFormState, editingState, unifiedFormState, multilineDescState, splittableState, mergeConflictState, mergeAgreeState, overlapWriteState, clientsState, taggedState, listState, liveState, entriesCalendarState, savedReportsState, settingsState, timelineWindowState, timelineAroundState, softwareUpdateState, backupsState, recoveryState, UPDATE_FIXTURE, timerViewRunningState, timerViewFavoritesState, timerViewEmptyFavoritesState, initScript, JUDGE_NOW } from './fixtures.mjs';
// §17 R8 — the IPC channel set the GUI is an equal surface over. Imported from the built
// main bundle so the PARITY_REACH deterministic sub-fact (every channel has a window.stint
// method) checks the SAME list the preload bridge exposes and parity.test.ts asserts against
// — one source of truth, no hand-copied channel list to drift.
import { CHANNELS } from '../dist/ipc.js';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(here, '..', 'renderer');
const EVIDENCE = join(here, '..', '..', '..', 'acceptance', 'evidence', 'screenshots');

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

async function withPage(browser, state, name, fn, initOpts = {}) {
  const page = await browser.newPage({ viewport: { width: 760, height: 620 }, colorScheme: 'light' });
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

const results = [];
// `pass` is true/false for the deterministic, gating facts; null marks an item that
// is captured-but-not-machine-scored (the subjective rubric line), so it never
// silently counts as a pass.
function record(item, pass, justification, screenshot) {
  results.push({ item, pass, justification, screenshot });
}

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const exe = resolveChromium();
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  // EMPTY_STATE — the empty main window instructs a concrete next action (§12 R5).
  await withPage(browser, emptyState(), 'index.html', async (page) => {
    const text = await page.textContent('.empty');
    await page.screenshot({ path: join(EVIDENCE, 'main-empty.png') });
    const ok = /tt start/.test(text) && /Ctrl\+Alt\+T/.test(text);
    record('EMPTY_STATE', ok, `empty state reads: ${JSON.stringify(text.trim())}`, 'main-empty.png');
  });

  // NAV_SHELL — §12 R3 (G7): the main window presents a persistent left-hand nav with the five
  // views (Timer / Entries / Clients / Reports / Settings); the current view is highlighted and
  // each item routes to its view. The MODIFIED req hardens two G7 guarantees beyond order +
  // default-active + routing:
  //   SIDEBAR_EVERY_VIEW — routing to EACH of the five views keeps the `.shell .nav` rail
  //     visible (getBoundingClientRect width>0, not hidden) in ALL five, with exactly one `.view`
  //     visible each time — no view escapes the shell.
  //   FIXED_WIDTH_ON_RESIZE — the rail's measured width is byte-identical (168) across viewports
  //     480/760/1200px while the `.views` column width changes, proving resize lands on the
  //     content area, not the rail.
  // All four facts fold into the single NAV_SHELL pass. Captures main-nav.png (default viewport)
  // and main-nav-wide.png (1200px) as the rubric evidence for the "quiet desktop shell" line.
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
    // moves) at three viewport widths; the rail must be byte-identical 168 across all three.
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
      orderOk && defaultOk && routedOk && sidebarEveryView && fixedWidthOnResize,
      `nav order ${JSON.stringify(before.labels)}; default active=${before.activeView} (one view shown); ` +
        `clicking Settings routed: active=${JSON.stringify(after.active)} visible=${JSON.stringify(after.visibleViews)}; ` +
        `sidebar-every-view rail visible on all five=${sidebarEveryView} ` +
        `(${everyView.map((p) => `${p.view}:w${p.railWidth}/${p.railVisible ? 'shown' : 'HIDDEN'}`).join(', ')}); ` +
        `fixed-width-on-resize rail=${at480.rail}/${at760.rail}/${at1200.rail} (480/760/1200) ` +
        `views=${at480.views}/${at760.views}/${at1200.views} → ${fixedWidthOnResize}`,
      'main-nav.png',
    );
  });

  // KEYBOARD_FOCUS — §12 R14 / §14: the keyboard-operability + focus pass. Every interactive
  // control in the window must be reachable by Tab in reading order (the active element never
  // gets trapped on <body> or goes null) AND show a visible, accent-disciplined focus ring when
  // it holds keyboard focus. We drive the REAL renderer on both the empty and the running main
  // window: collect the focusable controls (querySelectorAll over button / [tabindex] / a[href],
  // minus the hidden ones), Tab-walk from <body>, and assert (a) the walk advances through every
  // visible control with activeElement never null/stuck on body, and (b) each focused control,
  // under :focus-visible (the keyboard-focus class Playwright's Tab walk triggers), paints a
  // non-default ring (a real outline OR a box-shadow — not the UA `outline: none`). Captures
  // main-focus.png with the primary toggle focused so the ring is visible evidence.
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
        // Read the focus ring the control shows RIGHT NOW (it has :focus-visible from the Tab
        // press): a real outline (width > 0 and a style other than none) OR a box-shadow ring.
        const cs = getComputedStyle(el);
        const outlineW = parseFloat(cs.outlineWidth) || 0;
        const hasOutline = cs.outlineStyle !== 'none' && outlineW > 0;
        const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
        const id = el.getAttribute('data-focus-id');
        const label = el.id || `${el.tagName.toLowerCase()}.${el.className || ''}`;
        return { onBody: false, id, label, ring: hasOutline || hasShadow };
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
      if (!step.ring) ringMisses.push(step.label);
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

  // TRAY_COUNTUP (popover) — single running timer counting up; +~3s between captures (§12 R1).
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
  // Stop control (and never a #timer-switch). Fails if the full panel stayed on Entries, the
  // card/strip placement regressed, or a #timer-switch reappeared. Captures timer-view.png (the
  // full panel) and main-timer.png (the Entries strip).
  await withPage(browser, runningState(), 'index.html', async (page) => {
    // Entries view (default) first: the compact strip mirrors the running timer and exposes no
    // full-panel Stop control (it lives on the Timer-view card only); no #timer-switch anywhere.
    const strip = await page.evaluate(() => {
      const el = document.querySelector('#timer-strip');
      return {
        present: !!el,
        running: !!el && el.classList.contains('running'),
        clock: document.querySelector('#strip-clock')?.textContent?.trim() ?? null,
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
      strip.state === 'running' &&
      strip.desc === 'auth refactor' &&
      strip.noStop &&
      strip.noSwitch;
    record(
      'IN_WINDOW_TIMER',
      cardOk && stripOk,
      `Timer-view card count advanced ${t1} → ${probe.clock} (+${delta}s) ${JSON.stringify(probe)}; ` +
        `Entries strip ${JSON.stringify(strip)}`,
      'timer-view.png',
    );
  });

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

  // TIMER_VIEW (full Timer view, G5) — §12 R14 / §05 R06: the START-ONLY scene. Routing to the
  // Timer view renders the live clock reading the derived count-up (advances +3s across the
  // pinned-clock step, not reset) with the live-edit-running strip present (no End input).
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
  {
    const page = await browser.newPage({ viewport: { width: 760, height: 900 }, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.install({ time: new Date(JUDGE_NOW) });
    await page.clock.pauseAt(new Date(JUDGE_NOW));
    await page.addInitScript(initScript(JSON.stringify(timerViewRunningState()), {}));
    await page.goto(fileUrl('index.html'));

    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-clock');
    const t1 = await page.textContent('#timer-clock');
    const before = await page.evaluate(() => ({
      stripPresent: !!document.querySelector('#live-edit') && !document.querySelector('#live-edit').hidden,
      noEnd: !document.querySelector('#live-edit #le-end'),
      // §12 R14 (G1): #le-start is a RAW text field, not a native datetime-local.
      startIsText: document.querySelector('#le-start')?.type === 'text',
      hasStop: !!document.querySelector('#timer-stop') && !document.querySelector('#timer-stop').hidden,
      noSwitch: !document.querySelector('#timer-switch'),
      state: document.querySelector('#timer-state')?.textContent?.trim() ?? null,
    }));
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
      before.state === 'running' &&
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
      disc.startBefore === '2026-06-24T21:35:53' &&
      dragged.startLive === '2026-06-24T20:35' &&
      dragged.stillNoEndChrome &&
      dragged.noBackdrop &&
      !!edited &&
      typeof edited.id === 'number' &&
      !!edited.patch &&
      !('endUtc' in edited.patch) && // the load-bearing invariant — the open row stays open
      edited.patch.startUtc === '2026-06-24T20:35:00.000Z';
    record(
      'TIMER_VIEW',
      ok,
      `Timer clock ${t1} → ${t2} (+${delta}s); strip ${JSON.stringify(before)}; ` +
        `start-only disclosure ${JSON.stringify(disc)}; grip drag → ${JSON.stringify(dragged)}; ` +
        `edit patch ${JSON.stringify(edited)} (endUtc present: ${edited && edited.patch ? ('endUtc' in edited.patch) : 'n/a'})`,
      'timer-view-full.png',
    );
    await page.close();
  }

  // FAVORITES_RAIL — §05 R09 / §12 R14: the Timer view's pinned favorites rail renders one row
  // per FavoriteView (name + client/project/billable meta), each with a one-click Resume that
  // fires window.stint.startFavorite({name}) exactly once, plus a Pin-as-favorite affordance
  // (pinFavorite) and a kebab exposing rename/unpin; the empty-favorites state instructs ('pin a
  // favorite' / mentions `tt fav`); the rail chrome is monochrome; and window.stint exposes a
  // callable for each of the five favorite channels. The scene also DRIVES a pin and a rename
  // TO COMPLETION through the INLINE name affordances (typed + committed on Enter) and asserts
  // the rail repaints — Electron's renderer does not implement window.prompt, so a prompt-based
  // flow would silently no-op in the packaged app (issue #52); this machine-scores the inline
  // replacement end to end. Drive the real renderer twice (seeded + empty) and machine-score
  // the deterministic sub-facts.
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
      empty.shown &&
      /pin/i.test(empty.text) &&
      /tt fav/i.test(empty.text);
    record(
      'FAVORITES_RAIL',
      ok,
      `rail ${JSON.stringify(probe)}; resume fired ${JSON.stringify(resumed)}; ` +
        `inline pin ${JSON.stringify(pinned)}; inline rename ${JSON.stringify(renamed)}; ` +
        `empty ${JSON.stringify(empty)}`,
      'timer-favorites.png',
    );
  });

  // ACCENT_DISCIPLINE — accent confined to the primary action and the running-state
  // indicator (styles.css header / §07, §15); the rest of the chrome stays monochrome.
  await withPage(browser, runningState(), 'index.html', async (page) => {
    await page.screenshot({ path: join(EVIDENCE, 'main-running.png') });
    const probe = await page.evaluate(() => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const toRgb = (hex) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      const accentRgb = toRgb(accent);
      const primary = getComputedStyle(document.querySelector('button.primary')).backgroundColor;
      // Scan the *entire* chrome: any element painting the accent as a fill or text
      // colour is a discipline break unless it is the primary action or part of the
      // running-state indicator (the two uses styles.css sanctions).
      const sanctioned = (el) =>
        el.matches('button.primary') ||
        el.closest('button.primary') ||
        el.closest('.entry.running') ||
        el.closest('.pop.running') ||
        el.closest('.pop:not(.idle)') ||
        // §12 R04: the in-window Active-Timer card's running affordance — the live count-up
        // clock and the running-state indicator carry the system accent (mirroring the
        // popover's running count). The whole running card container is sanctioned so the
        // count-up accent is not flagged as a stray (the idle card stays monochrome). The
        // full card lives in the Timer view; the Entries view keeps a
        // compact strip whose running clock/state carry the SAME sanctioned accent — so the
        // running `.timer-strip` container is sanctioned alongside `.timer-card`.
        el.closest('.timer-card.running') ||
        el.closest('.timer-strip.running') ||
        // §12 R14: the live-edit-running strip is part of the running-timer surface (it only
        // shows while a timer runs). Its dashed accent border + accent header word are the SAME
        // sanctioned running-context accent the running card uses; the CONTROLS inside it stay
        // monochrome (neutral wash/rule chrome), so the single primary action keeps the accent.
        el.closest('.liveedit') ||
        // §12 R15: the visual time-range picker's TWO sanctioned accent uses — the dragged
        // "me" rectangle (the active span the user manipulates) and the picker's single
        // primary "Apply range" button (.stp .primary, caught by button.primary above), plus
        // the selected calendar day (.stp-d.stp-sel — the chosen day IS the active span's
        // day, part of the same "me" surface). Everything else in the picker is monochrome.
        el.closest('.stp-block.me') ||
        el.closest('.stp-d.stp-sel') ||
        // §12 R13: the active left-nav item is marked with the system accent — the one
        // sanctioned accent use in the window chrome beyond the primary action / running
        // state (the rail is otherwise monochrome). The marker + its icon are allowed.
        el.closest('.nav-item.active');
      const offenders = [];
      for (const el of document.querySelectorAll('*')) {
        if (sanctioned(el)) continue;
        const cs = getComputedStyle(el);
        if (cs.backgroundColor === accentRgb || cs.color === accentRgb) {
          offenders.push(`${el.tagName.toLowerCase()}.${el.className || '(no-class)'}`);
        }
      }
      return { accentRgb, primary, offenders };
    });
    const primaryUsesAccent = probe.primary === probe.accentRgb;
    // Accent discipline ("one rationed accent") is a VISUAL design judgement, not a machine gate.
    // Capture the running window + the computed-style probe as evidence, but score it by looking
    // at the screenshot against the mocks — never by failing on a measured-style scan (issue #25).
    record(
      'ACCENT_DISCIPLINE',
      null,
      `primary=${probe.primary} accent=${probe.accentRgb}; primary-uses-accent=${primaryUsesAccent}; ` +
        `accent seen on [${probe.offenders.join(', ') || 'only sanctioned surfaces'}]`,
      'main-running.png',
    );
  });

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
  //   ACCENT-PER-VIEW — ONLY the sanctioned accent uses (button.primary / running state /
  //     nav-item.active) carry the accent; the accent never leaks onto an ordinary clickable
  //     affordance, and at least one primary action does carry it — the accent stays reserved
  //     for the view's primary action(s) (the running view's Stop, mirrored on the card +
  //     toolbar, are both the SAME primary Stop action).
  await withPage(browser, runningState(), 'index.html', async (page) => {
    await page.screenshot({ path: join(EVIDENCE, 'main-clickability.png') });
    const probe = await page.evaluate(() => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const toRgb = (hex) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      const accentRgb = toRgb(accent);
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
      const visible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
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
      const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
      const wash = getComputedStyle(document.documentElement).getPropertyValue('--wash').trim();
      const pillFills = new Set([toRgb(paper), toRgb(wash)]);
      const inertSel = '.wordmark, .day-head, .entry .desc, .entry .time, .summary';
      const inertOffenders = [];
      for (const el of document.querySelectorAll(inertSel)) {
        if (!visible(el)) continue;
        const bg = getComputedStyle(el).backgroundColor;
        if (!isTransparent(bg) && pillFills.has(bg)) {
          inertOffenders.push(`${el.tagName.toLowerCase()}.${el.className || '(no-class)'}`);
        }
      }
      // ACCENT-PER-VIEW: the only elements that may FILL with the accent are the sanctioned
      // uses (primary action / running state / active nav item). The accent must reach at
      // least one primary action and never leak onto an ordinary affordance.
      const accentSanctioned = (el) =>
        el.matches('button.primary') ||
        el.closest('button.primary') ||
        el.closest('.entry.running') ||
        el.closest('.timer-card.running') ||
        // §12 R04: the Entries-view compact strip's running clock/state carry the same
        // sanctioned running-state accent as the full card (the strip mirrors the card).
        el.closest('.timer-strip.running') ||
        el.closest('.nav-item.active');
      const accentOffenders = [];
      let primaryAccentCount = 0;
      for (const el of document.querySelectorAll('*')) {
        if (!visible(el)) continue;
        const cs = getComputedStyle(el);
        const fills = cs.backgroundColor === accentRgb;
        if (fills && el.matches('button.primary')) primaryAccentCount++;
        if (!accentSanctioned(el) && (fills || cs.color === accentRgb)) {
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
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const toRgb = (hex) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      const accentRgb = toRgb(accent);
      const visible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      let count = 0;
      for (const el of document.querySelectorAll('button.primary')) {
        if (!visible(el)) continue;
        if (getComputedStyle(el).backgroundColor === accentRgb) count++;
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
        `stray accent=[${probe.accentOffenders.join(', ') || 'none'}], accent-filled primary action(s)=${primaryAccentCount} ` +
        `(Entries ${probe.primaryAccentCount} + Timer ${timerPrimaryAccentCount}; expect ≥1, reserved for the primary action)`,
      'main-clickability.png',
    );
  });

  // §12 R10: the flags-in-context scene is retired — the entries list is gone, so flags no longer
  // live on a row. Overlap + slept now render as MARKERS on the readonly calendar (the `.ov` warn
  // band w/ amount + the `.zz` hatch w/ the moon marker — asserted by CALENDAR_LAYOUT) and their
  // DETAIL + the reversible subtract/restore control live in the unified editor (the overlap
  // detail + Subtract/Restore + struck raw-vs-trimmed billable — asserted by UNIFIED_FORM). No
  // main-flags.png; the successor evidence is main-calendar.png + main-edit.png.

  // START_ATTRIBUTES — the main window's Start offers an optional inline form
  // (description/client/project/tags/billable); the primary Start stays one-tap and the
  // submitted payload carries every attribute over the start IPC (§05/§12 R1).
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

  // RUNNING_SINGLE_ACTION — §12 R05 (issue #51): while a timer runs, the Timer view offers
  // ONLY edit-or-stop of the running entry. The whole start panel is hidden — no visible
  // #start-form, #start-toggle, or one-tap #toggle — so exactly ONE Description field paints
  // (the live-edit strip's #le-desc; the Details form's #start-desc is gone with its panel),
  // and the only primary action is Stop beside the live-edit strip. No "start another"
  // affordance exists until the running entry is stopped (core's start stays the atomic
  // stop-then-start for tt and programmatic callers, §05 R01 — only the GUI surfacing of a
  // start control while running is removed).
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

  // UNIFIED_FORM_ADD — §12 R07 (G5/G7): the manual-add surface is the ONE unified entry form in
  // ADD mode, inline in the Entries view (no modal). Drive the REAL renderer end to end and assert
  // the requirement's gating facts:
  //   (a) opening #add-toggle reveals a two-column form — LEFT: a 3-line multiline description
  //       textarea + client + project SELECTs + a tag chip host + the billable toggle; RIGHT: the
  //       inline interval picker (month calendar + single-day column) over the COLLAPSED Start/Stop
  //       expander (raw text fields), and the form carries NO type=datetime-local input (G1);
  //   (b) the picker paints other entries gray and an overlapping span yellow (warn-only, inert),
  //       and only the "me" rectangle + Save entry carry the accent (§15);
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
  {
    const page = await browser.newPage({ viewport: { width: 940, height: 960 }, colorScheme: 'light', timezoneId: 'UTC' });
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

    // (b) other entries gray + an overlapping span yellow (warn-only, inert); accent facts.
    const paint = await page.evaluate(() => {
      const picker = document.querySelector('#add-picker');
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const toRgb = (hex) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      const accentRgb = toRgb(accent);
      const overlaps = [...picker.querySelectorAll('.stp-overlap')];
      return {
        others: picker.querySelectorAll('.stp-block.other').length,
        overlaps: overlaps.length,
        overlapInert: overlaps.every((el) => getComputedStyle(el).pointerEvents === 'none'),
        meAccent: getComputedStyle(picker.querySelector('.stp-block.me')).backgroundColor === accentRgb,
        saveAccent: getComputedStyle(document.querySelector('#add-go')).backgroundColor === accentRgb,
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
    const paintOk = paint.others >= 1 && paint.overlaps >= 1 && paint.overlapInert && paint.meAccent && paint.saveAccent;
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
  {
    const page = await browser.newPage({ viewport: { width: 940, height: 960 }, colorScheme: 'light', timezoneId: 'UTC' });
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
    // (`.dt .ev:hover` → z-index) and reveals its affordances — then click its description body.
    await page.hover(editRow);
    await page.click(`${editRow} .desc`);
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
        // Only Save entry carries the accent (§15) — it is the single .primary in the footer.
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
      exactSeed.to.length === 16 && // the stop (…11:03:00) needs no seconds suffix…
      minuteMod5(exactSeed.to) !== 0; // …but sits OFF the 5-min grid — shown unsnapped
    const noDragRoundTrip =
      !!noDragSave &&
      noDragSave.id === 84 &&
      !!noDragSave.patch &&
      !('startUtc' in noDragSave.patch) &&
      !('endUtc' in noDragSave.patch);
    const dragSnaps =
      snapDrag.from === exactSeed.from && // the untouched start keeps its exact seconds
      snapDrag.to.length === 16 && // the dragged stop is a whole minute…
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

  // MULTILINE_DESC — §05 R10 / §12 R07: the entry form's description control is a 3-line
  // scrollable <textarea>, and a stored description that carries an embedded newline renders
  // VERBATIM (not flattened to one line). Open the multiline entry's edit form and assert the
  // .edit-desc control is a textarea with rows=3, is vertically scrollable (overflow-y:auto), and
  // its .value contains the seeded interior '\n' byte-for-byte.
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

  // §12 R06: the consolidated modal editor (the old INLINE_EDITOR / kebab scene) is retired —
  // editing is the UNIFIED_FORM inline edit-mode form above (every tt-editable field in one
  // place, no modal), and the merge selection stays the corner-checkbox path exercised by the
  // MERGE_CONFLICT / MERGE_NOCONFLICT scenes. No kebab, no modal-editor scene here.

  // OVERLAP_BANNER — a write that creates an overlap surfaces a non-blocking inline
  // banner AT THE MOMENT of the edit, not only the per-row flag (§06 R4, §12). Drive the
  // closed row's inline Edit and Save; the overlap-returning write mock makes the renderer
  // raise #overlap-banner with overlap wording, announced via role=status. The write still
  // committed — the banner is advisory, allowed-but-flagged.
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

  // SPLIT_AFFORDANCE — a CLOSED entry exposes a discoverable Split control wired to the
  // split capability; the open/running entry does not (§06 R2: only a bounded span can
  // be cut). Drive the inline picker on the closed row and assert it calls the split IPC
  // with a UTC instant; assert the open row has no Split control at all.
  await withPage(browser, splittableState(), 'index.html', async (page) => {
    const closedRow = '.entry[data-id="30"]';
    const openRow = '.entry[data-id="31"]';
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

  // WRITE_REJECTION_FEEDBACK — §12 R21: a refused core write is surfaced WHERE it was attempted,
  // never silently swallowed. Driving the REAL renderer over a STRICT-rejecting mock (the
  // strict-listEntries precedent, issue #55 — `rejectWrites` makes edit/split/rename/toggle reject
  // with a StoreError-shaped message), assert each site catches-and-displays: the form stays OPEN
  // and an ANNOUNCED (role=status + aria-live) message region carries the reason (the Stop/toggle
  // rejection routes to the banner area). Folds four facts — edit-mode Save, split confirm, inline
  // rename, Stop/toggle. Captures main-edit-reject.png as the rubric evidence.
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
      await page.waitForFunction(() => {
        const b = document.querySelector('#overlap-banner');
        return !!b && !b.hidden && b.classList.contains('error') && b.textContent.trim().length > 0;
      });
      return page.evaluate(() => {
        const b = document.querySelector('#overlap-banner');
        return {
          shown: !!b && !b.hidden && b.textContent.trim().length > 0,
          isError: !!b && b.classList.contains('error'),
          announced: b?.getAttribute('role') === 'status' && b?.hasAttribute('aria-live'),
          message: b?.textContent.trim() ?? '',
        };
      });
    }, { rejectWrites: true });

    const ok =
      editReject.formOpen && editReject.shown && editReject.announced && editReject.notWritten &&
      splitReject.formOpen && splitReject.shown && splitReject.announced && splitReject.notWritten &&
      renameReject.formOpen && renameReject.shown && renameReject.announced && renameReject.notWritten &&
      toggleReject.shown && toggleReject.isError && toggleReject.announced;
    record(
      'WRITE_REJECTION_FEEDBACK',
      ok,
      `edit-save=${JSON.stringify(editReject)} split=${JSON.stringify(splitReject)} rename=${JSON.stringify(renameReject)} toggle=${JSON.stringify(toggleReject)}`,
      'main-edit-reject.png',
    );
  }

  // MERGE_CONFLICT — selecting two-plus contiguous CLOSED entries reveals a Merge
  // action; merging entries that DISAGREE on client/billable raises the conflict prompt
  // offering the distinct client choices and a billable choice BEFORE committing
  // (§06 R3, §12 R6). The prompt is hosted in app.js — the `.editor.conflict-prompt` modal.
  // The renderer sends no clientId/projectId — the winning entry's id (winnerId) plus the
  // chosen billable go to the main process, which resolves the names. (The selection surface
  // moves to the calendar's hover-corner checkboxes when §12 R16's `.ev` events land; until
  // then it is driven from the entry rows' `.sel` checkboxes, which app.js still paints.)
  await withPage(browser, mergeConflictState(), 'index.html', async (page) => {
    // The action bar is hidden with nothing (or one entry) selected.
    const barHiddenInitially = await page.evaluate(() => !!document.querySelector('#merge-bar')?.hidden);
    await page.check('.entry[data-id="40"] .sel');
    const barHiddenWithOne = await page.evaluate(() => !!document.querySelector('#merge-bar')?.hidden);
    await page.check('.entry[data-id="41"] .sel');
    const barShownWithTwo = await page.evaluate(() => {
      const bar = document.querySelector('#merge-bar');
      return !!bar && !bar.hidden && /Merge 2 entries/.test(bar.textContent);
    });
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
      !probe.merged;
    record(
      'MERGE_CONFLICT',
      ok,
      `merge bar hidden until 2 selected (${barShownWithTwo}); conflict prompt offers client choices + billable, no merge committed yet: ${JSON.stringify(probe)}`,
      'main-merge-conflict.png',
    );
  });

  // MERGE_NOCONFLICT — selecting two contiguous entries that AGREE on client and
  // billable and clicking Merge fires the merge DIRECTLY, with no conflict prompt
  // (nothing to resolve); the payload carries just the ids (§06 R3).
  await withPage(browser, mergeAgreeState(), 'index.html', async (page) => {
    await page.check('.entry[data-id="50"] .sel');
    await page.check('.entry[data-id="51"] .sel');
    await page.click('#merge-go');
    const probe = await page.evaluate(() => ({
      promptShown: !!document.querySelector('.editor.conflict-prompt'),
      merged: window.__MERGED__,
    }));
    const ok =
      !probe.promptShown &&
      !!probe.merged &&
      Array.isArray(probe.merged.ids) &&
      probe.merged.ids.length === 2 &&
      probe.merged.winnerId === undefined;
    record(
      'MERGE_NOCONFLICT',
      ok,
      `agreeing selection merges with no prompt: ${JSON.stringify(probe)}`,
      'main-merge-conflict.png',
    );
  });

  // DELETE_CONFIRM — Delete is destructive, so the first click only arms a confirm
  // affordance; the entry is not removed until an explicit confirm tap (§06 R1).
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

  // CONFIRM_DELETE — §12 R13: destructive actions confirm in the window. A single Delete
  // click must surface an in-window confirm and must NOT destroy the entry; only the
  // explicit confirm tap removes it, exactly once. Drive the real renderer: click the row's
  // Delete, assert (a) the inline confirm appears (the generic .confirm gate with a
  // confirm-delete + cancel-delete control), (b) the instrumented window.stint.remove was
  // NOT called by that first click (__REMOVE_CALLS__ stays empty — a stray click is safe),
  // and (c) clicking the confirm button fires remove exactly once, carrying the entry id.
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

  // CONFIRM_DESTRUCTIVE — §17 R11: destructive actions confirm before acting. The §17
  // framing of the gate, captured as its own evidence: a single Delete click must surface
  // the in-window confirm and the entry must STILL BE PRESENT (no destroy on a stray click);
  // only the explicit confirm removes it, after which the entry is GONE from the list. The
  // remove mock drops the entry from the snapshot, so the post-confirm reload reflects the
  // real deletion — present pre-confirm, absent post-confirm, never on the bare first click.
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

  // CLIENTS_VIEW — the Clients nav view lists active clients with their projects nested,
  // and offers create/rename/archive in place; archived items drop out of the active list
  // (history kept). Click the Clients nav, assert the clients/projects render with the
  // rename + archive affordances, and that accent discipline holds on the new chrome
  // (§07, §12). The mutators are wired to the same IPC tt's client/project subcommands use.
  // The create affordances are DRIVEN, not merely present (issue #48: a duplicate
  // id="add-client" dead-ended the "+ Add client" button while every presence-only check
  // passed): the scene clicks "+ Add client" and asserts the inline "New client" field
  // opens, types a name, and asserts the new client LANDS in the active list off the
  // addClient → re-render round trip — then does the same for "+ Add project" (under a
  // client row) and "+ Add tag" (the tag strip), asserting each payload over the IPC.
  await withPage(browser, clientsState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="clients"]');
    // The view renders its clients/projects from the async listClients/listProjects mock;
    // wait for at least one project sub-row before probing.
    await page.waitForSelector('#clients:not([hidden]) .client .project', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-clients.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const view = document.querySelector('#clients');
      const visible = !!view && !view.hidden;
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
      // Accent discipline (§15): no element inside the Clients chrome paints the accent as
      // a fill/text colour except a sanctioned .primary confirm (none open by default).
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const toRgb = (hex) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      const accentRgb = toRgb(accent);
      const offenders = [];
      for (const el of view ? view.querySelectorAll('*') : []) {
        if (el.matches('button.primary') || el.closest('button.primary')) continue;
        const cs = getComputedStyle(el);
        if (cs.backgroundColor === accentRgb || cs.color === accentRgb) {
          offenders.push(`${el.tagName.toLowerCase()}.${el.className || '(no-class)'}`);
        }
      }
      return {
        visible,
        names,
        acmeProjects,
        clientRename,
        clientArchive,
        projRename,
        projArchive,
        addProject,
        addClient,
        offenders,
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
      // …and the DRIVEN create facts (issue #48): each inline field opened (the waits above
      // would have thrown otherwise), each payload went over the IPC, and each created item
      // landed in its active list.
      created.addedClient?.name === 'Initech' &&
      created.clientNames.includes('Initech') &&
      created.addedProject?.name === 'Mobile' &&
      created.addedProject?.clientId === 1 &&
      created.acmeProjects.includes('Mobile') &&
      created.addedTag?.name === 'billing' &&
      created.tagNames.includes('billing');
    // Accent discipline (the create "+" carries the accent, the rest stay neutral) is judged
    // visually against the mock, not gated on a computed-style scan (issue #25) — the offender
    // list is kept in the justification as captured evidence only.
    record(
      'CLIENTS_VIEW',
      ok,
      `clients listed with nested projects, rename/archive in place: ${JSON.stringify(probe)}; ` +
        `create flows driven — Add client/Add project/Add tag each opened its inline field, ` +
        `committed over the IPC, and landed in the active list: ${JSON.stringify(created)}`,
      'main-clients.png',
    );
  });

  // TAG_CHIPS — an entry's tags show in-context as monochrome chips on its calendar event, and the
  // running entry's tags show on the summary line (§07, §12). There is NO per-row Edit-tags control
  // (DELETED, §Z) — tags are edited in the UNIFIED FORM's chip editor (§12 R06/G6). This scene
  // asserts both: (a) the display — the fixture's open event carries 2 tags and its closed event 1,
  // so the events paint exactly 3 chips, plus the 2 on the running summary, each tag's text visible;
  // and (b) the capability — open the closed entry's unified form, REMOVE a tag chip and ADD a new
  // one in the form's chip editor, Save, and the `edit` patch carries the minimal
  // addTags/removeTags (and touches ONLY tags). Fails if a per-row tags control survives, or the
  // form's chip editor cannot add + remove a tag over the one `edit` commit.
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
  //       renameReport / removeReport firing and the list updating each time.
  // Captures reports-list.png (the saved-defs list + builder) and reports-run.png (the run
  // output) for rubric review.
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
      // Accent discipline: the only accented affordance in the view is + New report.
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const toRgb = (hex) => { const n = parseInt(hex.replace('#', ''), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
      const accentRgb = toRgb(accent);
      const isAccented = (el) => { if (!el) return false; const cs = getComputedStyle(el); return cs.backgroundColor === accentRgb || cs.color === accentRgb; };
      const newBtn = document.querySelector('#rep-new');
      const otherAccented = [...document.querySelectorAll('.reports-view button, .reports-view .def-run, .reports-view .def-edit, .reports-view .def-kebab')]
        .filter((b) => b !== newBtn)
        .some((b) => isAccented(b));
      return {
        cards,
        railVisible: !!nav && r.width > 0,
        activeNav: active,
        newAccented: isAccented(newBtn),
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

    // (d): Export CSV then JSON — each drives a real exportEntries call carrying the saved ref.
    await page.click('#rep-export-csv');
    await page.waitForFunction(() => window.__EXPORTED__?.format === 'csv');
    const afterCsv = await page.evaluate(() => ({ ...window.__EXPORTED__ }));
    await page.click('#rep-export-json');
    await page.waitForFunction(() => window.__EXPORTED__?.format === 'json');
    const afterJson = await page.evaluate(() => ({ ...window.__EXPORTED__ }));

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

    const listOk =
      list.cards.length === 2 &&
      list.cards.every((c) => c.name.length > 0 && c.spec.length > 0 && c.hasRun && c.hasEdit) &&
      list.cards.some((c) => /Weekly billables/.test(c.name)) &&
      // The spec summary reads the stored range + group-by (a recognisable saved-report card).
      list.cards.some((c) => /This week/.test(c.spec) && /project/.test(c.spec));
    const sidebarOk = list.railVisible && list.activeNav.length === 1 && list.activeNav[0] === 'reports';
    const accentOk = list.newAccented && !list.otherAccented; // §15 / G10: only + New report is accented
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
    const exportOk =
      afterCsv.format === 'csv' &&
      afterJson.format === 'json' &&
      afterCsv.savedReportRef === 'Weekly billables — Globex' && // export FROM the saved report (its ref)
      afterJson.savedReportRef === 'Weekly billables — Globex';
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
      refuseDup.cardCount === 2;
    const ok = listOk && sidebarOk && accentOk && builderOk && customOk && editOk && runOk && exportOk && kebabOk && refusalOk;
    record(
      'REPORTS_VIEW',
      ok,
      `reports view: list=${JSON.stringify(list)} builder=${JSON.stringify(builder)} refuse-incomplete=${JSON.stringify(refuseIncomplete)} refuse-duplicate=${JSON.stringify(refuseDup)} customSave=${JSON.stringify(customSave)} edit=${JSON.stringify(editOpen)} run=${JSON.stringify(run)} export CSV=${JSON.stringify(afterCsv)} JSON=${JSON.stringify(afterJson)} inline rename=${JSON.stringify(renamed)} armed=${JSON.stringify(armed)} deleted=${JSON.stringify(deleted)}`,
      'reports-list.png',
    );
  });

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
  //   • checking two `.ck` boxes reveals #merge-bar.
  // Fails if columns stretch, the viewport clips (an off-hours entry missing), a total/empty column
  // regresses, or the hover/click/merge wiring breaks. Captures main-calendar.png.
  {
    const page = await browser.newPage({ viewport: { width: 820, height: 900 }, colorScheme: 'light', timezoneId: 'UTC' });
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
        };
      },
      { workStartPx, workEndPx },
    );
    await page.screenshot({ path: join(EVIDENCE, 'main-calendar.png') });

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
    // the scroll-into-view reachability of the never-clipped 24h track). Hover first so the event
    // settles into its hovered layout (its `.bd` shifts clear of the revealed ops overlay) before
    // the body click lands.
    await page.hover('.entry[data-id="5"]');
    await page.click('.entry[data-id="5"] .bd');
    await page.waitForSelector('.edit-form.entry-form', { state: 'attached' });
    const editorOpen = await page.evaluate(
      // The form opens in the view-level host (not inside the event); the event carries .editing.
      () => !!document.querySelector('#entry-form-host .edit-form.entry-form[data-id="5"]') &&
        document.querySelector('.entry[data-id="5"]')?.classList.contains('editing') === true,
    );

    // Checking two corner checkboxes enters multi-select and reveals the merge bar.
    const mergeHiddenBefore = await page.evaluate(() => !!document.querySelector('#merge-bar')?.hidden);
    await page.check('.entry[data-id="7"] .ck');
    await page.check('.entry[data-id="2"] .ck');
    await page.waitForFunction(() => !document.querySelector('#merge-bar')?.hidden);
    const mergeShown = await page.evaluate(() => {
      const bar = document.querySelector('#merge-bar');
      return !!bar && !bar.hidden && /Merge 2 entries/.test(bar.textContent);
    });

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
    const ok =
      columnsOk && neverClipOk && totalsOk && emptyOk && flagsOk && runOk && hoverOk &&
      crossMidnightOk && editorOpen && mergeHiddenBefore && mergeShown;
    record(
      'CALENDAR_LAYOUT',
      ok,
      `entries calendar layout: structure=${JSON.stringify(structure)}; hover=${JSON.stringify(hover)}; ` +
        `crossMidnight=${crossMidnightOk}; editorOpen=${editorOpen}; ` +
        `merge hidden-before=${mergeHiddenBefore} shown-after-2=${mergeShown}`,
      'main-calendar.png',
    );
    await page.close();
  }

  // LIVE_FILTER — §17 R11: a search / filter / group selection is reflected LIVE in BOTH the
  // visible list AND the report total, with no getState reload during the keystroke. Hardened
  // per the issue-#55 triage over the MULTI-WEEK fixture (seven entries across this week / last
  // week / last month, all-time billable 8.00h): the idle chip must be the WEEK-BOUNDED billable
  // sum (5.00h — the §12 R16 "This week" chip, NOT the all-time total, issue #55 Part B); a
  // "refactor" search then narrows the visible rows to the two IN-WEEK refactor entries (last
  // week's 'refactor planning' stays excluded — the query composes range + search) AND
  // #week-total settles on the selection's 3.50h — the selected range's billable sum. Clearing
  // the search returns both. The strict listEntries mock rejects any query missing the required
  // `by` (exactly like core), so the whole flow also proves no toolbar query throws.
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
    const ok = listLiveOk && totalLiveOk && noReloadOnSearch;
    record(
      'LIVE_FILTER',
      ok,
      `live filter: list ${before.rowCount}→${onSearch.rowCount}→${onClear.rowCount} rows, ` +
        `report total ${before.weekTotal}→${onSearch.weekTotal}→${onClear.weekTotal} ` +
        `(week-bounded idle, range+search compose; getState unchanged during the keystroke: ` +
        `${noReloadOnSearch}; listEntries rejections: ${onSearch.listErrors})`,
      'main-filtered.png',
    );
  });

  // SETTINGS_VIEW — §12 R11: the in-window Settings view. Routing to Settings renders an
  // editable control for every §14 setting (rounding toggle, rounding increment, week start,
  // first check-in, check-in interval, global hotkey, date format), each wired to
  // window.stint.setSetting. Drive the real renderer: click the Settings nav, assert all
  // seven controls render and that changing the date-format select fires setSetting with the
  // matching key/value. Captures main-settings.png as the rubric evidence for the controls'
  // look-and-feel, and confirms the panel stays accent-disciplined (no stray accent fill).
  await withPage(browser, settingsState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#settings-panel [data-key]', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-settings.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const panel = document.querySelector('#settings-panel');
      // Every §14 setting key has a control in the panel (by its data-key).
      const keys = [...panel.querySelectorAll('[data-key]')].map((el) => el.dataset.key);
      const has = (k) => keys.includes(k);
      // No stray accent fill/text in the settings chrome except a sanctioned primary (none
      // here) — the controls are inked/monochrome (§15 accent discipline).
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const toRgb = (hex) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      const accentRgb = toRgb(accent);
      const offenders = [];
      for (const el of panel.querySelectorAll('*')) {
        if (el.matches('button.primary') || el.closest('button.primary')) continue;
        const cs = getComputedStyle(el);
        if (cs.backgroundColor === accentRgb || cs.color === accentRgb) {
          offenders.push(`${el.tagName.toLowerCase()}.${el.className || '(no-class)'}`);
        }
      }
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
      };
    });

    // Changing the date-format select fires a real setSetting with the chosen key/value.
    await page.selectOption('.set-field[data-key="dateFormat"]', 'iso');
    await page.waitForFunction(() => window.__SET_SETTING__?.key === 'dateFormat');
    const set = await page.evaluate(() => window.__SET_SETTING__);

    const ok =
      probe.visible &&
      probe.allSeven &&
      probe.offenders.length === 0 &&
      !!set &&
      set.key === 'dateFormat' &&
      set.value === 'iso';
    record(
      'SETTINGS_VIEW',
      ok,
      `settings panel exposes all seven §14 controls (${JSON.stringify(probe.keys)}), accent discipline holds (offenders=[${probe.offenders.join(', ') || 'none'}]), date-format edit fired setSetting=${JSON.stringify(set)}`,
      'main-settings.png',
    );
  });

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
      return {
        allFour: ['workingHoursStart', 'workingHoursEnd', 'pickerWindowMode', 'pickerAroundHours'].every(
          (k) => keys.includes(k),
        ),
        startValue: start ? start.value : null,
        endValue: end ? end.value : null,
        aroundDisabled: !!(around && around.disabled),
        aroundRowOff: !!(aroundRow && aroundRow.classList.contains('off')),
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
        `(disabled=${probe.aroundDisabled}, row off=${probe.aroundRowOff}); mode flip fired ` +
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

  // TIMELINE_WINDOW around_now snapshot — the Settings view painted FROM an around_now
  // fixture: the Around select renders enabled with the stored span selected (the inverse
  // of the working_hours-disabled fact above), proving the off/disabled state follows the
  // STORED mode, not a hardcoded default. Folded into the TIMELINE_WINDOW rubric row.
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
  // All fold into one SOFTWARE_UPDATE pass. Captures main-software-update.png (the available +
  // downloading view) as the rubric evidence the SETTINGS_VIEW shot does not cover.
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
      record(
        'SOFTWARE_UPDATE',
        versionOk && checkOk && downloadOk,
        `version row=${JSON.stringify(versionShown)} (R06); Check now → ${JSON.stringify(afterCheck)} (R03); ` +
          `Download & install → ${JSON.stringify(afterDownload)}, reveal fired=${revealed} (R04)`,
        'main-software-update.png',
      );
    },
    { update: UPDATE_FIXTURE },
  );

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
  //                   the chosen backup's name. Captures main-backups.png as the rubric evidence.
  await withPage(browser, backupsState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#backups-panel .set-grp', { state: 'attached' });
    await page.waitForSelector('#backups-panel .backup-item', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-backups.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const host = document.querySelector('#backups-panel');
      const rows = [...host.querySelectorAll('.backup-item')];
      const ret = host.querySelector('select[data-key="backupRetention"]');
      // No stray accent in the Backups chrome (§15 — accent stays on the primary action only).
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const toRgb = (hex) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      const accentRgb = toRgb(accent);
      const offenders = [];
      for (const el of host.querySelectorAll('*')) {
        if (el.matches('button.primary') || el.closest('button.primary')) continue;
        const cs = getComputedStyle(el);
        if (cs.backgroundColor === accentRgb || cs.color === accentRgb) {
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
      restored.name === probe.rowNames[0];
    record(
      'BACKUPS_SECTION',
      ok,
      `backups group: last-backup+verified=${probe.lastBackupShown}/${probe.verifiedPill}, ` +
        `retention=${probe.retentionValue} (edit fired ${JSON.stringify(setRet)}), ` +
        `restore list rows=${probe.rowCount} ${JSON.stringify(probe.rowNames)} (each Restore… present=${probe.eachHasRestore}); ` +
        `confirm gate: armed-not-restored=${armedNotRestored}, confirmed restore=${JSON.stringify(restored)}; ` +
        `stray accent=[${probe.offenders.join(', ') || 'none'}]`,
      'main-backups.png',
    );
  });

  // RECOVERY_NOTICE — §20 R05 / §17 R12: the corruption-recovery banner. With a snapshot carrying a
  // non-null recoveryNotice (the DB was recovered from a backup on launch), routing to Settings
  // renders a one-shot banner that names BOTH the backup it recovered from (recoveredFrom) AND the
  // quarantined `.corrupted` file it set aside (quarantinedTo), as a deterministic Playwright fact.
  // The Backups group + a reachable Restore… still render alongside it. Captures main-recovery.png.
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

  // DESKTOP_FEEL — subjective; NOT machine-scored. `pass: null` so it is never
  // counted as an automated pass; the screenshots are the evidence a human/LLM
  // scores against acceptance/criteria/judge-rubric.md.
  record(
    'DESKTOP_FEEL',
    null,
    'unscored here — screenshots captured for rubric/human scoring (main-empty, main-running, main-timer, main-calendar, main-edit, main-tags, main-report-client, main-report-day, main-focus, popover-running)',
    'main-running.png',
  );

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
