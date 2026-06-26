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
import { emptyState, runningState, flaggedState, initScript } from './fixtures.mjs';

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

async function withPage(browser, state, name, fn) {
  const page = await browser.newPage({ viewport: { width: 760, height: 620 }, colorScheme: 'light' });
  await page.addInitScript(initScript(JSON.stringify(state)));
  await page.goto(fileUrl(name));
  await page.waitForTimeout(200);
  const result = await fn(page);
  await page.close();
  return result;
}

const results = [];
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

  // TRAY_COUNTUP (popover) — single running timer counting up; +~3s between captures (§12 R1).
  await withPage(browser, runningState(), 'popover.html', async (page) => {
    const t1 = await page.textContent('#count');
    await page.screenshot({ path: join(EVIDENCE, 'popover-running-1.png') });
    await page.waitForTimeout(3000);
    const t2 = await page.textContent('#count');
    await page.screenshot({ path: join(EVIDENCE, 'popover-running-2.png') });
    const toSec = (s) => {
      const [h, m, sec] = s.split(':').map(Number);
      return h * 3600 + m * 60 + sec;
    };
    const delta = toSec(t2) - toSec(t1);
    const ok = delta >= 2 && delta <= 5;
    record('TRAY_COUNTUP', ok, `popover count advanced ${t1} → ${t2} (+${delta}s)`, 'popover-running-2.png');
  });

  // ACCENT_DISCIPLINE — accent on the primary action only; chrome stays monochrome (§07, §15).
  await withPage(browser, runningState(), 'index.html', async (page) => {
    await page.screenshot({ path: join(EVIDENCE, 'main-running.png') });
    const probe = await page.evaluate(() => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const primary = getComputedStyle(document.querySelector('button.primary')).backgroundColor;
      const dayHead = document.querySelector('.day-head')
        ? getComputedStyle(document.querySelector('.day-head')).color
        : 'rgb(0,0,0)';
      const toRgb = (hex) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      return { accentRgb: toRgb(accent), primary, dayHead };
    });
    const primaryUsesAccent = probe.primary === probe.accentRgb;
    const chromeMonochrome = probe.dayHead !== probe.accentRgb;
    record(
      'ACCENT_DISCIPLINE',
      primaryUsesAccent && chromeMonochrome,
      `primary=${probe.primary} accent=${probe.accentRgb} dayHead=${probe.dayHead}`,
      'main-running.png',
    );
  });

  // FLAG_IN_CONTEXT — overlap + slept flags on the affected rows, subtract present (§12 R4, §10 R5).
  await withPage(browser, flaggedState(), 'index.html', async (page) => {
    await page.screenshot({ path: join(EVIDENCE, 'main-flags.png'), fullPage: true });
    const probe = await page.evaluate(() => {
      const overlapRow = document.querySelector('.entry[data-id="11"]');
      const sleptRow = document.querySelector('.entry[data-id="12"]');
      return {
        overlapFlag: !!overlapRow?.querySelector('.flag'),
        sleptFlag: !!sleptRow?.querySelector('.flag'),
        subtractBtn: !!sleptRow && /Subtract/.test(sleptRow.textContent),
      };
    });
    const ok = probe.overlapFlag && probe.sleptFlag && probe.subtractBtn;
    record('FLAG_IN_CONTEXT', ok, `overlap flag on row, slept flag + subtract on slept row: ${JSON.stringify(probe)}`, 'main-flags.png');
  });

  // DESKTOP_FEEL — subjective; evidence captured, scored by the rubric/LLM + human.
  record('DESKTOP_FEEL', true, 'screenshots captured for rubric/human scoring (main-empty, main-running, main-flags, popover-running)', 'main-running.png');

  await browser.close();

  const report = {
    suite: 'JUDGE — GUI presentation & discoverability',
    generatedAt: new Date().toISOString(),
    results,
  };
  mkdirSync(dirname(join(EVIDENCE, '..', 'judge-report.json')), { recursive: true });
  writeFileSync(join(EVIDENCE, '..', 'judge-report.json'), JSON.stringify(report, null, 2) + '\n');

  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.item.padEnd(18)} ${r.justification}`);
  }
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.error(`\n${failed.length} JUDGE item(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll JUDGE deterministic items passed; screenshots in acceptance/evidence/screenshots/.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
