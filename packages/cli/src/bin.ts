#!/usr/bin/env node
/**
 * tt — entrypoint. Wires real dependencies, runs the program, and maps errors to
 * clean exit codes (PRD §11). The database path resolves to TT_DB or the per-OS
 * default; TT_NOW (ISO) pins the clock for reproducible runs and the golden suite.
 */
import { CommanderError } from 'commander';
import { ConfigError, StoragePathError, Store, StoreError, TimeParseError } from '@stint/core';
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

/** Optional busy-timeout override (ms) for the SQLite write lock; default is 5000. */
function busyTimeoutMs(): number | undefined {
  const raw = process.env.TT_BUSY_TIMEOUT_MS;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function run(argv: string[], io: Io): Promise<number> {
  const timeout = busyTimeoutMs();
  const program = buildProgram({
    openStore: () => Store.open(timeout !== undefined ? { clock, busyTimeoutMs: timeout } : { clock }),
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
    // §20 R10/R11 — a launch refusal (untrusted config file, broken configured database
    // path) exits non-zero with the core message, which already names the file/path and
    // the error; nothing was opened or written. Mapped here like every other error type
    // (one mapper, engineering.html §04).
    if (
      err instanceof StoreError ||
      err instanceof TimeParseError ||
      err instanceof ConfigError ||
      err instanceof StoragePathError
    ) {
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
