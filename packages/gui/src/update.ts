/**
 * §19 R03/R04 — in-app Software Update (decision G3). Settings → Software Update shows the
 * current version, a "Check for updates" action that queries the GitHub Releases API (R03),
 * and — this slice — DOWNLOADS the newer release's platform artifact and walks the user
 * through a guided install (R04).
 *
 * R04 (download + guided install): given a release, pick the platform artifact (macOS
 * `.pkg`/`.dmg`, Linux `.AppImage`/`.deb`, chosen by `os.platform()`), stream its bytes to a
 * temp file under `app.getPath('temp')` — NEVER under userData / beside the database —, verify
 * the downloaded size against the asset's `content-length`, and emit progress. Then reveal the
 * downloaded installer (Finder / file manager) and surface the ordered, platform-specific
 * guided steps: download → replace the app in /Applications → approve once at first launch.
 * There is NO Apple Developer ID / notarization: on macOS the user clears Gatekeeper ONCE,
 * surfaced as an explicit step ("one-time Gatekeeper clearance, no Developer ID needed").
 *
 * The whole flow NEVER touches the database (§19 R04 / §16 update-mid-timer): nothing here
 * calls the @stint/core Store, and the artifact lands in the OS temp dir, never beside the DB.
 *
 * This is a GUI/OS-only capability: there is no `tt` equivalent (a CLI install is updated by
 * the package manager / installer), so — like the tray and the global hotkey — it is NOT a
 * parity-matrix channel. main.ts registers it on a SEPARATE, explicitly-GUI-only IPC surface
 * (`update:getVersion` / `update:check` / `update:download` / `update:reveal`) outside the
 * parity-asserted CHANNELS loop, and preload bridges it under its own `window.stint.update`
 * namespace.
 *
 * No-network (PRD §17 R9): the ONLY outbound traffic in the whole app is THIS module's
 * user-initiated check AND the user-initiated artifact byte download — both confined to this
 * one file. They use Electron's built-in `net` (`import { net } from 'electron'`, an allowed
 * prod dep), never node:https / node:net / global fetch, so the no-network backstop
 * (scripts/check-no-network.mjs) stays green WITHOUT relaxing any rule or editing the scanner
 * (the import names 'electron', not 'net'/'node:https', and `net.request` is not a forbidden
 * token). The decision / selection / plan logic takes injectable inputs so it is fully
 * unit-testable offline and without Electron.
 */
import { app, net, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { platform as osPlatform } from 'node:os';

// Re-exported for callers of this module; defined in ipc.ts alongside the other renderer-safe
// view shapes (the main process pushes it over the `update-progress` broadcast).
export type { UpdateProgress } from './ipc.js';

/** The public GitHub repo whose Releases back distribution (decision G4). */
const RELEASES_API = 'https://api.github.com/repos/kdbanman/stint/releases';

/** A non-release sentinel (the unstamped dev build) — never "newer" than a real release. */
const DEV_VERSION = '0.0.0-dev';

/** The shape of one GitHub release asset the download needs (a subset of the API payload). */
export interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

/** The shape of one GitHub release the check + download need (a subset of the API payload). */
export interface GithubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  /** R04: the published artifacts (the macOS / Linux installers we choose from by platform). */
  assets?: GithubAsset[];
}

/** The result the renderer paints (a renderer-safe, network/Electron-free value). */
export type UpdateCheck =
  | { status: 'up-to-date'; currentVersion: string; latestVersion: string; releaseUrl: string }
  | { status: 'update-available'; currentVersion: string; latestVersion: string; releaseUrl: string }
  | { status: 'error'; currentVersion: string; message: string };

// §19 R04 — UpdateProgress (the renderer-safe progress value pushed over the dedicated
// `update-progress` broadcast) is defined in ipc.ts alongside the other renderer-safe view
// shapes, and re-exported above for callers of this module.

/** The packaged app version (sourced from packages/gui/package.json, stamped by §19 R06). */
export function currentVersion(): string {
  try {
    return app.getVersion();
  } catch {
    // Outside a packaged app (a unit test importing the module) getVersion can throw;
    // fall back to the dev sentinel so the pure decision logic stays exercisable.
    return DEV_VERSION;
  }
}

/**
 * Parse a `YYYY.M.D[.N]` version (the §19 R06 shape) into its numeric components for
 * ordering. A leading `v` (the git tag form `v2026.6.27`) is tolerated. Returns null for
 * anything that is not a release version (e.g. the `0.0.0-dev` sentinel, or `1.0.0`), so
 * the comparator can treat a non-release as "unknown / never newer".
 */
export function parseVersion(tag: string): number[] | null {
  const cleaned = tag.trim().replace(/^v/, '');
  if (!/^\d{4}\.\d{1,2}\.\d{1,2}(\.\d+)?$/.test(cleaned)) return null;
  return cleaned.split('.').map((p) => Number(p));
}

/**
 * Compare two `YYYY.M.D[.N]` versions: < 0 if a is older, 0 if equal, > 0 if a is newer.
 * A missing build suffix is treated as `.0` (so `2026.6.27` < `2026.6.27.2`). An
 * unparseable version sorts as the OLDEST (it can never out-rank a real release), so an
 * unstamped dev build always reports an available update when a real release exists, and
 * a malformed remote tag is never mistaken for an upgrade.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/**
 * Pick the latest PUBLISHED release (skipping drafts and prereleases — §19 R03 only
 * surfaces a stable update) by the §19 R06 ordering. Returns null when the list has no
 * eligible, parseable release.
 */
export function latestPublishedRelease(releases: GithubRelease[]): GithubRelease | null {
  let best: GithubRelease | null = null;
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    if (parseVersion(r.tag_name) === null) continue;
    if (best === null || compareVersions(r.tag_name, best.tag_name) > 0) best = r;
  }
  return best;
}

/**
 * The default fetcher: a thin GET to the GitHub Releases API over Electron's built-in
 * `net` (one of the app's only two outbound requests — see the file header). It resolves the
 * parsed JSON array of releases; any transport/parse failure rejects, surfacing as the
 * graceful 'error' result in checkForUpdates (never a crash).
 */
export function fetchReleasesViaNet(): Promise<GithubRelease[]> {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url: RELEASES_API });
    // GitHub requires a User-Agent; Accept pins the v3 JSON contract.
    request.setHeader('User-Agent', 'Stint-Updater');
    request.setHeader('Accept', 'application/vnd.github+json');
    request.on('response', (response) => {
      const status = response.statusCode;
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`GitHub Releases API returned HTTP ${status}`));
          return;
        }
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!Array.isArray(parsed)) {
            reject(new Error('Unexpected GitHub Releases response shape'));
            return;
          }
          resolve(parsed as GithubRelease[]);
        } catch {
          reject(new Error('Could not parse the GitHub Releases response'));
        }
      });
      response.on('error', (err: Error) => reject(err));
    });
    request.on('error', (err) => reject(err));
    request.end();
  });
}

/**
 * §19 R03 — the user-initiated update check. Fetches the releases (default = the live
 * GitHub GET; injectable for offline tests), picks the latest published release, compares
 * it to the running version by the §19 R06 rule, and returns a renderer-safe verdict. Any
 * network/parse failure returns a graceful 'error' result rather than throwing, so the
 * Settings view can report it without crashing. This NEVER touches the database (§19 R04).
 */
export async function checkForUpdates(
  opts: { fetchReleases?: () => Promise<GithubRelease[]>; current?: string } = {},
): Promise<UpdateCheck> {
  const current = opts.current ?? currentVersion();
  const fetchReleases = opts.fetchReleases ?? fetchReleasesViaNet;
  let releases: GithubRelease[];
  try {
    releases = await fetchReleases();
  } catch (err) {
    return {
      status: 'error',
      currentVersion: current,
      message: err instanceof Error ? err.message : 'Could not reach GitHub Releases.',
    };
  }
  const latest = latestPublishedRelease(releases);
  if (!latest) {
    return {
      status: 'error',
      currentVersion: current,
      message: 'No published releases were found.',
    };
  }
  const latestVersion = latest.tag_name.replace(/^v/, '');
  const releaseUrl = latest.html_url;
  if (compareVersions(latestVersion, current) > 0) {
    return { status: 'update-available', currentVersion: current, latestVersion, releaseUrl };
  }
  return { status: 'up-to-date', currentVersion: current, latestVersion, releaseUrl };
}

// ---------------------------------------------------------------- §19 R04 download + install

/** The supported install platforms (Windows is dropped everywhere — decision G1). */
export type UpdatePlatform = 'darwin' | 'linux';

/**
 * The installer-artifact extensions we accept per platform, in PREFERENCE order. macOS
 * prefers a `.pkg` (the single-installer artifact — §19 R02) but accepts a `.dmg`; Linux
 * prefers an `.AppImage` (self-contained, no root) but accepts a `.deb`. The first asset
 * whose name ends with one of these wins (case-insensitive).
 */
export const ARTIFACT_EXTENSIONS: Record<UpdatePlatform, string[]> = {
  darwin: ['.pkg', '.dmg'],
  linux: ['.AppImage', '.deb'],
};

/**
 * Normalise `os.platform()` to a supported install platform, or null on anything else
 * (e.g. 'win32' — Windows is dropped, G1). Pure, so the selection logic is testable.
 */
export function normalizePlatform(p: string): UpdatePlatform | null {
  if (p === 'darwin') return 'darwin';
  if (p === 'linux') return 'linux';
  return null;
}

/**
 * §19 R04 — pick the artifact to download for a platform from a release's assets, by the
 * per-platform preference order above. Returns null when the release ships no asset for this
 * platform (the caller surfaces a graceful error rather than downloading the wrong thing).
 * Pure (no network, no Electron) so artifact selection is unit-testable offline.
 */
export function selectArtifact(release: GithubRelease, platform: UpdatePlatform): GithubAsset | null {
  const assets = release.assets ?? [];
  for (const ext of ARTIFACT_EXTENSIONS[platform]) {
    const hit = assets.find((a) => a.name.toLowerCase().endsWith(ext.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

/**
 * §19 R04 — download progress as a clamped integer percent [0,100]. `total <= 0` (an unknown
 * content-length) yields 0 so the bar stays indeterminate-but-safe rather than dividing by
 * zero. Pure, so progress maths is unit-testable.
 */
export function downloadPercent(received: number, total: number): number {
  if (total <= 0) return 0;
  const pct = Math.floor((received / total) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 * §19 R04 — the ordered, platform-specific guided-install step list the renderer paints as
 * numbered steps. PURE (no network, no Electron) so the renderer copy is testable directly.
 *
 * macOS has the one-time Gatekeeper beat (no Developer ID / notarization — decision G3): the
 * user approves the app ONCE in System Settings → Privacy & Security. Linux has no Gatekeeper;
 * its third step is making the AppImage executable / installing the `.deb`.
 */
export function planGuidedInstall(platform: UpdatePlatform): string[] {
  if (platform === 'darwin') {
    return [
      'Download the new version',
      'Replace the app in /Applications (Stint reveals the installer for you)',
      'Approve once at first launch in System Settings → Privacy & Security — one-time Gatekeeper clearance, no Developer ID needed',
    ];
  }
  return [
    'Download the new version',
    'Replace the installed app (Stint reveals the artifact for you)',
    'Make the AppImage executable (or install the .deb), then launch it',
  ];
}

/** macOS-only: the explicit one-time Gatekeeper note (no Developer ID / notarization). */
export const GATEKEEPER_NOTE =
  'one-time Gatekeeper clearance, no Developer ID needed';

/**
 * §19 R04 — the temp path the artifact streams to: under the OS temp dir (`app.getPath('temp')`),
 * NEVER under userData / beside the database (§19 R04 / §16 update-mid-timer). Injectable
 * `tempDir` keeps it pure/testable; the name is just the asset filename.
 */
export function artifactTempPath(assetName: string, tempDir: string): string {
  return join(tempDir, assetName);
}

/**
 * §19 R04 — stream a release's platform artifact to a temp file, verify its byte size against
 * the asset's declared `content-length` / `size`, and emit progress. Returns the on-disk path.
 *
 * Networking is Electron `net` only (the artifact byte download — the app's second and last
 * outbound request, see the file header). It writes ONLY to `app.getPath('temp')` and makes
 * ZERO @stint/core Store calls — updates never touch the database (§19 R04). `onProgress` is
 * called with a clamped percent so the renderer can paint a live bar. A non-2xx response, a
 * transport error, or a size mismatch rejects (surfaced as the 'error' progress phase).
 *
 * `deps` is injectable so the download wiring is unit-testable without a live network/Electron
 * (the unit test exercises the PURE helpers — selection / percent / plan / temp path — which is
 * where the testable logic lives; the byte transport itself is proven by the MANUAL CHECK).
 */
export interface DownloadDeps {
  /** Where the artifact is written (defaults to the OS temp dir — never beside the DB). */
  tempDir: () => string;
  /** Streams the URL's bytes; resolves the number of bytes written. Defaults to Electron net. */
  download: (
    url: string,
    destPath: string,
    onChunk: (received: number, total: number) => void,
  ) => Promise<number>;
}

function netDownload(
  url: string,
  destPath: string,
  onChunk: (received: number, total: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url });
    request.setHeader('User-Agent', 'Stint-Updater');
    request.on('response', (response) => {
      const status = response.statusCode;
      if (status < 200 || status >= 300) {
        reject(new Error(`Artifact download returned HTTP ${status}`));
        return;
      }
      const header = response.headers['content-length'];
      const total = Number(Array.isArray(header) ? header[0] : header) || 0;
      const out = createWriteStream(destPath);
      let received = 0;
      response.on('data', (chunk) => {
        const buf = Buffer.from(chunk);
        received += buf.length;
        out.write(buf);
        onChunk(received, total);
      });
      response.on('end', () => {
        out.end(() => resolve(received));
      });
      response.on('error', (err: Error) => {
        out.destroy();
        reject(err);
      });
    });
    request.on('error', (err) => reject(err));
    request.end();
  });
}

const defaultDownloadDeps = (): DownloadDeps => ({
  tempDir: () => app.getPath('temp'),
  download: netDownload,
});

/**
 * §19 R04 — download the chosen artifact for `release` to the temp dir, verifying its size,
 * emitting progress, and returning the on-disk path. Rejects with a graceful Error on a
 * missing artifact, a transport failure, or a size mismatch.
 */
export async function downloadUpdate(
  release: GithubRelease,
  onProgress: (percent: number) => void,
  opts: { platform?: UpdatePlatform; deps?: Partial<DownloadDeps> } = {},
): Promise<string> {
  const platform = opts.platform ?? normalizePlatform(osPlatform());
  if (!platform) {
    throw new Error('Unsupported platform for in-app update (macOS + Linux only).');
  }
  const asset = selectArtifact(release, platform);
  if (!asset) {
    throw new Error('This release has no installer artifact for your platform.');
  }
  const deps = { ...defaultDownloadDeps(), ...opts.deps };
  const destPath = artifactTempPath(asset.name, deps.tempDir());
  const written = await deps.download(asset.browser_download_url, destPath, (received, total) => {
    onProgress(downloadPercent(received, total > 0 ? total : asset.size));
  });
  // Verify the downloaded byte count against the asset's declared size (defence against a
  // truncated download). A zero declared size (rare) skips the check rather than false-failing.
  if (asset.size > 0 && written !== asset.size) {
    throw new Error(
      `Downloaded ${written} bytes but expected ${asset.size}; the download may be corrupt.`,
    );
  }
  onProgress(100);
  return destPath;
}

/**
 * §19 R04 — reveal the downloaded installer in Finder / the file manager so the user can run
 * it (the guided "replace the app" step). Uses Electron `shell` (no network, no DB). Returns
 * void; failures are non-fatal (the path is also shown in the guided steps).
 */
export function revealInstaller(path: string): void {
  try {
    shell.showItemInFolder(path);
  } catch {
    /* non-fatal: the path is also surfaced in the guided-step text */
  }
}
