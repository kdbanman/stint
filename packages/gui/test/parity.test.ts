/**
 * GOLD — full-parity matrix (PRD §17 R8; acceptance.html §05 "On parity").
 *
 * Parity is a coverage claim, in BOTH directions. This binds the sources and asserts
 * them consistent:
 *   1. the GUI capability set = the IPC channels the renderer can invoke,
 *   2. the parity matrix maps each to a tt command path,
 *   3. every mapped tt command actually exists in the built CLI program,
 *   4. and — the other direction — every distinct tt capability (leaf command) is
 *      covered by some matrix row, so nothing tt can do is unreachable from the GUI,
 *      modulo an explicit GUI-absent allow-set (pure read surfaces folded into a view).
 * If a GUI capability is added without a tt equivalent — OR a tt capability is added
 * with no GUI parity-matrix row and no GUI-absent exemption — this fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { CHANNELS } from '../src/ipc.js';
import { buildProgram } from '../../cli/src/program.js';

const matrix = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../acceptance/parity-matrix.json', import.meta.url)), 'utf8'),
) as { capabilities: { gui: string; tt: string[] }[] };

/**
 * The leaf tt command paths a user actually invokes — every command that has no
 * sub-commands of its own (e.g. "client add", "config set", "start"). A parent group
 * like "client" or "config" is not itself a capability — only its leaves are — so the
 * walk records a path only when the command has no children. Aliases are folded onto
 * their canonical leaf (see CANONICAL below) so they are not double-counted as distinct
 * capabilities.
 */
function leafCommandPaths(): Set<string> {
  const program = buildProgram({
    openStore: () => ({}) as never,
    now: () => new Date(),
    io: { out: () => {}, err: () => {} },
  });
  const leaves = new Set<string>();
  const walk = (cmd: Command, prefix: string) => {
    for (const sub of cmd.commands) {
      const path = prefix ? `${prefix} ${sub.name()}` : sub.name();
      if (sub.commands.length === 0) leaves.add(path);
      walk(sub, path);
    }
  };
  walk(program, '');
  return leaves;
}

/** Every command path (leaves AND aliases), for the "the mapping exists" assertion. */
function allCommandPaths(): Set<string> {
  const program = buildProgram({
    openStore: () => ({}) as never,
    now: () => new Date(),
    io: { out: () => {}, err: () => {} },
  });
  const paths = new Set<string>();
  const walk = (cmd: Command, prefix: string) => {
    for (const sub of cmd.commands) {
      const path = prefix ? `${prefix} ${sub.name()}` : sub.name();
      paths.add(path);
      for (const a of sub.aliases()) paths.add(prefix ? `${prefix} ${a}` : a);
      walk(sub, path);
    }
  };
  walk(program, '');
  return paths;
}

/**
 * Alias → canonical leaf, so an alias (e.g. `switch` for `start`, `ls` for `list`) is
 * counted as the same capability as the command it aliases, not a second one. Folding
 * these keeps the bidirectional reach assertion exact (one row per real capability).
 */
const CANONICAL: Record<string, string> = {
  switch: 'start',
  ls: 'list',
};

/**
 * tt leaf capabilities intentionally NOT reachable from the GUI — the allow-set the
 * bidirectional assertion subtracts so it stays EXACT, not loose. These are pure
 * read/inspection surfaces with no distinct GUI affordance of their own (the GUI either
 * folds them into a richer view or never needs them):
 *  - `status`  — the GUI's always-on Active-Timer card IS the status read (getState),
 *                not a separate command; covered by getState's ["status","list"] mapping.
 *  - `sleep ls`— the sleep-flagged set is surfaced inline on the affected rows (the §10
 *                flag + one-tap subtract), not as a standalone list view; the actionable
 *                capability (subtract) maps to the subtractSleep channel.
 */
const GUI_ABSENT_TT = new Set<string>(['status', 'sleep ls']);

describe('parity matrix (§17 R8)', () => {
  const paths = allCommandPaths();

  it('every GUI capability (IPC channel) is in the parity matrix', () => {
    const mapped = new Set(matrix.capabilities.map((c) => c.gui));
    // getState/toggle aside, every action channel must be present.
    for (const ch of CHANNELS) {
      expect(mapped.has(ch)).toBe(true);
    }
  });

  it('the matrix introduces no GUI capability that does not exist as a channel', () => {
    const channels = new Set<string>(CHANNELS);
    for (const cap of matrix.capabilities) {
      expect(channels.has(cap.gui)).toBe(true);
    }
  });

  it('every mapped tt command exists in the built CLI program', () => {
    for (const cap of matrix.capabilities) {
      for (const cmd of cap.tt) {
        expect(paths.has(cmd), `tt "${cmd}" (for GUI "${cap.gui}") should exist`).toBe(true);
      }
    }
  });

  // The BIDIRECTIONAL direction R8 ultimately claims (prd.html §17 R8): not only is every
  // GUI capability reachable from tt (the three assertions above), but every tt capability
  // is reachable from the GUI — no tt command is a dead end the §12 views cannot reach. We
  // enumerate the leaf tt capabilities (folding aliases onto their canonical command) and
  // assert each is covered by SOME parity-matrix row, modulo the explicit GUI_ABSENT_TT
  // allow-set (pure read surfaces folded into a richer view). The allow-set makes this EXACT:
  // a new tt command that no view wires — and is not deliberately listed as GUI-absent —
  // fails here, the same way an unbacked GUI channel fails the forward direction.
  it('every distinct tt capability is reachable from some GUI channel (bidirectional)', () => {
    // The set of tt leaf paths every matrix row maps to (its target capabilities).
    const covered = new Set<string>();
    for (const cap of matrix.capabilities) {
      for (const cmd of cap.tt) covered.add(CANONICAL[cmd] ?? cmd);
    }
    const uncovered: string[] = [];
    for (const leaf of leafCommandPaths()) {
      const canonical = CANONICAL[leaf] ?? leaf;
      if (GUI_ABSENT_TT.has(canonical)) continue; // deliberately GUI-absent (allow-set)
      if (!covered.has(canonical)) uncovered.push(leaf);
    }
    expect(
      uncovered,
      `tt capabilities with no GUI parity-matrix row (add a channel + row, or list as ` +
        `GUI-absent): ${uncovered.join(', ') || 'none'}`,
    ).toEqual([]);
  });

  // The allow-set stays honest: every GUI_ABSENT_TT entry must name a tt leaf that really
  // exists (no stale exemption that silently widens the bidirectional assertion).
  it('the GUI-absent allow-set lists only real tt leaf capabilities', () => {
    const leaves = leafCommandPaths();
    for (const leaf of GUI_ABSENT_TT) {
      expect(leaves.has(leaf), `GUI_ABSENT_TT "${leaf}" should be a real tt leaf`).toBe(true);
    }
  });
});
