/**
 * GOLD — full-parity matrix (PRD §17 R8; acceptance.html §05 "On parity").
 *
 * Parity is a coverage claim: every GUI capability must be reachable from tt. This
 * binds the three sources together and asserts them consistent:
 *   1. the GUI capability set = the IPC channels the renderer can invoke,
 *   2. the parity matrix maps each to a tt command path,
 *   3. every mapped tt command actually exists in the built CLI program.
 * If a GUI capability is added without a tt equivalent, this fails.
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

/** All command paths (e.g. "client add") in the CLI program. */
function commandPaths(): Set<string> {
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

describe('parity matrix (§17 R8)', () => {
  const paths = commandPaths();

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
});
