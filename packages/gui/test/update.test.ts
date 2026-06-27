/**
 * GOLD — the in-app update logic (PRD §19 R03 check, R04 download + guided install; ordering by
 * §19 R06). The Settings → Software Update "Check now" action queries the GitHub Releases API and
 * reports up-to-date / update-available / a graceful error (R03); "Download & install" streams the
 * platform artifact to a temp file, verifies its size, emits progress, and walks the user through a
 * guided replace + one-time Gatekeeper approval (R04). The transport (Electron `net`/`shell`) is
 * mocked away; the testable surface is the PURE logic — version ordering, the injectable-fetcher
 * verdict, platform artifact-selection, progress maths, the guided-step plan, the temp path, and
 * the size-verifying download with an injected byte source — so the whole flow is proven fully
 * offline (no network — §17 R9) and the artifact is asserted to land in the TEMP dir, never beside
 * the database (§19 R04). These drive the units main.ts's `update:*` IPC handlers wrap.
 */
import { describe, it, expect, vi } from 'vitest';

// update.ts imports { app, net, shell } from 'electron'; in a node test there is no Electron, so
// mock the members the module touches. `net`/`shell` are never exercised here (every download
// injects its own byte source); getVersion lets currentVersion() resolve a default.
vi.mock('electron', () => ({
  app: { getVersion: () => '2026.6.27', getPath: () => '/var/folders/tmp' },
  net: { request: () => { throw new Error('net should not be used with an injected source'); } },
  shell: { showItemInFolder: () => { throw new Error('shell should not be used in a unit test'); } },
}));

import {
  parseVersion,
  compareVersions,
  latestPublishedRelease,
  checkForUpdates,
  normalizePlatform,
  selectArtifact,
  downloadPercent,
  planGuidedInstall,
  artifactTempPath,
  downloadUpdate,
  GATEKEEPER_NOTE,
  ARTIFACT_EXTENSIONS,
  type GithubRelease,
  type GithubAsset,
} from '../src/update.js';

const asset = (name: string, over: Partial<GithubAsset> = {}): GithubAsset => ({
  name,
  browser_download_url: `https://github.com/kdbanman/stint/releases/download/x/${name}`,
  size: 1000,
  ...over,
});

const rel = (tag: string, over: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: tag,
  html_url: `https://github.com/kdbanman/stint/releases/tag/${tag}`,
  draft: false,
  prerelease: false,
  ...over,
});

describe('parseVersion — the §19 R06 YYYY.M.D[.N] shape', () => {
  it('parses a date version and a same-day build suffix (not zero-padded)', () => {
    expect(parseVersion('2026.6.27')).toEqual([2026, 6, 27]);
    expect(parseVersion('2026.6.27.2')).toEqual([2026, 6, 27, 2]);
  });

  it('tolerates the leading v of a git tag', () => {
    expect(parseVersion('v2026.6.27.3')).toEqual([2026, 6, 27, 3]);
  });

  it('rejects non-release strings (dev sentinel, semver) as unparseable', () => {
    expect(parseVersion('0.0.0-dev')).toBeNull();
    expect(parseVersion('1.0.0')).toBeNull();
    expect(parseVersion('not-a-version')).toBeNull();
  });
});

describe('compareVersions — §19 R06 ordering', () => {
  it('orders by year, then month, then day, then build suffix', () => {
    expect(compareVersions('2026.6.27', '2026.6.28')).toBeLessThan(0);
    expect(compareVersions('2026.7.1', '2026.6.30')).toBeGreaterThan(0);
    expect(compareVersions('2027.1.1', '2026.12.31')).toBeGreaterThan(0);
    expect(compareVersions('2026.6.27', '2026.6.27')).toBe(0);
  });

  it('treats a missing build suffix as .0 (so .2 outranks the bare date)', () => {
    expect(compareVersions('2026.6.27', '2026.6.27.2')).toBeLessThan(0);
    expect(compareVersions('2026.6.27.2', '2026.6.27')).toBeGreaterThan(0);
    expect(compareVersions('2026.6.27.2', '2026.6.27.10')).toBeLessThan(0);
  });

  it('sorts an unparseable version as the oldest (a dev build is always behind a release)', () => {
    expect(compareVersions('0.0.0-dev', '2026.6.27')).toBeLessThan(0);
    expect(compareVersions('2026.6.27', '0.0.0-dev')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', 'also-bad')).toBe(0);
  });
});

describe('latestPublishedRelease — skip drafts/prereleases, pick the newest', () => {
  it('picks the newest published, parseable release', () => {
    const best = latestPublishedRelease([rel('2026.6.27'), rel('2026.6.28.2'), rel('2026.6.28')]);
    expect(best?.tag_name).toBe('2026.6.28.2');
  });

  it('ignores drafts, prereleases, and unparseable tags', () => {
    const best = latestPublishedRelease([
      rel('2026.7.1', { draft: true }),
      rel('2026.7.2', { prerelease: true }),
      rel('nightly'),
      rel('2026.6.27'),
    ]);
    expect(best?.tag_name).toBe('2026.6.27');
  });

  it('returns null when nothing is eligible', () => {
    expect(latestPublishedRelease([])).toBeNull();
    expect(latestPublishedRelease([rel('2026.7.1', { draft: true }), rel('bad')])).toBeNull();
  });
});

describe('checkForUpdates — the §19 R03 verdict (offline, injected fetcher)', () => {
  it('reports up-to-date when the latest release equals the current version', async () => {
    const res = await checkForUpdates({
      current: '2026.6.27',
      fetchReleases: async () => [rel('2026.6.27'), rel('2026.6.20')],
    });
    expect(res.status).toBe('up-to-date');
  });

  it('reports up-to-date when the current version is AHEAD of the latest release', async () => {
    const res = await checkForUpdates({ current: '2026.6.28', fetchReleases: async () => [rel('2026.6.27')] });
    expect(res.status).toBe('up-to-date');
  });

  it('reports update-available with the newer version + a release link', async () => {
    const res = await checkForUpdates({
      current: '2026.6.27',
      fetchReleases: async () => [rel('2026.6.27'), rel('2026.6.27.3')],
    });
    expect(res.status).toBe('update-available');
    if (res.status === 'update-available') {
      expect(res.latestVersion).toBe('2026.6.27.3');
      expect(res.releaseUrl).toContain('2026.6.27.3');
    }
  });

  it('an unstamped dev build sees any real release as an available update', async () => {
    const res = await checkForUpdates({ current: '0.0.0-dev', fetchReleases: async () => [rel('2026.6.27')] });
    expect(res.status).toBe('update-available');
  });

  it('returns a graceful error (never throws) when the fetch fails', async () => {
    const res = await checkForUpdates({
      current: '2026.6.27',
      fetchReleases: async () => {
        throw new Error('offline');
      },
    });
    expect(res.status).toBe('error');
    if (res.status === 'error') expect(res.message).toMatch(/offline/);
  });
});

// ---------------------------------------------------------------- §19 R04 download + install

describe('normalizePlatform — macOS + Linux only (decision G1)', () => {
  it('maps darwin/linux; rejects everything else (Windows is dropped)', () => {
    expect(normalizePlatform('darwin')).toBe('darwin');
    expect(normalizePlatform('linux')).toBe('linux');
    expect(normalizePlatform('win32')).toBeNull();
    expect(normalizePlatform('aix')).toBeNull();
  });
});

describe('selectArtifact — pick the platform installer by preference order (§19 R04)', () => {
  it('prefers .pkg, then .dmg on macOS', () => {
    const r = rel('2026.6.28', { assets: [asset('Stint-2026.6.28.dmg'), asset('Stint-2026.6.28.pkg')] });
    expect(selectArtifact(r, 'darwin')?.name).toBe('Stint-2026.6.28.pkg');
    const onlyDmg = rel('2026.6.28', { assets: [asset('Stint-2026.6.28.dmg')] });
    expect(selectArtifact(onlyDmg, 'darwin')?.name).toBe('Stint-2026.6.28.dmg');
  });

  it('prefers .AppImage, then .deb on Linux', () => {
    const r = rel('2026.6.28', { assets: [asset('stint_2026.6.28_amd64.deb'), asset('Stint-2026.6.28.AppImage')] });
    expect(selectArtifact(r, 'linux')?.name).toBe('Stint-2026.6.28.AppImage');
  });

  it('does not cross platforms and returns null when no artifact matches', () => {
    const macOnly = rel('2026.6.28', { assets: [asset('Stint-2026.6.28.pkg')] });
    expect(selectArtifact(macOnly, 'linux')).toBeNull();
    expect(selectArtifact(rel('2026.6.28'), 'darwin')).toBeNull(); // no assets at all
  });

  it('the extension allow-lists are macOS/Linux only (no .exe/.msi — Windows dropped)', () => {
    expect(ARTIFACT_EXTENSIONS.darwin).toEqual(['.pkg', '.dmg']);
    expect(ARTIFACT_EXTENSIONS.linux).toEqual(['.AppImage', '.deb']);
  });
});

describe('downloadPercent — clamped progress maths (§19 R04)', () => {
  it('computes a floored, clamped [0,100] percent', () => {
    expect(downloadPercent(0, 1000)).toBe(0);
    expect(downloadPercent(620, 1000)).toBe(62);
    expect(downloadPercent(1000, 1000)).toBe(100);
    expect(downloadPercent(1500, 1000)).toBe(100); // clamped
  });

  it('returns 0 for an unknown/zero total (indeterminate, never divide-by-zero)', () => {
    expect(downloadPercent(500, 0)).toBe(0);
    expect(downloadPercent(500, -1)).toBe(0);
  });
});

describe('planGuidedInstall — the ordered, platform-specific steps (§19 R04)', () => {
  it('macOS has the one-time Gatekeeper beat — no Developer ID / notarization (decision G3)', () => {
    const steps = planGuidedInstall('darwin');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/download/i);
    expect(steps[1]).toMatch(/\/Applications/);
    expect(steps[2]).toMatch(/approve once/i);
    expect(steps[2]).toMatch(/Gatekeeper/i);
    expect(steps[2]).toMatch(/no Developer ID/i);
    // The explicit Gatekeeper note text is the shared constant.
    expect(steps[2]).toContain(GATEKEEPER_NOTE);
  });

  it('Linux has no Gatekeeper step (make-executable / install instead)', () => {
    const steps = planGuidedInstall('linux');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/download/i);
    expect(steps.join(' ')).not.toMatch(/Gatekeeper/i);
    expect(steps[2]).toMatch(/AppImage|\.deb/i);
  });
});

describe('artifactTempPath — the artifact lands in the TEMP dir, never beside the DB (§19 R04)', () => {
  it('joins the asset name under the supplied temp dir', () => {
    const p = artifactTempPath('Stint-2026.6.28.pkg', '/var/folders/tmp');
    expect(p).toBe('/var/folders/tmp/Stint-2026.6.28.pkg');
    // It is anchored at the temp dir — NOT under a userData / database location.
    expect(p.startsWith('/var/folders/tmp/')).toBe(true);
    expect(p).not.toMatch(/Application Support|\.local\/share|userData|\.sqlite/);
  });
});

describe('downloadUpdate — size-verified stream to temp (§19 R04, injected byte source)', () => {
  const macRelease = rel('2026.6.28', { assets: [asset('Stint-2026.6.28.pkg', { size: 2048 })] });

  it('downloads to the temp dir, emits progress, verifies size, and returns the path', async () => {
    const progress: number[] = [];
    const written: { url: string; dest: string }[] = [];
    const path = await downloadUpdate(macRelease, (p) => progress.push(p), {
      platform: 'darwin',
      deps: {
        tempDir: () => '/tmpdir',
        download: async (url, dest, onChunk) => {
          written.push({ url, dest });
          onChunk(1024, 2048); // halfway
          onChunk(2048, 2048); // done
          return 2048; // exactly the declared size
        },
      },
    });
    expect(path).toBe('/tmpdir/Stint-2026.6.28.pkg');
    expect(written).toHaveLength(1);
    expect(written[0]?.dest).toBe('/tmpdir/Stint-2026.6.28.pkg');
    // Progress is monotonic and ends at 100.
    expect(progress).toContain(50);
    expect(progress[progress.length - 1]).toBe(100);
  });

  it('rejects on a size mismatch (a truncated download is corrupt)', async () => {
    await expect(
      downloadUpdate(macRelease, () => {}, {
        platform: 'darwin',
        deps: { tempDir: () => '/tmpdir', download: async () => 999 /* != 2048 */ },
      }),
    ).rejects.toThrow(/corrupt|expected/i);
  });

  it('rejects when the release has no artifact for the platform', async () => {
    await expect(
      downloadUpdate(rel('2026.6.28', { assets: [asset('Stint.pkg')] }), () => {}, {
        platform: 'linux',
        deps: { tempDir: () => '/tmpdir', download: async () => 0 },
      }),
    ).rejects.toThrow(/no installer artifact/i);
  });
});
