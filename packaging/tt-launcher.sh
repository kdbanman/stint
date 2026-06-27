#!/bin/sh
# tt-launcher.sh — the on-PATH `tt` shim (PRD §19 R02).
#
# This small, dependency-free POSIX-sh script is what gets symlinked onto PATH
# (/usr/local/bin/tt, falling back to ~/.local/bin/tt) by the single installer.
# It makes `tt` reachable WITHOUT a separate Node install: it locates the CLI
# entrypoint (packages/cli/dist/bin.js) inside the installed GUI app bundle and
# exec's the Electron-bundled Node against it, forwarding every argument. A
# system Node >= 22.5 is used as a fallback when the bundled Node is not found.
#
# The single installer (.pkg postinstall on macOS, install.sh on Linux) makes
# /usr/local/bin/tt -> this file. Because it is exec'd through its real path,
# the bundle search below is relative to the INSTALLED app, not to this script.
#
# It consumes the build matrix output (§19 R01) and the version stamp (§19 R06);
# it does not produce them.

set -eu

# Canonical relative path to the CLI entrypoint inside the app's resources. This
# mirrors the `bin` mapping in packages/cli/package.json (dist/bin.js). Kept here
# as one constant so both platforms agree on the target.
CLI_REL="packages/cli/dist/bin.js"

# --- Locate the installed CLI entrypoint (bin.js) ---------------------------
# Search the known per-platform install locations in priority order. The first
# bin.js that exists wins.
BIN_JS=""
for candidate in \
  "/Applications/Stint.app/Contents/Resources/app/${CLI_REL}" \
  "${HOME}/Applications/Stint.app/Contents/Resources/app/${CLI_REL}" \
  "/opt/stint/resources/app/${CLI_REL}" \
  "/opt/stint/${CLI_REL}" \
  "${HOME}/.local/opt/stint/resources/app/${CLI_REL}" \
  "${HOME}/.local/opt/stint/${CLI_REL}"
do
  if [ -f "${candidate}" ]; then
    BIN_JS="${candidate}"
    break
  fi
done

if [ -z "${BIN_JS}" ]; then
  echo "tt: could not find the Stint CLI (${CLI_REL}) in any installed app bundle." >&2
  echo "tt: reinstall Stint (macOS .pkg or Linux packaging/linux/install.sh)." >&2
  exit 127
fi

# --- Locate a Node runtime --------------------------------------------------
# Prefer the Electron-bundled Node so `tt` works with no separate Node install.
# On macOS the Electron binary doubles as a Node runtime when ELECTRON_RUN_AS_NODE
# is set. On Linux the AppImage / extracted bundle ships the same Electron binary.
APP_ROOT_MAC="/Applications/Stint.app"
[ -d "${HOME}/Applications/Stint.app" ] && [ ! -d "${APP_ROOT_MAC}" ] && APP_ROOT_MAC="${HOME}/Applications/Stint.app"

ELECTRON_BIN=""
for cand in \
  "${APP_ROOT_MAC}/Contents/MacOS/Stint" \
  "/opt/stint/stint" \
  "/opt/stint/Stint" \
  "${HOME}/.local/opt/stint/stint" \
  "${HOME}/.local/opt/stint/Stint"
do
  if [ -x "${cand}" ]; then
    ELECTRON_BIN="${cand}"
    break
  fi
done

if [ -n "${ELECTRON_BIN}" ]; then
  # ELECTRON_RUN_AS_NODE turns the Electron binary into a plain Node runtime.
  ELECTRON_RUN_AS_NODE=1 exec "${ELECTRON_BIN}" "${BIN_JS}" "$@"
fi

# Fallback: a system Node on PATH (must be >= 22.5 for node:sqlite).
if command -v node >/dev/null 2>&1; then
  exec node "${BIN_JS}" "$@"
fi

echo "tt: no runtime found — neither the bundled Electron Node nor a system 'node' (>= 22.5)." >&2
exit 127
