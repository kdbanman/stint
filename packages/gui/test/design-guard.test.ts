/**
 * GOLD — the design-layer guard (design.html D01/D02, D04, D06/D07, D08, D13, D14, A01/A02, A04,
 * A06; transition PR #132, issues #137, #141, #152 and #153).
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
 *   6. D13/A04 one focus idiom — a DECLARATION CENSUS (bottom of this file) rather than another
 *      allowlist: every token any focus rule names as a boundary is read off the source and must
 *      be the single one design.html sanctions, so an off-table pairing fails instead of passing
 *      by omission. Paired with the A02 floors above, which now score the accent boundary against
 *      every surface a focus stop sits on. The census helper is the reusable half.
 *   7. A01/D04 text colour — the same census over `color` declarations, plus the size and weight
 *      each site resolves to, because A01 picks its floor from the type. Every token painted as
 *      text must be one design.html gives a text role, and `accent` — a 3:1 non-text colour the
 *      running clocks borrow — must clear 24px wherever it is text (issue #141).
 *   8. D06 the type ramp — the same census over `font-size`/`font-weight`, from both stylesheets
 *      and inline `style=` attributes: every authored size and weight is a step §04 names, so a
 *      sixth role cannot accumulate a site at a time (issue #152). The 11px floor in (5) is one
 *      end of that rule; this is the whole of it. Paired with the tabular check the same issue
 *      names, since a clock that is not tabular is off the Clock role even at the right size.
 *   9. D08/D14 the radius trio — the same census over `border-radius`, against three LITERAL
 *      lists: the two recorded 4px exemptions, the circles something else already entails, and
 *      D14's pill-and-tag population. D08 closes its exemption list by spec, so the guard states
 *      it as a closed list too, and a value off the trio with no listed licence fails (issue
 *      #153). This header used to record radii as out of scope on the grounds that their AC is
 *      JUDGE and the off-trio values were a pending exemption question; #164 settled the question
 *      (nothing new is exempt) and #153's audit showed what the gap cost — 504 rendered elements
 *      pill-shaped, including a six-button segmented control.
 *
 * Deliberately out of scope: D14's SECOND clause — that a pill's colour is semantic (run / flag /
 * accent), never decorative. Which colours read as decorative on which pill is a rendered
 * judgement, and the JUDGE makes it; what is decidable from source, and checked in (9), is which
 * elements may carry the shape at all.
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
    const outside = parts?.outside ?? '';
    // Comments are prose, not paint. An issue citation — which the comment convention requires,
    // and which reads `#137` — is character-for-character a 3-digit hex, so a total ban that
    // reaches into comments outlaws the citation rather than a colour. The split keeps both
    // protections: the total ban ("no hex AT ALL") covers every line that actually paints, and
    // the mockups' palette ban covers the comments, so a copied scale value still cannot hide
    // in one.
    const declarations = outside.replace(/\/\*[^]*?\*\//g, '');
    expect(declarations.match(HEX_RE) ?? []).toEqual([]);
    const inComments = (outside.match(/\/\*[^]*?\*\//g)?.join('\n').match(HEX_RE) ?? [])
      .map(normalizeHex)
      .filter((h) => paletteHexes.has(h));
    expect(inComments, 'a raw palette value quoted in a styles.css comment').toEqual([]);
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
  // A01's large-text branch: text at ≥24px, or ≥18.66px BOLD, drops to 3:1. Same number as the
  // non-text floor, a different claim — this one licenses a token to carry READABLE TEXT, and
  // only at a size the text-colour census below checks site by site.
  const LARGE_TEXT_FLOOR = 3;
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
    // Inverse text: the completed step marker fills with ink and prints its number in paper.
    ['paper', 'ink', TEXT_FLOOR],
    // The running count-up (issue #141). Accent is a NON-TEXT token by role (D04), and the app
    // paints it as text in exactly one place — the three running clocks, all on a paper card.
    // That is legal only on A01's large-text branch, so the pairing is scored at that floor here
    // and every site is held to the ≥24px the branch demands by the text-colour census below.
    ['accent', 'paper', LARGE_TEXT_FLOOR],
    // Non-text signal: icons, running marks, focus. A02's 3:1 floor is carried by the
    // FULL-STRENGTH accent — the D13 focus boundary (a field's accent border, an outline
    // everywhere else) and icon ink. The focus HALO (--ring) paints only a 35% mix and is a
    // redundant echo around that boundary, never the indicator of record.
    // Scored against all three surfaces a focus stop actually sits on (issue #137); --canvas is
    // absent deliberately — it backs only the window/popover behind an opaque paper card, so no
    // focus stop is ever drawn against it.
    ['accent', 'paper', NON_TEXT_FLOOR],
    ['accent', 'sidebar', NON_TEXT_FLOOR],
    ['accent', 'wash', NON_TEXT_FLOOR],
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

// ---- the declaration census: score what the CSS SAYS, not a hand-kept list ----------------
// The contrast block above scores an ALLOWLIST of token pairs. That shape catches a SANCTIONED
// pair drifting below its floor, and nothing else: a pairing nobody thought to list is invisible
// to it. That hole is how a 1.89:1 focus ring shipped green (issue #137) — `rule-strong`-as-ring
// simply was not on the table.
//
// The census inverts the direction of the check. Instead of asking "do the pairs I listed still
// pass?", it reads the tokens a ROLE's declarations actually name out of every surface, then
// requires that set to be exactly the set design.html sanctions for the role. A token the guard
// has never heard of arrives as an extra census member and fails, instead of passing by omission.
//
// A role-specific check is then three moves: census the declarations that express the role,
// assert the token set, and — where the role carries a contrast floor — add the resulting pairs
// to the permitted table above so the floor is recomputed from the tokens file too.

interface CensusHit {
  readonly surface: string;
  readonly selector: string;
  readonly token: string;
}

/**
 * Every `var(--token)` named by a matching property, inside the rules whose selector matches,
 * across every surface. Both regexes must be NON-global: a /g regex carries `lastIndex` between
 * `.test()` calls and would silently skip every other rule.
 */
const censusTokens = (selector: RegExp, property: RegExp): CensusHit[] => {
  const hits: CensusHit[] = [];
  for (const [surface, css] of surfaceCss()) {
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // groups 1 and 2 are non-optional in the pattern, so a match guarantees them
      const sel = rule[1]!.trim().replace(/\s+/g, ' ');
      if (!selector.test(sel)) continue;
      for (const declaration of rule[2]!.split(';')) {
        const parsed = /^\s*([a-z-]+)\s*:([^]*)$/.exec(declaration);
        // group 1 is the property, group 2 the value; a match guarantees both
        if (!parsed || !property.test(parsed[1]!)) continue;
        for (const use of parsed[2]!.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
          hits.push({ surface, selector: sel, token: use[1]! });
        }
      }
    }
  }
  return hits;
};

describe('one focus idiom, reachable (design.html D13/A04, A02 — issue #137)', () => {
  // Rules that style a FOCUSED ELEMENT: `:focus` and `:focus-visible`. `:focus-within` is
  // excluded on purpose — it styles a CONTAINER around whatever is focused (an entry row
  // revealing its ops bar), so its colours are ordinary chrome, not a focus indicator.
  const FOCUS_RULE = /:focus(?:-visible)?\b(?!-)/;
  // Every declaration that can draw the boundary. `outline`/`border` cover the shorthands.
  const BOUNDARY = /^(?:outline|outline-color|border|border-color)$/;

  it('every focus boundary, on every surface, is the one accent token', () => {
    const hits = censusTokens(FOCUS_RULE, BOUNDARY);
    // Guard-the-guard: an empty census satisfies the emptiness assertion below vacuously, so a
    // selector regex that stopped matching would read as green. Ten hits stand today (the two
    // styles.css rules plus each mockup's `.field:focus`); the floor is set below that so
    // ordinary consolidation does not trip it, but a census that has gone blind does.
    expect(hits.length, 'the focus census found (almost) nothing — it has gone blind').toBeGreaterThanOrEqual(8);
    expect(
      hits.some((h) => h.surface === 'packages/gui/renderer/styles.css'),
      'the SHIPPED renderer contributed no focus boundary — only the mockups were scanned',
    ).toBe(true);

    const offenders = hits
      .filter((h) => h.token !== '--accent')
      .map((h) => `${h.surface}: ${h.selector} → ${h.token}`);
    // D13 names one idiom, and A02 puts a 3:1 floor under it. Only the full-strength accent
    // clears that floor on paper/sidebar/wash (scored in the contrast block above); every other
    // candidate the app has reached for — `rule-strong` at 1.89:1 — cannot.
    expect(offenders, 'D13 names ONE focus idiom: the accent boundary + the 3px ring').toEqual([]);
  });

  it('styles.css declares outline only on the focus rule, so nothing can outrank the boundary', () => {
    const css = stylesCss.replace(/\/\*[^]*?\*\//g, '');
    const strays: string[] = [];
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // groups 1 and 2 are non-optional in the pattern, so a match guarantees them
      const sel = rule[1]!.trim().replace(/\s+/g, ' ');
      if (FOCUS_RULE.test(sel)) continue;
      if (/(?:^|[;{])\s*outline\s*:/.test(rule[2]!)) strays.push(sel);
    }
    // A02 rests on this. An outline cannot be outranked by a more specific component rule the
    // way a border can — `.start-form input[type="text"]` beats `input:focus-visible`, which is
    // how the accent border D13 asks for silently lost the cascade and never painted (#137). A
    // component rule reaching for `outline` would put the boundary back in play.
    expect(strays, 'outline declared outside the focus rule').toEqual([]);
  });

  it('the D13 ring is reachable — it paints under :focus-visible', () => {
    const rings = censusTokens(/:focus-visible\b/, /^box-shadow$/);
    expect(
      rings.some((h) => h.token === '--ring' && h.surface === 'packages/gui/renderer/styles.css'),
      'the shipped app never paints --ring under a selector a browser can match',
    ).toBe(true);
    // Issue #137 treatment C: `--ring` hung off `:focus:not(:focus-visible)`. Chromium matches
    // `:focus-visible` on a text control for a MOUSE click too, so the negation never held for
    // the controls it targeted and the specified idiom never painted at all. The selector is
    // banned outright rather than merely unused — it reads as a focus rule and is dead code.
    // Scanned comment-free: the doctrine comment at the fix site names the dead selector.
    expect(stylesCss.replace(/\/\*[^]*?\*\//g, '')).not.toMatch(/:focus:not\(:focus-visible\)/);
  });
});

// ---- resolving the typography a text site actually gets --------------------------------------
// A01 picks its floor from the SIZE and WEIGHT of the text, and CSS rarely declares those beside
// the colour: `.timer-strip .clock` sets 24px/680 while `.timer-strip.running .clock` sets the
// colour. So scoring a colour site means finding the rules that also style it.
//
// The matcher below is descendant-combinator semantics and nothing more: a rule applies to a site
// when the rule's compounds are a subsequence of the site's, aligned on the subject (the last
// compound), and every simple selector in a rule compound also appears in the site compound it
// lands on. `.timer-strip .clock` therefore styles `.timer-strip.running .clock`, `.pop-clock`
// styles `.pop.running .pop-clock`, and `.timer-card .clock` styles neither. Later declarations
// win, which is the cascade's tie-break at equal specificity and the order this codebase writes
// its overrides in anyway.

/** The simple selectors inside one compound: `.timer-strip.running` → ['.timer-strip', '.running']. */
const simpleSelectors = (compound: string): string[] =>
  compound.match(/[.#]?[A-Za-z0-9_-]+|::?[a-z-]+(?:\([^)]*\))?|\[[^\]]*\]/g) ?? [];

/** A selector's compounds, outermost first. Every combinator is read as "descendant" — treating
 *  `>` as loose can only make the matcher apply MORE rules, never miss one that applies. */
const compoundSelectors = (selector: string): string[] =>
  selector.split(/\s*[>+~ ]\s*/).filter(Boolean);

/** Does every simple selector of compound `a` also appear in compound `b`? */
const compoundCovers = (a: string, b: string): boolean => {
  const target = simpleSelectors(b);
  return simpleSelectors(a).every((s) => target.includes(s));
};

/** Would a rule with this selector style the element the site selector describes? */
const ruleAppliesAt = (ruleSelector: string, site: string): boolean =>
  ruleSelector.split(',').some((branch) => {
    const rule = compoundSelectors(branch.trim());
    const target = compoundSelectors(site);
    if (rule.length === 0 || rule.length > target.length) return false;
    // subject first: a rule only styles the site if it selects the same element
    if (!compoundCovers(rule[rule.length - 1]!, target[target.length - 1]!)) return false;
    let t = target.length - 2;
    for (let r = rule.length - 2; r >= 0; r--) {
      while (t >= 0 && !compoundCovers(rule[r]!, target[t]!)) t--;
      if (t < 0) return false;
      t--;
    }
    return true;
  });

interface Typography {
  readonly px?: number;
  readonly weight?: number;
  readonly display?: string;
  readonly family?: string;
  readonly numeric?: string;
}

/** The font-size, font-weight, display, font-family and font-variant-numeric a site resolves to
 *  on one surface. `px` is left undefined when no rule declares a literal px size — an unreadable
 *  site, which callers that need a size must treat as a failure rather than a pass. */
const typographyAt = (css: string, site: string): Typography => {
  const resolved: {
    px?: number;
    weight?: number;
    display?: string;
    family?: string;
    numeric?: string;
  } = {};
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // groups 1 and 2 are non-optional in the pattern, so a match guarantees them
    const sel = rule[1]!.trim().replace(/\s+/g, ' ');
    if (!ruleAppliesAt(sel, site)) continue;
    for (const declaration of rule[2]!.split(';')) {
      const parsed = /^\s*([a-z-]+)\s*:([^]*)$/.exec(declaration);
      if (!parsed) continue;
      const value = parsed[2]!.trim();
      if (parsed[1] === 'font-size') {
        const px = /^(\d*\.?\d+)px$/.exec(value);
        resolved.px = px ? parseFloat(px[1]!) : NaN;
      } else if (parsed[1] === 'font-weight') {
        resolved.weight = value === 'bold' ? 700 : value === 'normal' ? 400 : Number(value);
      } else if (parsed[1] === 'display') {
        resolved.display = value;
      } else if (parsed[1] === 'font-family') {
        resolved.family = value;
      } else if (parsed[1] === 'font-variant-numeric') {
        resolved.numeric = value;
      }
    }
  }
  return resolved;
};

describe('text colour: every token painted as text, on the floor it earns (design.html A01/D04 — issue #141)', () => {
  // Icons paint through `color` too (an inline SVG inherits currentColor), and D04 puts them on
  // the A02 non-text floor, so the `.ic` class — the one icon idiom design.html §06 gives — is
  // split out rather than scored as text.
  const ICON_SITE = /\.ic\b/;
  // Reach: the census reads TOKEN uses, `var(--x)`, which is what the helper was built for and
  // what D02 requires a surface to write. The one text colour the app states as a literal is
  // `white` on the primary button, whose pairing against `accent-solid` is scored in the
  // permitted table above; D01's hex ban keeps any palette value out of the literals entirely.
  const textColour = (): CensusHit[] =>
    censusTokens(/./, /^color$/).filter((h) => !ICON_SITE.test(h.selector));

  // Every token design.html gives a text role, and nothing else. `faint` is the disabled-control
  // exemption §07 records (where it may appear is the separate allowlist above); `paper` is the
  // inverse label on an ink-filled marker; `accent` is a NON-text token that the running count-up
  // borrows, legal only on the large-text branch the next test enforces.
  const TEXT_TOKENS = [
    '--accent',
    '--accent-ink',
    '--danger',
    '--faint',
    '--flag',
    '--ink',
    '--muted',
    '--paper',
    '--run',
  ];

  it('every token any surface paints as text is one design.html gives a text role', () => {
    const hits = textColour();
    // Guard-the-guard: the assertion below is a set comparison, which an empty census would not
    // satisfy — but a census reduced to a handful of surfaces would still look plausible. 527
    // text-colour declarations stand today across the eleven mockups and styles.css.
    expect(hits.length, 'the text-colour census found almost nothing — it has gone blind').toBeGreaterThanOrEqual(400);
    expect(
      hits.some((h) => h.surface === 'packages/gui/renderer/styles.css'),
      'the SHIPPED renderer contributed no text colour — only the mockups were scanned',
    ).toBe(true);
    // An off-table token — the hole issue #141 came through, where nobody had listed accent as a
    // thing text could be painted with — arrives here as an extra member and fails.
    expect([...new Set(hits.map((h) => h.token))].sort()).toEqual(TEXT_TOKENS);
  });

  /** Every VISIBLE accent-as-text site, with the typography it resolves to. Hidden sites are not
   *  text: the compact strip's `.state` word is display:none permanently — kept in the DOM for
   *  assistive tech, which reads it without a contrast ratio (styles.css §12 R04). The Timer
   *  card's `.state` is NOT hidden any more (issue #142 gave the card the worded+dotted treatment
   *  the strip already had), and it inks rather than taking the accent, so it is scored as text
   *  like everything else. */
  const accentTextSites = (): Array<CensusHit & { type: Typography }> => {
    const surfaces = new Map(surfaceCss());
    return textColour()
      .filter((h) => h.token === '--accent')
      .map((h) => ({ ...h, type: typographyAt(surfaces.get(h.surface) ?? '', h.selector) }))
      .filter((h) => h.type.display !== 'none');
  };

  it('every accent-as-text site is ≥24px, the size A01 requires to license a 3:1 colour', () => {
    const LARGE_PX = 24;
    const painted = accentTextSites();

    // Guard-the-guard: three running count-ups carry the accent — the Timer-view card clock, the
    // Entries strip clock, and the tray popover clock. A census that stopped finding them would
    // otherwise pass this test by having nothing to score.
    expect(painted.length, 'the accent-as-text census found fewer than the three running clocks').toBeGreaterThanOrEqual(3);

    const offenders = painted
      // A site whose size cannot be read is a FAILURE, not a skip: the floor is unknowable, so
      // the guard must say so rather than wave it through.
      .filter((h) => !(typeof h.type.px === 'number' && h.type.px >= LARGE_PX))
      .map((h) => `${h.surface}: ${h.selector} → ${h.type.px ?? 'no readable font-size'}px`);
    // WCAG's other large-text branch — ≥18.66px BOLD — is deliberately not offered. D06 puts every
    // clock at 680, which is semibold; claiming the bold allowance at 680 would be reading the
    // spec in the app's favour. Size is the branch this app earns.
    expect(offenders, 'accent is a 3:1 colour (A02/D04) — as text it is legal only at ≥24px').toEqual([]);
  });

  it('the running clocks carry the D06 weight of 680 — the semibold the size branch offsets', () => {
    // The reason the test above cannot offer the bold branch. Pinning the weight keeps that
    // reasoning true: at 700 the ≥18.66px branch would open and the ≥24px rule would look
    // arbitrary; at 640 the strip clock drifts back toward the under-weight the audit found.
    const offenders = accentTextSites()
      .filter((h) => h.type.weight !== 680)
      .map((h) => `${h.surface}: ${h.selector} → ${h.type.weight ?? 'no font-weight'}`);
    expect(offenders, 'D06 puts every clock at 680').toEqual([]);
  });
});

// ---- the type ramp: five roles, and nothing between them (issue 152) -------------------------
// The readable-text floor above is one END of D06's type rule; this is the whole of it. §04 gives
// five roles and no sixth — Clock 24–38px/680, Title 17–18px/640, Body strong 13px/590, Body
// 13px/450, Caption 12px, with 11px named in the Caption row as the smallest readable step — and
// says hierarchy comes from size and weight ONLY. So a size or weight that is not on the table is
// a sixth role nobody declared, and the audit counted 45 of them in styles.css alone (35 sizes,
// 10 weights) with another 85 across the mockups: a 12.5px here, a 500 there, each harmless alone
// and collectively a ramp that no longer constrains anything.
//
// Direction, as with the censuses above: this reads what the CSS SAYS and holds ALL of it to the
// table. Scoring a list of selectors someone remembered would let the drift walk straight back in
// through whatever the list omits — the same shape of hole that let a 1.89:1 focus ring and an
// accent-as-text clock ship green.

interface StyledSite {
  readonly surface: string;
  /** The rule's selector, or `style=` for a declaration written inline on an element. */
  readonly site: string;
  readonly declarations: string;
}

/** Documents whose ELEMENTS can carry a `style=` attribute: the mockups plus the two renderer
 *  HTML files. Not decoration — design-system.html writes its whole type-ramp demo inline, so a
 *  census that read only stylesheets would score the ramp's own illustration not at all. */
const markupDocuments = (): Array<[name: string, markup: string]> => [
  ...mockupNames.map((f): [string, string] => [
    `context/mockups/${f}`,
    readFileSync(join(repoRoot, 'context/mockups', f), 'utf8'),
  ]),
  ...['index.html', 'popover.html'].map((f): [string, string] => [
    `packages/gui/renderer/${f}`,
    readFileSync(join(repoRoot, 'packages/gui/renderer', f), 'utf8'),
  ]),
];

/** Every place a declaration can be authored, from both halves of every surface. */
const styledSites = (): StyledSite[] => {
  const sites: StyledSite[] = [];
  for (const [surface, css] of surfaceCss()) {
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // groups 1 and 2 are non-optional in the pattern, so a match guarantees them
      sites.push({
        surface,
        site: rule[1]!.trim().replace(/\s+/g, ' '),
        declarations: rule[2]!,
      });
    }
  }
  for (const [surface, markup] of markupDocuments()) {
    // group 1 is non-optional in the pattern, so a match guarantees it
    for (const attr of markup.matchAll(/style="([^"]*)"/g)) {
      sites.push({ surface, site: `style="${attr[1]!}"`, declarations: attr[1]! });
    }
  }
  return sites;
};

describe('the type ramp (design.html D06 §04 — issue 152)', () => {
  const RAMP_WEIGHTS = new Set([450, 590, 640, 680]);
  /** The §04 size steps: the three discrete roles, plus the two the table writes as ranges. */
  const sizeOnRamp = (px: number): boolean =>
    px === 11 || px === 12 || px === 13 || (px >= 17 && px <= 18) || (px >= 24 && px <= 38);

  const TYPE_DECL = /(?:^|[;{])\s*(font-size|font-weight)\s*:\s*([^;}]+)/g;

  it('every authored size and weight, on every surface, is a step the §04 table names', () => {
    const declarations = styledSites().flatMap((s) =>
      // groups 1 and 2 are non-optional in the pattern, so a match guarantees them
      [...s.declarations.matchAll(TYPE_DECL)].map((m) => ({
        where: `${s.surface}: ${s.site}`,
        property: m[1]!,
        value: m[2]!.trim(),
      })),
    );
    // Guard-the-guard: 554 typography declarations stand today across the eleven mockups,
    // styles.css and the two renderer documents. The assertion below is an emptiness check, so a
    // census that stopped matching would report no offenders and read green.
    expect(
      declarations.length,
      'the type census found almost nothing — it has gone blind',
    ).toBeGreaterThanOrEqual(400);
    expect(
      declarations.some((d) => d.where.startsWith('packages/gui/renderer/styles.css')),
      'the SHIPPED renderer contributed no type declaration — only the mockups were scanned',
    ).toBe(true);
    expect(
      declarations.some((d) => d.where.includes(': style="')),
      'the inline-attribute half of the census found nothing — the type ramp demo is written there',
    ).toBe(true);

    const offenders = declarations
      .filter((d) => {
        if (d.property === 'font-size') {
          const px = /^(\d*\.?\d+)px$/.exec(d.value);
          // A size the scan cannot read is a FAILURE, not a skip: the ramp is a set of px steps,
          // so a relative size (em/%/inherit) leaves the rendered step unknowable here. None
          // exists today, and one arriving is a spec question, not something to wave through.
          return !px || !sizeOnRamp(parseFloat(px[1]!));
        }
        // `bold`/`normal` are 700/400 spelled as words — both off the ramp, and read as such
        // rather than skipped, so the keyword is not a way around the numbers.
        const weight = d.value === 'bold' ? 700 : d.value === 'normal' ? 400 : Number(d.value);
        return !RAMP_WEIGHTS.has(weight);
      })
      .map((d) => `${d.where} → ${d.property}: ${d.value}`);
    expect(offenders, 'D06 gives five type roles; this is a sixth').toEqual([]);
  });

  it('no surface hides a size in the `font` shorthand, where the census cannot see it', () => {
    // `font: inherit` is the one shorthand the app writes — a button adopting the page's type,
    // which introduces no size at all. A shorthand carrying its own size would set a role the
    // census above never scores, so the property is allowed only in that size-free form.
    const strays = styledSites()
      .flatMap((s) =>
        // group 1 is non-optional in the pattern, so a match guarantees it
        [...s.declarations.matchAll(/(?:^|[;{])\s*font\s*:\s*([^;}]+)/g)].map((m) => ({
          where: `${s.surface}: ${s.site}`,
          value: m[1]!.trim(),
        })),
      )
      .filter((d) => /\d\s*(?:px|pt|em|rem|ex|ch|%)/.test(d.value))
      .map((d) => `${d.where} → font: ${d.value}`);
    expect(strays, 'a `font` shorthand carrying its own size').toEqual([]);
  });
});

describe('every clock and duration is tabular (design.html D06 — issue 152)', () => {
  it('no surface writes font-variant-numeric to anything but tabular-nums', () => {
    // D06's "digits never jitter" has no opposite case: nothing in this app wants proportional
    // figures. Writing `normal` would be the one way to opt a clock out of the idiom while still
    // looking like it had been considered.
    const offenders = styledSites()
      .flatMap((s) =>
        // group 1 is non-optional in the pattern, so a match guarantees it
        [...s.declarations.matchAll(/(?:^|[;{])\s*font-variant-numeric\s*:\s*([^;}]+)/g)].map(
          (m) => ({ where: `${s.surface}: ${s.site}`, value: m[1]!.trim() }),
        ),
      )
      .filter((d) => d.value !== 'tabular-nums')
      .map((d) => `${d.where} → font-variant-numeric: ${d.value}`);
    expect(offenders, 'D06: every clock and duration is tabular').toEqual([]);
  });

  it('every backup timestamp the renderer prints lands in a monospace, tabular site', () => {
    // Reach, stated plainly: CSS cannot see that a string is a TIME, so "every clock and duration"
    // is not decidable from the stylesheet alone. What IS decidable is the other direction — take
    // a formatter that produces a time and check where its output is painted. `backupLabel()` is
    // the one the audit caught: it feeds two sites, and only `.ver` carried the idiom while
    // `.backup-meta` printed "Jul 26, 2026, 00:30" in the proportional sans (issue 152).
    const settingsJs = readFileSync(join(repoRoot, 'packages/gui/renderer/settings.js'), 'utf8');
    const css = stylesCss.replace(/\/\*[^]*?\*\//g, '');
    const sites = [...settingsJs.matchAll(/class="([^"]+)">\$\{esc\(backupLabel\(/g)]
      // group 1 is the class list, which a match guarantees; `a b` becomes the compound `.a.b`
      .map((m) => `.${m[1]!.trim().split(/\s+/).join('.')}`);
    // Guard-the-guard: two such sites stand today. A markup reshuffle that broke the match would
    // otherwise leave nothing to score.
    expect(sites.length, 'the backupLabel census found fewer than the two known sites').toBeGreaterThanOrEqual(2);

    const offenders = sites
      .map((site) => ({ site, type: typographyAt(css, site) }))
      .filter((h) => h.type.family !== 'var(--num)' || h.type.numeric !== 'tabular-nums')
      .map(
        (h) =>
          `${h.site} → ${h.type.family ?? 'no font-family'} / ${h.type.numeric ?? 'no font-variant-numeric'}`,
      );
    expect(offenders, 'D06 puts every clock and duration in the numeric face, tabular').toEqual([]);
  });
});

// ---- the radius trio: three radii, and a closed list of exceptions (issue 153) ---------------
// D08 gives three radii — 8px controls, 12px cards, 16px window & overlays — and says "No fourth
// radius … The exemption list is closed". D14 adds the shape rule the trio does not cover: pills
// and tags are the ONLY pill-shaped elements. Together those make every authored radius decidable
// from source, which is what lets this be a census rather than a JUDGE impression: a value sits on
// the trio, or on the recorded exemption list, or on a shape something else already entails, or it
// is a defect.
//
// The gap that let it drift: the JUDGE scores what a view LOOKS like, and a pill among pills looks
// deliberate. The audit had to count computed styles across all six surfaces to see it — 504
// rendered elements at `border-radius: 999px` whose selectors were neither pill nor tag, including
// the six-button date-range control sitting in the same grid as the 8px Billable segment (#153).
//
// The three lists below are LITERAL and matched EXACTLY against the rule's selector, which is the
// design and not a shortcut. D08 closes its exemption list by spec, so the guard states it as a
// closed list too: a sixth radius fails, and so does a NEW selector reaching for an existing
// exception. A predicate over selector NAMES would have been the wrong shape — `/pill|tag/` waves
// through `.stp-pill`, the decoratively-neutral pill that was a fifth of this issue.

describe('the radius trio (design.html D08/D14 — issue 153)', () => {
  /** The trio, recomputed from design.tokens.json rather than transcribed — the same stance the
   *  contrast block takes. Both spellings are legal: the custom property the generator emits, and
   *  the px literal it resolves to. `0` is not a fourth radius but the absence of one (a square
   *  corner — the neutraliser `.presets` writes, and the mid-segments of a split day block). */
  const TRIO = new Set<string>([
    ...Object.values<{ $value: string }>(tokens.radius).map((d) => d.$value),
    'var(--r1)',
    'var(--r2)',
    'var(--r3)',
    '0',
    '0px',
  ]);

  /** The exemption design.html D08 records — "a functional mark whose control radius would exceed
   *  half its own box" — and the only selectors that may spell it. Two marks, three sites: the
   *  7px progress track in the app and in mockups/settings.html, and the calendar corner checkbox
   *  in the two merge mockups. The SHIPPED checkbox is absent on purpose: since issue #148 gave it
   *  a 24×24 target it reaches the same painted 4px corner as `var(--r1)` minus a 4px transparent
   *  border, so it declares a trio value and never needs this list. */
  const EXEMPT_4PX = new Set<string>(['.step .bar', '.prog .bar', '.row .ck']);

  /** Circles, judged one at a time. Issue #164 proposed a blanket "circles are a fourth D08
   *  exemption" and was withdrawn for exactly the reason a blanket is tempting: it would license
   *  every future circle. Each entry below instead names what ALREADY entails the shape, so the
   *  exemption list stays closed and this list adds nothing to it. The one circle with no
   *  entailment behind it — the numbered step badge — was fixed to the control radius, not
   *  listed. */
  const ENTAILED_CIRCLES = new Set<string>([
    // Dots. design.html §03 names a `run-dot` token and describes it as "The running dot"; a dot
    // is round. Four of them: the Timer card, the Entries strip, the tray popover, the mockups.
    '.run-dot',
    '.timer-strip .strip-dot',
    '.timer-card .tc-dot',
    '.pop-dot',
    '.dot',
    // Radios. D08's own prose reasons that "a circular checkbox reads as a radio" — which entails
    // the circle for an actual radio, and for the inner fill that marks it chosen.
    '.editor.conflict-prompt .mc-opt .rad',
    '.editor.conflict-prompt .mc-opt.on .rad::after',
    '.rad',
    '.opt.on .rad::after',
    // The switch KNOB. A knob is round; the TRACK it slides in is not, and that track was one of
    // this issue's five populations.
    '.set-toggle i',
    '.sw i',
    // Not a Stint element at all: the mockups draw a host window titlebar to establish context,
    // and its traffic lights are round because the OS draws them round. D08 governs Stint's own
    // controls, cards and windows — not a picture of someone else's.
    '.lights i',
  ]);

  /** D14's pill-shaped population: pills and tags, and nothing else. Naming them is what the rule
   *  means — "the ONLY pill-shaped elements" is a claim about a closed set — so a new pill is a
   *  deliberate line here rather than a shape that accumulated. */
  const PILLS_AND_TAGS = new Set<string>([
    // the app
    '.chip', // an entry row's tag chip
    '.flag', // billable / flagged
    '.ok', // the backup "verified" pill
    '.pill', // the shared pill idiom
    '.pill.new, .update-result.new', // the update-available pill
    '.report-flag', // a report row's flag
    '.sel-count', // the selection count
    '.liveedit .le-pill',
    '.ov .otag', // the calendar overlap tag
    '.stp-overlap .stp-otag', // the same tag inside the interval picker
    // the mockups
    '.tag',
    '.overlap .otag',
  ]);

  /** Every radius longhand and the shorthand. NOT global: `.test()` on a /g regex carries
   *  `lastIndex` between calls and would skip every other site. */
  const RADIUS_DECL = /(?:^|[;{])\s*border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/;

  const radiusDeclarations = (): Array<{ where: string; site: string; value: string }> =>
    styledSites().flatMap((s) =>
      // group 1 is non-optional in the pattern, so a match guarantees it
      [...s.declarations.matchAll(new RegExp(RADIUS_DECL, 'g'))].map((m) => ({
        where: `${s.surface}: ${s.site}`,
        site: s.site,
        value: m[1]!.trim(),
      })),
    );

  it('every authored radius, on every surface, is the trio or one of the listed exceptions', () => {
    const declarations = radiusDeclarations();
    // Guard-the-guard: 269 radius declarations stand today across the eleven mockups, styles.css
    // and the two renderer documents. The assertion below is an emptiness check, so a census that
    // stopped matching would report no offenders and read green.
    expect(
      declarations.length,
      'the radius census found almost nothing — it has gone blind',
    ).toBeGreaterThanOrEqual(200);
    expect(
      declarations.some((d) => d.where.startsWith('packages/gui/renderer/styles.css')),
      'the SHIPPED renderer contributed no radius — only the mockups were scanned',
    ).toBe(true);
    // The inline `style=` half of styledSites() is scanned here too — one radius is authored that
    // way today, design-system.html's swatch. Its reach is floored by the type-ramp test above,
    // where enough inline declarations stand for a floor to mean something.

    const offenders = declarations
      .filter((d) => {
        // The shorthand carries up to four corners and an optional `/` elliptical half; every
        // component must be legal on its own, so `var(--r1) var(--r1) 0 0` passes and
        // `999px 999px 0 0` does not.
        const parts = d.value.split(/[\s/]+/).filter(Boolean);
        return !parts.every(
          (p) =>
            TRIO.has(p) ||
            (p === '50%' && ENTAILED_CIRCLES.has(d.site)) ||
            (p === '999px' && PILLS_AND_TAGS.has(d.site)) ||
            (p === '4px' && EXEMPT_4PX.has(d.site)),
        );
      })
      .map((d) => `${d.where} → border-radius: ${d.value}`);
    expect(
      offenders,
      'D08 gives three radii and closes its exemption list; D14 gives the pill shape to pills and tags alone',
    ).toEqual([]);
  });

  it('every listed exception is still in use (the lists stay earned)', () => {
    // The mirror of the test above, and the reason the lists cannot rot into a permissive blob: an
    // entry whose selector no longer declares a radius is a licence nobody is using, sitting there
    // ready to legalise whatever reclaims the name.
    const declaring = new Set(
      styledSites()
        .filter((s) => RADIUS_DECL.test(s.declarations))
        .map((s) => s.site),
    );
    const dead = [...EXEMPT_4PX, ...ENTAILED_CIRCLES, ...PILLS_AND_TAGS].filter(
      (s) => !declaring.has(s),
    );
    expect(
      dead,
      'an off-trio radius is licensed for a selector that no longer declares one',
    ).toEqual([]);
  });
});
