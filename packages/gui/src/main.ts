/**
 * Stint GUI — the Electron main process (PRD §12, §15).
 *
 * A Tray with a popover BrowserWindow for the running timer, plus a main
 * BrowserWindow for lists and reports. All data flows through @stint/core — the
 * same single source of truth the tt CLI uses. The main process additionally owns
 * the OS integration the CLI cannot: tray count-up, the global hotkey, powerMonitor
 * sleep flagging with launch-time wall-clock-gap reconciliation, check-in
 * notifications on a persisted wall-clock schedule, and file-watch refresh.
 *
 * It opens no sockets and makes no network connections (PRD §17 R9).
 */
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  powerMonitor,
  Notification,
  ipcMain,
  nativeTheme,
  systemPreferences,
  dialog,
} from 'electron';
import { watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Store,
  resolveDbPath,
  toUtc,
  formatDuration,
  initCheckinState,
  evaluateCheckin,
  resolveRange,
  buildEntryList,
  describeOverlaps,
  joinClientProject,
  type CheckinState,
  type EntryView,
  type EntryGroupBy,
  type WriteResult,
} from '@stint/core';
import { CHANNELS, type WriteAck, type ListEntriesQuery, type EntryListView } from './ipc.js';
import { buildUiState } from './uistate.js';
import { nextTimerAction } from './toggle.js';
import { checkinActions } from './checkin-actions.js';
import { startWithAttributes, type StartPayload } from './start.js';
import {
  buildReportView,
  resolveExportRange,
  exportPayload,
  exportFileName,
  type ReportViewRequest,
  type ExportRequest,
} from './reportview.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(__dirname, '..', 'renderer');

let store: Store;
let tray: Tray | null = null;
let popover: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let watcher: FSWatcher | null = null;
let suspendedAt: string | null = null;
let lastTick = 0;
let lastSeenWrite = 0;

// PRD §10b R4: an inline, per-notification override of the minutes until the NEXT
// check-in only. Set by a notification action button between ticks; consumed exactly
// once by the next tick (then cleared), so the cadence reverts to the persisted
// default. This is NOT the persisted `checkin_interval_min` setting.
let pendingCheckinOverrideMin: number | undefined;

const LAST_SEEN_KEY = 'last_seen_utc';
const CHECKIN_KEY = 'checkin_state';

// ----------------------------------------------------------------- tray icon

/** A monochrome clock glyph drawn into an RGBA bitmap — no binary asset to ship. */
function trayIcon(): Electron.NativeImage {
  const size = 22;
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  const ink = nativeTheme.shouldUseDarkColors ? 235 : 30;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      const ring = Math.abs(dist - r) < 1.3;
      // Clock hands: 12 o'clock and 3 o'clock.
      const hand = (Math.abs(dx) < 1 && dy < 0 && dy > -r + 2) || (Math.abs(dy) < 1 && dx > 0 && dx < r - 3);
      const on = ring || (hand && dist < r - 1);
      buf[i] = ink;
      buf[i + 1] = ink;
      buf[i + 2] = ink;
      buf[i + 3] = on ? 255 : 0;
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size });
  img.setTemplateImage(true);
  return img;
}

function accentColor(): string {
  try {
    return '#' + systemPreferences.getAccentColor().slice(0, 6);
  } catch {
    return '#2f6fed';
  }
}

// ---------------------------------------------------------------- transitions

/**
 * Toggle the timer — stop if running, else resume the last entry (PRD §12 R2). It
 * returns the underlying write's warnings (a resume/start can land on an instant that
 * overlaps another entry, PRD §06 R4) so the renderer can surface them inline.
 */
function toggleTimer(): WriteAck {
  const hasResumable = store.listEntries().length > 0;
  let res: WriteResult<EntryView> | null = null;
  switch (nextTimerAction(!!store.openEntry(), hasResumable)) {
    case 'stop':
      res = store.stop({});
      break;
    case 'resume':
      res = store.resume();
      break;
    case 'start':
      res = store.start({});
      break;
  }
  refreshAll();
  return { warnings: res?.warnings ?? [] };
}

function broadcast(): void {
  for (const w of [popover, mainWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send('changed');
  }
}

function refreshAll(): void {
  updateTray();
  broadcast();
}

// ------------------------------------------------------------------- check-in

function loadCheckinState(): CheckinState | null {
  const raw = store.getAppState(CHECKIN_KEY);
  return raw ? (JSON.parse(raw) as CheckinState) : null;
}

function saveCheckinState(state: CheckinState | null): void {
  if (state === null) store.deleteAppState(CHECKIN_KEY);
  else store.setAppState(CHECKIN_KEY, JSON.stringify(state));
}

function tick(): void {
  const open = store.openEntry();
  updateTray(open);

  // Maintain a heartbeat for launch-time gap reconciliation — coarse on purpose, so
  // it neither churns the database nor trips the file-watcher every second.
  maybeWriteLastSeen();

  if (!open) {
    saveCheckinState(null);
    return;
  }
  const settings = store.settings();
  let state = loadCheckinState();
  if (!state) {
    state = initCheckinState(open.startUtc, settings.firstCheckinMin);
    saveCheckinState(state);
  }
  // A per-notification interval pick (PRD §10b R4) overrides the NEXT gap only. It was
  // set by a notification action since the last tick; consume it exactly once here and
  // clear it so the cadence reverts to the default afterwards. The just-fired check-in
  // already advanced nextDue past now, so this override lands on the following gap —
  // matching "applies to the next gap only, then reverts".
  const override = pendingCheckinOverrideMin;
  pendingCheckinOverrideMin = undefined;
  const res = evaluateCheckin(state, settings.checkinIntervalMin, new Date(), override);
  if (res.fire) {
    fireCheckin(open);
    saveCheckinState(res.state);
  }
}

function fireCheckin(open: EntryView): void {
  if (!Notification.isSupported()) return;
  const context = open.description
    ? `"${open.description}"${open.clientName ? ` · ${open.clientName}` : ''}`
    : 'your timer';
  const { actions, intervalForIndex } = checkinActions();
  const n = new Notification({
    title: 'Still tracking?',
    body: `${context} — ${formatDuration(open.billableSeconds)} so far.`,
    actions,
  });
  n.on('action', (_e, index) => {
    const choice = intervalForIndex(index);
    if (choice === 'stop') {
      store.stop({});
      refreshAll();
    } else if (choice === 'keepDefault') {
      // Leave the override unset — the next gap stays the configured default cadence.
    } else {
      // A per-notification, next-gap-only override (PRD §10b R4). Does NOT stop the
      // timer and does NOT touch the persisted `checkin_interval_min` setting; the next
      // tick consumes it once, then cadence reverts to the default.
      pendingCheckinOverrideMin = choice;
    }
  });
  n.show();
}

function setLastSeen(): void {
  store.setAppState(LAST_SEEN_KEY, toUtc(new Date()));
  lastSeenWrite = Date.now();
}

/** Heartbeat the last-seen marker at most every 30 s (PRD §10a gap reconciliation). */
function maybeWriteLastSeen(): void {
  if (Date.now() - lastSeenWrite >= 30_000) setLastSeen();
}

// ----------------------------------------------------------------------- tray

function updateTray(open: EntryView | null = store.openEntry()): void {
  if (!tray) return;
  if (open) {
    tray.setTitle(` ${formatDuration(open.billableSeconds)}`);
    tray.setToolTip(`Stint — ${open.description ?? 'running'}`);
  } else {
    tray.setTitle('');
    tray.setToolTip('Stint — idle');
  }
}

function buildTrayMenu(): Menu {
  const open = store.openEntry();
  return Menu.buildFromTemplate([
    open
      ? { label: `Stop (${formatDuration(open.billableSeconds)})`, click: () => toggleTimer() }
      : { label: 'Start / resume', click: () => toggleTimer() },
    { type: 'separator' },
    { label: 'Open Stint', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function togglePopover(): void {
  if (!popover) return;
  if (popover.isVisible()) {
    popover.hide();
  } else {
    const bounds = tray?.getBounds();
    if (bounds) popover.setPosition(Math.round(bounds.x - 140 + bounds.width / 2), Math.round(bounds.y + bounds.height));
    popover.show();
  }
}

// --------------------------------------------------------------------- windows

function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 760,
    height: 620,
    show: true,
    title: 'Stint',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1b1d' : '#ffffff',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  void mainWindow.loadFile(join(RENDERER, 'index.html'));
}

function createPopover(): void {
  popover = new BrowserWindow({
    width: 280,
    height: 200,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  void popover.loadFile(join(RENDERER, 'popover.html'));
  popover.on('blur', () => popover?.hide());
}

// ------------------------------------------------------------ entries query (§12 R9)

/**
 * §12 R9 — the Entries view's grouped/filtered/searched list. A read-only query: it
 * resolves the range (preset via core's resolveRange, or the explicit custom from/to),
 * narrows through store.listEntries (range/client/project/tag/billable/search — exactly
 * `tt list`), groups via core's buildEntryList, and projects each entry to the
 * renderer-safe row shape with its overlap flag. No write, so it never refreshes windows.
 */
function listEntries(q: ListEntriesQuery): EntryListView {
  const now = new Date();
  const range = q.preset
    ? resolveRange(q.preset, store.settings().weekStart, now)
    : { fromUtc: q.fromUtc!, toUtc: q.toUtc! };
  const filter: Parameters<Store['listEntries']>[0] = {
    fromUtc: range.fromUtc,
    toUtc: range.toUtc,
    billable: q.billable ?? 'all',
  };
  if (q.clientId !== undefined) filter.clientId = q.clientId;
  if (q.projectId !== undefined) filter.projectId = q.projectId;
  if (q.tag !== undefined && q.tag !== '') filter.tag = q.tag;
  if (q.search !== undefined && q.search !== '') filter.search = q.search;
  const entries = store.listEntries(filter);
  // §12 R9: per-entry overlap detail (worst-neighbour minutes + previous/next relation)
  // off the one core rule, so the Entries-view rows paint the same detailed banner the
  // day-grouped getState path does. `describeOverlaps` keys are exactly the overlapped ids.
  const overlaps = describeOverlaps(entries, now);
  const byId = new Map(entries.map((e) => [e.id, e]));
  // store.listEntries already applied the free-text search (via the filter, like the
  // CLI), so buildEntryList only needs to group the surviving set here.
  const { groups } = buildEntryList(entries, { by: q.by as EntryGroupBy });
  return {
    groups: groups.map((g) => ({
      key: g.key,
      billableSeconds: g.entries.reduce((s, e) => s + e.billableSeconds, 0),
      entries: g.entries.map((e) => {
        const full = byId.get(e.id)!;
        const overlap = overlaps.get(full.id);
        return {
          id: full.id,
          description: full.description,
          clientLabel: joinClientProject(full.clientName, full.projectName),
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
}

// ------------------------------------------------------------------------- IPC

function registerIpc(): void {
  const handlers: Record<string, (payload: unknown) => unknown> = {
    getState: () => buildUiState(store, accentColor()),
    // §09 R7: free-text search over the day-grouped history list. The query rides inside
    // the payload and narrows the listed entries through core (parity with `tt list
    // --search`); the returned UiState is painted exactly as getState's is.
    search: (p) => buildUiState(store, accentColor(), { search: (p as { query?: string })?.query }),
    // §12 R9: the Entries view's control bar. Read-only (no refreshAll): resolve the range
    // (a preset through core's resolveRange — the same rule the report picker drives — or
    // the explicit custom from/to), list the entries through the SAME store.listEntries the
    // CLI uses (range/client/project/tag/billable/search all narrow there), then group via
    // core's buildEntryList. Returns the grouped rows + the resolved window; the renderer
    // paints it and re-derives no grouping/matching (parity with `tt list … --by`).
    listEntries: (p): EntryListView => listEntries(p as ListEntriesQuery),
    // A write IPC channel returns a WriteAck carrying the core write's warnings (PRD §06
    // R4: overlap is allowed but flagged) so the renderer can surface an inline banner at
    // the moment of the edit. getState/report/list-style channels stay value-returning.
    toggle: () => toggleTimer(),
    start: (p): WriteAck => {
      // The renderer's Start form supplies optional attributes (description, client,
      // project, tags, billable); resolve and forward them all (PRD §05 R1, §12 R1). A
      // start can land on an instant that overlaps an existing entry — warned, not blocked.
      const res = startWithAttributes(store, (p as StartPayload) ?? {});
      refreshAll();
      return { warnings: res.warnings ?? [] };
    },
    stop: (): WriteAck => {
      const res = store.stop({});
      refreshAll();
      return { warnings: res.warnings ?? [] };
    },
    resume: (): WriteAck => {
      const res = store.resume();
      refreshAll();
      return { warnings: res.warnings ?? [] };
    },
    add: (p): WriteAck => {
      // §12 R7 / §05 R5: backfill a completed entry from explicit from/to times. Mirror
      // `tt add` exactly so the surfaces stay equal: the two local datetime strings convert
      // to UTC, client/project names resolve through core's single rule, tags/billable ride
      // along. A backfill can land on a span that overlaps an existing entry — warned, not
      // blocked (§06 R4) — so we return the uniform WriteAck carrying the overlap warning,
      // exactly like start/edit, and the renderer raises the same inline banner. Core
      // validation errors (`--to must be after --from`) propagate as the IPC rejection.
      const payload = p as {
        description?: string | null;
        fromLocal: string;
        toLocal: string;
        client?: string;
        project?: string;
        tags?: string[];
        billable?: boolean;
      };
      const { clientId, projectId } = store.resolveClientProjectByName({
        client: payload.client,
        project: payload.project,
      });
      const res = store.add({
        description: payload.description ?? null,
        fromUtc: toUtc(new Date(payload.fromLocal)),
        toUtc: toUtc(new Date(payload.toLocal)),
        clientId,
        projectId,
        tags: payload.tags ?? [],
        ...(payload.billable !== undefined ? { billable: payload.billable } : {}),
      });
      refreshAll();
      return { warnings: res.warnings ?? [] };
    },
    edit: (p): WriteAck => {
      // Editing a start/end can move an entry onto an instant that overlaps another
      // (PRD §06 R4); core warns-not-blocks, and we return that warning so the renderer
      // raises the inline overlap banner at the moment of the edit.
      const { id, patch } = p as { id: number; patch: Parameters<Store['edit']>[1] };
      const res = store.edit(id, patch);
      refreshAll();
      return { warnings: res.warnings ?? [] };
    },
    split: (p): WriteAck => {
      // split returns the two new entries (not a WriteResult); cutting a span in place
      // cannot create a NEW overlap, so there is nothing to warn about — but the channel
      // still returns the uniform WriteAck so the renderer's write path stays one shape.
      const { id, atUtc } = p as { id: number; atUtc: string };
      store.split(id, atUtc);
      refreshAll();
      return { warnings: [] };
    },
    merge: (p): WriteAck => {
      // Fold a contiguous selection into one entry (PRD §06 R3). Core concatenates
      // descriptions and unions tags unconditionally; client/project and billable can
      // disagree. The renderer cannot resolve names, so when the conflict prompt picks a
      // winner it sends that entry's id as `winnerId` — we look it up here and pass its
      // clientId/projectId as MergeOptions overrides, plus the chosen billable flag. With
      // no winnerId/billable (the selection already agreed) core keeps the first entry's
      // attributes, exactly as `tt merge` does.
      const { ids, winnerId, billable } = p as {
        ids: number[];
        winnerId?: number;
        billable?: boolean;
      };
      const opts: Parameters<Store['merge']>[1] = {};
      if (winnerId !== undefined) {
        const winner = store.getEntry(winnerId);
        if (winner) {
          opts.clientId = winner.clientId;
          opts.projectId = winner.projectId;
        }
      }
      if (billable !== undefined) opts.billable = billable;
      const res = store.merge(ids, opts);
      refreshAll();
      // A merge folds adjacent spans into one; the folded span can still overlap a
      // third entry outside the selection (PRD §06 R4), so return any overlap warning.
      return { warnings: res.warnings ?? [] };
    },
    remove: (p) => {
      store.remove((p as { id: number }).id);
      refreshAll();
    },
    subtractSleep: (p) => {
      store.subtractSleep((p as { id: number }).id);
      refreshAll();
    },
    report: (p) => {
      // §09 R1: the GUI report view's date-range picker. The five presets (today / week /
      // last-week / month / last-month) are resolved through core's resolveRange — the
      // renderer never re-derives date math — by the pure buildReportView helper (mirroring
      // uistate.ts): a preset, when supplied, takes precedence and fills in {fromUtc, toUtc};
      // the Custom path passes the user's explicit fromUtc/toUtc straight through. The
      // returned shape is the core Report the report view paints verbatim.
      return buildReportView(store, p as ReportViewRequest, new Date());
    },
    exportEntries: (p) => {
      // §09 R6: the report view's Export CSV / Export JSON. The renderer cannot reach
      // Node/fs, so the export round-trips through main. Resolve the same range the report
      // used (preset via core's resolveRange, or the explicit custom from/to), list the
      // raw entries (billable='all', no filter — exactly `tt export`), render the bytes via
      // core's toCsv/toJsonEntries, and write them through the OS save dialog. No network.
      const req = p as ExportRequest;
      const now = new Date();
      const range = resolveExportRange(req, store.settings().weekStart, now);
      const entries = store.listEntries({
        fromUtc: range.fromUtc,
        toUtc: range.toUtc,
        billable: 'all',
      });
      const payload = exportPayload(entries, req.format, now);
      const options: Electron.SaveDialogSyncOptions = {
        title: req.format === 'json' ? 'Export entries as JSON' : 'Export entries as CSV',
        defaultPath: exportFileName(range.fromUtc, req.format),
        filters: [
          req.format === 'json'
            ? { name: 'JSON', extensions: ['json'] }
            : { name: 'CSV', extensions: ['csv'] },
        ],
      };
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? dialog.showSaveDialogSync(mainWindow, options)
          : dialog.showSaveDialogSync(options);
      if (!result) return { canceled: true };
      writeFileSync(result, payload);
      return { written: entries.length, path: result };
    },
    addClient: (p) => store.addClient((p as { name: string }).name),
    addProject: (p) => {
      const { name, clientId } = p as { name: string; clientId: number };
      return store.addProject(name, clientId);
    },
    listClients: () => store.listClients(),
    // §07: the Clients view's rename/archive over the same reference-data capabilities
    // tt's `client`/`project` subcommands expose. Each is a thin delegate to core — the
    // single source of truth — and refreshes all windows so an open Clients view (or the
    // entries view, whose labels are resolved not copied) repaints the new truth.
    renameClient: (p) => {
      const { id, name } = p as { id: number; name: string };
      store.renameClient(id, name);
      refreshAll();
    },
    archiveClient: (p) => {
      store.archiveClient((p as { id: number }).id);
      refreshAll();
    },
    renameProject: (p) => {
      const { id, name } = p as { id: number; name: string };
      store.renameProject(id, name);
      refreshAll();
    },
    archiveProject: (p) => {
      store.archiveProject((p as { id: number }).id);
      refreshAll();
    },
    listProjects: (p) => {
      const { clientId } = (p as { clientId?: number }) ?? {};
      return store.listProjects(clientId);
    },
    // §12 R10: the Clients view's tag-management strip. Each delegates straight to core —
    // the single source of truth — at parity with `tt tag add/rename/archive/ls`. The
    // mutators refresh all windows so an open view (and the entries view, whose tag chips
    // are resolved not copied) repaints the new truth; listTags is a read, no refresh.
    listTags: () => store.listTags(),
    addTag: (p) => {
      const t = store.addTag((p as { name: string }).name);
      refreshAll();
      return t;
    },
    renameTag: (p) => {
      const { id, name } = p as { id: number; name: string };
      store.renameTag(id, name);
      refreshAll();
    },
    archiveTag: (p) => {
      store.archiveTag((p as { id: number }).id);
      refreshAll();
    },
    setSetting: (p) => {
      // §12 R11: the Settings view (and the report view's rounding controls) persist any §14
      // setting over this one channel — parity with `tt config set` (no new channel). A
      // global-hotkey edit must take effect live, so re-register the OS shortcut here: drop
      // the old accelerator and bind the new one, all without a relaunch.
      const { key, value } = p as { key: keyof ReturnType<Store['settings']>; value: never };
      const prevHotkey = store.settings().globalHotkey;
      store.setSetting(key as never, value);
      if (key === 'globalHotkey') {
        const next = store.settings().globalHotkey;
        if (next !== prevHotkey) {
          globalShortcut.unregister(prevHotkey);
          try {
            globalShortcut.register(next, () => toggleTimer());
          } catch {
            // A malformed/occupied accelerator must not crash the app; the setting is still
            // saved (and provable on both surfaces), it just may not bind until corrected.
          }
        }
      }
      refreshAll();
    },
  };
  for (const ch of CHANNELS) {
    ipcMain.handle(ch, (_e, payload) => handlers[ch]!(payload));
  }
}

// -------------------------------------------------------------------- lifecycle

function init(): void {
  const dbPath = resolveDbPath(process.env, app.getPath('userData'));
  store = Store.open({ path: dbPath });

  // Launch-time reconciliation: a sleep missed while the app was closed (PRD §10a).
  const lastSeen = store.getAppState(LAST_SEEN_KEY);
  if (lastSeen) store.reconcileGap(lastSeen, toUtc(new Date()));
  setLastSeen();

  registerIpc();

  tray = new Tray(trayIcon());
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => togglePopover());
  tray.on('right-click', () => tray?.setContextMenu(buildTrayMenu()));

  createPopover();
  updateTray();

  // Global hotkey (PRD §12 R2, §14).
  globalShortcut.register(store.settings().globalHotkey, () => toggleTimer());

  // Sleep flagging via powerMonitor (PRD §10a).
  powerMonitor.on('suspend', () => {
    suspendedAt = toUtc(new Date());
  });
  powerMonitor.on('resume', () => {
    const open = store.openEntry();
    if (open && suspendedAt) {
      store.recordSleepSpan(open.id, suspendedAt, toUtc(new Date()), 'event');
      refreshAll();
    }
    suspendedAt = null;
  });

  // File-watch refresh so a tt write surfaces here near-instantly (PRD §04, §17 R1).
  try {
    watcher = watch(dbPath, { persistent: false }, () => {
      const now = Date.now();
      if (now - lastTick > 150) {
        lastTick = now;
        broadcast();
        updateTray();
      }
    });
  } catch {
    /* watch is best-effort */
  }

  // The 1-second display tick (independent of file-watch) and check-in evaluation.
  setInterval(tick, 1000);

  showMainWindow();
}

app.whenReady().then(init);

app.on('window-all-closed', () => {
  // Stay alive in the tray; this is a background instrument (do not quit).
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  watcher?.close();
  try {
    setLastSeen();
    store?.close();
  } catch {
    /* ignore */
  }
});
