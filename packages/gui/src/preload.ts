/**
 * Preload bridge — exposes a minimal, typed surface to the renderer over context
 * isolation. The renderer never touches Node or the database directly; every action
 * is an IPC call to the main process, which owns the shared core.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from './ipc.js';

const api: Record<string, unknown> = {
  onChange: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('changed', listener);
    return () => ipcRenderer.removeListener('changed', listener);
  },
};

for (const ch of CHANNELS) {
  api[ch] = (payload?: unknown) => ipcRenderer.invoke(ch, payload);
}

// §19 R03/R04 — the Software Update bridge, registered EXPLICITLY under its own namespace
// (window.stint.update) rather than via the CHANNELS loop, so it stays off the parity-asserted
// channel set: in-app update is a GUI/OS-only capability with no `tt` twin (like the tray /
// global hotkey). The renderer calls getVersion() / check() (R03) and download() / reveal()
// (R04) here; main.ts's separate update IPC surface owns the only outbound requests (the check
// + the artifact byte download). onUpdateProgress subscribes to the dedicated `update-progress`
// broadcast (same shape as onChange) so the Settings panel paints the live progress bar +
// numbered guided steps.
api.update = {
  getVersion: () => ipcRenderer.invoke('update:getVersion'),
  check: () => ipcRenderer.invoke('update:check'),
  // R04: kick off the download of the latest release's platform artifact (returns a started
  // ack); progress is pushed over `update-progress`.
  download: () => ipcRenderer.invoke('update:download'),
  // R04: reveal the downloaded installer in Finder / the file manager and return the ordered,
  // platform-specific guided-step plan.
  reveal: () => ipcRenderer.invoke('update:reveal'),
  // R04: subscribe to live download/guided-install progress. Returns an unsubscribe fn,
  // mirroring onChange.
  onUpdateProgress: (cb: (p: unknown) => void) => {
    const listener = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on('update-progress', listener);
    return () => ipcRenderer.removeListener('update-progress', listener);
  },
};

contextBridge.exposeInMainWorld('stint', api);
