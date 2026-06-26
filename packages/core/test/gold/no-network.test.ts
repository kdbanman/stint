/**
 * GOLD — the no-network backstop runs in CI (acceptance.html §10 "cheap GOLD
 * backstop"; §17 R9). The live-traffic confirmation stays MANUAL.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script, no types needed.
import { scanNoNetwork, shippedSourceFiles } from '../../../../scripts/check-no-network.mjs';

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
});
