/**
 * GOLD — the no-network backstop runs in CI (acceptance.html §10 "cheap GOLD
 * backstop"; §17 R9). The live-traffic confirmation stays MANUAL.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script, no types needed.
import { scanNoNetwork, shippedSourceFiles, electronNetSites, usesElectronNet } from '../../../../scripts/check-no-network.mjs';

describe('GOLD: no network (§17 R9)', () => {
  it('no shipped source imports a networking module or calls an outbound API', () => {
    const violations = scanNoNetwork();
    expect(violations).toEqual([]);
  });

  it('the scan actually covers the shipped Electron renderer, not just packages/*/src', () => {
    // Regression guard: the renderer ships outside src, so the backstop must walk it
    // for a renderer-side fetch()/WebSocket to ever be caught.
    const scanned = shippedSourceFiles() as string[];
    const rendererFiles = scanned.filter((f) => /packages\/gui\/renderer\/.*\.js$/.test(f));
    expect(rendererFiles.some((f) => f.endsWith('app.js'))).toBe(true);
    expect(rendererFiles.some((f) => f.endsWith('popover.js'))).toBe(true);
    expect(rendererFiles.some((f) => f.endsWith('util.js'))).toBe(true);
  });

  it('Electron `net` is reachable from exactly one shipped file — the update check', () => {
    // §17 R09 / §19 R03: `electron` is an allowed prod dep, so a second `net.request` site would
    // slip past the module/token scan. The file-level pin allows exactly update.ts; this asserts
    // the sole recognized site so removing the pin (or adding a second importer) breaks the suite.
    const sites = (electronNetSites() as string[]).map((f) => f.replace(/.*\/packages\//, 'packages/'));
    expect(sites).toEqual(['packages/gui/src/update.ts']);
  });

  it('the pin detector flags a would-be second electron-net site (deletion-test)', () => {
    // The deletion-test the pin exists to bite: any OTHER file that imports electron's `net` or
    // calls `net.request` is detected — while an ordinary `electron` import (no `net`) is not.
    expect(usesElectronNet("import { app, net, shell } from 'electron';")).toBe(true);
    expect(usesElectronNet('const r = net.request({ method: "GET", url });')).toBe(true);
    expect(usesElectronNet("import { app, BrowserWindow } from 'electron';")).toBe(false);
  });
});
