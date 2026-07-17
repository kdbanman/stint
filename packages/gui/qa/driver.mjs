#!/usr/bin/env node
/**
 * QA discovery driver (process.html — QA discovery). Runs the REAL renderer
 * (packages/gui/renderer) in headless Chromium over a REAL @stint/core SQLite store,
 * bridged by a port of main.ts's IPC handler map — so a discovery sweep exercises the
 * shipped GUI code and the shipped write/validation logic with only Electron's OS
 * chrome (tray, native dialogs, global hotkey, update network) out of frame.
 *
 * This is apparatus, not a gate: it produces findings (issues + repro evidence), never
 * green. The port is the part that can rot, so it is guarded — test/qa-driver.test.ts
 * asserts createHandlers() covers the IPC CHANNELS exactly; a new channel fails the
 * build until the driver learns it.
 *
 * The two halves:
 *   createHandlers(store, deps) — the handler-map port, pure and dependency-injected
 *     (no dist/ imports at module scope) so the parity test can read its keys without
 *     a build or a database.
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
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(here, '..', 'renderer');

// --------------------------------------------------------------- handler port
/**
 * The port of main.ts registerIpc's handler map (plus the §12 R9 listEntries query and
 * the toggle rule). Keys MUST cover ipc.ts CHANNELS exactly — that is the guarded
 * invariant. `deps` carries everything the bodies call:
 *   { buildUiState, nextTimerAction, startWithAttributes, reportview, favorites,
 *     listBackups, core: { toUtc, resolveRange, buildEntryList, describeOverlaps,
 *     joinClientProject }, refresh, exportsDir }
 * Bodies only run inside a sweep, so the parity test may pass empty deps.
 */
export function createHandlers(store, deps = {}) {
  const { core = {}, reportview: rv = {}, favorites: fav = {} } = deps;
  const refresh = () => deps.refresh && deps.refresh();

  // §12 R9 — the Entries-view query, ported verbatim from main.ts listEntries().
  const listEntries = (q) => {
    const now = new Date();
    const range = q.preset
      ? core.resolveRange(q.preset, store.settings().weekStart, now)
      : rv.resolveDateRange(q.fromDate, q.toDate);
    const filter = { fromUtc: range.fromUtc, toUtc: range.toUtc, billable: q.billable ?? 'all' };
    if (q.clientId !== undefined) filter.clientId = q.clientId;
    if (q.projectId !== undefined) filter.projectId = q.projectId;
    if (q.tag !== undefined && q.tag !== '') filter.tag = q.tag;
    if (q.search !== undefined && q.search !== '') filter.search = q.search;
    const entries = store.listEntries(filter);
    const overlaps = core.describeOverlaps(entries, now);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const { groups } = core.buildEntryList(entries, { by: q.by });
    return {
      groups: groups.map((g) => ({
        key: g.key,
        billableSeconds: g.entries.reduce((s, e) => s + e.billableSeconds, 0),
        entries: g.entries.map((e) => {
          const full = byId.get(e.id);
          const overlap = overlaps.get(full.id);
          return {
            id: full.id,
            description: full.description,
            clientLabel: core.joinClientProject(full.clientName, full.projectName),
            startUtc: full.startUtc,
            endUtc: full.endUtc,
            billableSeconds: full.billableSeconds,
            billable: full.billable,
            overlapped: overlap !== undefined,
            overlapMinutes: overlap ? Math.round(overlap.overlapSeconds / 60) : 0,
            overlapRelation: overlap ? overlap.relation : null,
            sleptThrough: full.sleptThrough,
            excludedSeconds: full.excludedSeconds,
            rawSeconds: full.rawSeconds,
            tags: full.tags,
          };
        }),
      })),
      rangeFromUtc: range.fromUtc,
      rangeToUtc: range.toUtc,
    };
  };

  // main.ts toggleTimer(): stop if running, else resume-or-start (PRD §12 R2).
  const toggleTimer = () => {
    const hasResumable = store.listEntries().length > 0;
    let res = null;
    switch (deps.nextTimerAction(!!store.openEntry(), hasResumable)) {
      case 'stop': res = store.stop({}); break;
      case 'resume': res = store.resume(); break;
      case 'start': res = store.start({}); break;
    }
    refresh();
    return { warnings: res?.warnings ?? [] };
  };

  const handlers = {
    getState: () => deps.buildUiState(store),
    search: (p) => deps.buildUiState(store, { search: p?.query }),
    listEntries: (p) => listEntries(p),
    toggle: () => toggleTimer(),
    start: (p) => { const res = deps.startWithAttributes(store, p ?? {}); refresh(); return { warnings: res.warnings ?? [] }; },
    stop: () => { const res = store.stop({}); refresh(); return { warnings: res.warnings ?? [] }; },
    resume: () => { const res = store.resume(); refresh(); return { warnings: res.warnings ?? [] }; },
    add: (p) => {
      const { clientId, projectId } = store.resolveClientProjectByName({ client: p.client, project: p.project });
      const res = store.add({
        description: p.description ?? null,
        fromUtc: core.toUtc(new Date(p.fromLocal)),
        toUtc: core.toUtc(new Date(p.toLocal)),
        clientId, projectId,
        tags: p.tags ?? [],
        ...(p.billable !== undefined ? { billable: p.billable } : {}),
      });
      refresh();
      return { warnings: res.warnings ?? [] };
    },
    edit: (p) => { const res = store.edit(p.id, p.patch); refresh(); return { warnings: res.warnings ?? [] }; },
    split: (p) => { store.split(p.id, p.atUtc); refresh(); return { warnings: [] }; },
    merge: (p) => {
      const opts = {};
      if (p.winnerId !== undefined) {
        const winner = store.getEntry(p.winnerId);
        if (winner) { opts.clientId = winner.clientId; opts.projectId = winner.projectId; }
      }
      if (p.billable !== undefined) opts.billable = p.billable;
      const res = store.merge(p.ids, opts);
      refresh();
      return { warnings: res.warnings ?? [] };
    },
    remove: (p) => { store.remove(p.id); refresh(); },
    subtractSleep: (p) => { store.subtractSleep(p.id); refresh(); },
    report: (p) => rv.buildReportView(store, p, new Date()),
    saveReport: (p) => { const def = store.saveReport(rv.savedReportInputFromView(p)); refresh(); return rv.savedReportToView(def); },
    listReports: () => store.listReports().map(rv.savedReportToView),
    showReport: (p) => { const def = store.getReport(p.name); return def ? rv.savedReportToView(def) : null; },
    renameReport: (p) => { const def = store.renameReport(p.name, p.newName); refresh(); return rv.savedReportToView(def); },
    editReport: (p) => { const def = store.editReport(p.name, rv.savedReportPatchFromView(p.patch)); refresh(); return rv.savedReportToView(def); },
    removeReport: (p) => { store.removeReport(p.name); refresh(); },
    runReport: (p) => rv.buildSavedReportView(store, p.ref, new Date()),
    exportEntries: (p) => {
      // The native save dialog has no host here: write to <qa-dir>/exports and return
      // the path — exactly main.ts's behavior after a confirmed dialog.
      const now = new Date();
      const { range, entries } = rv.resolveExportDefinition(p, store, now);
      const payload = rv.exportPayload(entries, p.format, now);
      mkdirSync(deps.exportsDir, { recursive: true });
      const path = join(deps.exportsDir, rv.exportFileName(range.fromUtc, p.format));
      writeFileSync(path, payload);
      return { written: entries.length, path };
    },
    pinFavorite: (p) => { const view = fav.pinFavorite(store, p); refresh(); return view; },
    listFavorites: () => fav.listFavorites(store),
    renameFavorite: (p) => { const f = store.renameFavorite(p.ref, p.name); refresh(); return fav.favoriteToView(f); },
    unpinFavorite: (p) => { store.unpinFavorite(p.ref); refresh(); },
    startFavorite: (p) => { const res = store.startFromFavorite(p.name); refresh(); return { warnings: res.warnings ?? [] }; },
    addClient: (p) => store.addClient(p.name),
    addProject: (p) => store.addProject(p.name, p.clientId),
    listClients: () => store.listClients(),
    renameClient: (p) => { store.renameClient(p.id, p.name); refresh(); },
    archiveClient: (p) => { store.archiveClient(p.id); refresh(); },
    renameProject: (p) => { store.renameProject(p.id, p.name); refresh(); },
    archiveProject: (p) => { store.archiveProject(p.id); refresh(); },
    listProjects: (p) => store.listProjects(p?.clientId),
    listTags: () => store.listTags(),
    addTag: (p) => { const t = store.addTag(p.name); refresh(); return t; },
    renameTag: (p) => { store.renameTag(p.id, p.name); refresh(); },
    archiveTag: (p) => { store.archiveTag(p.id); refresh(); },
    setSetting: (p) => { store.setSetting(p.key, p.value); refresh(); },
    listBackups: () => deps.listBackups(store),
    restoreBackup: (p) => { const r = store.restoreFromBackup(p.name); refresh(); return { recoveredFrom: r.recoveredFrom, quarantinedTo: r.quarantinedTo }; },
  };

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
  const { chromium } = await import('playwright-core');
  const { installOverlay, makeCine } = await import('./cine.mjs');
  const core = await import('@stint/core');
  const { buildUiState } = await import('../dist/uistate.js');
  const { nextTimerAction } = await import('../dist/toggle.js');
  const { startWithAttributes } = await import('../dist/start.js');
  const reportview = await import('../dist/reportview.js');
  const favorites = await import('../dist/favorites.js');
  const { listBackups } = await import('../dist/backupview.js');

  const QA = process.env.STINT_QA_DIR || join(tmpdir(), 'stint-qa');
  const dirs = Object.fromEntries(
    ['commands', 'responses', 'shots', 'videos', 'gifs', 'exports', 'home'].map((d) => [d, join(QA, d)]),
  );
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

  const store = core.Store.open({ path: join(dirs.home, 'stint.db') });
  const pages = new Set();
  const { handlers, updateHandlers } = createHandlers(store, {
    buildUiState, nextTimerAction, startWithAttributes, reportview, favorites, listBackups,
    core: {
      toUtc: core.toUtc, resolveRange: core.resolveRange, buildEntryList: core.buildEntryList,
      describeOverlaps: core.describeOverlaps, joinClientProject: core.joinClientProject,
    },
    exportsDir: dirs.exports,
    // main.ts refreshAll → broadcast('changed') to every window.
    refresh: () => { for (const p of pages) p.evaluate(() => window.__emitChanged && window.__emitChanged()).catch(() => {}); },
  });
  const all = { ...handlers, ...updateHandlers };

  const CHROME = (() => {
    const base = '/opt/pw-browsers';
    if (existsSync(base)) {
      const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
      if (dir) return join(base, dir, 'chrome-linux', 'chrome');
    }
    return chromium.executablePath();
  })();
  const launch = () => chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
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
