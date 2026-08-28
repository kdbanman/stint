#!/usr/bin/env node
/**
 * When-group census — the one-behavior-per-scenario gate (engineering.html §08, #356).
 *
 * Every Gherkin scenario runs twice (core + tt), so a scenario bundling several
 * When→Then pairs hides that many behaviors behind one line of red. This census
 * counts When GROUPS per scenario — a `When` keyword starts a group; `And`/`But`
 * steps riding it continue the same group and do not count — and fails CI on any
 * scenario with more than one group that is not enrolled in
 * features/when-groups.allowlist (one line per keeper: file :: scenario name ::
 * justification). Enrollment is for scenarios that pass §08's deletion test —
 * the composition IS the claim. The rule and the test live in engineering.html
 * §08; this script only holds the line.
 *
 * A stale allowlist line (naming a scenario that no longer exists, or one that
 * is now single-group) also fails, so the enrollment can never outlive its
 * justification.
 *
 * Usage: node scripts/check-when-groups.mjs
 * Exit codes: 0 = every multi-When-group scenario is enrolled; 1 = violations.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEATURES_DIR = join(ROOT, 'features');
const ALLOWLIST_PATH = join(ROOT, 'features', 'when-groups.allowlist');

/**
 * Parse one .feature file into [{ name, line, whenGroups }] — one row per
 * Scenario / Scenario Outline. Only `When` keyword lines open a group;
 * `And`/`But` continue whatever step preceded them. Background is not a
 * scenario and is not counted.
 */
export function scenarioWhenGroups(text) {
  const rows = [];
  let current = null;
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    const m = line.match(/^(?:Scenario|Scenario Outline):\s*(.*)$/);
    if (m) {
      current = { name: m[1].trim(), line: i + 1, whenGroups: 0 };
      rows.push(current);
      return;
    }
    // A new Background/Rule block ends any open scenario.
    if (/^(?:Background|Rule):/.test(line)) current = null;
    if (current && /^When\s/.test(line)) current.whenGroups++;
  });
  return rows;
}

/** Parse the allowlist: `file :: scenario name :: justification`, one per line. */
export function parseAllowlist(text) {
  const entries = [];
  const errors = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const parts = line.split('::').map((s) => s.trim());
    if (parts.length !== 3 || parts.some((p) => p === '')) {
      errors.push(`when-groups.allowlist:${i + 1}: expected "file :: scenario name :: justification", got "${line}"`);
      return;
    }
    entries.push({ file: parts[0], name: parts[1], justification: parts[2], line: i + 1 });
  });
  return { entries, errors };
}

export function census() {
  const problems = [];

  const featureFiles = readdirSync(FEATURES_DIR).filter((f) => f.endsWith('.feature')).sort();
  const { entries, errors } = parseAllowlist(readFileSync(ALLOWLIST_PATH, 'utf8'));
  problems.push(...errors);

  const enrolled = new Map(entries.map((e) => [`${e.file}\0${e.name}`, e]));
  const used = new Set();

  for (const file of featureFiles) {
    for (const s of scenarioWhenGroups(readFileSync(join(FEATURES_DIR, file), 'utf8'))) {
      const key = `${file}\0${s.name}`;
      if (s.whenGroups > 1) {
        if (enrolled.has(key)) used.add(key);
        else {
          problems.push(
            `features/${file}:${s.line}: "${s.name}" has ${s.whenGroups} When groups — ` +
              `split it (engineering.html §08), or if it passes the deletion test, enroll it in features/when-groups.allowlist`,
          );
        }
      }
    }
  }

  // Stale enrollment: an allowlist line whose scenario is gone or single-group.
  for (const e of entries) {
    if (!used.has(`${e.file}\0${e.name}`)) {
      problems.push(
        `when-groups.allowlist:${e.line}: "${e.name}" in ${e.file} is not a multi-When-group scenario — remove the stale line`,
      );
    }
  }

  return problems;
}

// Run as a CLI when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = census();
  if (problems.length > 0) {
    console.error(`when-group census FAILED — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('when-group census passed: every scenario states one behavior, or is enrolled with a justification.');
}
