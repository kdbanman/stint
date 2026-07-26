/**
 * scripts/gen-icons.mjs — the icon generator (design.html §07 D17–D20).
 *
 * Reads the three hand-authored sources in context/mark/ plus the palettes in
 * context/design.tokens.json, and rasterizes every PNG the app and its installers need.
 * The sources carry CSS CLASSES and no fill attributes; this script injects the palette,
 * so a mark colour cannot drift from the tokens the rest of the system uses (D18) — the
 * same "generated, never copied" contract scripts/gen-tokens.mjs holds for the CSS block.
 *
 * NOT wired into `npm run build`, deliberately. Rasterizing needs Chromium, which the
 * judge job installs but a plain `npm ci` does not — putting it on the build path would
 * red every machine without a browser. The outputs are COMMITTED instead, exactly like
 * the generated token blocks and the evidence GIFs, and this runs on demand (`npm run
 * icons`) when a source or a palette token changes. test/mark.test.ts guards the tree
 * against a source that never got rendered.
 *
 * Byte-drift is deliberately NOT gated in CI: PNG output is not reproducible across
 * Chromium versions (process.html R08 — the same reason the JUDGE screenshots are
 * uploaded rather than diffed).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { chromium } from 'playwright-core';
import { resolveChromium } from './resolve-chromium.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MARK = join(ROOT, 'context', 'mark');
const GUI = join(ROOT, 'packages', 'gui');

/** Resolve a DTCG token path (`color.tomato.11`) to its literal value. */
function token(path) {
  const tree = JSON.parse(readFileSync(join(ROOT, 'context', 'design.tokens.json'), 'utf8'));
  const node = path.split('.').reduce((acc, key) => acc?.[key], tree);
  const value = node?.$value;
  if (typeof value !== 'string') throw new Error(`unknown token: ${path}`);
  return value;
}

/**
 * The three palettes, as design.html D18 fixes them. Each maps the sources' class names to
 * a fill and an opacity.
 *
 * `app` paints on paper, so the second bar is the pale tomato tint the reference mark uses.
 * `panel` paints on an unknown Linux panel — light or dark, never paper — so it drops the
 * tint for the brighter accent step at reduced alpha, which survives both backgrounds; the
 * tint would vanish on a light panel. `template` is alpha-only black: macOS discards the
 * colour of a template image and recolours it per menu-bar appearance, so the intensity
 * ramp IS the whole design there.
 */
const PALETTES = {
  app: {
    field: { fill: token('color.sand.1'), opacity: 1 },
    'bar-strong': { fill: token('color.tomato.11'), opacity: 1 },
    'bar-weak': { fill: token('color.tomato.5'), opacity: 1 },
  },
  panel: {
    'bar-strong': { fill: token('color.tomato.9'), opacity: 1 },
    'bar-weak': { fill: token('color.tomato.9'), opacity: 0.38 },
  },
  template: {
    'bar-strong': { fill: '#000000', opacity: 1 },
    'bar-weak': { fill: '#000000', opacity: 0.38 },
  },
};

/**
 * Every rendered output: source × palette × size → path. The guard test imports this and
 * asserts each entry exists on disk, so a source added without a render fails the build.
 *
 * The macOS tray files are named `…Template.png` because Electron keys template-image
 * treatment off that suffix, and ship an `@2x` sibling because createFromPath resolves
 * HiDPI variants by filename. The Linux tray ships one oversized 48px pixmap per state:
 * StatusNotifier hosts request whatever size their panel is and scale, and rectangles
 * downscale cleanly.
 */
export const TARGETS = [
  // The app icon. electron-builder derives the .icns and every packaged Linux size from
  // this one file, so 1024 is all the app bundle needs.
  { src: 'mark.svg', palette: 'app', size: 1024, out: join(GUI, 'build', 'icon.png') },

  // Runtime assets — these ship INSIDE the app bundle (see electron-builder.yml `files:`).
  { src: 'mark.svg', palette: 'app', size: 256, out: join(GUI, 'assets', 'icon-256.png') },
  { src: 'mark.svg', palette: 'app', size: 128, out: join(GUI, 'assets', 'icon-128.png') },
  { src: 'glyph-idle.svg', palette: 'template', size: 16, out: join(GUI, 'assets', 'trayIdleTemplate.png') },
  { src: 'glyph-idle.svg', palette: 'template', size: 32, out: join(GUI, 'assets', 'trayIdleTemplate@2x.png') },
  { src: 'glyph-running.svg', palette: 'template', size: 16, out: join(GUI, 'assets', 'trayRunningTemplate.png') },
  { src: 'glyph-running.svg', palette: 'template', size: 32, out: join(GUI, 'assets', 'trayRunningTemplate@2x.png') },
  { src: 'glyph-idle.svg', palette: 'panel', size: 48, out: join(GUI, 'assets', 'tray-idle-panel.png') },
  { src: 'glyph-running.svg', palette: 'panel', size: 48, out: join(GUI, 'assets', 'tray-running-panel.png') },

  // The freedesktop hicolor ladder the .desktop file's `Icon=stint` resolves against.
  // packaging/linux/install.sh copies these into the icon theme; uninstall.sh removes them.
  ...[16, 24, 32, 48, 64, 128, 256, 512].map((size) => ({
    src: 'mark.svg',
    palette: 'app',
    size,
    out: join(ROOT, 'packaging', 'linux', 'icons', `stint-${size}.png`),
  })),
];

/** The source SVG with a generated <style> block prepended — classes resolved to fills. */
function paint(src, palette) {
  const svg = readFileSync(join(MARK, src), 'utf8');
  const rules = Object.entries(PALETTES[palette])
    .map(([cls, { fill, opacity }]) => `.${cls}{fill:${fill};fill-opacity:${opacity}}`)
    .join('');
  return svg.replace(/(<svg\b[^>]*>)/, `$1<style>${rules}</style>`);
}

export const MARK_START =
  '<!-- STINT-MARK start — generated from context/mark/ by scripts/gen-icons.mjs; do not edit by hand -->';
export const MARK_END = '<!-- STINT-MARK end -->';

/**
 * Re-embed a rendered mark into a mockup, between its STINT-MARK markers — the same contract
 * gen-tokens.mjs holds for the CSS token block, and for the same reason: a mockup that
 * illustrates the mark by hand drifts from it silently.
 *
 * Data URIs because a mockup is standalone and dependency-free (CLAUDE.md), and because the
 * embedded bytes ARE the shipped render, so the mockup cannot disagree with what the OS shows.
 * A file WITHOUT the markers is an error, not a seeding opportunity — where the block sits is
 * a reviewed decision the generator does not guess.
 */
function embedMark(mockup, block) {
  const target = join(ROOT, 'context', 'mockups', mockup);
  const html = readFileSync(target, 'utf8');
  const start = html.indexOf(MARK_START);
  const end = html.indexOf(MARK_END);
  if (start === -1 || end === -1) throw new Error(`STINT-MARK markers missing in ${target}`);
  writeFileSync(target, `${html.slice(0, start)}${MARK_START}\n    ${block}\n    ${html.slice(end)}`);
  console.log(`embedded the mark → /context/mockups/${mockup}`);
}

function embedAll(renders) {
  const uri = (name) => `data:image/png;base64,${renders.get(name).toString('base64')}`;
  embedMark(
    'design-system.html',
    [
      '<div class="icons">',
      `<div class="i"><img src="${uri('icon-128.png')}" width="72" height="72" alt="The Stint app mark"><span>app icon</span></div>`,
      `<div class="i"><img src="${uri('tray-idle-panel.png')}" width="24" height="24" alt="The idle tray glyph"><span>tray · idle</span></div>`,
      `<div class="i"><img src="${uri('tray-running-panel.png')}" width="24" height="24" alt="The running tray glyph"><span>tray · running</span></div>`,
      '</div>',
    ].join('\n    '),
  );
  // The menu-bar extra the popover hangs from. It carries the TEMPLATE render — the alpha-only
  // black macOS actually draws (D19) — at the 16pt the menu bar gives it, from the @2x file so
  // the mockup is crisp on a HiDPI screen. Embedding the real bytes is the whole point: the
  // mockup used to draw an invented tomato pill reading `1:24:07`, an appearance the tray cannot
  // produce, and that invention is what let issue #162 go unnoticed (issue #157).
  embedMark(
    'tray-popover.html',
    `<img class="glyph" src="${uri('trayRunningTemplate@2x.png')}" width="16" height="16" alt="The running tray glyph">`,
  );
}

async function main() {
  const browser = await chromium.launch({ executablePath: resolveChromium() });
  const page = await browser.newPage();
  const renders = new Map();
  for (const { src, palette, size, out } of TARGETS) {
    await page.setViewportSize({ width: size, height: size });
    // The SVG is sized to fill the viewport exactly, so the screenshot IS the icon —
    // omitBackground keeps the field's corners (and every tray glyph) transparent.
    await page.setContent(
      `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${paint(src, palette)}`,
    );
    const png = await page.screenshot({ omitBackground: true });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, png);
    renders.set(out.split('/').pop(), png);
    console.log(`${src} · ${palette} · ${size}px → ${out.slice(ROOT.length)}`);
  }
  await browser.close();
  embedAll(renders);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
