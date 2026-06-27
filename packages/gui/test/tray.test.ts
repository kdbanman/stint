/**
 * Tray behavior source-guard (PRD §12 R01 / G8). The tray itself has no host under
 * headless Chromium (the JUDGE harness drives renderer windows only), so the tray's
 * click wiring and its context-menu contents are frozen here by reading the compiled
 * main-process source as text — the same static-guard pattern renderer-static.test.ts
 * uses for assertions a headless renderer cannot drive.
 *
 * The decision this freezes: a single LEFT-click opens the compact popover (the SOLE
 * surface for Stop / Switch / Start + Open Stint); the old 3-item Start/Stop + Open
 * Stint dropdown is GONE; the right-click context menu is the minimal OS-convention
 * Quit-only menu — it builds no timer action and nothing the popover already owns.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

// The body of buildTrayMenu — the only place the tray's context menu template is built.
function buildTrayMenuBody(): string {
  const start = main.indexOf('function buildTrayMenu(');
  expect(start, 'buildTrayMenu must exist').toBeGreaterThanOrEqual(0);
  // Walk to the matching close brace of the function body.
  const open = main.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < main.length; i++) {
    if (main[i] === '{') depth++;
    else if (main[i] === '}') {
      depth--;
      if (depth === 0) return main.slice(open, i + 1);
    }
  }
  throw new Error('buildTrayMenu body not found');
}

describe('tray behavior (§12 R01 / G8)', () => {
  it('a single left-click is wired to togglePopover (the compact popover, no dropdown of actions)', () => {
    // The tray's left-click opens the popover — the requirement's single-click-popover decision.
    expect(main).toMatch(/tray\.on\(\s*'click'\s*,\s*\(\)\s*=>\s*togglePopover\(\)\s*\)/);
  });

  it('togglePopover shows the popover BrowserWindow (the popover is the action surface)', () => {
    // togglePopover toggles the popover window's visibility — the surface every tray action
    // now lives on (Stop/Switch/Start + Open Stint), since the dropdown is removed.
    const start = main.indexOf('function togglePopover(');
    expect(start, 'togglePopover must exist').toBeGreaterThanOrEqual(0);
    const body = main.slice(start, main.indexOf('\n}\n', start));
    expect(body).toMatch(/popover\.show\(\)/);
    expect(body).toMatch(/popover\.hide\(\)/);
  });

  it('the tray context menu builds ONLY a Quit item — no timer actions, no Open Stint', () => {
    const body = buildTrayMenuBody();
    // The minimal OS-convention menu is Quit-only…
    expect(body).toMatch(/role:\s*'quit'|label:\s*'Quit'/);
    // …and it builds NONE of the removed dropdown actions: the old Start/Stop + Open Stint
    // entries are gone (those live in the popover now). A regression that re-adds any of them
    // to the tray dropdown fails here.
    expect(body).not.toMatch(/Open Stint/);
    expect(body).not.toMatch(/Start \/ resume/);
    expect(body).not.toMatch(/Stop \(/);
    // The tray menu builds no click-through to a timer transition either.
    expect(body).not.toMatch(/toggleTimer\(\)/);
    expect(body).not.toMatch(/showMainWindow\(\)/);
  });
});
