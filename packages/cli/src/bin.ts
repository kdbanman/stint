#!/usr/bin/env node
/**
 * tt — entrypoint. Wires real dependencies, runs the program, and maps errors to
 * clean exit codes (PRD §11). The database path resolves to TT_DB or the per-OS
 * default; TT_NOW (ISO) pins the clock for reproducible runs and the golden suite.
 */
import { CommanderError } from 'commander';
import { Store, StoreError, TimeParseError } from '@stint/core';
import { buildProgram, CliError, type Io } from './program.js';

// node:sqlite is a stability-experimental module; silence only that warning so
// stdout/stderr stay clean and golden-comparable.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/.test(w.message)) return;
  process.emitWarning(w);
});

function clock(): Date {
  const pinned = process.env.TT_NOW;
  if (pinned && pinned.trim() !== '') {
    const d = new Date(pinned);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export async function run(argv: string[], io: Io): Promise<number> {
  const program = buildProgram({
    openStore: () => Store.open({ clock }),
    now: clock,
    io,
  });
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      // commander already wrote help/usage via configureOutput.
      if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') return 0;
      return err.exitCode || 2;
    }
    if (err instanceof CliError) {
      io.err(err.message);
      return err.exitCode;
    }
    if (err instanceof StoreError || err instanceof TimeParseError) {
      io.err(err.message);
      return 2;
    }
    io.err(`error: ${(err as Error).message}`);
    return 1;
  }
}

const io: Io = {
  out: (s) => process.stdout.write(s + '\n'),
  err: (s) => process.stderr.write(s + '\n'),
};

run(process.argv.slice(2), io).then((code) => {
  process.exitCode = code;
});
