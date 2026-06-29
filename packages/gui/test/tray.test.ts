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
const popHtml = readFileSync(fileURLToPath(new URL('../renderer/popover.html', import.meta.url)), 'utf8');
const popJs = readFileSync(fileURLToPath(new URL('../renderer/popover.js', import.meta.url)), 'utf8');

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

/**
 * The restyled popover surface (Calm · Warm Paper, context/mockups/tray-popover.html). A
 * static-guard over the renderer source the headless tray cannot drive: the chromeless compact
 * surface keeps the four-action shape (Stop / Switch / Start + Open Stint) on its new markup,
 * paired with line icons from the one sprite and a worded + dotted run state — no emoji.
 */
describe('tray popover surface (§12 R01)', () => {
  it('keeps the harness ids the tray-action surface is asserted through', () => {
    // The compact surface still exposes the count, the running-state line, the Start/Stop toggle,
    // the mid-timer Switch, and Open Stint — the four-action shape, on the restyled markup.
    expect(popHtml).toMatch(/id="count"/);
    expect(popHtml).toMatch(/id="state"/);
    expect(popHtml).toMatch(/id="ctx"/);
    // The toggle is the single primary action; the restyle gives it `btn primary` (the .btn
    // chrome + the rationed accent fill), so we assert the primary marker without pinning class order.
    expect(popHtml).toMatch(/id="toggle"[^>]*class="[^"]*\bprimary\b|class="[^"]*\bprimary\b[^"]*"[^>]*id="toggle"/);
    expect(popHtml).toMatch(/id="switch"[^>]*hidden/);
    expect(popHtml).toMatch(/id="open"/);
  });

  it('shows the running entry description, context, and tags under the clock', () => {
    // The restyled top block carries a strong description label, a muted client/project context
    // line, and the entry's tag chips — all painted from the existing getState snapshot.
    expect(popHtml).toMatch(/class="pop-desc"/);
    expect(popHtml).toMatch(/class="pop-tags"/);
    expect(popJs).toMatch(/running\.tags/);
  });

  it('wraps the count in tabular numerals (digits never jitter)', () => {
    expect(popHtml).toMatch(/id="count"[^>]*class="[^"]*\btnum\b/);
    // The clock carries the restyled `pop-clock` structural class (the 38px tabular display).
    expect(popHtml).toMatch(/id="count"[^>]*class="[^"]*\bpop-clock\b/);
  });

  it('lays out the surface as a top block, an action row, and a foot — one elevation rung', () => {
    expect(popHtml).toMatch(/class="pop-top"/);
    expect(popHtml).toMatch(/class="pop-act"/);
    expect(popHtml).toMatch(/class="pop-foot"/);
  });

  it('pairs the running state with a dot AND a word (colour is never the only signal)', () => {
    expect(popHtml).toMatch(/class="pop-dot"/);
    expect(popJs).toMatch(/Running/);
  });

  it('draws its action affordances with line icons from the one sprite — never emoji', () => {
    // Stop/Switch/Start carry sprite icons; the sprite is injected so the <use> refs resolve.
    expect(popJs).toMatch(/injectSprite\(/);
    expect(popJs).toMatch(/icon\('stop'\)/);
    expect(popJs).toMatch(/icon\('swap'\)/);
    expect(popJs).toMatch(/icon\('play'\)/);
    // No emoji glyphs anywhere in the restyled renderer.
    expect(popHtml).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(popJs).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
