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
import { emptyState, runningState, flaggedState, startFormState, switchState, addFormState, pickerState, editingState, editableState, splittableState, mergeConflictState, mergeAgreeState, overlapWriteState, clientsState, taggedState, listState, liveState, savedReportsState, settingsState, softwareUpdateState, UPDATE_FIXTURE, timerViewRunningState, timerViewFavoritesState, timerViewEmptyFavoritesState, initScript, JUDGE_NOW } from './fixtures.mjs';
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
    const fixedWidthOnResize =
      at760.rail === 168 &&
      at1200.rail === 168 &&
      at480.rail === 168 &&
      // The views column DID change with the viewport — resize landed on the content, not the rail.
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
  // The half that IS headless-checkable: every tray action lives IN the popover. Drive the
  // real popover renderer twice and assert all four actions are present —
  //   running snapshot: #toggle reads 'Stop' (aria-pressed=true), #switch visible, #open present;
  //   idle snapshot:    #toggle reads 'Start', #switch hidden, #open present.
  // If any of Stop / Switch / Start / Open Stint is absent from the popover, this fails —
  // since the dropdown is gone, the popover MUST carry them all. Captures
  // popover-tray-surface.png as the evidence that the popover is the one action surface.
  await withPage(browser, runningState(), 'popover.html', async (page) => {
    const runningProbe = await page.evaluate(() => {
      const toggle = document.querySelector('#toggle');
      const sw = document.querySelector('#switch');
      const open = document.querySelector('#open');
      const swCs = sw ? getComputedStyle(sw) : null;
      return {
        toggleLabel: toggle ? toggle.textContent.trim() : null,
        togglePressed: toggle ? toggle.getAttribute('aria-pressed') : null,
        switchVisible: !!sw && !sw.hidden && swCs.display !== 'none',
        openPresent: !!open,
        openLabel: open ? open.textContent.trim() : null,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'popover-tray-surface.png') });

    // The idle snapshot: the same popover offers Start (one-tap) and hides Switch (which only
    // makes sense mid-timer) — Start is still reachable here, so the dropdown's Start is not lost.
    const idleProbe = await withPage(browser, emptyState(), 'popover.html', async (ip) =>
      ip.evaluate(() => {
        const toggle = document.querySelector('#toggle');
        const sw = document.querySelector('#switch');
        const open = document.querySelector('#open');
        return {
          toggleLabel: toggle ? toggle.textContent.trim() : null,
          togglePressed: toggle ? toggle.getAttribute('aria-pressed') : null,
          switchHidden: !!sw && sw.hidden,
          openPresent: !!open,
        };
      }),
    );

    const runningOk =
      runningProbe.toggleLabel === 'Stop' &&
      runningProbe.togglePressed === 'true' &&
      runningProbe.switchVisible &&
      runningProbe.openPresent &&
      /Open Stint/.test(runningProbe.openLabel ?? '');
    const idleOk =
      idleProbe.toggleLabel === 'Start' &&
      idleProbe.togglePressed === 'false' &&
      idleProbe.switchHidden &&
      idleProbe.openPresent;
    record(
      'TRAY_POPOVER_SURFACE',
      runningOk && idleOk,
      `popover is the sole tray action surface — running: Stop+Switch+Open present ${JSON.stringify(runningProbe)}; ` +
        `idle: Start (Switch hidden) + Open present ${JSON.stringify(idleProbe)}`,
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
  // exposes BOTH a Stop and a Switch control; and (b) on the Entries view the compact
  // #timer-strip mirrors the running count-up + state + description but carries NO full-panel
  // Stop/Switch controls. Fails if the full panel stayed on Entries or the card/strip placement
  // regressed. Captures timer-view.png (the full panel) and main-timer.png (the Entries strip).
  await withPage(browser, runningState(), 'index.html', async (page) => {
    // Entries view (default) first: the compact strip mirrors the running timer and exposes no
    // full-panel Stop/Switch controls (those live on the Timer-view card only).
    const strip = await page.evaluate(() => {
      const el = document.querySelector('#timer-strip');
      return {
        present: !!el,
        running: !!el && el.classList.contains('running'),
        clock: document.querySelector('#strip-clock')?.textContent?.trim() ?? null,
        state: document.querySelector('#strip-state')?.textContent?.trim() ?? null,
        desc: document.querySelector('#strip-desc')?.textContent?.trim() ?? null,
        // The strip must NOT carry the full Stop/Switch panel controls (they belong to the card).
        noStop: !document.querySelector('#timer-strip #timer-stop'),
        noSwitch: !document.querySelector('#timer-strip #timer-switch'),
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
        hasSwitch: !!document.querySelector('#timer-switch') && !document.querySelector('#timer-switch').hidden,
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
      probe.hasSwitch;
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

  // TIMER_VIEW (full Timer view, G5) — §12 R14: routing to the Timer view renders the live clock
  // reading the derived count-up (advances +3s across the pinned-clock step, not reset), a
  // running/idle state indicator, the running entry's description ('auth refactor') + client/
  // project ('Client A / API'); the live-edit-running strip is present and its commit sends an
  // `edit` patch over IPC that carries the start-time/attributes but NEVER endUtc (the row stays
  // open); a visible Stop (accent) + Switch (plain) are present while running. Drive the real
  // renderer: route to the Timer view, read the clock, fast-forward 3s, edit the live strip's
  // start time, and assert the recorded edit payload (window.__EDITED__) has no endUtc.
  await withPage(browser, timerViewRunningState(), 'index.html', async (page) => {
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-clock');
    const t1 = await page.textContent('#timer-clock');
    const before = await page.evaluate(() => ({
      stripPresent: !!document.querySelector('#live-edit') && !document.querySelector('#live-edit').hidden,
      noEnd: !document.querySelector('#live-edit #le-end'),
      noStopText: /not editable while running/i.test(document.querySelector('#live-edit')?.textContent ?? ''),
      hasStop: !!document.querySelector('#timer-stop') && !document.querySelector('#timer-stop').hidden,
      hasSwitch: !!document.querySelector('#timer-switch') && !document.querySelector('#timer-switch').hidden,
      desc: document.querySelector('#timer-desc')?.textContent?.trim() ?? null,
      meta: document.querySelector('#timer-meta')?.textContent?.trim() ?? null,
      state: document.querySelector('#timer-state')?.textContent?.trim() ?? null,
    }));
    await page.screenshot({ path: join(EVIDENCE, 'timer-view-full.png') });
    // Advance the pinned clock +3s — the card's tick() must advance the live count-up.
    await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + 3000));
    const t2 = await page.textContent('#timer-clock');
    // Edit the live-edit-running strip's start time (a change event commits immediately) and the
    // description (debounced); assert the recorded edit patch carries the change but NO endUtc.
    await page.fill('#live-edit #le-desc', 'auth refactor v2');
    await page.fill('#live-edit #le-start', '2026-06-24T20:00');
    await page.dispatchEvent('#live-edit #le-start', 'change');
    // Let the debounced description commit settle (scheduleLiveEdit waits 500ms).
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
      before.noStopText &&
      before.hasStop &&
      before.hasSwitch &&
      before.desc === 'auth refactor' &&
      /Client A \/ API/.test(before.meta ?? '') &&
      before.state === 'running' &&
      !!edited &&
      typeof edited.id === 'number' &&
      !!edited.patch &&
      !('endUtc' in edited.patch) && // the load-bearing invariant — the open row stays open
      (edited.patch.startUtc !== undefined || edited.patch.description !== undefined);
    record(
      'TIMER_VIEW',
      ok,
      `Timer clock ${t1} → ${t2} (+${delta}s); strip ${JSON.stringify(before)}; ` +
        `edit patch ${JSON.stringify(edited)} (endUtc present: ${edited && edited.patch ? ('endUtc' in edited.patch) : 'n/a'})`,
      'timer-view-full.png',
    );
  });

  // FAVORITES_RAIL — §05 R09 / §12 R14: the Timer view's pinned favorites rail renders one row
  // per FavoriteView (name + client/project/billable meta), each with a one-click Resume that
  // fires window.stint.startFavorite({name}) exactly once, plus a Pin-as-favorite affordance
  // (pinFavorite) and a kebab exposing rename/unpin; the empty-favorites state instructs ('pin a
  // favorite' / mentions `tt fav`); the rail chrome is monochrome; and window.stint exposes a
  // callable for each of the five favorite channels. Drive the real renderer twice (seeded +
  // empty) and machine-score the deterministic sub-facts.
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
      empty.shown &&
      /pin/i.test(empty.text) &&
      /tt fav/i.test(empty.text);
    record(
      'FAVORITES_RAIL',
      ok,
      `rail ${JSON.stringify(probe)}; resume fired ${JSON.stringify(resumed)}; ` +
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
        // count-up accent is not flagged as a stray (the idle card and the Switch button
        // stay monochrome). The full card lives in the Timer view; the Entries view keeps a
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
    const chromeMonochrome = probe.offenders.length === 0;
    record(
      'ACCENT_DISCIPLINE',
      primaryUsesAccent && chromeMonochrome,
      `primary=${probe.primary} accent=${probe.accentRgb}; stray accent on [${probe.offenders.join(', ') || 'none'}]`,
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
        !!el.closest('.presets');
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
    // visible accent-filled primary). The positive/inert/stray-accent checks stay on the
    // content-rich Entries view above; this only re-homes the "≥1 primary carries accent" fact.
    await page.click('.nav-item[data-view="timer"]');
    await page.waitForSelector('[data-view="timer"]:not([hidden]) #start-panel');
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
    const positiveOk = probe.offenders.length === 0;
    const negativeOk = probe.inertOffenders.length === 0;
    const primaryAccentCount = probe.primaryAccentCount + timerPrimaryAccentCount;
    const accentOk = probe.accentOffenders.length === 0 && primaryAccentCount >= 1;
    record(
      'CLICKABILITY',
      positiveOk && negativeOk && accentOk,
      `clickable affordances reading as bare prose=[${probe.offenders.join(', ') || 'none'}]; ` +
        `inert text wearing a pill fill=[${probe.inertOffenders.join(', ') || 'none'}]; ` +
        `stray accent=[${probe.accentOffenders.join(', ') || 'none'}], accent-filled primary action(s)=${primaryAccentCount} ` +
        `(Entries ${probe.primaryAccentCount} + Timer ${timerPrimaryAccentCount}; expect ≥1, reserved for the primary action)`,
      'main-clickability.png',
    );
  });

  // FLAG_IN_CONTEXT — overlap + slept flags on the affected rows, subtract present, plus the
  // §12 R9 detailed overlap banner ("Overlap: Nm with previous/next entry") on the overlapped
  // row and the struck-through raw duration beside the trimmed billable on the slept row
  // (§12 R4, §12 R9, §10 R5).
  await withPage(browser, flaggedState(), 'index.html', async (page) => {
    await page.screenshot({ path: join(EVIDENCE, 'main-flags.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const overlapRow = document.querySelector('.entry[data-id="11"]');
      const sleptRow = document.querySelector('.entry[data-id="12"]');
      const struck = sleptRow?.querySelector('.dur s.struck');
      const struckLineThrough = struck
        ? getComputedStyle(struck).textDecorationLine.includes('line-through')
        : false;
      return {
        overlapFlag: !!overlapRow?.querySelector('.flag'),
        sleptFlag: !!sleptRow?.querySelector('.flag'),
        subtractBtn: !!sleptRow && /Subtract|Restore/.test(sleptRow.textContent),
        // §12 R9: the detailed overlap banner spells out the amount + which neighbour.
        overlapBannerText: overlapRow?.querySelector('.banner.overlap')?.textContent?.trim() ?? '',
        // §12 R9: the slept-trimmed row strikes the raw duration beside the trimmed billable.
        struckText: struck?.textContent?.trim() ?? '',
        struckLineThrough,
        durText: sleptRow?.querySelector('.dur')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    });
    const bannerOk = /Overlap:\s*\d+m\s+with\s+(previous|next)\b/.test(probe.overlapBannerText);
    // The trimmed billable (3h, 03:00:00) reads as the live duration, the raw 4h (04:00:00)
    // struck through beside it — so the cut time is visible, not silently dropped.
    const strikeOk =
      probe.struckLineThrough &&
      /04:00:00/.test(probe.struckText) &&
      /03:00:00/.test(probe.durText);
    const ok =
      probe.overlapFlag && probe.sleptFlag && probe.subtractBtn && bannerOk && strikeOk;
    record(
      'FLAG_IN_CONTEXT',
      ok,
      `overlap flag + detailed banner (${JSON.stringify(probe.overlapBannerText)}) on row, slept flag + subtract + struck raw duration beside trimmed billable on slept row: ${JSON.stringify(probe)}`,
      'main-flags.png',
    );
  });

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

  // START_FORM — §12 R5: the start surface as a whole. The idle window's Start offers the
  // inline attribute form (description / client / project / tags / billable) so a timer can
  // start carrying its attributes immediately (the primary Start stays one-tap behind a
  // disclosure); while a timer runs, the surface instead offers the dedicated Switch
  // affordance (the atomic stop-then-start, §05 R8) — Switch only makes sense mid-timer, so
  // the label the start surface presents flips from Start (idle) to Switch (running). Two
  // snapshots in one item: the idle form (startFormState) opened + its five controls present,
  // and the running snapshot (switchState) where the Switch button is visible and labelled
  // 'Switch'. Captures main-start-form.png (idle form) and main-switch.png (running Switch).
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
      // The idle primary button reads Start (the one-tap quick start) and Switch is hidden.
      const toggleLabel = document.querySelector('#toggle')?.textContent?.trim() ?? null;
      const sw = document.querySelector('#switch');
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
        switchHiddenWhenIdle: !!sw && sw.hidden,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-start-form.png') });

    // The running surface: the dedicated Switch affordance is visible and labelled 'Switch'.
    // §12 R05: the Switch primary lives in the Timer view, so route there before reading it
    // (otherwise the still-hidden Timer section would report the button as display:none).
    const running = await withPage(browser, switchState(), 'index.html', async (rp) => {
      await rp.click('.nav-item[data-view="timer"]');
      await rp.waitForSelector('[data-view="timer"]:not([hidden]) #switch');
      const probe = await rp.evaluate(() => {
        const sw = document.querySelector('#switch');
        const cs = sw ? getComputedStyle(sw) : null;
        return {
          present: !!sw,
          visible: !!sw && !sw.hidden && cs.display !== 'none',
          label: sw ? sw.textContent.trim() : null,
        };
      });
      await rp.screenshot({ path: join(EVIDENCE, 'main-switch.png') });
      return probe;
    });

    const f = idle.fields;
    const formOk = idle.formVisible && f.desc && f.client && f.project && f.tags && f.bill;
    const idleLabelOk = idle.toggleLabel === 'Start' && idle.switchHiddenWhenIdle;
    const switchOk = running.present && running.visible && running.label === 'Switch';
    record(
      'START_FORM',
      formOk && idleLabelOk && switchOk,
      `idle start form fields=${JSON.stringify(idle)}; running surface offers Switch=${JSON.stringify(running)}`,
      'main-start-form.png',
    );
  });

  // ADD_FORM — the main window offers a discoverable manual-add (backfill) form with
  // explicit from/to times and the same attributes tt add accepts (description,
  // client/project, billable, tags); the Save action carries the accent (§05 R5).
  await withPage(browser, addFormState(), 'index.html', async (page) => {
    await page.click('#add-toggle');
    const probe = await page.evaluate(() => {
      const form = document.querySelector('#add-form');
      const visible = !!form && !form.hidden;
      const has = (id) => !!document.querySelector(`#${id}`);
      const save = document.querySelector('#add-go');
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const toRgb = (hex) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      return {
        visible,
        fields: {
          from: has('add-from'),
          to: has('add-to'),
          desc: has('add-desc'),
          client: has('add-client'),
          project: has('add-project'),
          bill: has('add-bill'),
          tags: has('add-tags'),
        },
        saveAccent: save ? getComputedStyle(save).backgroundColor === toRgb(accent) : false,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'add-form.png') });
    const f = probe.fields;
    const allFields = f.from && f.to && f.desc && f.client && f.project && f.bill && f.tags;
    const ok = probe.visible && allFields && probe.saveAccent;
    record('ADD_FORM', ok, `add form visible=${probe.visible}, fields=${JSON.stringify(f)}, saveAccent=${probe.saveAccent}`, 'add-form.png');
  });

  // MANUAL_ADD_FORM — §12 R7 / §06 R4: backfilling a completed entry whose span overlaps an
  // existing entry is WARNED, not blocked. Open the manual-add form, fill an overlapping
  // from/to plus the attribute fields, Save, and assert (a) the backfill payload carries the
  // explicit from/to + attributes the `add` IPC (tt add parity) forwards, (b) the SAME
  // non-blocking inline overlap banner the other write paths use is raised — the entry still
  // saved, so the form closed. The overlap-returning add mock makes this deterministic.
  await withPage(
    browser,
    addFormState(),
    'index.html',
    async (page) => {
      const beforeHidden = await page.evaluate(() => !!document.querySelector('#overlap-banner')?.hidden);
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
      // Fill the full field set the form mirrors from `tt add` — an explicit overlapping
      // span plus description / client / project / tags / billable.
      await page.fill('#add-desc', 'backfilled call');
      await page.fill('#add-client', 'Acme');
      await page.fill('#add-project', 'API');
      await page.fill('#add-tags', 'deep, urgent');
      await page.fill('#add-from', '2026-06-24T09:00');
      await page.fill('#add-to', '2026-06-24T10:00');
      await page.click('#add-go');
      await page.waitForSelector('#overlap-banner:not([hidden])', { state: 'attached' });
      await page.screenshot({ path: join(EVIDENCE, 'main-add-form.png'), fullPage: true });
      const probe = await page.evaluate(() => {
        const added = window.__ADDED__;
        const banner = document.querySelector('#overlap-banner');
        const form = document.querySelector('#add-form');
        return {
          added,
          formClosed: !!form && form.hidden, // entry saved → form dismissed (non-blocking)
          banner: {
            visible: !!banner && !banner.hidden && getComputedStyle(banner).display !== 'none',
            text: banner ? banner.textContent.trim() : '',
            role: banner ? banner.getAttribute('role') : null,
            ariaLive: banner ? banner.getAttribute('aria-live') : null,
          },
        };
      });
      const a = probe.added || {};
      const payloadOk =
        a.fromLocal === '2026-06-24T09:00' &&
        a.toLocal === '2026-06-24T10:00' &&
        a.description === 'backfilled call' &&
        a.client === 'Acme' &&
        a.project === 'API' &&
        Array.isArray(a.tags) &&
        a.tags.join(',') === 'deep,urgent' &&
        a.billable === true;
      const bannerOk =
        beforeHidden &&
        probe.banner.visible &&
        /overlap/i.test(probe.banner.text) &&
        probe.banner.role === 'status' &&
        probe.banner.ariaLive === 'polite';
      const ok = payloadOk && bannerOk && probe.formClosed;
      record(
        'MANUAL_ADD_FORM',
        ok,
        `backfill payload=${JSON.stringify(a)}; overlap warned-not-blocked (form closed=${probe.formClosed}, banner=${JSON.stringify(probe.banner)})`,
        'main-add-form.png',
      );
    },
    { overlap: true },
  );

  // ADD_FORM_PICKER — §12 R07 / §12 R15 (G9): the manual-add form's Start (#add-from) and End
  // (#add-to) text fields each expose a calendar-icon affordance that opens the shared visual
  // time-range picker (the REAL window.STP / timepicker.js component R15 ships), AND the picker
  // only ever WRITES BACK into the text inputs — the typed from/to stay authoritative. This
  // scene proves the R07 consumer contract: (a) both fields carry a picker-opening trigger;
  // (b) clicking it opens the picker seeded from the current span (the top echo mirrors the
  // bound inputs); (c) Apply flows the span back into #add-from/#add-to; (d) the text inputs
  // remain present and a subsequent Save still sends the explicit fromLocal/toLocal over the
  // `add` IPC — text entry is authoritative, never bypassed. (The drag/resize geometry +
  // overlap painting are exercised in TIME_RANGE_PICKER; here we Apply the seeded span to
  // assert the write-back/authoritative-Save path end to end.)
  await withPage(browser, addFormState(), 'index.html', async (page) => {
    await page.click('#add-toggle');
    await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
    // Seed an explicit same-day span so the renderer's overnight-uses-text fallback (G9) does
    // not fire regardless of the runner's local timezone — the picker path is what we exercise.
    await page.fill('#add-from', '2026-06-24T13:00');
    await page.fill('#add-to', '2026-06-24T14:30');
    // Assert each field has a picker-opening affordance, then open the REAL picker.
    const affordances = await page.evaluate(() => ({
      from: !!document.querySelector('#add-from-pick'),
      to: !!document.querySelector('#add-to-pick'),
      fromInput: !!document.querySelector('#add-from'),
      toInput: !!document.querySelector('#add-to'),
      hint: !!document.querySelector('#add-pickhint'),
    }));
    await page.click('#add-from-pick');
    await page.waitForSelector('.stp-backdrop .stp', { state: 'visible' });
    await page.screenshot({ path: join(EVIDENCE, 'add-form-picker.png'), fullPage: true });
    // (b) the picker opened seeded from the current span — its top echo mirrors the inputs.
    const opened = await page.evaluate(() => ({
      echoStart: document.querySelector('.stp .stp-echo-start')?.value,
      echoEnd: document.querySelector('.stp .stp-echo-end')?.value,
    }));
    const openedOk = opened.echoStart === '2026-06-24T13:00' && opened.echoEnd === '2026-06-24T14:30';
    // (c) Apply writes the seeded span back into the authoritative #add-from/#add-to inputs.
    await page.click('.stp .stp-apply');
    await page.waitForSelector('.stp-backdrop', { state: 'detached' });
    const written = await page.evaluate(() => ({
      fromValue: document.querySelector('#add-from')?.value,
      toValue: document.querySelector('#add-to')?.value,
    }));
    const writeBackOk =
      written.fromValue === '2026-06-24T13:00' && written.toValue === '2026-06-24T14:30';
    // (d) Save AFTER picker use — the explicit fromLocal/toLocal must still flow over `add`.
    await page.click('#add-go');
    await page.waitForSelector('#add-form[hidden]', { state: 'attached' }); // submit done (form closed)
    const probe = await page.evaluate(() => ({ added: window.__ADDED__ }));
    const a = probe.added || {};
    const authoritativeOk =
      a.fromLocal === written.fromValue && a.toLocal === written.toValue; // Save sent the text values
    const ok =
      affordances.from &&
      affordances.to &&
      affordances.fromInput &&
      affordances.toInput &&
      openedOk &&
      writeBackOk &&
      authoritativeOk;
    record(
      'ADD_FORM_PICKER',
      ok,
      `affordances=${JSON.stringify(affordances)}; opened-echo=${JSON.stringify(opened)}; ` +
        `wrote-back from=${written.fromValue} to=${written.toValue}; Save sent ${JSON.stringify({ fromLocal: a.fromLocal, toLocal: a.toLocal })} (text authoritative)`,
      'add-form-picker.png',
    );
  });

  // TIME_RANGE_PICKER — §12 R15 (G9): the REAL visual time-range picker (timepicker.js /
  // window.STP), driven against the real renderer (index.html). Opens from the manual-add
  // form's #add-from calendar icon; presents a month calendar + a single-day hour-line
  // track with the bound text inputs echoed at the top. The edited entry is a draggable
  // accent "me" rectangle: dragging the BODY moves start+stop together (5-min snap), and
  // dragging the BOTTOM resize handle moves only the stop (5-min snap). Other entries paint
  // gray; the overlapping span paints a yellow .stp-overlap (warn-only) while Apply still
  // works. On Apply the authoritative #add-from/#add-to text inputs hold the picked LOCAL
  // values and the popover closes. ACCENT_DISCIPLINE holds with the picker open (only the
  // primary "Apply range" button + the "me" rectangle / selected day carry the accent).
  //
  // The page is pinned to timezoneId 'UTC' so the seeded UTC otherEntries land on the same
  // local day as the filled 2026-06-24 span, making the gray/overlap geometry deterministic.
  {
    const page = await browser.newPage({ viewport: { width: 760, height: 900 }, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.install({ time: new Date(JUDGE_NOW) });
    await page.clock.pauseAt(new Date(JUDGE_NOW));
    await page.addInitScript(initScript(JSON.stringify(pickerState()), {}));
    await page.goto(fileUrl('index.html'));

    await page.click('#add-toggle');
    await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
    // Seed an explicit same-day span (UTC page → 2026-06-24 local) so the picker draws the
    // single-day column for that day and the dragged "me" rectangle is 13:00–14:30.
    await page.fill('#add-from', '2026-06-24T13:00');
    await page.fill('#add-to', '2026-06-24T14:30');

    // Open the REAL picker from the Start field's calendar icon.
    await page.click('#add-from-pick');
    await page.waitForSelector('.stp-backdrop .stp', { state: 'visible' });

    // (a) the popover presents the month calendar + the single-day hour-line track, and the
    // bound text inputs are echoed at the top.
    const present = await page.evaluate(() => ({
      cal: !!document.querySelector('.stp .stp-grid .stp-d'),
      track: !!document.querySelector('.stp .stp-track'),
      hourLines: document.querySelectorAll('.stp .stp-hour').length,
      echoStart: document.querySelector('.stp .stp-echo-start')?.value,
      echoEnd: document.querySelector('.stp .stp-echo-end')?.value,
      me: !!document.querySelector('.stp-block.me'),
      others: document.querySelectorAll('.stp-block.other').length,
    }));

    await page.screenshot({ path: join(EVIDENCE, 'time-range-picker.png'), fullPage: true });

    // Helper: read the current #add-from/#add-to values (the authoritative inputs the picker
    // writes on Apply) and the "me" rectangle geometry.
    const meBox = async () => page.evaluate(() => {
      const me = document.querySelector('.stp-block.me');
      const r = me.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, cx: r.left + r.width / 2 };
    });

    // (b) DRAG THE BODY DOWN by a known pixel delta → BOTH start+stop advance by the snapped
    // 5-min amount. Geometry: the track is 720px tall for 24h → 0.5px/min → 30px/hour. A
    // +30px body drag = +60min on both ends, snapped to 5-min. We grab the body centre and
    // move it down 30px.
    const before = await meBox();
    const grabX = Math.round(before.cx);
    const grabY = Math.round((before.top + before.bottom) / 2);
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX, grabY + 30, { steps: 6 });
    await page.mouse.up();
    const afterBody = await page.evaluate(() => ({
      start: document.querySelector('.stp .stp-echo-start')?.value,
      end: document.querySelector('.stp .stp-echo-end')?.value,
    }));
    // +30px ≈ +60min → 14:00–15:30 (both moved together, 5-min snapped).
    const bodyMovedTogether =
      afterBody.start === '2026-06-24T14:00' && afterBody.end === '2026-06-24T15:30';

    // (c) DRAG THE BOTTOM RESIZE HANDLE down by a known delta → only the STOP changes (5-min
    // snapped); the start is unchanged. +15px ≈ +30min → stop 15:30 → 16:00.
    const me2 = await meBox();
    await page.mouse.move(Math.round(me2.cx), Math.round(me2.bottom - 1));
    await page.mouse.down();
    await page.mouse.move(Math.round(me2.cx), Math.round(me2.bottom - 1 + 15), { steps: 6 });
    await page.mouse.up();
    const afterResize = await page.evaluate(() => ({
      start: document.querySelector('.stp .stp-echo-start')?.value,
      end: document.querySelector('.stp .stp-echo-end')?.value,
    }));
    const resizeMovedStopOnly =
      afterResize.start === afterBody.start && afterResize.end === '2026-06-24T16:00';

    // (d) at least one gray .stp-block.other renders, and an overlapping span paints a yellow
    // .stp-overlap (warn-only) — the 14:00–15:00 other vs the now-14:00–16:00 me span.
    const warn = await page.evaluate(() => ({
      others: document.querySelectorAll('.stp-block.other').length,
      overlaps: document.querySelectorAll('.stp-overlap').length,
      // the overlap layer never intercepts clicks (warn-only, pointer-events: none).
      overlapInert: [...document.querySelectorAll('.stp-overlap')].every(
        (el) => getComputedStyle(el).pointerEvents === 'none',
      ),
    }));

    // ACCENT_DISCIPLINE with the picker OPEN: only the primary "Apply range" button + the
    // "me" rectangle / selected calendar day carry the accent; everything else monochrome.
    const accentProbe = await page.evaluate(() => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const toRgb = (hex) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      const accentRgb = toRgb(accent);
      const sanctioned = (el) =>
        el.matches('button.primary') ||
        el.closest('button.primary') ||
        el.closest('.stp-block.me') ||
        el.closest('.stp-d.stp-sel') ||
        el.closest('.entry.running') ||
        el.closest('.timer-strip.running') ||
        el.closest('.liveedit') ||
        el.closest('.nav-item.active');
      const offenders = [];
      for (const el of document.querySelectorAll('*')) {
        if (sanctioned(el)) continue;
        const cs = getComputedStyle(el);
        if (cs.backgroundColor === accentRgb || cs.color === accentRgb) {
          offenders.push(`${el.tagName.toLowerCase()}.${el.className || '(no-class)'}`);
        }
      }
      const applyAccent =
        getComputedStyle(document.querySelector('.stp .stp-apply')).backgroundColor === accentRgb;
      const meAccent =
        getComputedStyle(document.querySelector('.stp-block.me')).backgroundColor === accentRgb;
      return { offenders, applyAccent, meAccent };
    });

    // (e) Apply → the authoritative #add-from/#add-to text inputs hold the picked LOCAL
    // values and the popover closes.
    await page.click('.stp .stp-apply');
    await page.waitForSelector('.stp-backdrop', { state: 'detached' });
    const applied = await page.evaluate(() => ({
      from: document.querySelector('#add-from')?.value,
      to: document.querySelector('#add-to')?.value,
      popoverGone: !document.querySelector('.stp-backdrop'),
    }));
    const appliedOk =
      applied.from === '2026-06-24T14:00' && applied.to === '2026-06-24T16:00' && applied.popoverGone;

    const ok =
      present.cal &&
      present.track &&
      present.hourLines > 0 &&
      present.echoStart === '2026-06-24T13:00' &&
      present.echoEnd === '2026-06-24T14:30' &&
      present.me &&
      bodyMovedTogether &&
      resizeMovedStopOnly &&
      warn.others >= 1 &&
      warn.overlaps >= 1 &&
      warn.overlapInert &&
      accentProbe.offenders.length === 0 &&
      accentProbe.applyAccent &&
      accentProbe.meAccent &&
      appliedOk;
    record(
      'TIME_RANGE_PICKER',
      ok,
      `present=${JSON.stringify(present)}; body-drag→${JSON.stringify(afterBody)} (moved-together=${bodyMovedTogether}); ` +
        `resize→${JSON.stringify(afterResize)} (stop-only=${resizeMovedStopOnly}); ` +
        `warn=${JSON.stringify(warn)}; accent offenders=[${accentProbe.offenders.join(', ') || 'none'}] ` +
        `apply=${accentProbe.applyAccent} me=${accentProbe.meAccent}; applied=${JSON.stringify(applied)}`,
      'time-range-picker.png',
    );
    await page.close();
  }

  // EDIT_RUNNING — the running entry is editable inline without stopping it (§05 R6).
  // Click the running row's Edit affordance, assert the inline form appears seeded
  // from the entry, and that the row stays in the open (.running) state — the edit
  // path never sends endUtc, so editing cannot close the open row.
  await withPage(browser, runningState(), 'index.html', async (page) => {
    const runningRow = '.entry[data-id="1"]';
    await page.click(`${runningRow} [data-act="edit"]`);
    const probe = await page.evaluate(() => {
      const row = document.querySelector('.entry[data-id="1"]');
      const form = row?.querySelector('.edit-form');
      const desc = form?.querySelector('.edit-desc');
      const start = form?.querySelector('.edit-start');
      return {
        formVisible: !!form,
        descSeeded: desc ? desc.value : null,
        startSeeded: start ? start.value.length > 0 : false,
        stillRunning: !!row && row.classList.contains('running'),
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-edit-running.png') });
    const ok =
      probe.formVisible &&
      probe.descSeeded === 'auth refactor' &&
      probe.startSeeded &&
      probe.stillRunning;
    record(
      'EDIT_RUNNING',
      ok,
      `inline edit form on running row: ${JSON.stringify(probe)}`,
      'main-edit-running.png',
    );
  });

  // EDIT_INLINE — any field of a (closed) entry is editable in-context (§06 R1). Open
  // the row's inline Edit form and assert it appears in place — not a separate page —
  // seeded from the entry: description, start, end, billable, and a client select.
  await withPage(browser, editingState(), 'index.html', async (page) => {
    const editRow = '.entry[data-id="20"]';
    await page.click(`${editRow} [data-act="edit"]`);
    // The form is appended before the async client fetch; wait for the select to fill
    // so the seeded-client assertion is deterministic.
    await page.waitForSelector(`${editRow} .edit-form .edit-client option[value="1"]`, { state: 'attached' });
    const probe = await page.evaluate(() => {
      const row = document.querySelector('.entry[data-id="20"]');
      const form = row?.querySelector('.edit-form');
      const v = (sel) => form?.querySelector(sel);
      const desc = v('.edit-desc');
      const start = v('.edit-start');
      const end = v('.edit-end');
      const bill = v('.edit-bill-box');
      const client = v('.edit-client');
      return {
        inContext: !!form && form.closest('.entry[data-id="20"]') !== null,
        descSeeded: desc ? desc.value : null,
        startSeeded: start ? start.value.length > 0 : false,
        endPresent: !!end,
        endSeeded: end ? end.value.length > 0 : false,
        billSeeded: bill ? bill.checked : null,
        // The select offers the client list and pre-selects the entry's client.
        clientOptions: client ? client.options.length : 0,
        clientSeeded: client ? client.value : null,
      };
    });
    await page.screenshot({ path: join(EVIDENCE, 'main-edit.png') });
    const ok =
      probe.inContext &&
      probe.descSeeded === 'design review' &&
      probe.startSeeded &&
      probe.endPresent &&
      probe.endSeeded &&
      probe.billSeeded === true &&
      probe.clientOptions >= 2 &&
      probe.clientSeeded === '1';
    record('EDIT_INLINE', ok, `inline edit form seeded in-context: ${JSON.stringify(probe)}`, 'main-edit.png');
  });

  // INLINE_EDITOR — §12 R6: the per-entry kebab (⋯) opens the CONSOLIDATED entry editor
  // (window.SE.openEditor) — one modal surfacing EVERY tt-editable field (description,
  // client, project, start, end, tags, billable) in one place, the GUI counterpart to
  // `tt edit`, plus the Split and Merge affordances. Drive the real renderer: click the
  // closed row's kebab, assert the editor dialog appears with an input/control for each
  // tt-editable field (the 'done when' bar) and that the Split control and the Merge
  // selection affordance are reachable; screenshot main-editor.png for visual review.
  await withPage(browser, editableState(), 'index.html', async (page) => {
    const row = '.entry[data-id="80"]';
    // The kebab opens the modal; the Client/Project selects fill from the async
    // listClients/listProjects mocks, so wait for the dialog + a populated client option.
    await page.click(`${row} [data-act="menu"]`);
    await page.waitForSelector('.editor[role="dialog"]', { state: 'attached' });
    await page.waitForSelector('.editor .ed-client option[value="1"]', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-editor.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const dialog = document.querySelector('.editor[role="dialog"]');
      const has = (sel) => !!dialog?.querySelector(sel);
      // Every tt-editable field is present as its own control (the 'done when' bar).
      const fields = {
        description: has('.ed-desc'),
        client: has('.ed-client'),
        project: has('.ed-project'),
        start: has('.ed-start'),
        end: has('.ed-end'),
        tags: has('.ed-chips'),
        billable: has('.ed-bill-box'),
      };
      // Seeded from the entry so the modal opens ready to edit (not blank).
      const descSeeded = dialog?.querySelector('.ed-desc')?.value ?? null;
      const clientSeeded = dialog?.querySelector('.ed-client')?.value ?? null;
      // Split and Merge affordances are reachable: the modal's Split control, and the row
      // multi-select that arms the toolbar/merge-bar Merge action.
      const splitReachable = has('.ed-split-btn');
      const rowSelect = !!document.querySelector('.entry[data-id="80"] [data-act="select"]');
      const mergeWiring = typeof window.SE?.mergeSelected === 'function';
      return { fields, descSeeded, clientSeeded, splitReachable, rowSelect, mergeWiring };
    });
    const f = probe.fields;
    const allFields = f.description && f.client && f.project && f.start && f.end && f.tags && f.billable;
    const ok =
      allFields &&
      probe.descSeeded === 'design review' &&
      probe.clientSeeded === '1' &&
      probe.splitReachable &&
      probe.rowSelect &&
      probe.mergeWiring;
    record(
      'INLINE_EDITOR',
      ok,
      `kebab opens the consolidated editor with every tt-editable field + Split/Merge reachable: ${JSON.stringify(probe)}`,
      'main-editor.png',
    );
  });

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
      await page.waitForSelector(`${editRow} .edit-form .edit-start`, { state: 'attached' });
      await page.click(`${editRow} .edit-form button[type="submit"]`);
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
    await page.click(`${closedRow} [data-act="split"]`);
    await page.screenshot({ path: join(EVIDENCE, 'main-split.png'), fullPage: true });
    // The inline picker seeds an instant inside the span (the midpoint) and the confirm
    // control sends it over the split IPC as a UTC ISO.
    await page.click(`${closedRow} [data-act="confirm-split"]`);
    const split = await page.evaluate(() => window.__SPLIT__);
    const ok =
      before.closedHasSplit &&
      !before.openHasSplit &&
      !!split &&
      split.id === 30 &&
      typeof split.atUtc === 'string' &&
      Date.parse(split.atUtc) > Date.parse('2026-06-24T09:00:00Z') &&
      Date.parse(split.atUtc) < Date.parse('2026-06-24T11:00:00Z');
    record(
      'SPLIT_AFFORDANCE',
      ok,
      `closed row exposes Split (open row none=${!before.openHasSplit}); split IPC: ${JSON.stringify(split)}`,
      'main-split.png',
    );
  });

  // MERGE_CONFLICT — selecting two-plus contiguous CLOSED entries reveals a Merge
  // action; merging entries that DISAGREE on client/billable raises an inline conflict
  // prompt offering the distinct client choices and a billable choice BEFORE committing
  // (§06 R3, §12 R6). The renderer sends no clientId/projectId — the winning entry's id
  // (winnerId) plus the chosen billable go to the main process, which resolves the names.
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
    // Click Merge: the selection disagrees, so a conflict prompt must appear rather than
    // a silent merge.
    await page.click('#merge-go');
    await page.waitForSelector('.merge-conflict', { state: 'attached' });
    await page.screenshot({ path: join(EVIDENCE, 'main-merge-conflict.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const panel = document.querySelector('.merge-conflict');
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
      promptShown: !!document.querySelector('.merge-conflict'),
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

  // SWITCH_AFFORDANCE — a dedicated Switch control (the atomic stop-then-start, §05
  // R8) is present and visible while running, in both the main window and the
  // popover, and absent when idle (Switch only makes sense mid-timer). Re-captures
  // the running screenshots as the presentation evidence.
  const switchVisible = (page) =>
    page.evaluate(() => {
      const el = document.querySelector('#switch');
      if (!el) return { present: false, visible: false };
      const cs = getComputedStyle(el);
      return { present: true, visible: !el.hidden && cs.display !== 'none' };
    });

  const mainRunning = await withPage(browser, runningState(), 'index.html', async (page) => {
    const probe = await switchVisible(page);
    await page.screenshot({ path: join(EVIDENCE, 'main-running.png') });
    return probe;
  });
  const popRunning = await withPage(browser, runningState(), 'popover.html', async (page) => {
    const probe = await switchVisible(page);
    await page.screenshot({ path: join(EVIDENCE, 'popover-running.png') });
    return probe;
  });
  const mainIdle = await withPage(browser, emptyState(), 'index.html', async (page) => {
    return switchVisible(page);
  });
  const switchOk =
    mainRunning.present &&
    mainRunning.visible &&
    popRunning.present &&
    popRunning.visible &&
    mainIdle.present &&
    !mainIdle.visible;
  record(
    'SWITCH_AFFORDANCE',
    switchOk,
    `Switch visible while running: main=${JSON.stringify(mainRunning)} popover=${JSON.stringify(popRunning)}; idle main=${JSON.stringify(mainIdle)}`,
    'main-running.png',
  );

  // CLIENTS_VIEW — the Clients nav view lists active clients with their projects nested,
  // and offers create/rename/archive in place; archived items drop out of the active list
  // (history kept). Click the Clients nav, assert the clients/projects render with the
  // rename + archive affordances, and that accent discipline holds on the new chrome
  // (§07, §12). The mutators are wired to the same IPC tt's client/project subcommands use.
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
      const addClient = !!document.querySelector('#add-client');
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
      probe.offenders.length === 0;
    record(
      'CLIENTS_VIEW',
      ok,
      `clients listed with nested projects, rename/archive in place, accent discipline holds: ${JSON.stringify(probe)}`,
      'main-clients.png',
    );
  });

  // TAG_CHIPS — an entry's tags show in-context as monochrome chips on its row, and the
  // running entry's tags show on the summary line; an in-context Edit tags affordance is
  // present on the rows (§07, §12). Deterministic: the fixture's open row carries 2 tags
  // and its closed row 1, so the rows paint exactly 3 chips, plus the 2 on the running
  // summary — five .chip total — and each tag's text appears.
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
        // Every row offers the in-context edit-tags affordance.
        openEditTags: !!openRow?.querySelector('[data-act="tags"]'),
        closedEditTags: !!closedRow?.querySelector('[data-act="tags"]'),
        totalRowChips: document.querySelectorAll('#entries .chip').length,
      };
    });
    const ok =
      probe.openRowChips.join(',') === 'deep,urgent' &&
      probe.closedRowChips.join(',') === 'meeting' &&
      probe.summaryChips.join(',') === 'deep,urgent' &&
      probe.openEditTags &&
      probe.closedEditTags &&
      // 2 (open row) + 1 (closed row) = 3 chips painted across the entry rows.
      probe.totalRowChips === 3;
    record(
      'TAG_CHIPS',
      ok,
      `tags render as chips on rows + running summary, in-context edit affordance present: ${JSON.stringify(probe)}`,
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
  //   (e) the sidebar nav is present with Reports active.
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
    await page.click('#rep-cancel');
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
    const ok = listOk && sidebarOk && accentOk && builderOk && editOk && runOk && exportOk;
    record(
      'REPORTS_VIEW',
      ok,
      `reports view: list=${JSON.stringify(list)} builder=${JSON.stringify(builder)} edit=${JSON.stringify(editOpen)} run=${JSON.stringify(run)} export CSV=${JSON.stringify(afterCsv)} JSON=${JSON.stringify(afterJson)}`,
      'reports-list.png',
    );
  });

  // ENTRY_LIST_SEARCH — §12 R9: the Entries-view control bar. Loading the multi-entry
  // fixture paints the default day-grouped list; typing in the search box drives a real
  // window.stint.listEntries query that narrows the visible rows (only matches remain), and
  // switching the Group-by control to Client regroups the same set into client buckets. The
  // deterministic sub-facts are machine-scored under the pinned JUDGE clock; the grouped and
  // searched looks are captured (entries-grouped.png / entries-search.png) for rubric review.
  await withPage(browser, listState(), 'index.html', async (page) => {
    // The default load paints the day-grouped getState (no control touched yet).
    await page.waitForFunction(() => document.querySelectorAll('#entries .day').length > 0);
    const before = await page.evaluate(() => ({
      // The control bar's four group-by options + default-active Day.
      byOptions: [...document.querySelectorAll('#el-by-seg .seg-btn')].map((b) => b.dataset.by),
      byActive: [...document.querySelectorAll('#el-by-seg .seg-btn.on')].map((b) => b.dataset.by),
      // The control bar is present and discoverable.
      hasPresets: !!document.querySelector('#el-preset-seg'),
      hasClientFilter: !!document.querySelector('#el-client'),
      hasTagFilter: !!document.querySelector('#el-tag'),
      hasSearch: !!document.querySelector('#search'),
      // The default day-grouped list shows every entry (4) under its day headers.
      rowCount: document.querySelectorAll('#entries .entry').length,
      groupHeads: [...document.querySelectorAll('#entries .day-head span:first-child')].map((s) => s.textContent.trim()),
    }));

    // Type a query that matches exactly the two "refactor" rows (auth refactor / refactor
    // tests). The search drives a real listEntries call; the visible rows narrow to 2.
    await page.fill('#search', 'refactor');
    await page.waitForFunction(() => window.__LIST_REQ__?.search === 'refactor');
    await page.waitForFunction(() => document.querySelectorAll('#entries .entry').length === 2);
    await page.screenshot({ path: join(EVIDENCE, 'entries-search.png'), fullPage: true });
    const onSearch = await page.evaluate(() => ({
      reqSearch: window.__LIST_REQ__?.search ?? null,
      rowCount: document.querySelectorAll('#entries .entry').length,
      descs: [...document.querySelectorAll('#entries .entry .desc')].map((d) => d.textContent),
    }));

    // Clear the search, then switch the Group-by control to Client — the same set regroups
    // into client buckets (Acme / Globex) while every row returns.
    await page.fill('#search', '');
    await page.click('#el-by-seg .seg-btn[data-by="client"]');
    await page.waitForFunction(() => window.__LIST_REQ__?.by === 'client');
    await page.waitForFunction(() => {
      const heads = [...document.querySelectorAll('#entries .day-head span:first-child')].map((s) => s.textContent.trim());
      return heads.includes('Acme') && heads.includes('Globex');
    });
    await page.screenshot({ path: join(EVIDENCE, 'entries-grouped.png'), fullPage: true });
    const onClient = await page.evaluate(() => ({
      reqBy: window.__LIST_REQ__?.by ?? null,
      byActive: [...document.querySelectorAll('#el-by-seg .seg-btn.on')].map((b) => b.dataset.by),
      groupHeads: [...document.querySelectorAll('#entries .day-head span:first-child')].map((s) => s.textContent.trim()),
      rowCount: document.querySelectorAll('#entries .entry').length,
    }));

    const controlsOk =
      before.hasPresets && before.hasClientFilter && before.hasTagFilter && before.hasSearch &&
      before.byOptions.length === 4 &&
      ['day', 'client', 'project', 'tag'].every((b) => before.byOptions.includes(b)) &&
      before.byActive.length === 1 && before.byActive[0] === 'day';
    const defaultOk = before.rowCount === 4; // all four entries visible under the day groups
    const searchOk =
      onSearch.reqSearch === 'refactor' &&
      onSearch.rowCount === 2 && // narrowed to the two "refactor" rows…
      onSearch.descs.some((d) => /auth refactor/.test(d)) &&
      onSearch.descs.some((d) => /refactor tests/.test(d)) &&
      !onSearch.descs.some((d) => /deploy pipeline/.test(d)); // …non-matches excluded
    const groupOk =
      onClient.reqBy === 'client' &&
      onClient.byActive.length === 1 && onClient.byActive[0] === 'client' &&
      onClient.groupHeads.includes('Acme') && onClient.groupHeads.includes('Globex') &&
      onClient.rowCount === 4; // every row returns once the search is cleared
    const ok = controlsOk && defaultOk && searchOk && groupOk;
    record(
      'ENTRY_LIST_SEARCH',
      ok,
      `entry list: default=${JSON.stringify(before)} → search=${JSON.stringify(onSearch)} → by client=${JSON.stringify(onClient)}`,
      'entries-grouped.png',
    );
  });

  // LIVE_FILTER — §17 R11: a search / filter / group selection is reflected LIVE in BOTH the
  // visible list AND the report total, recomputed from the in-memory snapshot with no IPC
  // reload (no getState). Load the multi-entry fixture (all four rows billable, 5.00h total),
  // type a "refactor" search, and assert in one keystroke: the visible rows narrow to the two
  // refactor entries AND #week-total drops from 5.00h to the filtered 3.50h — the total moved
  // off the snapshot-derived report sum (window.SU.deriveView), not a round-trip. Then clear
  // the search and confirm the list and the total both return to the full set.
  await withPage(browser, liveState(), 'index.html', async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('#entries .entry').length > 0);
    const before = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#entries .entry').length,
      weekTotal: document.querySelector('#week-total')?.textContent.trim() ?? null,
      // The getState count right before the keystroke — the live update must not reload it.
      getStateCalls: window.__GETSTATE_CALLS__ ?? 0,
    }));
    // Type the search — the list narrows AND the total recomputes off the snapshot, live.
    await page.fill('#search', 'refactor');
    await page.waitForFunction(() => document.querySelectorAll('#entries .entry').length === 2);
    await page.waitForFunction(
      (t) => document.querySelector('#week-total')?.textContent.trim() !== t,
      before.weekTotal,
    );
    await page.screenshot({ path: join(EVIDENCE, 'main-filtered.png'), fullPage: true });
    const onSearch = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#entries .entry').length,
      weekTotal: document.querySelector('#week-total')?.textContent.trim() ?? null,
      descs: [...document.querySelectorAll('#entries .entry .desc')].map((d) => d.textContent),
      // The absolute getState count after the keystroke — unchanged from `before` proves the
      // list + total updated off the snapshot, with no reload during the keystroke.
      getStateCalls: window.__GETSTATE_CALLS__ ?? 0,
    }));
    const noReloadOnSearch = onSearch.getStateCalls === before.getStateCalls;
    // Clear the search — both the list and the total return to the full set.
    await page.fill('#search', '');
    await page.waitForFunction(() => document.querySelectorAll('#entries .entry').length === 4);
    await page.waitForFunction(
      (t) => document.querySelector('#week-total')?.textContent.trim() === t,
      before.weekTotal,
    );
    const onClear = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#entries .entry').length,
      weekTotal: document.querySelector('#week-total')?.textContent.trim() ?? null,
    }));

    const listLiveOk =
      before.rowCount === 4 &&
      onSearch.rowCount === 2 &&
      onSearch.descs.some((d) => /auth refactor/.test(d)) &&
      onSearch.descs.some((d) => /refactor tests/.test(d)) &&
      !onSearch.descs.some((d) => /deploy pipeline/.test(d));
    const totalLiveOk =
      before.weekTotal === '5.00h' &&
      onSearch.weekTotal === '3.50h' && // the report total moved on the same keystroke…
      onClear.rowCount === 4 &&
      onClear.weekTotal === '5.00h'; // …and returns with the full set when cleared
    const ok = listLiveOk && totalLiveOk && noReloadOnSearch;
    record(
      'LIVE_FILTER',
      ok,
      `live filter: list ${before.rowCount}→${onSearch.rowCount}→${onClear.rowCount} rows, ` +
        `report total ${before.weekTotal}→${onSearch.weekTotal}→${onClear.weekTotal} ` +
        `(both reflect the selection live; getState unchanged during the keystroke: ${noReloadOnSearch})`,
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
    'unscored here — screenshots captured for rubric/human scoring (main-empty, main-running, main-timer, main-flags, main-edit, main-editor, main-tags, main-report-client, main-report-day, main-focus, popover-running)',
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
