/**
 * GOLD — the design-layer guard (design.html D01/D02, D04, D06/D07, D08, D09, D12, D13, D14,
 * A01/A02, A04, A06; transition PR #132, issues #137, #141, #152, #153, #154, #157, #158, #164,
 * #241, #242 and #255).
 *
 * The computed checks the JUDGE's rendered comparison cannot honestly make (design.html §08):
 *
 *   1. D02 token parity — every mockup and styles.css carries EXACTLY the block the generator
 *      emits from context/design.tokens.json between its STINT-TOKENS markers. The block comes
 *      from the emitter itself (scripts/gen-tokens.mjs), not a regex over the generator source,
 *      so a generator refactor cannot fool the guard and a hand-edit inside the markers cannot
 *      survive it.
 *   2. D01 no-raw-hex — a value written as a hex literal outside the markers is a copy that will
 *      silently rot when the tokens change. styles.css is held to a full no-hex rule (semantic
 *      tokens only) plus a ban on the percent-escaped spelling, and no surface may declare a
 *      custom property outside the markers. Which colours those literals may BE is (11).
 *   3. A01/A02 contrast floors — recomputed with the WCAG 2.2 relative-luminance formula from
 *      the tokens file (never trusted from a table), over the permitted token pairs design.html
 *      §03 names, plus the prohibited pairs that must stay unusable.
 *   4. D04/D16 faint-is-never-text — `color: var(--faint)` survives only on the sanctioned
 *      disabled-state selectors; everything readable reads `muted` (G10). Beside it, §07's
 *      disabled idiom in the direction that keeps the allowlist honest: the sanctioned selectors
 *      are exactly the file's `:disabled` population, and each one paints the whole idiom — faint
 *      on wash with a `not-allowed` cursor. One state had grown three grammars, and the drift was
 *      invisible because every rule was individually legal (issue #241).
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
 *      end of that rule; this is the whole of it. Beside it, D06's Clock row as the TWO
 *      properties it states: no surface writes `font-variant-numeric` to anything but
 *      `tabular-nums`, and a rule claiming that tabular half names `font.num` in the SAME rule,
 *      so the face cannot be left to the cascade (issue 242 — the `.tnum` helper carried the
 *      tabular half alone, and nine of the seventeen rules claiming tabular figures let their
 *      element inherit the proportional reading sans). The reach limit that leaves — a
 *      stylesheet cannot see that a string is a time — is closed from the other end by a census
 *      over the renderer's time FORMATTERS: every place one of them is painted must be a site
 *      that carries the whole role.
 *   9. D08/D14 the radius trio — the same census over `border-radius`, against three LITERAL
 *      lists: the two recorded 4px exemptions, the circles something else already entails, and
 *      D14's pill-and-tag population. D08 closes its exemption list by spec, so the guard states
 *      it as a closed list too, and a value off the trio with no listed licence fails (issue
 *      #153). This header used to record radii as out of scope on the grounds that their AC is
 *      JUDGE and the off-trio values were a pending exemption question; #164 settled the question
 *      (nothing new is exempt) and #153's audit showed what the gap cost — 504 rendered elements
 *      pill-shaped, including a six-button segmented control.
 *  10. D09 the elevation ladder — the same census over `box-shadow`, layer by layer: every layer
 *      that paints depth names a `shadow.*` rung, and every layer that paints something ELSE (the
 *      D13 focus ring, a hairline drawn as an inset, a keycap's bottom edge) sits on a literal
 *      value→sites table. Four hand-rolled shadows had accumulated outside the ladder, two of them
 *      accent-tinted at 35% and 30% — one effect at two strengths (issue #154). Beside it, the
 *      one rung whose meaning is not "a layer above the layer below": D12's chip lift means
 *      CHOSEN, so the shipped selectors wearing it are a literal list of selections and anything
 *      else reaching for it fails (issue #255 — half the population had picked it up as a general
 *      sub-card lift, and a lift on everything says nothing).
 *  11. D01 the colour census — the same census over every colour-accepting property, from both
 *      stylesheets and inline `style=`: every colour a surface NAMES is a semantic token or a
 *      literal on a closed, reasoned list. This is (2) at the strength D01 actually states.
 *      The old scan filtered mockup hits to Radix values only, so every non-palette colour was
 *      invisible; it was also keyword-blind (`color: white`) and encoding-blind (`stroke='%23fff'`
 *      inside a data URI). The tokenizer inverts the direction that made those holes possible —
 *      it lists the words that are NOT colours and reads everything else as one (issue #157).
 *  12. D04 one token, one job — the clause a token reference cannot satisfy by itself. `canvas` is
 *      §03's "Backdrop behind the window (docs/mockups)", so no SHIPPED surface may name it: the
 *      app is the window, not a picture of one. A total ban rather than a list, with the mockups'
 *      continued use as its mirror (issue #158). Item (4) is the same clause over `faint`.
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
/** Resolve a semantic token name to its hex value. */
const semantic = (name: string): string => {
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

describe('no raw hex outside the generated block (design.html D01)', () => {
  it('styles.css uses semantic tokens only — no hex literal at all outside the markers', () => {
    const parts = splitOnMarkers(stylesCss);
    expect(parts).not.toBeNull();
    const outside = parts?.outside ?? '';
    // Comments are prose, not paint. An issue citation — which the comment convention requires,
    // and which reads `#137` — is character-for-character a 3-digit hex, so a total ban that
    // reaches into comments outlaws the citation rather than a colour. The split keeps both
    // protections: the total ban ("no hex AT ALL") covers every line that actually paints, and
    // the palette ban below covers the comments, so a copied scale value still cannot hide in one.
    const declarations = outside.replace(/\/\*[^]*?\*\//g, '');
    expect(declarations.match(HEX_RE) ?? []).toEqual([]);
    const inComments = (outside.match(/\/\*[^]*?\*\//g)?.join('\n').match(HEX_RE) ?? [])
      .map(normalizeHex)
      .filter((h) => paletteHexes.has(h));
    expect(inComments, 'a raw palette value quoted in a styles.css comment').toEqual([]);
    // Encoding-blindness (issue #157): `stroke='%23fff'` inside a data URI is a hex literal with
    // its `#` percent-escaped, so it sailed straight past the ban above — which is how a coloured
    // tick shipped inside `.ev .ck`'s checked state. The escape is banned outright, comments and
    // all: a URI has no reason to name a colour when the mask idiom paints with a token.
    expect(outside.match(/%23[0-9a-fA-F]{3,8}/g) ?? []).toEqual([]);
  });

  it('no surface declares a custom property outside the markers', () => {
    // The generated block is where tokens are DECLARED, and the D02 parity test above owns its
    // contents. A `--x: #abc` written anywhere else would be a token nobody generated, holding a
    // literal in the one place the colour census below skips (it reads token USES, not the
    // declarations they resolve to). None exists; this keeps it that way.
    for (const [name, text] of [
      ...mockupNames.map((f): [string, string] => [
        `context/mockups/${f}`,
        readFileSync(join(repoRoot, 'context/mockups', f), 'utf8'),
      ]),
      ['packages/gui/renderer/styles.css', stylesCss] as [string, string],
    ]) {
      const outside = (splitOnMarkers(text)?.outside ?? '').replace(/\/\*[^]*?\*\//g, '');
      const declared = [...outside.matchAll(/(?:^|[;{])\s*(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!);
      expect(declared, `${name}: custom property declared outside the token block`).toEqual([]);
    }
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
    // The label on a solid action fill (issue #164): on-accent is sand·1, not pure white, so the
    // semantic layer stays one-step aliases. Scored on both solid fills a label sits on — the
    // primary's accent-solid and the mockups' filled danger.
    ['on-accent', 'accent-solid', TEXT_FLOOR],
    ['on-accent', 'danger', TEXT_FLOOR],
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
    // FULL-STRENGTH accent — the D13 focus boundary (an outline, with a field's accent border as
    // dressing on top of it) and icon ink. The focus HALO (--ring) paints only a 35% mix and is a
    // redundant echo around that boundary, never the indicator of record.
    // Scored against all three surfaces a focus stop actually sits on (issue #137); --canvas is
    // absent deliberately — no focus stop is drawn against it, and since issue #158 no shipped
    // surface is painted in it at all (the D04 ban at the bottom of this file).
    ['accent', 'paper', NON_TEXT_FLOOR],
    ['accent', 'sidebar', NON_TEXT_FLOOR],
    ['accent', 'wash', NON_TEXT_FLOOR],
  ];
  // pairs the spec prohibits BECAUSE they fail the text floor; if a token change ever lifted
  // one above 4.5 the prohibition (and this table) would need a deliberate revisit
  const prohibited: Array<[fg: string, bg: string]> = [
    ['faint', 'paper'], // faint is decorative/disabled only — never readable text
    ['accent-ink', 'accent-weak'], // why selection is a raised chip, not an accent wash (D12)
    ['on-accent', 'accent'], // why accent-solid exists (D11) — tomato·9 cannot carry a label
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
  //
  // The list is per-selector on purpose: it is the review surface for spending that exemption,
  // so every disabled control the app grows arrives here as a diff line someone has to approve.
  // It is NOT a menu of grammars — §07 states one idiom for the state, and the assertion below
  // holds every listed selector to it, so a rule cannot join the list and then paint its own dim
  // (issue 241, where the four disabled rules had drifted into three different treatments and
  // each one's comment claimed it was following one of the others).
  const allowed = [
    '.unified-form .uf-select:disabled',
    '.report-field:disabled',
    '.set-field:disabled',
    '.set-update-btn:disabled',
  ];

  // Comments can quote CSS (the doctrine header does), so strip them before parsing rules.
  const rules = (): { selector: string; body: string }[] =>
    [...stylesCss.replace(/\/\*[^]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      // groups 1 and 2 are non-optional in the pattern, so a match guarantees them
      selector: m[1]!.trim().replace(/\s+/g, ' '),
      body: m[2]!,
    }));

  it('styles.css paints color: var(--faint) only on the sanctioned disabled selectors', () => {
    const offenders = rules()
      .filter((r) => /color:\s*var\(--faint\)/.test(r.body))
      .map((r) => r.selector)
      .filter((s) => !allowed.includes(s));
    expect(offenders, 'faint used as text colour outside the disabled allowlist').toEqual([]);
  });

  it('every disabled control in styles.css carries the whole §07 idiom, and the list is all of them', () => {
    const disabled = rules().filter((r) => r.selector.includes(':disabled'));
    // Guard-the-guard: an allowlist can only be a review surface if the scan behind it still
    // finds the population. Four disabled rules stand today; a regex gone blind fails here.
    expect(disabled.map((r) => r.selector).sort()).toEqual([...allowed].sort());
    const wrong = disabled
      .filter(
        (r) =>
          !/color:\s*var\(--faint\)/.test(r.body) ||
          !/background:\s*var\(--wash\)/.test(r.body) ||
          !/cursor:\s*not-allowed/.test(r.body),
      )
      .map((r) => r.selector);
    expect(wrong, 'a disabled rule off design.html §07 idiom (faint on wash, not-allowed)').toEqual([]);
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
    // A02 rests on this, and so now does D13, which names the outline as the boundary and carries
    // the reason with it: an outline cannot be outranked by a more specific component rule the way
    // a border can — `.start-form input[type="text"]` beats `input:focus-visible`, which is how the
    // accent border D13 USED to ask for silently lost the cascade and never painted (#137; the spec
    // caught up in #253). A component rule reaching for `outline` would put the boundary back in play.
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
}

/** The font-size, font-weight and display a site resolves to on one surface. `px` is left
 *  undefined when no rule declares a literal px size — an unreadable site, which callers that
 *  need a size must treat as a failure rather than a pass. */
const typographyAt = (css: string, site: string): Typography => {
  const resolved: {
    px?: number;
    weight?: number;
    display?: string;
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
  // what D02 requires a surface to write. No text colour is stated as a literal — the colour
  // census below holds every literal to its licence list, and D01's hex ban keeps palette
  // values out entirely.
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
    '--on-accent',
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

// ---- the Clock role: monospace AND tabular, inseparably (issues 152, 242) --------------------
// D06's Clock row states one role as TWO properties — "Every clock and duration: monospace,
// tabular — digits never jitter" — and the app had been shipping them apart. The `.tnum` helper
// class, which every time site in the renderer wears, carried the tabular half and no family, so
// the face was a per-site decision nobody was making: of the seventeen rules claiming tabular
// figures, eight named `var(--num)` and nine let their element inherit the proportional reading
// sans. The report table's duration column was the site issue 242 filed; the interval picker's
// hour labels, the calendar gutter, both settings time fields and the entry form's Start/Stop
// pair were the same drift nobody had counted.
//
// The guard below is the cause, not the instances: a rule that claims the tabular half must name
// the face in the SAME rule. That is decidable with no site model, no cascade resolution and no
// allowlist, and it holds the fix in the one place a fix can be undone — a new clock cannot claim
// half the role. It also removes the cascade risk that made this drift invisible: a component's
// own field chrome outranks a helper class (the D13 lesson), so every time FIELD names the role
// in its own rule rather than leaving it to `.tnum`, and this test is what keeps that true.
//
// Its reach limit is the one CSS always has: a stylesheet cannot see that a string is a TIME, so
// a site that claims NEITHER half is invisible here. The formatter census below closes that from
// the other end — take the helpers that produce a time and check where their output is painted.
describe('every clock and duration wears the Clock role (design.html D06 — issues 152, 242)', () => {
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

  it('every rule claiming tabular figures names the numeric face in the same rule', () => {
    // The two halves of one role, held together at the point of authorship. Not a resolved-cascade
    // check on purpose: resolving would let a rule claim the tabular half and lean on some other
    // rule for the face, which is exactly the arrangement that let fifteen sites drift — and a
    // resolver would then have to guess an element's ancestry from a class list it read out of a
    // template. Same rule, both properties, nothing to guess.
    const css = stylesCss.replace(/\/\*[^]*?\*\//g, '');
    const claimed: Array<{ site: string; family?: string }> = [];
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // groups 1 and 2 are non-optional in the pattern, so a match guarantees them
      const declarations = new Map<string, string>();
      for (const declaration of rule[2]!.split(';')) {
        const parsed = /^\s*([a-z-]+)\s*:([^]*)$/.exec(declaration);
        if (parsed) declarations.set(parsed[1]!, parsed[2]!.trim());
      }
      if (declarations.get('font-variant-numeric') !== 'tabular-nums') continue;
      claimed.push({
        site: rule[1]!.trim().replace(/\s+/g, ' '),
        family: declarations.get('font-family'),
      });
    }
    // Guard-the-guard: the assertion below is an emptiness check, so a scan that stopped matching
    // would report no offenders and read green. Twenty rules claim the tabular half today.
    expect(
      claimed.length,
      'the Clock-role census found almost nothing — it has gone blind',
    ).toBeGreaterThanOrEqual(15);

    const offenders = claimed
      .filter((c) => c.family !== 'var(--num)')
      .map((c) => `${c.site} → ${c.family ?? 'no font-family'}`);
    expect(
      offenders,
      'D06 states one Clock role as two properties: a rule claiming tabular figures names the face',
    ).toEqual([]);
  });

  it('every formatted time the renderer paints lands in a Clock-role site', () => {
    // The other end of the reach problem. CSS cannot see that a string is a time, so this takes
    // the helpers that PRODUCE one and checks where each is painted. The predecessor traced a
    // single formatter (`backupLabel`) through a single regex; three more existed, `fmtHM` feeding
    // the report table's cells among them, so the census that was meant to catch issue 242's site
    // could not see it. The list below is every renderer helper whose output a user reads as a
    // time, and a new one arriving unlisted is the residue this shape cannot close — which is why
    // the rule-level census above, not this one, is the class guard.
    const TIME_FORMATTERS = [
      'fmtDur', // core formatDuration — HH:MM:SS
      'fmtHours', // core formatHours + the view's h suffix
      'fmtHM', // reports.js — the report table's Hh MMm
      'localTime', // su.ts — the configured zone's HH:MM
      'localInputValue', // src/localtime.ts — the field vocabulary's YYYY-MM-DD HH:mm:ss
      'backupLabel', // settings.js — a backup's timestamp
      'rangeLabel', // su.ts — a report's resolved window
    ];
    const renderer = join(repoRoot, 'packages/gui/renderer');
    const scripts = readdirSync(renderer)
      .filter((f) => f.endsWith('.js'))
      .map((f): [string, string] => [f, readFileSync(join(renderer, f), 'utf8')]);
    const markup = new Map(
      ['index.html', 'popover.html'].map((f): [string, string] => [
        f,
        readFileSync(join(renderer, f), 'utf8'),
      ]),
    );

    /** An element's authored selector: its tag plus its class list, `<td class="num tnum">` →
     *  `td.num.tnum`. The tag is kept because a rule may target the element through it
     *  (`.report-table td.num` does). */
    const compoundOf = (tag: string, classes: string): string =>
      `${tag}.${classes.trim().split(/\s+/).join('.')}`;

    /** The class list of the element carrying `id`, looked up in the renderer's two documents. */
    const byId = (id: string): string | null => {
      for (const [, text] of markup) {
        const el = new RegExp(`<(\\w+)((?:[^>"']|"[^"]*")*?)id="${id}"((?:[^>"']|"[^"]*")*)>`).exec(
          text,
        );
        // groups 1-3 are non-optional in the pattern, so a match guarantees them
        if (!el) continue;
        const cls = /class="([^"]*)"/.exec(el[2]! + el[3]!);
        return cls ? compoundOf(el[1]!, cls[1]!) : el[1]!;
      }
      return null;
    };

    // The two shapes the renderer paints in: an element written with its class list around the
    // interpolation, and a `textContent` assignment onto an id declared in the markup. A formatter
    // reaching the DOM through a local element variable is out of this scan's reach; those sites
    // wear `.tnum`, which the rule-level census above holds to the whole role.
    const painted: Array<{ where: string; formatter: string; site: string }> = [];
    for (const name of TIME_FORMATTERS) {
      const inline = new RegExp(`<(\\w+)[^<>]*class="([^"]+)"[^<>]*>\\$\\{[^}]*\\b${name}\\(`, 'g');
      const byid = new RegExp(`\\$\\('([\\w-]+)'\\)\\.textContent\\s*=[^;]*\\b${name}\\(`, 'g');
      for (const [file, text] of scripts) {
        for (const m of text.matchAll(inline)) {
          // groups 1 and 2 are non-optional in the pattern, so a match guarantees them
          painted.push({ where: file, formatter: name, site: compoundOf(m[1]!, m[2]!) });
        }
        for (const m of text.matchAll(byid)) {
          const site = byId(m[1]!);
          expect(site, `${file}: #${m[1]} is painted with ${name}() but declared in no document`).not.toBeNull();
          if (site) painted.push({ where: `${file}: #${m[1]}`, formatter: name, site });
        }
      }
    }
    // Guard-the-guard: twelve paints stand today across five formatters and both shapes. The
    // assertion below is an emptiness check, so a markup reshuffle that broke either regex would
    // otherwise leave nothing to score — the failure this replaces scored two sites and called it
    // the population.
    expect(painted.length, 'the formatter census found fewer paints than stand today').toBeGreaterThanOrEqual(9);
    expect(
      new Set(painted.map((p) => p.formatter)).size,
      'the formatter census reached only one helper — it is back to pinning a single call site',
    ).toBeGreaterThanOrEqual(4);
    expect(
      painted.some((p) => p.where.includes('#')),
      'the id-assignment half of the census found nothing — the report totals are painted there',
    ).toBe(true);

    // A site carries the role when a rule that could style it gives it both halves. "Could style
    // it" is the rule's SUBJECT compound being covered by the element's own tag and classes, with
    // ancestry assumed present — the report cell's face is declared on `.report-table td.num`, and
    // a template gives no ancestors to match it against. The over-reach is bounded by the census
    // above: every rule in play declares both halves or none.
    const roleRules = [...(stylesCss.replace(/\/\*[^]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g))]
      .flatMap((rule) =>
        // groups 1 and 2 are non-optional in the pattern, so a match guarantees them
        rule[1]!.split(',').map((branch) => {
          const compounds = compoundSelectors(branch.trim());
          return {
            subject: compounds[compounds.length - 1] ?? '',
            family: /(?:^|[;{])\s*font-family\s*:\s*([^;}]+)/.exec(rule[2]!)?.[1]?.trim(),
            numeric: /(?:^|[;{])\s*font-variant-numeric\s*:\s*([^;}]+)/.exec(rule[2]!)?.[1]?.trim(),
          };
        }),
      );
    const roleAt = (site: string): { face: boolean; tabular: boolean; sans: string[] } => {
      const reaching = roleRules.filter((r) => r.subject && compoundCovers(r.subject, site));
      return {
        face: reaching.some((r) => r.family === 'var(--num)'),
        tabular: reaching.some((r) => r.numeric === 'tabular-nums'),
        // Any reading face that can reach the element at all — the D13 cascade lesson, where a
        // component rule spelled more specifically silently outranks the idiom.
        sans: reaching.filter((r) => r.family && r.family !== 'var(--num)').map((r) => r.family!),
      };
    };

    const offenders = painted
      .map((p) => ({ ...p, role: roleAt(p.site) }))
      .filter((p) => !p.role.face || !p.role.tabular || p.role.sans.length > 0)
      .map(
        (p) =>
          `${p.where}: ${p.formatter}() → ${p.site} (face=${p.role.face}, tabular=${p.role.tabular}${p.role.sans.length ? `, reading face reaches it: ${p.role.sans.join(', ')}` : ''})`,
      );
    expect(
      offenders,
      'D06 puts every clock and duration in the numeric face, tabular — a formatted time landed outside it',
    ).toEqual([]);
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
  const EXEMPT_4PX = new Set<string>(['.step .bar', '.prog .bar', '.ev .ck']);

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
    // The week picker's day cells and the grid's today marker. PRD §12 R09 names the shapes —
    // "days carrying entries show a dot" (a dot is round, the same entailment as `run-dot`) and
    // "today carries a ring" (a ring is round); the 20px day target is the circle that ring
    // paints on.
    '.wkgrid .d .edot',
    '.wkgrid .d .tn2',
    '.dh .dd.today',
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
    // The + Add-entry button: D14 admits it by name — PRD §12 R07's circle-to-lozenge hover
    // expansion ("expands rightward into + Add entry without the + glyph moving") entails the
    // capsule, and its accent-solid colour is semantic.
    '.fab',
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

  it('every listed exception still spends its licence (the lists stay earned)', () => {
    // The mirror of the test above, and the reason the lists cannot rot into a permissive blob: an
    // entry whose selector has stopped writing the value it is licensed for is a licence nobody is
    // using, sitting there ready to legalise whatever reclaims the name. Checking merely that the
    // selector still declares SOME radius is not enough — `.ok` moving from 999px to the control
    // radius would leave the pill licence standing unspent.
    const spent = new Map<string, Set<string>>();
    for (const d of radiusDeclarations()) {
      const parts = spent.get(d.site) ?? new Set<string>();
      for (const p of d.value.split(/[\s/]+/).filter(Boolean)) parts.add(p);
      spent.set(d.site, parts);
    }
    const licences: Array<[Set<string>, string]> = [
      [EXEMPT_4PX, '4px'],
      [ENTAILED_CIRCLES, '50%'],
      [PILLS_AND_TAGS, '999px'],
    ];
    const dead = licences.flatMap(([list, value]) =>
      [...list].filter((site) => !spent.get(site)?.has(value)).map((site) => `${site} → ${value}`),
    );
    expect(dead, 'an off-trio radius is licensed for a selector that no longer writes it').toEqual(
      [],
    );
  });
});

// ---- the elevation ladder: one ladder, and nothing that only LOOKS like a rung (issue 154) ----
// D09 gives one ladder — canvas → card → raised → popover → modal, plus the chip lift as the
// sub-card rung — and says "depth is the only 'this is a layer' signal … never a tint or
// decorative border". The §01 principle behind it is blunter: "A region rises by a soft shadow
// alone, never a coloured or bordered box."
//
// Four shadows had been written by hand instead. Two were clay glows — the primary button at
// `accent 35%` and the interval picker's drag grip at `accent 30%`: the same effect shipped at two
// strengths for no stated reason, and a TINTED shadow at that, which is the thing D09's second
// clause names. The switch knob wrote --sh-chip's EXACT geometry at double the token's opacity,
// and that is the most instructive of the four — it looked like the rung, so nothing rendered ever
// flagged it, and it would have drifted the moment the token moved. The mockups carried the same
// drift plus a third grip opacity (18%) and a danger-tinted copy of the button glow.
//
// Direction, as with the censuses above: read what the CSS SAYS and hold all of it to the ladder.
// The check runs per LAYER (a `box-shadow` is a comma-separated list) because the one legitimately
// mixed site — the merge checkbox — writes a drawn boundary and a rung in the same declaration.
//
// A rung must be NAMED, not spelled out: --sh-chip's literal value is NOT accepted here even
// though it is on the ladder. That is the whole lesson of the switch knob. A hand-copied rung is a
// copy that rots when the token moves — exactly what D01 says of a hex literal — and reading it as
// on-ladder would leave this guard blind to the one drift shape that has already happened once.

/** Split a `box-shadow` value into its comma-separated layers, ignoring the commas inside
 *  `rgba(...)` / `color-mix(...)`. A naive `.split(',')` would shred exactly the hand-rolled
 *  values the ladder census exists to catch, and every fragment would then fail for the wrong
 *  reason. Shared with the chip census below, which reads the same layers for a different
 *  question — that one asks WHICH rung, this one asks whether it is a rung at all. */
const layers = (value: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  out.push(current);
  return out.map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
};

/** NOT global: `.test()` on a /g regex carries `lastIndex` between calls and would skip every
 *  other site. Only the longhand — `box-shadow` has no shorthand to hide inside. */
const SHADOW_DECL = /(?:^|[;{])\s*box-shadow\s*:\s*([^;}]+)/;

const shadowDeclarations = (): Array<{ where: string; site: string; value: string }> =>
  styledSites().flatMap((s) =>
    // group 1 is non-optional in the pattern, so a match guarantees it
    [...s.declarations.matchAll(new RegExp(SHADOW_DECL, 'g'))].map((m) => ({
      where: `${s.surface}: ${s.site}`,
      site: s.site,
      value: m[1]!.trim(),
    })),
  );

describe('the elevation ladder (design.html D09 — issue 154)', () => {
  /** The rungs, recomputed from design.tokens.json rather than transcribed — the same stance the
   *  contrast block and the radius trio take. `none` is not a rung but the absence of one: the
   *  canvas floor, which a day-block segment or the in-flow picker declares to opt out of a lift
   *  it would otherwise inherit. */
  const LADDER = new Set<string>([
    'none',
    ...Object.keys(tokens.shadow)
      .filter((n) => !n.startsWith('$'))
      .map((n) => `var(--sh-${n})`),
  ]);

  /** Layers that are not elevation at all, each paired with the selectors that may write it —
   *  LITERAL and matched EXACTLY, the shape #153 settled on, so a new selector reaching for an
   *  existing licence fails rather than inheriting it. Every row paints a BOUNDARY, not depth: no
   *  offset and no blur means no light source, so D09 does not govern it, and the rule that does
   *  is named per row. */
  const NOT_ELEVATION: ReadonlyArray<readonly [layer: string, sites: ReadonlySet<string>]> = [
    // D13's focus idiom — an accent outline as the boundary, plus the 3px ring on fields. The ring
    // is a property of its own, which
    // the generator synthesizes, and the focus census above already owns which token may paint it;
    // this row only records that a ring is not a rung.
    [
      'var(--ring)',
      new Set([
        '.field:focus',
        'input:focus-visible, select:focus-visible, textarea:focus-visible',
      ]),
    ],
    // The same ring geometry in the danger colour, on an invalid field. Mockup-only: the shipped
    // renderer has no invalid-field paint, so this licence is spent in reports.html alone.
    ['0 0 0 3px var(--danger-weak)', new Set(['.field.invalid'])],
    // A keycap's bottom edge. Zero blur, zero spread, in the rule colour: a 1px LINE, drawn as a
    // shadow only because a real border would change the box the hotkey field lays out in.
    ['0 1px 0 var(--rule-strong)', new Set(['.set-hotkey', '.kbd'])],
    // Hairline boundaries drawn INSET for the same reason — the merge checkbox keeps its 24px
    // target (issue #148) by holding a transparent border and painting its 1.5px edge inside it,
    // and the calendar's today-marker and the open-calendar button ring their box without moving
    // anything. `.ev .ck:checked` writes this AND --sh-chip, which is why the census runs per
    // layer rather than per declaration.
    ['inset 0 0 0 1.5px var(--rule-strong)', new Set(['.ev .ck', '.ev .ck:checked', '.ev .ck.on'])],
    ['inset 0 0 0 1px var(--accent)', new Set(['.stp-d.stp-today'])],
    ['inset 0 0 0 1px var(--rule)', new Set(['.timefield .cal.on'])],
    // The week picker's today ring and the day header's today marker — PRD §12 R09/R16's "today
    // carries a ring", drawn inset so the ring never moves the day number it circles. A boundary
    // in the ink colour, not a rung.
    ['inset 0 0 0 1.5px var(--ink)', new Set(['.wkgrid .d.today .tn2', '.dh .dd.today'])],
  ];

  const licensed = (layer: string, site: string): boolean =>
    NOT_ELEVATION.some(([value, sites]) => value === layer && sites.has(site));

  it('every authored shadow layer, on every surface, is a ladder rung or a listed non-shadow', () => {
    const declarations = shadowDeclarations();
    // Guard-the-guard: 133 box-shadow declarations stand today across the eleven mockups,
    // styles.css and the two renderer documents. The assertion below is an emptiness check, so a
    // census that stopped matching would report no offenders and read green.
    expect(
      declarations.length,
      'the shadow census found almost nothing — it has gone blind',
    ).toBeGreaterThanOrEqual(100);
    expect(
      declarations.some((d) => d.where.startsWith('packages/gui/renderer/styles.css')),
      'the SHIPPED renderer contributed no box-shadow — only the mockups were scanned',
    ).toBe(true);
    expect(
      declarations.some((d) => d.where.startsWith('context/mockups/')),
      'no mockup contributed a box-shadow — only the shipped renderer was scanned',
    ).toBe(true);
    // The layer splitter is the one piece of machinery here that can fail SILENTLY: a splitter
    // that broke inside `rgba(…)` would hand every check fragments, and fragments match nothing on
    // the ladder, so it would fail loudly — but one that stopped splitting at all would read a
    // mixed declaration as a single unknown layer and, worse, could be "fixed" by licensing the
    // whole string. Pin the behaviour on a value no surface writes.
    expect(
      layers('inset 0 0 0 1px rgba(1, 2, 3, .4), var(--sh-chip)'),
      'the layer splitter broke a value at a comma inside a function',
    ).toEqual(['inset 0 0 0 1px rgba(1, 2, 3, .4)', 'var(--sh-chip)']);
    // The inline `style=` half of styledSites() is scanned here too — one box-shadow is authored
    // that way today, design-system.html's chip swatch. Its reach is floored by the type-ramp test
    // above, where enough inline declarations stand for a floor to mean something.

    const offenders = declarations
      .filter((d) => !layers(d.value).every((l) => LADDER.has(l) || licensed(l, d.site)))
      .map((d) => `${d.where} → box-shadow: ${d.value}`);
    expect(
      offenders,
      'D09 gives one elevation ladder; a shadow off it is a depth signal nobody declared',
    ).toEqual([]);
  });

  it('every listed non-shadow still spends its licence (the lists stay earned)', () => {
    // The mirror of the test above, and the reason the table cannot rot into a permissive blob: a
    // row whose selector has stopped writing the layer it is licensed for is a licence nobody is
    // using, sitting there ready to legalise whatever reclaims the name.
    const spent = new Map<string, Set<string>>();
    for (const d of shadowDeclarations()) {
      const written = spent.get(d.site) ?? new Set<string>();
      for (const l of layers(d.value)) written.add(l);
      spent.set(d.site, written);
    }
    const dead = NOT_ELEVATION.flatMap(([value, sites]) =>
      [...sites].filter((site) => !spent.get(site)?.has(value)).map((site) => `${site} → ${value}`),
    );
    expect(dead, 'a non-shadow layer is licensed for a selector that no longer writes it').toEqual(
      [],
    );
  });

  it('the ladder the guard reads is the ladder the generator emits', () => {
    // LADDER is derived, which cuts both ways: a token RENAME would quietly retire a rung and
    // leave every site naming the old one failing for a confusing reason, and a NEW `shadow.*`
    // entry would license itself here before anything on any surface wrote it. Pin both ends —
    // the rungs D09 names, spelled the way the generator spells them.
    expect([...LADDER].sort()).toEqual([
      'none',
      'var(--sh-card)',
      'var(--sh-chip)',
      'var(--sh-modal)',
      'var(--sh-pop)',
      'var(--sh-raise)',
      'var(--sh-win)',
    ]);
    for (const rung of [...LADDER].filter((r) => r !== 'none')) {
      expect(
        generatedBlock,
        `${rung} is on the ladder but the generator emits no such property`,
      ).toContain(`  ${rung.slice(4, -1)}:`);
    }
  });
});

// ---- the chip lift means CHOSEN (design.html D12/D09 — issue #255) ----------------------------
// The ladder census above asks whether a shadow layer NAMES a rung. It cannot ask which rung,
// and one rung carries a meaning the others do not: `shadow.chip` is not a layer above the layer
// below it. design.tokens.json calls it "the D12 raised-chip lift"; D09 admits it as "the chip
// lift … as the sub-card selection rung (D12)"; D12 states the idiom — "A chosen thing lifts — a
// raised paper chip with a shadow (the segmented idiom) — it does not turn accent."
//
// That makes the rung decidable from the selector: an element wearing it is claiming to BE the
// chosen one. Eight shipped selectors are — the nav chip, the picked week band, the selection
// count, the chosen segment, the active range preset, the chosen merge option, the picked picker
// day, the ticked calendar checkbox. Eight more had picked it up as a general sub-card lift: the
// primary button (an action is pressed, never chosen), two switch knobs and two drag grips (a
// position and an affordance), two time pills (a readout), and every calendar block at rest —
// fifty lifts on a screen with at most a couple of choices on it. A lift on everything says
// nothing, which is the state D12 was written against.
//
// The population is a LITERAL list matched EXACTLY against the rule's selector — the shape #153,
// #154 and #157 settled on — so a non-selection selector reaching for the rung fails here rather
// than sailing past a ladder census that only asked whether it named A rung. The mirror below
// keeps the list from rotting into a permissive blob.
//
// Shipped renderer only, deliberately, where the sibling censuses span every surface: this one
// scores what an element MEANS, and several mockup components have no shipped counterpart, so
// their role is a design call rather than a code one. The rule is about what the app paints;
// keeping the mockups in step is PRD §18's hand-sync obligation and a separate decision.

describe('the chip lift means chosen (design.html D12 — issue #255)', () => {
  const SHIPPED = 'packages/gui/renderer/styles.css';

  /** The selection population — every shipped element D12 licenses to lift. Each is a CHOICE the
   *  user has made and can unmake, and each is the one chosen member of a set of peers. */
  const CHIP_SELECTIONS = new Set<string>([
    '.nav-item.active', // the active view in the nav rail
    '.wkgrid .d.ws', // the picked week, as one band across the row
    '.sel-count', // the merge selection's count pill
    '.seg .seg-btn.on', // the chosen segment (the idiom D12 names)
    '.presets .preset.on', // the active date-range preset
    '.editor.conflict-prompt .mc-opt.on', // the chosen merge-conflict option
    '.stp-d.stp-sel', // the picked day in the interval picker
    '.ev .ck:checked', // the ticked calendar checkbox — the control that MAKES a selection
  ]);

  /** Every shipped rule naming the chip rung, read per LAYER: `.ev .ck:checked` writes its 1.5px
   *  boundary and the rung in one declaration, so a per-declaration scan would miss the shape. */
  const chipSites = (): string[] =>
    shadowDeclarations()
      .filter((d) => d.where.startsWith(SHIPPED))
      .filter((d) => layers(d.value).includes('var(--sh-chip)'))
      .map((d) => d.site);

  it('no shipped selector wears the chip lift unless it is a selection', () => {
    const sites = chipSites();
    // Guard-the-guard: the assertion below is an emptiness check, so a scan that stopped matching
    // would report no offenders and read green. Eight selections stand today.
    expect(
      sites.length,
      'the chip census found almost nothing — it has gone blind',
    ).toBeGreaterThanOrEqual(8);

    const offenders = sites.filter((site) => !CHIP_SELECTIONS.has(site));
    expect(
      offenders,
      'D12 gives the chip lift ONE meaning — this is the chosen one. Nothing else may lift',
    ).toEqual([]);
  });

  it('every listed selection still wears it (the list stays earned)', () => {
    // The mirror every literal list in this file carries: a selector that has stopped writing the
    // rung is a licence nobody is spending, sitting there ready to legalise whatever reclaims the
    // name — and, here, also the signal that a selection has quietly stopped reading as chosen.
    const worn = new Set(chipSites());
    const dead = [...CHIP_SELECTIONS].filter((site) => !worn.has(site));
    expect(dead, 'a listed selection no longer lifts — D12 says a chosen thing does').toEqual([]);
  });
});

// ---- the colour census: D01 at the strength D01 states (issue #157) ---------------------------
// D01 reads "Surfaces reference SEMANTIC TOKENS ONLY; a raw scale step or hex literal in a mockup
// or the app is a defect" — two clauses. Until this section landed the guard enforced roughly one
// of them: mockup hits were filtered to `paletteHexes.has(h)`, so a value that was not a Radix
// step rode straight through, and the styles.css half was hex-only and therefore blind to a colour
// spelled any other way. Three blindnesses, all demonstrated in the tree:
//
//   • PALETTE-blind — a simulated macOS titlebar and traffic lights in nine mockups, an entire
//     invented desktop in tray-popover.html, and hand-rolled scrim/fade values.
//   • KEYWORD-blind — `color: white` on the primary button; `black` inside a color-mix.
//   • ENCODING-blind — `stroke='%23fff'` inside a data URI, past the `#` regex entirely.
//
// The check that reported green over all of that is the check this section replaces, which is why
// the widening is stated rather than slipped in: a filter that narrows a rule is invisible, and a
// LICENCE that widens it is a line someone has to write and a reviewer can read.
//
// Direction, as with every census above: read what the CSS SAYS and hold ALL of it to the rule.
// The fail-closed move is in `colourTerms` — instead of listing the colours (a list that can never
// be complete, which is exactly how `white` got through a hex regex), it lists the words that are
// NOT colours, and reads every OTHER bare identifier in a colour-accepting value as one. A new
// keyword arrives as an unlicensed term and fails, instead of passing by omission.
//
// The lists below are LITERAL and matched EXACTLY against the rule's selector — the shape #153 and
// #154 settled on — and the mirror test at the bottom keeps them earned.

describe('the colour census (design.html D01 — issue #157)', () => {
  /** Properties whose value paints a colour. `box-shadow` is deliberately absent: the elevation
   *  ladder above already holds every shadow layer to a named rung, so a literal cannot survive
   *  there, and scanning it twice would report one defect under two rules. `filter` IS here —
   *  a `drop-shadow()` is where a colour hides from BOTH checks otherwise. */
  const COLOUR_PROP =
    /^(?:color|background|background-color|background-image|border|border-color|border-(?:top|right|bottom|left)(?:-color)?|outline|outline-color|fill|stroke|caret-color|text-decoration|text-decoration-color|text-emphasis-color|column-rule|column-rule-color|accent-color|-webkit-text-fill-color|text-shadow|filter|backdrop-filter|mask|mask-image|-webkit-mask|-webkit-mask-image)$/;

  /** Functions that ARE a colour. Everything else with parentheses is a wrapper the scan descends
   *  into (`linear-gradient`, `color-mix`, `drop-shadow`) so a literal cannot hide one level down. */
  const COLOUR_FN = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/;

  /** The words that appear in a colour-accepting value and are NOT colours: keywords with no hue,
   *  border styles, gradient and mask grammar, background positioning. The list is the whole
   *  fail-closed design — anything not on it is read as a colour and must be a token or licensed. */
  const NOT_A_COLOUR = new Set([
    'none', 'transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'auto', 'normal',
    'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset', 'hidden',
    'thin', 'medium', 'thick',
    'to', 'top', 'bottom', 'left', 'right', 'center', 'at', 'in', 'from', 'srgb',
    'circle', 'ellipse', 'closest-side', 'closest-corner', 'farthest-side', 'farthest-corner',
    'shorter', 'longer', 'increasing', 'decreasing', 'hue',
    'no-repeat', 'repeat', 'repeat-x', 'repeat-y', 'space', 'round', 'cover', 'contain',
    'fixed', 'scroll', 'local',
    'border-box', 'padding-box', 'content-box', 'fill-box', 'stroke-box', 'view-box',
    'alpha', 'luminance', 'add', 'subtract', 'intersect', 'exclude', 'match-source',
    'underline', 'overline', 'line-through', 'wavy', 'blink', 'evenodd', 'nonzero',
  ]);

  /** Colours inside a `url()`. A data URI is markup, not a CSS value, so descending into it as one
   *  would read half the SVG grammar as colour names — but it is also where issue #157's
   *  ENCODING-blind hole lived, so the two shapes a colour can take there are pulled out by name:
   *  a percent-escaped hex, and an SVG paint attribute. */
  const uriColours = (uri: string): string[] => [
    ...[...uri.matchAll(/%23[0-9a-fA-F]{3,8}|#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z-])/g)].map((m) => m[0]),
    ...[...uri.matchAll(/(?:fill|stroke|stop-color|flood-color|lighting-color)=['"]?([^'"\s>/]+)/g)]
      .map((m) => m[1]!)
      .filter((v) => !NOT_A_COLOUR.has(v.toLowerCase()) && !/^[#%]/.test(v)),
  ];

  /** Every colour a declaration value names — token references included, spelled `var(--x)`, so
   *  the census counts the LEGAL uses too and a scan that stopped matching shows up as a collapsed
   *  total rather than as an empty offender list. */
  const colourTerms = (value: string): string[] => {
    const terms: string[] = [];
    let rest = '';
    for (let i = 0; i < value.length; ) {
      const call = /^([a-zA-Z-]+)\(/.exec(value.slice(i));
      if (!call) {
        rest += value[i];
        i++;
        continue;
      }
      let depth = 1;
      let j = i + call[0].length;
      while (j < value.length && depth > 0) {
        if (value[j] === '(') depth++;
        else if (value[j] === ')') depth--;
        j++;
      }
      // group 1 is non-optional in the pattern, so a match guarantees it
      const name = call[1]!.toLowerCase();
      const inner = value.slice(i + call[0].length, j - 1);
      if (COLOUR_FN.test(name)) terms.push(`${name}(${inner.replace(/\s+/g, '')})`);
      else if (name === 'url') terms.push(...uriColours(inner));
      else if (name === 'var') terms.push(`var(${inner.split(',')[0]!.trim()})`);
      else terms.push(...colourTerms(inner));
      i = j;
    }
    for (const hex of rest.matchAll(/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z-])|%23[0-9a-fA-F]{3,8}/g)) {
      terms.push(hex[0]);
    }
    // Numbers carry their unit as letters (`1px`, `160deg`, `88%`), so they are struck before the
    // bare-word pass — otherwise every length in the tree would arrive as an unlicensed colour.
    const bare = rest
      .replace(/#[0-9a-fA-F]{3,8}|%23[0-9a-fA-F]{3,8}/g, ' ')
      .replace(/-?(?:\d+\.?\d*|\.\d+)[a-zA-Z%]*/g, ' ');
    for (const word of bare.matchAll(/[a-zA-Z][a-zA-Z-]*/g)) {
      if (!NOT_A_COLOUR.has(word[0].toLowerCase())) terms.push(word[0]);
    }
    return terms;
  };

  interface ColourHit {
    readonly surface: string;
    readonly site: string;
    readonly property: string;
    readonly term: string;
  }

  const colourCensus = (): ColourHit[] =>
    styledSites().flatMap((s) =>
      s.declarations.split(';').flatMap((declaration): ColourHit[] => {
        const parsed = /^\s*(-?[a-zA-Z-]+)\s*:([^]*)$/.exec(declaration);
        // group 1 is the property, group 2 the value; a match guarantees both
        if (!parsed) return [];
        const property = parsed[1]!.trim();
        // Custom properties are token DECLARATIONS, which the D01 test above bans outside the
        // markers and the D02 parity test owns inside them.
        if (property.startsWith('--') || !COLOUR_PROP.test(property)) return [];
        return colourTerms(parsed[2]!).map((term) => ({
          surface: s.surface,
          site: s.site,
          property,
          term,
        }));
      }),
    );

  /** A mask paints ALPHA, not colour: the SVG or gradient inside it is a stencil, and `black` /
   *  `white` / `rgba(0,0,0,α)` there name "opaque" and "half" rather than a hue. This is a
   *  PREDICATE, not a site list, because it cannot rot into permission — a hex or a hue in the
   *  same place still fails, which is the whole of what the `%23fff` tick was. */
  const MASK_PROP = /^(?:-webkit-)?mask(?:-image)?$/;
  const ALPHA_ONLY = /^(?:black|white|rgba?\(0,0,0(?:,[\d.]+)?\))$/;

  /** Literals that are not Stint's to tokenize, each paired with the selectors that may write it. */
  const LICENSED: ReadonlyArray<
    readonly [reason: string, term: string, sites: ReadonlySet<string>]
  > = [
    // HOST CHROME — a picture of someone else's software. The mockups draw a macOS window frame,
    // and tray-popover.html a desktop and menu bar, to establish where a Stint window sits; those
    // colours are the OS's and have no semantic token because they are not Stint's surfaces. The
    // radius trio already reasons this way about the same elements ("D08 governs Stint's own
    // controls, cards and windows — not a picture of someone else's"); this is that reasoning
    // applied to D01.
    ['host titlebar', '#F1EBE0', new Set(['.bar'])],
    ['host traffic light', '#e8795f', new Set(['.lights .r'])],
    ['host traffic light', '#e7b34e', new Set(['.lights .y'])],
    ['host traffic light', '#7fae6a', new Set(['.lights .g'])],
    ['host desktop', '#cdbfa8', new Set(['body'])],
    ['host desktop', '#9f9788', new Set(['body'])],
    ['host desktop', '#7d7565', new Set(['body'])],
    ['host menu bar', 'rgba(247,242,234,.86)', new Set(['.menubar'])],
    ['host menu bar', 'rgba(0,0,0,.06)', new Set(['.menubar'])],
    ['host menu bar ink', '#4a443b', new Set(['.menubar', '.menubar .clk'])],

    // A SHADE OPERAND, not a colour of record. `color-mix(in srgb, var(--accent-solid) 88%, black)`
    // is the hover darkening: the colour is the token, and `black` is the direction it moves. The
    // sites are listed rather than the pattern waved through, so a NEW rule reaching for the same
    // trick is a line someone writes.
    [
      'color-mix shade operand',
      'black',
      new Set(['button.primary:hover', '.btn.primary:hover', '.btn.danger:hover']),
    ],
  ];

  const licensed = (h: ColourHit): boolean =>
    LICENSED.some(([, term, sites]) => term === h.term && sites.has(h.site));

  /** design-system.html's swatch chart is the palette's own DOCUMENTATION — every chip names its
   *  value beside its token, which is the page's whole job. Licensed as a family rather than as
   *  twenty rows, and held to a rule of its own below: a chip may only show a value that IS in the
   *  palette, so the sheet can document the tokens and cannot invent a colour. */
  const swatch = (h: ColourHit): boolean =>
    h.surface === 'context/mockups/design-system.html' &&
    /^style="background:#[0-9a-fA-F]{3,8}"$/.test(h.site);

  it('every colour any surface names is a semantic token or a licensed literal', () => {
    const hits = colourCensus();
    // Guard-the-guard: 1509 colour terms stand today across the eleven mockups, styles.css and the
    // two renderer documents — the great majority of them legal `var(--token)` uses, which is why
    // they are censused at all. The assertion below is an emptiness check, so a tokenizer that
    // stopped matching would report no offenders and read green.
    expect(
      hits.length,
      'the colour census found almost nothing — it has gone blind',
    ).toBeGreaterThanOrEqual(1200);
    expect(
      hits.some((h) => h.surface === 'packages/gui/renderer/styles.css'),
      'the SHIPPED renderer contributed no colour — only the mockups were scanned',
    ).toBe(true);
    expect(
      hits.some((h) => h.surface.startsWith('context/mockups/')),
      'no mockup contributed a colour — only the shipped renderer was scanned',
    ).toBe(true);
    expect(
      hits.some((h) => h.site.startsWith('style="')),
      'the inline-attribute half of the census found nothing — the swatch chart is written there',
    ).toBe(true);

    const offenders = hits
      .filter((h) => !h.term.startsWith('var(--'))
      .filter((h) => !(MASK_PROP.test(h.property) && ALPHA_ONLY.test(h.term)))
      .filter((h) => !licensed(h) && !swatch(h))
      .map((h) => `${h.surface}: ${h.site} → ${h.property}: ${h.term}`);
    expect(
      offenders,
      'D01: surfaces reference semantic tokens only — a raw literal is a copy that rots',
    ).toEqual([]);
  });

  it('every token the census reads is one the generator actually emits', () => {
    // The other direction, and the cheap half: a `var(--typo)` or a retired token resolves to
    // nothing at runtime and paints an inherited colour, which no contrast table would ever score.
    const emitted = new Set(generatedBlock.match(/--[a-z0-9-]+(?=:)/g) ?? []);
    const strays = [
      ...new Set(
        colourCensus()
          .filter((h) => h.term.startsWith('var(--'))
          .map((h) => h.term.slice(4, -1))
          .filter((t) => !emitted.has(t)),
      ),
    ];
    expect(strays, 'a colour names a custom property design.tokens.json does not define').toEqual(
      [],
    );
  });

  it('the swatch chart documents the palette and never invents a colour', () => {
    const chips = colourCensus().filter(swatch);
    // Guard-the-guard: twenty chips stand today. The carve-out above is the one place a hex is
    // allowed without a named licence, so it needs its own floor — a sheet that stopped writing
    // them would leave the exemption standing over nothing.
    expect(
      chips.length,
      'the swatch census found fewer than the known chips',
    ).toBeGreaterThanOrEqual(16);
    const invented = chips
      .filter((h) => !paletteHexes.has(normalizeHex(h.term)))
      .map((h) => `${h.site} → ${h.term}`);
    expect(invented, 'a design-system swatch shows a value that is not in the palette').toEqual([]);
  });

  it('every hex a mockup writes is one the census can see (reach)', () => {
    // The census reads DECLARATIONS. A hex in an SVG `fill=` attribute, a script string or a stray
    // inline handler would be a colour it never scores, so the raw text is counted too and the two
    // totals must agree. This is the reach half of the check; the licensing is above.
    const hits = colourCensus();
    for (const f of mockupNames) {
      const text = readFileSync(join(repoRoot, 'context/mockups', f), 'utf8');
      // design-system.html's BODY names every palette value in PROSE beside its token — that is
      // the page's job, and prose is not paint. Its <style> half is scanned whole, and its body's
      // actual paint (the inline chips) is scored by the swatch rule above.
      const scanned = f === 'design-system.html' ? text.slice(0, text.indexOf('</style>')) : text;
      const parts = splitOnMarkers(scanned);
      expect(parts, `context/mockups/${f}: STINT-TOKENS markers missing`).not.toBeNull();
      const outside = parts?.outside ?? '';
      // The same split styles.css gets, and for the same reason: an issue citation reads
      // `#145`, which is character-for-character a 3-digit hex, so counting comments here would
      // outlaw the citation the comment convention requires rather than a colour. Comments are
      // held to the palette ban instead — a copied scale value still cannot hide in one.
      const COMMENT = /\/\*[^]*?\*\/|<!--[^]*?-->/g;
      const raw = (outside.replace(COMMENT, ' ').match(HEX_RE) ?? []).length;
      const seen = hits.filter(
        (h) => h.surface === `context/mockups/${f}` && h.term.startsWith('#'),
      ).length;
      expect(
        raw,
        `context/mockups/${f}: ${raw} hex literals outside the markers, but only ${seen} sit in a declaration the colour census scores`,
      ).toBeLessThanOrEqual(seen);
      const quoted = (outside.match(COMMENT)?.join('\n').match(HEX_RE) ?? [])
        .map(normalizeHex)
        .filter((h) => paletteHexes.has(h));
      expect(quoted, `context/mockups/${f}: a raw palette value quoted in a comment`).toEqual([]);
    }
  });

  it('every listed licence still spends itself (the lists stay earned)', () => {
    // The mirror of the census, and the reason the table cannot rot into a permissive blob: a row
    // whose selector has stopped writing the literal it is licensed for is a licence nobody is
    // using, sitting there ready to legalise whatever reclaims the name.
    const spent = new Map<string, Set<string>>();
    for (const h of colourCensus()) {
      const written = spent.get(h.site) ?? new Set<string>();
      written.add(h.term);
      spent.set(h.site, written);
    }
    const dead = LICENSED.flatMap(([reason, term, sites]) =>
      [...sites]
        .filter((site) => !spent.get(site)?.has(term))
        .map((site) => `${site} → ${term} (${reason})`),
    );
    expect(dead, 'a colour literal is licensed for a selector that no longer writes it').toEqual(
      [],
    );
  });

  it('the tokenizer is not blind the three ways the old scan was (guard-the-guard)', () => {
    // Each line is one of issue #157's three holes, pinned on a value no surface writes so a
    // refactor that reopened one fails here rather than in a census that has quietly gone empty.
    expect(colourTerms('1px solid var(--rule)'), 'a token reference').toEqual(['var(--rule)']);
    expect(
      colourTerms('color-mix(in srgb, var(--accent) 35%, transparent)'),
      'the scan does not descend into color-mix',
    ).toEqual(['var(--accent)']);
    expect(
      colourTerms('linear-gradient(to bottom, #abc 0, var(--paper) 88%)').sort(),
      'PALETTE-blind: a literal one level down inside a gradient',
    ).toEqual(['#abc', 'var(--paper)']);
    expect(colourTerms('rebeccapurple'), 'KEYWORD-blind: a colour with no hex in it').toEqual([
      'rebeccapurple',
    ]);
    expect(
      colourTerms(`url("data:image/svg+xml,%3Csvg fill='none' stroke='%23fff'%3E%3C/svg%3E")`),
      'ENCODING-blind: a hex with its # percent-escaped inside a data URI',
    ).toEqual(['%23fff']);
    expect(
      colourTerms('drop-shadow(0 -2px 1px rgba(60,42,18,.05))'),
      'a colour inside a filter function, which no other census reads',
    ).toEqual(['rgba(60,42,18,.05)']);
    // And the other way: a length must never arrive as a colour, or the census drowns in noise and
    // gets "fixed" by loosening it.
    expect(colourTerms('0 0 0 3px var(--ring)'), 'lengths are not colours').toEqual(['var(--ring)']);
  });
});

// ---- one token, one job: canvas is a backdrop, never a surface (issue #158) -------------------
// The census above holds every colour a surface names to being a TOKEN. D04 adds the clause a
// token reference cannot satisfy by itself — "each semantic token has one job" — and §03's table
// is where the jobs are written. `canvas` (sand·5) has the narrowest of them: "Backdrop behind the
// window (docs/mockups)". A doc or a mockup draws a PICTURE of a window, and canvas is the desk
// that picture sits on. A shipped window has no desk, because it IS the window.
//
// Both shipped uses were that confusion. `body.popover` painted the tray popover — the app's whole
// periphery presence — in the backdrop token, and `html, body` did the same to the gutters beside
// the main window's 1040px column. Neither looks wrong, which is exactly why this belongs here and
// not with the JUDGE: a role violation that renders plausibly is invisible to a rendered
// comparison, and a token serving two jobs is how a token system stops meaning anything.
//
// The ban is total rather than a list with exceptions, because the role has no shipped case to
// except — the app ships no docs/mockups layer for canvas to serve. The mirror below is what keeps
// a total ban from being a quiet retirement: the mockups must still spend the token on the one job
// §03 gives it, or the role has gone dead and the ban is standing over nothing.

describe('canvas is a backdrop, never a shipped surface (design.html D04 — issue #158)', () => {
  /** What the app SHIPS: the renderer directory. The mockups are deliberately outside it — the
   *  backdrop is their job, and painting it is how they show where a Stint window sits. */
  const SHIPPED = 'packages/gui/renderer/';

  const canvasSites = (): StyledSite[] =>
    styledSites().filter((s) => /var\(\s*--canvas\b/.test(s.declarations));

  it('no shipped surface names canvas, on any selector or property', () => {
    // Guard-the-guard: an emptiness check over a census that had stopped reading the shipped half
    // would read green. The mirror below is the other half of the floor — it fails if the census
    // has gone blind altogether, so no magic total is needed here.
    expect(
      styledSites().some((s) => s.surface === 'packages/gui/renderer/styles.css'),
      'the SHIPPED renderer contributed no styled site — only the mockups were scanned',
    ).toBe(true);

    const offenders = canvasSites()
      .filter((s) => s.surface.startsWith(SHIPPED))
      .map((s) => `${s.surface}: ${s.site}`);
    expect(
      offenders,
      '§03 gives canvas ONE job: the backdrop behind a pictured window. A shipped window is paper',
    ).toEqual([]);
  });

  it('no renderer source names it outside the token block either (reach)', () => {
    // The census reads DECLARATIONS — CSS rules and `style=` attributes. A renderer script sets
    // inline styles at runtime (app.js writes calendar geometry that way), where a token name is
    // just a string in a template, so the shipped sources are read as text too. styles.css is read
    // minus its generated block, which is where the token is DECLARED and must stay: the D02
    // parity test owns those contents, and the mockups resolve the same name.
    const dir = join(repoRoot, 'packages/gui/renderer');
    const sources = readdirSync(dir).filter((f) => /\.(?:css|html|js|ts)$/.test(f));
    // Guard-the-guard: ten sources stand today (the built `dist/` is a directory, so the extension
    // filter skips it). A directory read that stopped matching would leave the filter below empty.
    expect(sources.length, 'the renderer source scan found almost nothing').toBeGreaterThanOrEqual(
      8,
    );
    const named = sources.filter((f) => {
      const text = readFileSync(join(dir, f), 'utf8');
      return (splitOnMarkers(text)?.outside ?? text).includes('--canvas');
    });
    expect(named, 'a shipped renderer source names the backdrop token').toEqual([]);
  });

  it('every mockup still paints it, so the ban closes a role and does not retire a token', () => {
    // The mirror the exception lists above all carry, in the one shape a total ban can take: the
    // ban is only honest while the token still has the job it was banned FROM the app in favour
    // of. If the mockups stopped painting canvas, `canvas` would be a token nothing spends, and
    // the right change would be to retire it from design.tokens.json rather than to keep a rule
    // about it. It is also the blindness floor for the test above — eleven body backdrops, so a
    // census that had stopped reading declarations shows up here rather than as an empty ban.
    const painted = new Set(canvasSites().map((s) => s.surface));
    const silent = mockupNames
      .map((f) => `context/mockups/${f}`)
      .filter((name) => !painted.has(name));
    expect(
      silent,
      'a mockup stopped painting the backdrop — canvas is drifting toward a token with no job',
    ).toEqual([]);
  });
});
