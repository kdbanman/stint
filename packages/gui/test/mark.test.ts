/**
 * GOLD — the mark ships, and the tray states differ (design.html §09 D18–D21; PRD §12 R01, §19 R01/R02).
 *
 * The mark is generated on demand (`npm run icons`) rather than on the build path, because
 * rasterizing needs Chromium. That is the right trade — but it means a source can change, or a
 * new one appear, with no render ever committed, and nothing downstream would notice until a
 * user saw a blank tray. This is the cheap check that closes that gap: every output the
 * generator declares must exist on disk, and every place the app or its installers reach for
 * one must actually be wired.
 *
 * What it deliberately does NOT do is compare bytes. PNG output is not reproducible across
 * Chromium versions (process.html R08 — the same reason JUDGE screenshots are uploaded, not
 * diffed); a byte gate here would be a standing false red.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS apparatus module, no type declarations on purpose.
import { TARGETS as GENERATED } from '../../../scripts/gen-icons.mjs';

/** The generator's target shape, mirrored here because the .mjs carries no declarations. */
interface Target {
  src: string;
  palette: string;
  size: number;
  out: string;
}
const TARGETS = GENERATED as Target[];

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const main = read('../src/main.ts');
const builderYml = read('../electron-builder.yml');
const installSh = read('../../../packaging/linux/install.sh');
const uninstallSh = read('../../../packaging/linux/uninstall.sh');

describe('GOLD — every declared mark render is committed (design.html D19)', () => {
  it.each(TARGETS.map((t): [string, string] => [t.out.split('/stint/')[1] ?? t.out, t.out]))(
    'renders %s',
    (_label, out) => {
      expect(existsSync(out), `missing render — run \`npm run icons\``).toBe(true);
      // A zero-byte or truncated PNG would pass an existence check and fail in the wild.
      expect(statSync(out).size).toBeGreaterThan(100);
      expect(readFileSync(out).subarray(1, 4).toString()).toBe('PNG');
    },
  );

  it('renders both tray states for both platform palettes', () => {
    // The pair is the whole point of #162 — a regression that drops one state (or one
    // platform's copy of it) leaves that surface unable to show the timer is running.
    const outs = TARGETS.map((t) => t.out);
    for (const name of [
      'trayIdleTemplate.png',
      'trayIdleTemplate@2x.png',
      'trayRunningTemplate.png',
      'trayRunningTemplate@2x.png',
      'tray-idle-panel.png',
      'tray-running-panel.png',
    ]) {
      expect(outs.some((o) => o.endsWith(name)), `no target renders ${name}`).toBe(true);
    }
  });
});

describe('GOLD — the mockups render the real mark (design.html D19)', () => {
  // Two mockups carry a generated block now: the component sheet (the mark's own documentation)
  // and the tray popover, whose menu-bar extra used to be an invented tomato pill the tray
  // cannot produce — the invention that let #162 go unnoticed (issue #157).
  const marked: ReadonlyArray<readonly [file: string, renders: number]> = [
    ['design-system.html', 3],
    ['tray-popover.html', 1],
  ];

  it.each(marked.map(([f]) => f))('%s keeps the STINT-MARK markers the generator writes between', (f) => {
    // Same contract as the STINT-TOKENS block: the markers ARE the seam. A mockup without
    // them is an error the generator refuses to guess its way past, so losing them here
    // would silently stop that mockup from ever updating again.
    const html = read(`../../../context/mockups/${f}`);
    expect(html).toMatch(/STINT-MARK start/);
    expect(html).toMatch(/STINT-MARK end/);
  });

  it.each(marked.map(([f, n]): [string, number] => [f, n]))(
    '%s embeds the mark itself, not a hand-drawn stand-in',
    (f, renders) => {
      const html = read(`../../../context/mockups/${f}`);
      const block = html.slice(html.indexOf('STINT-MARK start'), html.indexOf('STINT-MARK end'));
      // The sheet carries three renders — the app icon plus both tray states; the popover
      // carries the one the menu bar actually shows. Either way the mockup cannot illustrate
      // a mark the OS does not draw.
      expect(block.match(/data:image\/png;base64,/g) ?? []).toHaveLength(renders);
    },
  );

  it('the popover shows the TEMPLATE glyph — the monochrome one macOS draws (D19/D20)', () => {
    // The alpha-only render, not the panel one: a menu-bar extra is a template image whose
    // colour macOS discards. Embedding the panel (tomato) render here would put a colour in
    // the menu bar that no user can ever see, which is the shape of the original defect.
    const popover = read('../../../context/mockups/tray-popover.html');
    const template = readFileSync(
      fileURLToPath(new URL('../assets/trayRunningTemplate@2x.png', import.meta.url)),
    ).toString('base64');
    expect(popover).toContain(template);
  });
});

describe('GOLD — the tray glyph carries the running state on every platform (§12 R01)', () => {
  it('picks the glyph by state, not by platform alone', () => {
    // trayImage takes the state — the signature #162 found missing (the old trayIcon() took
    // no argument, so running and idle were byte-identical).
    expect(main).toMatch(/function trayImage\(running: boolean\)/);
  });

  it('repaints the glyph on every state change', () => {
    // setImage was never called anywhere in the repo before this; without it the glyph is
    // frozen at whatever `new Tray(...)` was seeded with.
    expect(main).toMatch(/tray\.setImage\(trayImage\(!!open\)\)/);
  });

  it('guards the macOS-only count-up title so it can never become the signal again', () => {
    // setTitle is a no-op off macOS. Every call site must sit behind the platform check, or
    // Linux silently loses its running state again (#162).
    const titleCalls = main.match(/^.*tray\.setTitle\(.*$/gm) ?? [];
    expect(titleCalls.length).toBeGreaterThan(0);
    for (const call of titleCalls) {
      expect(call, `unguarded setTitle: ${call.trim()}`).toMatch(
        /process\.platform === 'darwin'/,
      );
    }
  });
});

/**
 * The trap this repo is most likely to fall into twice: `buildResources: build` feeds the
 * PACKAGER and ships nothing into the app. Runtime assets must be in the `files:` glob, or
 * the packed app launches with a blank tray while every dev machine looks fine.
 */
describe('GOLD — runtime mark assets are bundled, not just built (§19 R01)', () => {
  it('electron-builder declares the packager icon source', () => {
    expect(builderYml).toMatch(/^icon:\s*build\/icon\.png\s*$/m);
  });

  it('the files glob bundles the runtime assets tree', () => {
    expect(builderYml).toMatch(/^\s+-\s+assets\/\*\*\s*$/m);
  });

  it('main.ts loads runtime assets from that bundled tree', () => {
    expect(main).toMatch(/const ASSETS = join\(__dirname, '\.\.', 'assets'\)/);
  });
});

describe('GOLD — the Linux launcher entry resolves its icon (§19 R02)', () => {
  it('install.sh copies the icon ladder into the hicolor theme', () => {
    // `Icon=stint` is a theme name, not a path: without these copies the launcher shows a
    // placeholder regardless of what the AppImage contains.
    expect(installSh).toMatch(/Icon=stint/);
    expect(installSh).toMatch(/ICON_BASE=/);
    expect(installSh).toMatch(/\$\{ICON_BASE\}\/\$\{size\}x\$\{size\}\/apps\/stint\.png/);
  });

  it('uninstall.sh removes what install.sh placed in the theme', () => {
    expect(uninstallSh).toMatch(/apps\/stint\.png/);
  });

  it('the committed ladder covers the sizes install.sh globs for', () => {
    const ladder = TARGETS.filter((t) => t.out.includes('/packaging/linux/icons/'));
    expect(ladder.length).toBeGreaterThanOrEqual(6);
    for (const t of ladder) expect(t.out).toMatch(/stint-\d+\.png$/);
  });
});
