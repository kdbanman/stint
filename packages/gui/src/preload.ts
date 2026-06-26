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

contextBridge.exposeInMainWorld('stint', api);
