/**
 * scripts/gen-tokens.mjs — the design-token generator (design.html D01/D02, transition PR #132).
 *
 * Reads context/design.tokens.json (W3C DTCG: Radix primitive scales + a semantic alias layer)
 * and writes the one CSS custom-property block between the STINT-TOKENS markers in every
 * context/mockups/*.html and in packages/gui/renderer/styles.css. The markers are the contract:
 * hand-editing inside them is a defect (D02), and a target file WITHOUT markers is an error, not
 * a seeding opportunity — where the block sits in a file is a reviewed, one-time decision the
 * generator refuses to guess. packages/gui/test/design-guard.test.ts imports emitTokenBlock and
 * asserts every target's block matches this emitter byte-for-byte (protect the guard).
 */
import { readFileSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const START_MARKER =
  '/* STINT-TOKENS start — generated from context/design.tokens.json; do not edit by hand */';
export const END_MARKER = '/* STINT-TOKENS end */';

/* Every emitted line groups declarations by the primitive scale its tokens alias, at most five
   per line — sand's ten semantic steps split into the surfaces line and the ink-ramp line, and
   each signal family (tomato/grass/amber/red) reads as one line. */
const MAX_DECLS_PER_LINE = 5;

/** Resolve a DTCG alias like `{color.sand.1}` against the token tree; literals pass through. */
const resolveValue = (tokens, value) => {
  const ref = /^\{([^}]+)\}$/.exec(value);
  if (!ref) return value;
  let node = tokens;
  for (const key of ref[1].split('.')) node = node[key];
  return node.$value;
};

/** A font stack serializes with quotes only around names containing whitespace. */
const fontStack = (names) => names.map((n) => (/\s/.test(n) ? `"${n}"` : n)).join(',');

/**
 * The pure emitter: tokens object in, full marked block out (start marker line through end
 * marker line, no trailing newline). The guard test compares this against each target file's
 * marker span, so emission format IS the parity contract.
 */
export function emitTokenBlock(tokens) {
  const lines = [];

  // semantic colours, grouped by the scale each aliases, in tokens-file order
  const groups = [];
  for (const [name, def] of Object.entries(tokens.semantic)) {
    if (name.startsWith('$')) continue;
    const scale = /^\{color\.([a-z]+)\./.exec(def.$value)[1];
    if (!groups.length || groups[groups.length - 1].scale !== scale) groups.push({ scale, decls: [] });
    groups[groups.length - 1].decls.push(`--${name}:${resolveValue(tokens, def.$value)}`);
  }
  for (const group of groups) {
    for (let i = 0; i < group.decls.length; i += MAX_DECLS_PER_LINE) {
      lines.push(`  ${group.decls.slice(i, i + MAX_DECLS_PER_LINE).join(';')};`);
    }
  }

  // the radius trio — control/card/surface are the spec names (design.html D08); r1/r2/r3 the
  // CSS names every surface already speaks
  const r = tokens.radius;
  lines.push(
    `  --r1:${r.control.$value};--r2:${r.card.$value};--r3:${r.surface.$value};`,
  );

  // the focus ring is SYNTHESIZED: tokens.json carries no ring entry because the ring is not a
  // colour of its own — it is the accent at a fixed 35% mix (design.html D13), so the recipe
  // lives here, beside the only place it becomes CSS
  lines.push('  --ring:0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);');

  // the elevation ladder, one shadow per line, tokens-file order (card → raised → pop → modal → win)
  for (const [name, def] of Object.entries(tokens.shadow)) {
    if (name.startsWith('$')) continue;
    lines.push(`  --sh-${name}:${def.$value};`);
  }

  // font stacks (font.sans/font.num → --sans/--num); space.base is deliberately NOT emitted —
  // the 4px grid is a rule about the values surfaces write, not a value they reference
  lines.push(`  --sans:${fontStack(tokens.font.sans.$value)};`);
  lines.push(`  --num:${fontStack(tokens.font.num.$value)};`);

  return [START_MARKER, ':root{', ...lines, '}', END_MARKER].join('\n');
}

/** Replace the marker-delimited span in a file's text; null when the file has no markers. */
export function applyTokenBlock(text, block) {
  const start = text.indexOf('/* STINT-TOKENS start');
  const endTag = text.indexOf(END_MARKER);
  if (start === -1 || endTag === -1 || endTag < start) return null;
  return text.slice(0, start) + block + text.slice(endTag + END_MARKER.length);
}

const main = () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const tokens = JSON.parse(readFileSync(join(repoRoot, 'context/design.tokens.json'), 'utf8'));
  const block = emitTokenBlock(tokens);

  const mockupsDir = join(repoRoot, 'context/mockups');
  const targets = [
    ...readdirSync(mockupsDir)
      .filter((f) => f.endsWith('.html'))
      .sort()
      .map((f) => join('context/mockups', f)),
    join('packages/gui/renderer/styles.css'),
  ];

  let failed = false;
  for (const rel of targets) {
    const path = join(repoRoot, rel);
    const text = readFileSync(path, 'utf8');
    const next = applyTokenBlock(text, block);
    if (next === null) {
      console.error(`${rel}: no STINT-TOKENS markers — refusing to guess placement`);
      failed = true;
    } else if (next !== text) {
      writeFileSync(path, next);
      console.log(`${rel}: updated`);
    } else {
      console.log(`${rel}: up to date`);
    }
  }
  if (failed) process.exitCode = 1;
};

// Run the writer only when invoked as a script — the guard test imports the emitter and must
// never trigger a tree write.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
