/**
 * GOLD — the storage-paths read + the native launch-refusal decision logic (PRD §12 R25,
 * §20 R10/R11/R14).
 *
 * The §20 R10/R11 GUI posture is a NATIVE dialog (the R05 convention), which no headless
 * harness can drive — the runbook's CHECK STORAGE CHANGE covers the rendered chrome on a
 * real desktop. What CAN be asserted headlessly is everything behind it, so the decision
 * logic lives Electron-free in gui/src/storageview.ts and is pinned here:
 *
 *   1. buildStoragePathsView — the `getStoragePaths` channel's read: the three effective
 *      paths + sources agree with core's resolveStoragePaths (the SAME resolver `tt paths`
 *      prints from, so the Settings Storage group and the CLI can never disagree — §13),
 *      the default-rung targets the Reset-to-default flow aims at, and the §20 R14 probe.
 *   2. launchRefusal — ConfigError (§20 R10) and StoragePathError (§20 R11) each become a
 *      dialog plan naming the file and the error / the configured path AND the config
 *      file, with a Reset-to-default action committing by §13's reset semantics (delete
 *      the offending key). The untrusted-file repair behind the R10 plan is core's
 *      resetUntrustedConfig (config-shape knowledge lives in core — its behavior is
 *      GOLD-pinned in core/test/gold/contracts.test.ts). Any other error returns null and
 *      stays as loud as before.
 *   3. storageChangeFailure — the §12 R26 in-dialog refusal filter: only the typed
 *      StorageChangeError / ConfigError become the dialog's inline message.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConfigError,
  DB_FILENAME,
  StorageChangeError,
  StoragePathError,
  resolveStoragePaths,
} from '@stint/core';
import { buildStoragePathsView, launchRefusal, storageChangeFailure } from '../src/storageview.js';

const OK_DIR = { path: '/b', ok: true, problem: null } as const;

let homes: string[] = [];
function home(): string {
  const h = mkdtempSync(join(tmpdir(), 'stint-gui-storage-'));
  homes.push(h);
  return h;
}
afterEach(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
  homes = [];
});

describe('buildStoragePathsView (§12 R25 — the getStoragePaths read)', () => {
  it('mirrors core resolveStoragePaths exactly — paths, sources, and the config file (§13 agreement with tt paths)', () => {
    const h = home();
    const configFile = join(h, 'config.json');
    writeFileSync(configFile, JSON.stringify({ dbPath: join(h, 'data', 'tt.sqlite') }));
    const env = {
      TT_CONFIG: configFile,
      TT_BACKUP_DIR: join(h, 'backups'),
    } as NodeJS.ProcessEnv;
    const userData = join(h, 'user-data');
    const view = buildStoragePathsView(env, userData, { ...OK_DIR });
    const core = resolveStoragePaths(env, userData);
    expect(view.db).toEqual({ path: core.db.path, source: core.db.source });
    expect(view.db.source).toBe('config');
    expect(view.backupDir).toEqual({ path: core.backupDir.path, source: core.backupDir.source });
    expect(view.backupDir.source).toBe('env');
    expect(view.configFile).toEqual({ path: core.configFile.path, source: core.configFile.source });
    expect(view.configFile.path).toBe(configFile);
  });

  it('names the default-rung targets the Reset-to-default flow aims at, and carries the §20 R14 probe', () => {
    const h = home();
    const configFile = join(h, 'config.json');
    writeFileSync(configFile, JSON.stringify({ dbPath: join(h, 'data', 'tt.sqlite') }));
    const env = { TT_CONFIG: configFile } as NodeJS.ProcessEnv;
    const userData = join(h, 'user-data');
    const view = buildStoragePathsView(env, userData, {
      path: join(h, 'dead'),
      ok: false,
      problem: 'does not exist',
    });
    // The database default is the GUI's userData-derived path (env/config outrank it);
    // the backup default is beside the EFFECTIVE database (§13's default rung).
    expect(view.defaults.dbPath).toBe(join(userData, DB_FILENAME));
    expect(view.defaults.backupDir).toBe(join(h, 'data'));
    expect(view.backupDirState).toEqual({ ok: false, problem: 'does not exist' });
  });
});

describe('launchRefusal (§20 R10/R11 — the native Reset-to-default / Quit dialog plan)', () => {
  it('a ConfigError becomes a plan whose detail carries the message naming the file and the error (§20 R10)', () => {
    const err = new ConfigError('/home/u/.config/stint/config.json', 'unknown key "dbpath" (allowed keys: dbPath, backupDir)');
    const plan = launchRefusal(err);
    expect(plan).not.toBeNull();
    expect(plan!.title).toMatch(/config file/i);
    expect(plan!.detail).toContain('/home/u/.config/stint/config.json');
    expect(plan!.detail).toContain('unknown key "dbpath"');
    // The done-when's stance is stated: nothing opened, nothing written, both choices named.
    expect(plan!.detail).toMatch(/Nothing was opened and nothing was written/);
  });

  it('a StoragePathError becomes a plan naming the configured path AND the config file, whose reset deletes ONLY dbPath (§20 R11)', () => {
    const h = home();
    const configFile = join(h, 'config.json');
    writeFileSync(
      configFile,
      JSON.stringify({ dbPath: '/gone/volume/tt.sqlite', backupDir: join(h, 'backups') }),
    );
    const err = new StoragePathError(
      `cannot open database at /gone/volume/tt.sqlite: its parent directory /gone/volume does not exist (path set by config file ${configFile})`,
      '/gone/volume/tt.sqlite',
      configFile,
    );
    const plan = launchRefusal(err);
    expect(plan).not.toBeNull();
    expect(plan!.detail).toContain('/gone/volume/tt.sqlite');
    expect(plan!.detail).toContain(configFile);
    // Reset = §13's delete-the-key, committed atomically; the OTHER key survives and no
    // resolved default is ever written into the file.
    plan!.reset();
    const after = JSON.parse(readFileSync(configFile, 'utf8'));
    expect('dbPath' in after).toBe(false);
    expect(after.backupDir).toBe(join(h, 'backups'));
  });

  it('every other error returns null — the existing fatal-open paths stay exactly as loud (schema skew, DbOpenError)', () => {
    expect(launchRefusal(new Error('boom'))).toBeNull();
    expect(launchRefusal(new StorageChangeError('refused', '/x'))).toBeNull();
    expect(launchRefusal(undefined)).toBeNull();
  });
});

describe('storageChangeFailure (§12 R26 — the in-dialog refusal filter)', () => {
  it('a typed StorageChangeError / ConfigError becomes the dialog message; anything else propagates', () => {
    expect(storageChangeFailure(new StorageChangeError('a file already exists at /x — migrate never overwrites', '/x'))).toBe(
      'a file already exists at /x — migrate never overwrites',
    );
    expect(storageChangeFailure(new ConfigError('/c.json', 'is not valid JSON: x'))).toBe(
      'config file /c.json: is not valid JSON: x',
    );
    expect(storageChangeFailure(new Error('disk on fire'))).toBeNull();
    expect(storageChangeFailure('nope')).toBeNull();
  });
});
