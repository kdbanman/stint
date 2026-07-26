#!/usr/bin/env node
/**
 * QA discovery driver (process.html — QA discovery). Runs the REAL renderer
 * (packages/gui/renderer) in headless Chromium over a REAL @stint/core SQLite store,
 * bridged by main.ts's OWN IPC handler map (src/ipc-handlers.ts, imported from ../dist —
 * issue #165 ended the hand-copy) — so a discovery sweep exercises the shipped GUI code and
 * the shipped write/validation logic with only Electron's OS chrome (tray, native dialogs,
 * global hotkey, update network) out of frame.
 *
 * This is apparatus, not a gate: it produces findings (issues + repro evidence), never
 * green. The bridge is the part that can rot, so it is guarded — test/qa-driver.test.ts
 * asserts createHandlers() serves every IPC channel with the shipping map's own handler,
 * so neither a missing channel nor a re-typed body can reach a sweep.
 *
 * The two halves:
 *   createHandlers(store, deps) — the window.stint bridge: the shipping handler map built
 *     over the sweep's answers to Electron's three OS-bound seams, plus the GUI-only
 *     update:* stubs.
 *   main() — the interactive sweep loop: opens the store, launches Chromium, installs
 *     the window.stint bridge + the cine overlay (./cine.mjs), then watches
 *     <qa-dir>/commands/ for NNN.mjs recipes (export default async (ctx) => {}) and
 *     writes results to <qa-dir>/responses/. ctx: { page, store, cine, record, shot,
 *     out, popover, browser }. Recipes are scratch — consumed by the sweep, never
 *     committed. The procedures live in the qa-gif-authoring and bug-report-authoring
 *     skills.
 *
 * Usage:  node packages/gui/qa/driver.mjs        (STINT_QA_DIR overrides the work dir)
 */
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Store } from '@stint/core';
// The shipping handler map — the whole point of the bridge below (issue #165). It is the
// BUILT module, so the driver (and test/qa-driver.test.ts with it) needs `npm run build`
// first, the same precondition the sweep already had.
import { createIpcHandlers } from '../dist/ipc-handlers.js';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(here, '..', 'renderer');

// -------------------------------------------------------------------- bridge
/**
 * The Chromium page's window.stint bridge. The channel handlers are NOT ported here — they
 * ARE the shipping map (src/ipc-handlers.ts `createIpcHandlers`, built to ../dist), so a sweep
 * can only ever repro against the logic the app runs. Until issue #165 this file re-typed that
 * map by hand and two behaviours had silently drifted (the Entries row lost the client/project
 * names §09 R7's live search reads, and `merge` dropped `allowGap`), so the copy is gone and
 * test/qa-driver.test.ts binds what is left.
 *
 * Only Electron's three OS-bound seams are answered differently, and each answers the way the
 * app would after the OS step: `refreshAll` broadcasts to the open pages, `showSaveDialog`
 * accepts into <qa-dir>/exports (no native dialog host), and the global-hotkey rebind is a
 * no-op (no OS shortcut to rebind).
 *
 * `deps` carries the sweep's context: { exportsDir, refresh }.
 */
export function createHandlers(store, deps = {}) {
  const handlers = createIpcHandlers({
    store,
    refreshAll: () => deps.refresh && deps.refresh(),
    showSaveDialog: (_format, defaultPath) => {
      mkdirSync(deps.exportsDir, { recursive: true });
      return join(deps.exportsDir, defaultPath);
    },
    rebindGlobalHotkey: () => {},
  });

  // window.stint.update — GUI-only, off the parity-asserted channel set (main.ts
  // registers these outside the CHANNELS loop for the same reason). No network host
  // here, so they answer like a dev build.
  const updateHandlers = {
    'update:getVersion': () => '0.0.0-dev',
    'update:check': () => ({ status: 'error', currentVersion: '0.0.0-dev', message: 'net::ERR_NAME_NOT_RESOLVED' }),
    'update:download': () => ({ started: false }),
    'update:reveal': () => ({ steps: [], artifactPath: null }),
  };

  return { handlers, updateHandlers };
}

// ------------------------------------------------------------------ sweep loop
async function main() {
  // Dynamic: this block reaches playwright-core and the Chromium launcher, and
  // qa-driver.test.ts must build the bridge without a browser.
  const { chromium } = await import('playwright-core');
  const { resolveChromium } = await import('../../../scripts/resolve-chromium.mjs');
  const { installOverlay, makeCine } = await import('./cine.mjs');

  const QA = process.env.STINT_QA_DIR || join(tmpdir(), 'stint-qa');
  const dirs = Object.fromEntries(
    ['commands', 'responses', 'shots', 'videos', 'gifs', 'exports', 'home'].map((d) => [d, join(QA, d)]),
  );
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

  const store = Store.open({ path: join(dirs.home, 'stint.db') });
  const pages = new Set();
  const { handlers, updateHandlers } = createHandlers(store, {
    exportsDir: dirs.exports,
    // main.ts refreshAll → broadcast('changed') to every window.
    refresh: () => { for (const p of pages) p.evaluate(() => window.__emitChanged && window.__emitChanged()).catch(() => {}); },
  });
  const all = { ...handlers, ...updateHandlers };

  const launch = () =>
    chromium.launch({
      executablePath: resolveChromium(),
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
    });
  let browser = await launch();

  async function makePage(file, viewport, ctxOpts = {}) {
    if (!browser.isConnected()) browser = await launch();
    const ctx = await browser.newContext({ viewport, colorScheme: 'light', ...ctxOpts });
    const page = await ctx.newPage();
    await page.exposeFunction('__ipc', async (ch, payloadJson) => {
      const payload = payloadJson === undefined ? undefined : JSON.parse(payloadJson);
      try {
        const result = await all[ch](payload);
        return JSON.stringify({ ok: result === undefined ? null : result });
      } catch (err) {
        // Electron's ipcRenderer.invoke rejection format, verbatim — so the renderer's
        // error paths show a user exactly what the packaged app would show.
        return JSON.stringify({ err: `Error invoking remote method '${ch}': ${String(err)}` });
      }
    });
    await page.addInitScript(`(() => {
      const channels = ${JSON.stringify(Object.keys(handlers))};
      const changeCbs = [];
      window.__emitChanged = () => changeCbs.forEach((cb) => { try { cb(); } catch {} });
      const call = (ch) => async (payload) => {
        const r = JSON.parse(await window.__ipc(ch, JSON.stringify(payload === undefined ? null : payload)));
        if ('err' in r) throw new Error(r.err);
        return r.ok;
      };
      const api = { onChange: (cb) => { changeCbs.push(cb); return () => {}; } };
      for (const ch of channels) api[ch] = call(ch);
      api.update = {
        getVersion: call('update:getVersion'), check: call('update:check'),
        download: call('update:download'), reveal: call('update:reveal'),
        onUpdateProgress: () => () => {},
      };
      window.stint = api;
    })()`);
    // window.prompt/confirm/alert: recipes set page.__dialogAnswer before triggering
    // (null = dismiss); persistent handler so it never races Playwright's auto-dismiss.
    page.__dialogs = [];
    page.on('dialog', async (d) => {
      page.__dialogs.push({ type: d.type(), message: d.message(), default: d.defaultValue() });
      try {
        if (page.__dialogAnswer === null) await d.dismiss();
        else await d.accept(page.__dialogAnswer ?? d.defaultValue());
      } catch { /* already handled */ }
      page.__dialogAnswer = undefined;
    });
    await installOverlay(page);
    await page.goto(pathToFileURL(join(RENDERER, file)).href);
    pages.add(page);
    page.on('close', () => pages.delete(page));
    return page;
  }

  // Main window at the real app's size (main.ts: 1040x800).
  let page = await makePage('index.html', { width: 1040, height: 800 });
  let popover = null;
  const openPopover = async () => {
    if (!popover || popover.isClosed()) popover = await makePage('popover.html', { width: 280, height: 200 });
    return popover;
  };

  // Annotated GIF recorder — Playwright recordVideo → ffmpeg palette GIF at fps=50/3,
  // the same conversion packages/gui/judge/record.mjs uses. See the qa-gif-authoring skill.
  async function record(name, fn, { file = 'index.html', viewport = { width: 1040, height: 800 } } = {}) {
    const rp = await makePage(file, viewport, { recordVideo: { dir: dirs.videos, size: viewport } });
    await rp.mouse.move(Math.round(viewport.width / 2), Math.round(viewport.height / 2), { steps: 2 });
    await rp.waitForTimeout(300);
    const cine = makeCine(rp);
    let err = null;
    try { await fn(rp, cine); } catch (e) { err = e; }
    const video = rp.video();
    const ctx = rp.context();
    await rp.close();
    await ctx.close();
    if (err) throw err;
    const webm = await video.path();
    const gif = join(dirs.gifs, `${name}.gif`);
    const pal = gif + '.pal.png';
    let r = spawnSync('ffmpeg', ['-y', '-i', webm, '-vf', 'fps=50/3,palettegen=stats_mode=diff', pal], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('palettegen failed: ' + r.stderr.slice(-500));
    r = spawnSync('ffmpeg', ['-y', '-i', webm, '-i', pal, '-lavfi', 'fps=50/3,paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', gif], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('paletteuse failed: ' + r.stderr.slice(-500));
    return gif;
  }

  // A crashing recipe must never take the driver down.
  process.on('unhandledRejection', (err) => { try { writeFileSync(join(QA, 'unhandled.log'), String(err?.stack || err) + '\n'); } catch { /* best-effort */ } });
  process.on('uncaughtException', (err) => { try { writeFileSync(join(QA, 'uncaught.log'), String(err?.stack || err) + '\n'); } catch { /* best-effort */ } });

  console.log('QA driver ready.', { qaDir: QA, db: join(dirs.home, 'stint.db') });
  writeFileSync(join(QA, 'ready'), 'ok');

  const done = new Set();
  async function loop() {
    const files = readdirSync(dirs.commands).filter((f) => f.endsWith('.mjs')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      done.add(f);
      const outPath = join(dirs.responses, f.replace(/\.mjs$/, ''));
      const collected = [];
      if (page.isClosed() || !browser.isConnected()) {
        try { page = await makePage('index.html', { width: 1040, height: 800 }); }
        catch (e) { writeFileSync(outPath + '.err', 'RECOVERY FAILED: ' + e.stack); continue; }
      }
      const ctx = {
        page, browser, store, record,
        cine: makeCine(page),
        popover: openPopover,
        out: (...args) => collected.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 1))).join(' ')),
        shot: async (name, opts = {}) => { await page.screenshot({ path: join(dirs.shots, name + '.png'), ...opts }); },
      };
      try {
        const mod = await import(pathToFileURL(join(dirs.commands, f)).href + '?t=' + Date.now());
        const result = await mod.default(ctx);
        writeFileSync(outPath + '.json', JSON.stringify({ result: result ?? null, log: collected }, null, 1));
      } catch (err) {
        writeFileSync(outPath + '.err', String(err?.stack || err) + '\nLOG:\n' + collected.join('\n'));
      }
    }
    setTimeout(loop, 300);
  }
  loop();
}

// Run only when executed directly — importing this module (the parity test) is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
