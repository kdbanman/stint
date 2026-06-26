/**
 * Fast static guards for the renderer contract (PRD §12, §15). The full visual
 * judgement is the JUDGE harness (packages/gui/judge); these cheap checks catch a
 * regression in the empty-state copy or accent discipline on every commit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../renderer/${rel}`, import.meta.url)), 'utf8');

describe('renderer static contract', () => {
  it('the empty state instructs a concrete next action (§12 R5)', () => {
    const app = read('app.js');
    expect(app).toMatch(/No entries yet/);
    expect(app).toMatch(/tt start/);
    expect(app).toMatch(/friendlyHotkey/); // shows the actual configured hotkey
  });

  it('accent is applied only via the --accent variable (§15)', () => {
    const css = read('styles.css');
    // The primary action and running state use the accent variable…
    expect(css).toMatch(/button\.primary\s*\{[^}]*var\(--accent\)/s);
    // …and no rule hardcodes the seed accent hex outside the :root variable.
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/#2f6fed/);
  });

  it('the renderer never imports Node or touches the DB directly (parity via IPC)', () => {
    for (const f of ['app.js', 'popover.js', 'util.js']) {
      const src = read(f);
      expect(src).not.toMatch(/require\(['"]node:/);
      expect(src).not.toMatch(/@stint\/core/);
    }
  });
});
