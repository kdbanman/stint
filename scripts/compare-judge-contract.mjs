#!/usr/bin/env node
/**
 * R08 drift gate over the judge report's scored contract.
 *
 * `npm run judge` regenerates acceptance/evidence/judge-report.json in place. This compares
 * the regenerated file against the committed one (HEAD) on each result's scored contract —
 * { item, pass, facts } — the deterministic projection: machine-checked booleans pinned to
 * the fixture clock. A flipped verdict, a vanished/renamed/added fact, a missing, extra, or
 * reordered scene record all fail loud.
 *
 * `justification` (and the screenshot name beside it) stays committed and reviewable but is
 * not gated: justifications dump raw measurements as reviewer evidence, and those absolutes
 * move with the runner image's font stack. The why lives in context/process.html §02 (R08).
 *
 * Usage: node scripts/compare-judge-contract.mjs   (repo root, after `npm run judge`)
 * Exit 0: scored contracts identical. Exit 1: contract drift, every difference listed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPORT = 'acceptance/evidence/judge-report.json';

const parse = (label, text) => {
  const report = JSON.parse(text);
  if (!Array.isArray(report.results)) throw new Error(`${label} ${REPORT} has no results array`);
  return report.results.map(({ item, pass, facts }) => ({ item, pass, facts: facts ?? null }));
};

const committed = parse('committed', execFileSync('git', ['show', `HEAD:${REPORT}`], { encoding: 'utf8' }));
const regenerated = parse('regenerated', readFileSync(REPORT, 'utf8'));

const drift = [];

// Scene records first: results are emitted in scene-registry order, so the item sequence is
// itself deterministic — a missing, extra, or reordered record is contract drift.
const cItems = committed.map((r) => r.item);
const rItems = regenerated.map((r) => r.item);
if (cItems.join('\n') !== rItems.join('\n')) {
  const cSet = new Set(cItems);
  const rSet = new Set(rItems);
  for (const item of cSet) if (!rSet.has(item)) drift.push(`scene record vanished: ${item}`);
  for (const item of rSet) if (!cSet.has(item)) drift.push(`scene record appeared: ${item}`);
  if (!drift.length) drift.push(`scene records reordered or recounted: [${cItems}] -> [${rItems}]`);
} else {
  for (let i = 0; i < committed.length; i++) {
    const c = committed[i];
    const r = regenerated[i];
    const at = `${c.item}[${i}]`;
    if (c.pass !== r.pass) drift.push(`${at}: pass ${c.pass} -> ${r.pass}`);
    const cFacts = c.facts ?? {};
    const rFacts = r.facts ?? {};
    for (const name of Object.keys(cFacts)) {
      if (!(name in rFacts)) drift.push(`${at}: fact vanished: ${name}`);
      else if (cFacts[name] !== rFacts[name]) drift.push(`${at}: fact ${name} ${cFacts[name]} -> ${rFacts[name]}`);
    }
    for (const name of Object.keys(rFacts)) {
      if (!(name in cFacts)) drift.push(`${at}: fact appeared: ${name}`);
    }
  }
}

if (drift.length) {
  console.error(`judge-report scored contract drift — regenerated report disagrees with the committed ${REPORT}:`);
  for (const line of drift) console.error(`  ${line}`);
  console.error('The committed report must match what the code produces: re-run `npm run judge` and commit the result.');
  process.exit(1);
}
console.log(`judge-report scored contract identical: ${committed.length} scene records, committed vs regenerated.`);
