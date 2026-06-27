#!/bin/sh
# postinstall.sh — macOS .pkg postinstall (PRD §19 R02).
#
# The .pkg payload has already placed Stint.app into /Applications (the GUI half
# of the single install). This postinstall script does the SECOND half: it puts
# `tt` on PATH by symlinking it to the bundled launcher shim. One .pkg
# double-click therefore satisfies R02 entirely (app -> /Applications via
# payload, `tt` -> PATH via this script).
#
# Installer runs postinstall scripts as root, so /usr/local/bin is normally
# writable; we still fall back to ~/.local/bin to be safe.

set -eu

APP="/Applications/Stint.app"
LAUNCHER="${APP}/Contents/Resources/app/packaging/tt-launcher.sh"

if [ ! -f "${LAUNCHER}" ]; then
  echo "postinstall: launcher not found at ${LAUNCHER}; cannot put tt on PATH." >&2
  exit 1
fi

chmod +x "${LAUNCHER}" 2>/dev/null || true

# Pick the symlink location: prefer /usr/local/bin, fall back to ~/.local/bin.
TARGET_DIR="/usr/local/bin"
if [ ! -d "${TARGET_DIR}" ]; then
  mkdir -p "${TARGET_DIR}" 2>/dev/null || true
fi

if [ -w "${TARGET_DIR}" ]; then
  LINK="${TARGET_DIR}/tt"
else
  # $HOME of the installing (console) user. Installer runs as root, so derive it.
  USER_HOME="${HOME:-}"
  if [ -z "${USER_HOME}" ] && [ -n "${USER:-}" ]; then
    USER_HOME=$(eval echo "~${USER}")
  fi
  TARGET_DIR="${USER_HOME}/.local/bin"
  mkdir -p "${TARGET_DIR}"
  LINK="${TARGET_DIR}/tt"
fi

# Replace any existing tt symlink/file, then point it at the launcher.
rm -f "${LINK}"
ln -s "${LAUNCHER}" "${LINK}"
chmod +x "${LINK}" 2>/dev/null || true

echo "postinstall: tt installed at ${LINK} -> ${LAUNCHER}"
echo "postinstall: Stint.app installed in /Applications."

# Hint if ~/.local/bin was used and may not be on PATH.
case ":${PATH}:" in
  *":${TARGET_DIR}:"*) : ;;
  *) echo "postinstall: add ${TARGET_DIR} to your PATH to use tt." ;;
esac

exit 0
