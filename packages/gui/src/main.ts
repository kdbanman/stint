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
} from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Store,
  resolveDbPath,
  toUtc,
  formatDuration,
  initCheckinState,
  evaluateCheckin,
  type CheckinState,
  type EntryView,
} from '@stint/core';
import { CHANNELS } from './ipc.js';
import { buildUiState } from './uistate.js';
import { nextTimerAction } from './toggle.js';

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

/** Toggle the timer — stop if running, else resume the last entry (PRD §12 R2). */
function toggleTimer(): void {
  const hasResumable = store.listEntries().length > 0;
  switch (nextTimerAction(!!store.openEntry(), hasResumable)) {
    case 'stop':
      store.stop({});
      break;
    case 'resume':
      store.resume();
      break;
    case 'start':
      store.start({});
      break;
  }
  refreshAll();
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
  const res = evaluateCheckin(state, settings.checkinIntervalMin, new Date());
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
  const n = new Notification({
    title: 'Still tracking?',
    body: `${context} — ${formatDuration(open.billableSeconds)} so far.`,
    actions: [
      { type: 'button', text: 'Stop' },
      { type: 'button', text: 'Keep going' },
    ],
  });
  n.on('action', (_e, index) => {
    if (index === 0) {
      store.stop({});
      refreshAll();
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

// ------------------------------------------------------------------------- IPC

function registerIpc(): void {
  const handlers: Record<string, (payload: unknown) => unknown> = {
    getState: () => buildUiState(store, accentColor()),
    toggle: () => (toggleTimer(), buildUiState(store, accentColor())),
    start: (p) => {
      store.start((p as Record<string, never>) ?? {});
      refreshAll();
    },
    stop: () => {
      store.stop({});
      refreshAll();
    },
    resume: () => {
      store.resume();
      refreshAll();
    },
    edit: (p) => {
      const { id, patch } = p as { id: number; patch: Parameters<Store['edit']>[1] };
      store.edit(id, patch);
      refreshAll();
    },
    split: (p) => {
      const { id, atUtc } = p as { id: number; atUtc: string };
      store.split(id, atUtc);
      refreshAll();
    },
    merge: (p) => {
      store.merge((p as { ids: number[] }).ids);
      refreshAll();
    },
    remove: (p) => {
      store.remove((p as { id: number }).id);
      refreshAll();
    },
    subtractSleep: (p) => {
      store.subtractSleep((p as { id: number }).id);
      refreshAll();
    },
    report: (p) => store.report(p as Parameters<Store['report']>[0]),
    addClient: (p) => store.addClient((p as { name: string }).name),
    addProject: (p) => {
      const { name, clientId } = p as { name: string; clientId: number };
      return store.addProject(name, clientId);
    },
    listClients: () => store.listClients(),
    setSetting: (p) => {
      const { key, value } = p as { key: never; value: never };
      store.setSetting(key, value);
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
