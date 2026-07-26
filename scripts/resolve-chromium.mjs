/**
 * The one home for "which Chromium binary do we drive?" — shared by every harness that
 * renders through Playwright: the JUDGE (packages/gui/judge/run-judge.mjs), the QA driver
 * (packages/gui/qa/driver.mjs), and the icon generator (scripts/gen-icons.mjs).
 *
 * Managed dev containers preinstall a Chromium under /opt/pw-browsers whose build number
 * rarely matches the one playwright-core's own resolver demands, so `chromium.launch()`
 * with no path dies on a build the machine never downloaded. Probe the preinstalled tree
 * first, fall back to Playwright's own copy, and let the caller decide what a miss means.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

/** An executable path for chromium.launch(), or undefined to let Playwright try its default. */
export function resolveChromium() {
  const base = '/opt/pw-browsers';
  if (existsSync(base)) {
    const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
    if (dir) {
      const exe = join(base, dir, 'chrome-linux', 'chrome');
      if (existsSync(exe)) return exe;
    }
  }
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}
