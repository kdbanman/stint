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
  dialog,
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
  LAST_SEEN_KEY,
  type EntryView,
  type WriteResult,
} from '@stint/core';
import { CHANNELS, type WriteAck, type UpdateProgress } from './ipc.js';
import { createIpcHandlers } from './ipc-handlers.js';
import { nextTimerAction } from './toggle.js';
import { checkinActions } from './checkin-actions.js';
import {
  currentVersion,
  checkForUpdates,
  fetchReleasesViaNet,
  latestPublishedRelease,
  normalizePlatform,
  planGuidedInstall,
  downloadUpdate,
  revealInstaller,
  type GithubRelease,
} from './update.js';
import { platform as osPlatform } from 'node:os';

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

/**
 * §19 R04 — push a Software Update progress frame to the main window over the dedicated
 * `update-progress` broadcast (mirroring the `changed` broadcast above). The Settings panel
 * paints the live progress bar + the numbered guided steps from this. It carries NO database
 * state — updates never touch the DB (§19 R04).
 */
function broadcastUpdateProgress(p: UpdateProgress): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-progress', p);
}

function refreshAll(): void {
  updateTray();
  broadcast();
}

// ------------------------------------------------------------------- check-in

function tick(): void {
  const open = store.openEntry();
  updateTray(open);

  // Maintain a heartbeat for launch-time gap reconciliation — coarse on purpose, so
  // it neither churns the database nor trips the file-watcher every second.
  maybeWriteLastSeen();

  if (!open) {
    // §20 R07 — store.stop() already cleared the schedule atomically with the close, so
    // there is normally nothing here; this is a defensive belt-and-braces clear for a DB
    // mutated out-of-band (e.g. a tt write that left no open entry but a stale schedule).
    if (store.checkinState() !== null) store.setCheckinState(null, toUtc(new Date()));
    return;
  }
  const settings = store.settings();
  // §20 R07 — the schedule is normally seeded atomically by store.start(); this lazy init is
  // only a fallback for an open entry that predates that seeding (or an out-of-band write),
  // and it persists the seed together with the heartbeat as one durable unit.
  let state = store.checkinState();
  if (!state) {
    state = initCheckinState(open.startUtc, settings.firstCheckinMin);
    store.setCheckinState(state, toUtc(new Date()));
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
    // §20 R07 — persist the advanced schedule + the heartbeat as ONE durable unit.
    store.setCheckinState(res.state, toUtc(new Date()));
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
  // §20 R07 — the heartbeat is a standalone state write; recordLastSeen owns its own short
  // transaction (there is no entry write to ride here).
  store.recordLastSeen(toUtc(new Date()));
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

/**
 * §12 R01 (G8): the tray exposes NO dropdown of app actions. A single left-click opens
 * the compact popover, which is the SOLE surface for Stop / Start + Open Stint.
 * The right-click context menu is the minimal OS-convention Quit-only menu — no timer
 * actions, nothing the popover already owns. The old 3-item Start/Stop + Open Stint
 * dropdown is removed.
 */
function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([{ role: 'quit', label: 'Quit' }]);
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
    width: 1040,
    height: 800,
    minWidth: 840,
    minHeight: 600,
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

/**
 * Bind the renderer↔main IPC handler map to ipcMain. The map itself — every channel's handler,
 * its typed payload and result — lives in ipc-handlers.ts (createIpcHandlers), pure and
 * Electron-free so it is typed against ipc.ts's IpcContract and bind-tested against CHANNELS
 * (issue #87). Here we supply the three OS-bound bits it cannot own — the window refresh, the
 * native Save dialog, and the live global-hotkey rebind — and wire each channel. The map is
 * total over Channel, so the bind needs no non-null assertion; the payload crosses the process
 * boundary as `unknown`, so it is widened once here, at the wire.
 */
function registerIpc(): void {
  const handlers = createIpcHandlers({
    store,
    refreshAll,
    toggleTimer,
    showSaveDialog: (format, defaultPath) => {
      const options: Electron.SaveDialogSyncOptions = {
        title: format === 'json' ? 'Export entries as JSON' : 'Export entries as CSV',
        defaultPath,
        filters: [
          format === 'json'
            ? { name: 'JSON', extensions: ['json'] }
            : { name: 'CSV', extensions: ['csv'] },
        ],
      };
      return mainWindow && !mainWindow.isDestroyed()
        ? dialog.showSaveDialogSync(mainWindow, options)
        : dialog.showSaveDialogSync(options);
    },
    rebindGlobalHotkey: (previous, next) => {
      globalShortcut.unregister(previous);
      try {
        globalShortcut.register(next, () => toggleTimer());
      } catch {
        // A malformed/occupied accelerator must not crash the app; the setting is still saved
        // (and provable on both surfaces), it just may not bind until corrected.
      }
    },
  });
  for (const ch of CHANNELS) {
    // ipcMain.handle is untyped and the payload genuinely crosses a process boundary as
    // `unknown`; the per-channel types live at the handler definitions (createIpcHandlers) and
    // the CHANNELS-completeness check, so widening the handler once here cannot hide drift.
    const handle = handlers[ch] as (payload: unknown) => unknown;
    ipcMain.handle(ch, (_e, payload) => handle(payload));
  }
}

/**
 * §19 R03/R04 — the Software Update IPC surface. Deliberately registered OUTSIDE the parity-
 * asserted CHANNELS loop (and bridged separately in preload under `window.stint.update`):
 * in-app update is a GUI/OS-only capability with NO `tt` equivalent (a CLI install is updated
 * by the package manager / installer), exactly like the tray and the global hotkey, so it is
 * not a parity-matrix channel.
 *
 * EVERY handler is read-only with respect to the database — none calls `store` — so updates
 * never touch the database (§19 R04 / §16 update-mid-timer). `update:check` + `update:download`
 * perform the app's only outbound requests through update.ts (Electron `net`, never node:https /
 * fetch — §17 R9); the downloaded artifact lands under the OS temp dir (`app.getPath('temp')`),
 * NEVER beside the DB. On macOS the returned guided plan surfaces the one-time Gatekeeper beat
 * (no Developer ID / notarization).
 */
function registerUpdateIpc(): void {
  // The latest published release the most recent check found, kept so download/reveal operate
  // on the same release without re-querying. The downloaded artifact path, kept so reveal can
  // open it. Neither is database state.
  let pendingRelease: GithubRelease | null = null;
  let downloadedArtifactPath: string | null = null;

  ipcMain.handle('update:getVersion', () => currentVersion());
  ipcMain.handle('update:check', async () => {
    const verdict = await checkForUpdates();
    // Remember the release behind an available update so a subsequent download targets it.
    if (verdict.status === 'update-available') {
      try {
        pendingRelease = latestPublishedRelease(await fetchReleasesViaNet());
      } catch {
        pendingRelease = null;
      }
    } else {
      pendingRelease = null;
    }
    return verdict;
  });

  // R04 — kick off the artifact download for the pending release. Returns a started ack
  // immediately; progress (and the terminal ready/error frame) is pushed over `update-progress`.
  ipcMain.handle('update:download', async () => {
    const platform = normalizePlatform(osPlatform());
    const release = pendingRelease;
    if (!release || !platform) {
      const frame: UpdateProgress = {
        phase: 'error',
        percent: 0,
        version: '',
        steps: platform ? planGuidedInstall(platform) : [],
        artifactPath: null,
        message: 'No downloadable update is available. Check for updates first.',
      };
      broadcastUpdateProgress(frame);
      return { started: false };
    }
    const version = release.tag_name.replace(/^v/, '');
    const steps = planGuidedInstall(platform);
    // Run the download out-of-band; stream progress frames to the renderer.
    void (async () => {
      try {
        broadcastUpdateProgress({
          phase: 'downloading',
          percent: 0,
          version,
          steps,
          artifactPath: null,
          message: null,
        });
        const path = await downloadUpdate(release, (percent) => {
          broadcastUpdateProgress({
            phase: 'downloading',
            percent,
            version,
            steps,
            artifactPath: null,
            message: null,
          });
        });
        downloadedArtifactPath = path;
        broadcastUpdateProgress({
          phase: 'ready',
          percent: 100,
          version,
          steps,
          artifactPath: path,
          message: null,
        });
      } catch (err) {
        broadcastUpdateProgress({
          phase: 'error',
          percent: 0,
          version,
          steps,
          artifactPath: null,
          message: err instanceof Error ? err.message : 'The update download failed.',
        });
      }
    })();
    return { started: true };
  });

  // R04 — reveal the downloaded installer in Finder / the file manager and return the ordered,
  // platform-specific guided-step plan (so the renderer can repaint the numbered steps).
  ipcMain.handle('update:reveal', () => {
    const platform = normalizePlatform(osPlatform());
    const steps = platform ? planGuidedInstall(platform) : [];
    if (downloadedArtifactPath) revealInstaller(downloadedArtifactPath);
    return { steps, artifactPath: downloadedArtifactPath };
  });
}

// -------------------------------------------------------------------- lifecycle

function init(): void {
  const dbPath = resolveDbPath(process.env, app.getPath('userData'));
  store = Store.open({ path: dbPath });

  // §20 R05 — if the database was corrupt on open, core quarantined it and restored the latest
  // good backup before we ever wrote (nothing lost). Tell the user once, on launch — the
  // Settings → Backups section also paints a "recovered" pill from this same lastRecovery.
  const recovery = store.lastRecovery();
  if (recovery) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Stint recovered your data',
      message: 'A corrupted database was detected and recovered from a backup.',
      detail:
        `Restored from ${recovery.recoveredFrom}. ` +
        `The corrupt file was set aside at ${recovery.quarantinedTo}. Nothing was lost.`,
    });
  }

  // Launch-time reconciliation: a sleep missed while the app was closed (PRD §10a).
  const lastSeen = store.getAppState(LAST_SEEN_KEY);
  if (lastSeen) store.reconcileGap(lastSeen, toUtc(new Date()));
  setLastSeen();

  registerIpc();
  registerUpdateIpc();

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
