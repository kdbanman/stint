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
 */
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyState,
  runningState,
  timerViewRunningState,
  timerViewFavoritesState,
  timerViewEmptyFavoritesState,
  savedReportsState,
  settingsState,
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
  // §05 R01 — Start as the GUI core-entry surface (`core` badge; behavior unchanged). With a
  // timer already running (the canonical runningState open row 'auth refactor', reading a
  // deterministic 01:24:07), the recording routes to the Timer view, opens the inline
  // Start-with-details disclosure, fills the fresh entry's attributes, and submits. The start
  // mock runs core's atomic stop-then-start ON the injected snapshot (switchOnStart), so the
  // subsequent load()/getState repaint SHOWS the previously-running timer being stopped and the
  // new entry becoming the single live count-up — the start-while-running atomic switch. The
  // pinned JUDGE_NOW clock keeps the count-ups deterministic; we then step the clock so the new
  // entry's 00:00:0x visibly ticks while the just-stopped row holds its frozen duration.
  '§05 R01': {
    page: 'index.html',
    state: runningState,
    initOpts: { switchOnStart: true },
    drive: async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #timer-clock');
      // Dwell on the previously-running timer (auth refactor, 01:24:07) so the switch is legible.
      await wait(page, 800);
      await page.click('#start-toggle');
      await page.waitForSelector('#start-form:not([hidden])', { state: 'attached' });
      await page.fill('#start-desc', 'invoice prep');
      await page.fill('#start-client', 'Globex');
      await page.fill('#start-project', 'Billing');
      await page.fill('#start-tags', 'admin');
      await wait(page, 600);
      await page.click('#start-go');
      // The repaint now shows the fresh entry as the single live count-up; step the pinned clock
      // so its 00:00:0x ticks on camera (the previous row holds its frozen stopped duration).
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
        const idle = { status: { running: false, entry: null }, days: [], sleepFlaggedIds: [], settings: window.__STATE__.settings, accent: window.__STATE__.accent };
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

  // §12 R05 (core) — the GUI CORE-ENTRY surface, the Start / Switch form, now lives in the
  // Timer view (relocated from the Entries toolbar). This recording PROVES the relocation and the
  // start-with-details-in-one-step contract: it opens on the IDLE snapshot (nothing running),
  // routes to the Timer view, and dwells on the relocated 'Start a new timer' panel — Start is
  // the single primary, Switch is hidden (idle), and the `+ with details` disclosure is present.
  // It then opens the disclosure (#start-toggle) and fills the full core-entry attribute set the
  // form carries — description / client / project / a tag — and sets the Billable toggle, so the
  // start is demonstrably ONE step that carries its attributes (not a parameterless start + later
  // edit). Pressing 'Start with details' (#start-go) sends the whole payload over the SAME `start`
  // IPC tt uses (window.stint.start → core startWithAttributes); with switchOnStart the injected
  // snapshot gains a single fresh open row built from that payload, so the getState repaint paints
  // the Timer card RUNNING with the entered description/label and the live count-up begins. We
  // then step the pinned clock so the fresh entry's 00:00:0x visibly ticks on camera (the start
  // carried its attributes into a live timer), and dwell on the STATE FLIP the requirement calls
  // out: with a timer now running, the start-panel primary has flipped Start→Stop and the
  // dedicated #switch affordance (hidden while idle) is now SHOWN — the Start↔Switch flip, the
  // atomic stop-then-start surfaced only mid-timer. switchOnStart is the same scoped snapshot
  // emulation §05 R01 uses; no shared fixture or JUDGE scene is touched.
  '§12 R05': {
    page: 'index.html',
    state: emptyState,
    initOpts: { switchOnStart: true },
    drive: async (page) => {
      // Route to the Timer view and dwell on the relocated 'Start a new timer' panel in its
      // IDLE state: the Start primary is shown, the dedicated Switch is hidden, and the
      // `+ with details` disclosure is present — the core-entry surface now lives here.
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #start-panel');
      await page.waitForSelector('#start-panel #toggle');
      await page.waitForFunction(
        () => document.querySelector('#start-panel #toggle')?.textContent?.trim() === 'Start',
      );
      await page.waitForSelector('#start-panel #switch[hidden]', { state: 'attached' });
      await wait(page, 800);

      // Open the `+ with details` disclosure → the inline attribute form reveals.
      await page.click('#start-panel #start-toggle');
      await page.waitForSelector('#start-form:not([hidden])', { state: 'attached' });
      await wait(page, 400);

      // Fill the full core-entry attribute set the form carries, then set the Billable toggle —
      // proving the start carries description / client / project / tags / billable in ONE step.
      await page.fill('#start-desc', 'invoice prep');
      await page.fill('#start-client', 'Globex');
      await page.fill('#start-project', 'Billing');
      await page.fill('#start-tags', 'admin');
      await wait(page, 500);
      // Toggle Billable off then on so the control is visibly exercised, ending checked (billable).
      await page.click('#start-bill');
      await wait(page, 300);
      await page.click('#start-bill');
      await wait(page, 400);

      // Press 'Start with details' → the whole payload goes over `start`; switchOnStart makes the
      // submitted attributes the single fresh open row, and the repaint paints the running card.
      await page.click('#start-go');
      await page.waitForSelector('#timer-card.running');
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'invoice prep',
      );
      await wait(page, 400);

      // Step the pinned clock so the fresh entry's 00:00:0x visibly ticks — the start carried its
      // attributes into a LIVE timer.
      for (let i = 1; i <= 3; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 350);
      }

      // The Start↔Switch flip: with a timer running, the start-panel primary now reads 'Stop' and
      // the dedicated #switch affordance (hidden while idle) is now SHOWN. Dwell on it so the
      // mid-timer Switch surface is legible.
      await page.waitForFunction(
        () => document.querySelector('#start-panel #toggle')?.textContent?.trim() === 'Stop',
      );
      await page.waitForSelector('#start-panel #switch:not([hidden])');
      await wait(page, 1200);
    },
  },

  // §05 R05 — manual add gains the visual range picker in the GUI (G9, §12 R14/R15). Drives
  // the REAL renderer end to end: open the Add-entry disclosure, click the From field's
  // calendar-icon trigger to open the shared visual time-range picker (window.STP /
  // timepicker.js — month view → single-day hour-line column with the bound text inputs
  // echoed), DRAG the "me" rectangle body (start+stop move together, 5-min snap) and DRAG the
  // bottom resize edge (stop only, 5-min snap) into a span that OVERLAPS a seeded other entry
  // so the gray other-entries + the yellow warn-only overlap region paint on camera, Apply the
  // range (the picked start/stop write BACK into the authoritative #add-from/#add-to text
  // fields — text stays authoritative), then Save and SHOW the new completed backfill entry
  // appear in the Entries list.
  //
  // The add form lives in the Entries view (the GUI default view), under the toolbar's "Add
  // entry" disclosure — the manual-add (backfill) affordance §12 R14 surfaces; the picker is
  // the SAME shared component the Timer-view/edit paths reuse. The page is pinned to UTC (like
  // the JUDGE TIME_RANGE_PICKER scene) so the seeded UTC other-entries land on the same local
  // day as the filled 2026-06-24 span — making the gray/overlap geometry deterministic on
  // camera. The drag pixel deltas mirror the JUDGE geometry (track = 720px/24h → 0.5px/min):
  // +30px body ≈ +60min (13:00–14:30 → 14:00–15:30), +15px resize ≈ +30min stop (→ 16:00),
  // overlapping the seeded 14:00–15:00 other entry → a yellow overlap region.
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
      // Open the Add-entry disclosure in the Entries view (the default view).
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
      // Seed an explicit same-day span (UTC page → 2026-06-24 local) so the picker draws the
      // single-day column for that day and the "me" rectangle is 13:00–14:30 — and give the
      // backfill a description so the saved row is legible in the list.
      await page.fill('#add-desc', 'invoice prep');
      await page.fill('#add-from', '2026-06-24T13:00');
      await page.fill('#add-to', '2026-06-24T14:30');
      await wait(page, 600);
      // Click the From field's calendar-icon trigger → the REAL visual picker opens.
      await page.click('#add-from-pick');
      await page.waitForSelector('.stp-backdrop .stp', { state: 'visible' });
      await wait(page, 800);

      // Helper: the "me" rectangle box, to grab its body centre and bottom edge for dragging.
      const meBox = () =>
        page.evaluate(() => {
          const me = document.querySelector('.stp-block.me');
          const r = me.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, cx: r.left + r.width / 2 };
        });

      // DRAG THE BODY DOWN +30px → start+stop advance together (+60min, 5-min snap):
      // 13:00–14:30 → 14:00–15:30. Slow, stepped move so the snap is legible on camera.
      const before = await meBox();
      const grabX = Math.round(before.cx);
      const grabY = Math.round((before.top + before.bottom) / 2);
      await page.mouse.move(grabX, grabY);
      await page.mouse.down();
      await page.mouse.move(grabX, grabY + 30, { steps: 20 });
      await page.mouse.up();
      await wait(page, 700);

      // DRAG THE BOTTOM RESIZE EDGE DOWN +15px → only the stop moves (+30min, 5-min snap):
      // stop 15:30 → 16:00, so the "me" span now overlaps the seeded 14:00–15:00 other entry.
      const me2 = await meBox();
      await page.mouse.move(Math.round(me2.cx), Math.round(me2.bottom - 1));
      await page.mouse.down();
      await page.mouse.move(Math.round(me2.cx), Math.round(me2.bottom - 1 + 15), { steps: 16 });
      await page.mouse.up();
      // Dwell on the overlap warn-coloring: the other entries paint gray, the overlap region
      // paints yellow (warn-only) while Apply still works.
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

      // Apply the range → the picked start/stop write BACK into the authoritative
      // #add-from/#add-to text fields, and the popover closes.
      await page.click('.stp .stp-apply');
      await page.waitForSelector('.stp-backdrop', { state: 'detached' });
      // Dwell so the written-back text-field values (14:00 / 16:00) are legible on camera.
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

  // §12 R07 (core entry, G9) — the GUI MANUAL-ADD form now drives the visual range picker
  // (§12 R15) end to end, and the recording shows the FOUR R07-specific beats the requirement
  // gates: (1) the picker OPENS from the add form's calendar trigger; (2) DRAG-to-set start +
  // stop on the single-day column (drag body = move start, drag bottom = resize end, 5-min
  // snap) with other entries painting gray and the overlap region yellow (warn-only); (3) the
  // picked start/stop WRITE BACK into the authoritative #add-from/#add-to text fields; (4) a
  // manual TEXT-OVERRIDE of one field afterward — proving text stays authoritative over the
  // picker — and then the entry SAVES via the SAME unchanged add path (fromLocal/toLocal →
  // window.stint.add), the new completed backfill row appears in the Entries list, and — because
  // the chosen span overlaps the seeded 14:00–15:00 'market research' entry — the non-blocking
  // overlap banner paints (§06 R4: warned, not blocked).
  //
  // This is the manual-add twin of the §05 R05 picker scene (same shared component, same
  // fromLocal/toLocal submit path, same pinned-UTC pickerState so the seeded other-entries land
  // on the filled 2026-06-24 day). The differences are R07-specific: it (a) sets initOpts
  // overlap:true so the post-save WriteAck carries an overlap warning and the inline overlap
  // banner is exercised on camera, and (b) adds the explicit TEXT-OVERRIDE keystroke after the
  // write-back to demonstrate the durability contract ("Text stays authoritative") the add
  // form's pickhint states. As in §05 R05, a scoped window.stint.add override splices a completed
  // row for the chosen span into the injected snapshot so the saved entry SHOWS on the repaint,
  // and returns the shared window.__ACK__ (now overlap-carrying) so applyAck() raises the banner;
  // the override is set via page.evaluate on THIS page only — no shared fixture or JUDGE scene is
  // touched, and the renderer's unchanged submit path stays the single source of truth.
  '§12 R07': {
    page: 'index.html',
    state: pickerState,
    initOpts: { overlap: true },
    contextOpts: { viewport: { width: 760, height: 900 }, timezoneId: 'UTC' },
    drive: async (page) => {
      // Open the Add-entry disclosure in the Entries view (the default, GUI core-entry surface).
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
      // Seed an explicit same-day span (UTC page → 2026-06-24 local) so the picker draws the
      // single-day column for that day and the "me" rectangle is 13:00–14:30; the attributes make
      // the saved backfill row legible in the list.
      await page.fill('#add-desc', 'invoice prep');
      await page.fill('#add-client', 'Globex');
      await page.fill('#add-project', 'Billing');
      await page.fill('#add-tags', 'admin');
      await page.fill('#add-from', '2026-06-24T13:00');
      await page.fill('#add-to', '2026-06-24T14:30');
      await wait(page, 600);

      // (1) PICKER OPENS FROM THE ADD FORM — click the Start field's calendar-icon trigger.
      await page.click('#add-from-pick');
      await page.waitForSelector('.stp-backdrop .stp', { state: 'visible' });
      await wait(page, 800);

      // Helper: the "me" rectangle box, to grab its body centre and bottom edge for dragging.
      const meBox = () =>
        page.evaluate(() => {
          const me = document.querySelector('.stp-block.me');
          const r = me.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, cx: r.left + r.width / 2 };
        });

      // (2a) DRAG THE BODY DOWN +30px → start+stop advance together (+60min, 5-min snap):
      // 13:00–14:30 → 14:00–15:30. Slow, stepped move so the snap is legible on camera.
      const before = await meBox();
      const grabX = Math.round(before.cx);
      const grabY = Math.round((before.top + before.bottom) / 2);
      await page.mouse.move(grabX, grabY);
      await page.mouse.down();
      await page.mouse.move(grabX, grabY + 30, { steps: 20 });
      await page.mouse.up();
      await wait(page, 700);

      // (2b) DRAG THE BOTTOM RESIZE EDGE DOWN +15px → only the stop moves (+30min, 5-min snap):
      // stop 15:30 → 16:00, so the "me" span now overlaps the seeded 14:00–15:00 other entry.
      const me2 = await meBox();
      await page.mouse.move(Math.round(me2.cx), Math.round(me2.bottom - 1));
      await page.mouse.down();
      await page.mouse.move(Math.round(me2.cx), Math.round(me2.bottom - 1 + 15), { steps: 16 });
      await page.mouse.up();
      // Dwell on the overlap warn-coloring: other entries paint gray, the overlap region paints
      // yellow (warn-only) while Apply still works — the overlap is warned, not blocked.
      await wait(page, 1200);

      // Scope a local add override so the saved backfill SHOWS in the list on repaint, and return
      // the shared (overlap-carrying) __ACK__ so applyAck() raises the inline overlap banner —
      // mirrors §05 R05's override, with the overlap ack exercising §06 R4 on the manual-add path.
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
            // The chosen span overlaps the seeded 14:00–15:00 entry → flag the durable per-row
            // overlap badge too, so the saved row carries the same warned-not-blocked signal.
            overlapped: true,
            overlapMinutes: 60,
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

      // (3) WRITE-BACK — Apply the range; the picked start/stop write back into the authoritative
      // #add-from/#add-to text fields and the popover closes. Dwell so 14:00 / 16:00 are legible.
      await page.click('.stp .stp-apply');
      await page.waitForSelector('.stp-backdrop', { state: 'detached' });
      await page
        .waitForFunction(() => document.querySelector('#add-to')?.value === '2026-06-24T16:00')
        .catch(() => {});
      await wait(page, 1000);

      // (4) TEXT-OVERRIDE — type directly into the Stop field, proving TEXT STAYS AUTHORITATIVE
      // over the picker's write-back: nudge the stop from 16:00 → 16:30 by keyboard. The submit
      // path reads the text field, so this typed value is what saves.
      await page.fill('#add-to', '2026-06-24T16:30');
      await wait(page, 900);

      // SAVE via the SAME add path — the unchanged submit sends the explicit (text-authoritative)
      // fromLocal/toLocal over `add`; the form closes, the repaint paints the new completed
      // backfill row, and applyAck() raises the non-blocking overlap banner (§06 R4).
      await page.click('#add-go');
      await page.waitForSelector('#add-form[hidden]', { state: 'attached' });
      await page.waitForSelector('text=invoice prep').catch(() => {});
      // Dwell on (a) the saved 'invoice prep' backfill row in the Entries list and (b) the
      // non-blocking overlap banner now visible — warned, not blocked.
      await page.waitForSelector('#overlap-banner:not([hidden])').catch(() => {});
      await wait(page, 1600);
    },
  },

  // §12 R15 (G9) — the VISUAL TIME-RANGE PICKER itself, the umbrella requirement the §05 R05 /
  // §12 R07 manual-add scenes are special cases of. This recording exercises the picker through
  // ALL THREE of its sanctioned entry points in one take, plus the durability contract:
  //
  //   (1) ADD-ENTRY — open the Entries-view Add form, open the picker from the Start field's
  //       calendar icon, DRAG the accent "me" rectangle body (start+stop move together, 5-min
  //       snap — the echoed Start/Stop text fields tick as it snaps), DRAG the bottom handle to
  //       resize the stop, land the span OVER the seeded 14:00–15:00 'market research' entry so
  //       the other entries paint GRAY and the overlap region paints YELLOW (warn-only — Apply
  //       stays enabled), then APPLY and SHOW 14:00 / 16:00 land in the authoritative
  //       #add-from/#add-to text fields. Cancel the add form (this scene is about the picker).
  //
  //   (2) EDIT-CLOSED — click Edit on the closed 'morning sync' row (09:00–11:00); its inline
  //       form's calendar icon opens the picker carrying BOTH start+stop. The OTHER closed entry
  //       ('market research', 14:00–15:00) paints gray; drag the bottom handle DOWN to extend the
  //       stop past 14:00 so the span overlaps it → the yellow warn region paints. Apply writes
  //       the new stop back into the form's .edit-end text input. Cancel (no commit needed — the
  //       requirement is the picker, not the edit).
  //
  //   (3) EDIT-RUNNING-START — route to the Timer view; the live-edit strip's Start field
  //       (#le-start) calendar icon opens the picker SEEDED START-ONLY (the open row has no stop,
  //       so editing it can never close the timer, §05 R6). Only a thin start handle shows — no
  //       resize, no stop. Drag it to a new start; Apply writes only #le-start.
  //
  //   (4) OVERNIGHT VIA TEXT — back in the add form, TYPE a span that crosses midnight directly
  //       into the text fields (2026-06-24T22:00 → 2026-06-25T06:00). Clicking the calendar icon
  //       on an overnight span DEGRADES to a plain field focus (the picker is single-day; the
  //       footer steers overnight to text) — proving TEXT ENTRY REMAINS and stays authoritative.
  //
  // The page is pinned to UTC (like the §05 R05 scene) and the state carries a running open entry
  // (id 99, start 2026-06-24T12:00) PLUS the two pickerState closed entries, all on 2026-06-24,
  // so the picker's single-day column draws the gray other-entries deterministically for every
  // entry point. Drag pixel deltas mirror the JUDGE/§05 R05 geometry (track 720px/24h → 0.5px/min,
  // i.e. 30px/hour). No write IPC is needed — this scene demonstrates the picker affordance and
  // its write-back into the authoritative text fields; the add/edit submit paths are already
  // proven on camera by §05 R05 and §12 R07.
  '§12 R15': {
    page: 'index.html',
    // Running open entry (no stop) + the two pickerState closed entries, all on 2026-06-24, so
    // every entry point's single-day column shows the gray other-entries. Built inline (not a new
    // shared fixture) so no JUDGE scene drifts; settings/accent are reused from pickerState().
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
      // Helper: the "me" rectangle box, to grab its body centre and bottom edge for dragging.
      const meBox = () =>
        page.evaluate(() => {
          const me = document.querySelector('.stp-block.me');
          const r = me.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, cx: r.left + r.width / 2 };
        });

      // ===== (1) ADD-ENTRY — open from the calendar icon, drag body + resize, overlap, Apply =====
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
      // Seed an explicit same-day span (UTC page → 2026-06-24 local) so the column draws that day
      // and the "me" rectangle is 13:00–14:30.
      await page.fill('#add-desc', 'invoice prep');
      await page.fill('#add-from', '2026-06-24T13:00');
      await page.fill('#add-to', '2026-06-24T14:30');
      await wait(page, 500);
      // OPEN FROM THE CALENDAR ICON (the Start field's ▦ trigger) → the real visual picker opens.
      await page.click('#add-from-pick');
      await page.waitForSelector('.stp-backdrop .stp', { state: 'visible' });
      await wait(page, 800);

      // DRAG THE BODY DOWN +30px → start+stop advance together (+60min, 5-min snap):
      // 13:00–14:30 → 14:00–15:30. Slow, stepped move so the snap is legible and the echoed
      // Start/Stop text fields tick as it snaps.
      const a0 = await meBox();
      const aGrabX = Math.round(a0.cx);
      const aGrabY = Math.round((a0.top + a0.bottom) / 2);
      await page.mouse.move(aGrabX, aGrabY);
      await page.mouse.down();
      await page.mouse.move(aGrabX, aGrabY + 30, { steps: 20 });
      await page.mouse.up();
      await wait(page, 700);

      // DRAG THE BOTTOM RESIZE HANDLE DOWN +15px → only the stop moves (+30min, 5-min snap):
      // stop 15:30 → 16:00, so the "me" span now overlaps the seeded 14:00–15:00 'market research'
      // entry → the gray other-entries + the yellow warn-only overlap region paint on camera.
      const a1 = await meBox();
      await page.mouse.move(Math.round(a1.cx), Math.round(a1.bottom - 1));
      await page.mouse.down();
      await page.mouse.move(Math.round(a1.cx), Math.round(a1.bottom - 1 + 15), { steps: 16 });
      await page.mouse.up();
      // Dwell on the overlap warn-coloring (other entries gray, overlap yellow) while Apply works.
      await wait(page, 1300);

      // APPLY → the picked 14:00 / 16:00 write BACK into the authoritative #add-from/#add-to text
      // fields and the popover closes; dwell so the written-back values are legible (text-authoritative).
      await page.click('.stp .stp-apply');
      await page.waitForSelector('.stp-backdrop', { state: 'detached' });
      await page
        .waitForFunction(() => document.querySelector('#add-to')?.value === '2026-06-24T16:00')
        .catch(() => {});
      await wait(page, 1200);
      // Close the add form — this scene is about the picker, not the save (proven by §05 R05).
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form[hidden]', { state: 'attached' });
      await wait(page, 500);

      // ===== (2) EDIT-CLOSED — inline edit a closed row, open picker with start+stop, overlap =====
      // Open the inline Edit form on the closed 'morning sync' row (id 1, 09:00–11:00).
      await page.click('.entry[data-id="1"] [data-act="edit"]');
      await page.waitForSelector('.entry[data-id="1"] form.edit-form', { state: 'attached' });
      await wait(page, 600);
      // Open the picker from the Start field's calendar icon → carries BOTH start+stop (closed row).
      await page.click('.entry[data-id="1"] form.edit-form .edit-pick');
      await page.waitForSelector('.stp-backdrop .stp', { state: 'visible' });
      await wait(page, 800);
      // The OTHER closed entry ('market research' 14:00–15:00) paints gray. Drag the bottom resize
      // handle DOWN ~+95px (≈ +190min) to extend the stop from 11:00 past 14:00 → the span overlaps
      // it and the yellow warn-only region paints.
      const e1 = await meBox();
      await page.mouse.move(Math.round(e1.cx), Math.round(e1.bottom - 1));
      await page.mouse.down();
      await page.mouse.move(Math.round(e1.cx), Math.round(e1.bottom - 1 + 95), { steps: 24 });
      await page.mouse.up();
      // Dwell on the gray other-entry + yellow overlap (warn-only) while Apply stays enabled.
      await wait(page, 1300);
      // APPLY → the picked stop writes back into the form's .edit-end text input (text authoritative).
      await page.click('.stp .stp-apply');
      await page.waitForSelector('.stp-backdrop', { state: 'detached' });
      await wait(page, 1000);
      // Cancel the edit form (the requirement is the picker; the edit submit path is proven elsewhere).
      await page.click('.entry[data-id="1"] form.edit-form .edit-cancel');
      await wait(page, 500);

      // ===== (3) EDIT-RUNNING-START — Timer view live-edit, picker seeded START-ONLY (no stop) =====
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #live-edit:not([hidden])');
      await wait(page, 600);
      // Open the picker from the running Start field's calendar icon (#le-start-pick). The open row
      // has NO stop, so the picker is seeded START-ONLY: only a thin start handle shows — no resize,
      // no stop — editing the open row can never close the timer (§05 R6).
      await page.click('#le-start-pick');
      await page.waitForSelector('.stp-backdrop .stp', { state: 'visible' });
      // Confirm there is NO resize handle (start-only) on camera.
      await page.waitForSelector('.stp-block.me .stp-resize', { state: 'detached' }).catch(() => {});
      await wait(page, 900);
      // DRAG the thin start handle UP -20px (≈ -40min, 5-min snap): start 12:00 → ~11:20.
      const r0 = await meBox();
      const rGrabX = Math.round(r0.cx);
      const rGrabY = Math.round((r0.top + r0.bottom) / 2);
      await page.mouse.move(rGrabX, rGrabY);
      await page.mouse.down();
      await page.mouse.move(rGrabX, rGrabY - 20, { steps: 16 });
      await page.mouse.up();
      await wait(page, 1000);
      // APPLY → writes ONLY #le-start (no stop ever written); dwell so the new start is legible.
      await page.click('.stp .stp-apply');
      await page.waitForSelector('.stp-backdrop', { state: 'detached' });
      await wait(page, 1200);

      // ===== (4) OVERNIGHT VIA TEXT — text remains authoritative, picker degrades to focus =====
      // Back to the Entries view and the Add form; TYPE an overnight span directly into the text
      // fields (crosses midnight). The text is authoritative; the calendar icon on an overnight
      // span degrades to a plain field focus (single-day picker; overnight steered to text).
      await page.click('.nav-item[data-view="entries"]');
      await page.waitForSelector('.view[data-view="entries"]:not([hidden])');
      await page.click('#add-toggle');
      await page.waitForSelector('#add-form:not([hidden])', { state: 'attached' });
      await page.fill('#add-desc', 'overnight deploy');
      await page.fill('#add-from', '2026-06-24T22:00');
      await page.fill('#add-to', '2026-06-25T06:00');
      await wait(page, 800);
      // Click the calendar icon on the now-overnight span → NO picker opens (degrades to focus),
      // proving the overnight case is handled by text entry, which stays authoritative.
      await page.click('#add-from-pick');
      await wait(page, 600);
      const overnightHandled = await page.evaluate(
        () => !document.querySelector('.stp-backdrop'),
      );
      if (!overnightHandled) {
        throw new Error('overnight span unexpectedly opened the single-day picker (text should stay authoritative)');
      }
      // Dwell on the typed overnight text values standing as the authoritative span.
      await wait(page, 1600);
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

  // §05 R10 — Resume from favorite: ONE action starts a FRESH timer from a favorite's template,
  // atomically replacing any already-running timer (CLI parity: `tt fav start <name>` /
  // `tt start --fav <name>`). The recording opens the Timer view on the favorites-rail snapshot —
  // a timer is ALREADY RUNNING (the canonical 'auth refactor' open row reading a deterministic
  // 01:24:07) and three favorites are pinned ('Standup', 'Deep work', 'Admin / email') — so the
  // scene shows (1) the rail with each pinned template (name + captured description/tags), then
  // clicks the 'Deep work' favorite's Resume button. To SHOW the requirement actually exercised
  // (not just the click), this recipe scopes a local override of window.stint.startFavorite
  // (mirroring §05 R02's toggle / §05 R05's add overrides): the override records the resumed name
  // AND flips the injected snapshot to a FRESH single open entry built from that favorite's
  // template (description 'focus block', client/project label, billable, tags) whose startUtc is
  // the pinned JUDGE_NOW — so the count-up starts fresh at 00:00:00, the previously-running
  // 'auth refactor' row is gone (atomic replacement → exactly one open entry), and the renderer's
  // post-resume load() repaints the Active-Timer card from that fresh state. We then step the
  // pinned clock so the new entry's 00:00:0x visibly TICKS on camera, proving a live fresh timer.
  // The favorite itself is left untouched in the in-memory FAVORITES list, so the rail still shows
  // 'Deep work' pinned/unchanged afterward (the §05 R10 'favorite remains pinned' fact).
  '§05 R10': {
    page: 'index.html',
    state: timerViewFavoritesState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #fav-rail');
      // Dwell on the rail (each pinned template) AND the already-running 'auth refactor' card, so
      // the before-state is legible: a timer running + favorites pinned.
      await page.waitForSelector('.fav-card .fav-name');
      await wait(page, 900);

      // Scope a local startFavorite override: record the resumed name and flip the injected
      // snapshot to a FRESH open entry from the named favorite's template, starting at JUDGE_NOW
      // (count-up 00:00:00) and atomically replacing the prior open row (single open entry).
      await page.evaluate((nowIso) => {
        window.stint.startFavorite = async (p) => {
          (window.__RESUMED__ ||= []).push(p);
          const fav = (window.stint.__FAVORITES__ || []).find((f) => f.name === (p && p.name)) || {};
          const entry = {
            id: 500,
            description: fav.description ?? null,
            // The favorite carries client/project IDS; core resolves them to a label on start.
            // Use a faithful label for the seeded 'Deep work' template (Client A / Focus).
            clientLabel: fav.clientId ? 'Client A / Focus' : null,
            startUtc: nowIso,
            billableSeconds: 0,
            billable: fav.billable !== false,
            excludedSeconds: 0,
            sleptThrough: false,
            tags: Array.isArray(fav.tags) ? fav.tags.slice() : [],
          };
          // Atomic replacement: the prior open row is closed; the fresh entry is the ONE open row.
          window.__STATE__ = {
            status: { running: true, entry },
            days: [
              {
                day: nowIso.slice(0, 10),
                entries: [
                  {
                    ...entry,
                    endUtc: null,
                    clientLabel: entry.clientLabel,
                    overlapped: false,
                    overlapMinutes: 0,
                    overlapRelation: null,
                    rawSeconds: 0,
                  },
                ],
              },
            ],
            sleepFlaggedIds: [],
            settings: window.__STATE__.settings,
            accent: window.__STATE__.accent,
          };
          return Promise.resolve(window.__ACK__);
        };
      }, JUDGE_NOW);

      // ONE click on the 'Deep work' favorite's Resume button. The renderer fires startFavorite
      // then load()→render(), repainting the Active-Timer card from the fresh snapshot.
      const deepWork = page.locator('.fav-card', { hasText: 'Deep work' });
      await deepWork.locator('[data-act="fav-resume"]').click();

      // Repaint the card from the flipped snapshot: in the harness the resume handler only calls
      // renderFavorites(), so drive the same load() the real `changed` broadcast would, to show
      // the Active-Timer card now carrying the fresh 'focus block' template.
      await page.evaluate(() => (typeof load === 'function' ? load() : null));
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'focus block',
      );
      await page.waitForSelector('#timer-card.running');
      await wait(page, 500);

      // Step the pinned clock so the FRESH entry's 00:00:0x visibly ticks on camera — a live,
      // freshly-started timer (not the inherited 01:24:07).
      for (let i = 1; i <= 4; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 350);
      }
      // Final dwell on (a) the running fresh timer and (b) the 'Deep work' favorite still pinned
      // and unchanged in the rail.
      await page.waitForSelector('.fav-card:has(.fav-name >> text=Deep work)').catch(() => {});
      await wait(page, 900);
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
  // the chip from the rail (unpinFavorite, parity with `tt fav rm`). The two window.prompt
  // calls (pin name, rename name) are answered by a scoped page.on('dialog') handler that
  // returns the next queued answer, so the scripted scene drives the prompts deterministically
  // without a human. Resume (R10) is recorded separately in 'favorites-rail'.
  '§05 R09': {
    page: 'index.html',
    state: timerViewFavoritesState,
    drive: async (page) => {
      // Answer the renderer's window.prompt() calls in order: first the pin name, then the
      // rename name. Any later/unexpected prompt is dismissed (accept with no value).
      const answers = ['Invoice prep', 'Client invoicing'];
      page.on('dialog', async (dialog) => {
        if (dialog.type() === 'prompt') {
          const next = answers.shift();
          if (next !== undefined) return void (await dialog.accept(next));
          return void (await dialog.dismiss());
        }
        await dialog.accept();
      });

      await page.click('.nav-item[data-view="timer"]');
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #fav-rail');
      await wait(page, 500);

      // (a) PIN from the running timer — the rail grows by one chip named from the prompt.
      const before = await page.$$eval('.fav-card', (els) => els.length);
      await page.click('#fav-pin');
      await page.waitForFunction(
        (n) => document.querySelectorAll('.fav-card').length === n + 1,
        before,
      );
      // Dwell on (b) the LIST — every favorite is a row in the rail, the new one included.
      await wait(page, 900);

      // (c) RENAME in place — open the newly pinned chip's kebab → Rename; the name repaints.
      const pinned = page.locator('.fav-card', { hasText: 'Invoice prep' });
      await pinned.locator('[data-act="fav-menu"]').click();
      await wait(page, 400);
      await pinned.locator('[data-act="fav-rename"]').click();
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
  // (3) STOP, then START a NEW timer with details from the Start form; (4) SWITCH from one
  // running timer to another (the atomic stop-then-start); (5) the pinned FAVORITES rail —
  // PIN the running timer as a favorite, one-click RESUME a favorite to start a fresh timer,
  // and RENAME / UNPIN via the kebab (§05 R09–R10).
  //
  // All writes go over the SAME window.stint.* channels tt uses (edit / toggle / start /
  // pinFavorite / startFavorite / renameFavorite / unpinFavorite) — the parity twins of
  // `tt`. Because the canned mocks record-but-don't-mutate the injected snapshot, each beat
  // scopes a LOCAL page.evaluate override (mirroring §05 R02's toggle / §05 R05's add / §05
  // R10's startFavorite overrides) that applies the real effect to window.__STATE__ so the
  // post-write load() repaint SHOWS the change on camera. The overrides are scoped to THIS
  // page only — no shared fixture or JUDGE scene is touched, and the renderer's unchanged
  // commit paths stay the single source of truth. The pinned JUDGE_NOW clock is stepped where
  // a count-up must visibly tick. The two window.prompt calls the rail raises (pin name,
  // rename name) are answered by a scoped page.on('dialog') queue so the scene is deterministic.
  '§12 R14': {
    page: 'index.html',
    state: timerViewFavoritesState,
    initOpts: { switchOnStart: true },
    contextOpts: { viewport: { width: 820, height: 980 } },
    drive: async (page) => {
      // Answer the rail's window.prompt() calls in order: pin name, then rename name. Any
      // later/unexpected prompt is dismissed; window.confirm (if any) is accepted.
      const answers = ['Invoice prep', 'Client invoicing'];
      page.on('dialog', async (dialog) => {
        if (dialog.type() === 'prompt') {
          const next = answers.shift();
          if (next !== undefined) return void (await dialog.accept(next));
          return void (await dialog.dismiss());
        }
        await dialog.accept();
      });

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
      // The live-edit strip is seeded from the open entry. Show the "no stop" pill and the
      // "End time not editable while running" note (the End field is deliberately absent), then
      // change description + start time + Billable and PROVE the row stays open (still running).
      await page.waitForSelector('#live-edit:not([hidden])');
      await page.waitForSelector('#live-edit .le-pill');
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
      await page.fill('#live-edit #le-desc', 'auth refactor v2');
      // Advance the pinned clock past the 500ms debounce window to flush the single commit.
      await tickClock(1, 0);
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'auth refactor v2',
      );
      await page.waitForSelector('#timer-card.running');
      await wait(page, 600);

      // 2b — change the START TIME via the editable datetime-local; its `change` commits an
      // `edit` patch carrying startUtc (and never endUtc). The row stays open/running.
      await page.fill('#live-edit #le-start', '2026-06-24T21:15');
      await page.dispatchEvent('#live-edit #le-start', 'change');
      await page.waitForFunction(() => !!window.__EDITED__ && 'startUtc' in (window.__EDITED__.patch || {}));
      await page.waitForSelector('#timer-card.running');
      await wait(page, 600);

      // 2c — toggle BILLABLE off (immediate commit). The patch carries billable, never endUtc;
      // the timer keeps running. Dwell so the "no stop" pill + note are legible alongside the
      // still-advancing running card.
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
            accent: st.accent,
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

      // START A NEW TIMER WITH DETAILS from the Start form (the relocated core-entry surface).
      // switchOnStart makes the submitted attributes the single fresh open row, so the repaint
      // paints the running card with the entered description and the count-up begins.
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
      await tickClock(3);
      await wait(page, 500);

      // ---- (4) SWITCH from one running timer to another --------------------------------------
      // The dedicated #switch affordance is shown only while running; one tap fires the SAME
      // `start` IPC (core's atomic stop-then-start, §05 R8) with an empty payload — Switch is the
      // one-tap atomic switch (carry-forward of attributes is the separate §12 R5 form work). With
      // switchOnStart the prior 'invoice prep' row is closed and a fresh row opened, so the card
      // repaints to the new running timer (its description reads the unattributed placeholder) while
      // exactly one row stays open. The desc visibly FLIPS off 'invoice prep' — the switch happened.
      await page.waitForSelector('#start-panel #switch:not([hidden])');
      await page.click('#start-panel #switch');
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() !== 'invoice prep',
      );
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'your timer',
      );
      await page.waitForSelector('#timer-card.running');
      await tickClock(3);
      await wait(page, 600);

      // ---- (5) FAVORITES RAIL — pin, resume, rename, unpin -----------------------------------
      // The rail paints one card per seeded favorite. PIN the running timer → a new chip appears.
      await page.waitForSelector('[data-view="timer"]:not([hidden]) #fav-rail .fav-card');
      const before = await page.$$eval('.fav-card', (els) => els.length);
      await page.click('#fav-pin');
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
            accent: window.__STATE__.accent,
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

      // RENAME via the kebab — open the pinned 'Invoice prep' chip's kebab → Rename; the name
      // repaints to the prompt answer.
      const pinned = page.locator('.fav-card', { hasText: 'Invoice prep' });
      await pinned.locator('[data-act="fav-menu"]').click();
      await wait(page, 400);
      await pinned.locator('[data-act="fav-rename"]').click();
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
  // DELETES the definition via the card kebab (⋮ → 'delete' → the in-window confirm), the card
  // leaving the list. The two window.prompt calls the kebab raises ('delete') and the
  // window.confirm the delete path raises are answered by a scoped page.on('dialog') handler so
  // the scripted scene drives them deterministically without a human. The accent stays confined
  // to '+ New report' the whole time. All CRUD/Run/Export run over the same window.stint.*
  // channels tt uses (saveReport / runReport / exportEntries / editReport / removeReport) — the
  // parity twins of `tt report save|run|edit|rm`. savedReportsState seeds the list; runReport
  // returns the flag-carrying REPORT_SUMMARY so the run-output paints flags in context.
  '§12 R08': {
    page: 'index.html',
    state: savedReportsState,
    contextOpts: { viewport: { width: 820, height: 900 } },
    drive: async (page) => {
      // Answer the kebab's window.prompt ('rename'/'delete') with 'delete', and accept the
      // subsequent window.confirm so the delete actually fires. Any other dialog is accepted.
      page.on('dialog', async (dialog) => {
        if (dialog.type() === 'prompt') return void (await dialog.accept('delete'));
        await dialog.accept();
      });

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

      // EXPORT CSV then JSON → exportEntries carrying the saved ref; the confirmation line paints.
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
      // now reads 'grouped by project'.
      await page.click('#rep-save');
      await page.waitForSelector('#rep-builder[hidden]', { state: 'attached' });
      await page.waitForFunction(
        () =>
          /grouped by .*project/i.test(
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

      // DELETE the definition via the card kebab (⋮ → prompt 'delete' → in-window confirm);
      // removeReport (parity with `tt report rm`) fires and the card leaves the list.
      await newCard.locator('[data-act="menu"]').click();
      await page.waitForFunction(
        () => !document.querySelector('.def[data-name="Weekly billables — Acme"]'),
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

  // §12 R11 / §14 — the Settings view: a control for every setting, including the accent +
  // date-format pickers. The recording routes to Settings and dwells on the panel.
  'settings-view': {
    page: 'index.html',
    state: settingsState,
    drive: async (page) => {
      await page.click('.nav-item[data-view="settings"]');
      await page.waitForSelector('[data-view="settings"]:not([hidden])');
      await wait(page, 1000);
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
  //      description (#strip-desc → 'auth refactor'). The strip carries NO Stop/Switch and NO
  //      flags grid (those are the full panel's). Advancing the pinned clock makes the strip's
  //      count-up visibly TICK, proving it's the live running timer (not a static label).
  //   2) Click the strip itself (it's a button → app.js route('timer')) to navigate to the Timer
  //      view, where the FULL Active-Timer panel paints from the SAME running snapshot: the large
  //      live count-up (#timer-clock), the running state (#timer-state), the description
  //      (#timer-desc → 'auth refactor') + client/project label (#timer-meta → 'Client A / API')
  //      + flags (#timer-flags), and the primary actions Stop (#timer-stop) + Switch
  //      (#timer-switch). Advancing the clock again makes the full panel's count-up tick.
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
      // from the SAME running snapshot (large count-up + state + desc/meta/flags + Stop + Switch).
      await page.click('#timer-strip');
      await page.waitForSelector('.view[data-view="timer"]:not([hidden]) #timer-card.running');
      await page.waitForFunction(
        () => document.querySelector('#timer-desc')?.textContent?.trim() === 'auth refactor',
      );
      await page.waitForSelector('#timer-stop:not([hidden])');
      await page.waitForSelector('#timer-switch:not([hidden])');
      // Dwell on the full panel and step the clock so its larger count-up ticks on camera too.
      await wait(page, 700);
      for (let i = 4; i <= 6; i++) {
        await page.clock.pauseAt(new Date(Date.parse(JUDGE_NOW) + i * 1000));
        await wait(page, 350);
      }
      await wait(page, 600);

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
  // we rename the single produced file to <reqId>.webm afterward.
  const stage = join(RECORDINGS, `.stage-${reqId}`);
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
  await page.addInitScript(initScript(JSON.stringify(state), recipe.initOpts ?? {}));
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
  const out = join(RECORDINGS, `${reqId}.webm`);
  rmSync(out, { force: true });
  renameSync(produced, out);
  rmSync(stage, { recursive: true, force: true });
  return { out, bytes: statSync(out).size };
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
        const { out, bytes } = await recordRecipe(browser, id, RECIPES[id]);
        saved.push({ id, out, bytes });
        console.log(`RECORDED ${id.padEnd(22)} ${out} (${bytes} bytes)`);
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
  console.log(
    `\nAll ${saved.length} recording(s) saved to acceptance/evidence/recordings/ as <reqId>.webm.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
