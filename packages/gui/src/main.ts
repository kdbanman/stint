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
} from '@stint/core';
import { CHANNELS, type UpdateProgress } from './ipc.js';
import { popoverWindowSize, POPOVER_FALLBACK } from './popoversize.js';
import { createIpcHandlers } from './ipc-handlers.js';
import { toggleTimer } from './toggle.js';
import { checkinActions } from './checkin-actions.js';
import { schemaSkewRefusal } from './schemaskew.js';
import {
  currentVersion,
  checkForUpdates,
  fetchReleasesViaNet,
  latestPublishedRelease,
  normalizePlatform,
  planGuidedInstall,
  downloadUpdate,
  revealInstaller,
  updateFailureMessage,
  UPDATE_DOWNLOAD_FAILED,
  type GithubRelease,
} from './update.js';
import { platform as osPlatform } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(__dirname, '..', 'renderer');
// The generated mark (design.html §09, scripts/gen-icons.mjs). These are RUNTIME assets, so
// they must sit in electron-builder.yml's `files:` glob — `buildResources: build` feeds the
// packager only and ships nothing into the bundle (the why is recorded there).
const ASSETS = join(__dirname, '..', 'assets');
// Coalescing window for the DB file-watcher, in ms. One `tt` write fires several fs events
// (WAL + the -shm/-journal siblings), so the watcher must coalesce or a single command
// repaints both surfaces repeatedly. It is a CEILING on refresh latency, so it stays well
// under the 1 s display tick: "near-instantly" (§04, §17 R1) has to still read as instant.
const WATCH_COALESCE_MS = 150;

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

/**
 * The tray glyph for a state (PRD §12 R01, design.html D20). Running and idle are two
 * DISTINCT images on every platform — two bars idle, one fused block running.
 *
 * The state must ride on the image, not on the count-up title: `tray.setTitle` is macOS-only
 * in Electron, so on Linux a title-borne state is no state at all, and the tooltip only pays
 * out on hover. That was issue #162.
 *
 * macOS gets the `…Template` pair — black + alpha, which the menu bar recolours for light and
 * dark appearance; createFromPath picks up the `@2x` sibling by filename. Colour is discarded
 * there, which is exactly why the two states differ by SHAPE. Linux panels do no such
 * recolouring, so they get the accent-coloured pair at a size the panel can scale down.
 */
function trayImage(running: boolean): Electron.NativeImage {
  if (process.platform === 'darwin') {
    const img = nativeImage.createFromPath(
      join(ASSETS, `tray${running ? 'Running' : 'Idle'}Template.png`),
    );
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(join(ASSETS, `tray-${running ? 'running' : 'idle'}-panel.png`));
}

// ---------------------------------------------------------------- transitions

/**
 * The OS-bound caller of the timer toggle (PRD §12 R2): the global hotkey fires toggle.ts's
 * {@link toggleTimer} — the same function the `toggle` IPC channel serves — so the hotkey
 * and the popover's button can never drift apart. The accelerator binding wants a
 * void-returning listener; the warnings only have a surface to land on over IPC.
 */
const toggle = (): void => void toggleTimer(store, refreshAll);

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
    // Linux passes this through to the notification daemon; macOS ignores it and shows the
    // bundle icon. Without it a check-in arrives wearing the desktop's generic fallback.
    icon: join(ASSETS, 'icon-128.png'),
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

/**
 * Paint the tray for the current state. The GLYPH is the signal (§12 R01): it changes on
 * every state change, so the running state is visible on macOS and Linux alike.
 *
 * The count-up title is a macOS-only enrichment beside it — `setTitle` is a no-op elsewhere,
 * and treating it as the signal is what left Linux with a hover-only running state (#162).
 * It stays guarded so that can never silently regress.
 */
function updateTray(open: EntryView | null = store.openEntry()): void {
  if (!tray) return;
  tray.setImage(trayImage(!!open));
  if (open) {
    if (process.platform === 'darwin') tray.setTitle(` ${formatDuration(open.billableSeconds)}`);
    tray.setToolTip(`Stint — ${open.description ?? 'running'}`);
  } else {
    if (process.platform === 'darwin') tray.setTitle('');
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

/**
 * §12 R22 (issue #126): showing the popover sizes the window to its rendered card first —
 * the card is the source of truth, so the window can never clip its own controls the way
 * the old fixed 280×200 did once the card outgrew it. The measurement crosses the renderer
 * boundary untyped; popoverWindowSize parses and clamps it. Centering on the tray icon
 * uses the same measured width, so the two cannot drift apart (#174).
 */
async function togglePopover(): Promise<void> {
  if (!popover) return;
  if (popover.isVisible()) {
    popover.hide();
    return;
  }
  const card: unknown = await popover.webContents
    .executeJavaScript(
      '(() => { const c = document.getElementById("pop"); return { width: c.offsetWidth, height: c.offsetHeight }; })()',
    )
    .catch(() => null);
  const size = popoverWindowSize(card);
  popover.setContentSize(size.width, size.height);
  const bounds = tray?.getBounds();
  if (bounds)
    popover.setPosition(
      Math.round(bounds.x + bounds.width / 2 - size.width / 2),
      Math.round(bounds.y + bounds.height),
    );
  popover.show();
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
    // §12 R22 (issue #126): the default is also the floor — 840×600 was a size the app
    // permitted but could not render the unified form's commit button in.
    minWidth: 1040,
    minHeight: 800,
    show: true,
    title: 'Stint',
    // Linux window managers read the window's own icon for the taskbar and alt-tab; without
    // it they fall back to the stock Electron logo. macOS ignores it and uses the bundle's
    // .icns, so this costs nothing there.
    icon: join(ASSETS, 'icon-256.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1b1d' : '#ffffff',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  void mainWindow.loadFile(join(RENDERER, 'index.html'));
}

function createPopover(): void {
  // The size here is a placeholder — showPopover() sizes the window to the rendered card
  // before every show (§12 R22).
  popover = new BrowserWindow({
    width: POPOVER_FALLBACK.width,
    height: POPOVER_FALLBACK.height,
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
        globalShortcut.register(next, toggle);
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
          // Issue 138: the frame carries copy, not a diagnostic — an authored UpdateError's own
          // words, else update.ts's sentence. A transport failure here is a Chromium net code.
          message: updateFailureMessage(err, UPDATE_DOWNLOAD_FAILED),
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
  try {
    store = Store.open({ path: dbPath });
  } catch (err) {
    // §20 R09 — a database stamped by a NEWER Stint is refused before any write (nothing
    // beyond the database header is read); surface the actionable message (both versions +
    // "run the newer binary" + the refused path) and exit non-zero. schemaSkewRefusal returns
    // null for every other open failure (DbOpenError, RecoveryError, …), which then stays
    // exactly as loud as before.
    const refusal = schemaSkewRefusal(err);
    if (refusal) {
      dialog.showErrorBox(refusal.title, refusal.detail);
      app.exit(1);
      return;
    }
    throw err;
  }

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

  // Seeded idle; updateTray() below paints the real state (and every state change after).
  tray = new Tray(trayImage(false));
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => togglePopover());
  tray.on('right-click', () => tray?.setContextMenu(buildTrayMenu()));

  createPopover();
  updateTray();

  // Global hotkey (PRD §12 R2, §14).
  globalShortcut.register(store.settings().globalHotkey, toggle);

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
      if (now - lastTick > WATCH_COALESCE_MS) {
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
