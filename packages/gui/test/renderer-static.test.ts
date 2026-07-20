/**
 * Static guards for the renderer — ONLY the contracts that static inspection alone can
 * prove (issue #85). Everything behavioral — what the rendered page does when driven —
 * lives in the JUDGE harness (packages/gui/judge/run-judge.mjs), whose scenes are bound
 * one-to-one to acceptance/criteria/judge-rubric.md rows by judge-bind.test.ts.
 *
 * The line: a guard belongs here only if the defect it catches is invisible to a driven
 * page. Banned APIs that headless Chromium happily implements but packaged Electron does
 * not (window.prompt/confirm), banned glyph classes, module-isolation rules, and
 * structural invariants (duplicate ids) qualify. Assertions about renderer BEHAVIOR do
 * not — a source regex breaks on a rename and passes on a bug, so those were retired to
 * the judge's scenes (issue #85), not maintained here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../renderer/${rel}`, import.meta.url)), 'utf8');

describe('renderer static contract', () => {
  it('the nav rail labels each item with a line-icon from the one sprite — never an emoji (design-system)', () => {
    const html = read('index.html');
    // Each nav item carries the line-icon convention: an <svg class="ic"> pulling a #i-… symbol
    // from the single sprite, paired with its .nav-label. The five items map to the five view
    // icons (clock / list / users / chart / settings) in the Timer→Settings order.
    const navIcons = [...html.matchAll(/class="nav-item[^"]*"\s+data-view="[^"]+"[^>]*>\s*<svg class="ic"[^>]*><use href="(#i-[^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(navIcons).toEqual(['#i-clock', '#i-list', '#i-users', '#i-chart', '#i-settings']);
    // …and the shell carries NO emoji glyph anywhere (the restyle replaces every emoji/symbol
    // pictograph with the line-icon sprite). Scan the whole document for any pictographic glyph
    // (the prior nav used ◷ ▤ ◎ ▥ ⚙, the pickers ▦, the chevrons ▲▼) — none may remain. The
    // ranges cover Miscellaneous Technical, Geometric Shapes, Misc Symbols/Dingbats, the
    // supplemental arrows/shapes, and emoji — but spare the em-dash, ellipsis and § still in use.
    expect(html).not.toMatch(
      /[⌀-⏿■-◿☀-➿⬀-⯿←-⇿\u{1F000}-\u{1FAFF}]/u,
    );
  });

  it('every element id in index.html is unique — a duplicate dead-ends getElementById wiring (issue #48)', () => {
    // The literal issue-48 root cause: the Clients-view "+ Add client" button and the
    // Add-entry form's Client <select> both carried id="add-client", so $('add-client')
    // (getElementById → FIRST match in document order) bound the click handler to the
    // select — the button was a no-op AND opening the dropdown injected a phantom
    // .client-add row. Guard the invariant wholesale: no id may appear twice in the page.
    // (The driven half — the button actually creating a client — is the CLIENTS_VIEW
    // judge scene, which exists because presence-only checks passed right through #48.)
    const html = read('index.html');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    expect(dupes, `duplicate element ids in index.html: ${dupes.join(', ')}`).toEqual([]);
  });

  it('the renderer never imports Node or touches the DB directly (parity via IPC)', () => {
    // The CLASSIC scripts can reach neither Node nor core. The bundled SU entry (su.ts) is
    // the one sanctioned core importer — its output staying node-free is asserted
    // behaviorally by renderer-bundle.test.ts, not text-pinned here (issue #83).
    for (const f of ['app.js', 'timepicker.js', 'popover.js', 'reports.js', 'settings.js']) {
      const src = read(f);
      expect(src).not.toMatch(/require\(['"]node:/);
      expect(src).not.toMatch(/@stint\/core/);
    }
    // The interval picker is a pure presentation component: it writes localInputValue strings
    // back into its bound inputs and NEVER reaches the IPC bridge itself (no new channel can
    // sneak in through it — the add/edit forms own every commit).
    expect(read('timepicker.js')).not.toMatch(/window\.stint\./);
  });

  it('the renderer opens no outbound connection (§17 R9)', () => {
    // The renderer is shipped UI code that could reach the network straight from the
    // page; assert it uses none of the browser request APIs. (The no-network backstop
    // now also walks this directory; this keeps the guard close to the renderer.)
    const forbidden = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/];
    for (const f of ['app.js', 'timepicker.js', 'popover.js', 'su.ts', 'reports.js', 'settings.js']) {
      const src = read(f);
      for (const re of forbidden) expect(src, `${f} must not use ${re}`).not.toMatch(re);
    }
  });

  it('the renderer never calls window.prompt or window.confirm — Electron implements neither (issue #52)', () => {
    // Electron's renderer does not implement window.prompt — it returns null and logs
    // "prompt() is and will not be supported." — and window.confirm is unavailable/blocking
    // here (the constraint app.js's confirmInline note records), so either call silently
    // no-ops in the packaged app. Every name/confirm affordance must be an INLINE control
    // (inlineRenameForm, confirmInline, the add-client/tag fields). The JUDGE's headless
    // Chromium DOES implement both built-ins, so a driven page cannot catch this — it is
    // exactly the class of defect only static inspection sees. Walk EVERY file under
    // renderer/ so no call site — present or future — can reintroduce the pattern.
    const dir = fileURLToPath(new URL('../renderer/', import.meta.url));
    const files = readdirSync(dir).filter((f) => /\.(js|html)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = read(f);
      expect(src, `${f} must not call window.prompt`).not.toMatch(/window\s*\.\s*prompt\s*\(/);
      expect(src, `${f} must not call window.confirm`).not.toMatch(/window\s*\.\s*confirm\s*\(/);
      // The bare globals reach the same unsupported built-ins (confirmInline etc. don't match:
      // the pattern requires the exact name immediately followed by an open paren).
      expect(src, `${f} must not call the bare prompt()`).not.toMatch(/(?<![.\w$])prompt\(/);
      expect(src, `${f} must not call the bare confirm()`).not.toMatch(/(?<![.\w$])confirm\(/);
    }
  });
});
