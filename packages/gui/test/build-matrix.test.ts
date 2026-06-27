/**
 * GOLD — build-matrix guard (PRD §19 R01; runbook "CHECK BUILD MATRIX").
 *
 * §19 R01 fixes the distribution build matrix at macOS + Linux ONLY: no Windows
 * target anywhere. The CHECK BUILD MATRIX manual procedure asks a human to inspect
 * two config files for the absence of Windows. This test is the automated CI safety
 * valve the manual check could not be: it FAILS the moment a Windows target creeps
 * back into the electron-builder config or the CI workflow matrices via a config
 * change — so a regression cannot merge green.
 *
 * It asserts, by static inspection of the checked-in config (no build/network):
 *   1. electron-builder.yml declares `mac` + `linux` target blocks and NO `win` block
 *      (and no NSIS / msi / Windows portable targets).
 *   2. release.yml's pack matrix is exactly [macos-latest, ubuntu-latest] — no
 *      windows-latest runner anywhere in the release or CI workflows.
 *   3. No Windows artifact extension (.exe / .msi / NSIS) is referenced by any of
 *      the three config files.
 * This is the executable mirror of the runbook FAIL conditions for §19 R01.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const builderYml = read('../electron-builder.yml');
const releaseYml = read('../../../.github/workflows/release.yml');
const ciYml = read('../../../.github/workflows/ci.yml');

// Active config only — strip whole-line `#` comments and trailing `# ...` comments
// so the guards key off real YAML directives, not the prose that documents WHY
// Windows is absent ("no windows-latest entry…"). A regression is a config change,
// which lives outside comments.
const stripComments = (yaml: string): string =>
  yaml
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');

const builderActive = stripComments(builderYml);
const releaseActive = stripComments(releaseYml);
const ciActive = stripComments(ciYml);

// The active `files:` list items (lines after the `files:` key, before the next
// top-level key), with leading list/`from:` markers stripped to bare globs/paths.
// Used by the §19 R02 guard to assert the single-installer trees are bundled.
const filesGlob = ((): string => {
  const lines = builderActive.split('\n');
  const start = lines.findIndex((l) => /^files\s*:/.test(l));
  if (start === -1) return '';
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\S/.test(line) && line.trim() !== '') break; // next top-level key
    block.push(line);
  }
  return block.join('\n');
})();

// A top-level `win:` mapping key in electron-builder.yml (e.g. "win:" at column 0,
// optionally with a trailing comment), as opposed to the prose word "windows".
const TOP_LEVEL_WIN_BLOCK = /^win\s*:/m;
// Windows-only electron-builder target keys / artifact families.
const WINDOWS_TARGETS = /\b(nsis|msi|appx|squirrel|portable\b.*\bwin|win\b.*\bportable)\b/i;
// A windows-latest GitHub Actions runner anywhere in a workflow matrix.
const WINDOWS_RUNNER = /windows-latest/i;
// Windows installer/binary artifact extensions.
const WINDOWS_ARTIFACT_EXT = /\.(exe|msi)\b/i;

describe('GOLD — build matrix is macOS + Linux only (§19 R01)', () => {
  it('electron-builder.yml declares mac and linux target blocks', () => {
    expect(builderActive).toMatch(/^mac\s*:/m);
    expect(builderActive).toMatch(/^linux\s*:/m);
  });

  it('electron-builder.yml has NO Windows (win) target block', () => {
    expect(TOP_LEVEL_WIN_BLOCK.test(builderActive)).toBe(false);
  });

  it('electron-builder.yml declares no Windows-only build targets', () => {
    expect(WINDOWS_TARGETS.test(builderActive)).toBe(false);
    expect(WINDOWS_ARTIFACT_EXT.test(builderActive)).toBe(false);
  });

  it('release.yml pack matrix is exactly [macos-latest, ubuntu-latest]', () => {
    // The pack job's runner matrix — the line that drives which OS images build the
    // GUI artifacts. Must name both supported runners and nothing else.
    const osMatrix = releaseActive.match(/os:\s*\[([^\]]*)\]/);
    if (osMatrix === null) {
      throw new Error('release.yml must declare an `os: [...]` build matrix');
    }
    const runners = (osMatrix[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    expect(runners).toEqual(['macos-latest', 'ubuntu-latest']);
  });

  it('no workflow uses a windows-latest runner', () => {
    expect(WINDOWS_RUNNER.test(releaseActive)).toBe(false);
    expect(WINDOWS_RUNNER.test(ciActive)).toBe(false);
  });

  it('no workflow references a Windows artifact extension (.exe / .msi)', () => {
    expect(WINDOWS_ARTIFACT_EXT.test(releaseActive)).toBe(false);
    expect(WINDOWS_ARTIFACT_EXT.test(ciActive)).toBe(false);
  });
});

/**
 * GOLD — single-installer bundle guard (PRD §19 R02; runbook "CHECK INSTALL").
 *
 * §19 R02 (decision G2) is a single artifact that installs the GUI AND puts `tt`
 * on PATH. The mechanism (packaging/ scripts) only works if the built app bundle
 * actually CONTAINS two trees, which depend entirely on the electron-builder
 * `files:` glob:
 *   1. packages/cli/dist/** — so tt-launcher.sh's CLI_REL
 *      (packages/cli/dist/bin.js) resolves inside the installed bundle; and
 *   2. packaging/** — so build-pkg.sh finds tt-launcher.sh in the bundle (it FAILS
 *      with "ensure packaging/ is included in the electron-builder files glob"
 *      otherwise) and postinstall.sh/install.sh can symlink `tt` to it.
 * Plus the CLI's lone runtime dep (commander) must be bundled for bin.js to run.
 *
 * The R02 AC is MANUAL (OS-level install reality), so this gap would otherwise go
 * undetected until a real install attempt. This static guard (no build/network) is
 * the executable mirror of the CHECK INSTALL FAIL conditions for the *bundle
 * contents*: it FAILS the moment the glob drops a tree the single installer needs.
 */
describe('GOLD — single installer bundles the CLI + packaging trees (§19 R02)', () => {
  it('files glob bundles the CLI entrypoint at packages/cli/dist/bin.js', () => {
    // The launcher's CLI_REL is packages/cli/dist/bin.js; the bundle must place the
    // built CLI dist at that path inside the app root (via a from/to mapping since
    // packages/cli is outside the gui project dir).
    expect(filesGlob).toMatch(/to:\s*packages\/cli\/dist\b/);
    expect(filesGlob).toMatch(/from:\s*\.\.\/cli\/dist\b/);
  });

  it('files glob bundles the packaging tree (launcher shim + install scripts)', () => {
    // build-pkg.sh requires app/packaging/tt-launcher.sh to exist in the bundle.
    expect(filesGlob).toMatch(/to:\s*packaging\b/);
    expect(filesGlob).toMatch(/from:\s*\.\.\/\.\.\/packaging\b/);
  });

  it('files glob bundles the CLI runtime dependency (commander)', () => {
    // bin.js imports commander; it resolves from the app root node_modules.
    expect(filesGlob).toMatch(/node_modules\/commander\//);
  });
});

/**
 * GOLD — publish-on-merge workflow guard (PRD §19 R05; runbook "CHECK PUBLISH-ON-MERGE").
 *
 * §19 R05 (decision G4): every merge to `main` runs CI that builds both artifacts AND
 * publishes a GitHub Release. The *publish actually firing* is an Actions/GitHub-Releases
 * reality that only a real merge to the real upstream repo can exercise — that remains the
 * MANUAL CHECK PUBLISH-ON-MERGE. But the *authoring* of the pipeline that makes it fire is
 * checked-in config, and a regression there (someone drops the push:main trigger, deletes
 * the publish job, marks the release a draft/prerelease, or stops attaching an artifact)
 * would silently defeat R05 and never be caught until the next real merge.
 *
 * This is the executable safety valve for that authoring — the same role the R01/R02 guards
 * above play for the build matrix and the installer bundle. By static inspection of the
 * checked-in `release.yml` (no build/network/Actions run) it asserts the publish pipeline
 * is wired the way the runbook's FAIL conditions require:
 *   1. it triggers on push to `main` (the merge-to-main trigger);
 *   2. the version → pack → publish job chain exists with the right `needs:` wiring;
 *   3. the upstream-only guard (`if: github.repository == 'kdbanman/stint'`) is present so
 *      forks build but never publish;
 *   4. the publish job has `contents: write` and `gh release create`s the computed tag with
 *      BOTH downloaded artifacts attached, NOT as a draft and NOT a prerelease.
 * It does NOT replace the MANUAL check (the live publish on the real repo); it FAILS the
 * moment the workflow is edited in a way that would stop R05 from publishing on merge.
 */
describe('GOLD — publish-on-merge workflow is wired to publish a Release (§19 R05)', () => {
  it('release.yml triggers on push to main (the merge-to-main trigger)', () => {
    // A `push:` trigger whose `branches:` list includes main.
    expect(releaseActive).toMatch(/on\s*:/);
    expect(releaseActive).toMatch(/push\s*:/);
    expect(releaseActive).toMatch(/branches\s*:\s*\[[^\]]*\bmain\b[^\]]*\]/);
  });

  it('declares the version → pack → publish job chain', () => {
    expect(releaseActive).toMatch(/^\s{2}version\s*:/m);
    expect(releaseActive).toMatch(/^\s{2}pack\s*:/m);
    expect(releaseActive).toMatch(/^\s{2}publish\s*:/m);
    // pack waits on version; publish waits on BOTH version and pack so it has the
    // computed tag AND the built artifacts before it cuts the release.
    expect(releaseActive).toMatch(/pack\s*:[\s\S]*?needs\s*:\s*version\b/);
    expect(releaseActive).toMatch(
      /publish\s*:[\s\S]*?needs\s*:\s*\[\s*version\s*,\s*pack\s*\]/,
    );
  });

  it('is guarded to the upstream repo so forks build but never publish', () => {
    expect(releaseActive).toMatch(
      /if\s*:\s*github\.repository\s*==\s*'kdbanman\/stint'/,
    );
  });

  it('the publish job has contents: write and creates a non-draft Release with both artifacts', () => {
    // Isolate the publish job body (from `publish:` to the next top-level job key or EOF)
    // so the assertions key off the publish job, not the whole file.
    const publishBody = (() => {
      const m = releaseActive.match(/^\s{2}publish\s*:\n([\s\S]*)$/m);
      return m ? (m[1] ?? '') : '';
    })();
    expect(publishBody).not.toBe('');

    // contents: write — required to create the Release.
    expect(releaseActive).toMatch(/permissions\s*:[\s\S]*?contents\s*:\s*write/);

    // It downloads both packed artifacts before publishing.
    expect(publishBody).toMatch(/download-artifact/);

    // It cuts the Release at the computed tag with the collected assets attached.
    expect(publishBody).toMatch(/gh\s+release\s+create\b/);
    expect(publishBody).toMatch(/dist\/release\/\*/);

    // The release is PUBLISHED — not a draft, not a prerelease. We both forbid the
    // draft/prerelease flags on `gh release create` AND require the post-create
    // isDraft assertion the workflow uses to fail a draft release.
    expect(publishBody).not.toMatch(/gh\s+release\s+create[\s\S]*?--draft\b/);
    expect(publishBody).not.toMatch(/gh\s+release\s+create[\s\S]*?--prerelease\b/);
    expect(publishBody).toMatch(/isDraft/);
  });
});
