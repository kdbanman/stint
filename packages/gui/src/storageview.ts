/**
 * Storage-paths projections + the launch-refusal decision logic (PRD §12 R25/R26, §20
 * R10/R11/R14) — Electron-free so it is unit-testable (the GOLD half of the native
 * launch-refusal dialog, whose chrome itself has no headless host and stays under the
 * MANUAL runbook's CHECK STORAGE CHANGE).
 *
 * Three jobs:
 *   1. `buildStoragePathsView` — the `getStoragePaths` IPC read (§12 R25): the three
 *      effective paths + sources through core's ONE resolver (so the Settings Storage
 *      group can never disagree with `tt paths`), the default-rung targets the
 *      Reset-to-default flow aims at, and the §20 R14 backup-directory probe.
 *   2. `launchRefusal` — maps the two typed launch errors (§20 R10 ConfigError, §20 R11
 *      StoragePathError) to the native dialog's copy: title + detail naming the file and
 *      the error (R10) or the configured path AND the config file (R11), plus the reset
 *      action behind the dialog's Reset-to-default button. Any other error returns null
 *      and stays exactly as loud as before.
 *   3. `storageChangeFailure` — the §12 R26 in-dialog refusal filter: a typed
 *      StorageChangeError/ConfigError from a change pipeline becomes the message the
 *      dialog renders (§12 R21's inline grammar); anything else is not a refusal and
 *      keeps propagating.
 */
import { readFileSync, renameSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  CONFIG_KEYS,
  ConfigError,
  DB_FILENAME,
  StorageChangeError,
  StoragePathError,
  defaultDataDir,
  resetConfigKey,
  resolveStoragePaths,
  writeConfig,
  type BackupDirState,
  type StintConfig,
  type StoragePaths,
} from '@stint/core';
import type { StoragePathsView } from './ipc.js';

/**
 * §12 R25 — resolve the three effective paths for the Settings Storage group, through the
 * SAME core resolver `tt paths` prints from (one resolver, so the two surfaces can never
 * disagree — §13). `backupDirStatus` is injected (the live Store's probe) so the §20 R14
 * error state reflects the directory the app is actually backing up into.
 */
export function buildStoragePathsView(
  env: NodeJS.ProcessEnv,
  userDataDir: string | undefined,
  backupDirStatus: BackupDirState,
): StoragePathsView {
  const paths: StoragePaths = resolveStoragePaths(env, userDataDir);
  return {
    db: { path: paths.db.path, source: paths.db.source },
    backupDir: { path: paths.backupDir.path, source: paths.backupDir.source },
    configFile: { path: paths.configFile.path, source: paths.configFile.source },
    defaults: {
      // The database's default rung: the GUI's userData directory when Electron supplies
      // one, else the per-OS data dir — exactly the rung resolveStoragePaths falls to.
      dbPath: join(userDataDir ?? defaultDataDir(env), DB_FILENAME),
      // The backup default rung is "beside the resolved database" (§13).
      backupDir: dirname(paths.db.path),
    },
    backupDirState: { ok: backupDirStatus.ok, problem: backupDirStatus.problem },
  };
}

/** What the native §20 R10/R11 launch-refusal dialog shows and does (the R05 convention). */
export interface LaunchRefusal {
  title: string;
  /** Names the config file and the error (R10) / the configured path AND the config file (R11). */
  detail: string;
  /**
   * The Reset-to-default action: delete the offending key(s) — §13's reset semantics — so a
   * relaunch resolves the default rung. Never destroys user bytes: an unparseable file (whose
   * keys cannot be reached) is set ASIDE to a timestamped sibling, not deleted.
   */
  reset: () => void;
}

/**
 * §20 R10/R11 — map a launch-time open failure to the native Reset-to-default / Quit dialog,
 * or null for every other error (which then stays exactly as loud as before — the
 * schemaSkewRefusal pattern). Both branches never guess a fallback path: the reset is the
 * USER's explicit choice in the dialog, and it commits by deleting the offending key.
 */
export function launchRefusal(err: unknown): LaunchRefusal | null {
  if (err instanceof ConfigError) {
    return {
      title: 'Stint cannot trust its config file',
      // ConfigError's message already names the file and the exact violation (§20 R10's
      // done-when); the remedy line names both choices the dialog offers.
      detail:
        `${err.message}\n\nNothing was opened and nothing was written. ` +
        `Reset to default removes the broken configuration (your data files are not touched) ` +
        `and relaunches; Quit leaves everything as it is so you can edit the file yourself.`,
      reset: () => resetUntrustedConfig(err.file),
    };
  }
  if (err instanceof StoragePathError) {
    return {
      title: 'Stint cannot open the configured database',
      // StoragePathError's message names the configured path AND the config file that set it
      // (§20 R11's done-when: no auto-mkdir, never a silent fallback).
      detail:
        `${err.message}\n\nNothing was created and no fallback database was opened. ` +
        `Reset to default deletes the dbPath key from ${err.configFile} (the §13 reset — ` +
        `your data files are not touched) and relaunches onto the default location; ` +
        `Quit leaves everything as it is.`,
      reset: () => resetConfigKey(err.configFile, 'dbPath'),
    };
  }
  return null;
}

/**
 * §20 R10 reset — repair an UNTRUSTED config file by §13's reset semantics: delete the
 * offending key(s), keep every valid one, commit through core's atomic write. A file that
 * cannot even be parsed (invalid JSON, unreadable, not an object) has no reachable keys, so
 * it is set ASIDE to a timestamped `.invalid-*` sibling — the §13 absent-file state IS the
 * fully-reset config, and the user's bytes survive for inspection (never destroyed).
 */
export function resetUntrustedConfig(file: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    setAsideInvalid(file);
    return;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    setAsideInvalid(file);
    return;
  }
  // Keep exactly the entries readConfig would accept; every offending one is the reset's
  // delete-the-key. writeConfig re-validates, so this can never write an untrusted file.
  const repaired: StintConfig = {};
  for (const key of CONFIG_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === 'string' && isAbsolute(value)) repaired[key] = value;
  }
  writeConfig(file, repaired);
}

/** Move an unparseable config aside (never delete user bytes) so a relaunch starts reset. */
function setAsideInvalid(file: string): void {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  renameSync(file, `${file}.invalid-${stamp}`);
}

/**
 * §12 R26 — a change-pipeline refusal the dialog renders in place, or null for an
 * unexpected error (which keeps propagating over IPC as a real rejection). The typed
 * StorageChangeError carries the surface-neutral refusal core wrote for in-dialog
 * rendering; a ConfigError mid-commit (a config file that turned untrusted) is equally a
 * refusal that leaves the config untouched, so it renders the same way.
 */
export function storageChangeFailure(err: unknown): string | null {
  if (err instanceof StorageChangeError || err instanceof ConfigError) return err.message;
  return null;
}
