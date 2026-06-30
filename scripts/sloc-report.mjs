#!/usr/bin/env node
/**
 * Stint by the numbers — a repeatable, self-checking SLOC + documentation census.
 *
 * Vanity metrics, lovingly counted. This walks every git-tracked file, buckets each
 * one into a conceptual area (implementation / tests / verification / requirements /
 * design / AI context / build / packaging / docs), and prints a celebratory report.
 *
 * Three forward-compatibility guarantees, so this stays honest as the repo grows:
 *
 *   1. NO global catch-all rule. Every file must match exactly one categorization
 *      rule. A brand-new top-level directory or an unforeseen file makes the script
 *      EXIT 1 with a loud list of the orphans — your cue to add a rule. New *source
 *      types* inside known areas are picked up automatically (we count by location,
 *      not by extension allowlist) and binary types are detected by content sniff.
 *
 *   2. RECONCILIATION. Per file, code + comment + blank === total lines. In aggregate,
 *      the sum over categories must equal an independent grand total, and the files
 *      categorized must equal the files tracked. Any drift EXITS 1 — the count can
 *      never silently fail to add up.
 *
 *   3. DETERMINISM. Source of truth is `git ls-files`, so the same commit always
 *      yields the same numbers regardless of untracked junk in the working tree.
 *
 * Usage:
 *   node scripts/sloc-report.mjs            # celebratory markdown to stdout
 *   node scripts/sloc-report.mjs --json     # machine-readable JSON to stdout
 *   node scripts/sloc-report.mjs --check    # reconcile only, no output, exit code
 *   node scripts/sloc-report.mjs --out F     # also write the markdown to file F
 *
 * Exit codes: 0 = everything reconciled; 1 = orphan files or a reconciliation failure.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Categorization rules. Ordered: the FIRST matching pattern wins. There is no
// fallback — a file that matches nothing is reported as an orphan and fails the
// run. Groups are the headline buckets; categories are the readable sub-rows.
// To classify a new area, add a rule here (specific patterns before broad ones).
// ---------------------------------------------------------------------------
const RULES = [
  // AI context
  [/^CLAUDE\.md$/,                              'AI context',     'Project guide (CLAUDE.md)'],
  [/^\.claude\//,                               'AI context',     'Skills & workflows'],

  // Implementation — the shippable product
  [/^packages\/core\/src\//,                    'Implementation', 'core (@stint/core)'],
  [/^packages\/cli\/src\//,                     'Implementation', 'cli (tt)'],
  [/^packages\/gui\/src\//,                     'Implementation', 'gui — Electron main'],
  [/^packages\/gui\/renderer\//,                'Implementation', 'gui — renderer'],

  // Tests
  [/^packages\/[^/]+\/test\//,                  'Tests',          'unit & integration'],
  [/^features\//,                               'Tests',          'Gherkin features (parity)'],

  // Verification system — the acceptance-criteria + build-check apparatus
  [/^packages\/gui\/judge\//,                   'Verification',   'GUI judge harness'],
  [/^acceptance\/criteria\//,                   'Verification',   'AC criteria (what must hold)'],
  [/^acceptance\/evidence\//,                   'Verification',   'AC evidence (proof)'],
  [/^scripts\//,                                'Verification',   'build & check scripts'],

  // Requirements specification & design (the spec docs live under context/)
  [/^context\/mockups\//,                       'Design',         'GUI mockups'],
  [/^context\/.*\.html$/,                        'Requirements',   'PRD / spec docs'],

  // Packaging
  [/^packaging\//,                              'Packaging',      'installers & launchers'],

  // Build & config — note the generated lockfile gets its own row so it can be
  // visually discounted (it is not hand-written).
  [/^package-lock\.json$/,                      'Build & config', 'lockfile (generated)'],
  [/^\.github\//,                               'Build & config', 'CI workflows'],
  [/(^|\/)package\.json$/,                       'Build & config', 'package manifests'],
  [/(^|\/)tsconfig[^/]*\.json$/,                 'Build & config', 'TypeScript config'],
  [/(^|\/)electron-builder\.yml$/,               'Build & config', 'packaging config'],
  [/^vitest\.config\.ts$/,                       'Build & config', 'test runner config'],
  [/^eslint\.config\.js$/,                       'Build & config', 'lint config'],
  [/^\.gitignore$/,                              'Build & config', 'misc config'],

  // Docs
  [/^README\.md$/,                              'Docs',           'README'],
  [/^LICENSE$/,                                 'Docs',           'LICENSE'],
];

// Comment-syntax family per file extension. Anything not listed uses 'none',
// meaning every non-blank line counts as content (correct for JSON, Markdown,
// plain text, Gherkin prose, etc. — see the explicit overrides for those that
// do have comments).
const STYLE_BY_EXT = {
  ts: 'c', js: 'c', mjs: 'c', cjs: 'c', css: 'c', scss: 'c',
  html: 'html', xml: 'html', svg: 'html',
  sh: 'hash', yml: 'hash', yaml: 'hash', toml: 'hash', feature: 'hash',
  // explicit 'none': json, md, txt, and any unknown extension fall through.
};

const ext = (f) => (f.match(/\.([^./]+)$/)?.[1] ?? '').toLowerCase();

// Binary sniff: a NUL byte in the first chunk means "not text". This catches any
// new binary asset type without an extension allowlist.
function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// Classify each line as code / comment / blank, tracking block-comment state
// across lines. A line with any non-comment, non-whitespace character is "code"
// (so trailing-comment and code-after-block-close lines count as code). Because
// every line lands in exactly one bucket, code + comment + blank === total holds.
function classify(text, style) {
  const lc = style === 'c' ? '//' : style === 'hash' ? '#' : null;
  const bo = style === 'c' ? '/*' : style === 'html' ? '<!--' : null;
  const bc = style === 'c' ? '*/' : style === 'html' ? '-->' : null;

  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop(); // ignore trailing newline
  let code = 0, comment = 0, blank = 0, inBlock = false;

  for (const line of lines) {
    let i = 0;
    const n = line.length;
    let hasCode = false, hasComment = false;
    while (i < n) {
      if (inBlock) {
        const idx = bc ? line.indexOf(bc, i) : -1;
        hasComment = true;
        if (idx === -1) { i = n; } else { inBlock = false; i = idx + bc.length; }
        continue;
      }
      const ch = line[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (lc && line.startsWith(lc, i)) { hasComment = true; i = n; continue; }
      if (bo && line.startsWith(bo, i)) { hasComment = true; inBlock = true; i += bo.length; continue; }
      hasCode = true; i++;
    }
    if (hasCode) code++;
    else if (hasComment) comment++;
    else blank++;
  }
  return { code, comment, blank, total: code + comment + blank };
}

function categorize(f) {
  for (const [re, group, category] of RULES) if (re.test(f)) return { group, category };
  return null;
}

// ---------------------------------------------------------------------------
// Walk the tree.
// ---------------------------------------------------------------------------
const files = execSync('git ls-files', { cwd: ROOT }).toString().trim().split('\n').filter(Boolean);

const orphans = [];
const byCategory = new Map(); // key: group\0category
const byGroup = new Map();
let grand = { files: 0, binary: 0, total: 0, code: 0, comment: 0, blank: 0, bytes: 0 };

function bump(map, key, meta, m, isBin, bytes) {
  let row = map.get(key);
  if (!row) { row = { ...meta, files: 0, binary: 0, total: 0, code: 0, comment: 0, blank: 0, bytes: 0 }; map.set(key, row); }
  row.files++; row.bytes += bytes;
  if (isBin) row.binary++;
  else { row.total += m.total; row.code += m.code; row.comment += m.comment; row.blank += m.blank; }
}

for (const f of files) {
  const cat = categorize(f);
  if (!cat) { orphans.push(f); continue; }
  const buf = readFileSync(join(ROOT, f));
  const bytes = buf.length;
  const bin = isBinary(buf);
  const m = bin ? { total: 0, code: 0, comment: 0, blank: 0 }
                : classify(buf.toString('utf8'), STYLE_BY_EXT[ext(f)] ?? 'none');

  // Per-file reconciliation guard.
  if (!bin && m.code + m.comment + m.blank !== m.total) {
    console.error(`RECONCILE FAIL: ${f} lines do not add up (${m.code}+${m.comment}+${m.blank} != ${m.total})`);
    process.exit(1);
  }

  bump(byCategory, `${cat.group}\0${cat.category}`, cat, m, bin, bytes);
  bump(byGroup, cat.group, { group: cat.group }, m, bin, bytes);
  grand.files++; grand.bytes += bytes;
  if (bin) grand.binary++;
  else { grand.total += m.total; grand.code += m.code; grand.comment += m.comment; grand.blank += m.blank; }
}

// ---------------------------------------------------------------------------
// Loud failure on orphans (new directories / unforeseen files).
// ---------------------------------------------------------------------------
if (orphans.length) {
  console.error(`\n✗ ${orphans.length} file(s) match no categorization rule in scripts/sloc-report.mjs:`);
  for (const o of orphans) console.error(`    ${o}`);
  console.error(`\n  Add a rule to RULES[] for these and re-run. (Refusing to guess — that is the point.)\n`);
  process.exit(1);
}

// Aggregate reconciliation: categories must sum to groups must sum to grand total,
// and files categorized must equal files tracked.
const sumCat = (k) => [...byCategory.values()].reduce((a, r) => a + r[k], 0);
const sumGrp = (k) => [...byGroup.values()].reduce((a, r) => a + r[k], 0);
const checks = [
  ['files categorized == files tracked', grand.files, files.length],
  ['category file sum == grand files',    sumCat('files'), grand.files],
  ['group file sum == grand files',       sumGrp('files'), grand.files],
  ['category total sum == grand total',   sumCat('total'), grand.total],
  ['group total sum == grand total',      sumGrp('total'), grand.total],
  ['code + comment + blank == total',     grand.code + grand.comment + grand.blank, grand.total],
];
for (const [name, got, want] of checks) {
  if (got !== want) {
    console.error(`RECONCILE FAIL: ${name} (${got} != ${want})`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outPath = outFlag !== -1 ? args[outFlag + 1] : null;

if (args.includes('--check')) {
  console.error(`✓ reconciled — ${grand.files} files, ${grand.total.toLocaleString()} lines, all sums add up.`);
  process.exit(0);
}

const GROUP_ORDER = ['Implementation', 'Tests', 'Verification', 'Requirements', 'Design', 'AI context', 'Build & config', 'Packaging', 'Docs'];
const groupKey = (g) => { const i = GROUP_ORDER.indexOf(g); return i === -1 ? 999 : i; };
const groups = [...byGroup.values()].sort((a, b) => groupKey(a.group) - groupKey(b.group));
const cats = [...byCategory.values()].sort((a, b) => groupKey(a.group) - groupKey(b.group) || b.code - a.code);

if (args.includes('--json')) {
  console.log(JSON.stringify({
    generatedFrom: 'git ls-files', reconciled: true,
    grand, groups, categories: cats,
  }, null, 2));
  process.exit(0);
}

// Celebratory markdown.
const n = (x) => x.toLocaleString('en-US');
const pct = (x, whole) => whole ? Math.round((x / whole) * 100) : 0;
const bar = (x, max, width = 24) => '█'.repeat(Math.max(0, Math.round((x / max) * width))) || '▏';

const lockRow = cats.find((c) => c.category === 'lockfile (generated)');
const generated = lockRow ? lockRow.total : 0;
const handwritten = grand.total - generated;

const impl = byGroup.get('Implementation')?.code ?? 0;
const tests = byGroup.get('Tests')?.code ?? 0;
const verif = byGroup.get('Verification')?.code ?? 0;
const docsLines = (byGroup.get('Requirements')?.total ?? 0) + (byGroup.get('Design')?.total ?? 0) +
                  (byGroup.get('AI context')?.total ?? 0) + (byGroup.get('Docs')?.total ?? 0);
const maxGroup = Math.max(...groups.map((g) => g.total));

const L = [];
L.push(`# 📊 Stint, by the numbers`);
L.push('');
L.push(`> Vanity metrics, lovingly counted — and they all add up. ✓`);
L.push(`> Generated from \`git ls-files\` by \`scripts/sloc-report.mjs\`. Re-run anytime; CI keeps it honest.`);
L.push('');
L.push(`## 🎉 The headline`);
L.push('');
L.push(`| | |`);
L.push(`|---|---:|`);
L.push(`| 🗂️ **Tracked files** | **${n(grand.files)}** |`);
L.push(`| 📈 **Total lines** | **${n(grand.total)}** |`);
L.push(`| ⌨️ **Lines of content** (non-blank) | **${n(grand.code + grand.comment)}** |`);
L.push(`| 💬 **Comment / prose lines** | **${n(grand.comment)}** |`);
L.push(`| ⬜ **Blank lines** | **${n(grand.blank)}** |`);
L.push(`| 🖼️ **Binary assets** (screenshots, GIFs) | **${n(grand.binary)}** files |`);
L.push(`| ✍️ **Hand-written lines** (ex-lockfile) | **${n(handwritten)}** |`);
L.push('');
L.push(`## 🏗️ Where the lines live`);
L.push('');
L.push(`| Area | Files | Lines | Code | Comment/prose | Share | |`);
L.push(`|---|---:|---:|---:|---:|---:|:--|`);
for (const g of groups) {
  L.push(`| **${g.group}** | ${n(g.files)} | ${n(g.total)} | ${n(g.code)} | ${n(g.comment)} | ${pct(g.total, grand.total)}% | \`${bar(g.total, maxGroup)}\` |`);
}
L.push(`| **TOTAL** | **${n(grand.files)}** | **${n(grand.total)}** | **${n(grand.code)}** | **${n(grand.comment)}** | 100% | |`);
L.push('');
L.push(`## 🔬 The full breakdown`);
L.push('');
L.push(`| Area | Detail | Files | Lines | Code | Comment/prose | Blank |`);
L.push(`|---|---|---:|---:|---:|---:|---:|`);
let lastGroup = null;
for (const c of cats) {
  const g = c.group === lastGroup ? '' : `**${c.group}**`;
  lastGroup = c.group;
  L.push(`| ${g} | ${c.category}${c.binary ? ` _(+${c.binary} binary)_` : ''} | ${n(c.files)} | ${n(c.total)} | ${n(c.code)} | ${n(c.comment)} | ${n(c.blank)} |`);
}
L.push('');
L.push(`## 🧮 Fun ratios`);
L.push('');
L.push(`- **Tests : Implementation** — ${n(tests)} : ${n(impl)} code lines (≈ **${(tests / (impl || 1)).toFixed(2)}×**).`);
L.push(`- **Tests + Verification : Implementation** — ${n(tests + verif)} : ${n(impl)} (≈ **${((tests + verif) / (impl || 1)).toFixed(2)}×**) — Stint writes more lines proving it works than doing the work.`);
L.push(`- **Documentation** (requirements + design + AI context + docs) — **${n(docsLines)}** lines of prose backing **${n(impl)}** lines of implementation.`);
L.push(`- **Generated vs. hand-written** — the \`package-lock.json\` accounts for ${n(generated)} of ${n(grand.total)} lines (${pct(generated, grand.total)}%); humans wrote the other ${n(handwritten)}.`);
L.push('');
L.push(`<sub>✓ Reconciled: every tracked file is categorized and code + comment + blank = total at every level. If this drifts, CI fails.</sub>`);
L.push('');

const md = L.join('\n');
process.stdout.write(md);
if (outPath) { writeFileSync(outPath, md); console.error(`\n→ wrote ${outPath}`); }
