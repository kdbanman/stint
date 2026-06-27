# Stint packaging — single-installer mechanism (PRD §19 R02)

Stint is two equal surfaces over one local SQLite database: the Electron GUI and
the `tt` CLI. The packaging story (PRD §19, decision **G2**) is that **one
artifact per platform** installs **both** in a single step:

1. the **GUI** lands in **Applications** (macOS) or the **app launcher** (Linux,
   via a `.desktop` entry), and
2. **`tt`** lands **on `PATH`** as a symlink to the launcher shim.

There is no separate Node install: `tt` runs through the Node bundled inside the
GUI app. macOS + Linux only — Windows is dropped everywhere (G1).

This directory holds **only the R02 install mechanism**. The two-platform build
artifacts it consumes are produced by §19 R01 (`packages/gui/electron-builder.yml`);
GitHub Release publishing is §19 R05; date/build versioning is §19 R06. R02 only
*consumes* those outputs — it does not build, publish, or version anything.

## Files

| File | Role |
|------|------|
| `tt-launcher.sh` | The on-`PATH` `tt` shim. Symlink target. Locates `bin.js` in the installed bundle and exec's the bundled Node against it. |
| `macos/build-pkg.sh` | `pkgbuild` + `productbuild` wrapper: takes the built `Stint.app` and emits `Stint-<version>.pkg` with the postinstall wired in. |
| `macos/distribution.xml` | `productbuild` distribution definition — payload into `/Applications`. |
| `macos/postinstall.sh` | Runs as the `.pkg` postinstall: creates the `tt` symlink on `PATH`. |
| `linux/install.sh` | One script the user runs: installs the AppImage + `.desktop` entry **and** symlinks `tt`. |
| `linux/uninstall.sh` | Reverses both. |

## Symlink targets and PATH placement

The single installer puts `tt` on `PATH` by creating a symlink to
`tt-launcher.sh`. The target is chosen by writability, in this order:

1. **`/usr/local/bin/tt`** — preferred; on `PATH` for all users. Used when
   `/usr/local/bin` is writable (the macOS `.pkg` postinstall runs as root, so it
   normally is; on Linux `install.sh` uses `sudo` when available).
2. **`~/.local/bin/tt`** — fallback when `/usr/local/bin` is not writable. The
   installer creates `~/.local/bin` if missing. This directory is on `PATH` by
   default on most modern Linux desktops (and via the XDG user-dirs convention);
   if it is not, the installer prints a one-line hint to add it.

`which tt` after a single install run resolves to whichever of these two the
installer chose, and `tt status` runs immediately against the shared DB.

## How `tt-launcher.sh` finds and runs the CLI

`tt-launcher.sh` is dependency-free POSIX `sh`. When invoked it:

1. **Finds the CLI entrypoint.** It searches the known install locations for
   `packages/cli/dist/bin.js` (the canonical relative path, mirrored in
   `packages/cli/package.json`):
   - macOS: `/Applications/Stint.app/Contents/Resources/app/packages/cli/dist/bin.js`
     (and the `~/Applications` per-user variant);
   - Linux: `/opt/stint/resources/app/...` or `/opt/stint/...`, with the
     `~/.local/opt/stint` per-user fallback.
2. **Finds a runtime.** It prefers the **Electron-bundled Node**: the GUI's
   Electron binary run with `ELECTRON_RUN_AS_NODE=1` behaves as a plain Node, so
   `tt` works with **no separate Node install**. If no bundle is found it falls
   back to a system `node` (must be ≥ 22.5 for `node:sqlite`).
3. **Exec's** the runtime against `bin.js`, forwarding all arguments
   (`exec … "$@"`), so `tt`'s exit code and stdio are pristine.

## Verifying the install

The single-artifact behavior is proven by the **CHECK INSTALL** procedure in
`acceptance/manual/runbook.md` (the MANUAL AC for §19 R02): one install run must
leave **both** the GUI in Applications/the launcher **and** `tt` on `PATH`
(`which tt` resolves; `tt status` runs without a separate Node), and uninstall
must remove both.
