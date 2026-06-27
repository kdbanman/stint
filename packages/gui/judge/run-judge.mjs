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
import { emptyState, runningState, flaggedState, startFormState, switchState, addFormState, editingState, editableState, splittableState, mergeConflictState, mergeAgreeState, overlapWriteState, clientsState, taggedState, listState, liveState, reportState, reportSummaryState, roundingState, settingsState, initScript, JUDGE_NOW } from './fixtures.mjs';
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

  // NAV_SHELL — §12 R3: the main window presents a persistent left-hand nav with the five
  // views (Timer / Entries / Clients / Reports / Settings); the current view is highlighted
  // and each item routes to its view. Drive the real renderer: assert the five nav items in
  // order, exactly one active by default (Entries) showing its view, then click a different
  // item (Settings) and assert the active highlight + the visible .view both moved. Captures
  // main-nav.png as the rubric evidence for the "quiet desktop shell" line.
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
      orderOk && defaultOk && routedOk,
      `nav order ${JSON.stringify(before.labels)}; default active=${before.activeView} (one view shown); ` +
        `clicking Settings routed: active=${JSON.stringify(after.active)} visible=${JSON.stringify(after.visibleViews)}`,
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
    // Focus the primary toggle and screenshot it so the ring is visible evidence.
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

  // IN_WINDOW_TIMER (main window) — §12 R4: the main window shows an Active-Timer card that
  // mirrors `tt status`: a live per-second count-up, the running state, the running entry's
  // description + client/project, and Stop + Switch actions. Drive the real renderer on
  // index.html with the running fixture and assert (a) the card clock reads the derived
  // count-up and advances +3s across a pinned-clock step (same technique as TRAY_COUNTUP),
  // (b) the card text carries the running description ('auth refactor') and the client/project
  // label ('Client A / API'), and (c) both a Stop and a Switch control are present. Captures
  // main-timer.png as the rubric evidence for the in-window card quality.
  await withPage(browser, runningState(), 'index.html', async (page) => {
    const t1 = await page.textContent('#timer-clock');
    await page.screenshot({ path: join(EVIDENCE, 'main-timer.png') });
    // Advance exactly 3s and stay frozen there (pauseAt, not fastForward) so the second
    // read is reproducible — the card's tick() must have advanced the count-up.
    await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + 3000));
    const probe = await page.evaluate(() => {
      const card = document.querySelector('#timer-card');
      return {
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
    const ok =
      t1 === '01:24:07' &&
      delta === 3 &&
      probe.running &&
      probe.state === 'running' &&
      probe.desc === 'auth refactor' &&
      /Client A \/ API/.test(probe.meta) &&
      probe.hasStop &&
      probe.hasSwitch;
    record(
      'IN_WINDOW_TIMER',
      ok,
      `in-window Active-Timer card count advanced ${t1} → ${probe.clock} (+${delta}s); ${JSON.stringify(probe)}`,
      'main-timer.png',
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
        // §12 R4: the in-window Active-Timer card's running affordance — the live count-up
        // clock and the running-state indicator carry the system accent (mirroring the
        // popover's running count). The whole running card container is sanctioned so the
        // count-up accent is not flagged as a stray (the idle card and the Switch button
        // stay monochrome).
        el.closest('.timer-card.running') ||
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
    // The disclosure starts collapsed; open it, fill the optional fields, submit.
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
    // Open the disclosure and confirm every optional attribute control is present.
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
    const running = await withPage(browser, switchState(), 'index.html', async (rp) => {
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

  // REPORT_BILLABLE_TOGGLE — the report builder offers the §08 R3 three-way Billable
  // control (Billable only / All / Non-billable) as a single discoverable segmented
  // control; exactly one segment is active by default (Billable only); clicking All and
  // Non-billable re-runs window.stint.report with the matching billableFilter and changes
  // the rendered total (§08 R3, §12 R8). Deterministic sub-facts are machine-scored; the
  // overall look is captured for rubric review.
  await withPage(browser, reportState(), 'report.html', async (page) => {
    // The report runs once on load; wait for the painted total before probing.
    await page.waitForFunction(() => document.querySelector('#report-total')?.textContent.trim().length > 0);
    const seg = '#billable-seg';
    const before = await page.evaluate((sel) => {
      const btns = [...document.querySelectorAll(`${sel} .seg-btn`)];
      const active = btns.filter((b) => b.classList.contains('on'));
      return {
        labels: btns.map((b) => b.textContent.trim()),
        activeCount: active.length,
        activeFilter: active[0]?.dataset.billable ?? null,
        loadFilter: window.__REPORT_REQ__?.billableFilter ?? null,
        total: document.querySelector('#report-total').textContent.trim(),
      };
    }, seg);
    await page.screenshot({ path: join(EVIDENCE, 'report-billable.png'), fullPage: true });

    // Switch to All — the report re-runs with billableFilter 'all' and the total changes.
    await page.click(`${seg} .seg-btn[data-billable="all"]`);
    await page.waitForFunction(
      (t) => document.querySelector('#report-total').textContent.trim() !== t,
      before.total,
    );
    const onAll = await page.evaluate((sel) => ({
      reqFilter: window.__REPORT_REQ__?.billableFilter ?? null,
      activeFilter: [...document.querySelectorAll(`${sel} .seg-btn.on`)].map((b) => b.dataset.billable),
      total: document.querySelector('#report-total').textContent.trim(),
    }), seg);

    // Switch to Non-billable — re-runs with 'non-billable' and the total changes again.
    await page.click(`${seg} .seg-btn[data-billable="non-billable"]`);
    await page.waitForFunction(
      (t) => document.querySelector('#report-total').textContent.trim() !== t,
      onAll.total,
    );
    const onNon = await page.evaluate((sel) => ({
      reqFilter: window.__REPORT_REQ__?.billableFilter ?? null,
      activeFilter: [...document.querySelectorAll(`${sel} .seg-btn.on`)].map((b) => b.dataset.billable),
      total: document.querySelector('#report-total').textContent.trim(),
    }), seg);

    const labelsOk =
      before.labels.includes('Billable only') &&
      before.labels.includes('All') &&
      before.labels.includes('Non-billable');
    const defaultOk = before.activeCount === 1 && before.activeFilter === 'billable' && before.loadFilter === 'billable';
    const allOk = onAll.reqFilter === 'all' && onAll.activeFilter.length === 1 && onAll.activeFilter[0] === 'all' && onAll.total !== before.total;
    const nonOk =
      onNon.reqFilter === 'non-billable' &&
      onNon.activeFilter.length === 1 &&
      onNon.activeFilter[0] === 'non-billable' &&
      onNon.total !== onAll.total &&
      onNon.total !== before.total;
    const ok = labelsOk && defaultOk && allOk && nonOk;
    record(
      'REPORT_BILLABLE_TOGGLE',
      ok,
      `billable toggle: default=${JSON.stringify(before)} → all=${JSON.stringify(onAll)} → non-billable=${JSON.stringify(onNon)}`,
      'report-billable.png',
    );
  });

  // REPORT_RANGE_PICKER — §09 R1: the report view's date-range picker. The five named
  // presets render as labelled chips with This week active by default; a Custom mode
  // exposes explicit from/to inputs. The presets resolve through core (the renderer sends
  // the preset NAME over the report IPC, never re-deriving date math); selecting a chip or
  // applying a custom range repaints the visible resolved-range header + grouped rows.
  // Deterministic sub-facts are machine-scored under the pinned JUDGE clock; the look is
  // captured (reports-default.png / reports-custom.png) for rubric review.
  await withPage(browser, reportState(), 'report.html', async (page) => {
    // The report runs once on load (default This week); wait for the painted range header.
    await page.waitForFunction(() => document.querySelector('#report-range')?.textContent.trim().length > 0);
    const seg = '#preset-seg';
    const before = await page.evaluate((sel) => {
      const chips = [...document.querySelectorAll(`${sel} .preset`)];
      const active = chips.filter((c) => c.classList.contains('on'));
      return {
        labels: chips.map((c) => c.textContent.trim()),
        presets: chips.map((c) => c.dataset.preset),
        activeCount: active.length,
        activePreset: active[0]?.dataset.preset ?? null,
        loadPreset: window.__REPORT_REQ__?.preset ?? null,
        customFrom: !!document.querySelector('#range-from'),
        customTo: !!document.querySelector('#range-to'),
        customHidden: !!document.querySelector('#custom-range')?.hidden,
        rangeHeader: document.querySelector('#report-range').textContent.trim(),
        rows: [...document.querySelectorAll('#report-rows .report-grp td:first-child')].map((t) => t.textContent.trim()),
        total: document.querySelector('#report-total').textContent.trim(),
      };
    }, seg);
    await page.screenshot({ path: join(EVIDENCE, 'reports-default.png'), fullPage: true });

    // Select Last week — the report re-runs with preset 'last-week'; the resolved-range
    // header and the grouped rows change to that window's distinct fixture.
    await page.click(`${seg} .preset[data-preset="last-week"]`);
    await page.waitForFunction(
      (h) => document.querySelector('#report-range').textContent.trim() !== h,
      before.rangeHeader,
    );
    const onLastWeek = await page.evaluate((sel) => ({
      reqPreset: window.__REPORT_REQ__?.preset ?? null,
      activePreset: [...document.querySelectorAll(`${sel} .preset.on`)].map((c) => c.dataset.preset),
      rangeHeader: document.querySelector('#report-range').textContent.trim(),
      rows: [...document.querySelectorAll('#report-rows .report-grp td:first-child')].map((t) => t.textContent.trim()),
      total: document.querySelector('#report-total').textContent.trim(),
    }), seg);

    // Switch to Custom — the from/to inputs reveal; fill an explicit window and Apply. The
    // report re-runs with explicit fromUtc/toUtc (no preset) and repaints the header/rows.
    await page.click(`${seg} .preset[data-preset="custom"]`);
    await page.waitForSelector('#custom-range:not([hidden])', { state: 'attached' });
    await page.fill('#range-from', '2026-06-10T00:00');
    await page.fill('#range-to', '2026-06-13T00:00');
    await page.click('#range-apply');
    await page.waitForFunction(
      (h) => document.querySelector('#report-range').textContent.trim() !== h,
      onLastWeek.rangeHeader,
    );
    await page.screenshot({ path: join(EVIDENCE, 'reports-custom.png'), fullPage: true });
    const onCustom = await page.evaluate((sel) => ({
      req: window.__REPORT_REQ__,
      activePreset: [...document.querySelectorAll(`${sel} .preset.on`)].map((c) => c.dataset.preset),
      customVisible: !document.querySelector('#custom-range')?.hidden,
      rangeHeader: document.querySelector('#report-range').textContent.trim(),
      total: document.querySelector('#report-total').textContent.trim(),
    }), seg);

    const labelsOk =
      before.labels.includes('Today') &&
      before.labels.includes('This week') &&
      before.labels.includes('Last week') &&
      before.labels.includes('This month') &&
      before.labels.includes('Last month');
    const fiveCorePresets = ['today', 'week', 'last-week', 'month', 'last-month'].every((p) => before.presets.includes(p));
    const defaultOk =
      before.activeCount === 1 &&
      before.activePreset === 'week' &&
      before.loadPreset === 'week' &&
      before.customFrom &&
      before.customTo &&
      before.customHidden && // custom inputs present but hidden until chosen
      before.rangeHeader.length > 0;
    const lastWeekOk =
      onLastWeek.reqPreset === 'last-week' &&
      onLastWeek.activePreset.length === 1 &&
      onLastWeek.activePreset[0] === 'last-week' &&
      onLastWeek.rangeHeader !== before.rangeHeader &&
      onLastWeek.rows.join(',') !== before.rows.join(',');
    const customOk =
      !!onCustom.req &&
      onCustom.req.preset === undefined &&
      typeof onCustom.req.fromUtc === 'string' &&
      typeof onCustom.req.toUtc === 'string' &&
      onCustom.activePreset.length === 1 &&
      onCustom.activePreset[0] === 'custom' &&
      onCustom.customVisible &&
      onCustom.rangeHeader !== onLastWeek.rangeHeader;
    const ok = labelsOk && fiveCorePresets && defaultOk && lastWeekOk && customOk;
    record(
      'REPORT_RANGE_PICKER',
      ok,
      `range picker: default=${JSON.stringify(before)} → last-week=${JSON.stringify(onLastWeek)} → custom=${JSON.stringify(onCustom)}`,
      'reports-default.png',
    );
  });

  // REPORT_GROUPING — §09 R2: the report view's Group-by control. The four groupings
  // (Client / Project / Day / Tag) render as a single segmented control with exactly one
  // active segment (Client by default); clicking a segment re-runs window.stint.report with
  // the matching `by` and regroups the same week's totals into different lines while the
  // grand total stays put (grouping is invariant on the total). Deterministic sub-facts are
  // machine-scored under the pinned JUDGE clock; the grouped look is captured
  // (main-report-client.png / main-report-day.png) for rubric/human review.
  await withPage(browser, reportState(), 'report.html', async (page) => {
    // The report runs once on load (default Client grouping); wait for the painted rows.
    await page.waitForFunction(() => document.querySelectorAll('#report-rows .report-grp').length > 0);
    const seg = '#by-seg';
    const before = await page.evaluate((sel) => {
      const btns = [...document.querySelectorAll(`${sel} .seg-btn`)];
      const active = btns.filter((b) => b.classList.contains('on'));
      return {
        labels: btns.map((b) => b.textContent.trim()),
        options: btns.map((b) => b.dataset.by),
        activeCount: active.length,
        activeBy: active[0]?.dataset.by ?? null,
        loadBy: window.__REPORT_REQ__?.by ?? null,
        rows: [...document.querySelectorAll('#report-rows .report-grp td:first-child')].map((t) => t.textContent.trim()),
        total: document.querySelector('#report-grand').textContent.trim(),
      };
    }, seg);
    await page.screenshot({ path: join(EVIDENCE, 'main-report-client.png'), fullPage: true });

    // Switch to Day — the report re-runs with by 'day'; the grouped rows change to the
    // day buckets while the grand total (5h) is unchanged (grouping-invariant).
    await page.click(`${seg} .seg-btn[data-by="day"]`);
    await page.waitForFunction(
      (r) => [...document.querySelectorAll('#report-rows .report-grp td:first-child')].map((t) => t.textContent.trim()).join(',') !== r,
      before.rows.join(','),
    );
    await page.screenshot({ path: join(EVIDENCE, 'main-report-day.png'), fullPage: true });
    const onDay = await page.evaluate((sel) => ({
      reqBy: window.__REPORT_REQ__?.by ?? null,
      activeBy: [...document.querySelectorAll(`${sel} .seg-btn.on`)].map((b) => b.dataset.by),
      rows: [...document.querySelectorAll('#report-rows .report-grp td:first-child')].map((t) => t.textContent.trim()),
      total: document.querySelector('#report-grand').textContent.trim(),
    }), seg);

    const labelsOk =
      before.labels.includes('Client') &&
      before.labels.includes('Project') &&
      before.labels.includes('Day') &&
      before.labels.includes('Tag');
    const fourOptions =
      before.options.length === 4 &&
      ['client', 'project', 'day', 'tag'].every((b) => before.options.includes(b));
    const defaultOk = before.activeCount === 1 && before.activeBy === 'client' && before.loadBy === 'client';
    const dayOk =
      onDay.reqBy === 'day' &&
      onDay.activeBy.length === 1 &&
      onDay.activeBy[0] === 'day' &&
      onDay.rows.join(',') !== before.rows.join(',') && // regrouped into different lines…
      onDay.total === before.total; // …but the grand total is grouping-invariant
    const ok = labelsOk && fourOptions && defaultOk && dayOk;
    record(
      'REPORT_GROUPING',
      ok,
      `group-by: default=${JSON.stringify(before)} → day=${JSON.stringify(onDay)}`,
      'main-report-client.png',
    );
  });

  // REPORT_FILTERS — §09 R3: the report view's client / project / tag filters (alongside
  // the already-covered billable filter). All four filter controls are present; changing
  // the Billable control and then the Client filter each re-invokes window.stint.report
  // with the matching params (billableFilter / clientId) and re-renders the grouped rows +
  // total. The renderer resolves no names — the client filter sends the entity id straight
  // from listClients. Deterministic sub-facts are machine-scored under the pinned JUDGE
  // clock; the filtered look is captured (report-filters.png) for rubric/human review.
  await withPage(browser, reportState(), 'report.html', async (page) => {
    // The report runs once on load (no filter); wait for the painted rows + the populated
    // client filter (its options arrive from the async listClients mock).
    await page.waitForFunction(() => document.querySelectorAll('#report-rows .report-grp').length > 0);
    await page.waitForFunction(() => document.querySelectorAll('#f-client option').length > 1);
    const before = await page.evaluate(() => ({
      // All four filter controls are present and discoverable.
      hasClient: !!document.querySelector('#f-client'),
      hasProject: !!document.querySelector('#f-project'),
      hasTag: !!document.querySelector('#f-tag'),
      hasBillable: !!document.querySelector('#billable-seg'),
      // The client filter offers "All clients" (no filter) plus the canned clients.
      clientOptions: [...document.querySelectorAll('#f-client option')].map((o) => o.textContent.trim()),
      // The project filter starts disabled until a client is chosen.
      projectDisabled: document.querySelector('#f-project').disabled,
      loadReq: window.__REPORT_REQ__,
      total: document.querySelector('#report-grand').textContent.trim(),
      rows: [...document.querySelectorAll('#report-rows .report-grp td:first-child')].map((t) => t.textContent.trim()),
    }));

    // Change the Billable control to All — the report re-runs with billableFilter 'all'.
    await page.click('#billable-seg .seg-btn[data-billable="all"]');
    await page.waitForFunction(() => window.__REPORT_REQ__?.billableFilter === 'all');
    const onAll = await page.evaluate(() => ({
      reqFilter: window.__REPORT_REQ__?.billableFilter ?? null,
    }));
    // Reset to billable-only so the client-filter assertion below reads the default total.
    await page.click('#billable-seg .seg-btn[data-billable="billable"]');
    await page.waitForFunction(() => window.__REPORT_REQ__?.billableFilter === 'billable');
    const baseTotal = await page.evaluate(() => document.querySelector('#report-grand').textContent.trim());

    // Choose a client — the report re-runs carrying that client's id, the rows narrow to it,
    // and the project filter is enabled for the chosen client.
    await page.selectOption('#f-client', { label: 'Acme' });
    await page.waitForFunction(() => window.__REPORT_REQ__?.clientId != null);
    await page.screenshot({ path: join(EVIDENCE, 'report-filters.png'), fullPage: true });
    const onClient = await page.evaluate(() => ({
      reqClientId: window.__REPORT_REQ__?.clientId ?? null,
      projectEnabled: !document.querySelector('#f-project').disabled,
      total: document.querySelector('#report-grand').textContent.trim(),
      rows: [...document.querySelectorAll('#report-rows .report-grp td:first-child')].map((t) => t.textContent.trim()),
    }));

    const controlsOk = before.hasClient && before.hasProject && before.hasTag && before.hasBillable;
    const defaultOk =
      before.clientOptions.includes('All clients') &&
      before.clientOptions.includes('Acme') &&
      before.projectDisabled && // project filter disabled until a client is chosen
      // The load request carries no client/project/tag filter (the "no filter" default).
      before.loadReq.clientId === undefined &&
      before.loadReq.projectId === undefined &&
      before.loadReq.tag === undefined;
    const billableReran = onAll.reqFilter === 'all';
    const clientReran =
      typeof onClient.reqClientId === 'number' &&
      onClient.projectEnabled &&
      onClient.total !== baseTotal && // the filtered total differs from the unfiltered one…
      onClient.rows.join(',') !== before.rows.join(','); // …and the rows re-rendered
    const ok = controlsOk && defaultOk && billableReran && clientReran;
    record(
      'REPORT_FILTERS',
      ok,
      `report filters: controls present=${controlsOk}, default=${JSON.stringify(before)} → billable 'all' reran=${billableReran} → client=${JSON.stringify(onClient)} (base total ${baseTotal})`,
      'report-filters.png',
    );
  });

  // ROUNDING_TOGGLE — §09 R4 / §12 R8: the report view's rounding control group. An Off/On
  // toggle plus a 6/10/15/30-min increment picker. The displayed billable line equals the
  // ROUNDED total when rounding is on and the EXACT total when off — over a total (1h 37m)
  // that is NOT a clean multiple of any increment, so the line visibly moves. The increment
  // picker is disabled when rounding is off (a secondary choice). Both controls persist the
  // choice through setSetting (the same channel tt config set uses — no new channel) and
  // re-run the report. Stored time is never touched — only the displayed line rounds, and
  // core rounds nearest (not always up: 1h37m → nearest 15 is 1h30m, rounding DOWN).
  await withPage(
    browser,
    roundingState(),
    'report.html',
    async (page) => {
      // The view loads with rounding ON (the fixture's settings), so the painted line is the
      // rounded total; wait for it before probing.
      await page.waitForFunction(() => document.querySelector('#report-grand')?.textContent.trim().length > 0);
      const onState = await page.evaluate(() => {
        const inc = document.querySelector('#rounding-increment');
        return {
          toggleChecked: document.querySelector('#rounding')?.checked ?? null,
          incrementOptions: [...(inc?.options ?? [])].map((o) => o.value),
          activeIncrement: inc?.value ?? null,
          incrementDisabled: inc?.disabled ?? null,
          line: document.querySelector('#report-grand').textContent.trim(),
          setSetting: window.__SET_SETTING__ ?? null,
        };
      });
      await page.screenshot({ path: join(EVIDENCE, 'reports-rounding.png'), fullPage: true });

      // Turn rounding OFF — the line must switch to the EXACT total (1h 37m) and the toggle
      // persists { key: 'rounding', value: false } over setSetting.
      await page.click('#rounding');
      await page.waitForFunction((t) => document.querySelector('#report-grand').textContent.trim() !== t, onState.line);
      const offState = await page.evaluate(() => ({
        toggleChecked: document.querySelector('#rounding')?.checked ?? null,
        incrementDisabled: document.querySelector('#rounding-increment')?.disabled ?? null,
        line: document.querySelector('#report-grand').textContent.trim(),
        setSetting: window.__SET_SETTING__ ?? null,
      }));

      // Turn rounding back ON, then pick the 30-min increment — the line re-rounds to the
      // chosen increment (1h 30m), persisting { key: 'roundingIncrementMin', value: 30 }.
      await page.click('#rounding');
      await page.waitForFunction((t) => document.querySelector('#report-grand').textContent.trim() !== t, offState.line);
      await page.selectOption('#rounding-increment', '30');
      await page.waitForFunction(() => window.__SET_SETTING__?.key === 'roundingIncrementMin');
      const onIncrement = await page.evaluate(() => ({
        setSetting: window.__SET_SETTING__ ?? null,
        line: document.querySelector('#report-grand').textContent.trim(),
      }));

      const optionsOk = ['6', '10', '15', '30'].every((v) => onState.incrementOptions.includes(v));
      const defaultOnOk =
        onState.toggleChecked === true &&
        onState.activeIncrement === '15' &&
        onState.incrementDisabled === false &&
        onState.line === '1h 30m'; // rounded nearest 15 (1h37m rounds DOWN to 1h30m)
      const offOk =
        offState.toggleChecked === false &&
        offState.incrementDisabled === true && // picker de-emphasized/disabled when off
        offState.line === '1h 37m' && // exact total when rounding off
        !!offState.setSetting &&
        offState.setSetting.key === 'rounding' &&
        offState.setSetting.value === false;
      const incrementOk =
        !!onIncrement.setSetting &&
        onIncrement.setSetting.key === 'roundingIncrementMin' &&
        onIncrement.setSetting.value === 30 &&
        onIncrement.line === '1h 30m'; // nearest 30 of 1h37m is 1h30m
      const ok = optionsOk && defaultOnOk && offOk && incrementOk;
      record(
        'ROUNDING_TOGGLE',
        ok,
        `rounding controls: on(default)=${JSON.stringify(onState)} → off=${JSON.stringify(offState)} → increment 30=${JSON.stringify(onIncrement)}`,
        'reports-rounding.png',
      );
    },
    { rounding: true },
  );

  // REPORT_SUMMARY — §09 R6 / §12 R8: the report view's on-screen grouped summary with flags
  // in context plus the two Export buttons. The flag-carrying REPORT_SUMMARY report paints a
  // client→project nested grouping with ONE overlap flag (Globex / Q3 Strategy) and ONE
  // unreviewed-sleep flag (Initech / Market research) on their affected rows. The scene
  // asserts: the grouped summary renders the grand + per-line totals; the flags appear ON the
  // affected summary rows (not in a separate list); and the Export CSV / Export JSON buttons
  // are present, monochrome (accent-disciplined), and each drives a real exportEntries call
  // carrying the chosen format + the shown range. Captures reports-summary.png.
  await withPage(
    browser,
    reportSummaryState(),
    'report.html',
    async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('#report-rows .report-grp').length > 0);
      await page.screenshot({ path: join(EVIDENCE, 'reports-summary.png'), fullPage: true });
      const probe = await page.evaluate(() => {
        const txt = (el) => (el ? el.textContent.trim() : null);
        // The grouped summary: group rows (client) + indented sub-rows (project).
        const groups = [...document.querySelectorAll('#report-rows .report-grp td:first-child')].map((t) => t.textContent.trim());
        const subs = [...document.querySelectorAll('#report-rows .report-sub td:first-child')].map((t) => t.textContent.trim());
        // Per-line totals (the second column of every painted row) and the grand total.
        const lineTotals = [...document.querySelectorAll('#report-rows tr td.num')].map((t) => t.textContent.trim());
        // Flags are surfaced IN CONTEXT: the .report-flag chips live inside the summary rows,
        // and there is no separate flag list element outside the table.
        const flagRows = [...document.querySelectorAll('#report-rows tr')]
          .filter((tr) => tr.querySelector('.report-flag'))
          .map((tr) => ({
            label: tr.querySelector('td:first-child')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
            flags: [...tr.querySelectorAll('.report-flag')].map((f) => f.textContent.trim()),
          }));
        const flagInTable = document.querySelectorAll('#report-rows .report-flag').length;
        const flagOutsideTable = [...document.querySelectorAll('.report-flag')].filter(
          (f) => !f.closest('#report-rows'),
        ).length;
        // The two export buttons, and whether either paints the accent (a discipline break).
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const toRgb = (hex) => {
          const n = parseInt(hex.replace('#', ''), 16);
          return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
        };
        const accentRgb = toRgb(accent);
        const csv = document.querySelector('#export-csv');
        const json = document.querySelector('#export-json');
        const isAccented = (el) => {
          if (!el) return false;
          const cs = getComputedStyle(el);
          return cs.backgroundColor === accentRgb || cs.color === accentRgb;
        };
        return {
          groups,
          subs,
          lineTotals,
          grand: txt(document.querySelector('#report-grand')),
          headTotal: txt(document.querySelector('#report-total')),
          flagRows,
          flagInTable,
          flagOutsideTable,
          hasCsv: !!csv && /Export CSV/i.test(csv.textContent),
          hasJson: !!json && /Export JSON/i.test(json.textContent),
          exportAccented: isAccented(csv) || isAccented(json),
        };
      });

      // Click Export CSV, then Export JSON — each must drive a real exportEntries call
      // carrying the chosen format and the shown range (preset 'week' by default).
      await page.click('#export-csv');
      await page.waitForFunction(() => window.__EXPORTED__?.format === 'csv');
      const afterCsv = await page.evaluate(() => ({ ...window.__EXPORTED__ }));
      await page.click('#export-json');
      await page.waitForFunction(() => window.__EXPORTED__?.format === 'json');
      const afterJson = await page.evaluate(() => ({ ...window.__EXPORTED__ }));

      const summaryOk =
        probe.groups.some((g) => g.includes('Globex')) &&
        probe.groups.some((g) => g.includes('Initech')) &&
        probe.subs.some((s) => s.includes('Q3 Strategy')) &&
        probe.subs.some((s) => s.includes('Market research')) &&
        // Per-line totals are painted (one per row) and the grand total reads 21h 35m.
        probe.lineTotals.length >= probe.groups.length + probe.subs.length &&
        probe.grand === '21h 35m' &&
        probe.headTotal === '21h 35m';
      const flagsInContextOk =
        probe.flagInTable >= 2 && // both flags rendered…
        probe.flagOutsideTable === 0 && // …and NONE outside the summary table (no separate list)
        probe.flagRows.some((r) => /Q3 Strategy/.test(r.label) && r.flags.includes('overlap')) &&
        probe.flagRows.some((r) => /Market research/.test(r.label) && r.flags.includes('unreviewed sleep'));
      const exportOk =
        probe.hasCsv &&
        probe.hasJson &&
        !probe.exportAccented && // export buttons stay monochrome (§15 accent discipline)
        afterCsv.format === 'csv' &&
        afterJson.format === 'json' &&
        afterCsv.preset === 'week' && // exports the shown range (the default This-week preset)
        afterJson.preset === 'week';
      const ok = summaryOk && flagsInContextOk && exportOk;
      record(
        'REPORT_SUMMARY',
        ok,
        `report summary: ${JSON.stringify(probe)} → export CSV=${JSON.stringify(afterCsv)} JSON=${JSON.stringify(afterJson)}`,
        'reports-summary.png',
      );
    },
    { summary: true },
  );

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
  // first check-in, check-in interval, global hotkey, accent usage, date format), each wired
  // to window.stint.setSetting. Drive the real renderer: click the Settings nav, assert all
  // eight controls render and that changing the accent-usage select fires setSetting with the
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
        allEight:
          has('rounding') &&
          has('roundingIncrementMin') &&
          has('weekStart') &&
          has('firstCheckinMin') &&
          has('checkinIntervalMin') &&
          has('globalHotkey') &&
          has('accent') &&
          has('dateFormat'),
        offenders,
      };
    });

    // Changing the accent-usage select fires a real setSetting with the chosen key/value.
    await page.selectOption('.set-field[data-key="accent"]', 'monochrome');
    await page.waitForFunction(() => window.__SET_SETTING__?.key === 'accent');
    const set = await page.evaluate(() => window.__SET_SETTING__);

    const ok =
      probe.visible &&
      probe.allEight &&
      probe.offenders.length === 0 &&
      !!set &&
      set.key === 'accent' &&
      set.value === 'monochrome';
    record(
      'SETTINGS_VIEW',
      ok,
      `settings panel exposes all eight §14 controls (${JSON.stringify(probe.keys)}), accent discipline holds (offenders=[${probe.offenders.join(', ') || 'none'}]), accent-usage edit fired setSetting=${JSON.stringify(set)}`,
      'main-settings.png',
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
  // scores against acceptance/judge-rubric.md.
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
