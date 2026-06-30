/**
 * Renderer isolation posture (PRD §04, §15) — a fast static guard over the compiled
 * main-process + preload source, the same source-as-text pattern tray.test.ts uses for
 * facts a headless renderer cannot drive.
 *
 * §04 requires the GUI renderer to hold NO direct database / filesystem / network access:
 * it reaches stored data exclusively through the shared core in the main process, across a
 * controlled bridge. The renderer WIRING (which IPC each control calls) is covered by
 * renderer-static.test.ts / parity.test.ts; this pins the ISOLATION POSTURE itself —
 * context isolation ON, no node integration, a preload bridge on every window, and a
 * renderer surface that only ever speaks `ipcRenderer.invoke` (never Node, fs, or the DB).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const srcUrl = (rel: string) => fileURLToPath(new URL(`../src/${rel}`, import.meta.url));
const main = readFileSync(srcUrl('main.ts'), 'utf8');
const preload = readFileSync(srcUrl('preload.ts'), 'utf8');

const rendererDir = fileURLToPath(new URL('../renderer/', import.meta.url));
const rendererJs = readdirSync(rendererDir).filter((f) => f.endsWith('.js'));

describe('renderer isolation posture (§04)', () => {
  it('every BrowserWindow turns context isolation ON and never enables node integration', () => {
    const windows = main.match(/new BrowserWindow\(/g) ?? [];
    expect(windows.length, 'main.ts must create at least one BrowserWindow').toBeGreaterThan(0);
    // Each window's webPreferences sets contextIsolation: true — one per BrowserWindow.
    const isolated = main.match(/contextIsolation:\s*true/g) ?? [];
    expect(isolated.length).toBe(windows.length);
    // …and no window ever turns it OFF or turns node integration ON (both default-safe in
    // modern Electron, but a regression that flips either is what breaks the §04 posture).
    expect(main).not.toMatch(/contextIsolation:\s*false/);
    expect(main).not.toMatch(/nodeIntegration:\s*true/);
    expect(main).not.toMatch(/enableRemoteModule:\s*true/);
  });

  it('every BrowserWindow loads the preload bridge (the only path into the renderer)', () => {
    const windows = main.match(/new BrowserWindow\(/g) ?? [];
    const preloads = main.match(/preload:\s*join\(__dirname,\s*'preload\.js'\)/g) ?? [];
    // One preload per window — no window is created bare (which would leave the renderer with
    // no bridge AND no isolation contract to reach data through).
    expect(preloads.length).toBe(windows.length);
  });

  it('the preload exposes a typed bridge and reaches the main process ONLY over IPC', () => {
    // The bridge is published across context isolation via contextBridge.exposeInMainWorld…
    expect(preload).toMatch(/contextBridge\.exposeInMainWorld\(\s*'stint'/);
    expect(preload).toMatch(/from 'electron'/);
    // …and every renderer-reachable action is an ipcRenderer call (invoke/on), never a direct
    // database / filesystem / network reach. The preload must not import core or Node data APIs.
    expect(preload).toMatch(/ipcRenderer\.invoke\(/);
    expect(preload).not.toMatch(/@stint\/core/);
    expect(preload).not.toMatch(/node:sqlite|DatabaseSync/);
    expect(preload).not.toMatch(/from 'node:fs'|from 'fs'|node:fs\/promises/);
    expect(preload).not.toMatch(/from 'node:net'|from 'node:http'|from 'node:https'/);
  });

  it('no renderer page script reaches Node, the database, or the network directly', () => {
    expect(rendererJs.length).toBeGreaterThan(0);
    for (const file of rendererJs) {
      const src = readFileSync(`${rendererDir}${file}`, 'utf8');
      // The renderer runs under context isolation with no node integration, so these would all
      // be unavailable at runtime — but a regression that reintroduces one is caught here first.
      expect(src, `${file} must not require()/import Node modules`).not.toMatch(
        /\brequire\(\s*['"]/,
      );
      expect(src, `${file} must not import @stint/core`).not.toMatch(/@stint\/core/);
      expect(src, `${file} must not touch node:sqlite / DatabaseSync`).not.toMatch(
        /node:sqlite|DatabaseSync/,
      );
      expect(src, `${file} must not read the filesystem`).not.toMatch(/node:fs|\bfs\.(readFile|writeFile|readdir)/);
      // No direct network egress from the renderer — data-out (export) and update downloads go
      // through the main process; the renderer never opens its own socket/fetch to the network.
      expect(src, `${file} must not open its own network connection`).not.toMatch(
        /\bfetch\(|XMLHttpRequest|new WebSocket\(|node:http/,
      );
    }
  });
});
