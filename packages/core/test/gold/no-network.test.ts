/**
 * GOLD — the no-network backstop runs in CI (acceptance.html §10 "cheap GOLD
 * backstop"; §17 R9). The live-traffic confirmation stays MANUAL.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script, no types needed.
import { scanNoNetwork } from '../../../../scripts/check-no-network.mjs';

describe('GOLD: no network (§17 R9)', () => {
  it('no shipped source imports a networking module or calls an outbound API', () => {
    const violations = scanNoNetwork();
    expect(violations).toEqual([]);
  });
});
