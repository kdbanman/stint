/**
 * GOLD — the design-layer guard (design.html D01/D02, D04, D06/D07, D13, A01/A02, A06;
 * transition PR #132).
 *
 * The computed checks the JUDGE's rendered comparison cannot honestly make (design.html §08):
 *
 *   1. D02 token parity — every mockup and styles.css carries EXACTLY the block the generator
 *      emits from context/design.tokens.json between its STINT-TOKENS markers. The block comes
 *      from the emitter itself (scripts/gen-tokens.mjs), not a regex over the generator source,
 *      so a generator refactor cannot fool the guard and a hand-edit inside the markers cannot
 *      survive it.
 *   2. D01 no-raw-palette-hex — a palette value written as a hex literal outside the markers is
 *      a copy that will silently rot when the tokens change. styles.css is additionally held to
 *      a full no-hex rule (semantic tokens only). The hex scan is deliberately blind to rgb()/
 *      hsl() re-encodings of a palette value — a copyist writes what the tokens file shows
 *      (hex); chasing colour-space conversions would buy noise, not protection.
 *   3. A01/A02 contrast floors — recomputed with the WCAG 2.2 relative-luminance formula from
 *      the tokens file (never trusted from a table), over the permitted token pairs design.html
 *      §03 names, plus the prohibited pairs that must stay unusable.
 *   4. D04/D16 faint-is-never-text — `color: var(--faint)` survives only on the sanctioned
 *      disabled-state selectors; everything readable reads `muted` (G10).
 *   5. D07 spacing grid, D06 readable-text floor, D13 placeholder colour — declaration-scoped
 *      static scans over styles.css and every mockup's <style> blocks: every padding/margin/gap
 *      px value sits on the 4px grid (2px as the half-step), no font-size declares below 11px,
 *      and styles.css carries the one ::placeholder rule colouring var(--muted).
 *
 * Deliberately out of scope: D08 radii — their AC is JUDGE, and the two recorded off-trio radii
 * (the progress track, the calendar checkbox) are a pending design.html exemption question, not
 * scan targets.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
// @ts-expect-error — plain-JS apparatus module, no type declarations on purpose.
import { emitTokenBlock } from '../../../scripts/gen-tokens.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tokens = JSON.parse(readFileSync(join(repoRoot, 'context/design.tokens.json'), 'utf8'));
const generatedBlock: string = emitTokenBlock(tokens);

const mockupNames = readdirSync(join(repoRoot, 'context/mockups'))
  .filter((f) => f.endsWith('.html'))
  .sort();
const stylesCss = readFileSync(join(repoRoot, 'packages/gui/renderer/styles.css'), 'utf8');

/** Split a target file into its marker-delimited block and everything outside it. */
const splitOnMarkers = (text: string): { block: string; outside: string } | null => {
  const start = text.indexOf('/* STINT-TOKENS start');
  const endMarker = '/* STINT-TOKENS end */';
  const end = text.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) return null;
  return {
    block: text.slice(start, end + endMarker.length),
    outside: text.slice(0, start) + text.slice(end + endMarker.length),
  };
};

/* Matches CSS hex colours while skipping id selectors whose names happen to spell hex
   (#add-desc): a colour literal is never followed by another word character or a hyphen. */
const HEX_RE = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z-])/g;

/** Normalize a hex literal to 6-digit lowercase rgb (shorthand expanded, alpha dropped). */
const normalizeHex = (hex: string): string => {
  const h = hex.slice(1).toLowerCase();
  const rgb = h.length <= 4 ? [...h.slice(0, 3)].map((c) => c + c).join('') : h.slice(0, 6);
  return `#${rgb}`;
};

// every primitive scale step is a forbidden literal — semantic tokens alias them, surfaces
// reference the semantic name
const paletteHexes = new Set<string>();
for (const scale of Object.values<Record<string, { $value: string }>>(tokens.color)) {
  for (const [step, def] of Object.entries(scale)) {
    if (!step.startsWith('$')) paletteHexes.add(def.$value.toLowerCase());
  }
}

// ---- WCAG 2.2 relative luminance, computed independently of any documented ratio ----
const luminance = (hex: string): number => {
  const channel = (i: number): number => {
    const s = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
};
const contrast = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
/** Resolve a semantic token name (or the literal `white`) to its hex value. */
const semantic = (name: string): string => {
  if (name === 'white') return '#ffffff';
  const ref = /^\{color\.([a-z]+)\.(\d+)\}$/.exec(tokens.semantic[name].$value);
  if (!ref) throw new Error(`semantic token ${name} is not a scale alias`);
  // both groups are non-optional in the pattern, so a match guarantees them
  return tokens.color[ref[1]!][ref[2]!].$value.toLowerCase();
};

describe('design token parity (design.html D02)', () => {
  it('the emitter produces a non-trivial block over all eleven mockups (guard-the-guard)', () => {
    // ≥20 custom-property declarations and the full mockup census — an emitter refactor that
    // silently dropped a token family, or a mockup landing without markers, trips here.
    const declarations = generatedBlock.match(/--[a-z0-9-]+:/g) ?? [];
    expect(declarations.length).toBeGreaterThanOrEqual(20);
    expect(mockupNames.length).toBe(11);
  });

  it('every mockup and styles.css carries exactly the generated block between its markers', () => {
    const targets: Array<[string, string]> = [
      ...mockupNames.map((f): [string, string] => [
        `context/mockups/${f}`,
        readFileSync(join(repoRoot, 'context/mockups', f), 'utf8'),
      ]),
      ['packages/gui/renderer/styles.css', stylesCss],
    ];
    for (const [name, text] of targets) {
      const parts = splitOnMarkers(text);
      expect(parts, `${name}: STINT-TOKENS markers missing`).not.toBeNull();
      expect(parts?.block, `${name}: token block drifted from design.tokens.json`).toBe(
        generatedBlock,
      );
    }
  });
});

describe('no raw palette hex outside the generated block (design.html D01)', () => {
  it('no surface writes a primitive scale value as a literal', () => {
    for (const f of mockupNames) {
      const text = readFileSync(join(repoRoot, 'context/mockups', f), 'utf8');
      // design-system.html's BODY is the palette's own documentation — its swatch chart names
      // every value beside its token, so only its <style> half (the part that could USE a value
      // instead of naming it) is scanned. Every other mockup is scanned whole.
      const scanned =
        f === 'design-system.html' ? text.slice(0, text.indexOf('</style>')) : text;
      const parts = splitOnMarkers(scanned);
      expect(parts, `context/mockups/${f}: STINT-TOKENS markers missing`).not.toBeNull();
      const hits = (parts?.outside.match(HEX_RE) ?? [])
        .map(normalizeHex)
        .filter((h) => paletteHexes.has(h));
      expect(hits, `context/mockups/${f}: raw palette hex outside the token block`).toEqual([]);
    }
  });

  it('styles.css uses semantic tokens only — no hex literal at all outside the markers', () => {
    const parts = splitOnMarkers(stylesCss);
    expect(parts).not.toBeNull();
    const hexes = parts?.outside.match(HEX_RE) ?? [];
    // No exceptions — every colour in the app resolves through a semantic token.
    expect(hexes).toEqual([]);
  });

  it('the app carries no reference to a retired custom property', () => {
    // --ink-soft folded into ink/muted (V8), --warn-line renamed --flag-line, --mono replaced
    // by the generated --num stack. A survivor would silently resolve to nothing at runtime.
    expect(stylesCss.match(/--(?:ink-soft|warn-line|mono)\b/g)).toBeNull();
  });
});

describe('contrast floors, recomputed from design.tokens.json (design.html A01/A02)', () => {
  const TEXT_FLOOR = 4.5;
  const NON_TEXT_FLOOR = 3;
  // the permitted pairs design.html §03 names, each with the floor its role demands
  const permitted: Array<[fg: string, bg: string, floor: number]> = [
    ['ink', 'paper', TEXT_FLOOR],
    ['muted', 'paper', TEXT_FLOOR],
    ['muted', 'hover', TEXT_FLOOR],
    ['muted', 'wash', TEXT_FLOOR],
    ['accent-ink', 'paper', TEXT_FLOOR],
    ['accent-ink', 'sidebar', TEXT_FLOOR],
    ['white', 'accent-solid', TEXT_FLOOR],
    ['run', 'paper', TEXT_FLOOR],
    ['run', 'run-weak', TEXT_FLOOR],
    ['danger', 'paper', TEXT_FLOOR],
    ['danger', 'danger-weak', TEXT_FLOOR],
    ['flag', 'paper', TEXT_FLOOR],
    ['flag', 'flag-bg', TEXT_FLOOR],
    // Non-text signal: icons, running marks, focus. A02's 3:1 floor is carried by the
    // FULL-STRENGTH accent — the D13 focus BORDER (and icon ink) — which is the pair computed
    // here; the focus HALO (--ring) paints only a 35% mix and is a redundant echo around that
    // passing border, not the focus indicator of record.
    ['accent', 'paper', NON_TEXT_FLOOR],
  ];
  // pairs the spec prohibits BECAUSE they fail the text floor; if a token change ever lifted
  // one above 4.5 the prohibition (and this table) would need a deliberate revisit
  const prohibited: Array<[fg: string, bg: string]> = [
    ['faint', 'paper'], // faint is decorative/disabled only — never readable text
    ['accent-ink', 'accent-weak'], // why selection is a raised chip, not an accent wash (D12)
    ['white', 'accent'], // why accent-solid exists (D11) — tomato·9 cannot carry a label
  ];

  it('every permitted token pair meets its floor', () => {
    for (const [fg, bg, floor] of permitted) {
      expect(
        contrast(semantic(fg), semantic(bg)),
        `${fg} on ${bg} below its ${floor}:1 floor`,
      ).toBeGreaterThanOrEqual(floor);
    }
  });

  it('every prohibited pair stays below the text floor (the prohibitions stay earned)', () => {
    for (const [fg, bg] of prohibited) {
      expect(
        contrast(semantic(fg), semantic(bg)),
        `${fg} on ${bg} now passes 4.5:1 — revisit the design.html prohibition`,
      ).toBeLessThan(TEXT_FLOOR);
    }
  });
});

describe('faint is never readable text (design.html D04/D16)', () => {
  // The one sanctioned faint-as-text use: a disabled control (the WCAG A01 exemption
  // design.html §07 records). Anything else must read `muted` — faint on paper is 3.3:1.
  const allowed = ['.report-field:disabled'];

  it('styles.css paints color: var(--faint) only on the sanctioned disabled selectors', () => {
    // Comments can quote CSS (the doctrine header does), so strip them before parsing rules.
    const css = stylesCss.replace(/\/\*[^]*?\*\//g, '');
    const offenders: string[] = [];
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // groups 1 and 2 are non-optional in the pattern, so a match guarantees them
      if (!/color:\s*var\(--faint\)/.test(rule[2]!)) continue;
      const selector = rule[1]!.trim().replace(/\s+/g, ' ');
      if (!allowed.includes(selector)) offenders.push(selector);
    }
    expect(offenders, 'faint used as text colour outside the disabled allowlist').toEqual([]);
  });
});

// ---- D07/D06/D13 declaration-scoped scans ------------------------------------------------
// A surface's scannable CSS is its <style> blocks (mockups) or the whole file (styles.css),
// with comments stripped first so quoted CSS in prose (a 1.6px stroke width, an example
// declaration) never reaches the parser.
const surfaceCss = (): Array<[name: string, css: string]> => [
  ...mockupNames.map((f): [string, string] => {
    const text = readFileSync(join(repoRoot, 'context/mockups', f), 'utf8');
    // group 1 is non-optional in the pattern, so a match guarantees it
    const css = [...text.matchAll(/<style[^>]*>([^]*?)<\/style>/g)].map((m) => m[1]!).join('\n');
    return [`context/mockups/${f}`, css.replace(/\/\*[^]*?\*\//g, '')];
  }),
  ['packages/gui/renderer/styles.css', stylesCss.replace(/\/\*[^]*?\*\//g, '')],
];

describe('spacing grid (design.html D07)', () => {
  // Declaration-scoped: a spacing property matches only directly after `{` or `;`, and only
  // the longhands whose px values the grid governs. Shorthand values split per-longhand
  // ("8px 12px" checks both). Non-px tokens (auto, %, em, var(), calc() innards) pass through
  // untouched — the grid is a rule about literal px spacing, and intrinsic sizes stay free.
  const SPACING_DECL =
    /(?:^|[;{])\s*(?:padding|margin|gap|row-gap|column-gap|(?:padding|margin)-(?:top|right|bottom|left))\s*:\s*([^;}]+)/g;
  const onGrid = (px: number): boolean => px === 0 || px === 2 || px % 4 === 0;

  it('every padding/margin/gap px value is 0, 2, or a multiple of 4, on every surface', () => {
    for (const [name, css] of surfaceCss()) {
      const offenders: string[] = [];
      for (const decl of css.matchAll(SPACING_DECL)) {
        // group 1 is non-optional in the pattern, so a match guarantees it
        for (const token of decl[1]!.trim().split(/\s+/)) {
          const px = /^-?(\d*\.?\d+)px$/.exec(token);
          if (px && !onGrid(Math.abs(parseFloat(px[1]!)))) offenders.push(decl[0].trim());
        }
      }
      expect(offenders, `${name}: spacing declaration off the 4px grid`).toEqual([]);
    }
  });
});

describe('readable-text floor (design.html D06) and placeholder colour (D13)', () => {
  it('no font-size declaration below 11px on any surface', () => {
    // The type ramp's floor: the smallest readable text is 11px. No allowlist — a genuinely
    // decorative case would earn an explicit entry here with its reason; none exists.
    for (const [name, css] of surfaceCss()) {
      const offenders = [...css.matchAll(/(?:^|[;{])\s*font-size\s*:\s*([^;}]+)/g)]
        // group 1 is non-optional in the pattern, so a match guarantees it
        .map((m) => m[1]!.trim())
        .filter((v) => {
          const px = /^(\d*\.?\d+)px\b/.exec(v);
          return !!px && parseFloat(px[1]!) < 11;
        });
      expect(offenders, `${name}: font-size below the 11px readable floor`).toEqual([]);
    }
  });

  it('styles.css paints placeholder text muted via one ::placeholder rule', () => {
    expect(stylesCss).toMatch(/::placeholder\s*\{\s*color:\s*var\(--muted\);?\s*\}/);
  });
});

describe('reduced motion honored (design.html D10/A06)', () => {
  it('styles.css collapses every transition to instant under prefers-reduced-motion', () => {
    const media = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^]*?\n\}/.exec(stylesCss);
    expect(media, 'no prefers-reduced-motion block in styles.css').not.toBeNull();
    expect(media?.[0]).toMatch(/transition-duration:\s*0\.01ms\s*!important|transition:\s*none/);
  });
});
