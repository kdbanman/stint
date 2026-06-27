#!/bin/sh
# install.sh — Stint single installer for Linux (PRD §19 R02).
#
# One invocation does BOTH halves of R02:
#   (a) installs the GUI artifact (the AppImage) into /opt/stint (system) or
#       ~/.local/opt/stint (user fallback) and registers a .desktop launcher
#       entry so Stint appears in the app launcher; and
#   (b) symlinks `tt` onto PATH (/usr/local/bin/tt, falling back to
#       ~/.local/bin/tt) pointing at the bundled tt-launcher.sh.
#
# It CONSUMES the AppImage produced by §19 R01's electron-builder run; it does
# not build it. Run uninstall.sh to reverse both halves.
#
# Usage:
#   packaging/linux/install.sh <path-to-Stint.AppImage>
# Example:
#   packaging/linux/install.sh packages/gui/dist-pack/Stint-2026.6.27.AppImage

set -eu

APPIMAGE="${1:?usage: install.sh <path-to-Stint.AppImage>}"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
LAUNCHER_SRC="${SCRIPT_DIR}/../tt-launcher.sh"

if [ ! -f "${APPIMAGE}" ]; then
  echo "install: AppImage not found: ${APPIMAGE}" >&2
  exit 1
fi
if [ ! -f "${LAUNCHER_SRC}" ]; then
  echo "install: tt-launcher.sh not found at ${LAUNCHER_SRC}" >&2
  exit 1
fi

# Run privileged steps via sudo when available and not already root.
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

# --- (a) GUI: install AppImage + .desktop entry ----------------------------
# Prefer system-wide /opt/stint; fall back to per-user ~/.local/opt/stint.
if ${SUDO} mkdir -p /opt/stint 2>/dev/null && [ -w /opt/stint -o -n "${SUDO}" ]; then
  OPT_DIR="/opt/stint"
  DESKTOP_DIR="/usr/share/applications"
  ICON_DIR="/usr/share/icons/hicolor/512x512/apps"
  RUN="${SUDO}"
else
  OPT_DIR="${HOME}/.local/opt/stint"
  DESKTOP_DIR="${HOME}/.local/share/applications"
  ICON_DIR="${HOME}/.local/share/icons/hicolor/512x512/apps"
  RUN=""
  mkdir -p "${OPT_DIR}"
fi

APPIMAGE_DEST="${OPT_DIR}/Stint.AppImage"
${RUN} cp "${APPIMAGE}" "${APPIMAGE_DEST}"
${RUN} chmod +x "${APPIMAGE_DEST}"

# Place the launcher shim alongside the app so tt-launcher.sh resolves bin.js.
# The AppImage is self-contained; tt runs via system Node fallback if the
# bundled runtime is not extracted. Copy the shim to a stable location too.
${RUN} cp "${LAUNCHER_SRC}" "${OPT_DIR}/tt-launcher.sh"
${RUN} chmod +x "${OPT_DIR}/tt-launcher.sh"

# .desktop entry so Stint shows in the app launcher.
${RUN} mkdir -p "${DESKTOP_DIR}"
DESKTOP_FILE="${DESKTOP_DIR}/stint.desktop"
${RUN} sh -c "cat > '${DESKTOP_FILE}'" <<EOF
[Desktop Entry]
Type=Application
Name=Stint
Comment=Time tracker that bills by time
Exec=${APPIMAGE_DEST}
Icon=stint
Terminal=false
Categories=Utility;Office;
EOF
${RUN} chmod 644 "${DESKTOP_FILE}"

# Refresh the desktop database if the tool exists (non-fatal).
if command -v update-desktop-database >/dev/null 2>&1; then
  ${RUN} update-desktop-database "${DESKTOP_DIR}" 2>/dev/null || true
fi

# --- (b) CLI: symlink tt onto PATH -----------------------------------------
LAUNCHER_INSTALLED="${OPT_DIR}/tt-launcher.sh"
if ${RUN} test -w /usr/local/bin 2>/dev/null || { [ -n "${RUN}" ] && ${RUN} mkdir -p /usr/local/bin 2>/dev/null; }; then
  BIN_DIR="/usr/local/bin"
  LINK="${BIN_DIR}/tt"
  ${RUN} ln -sf "${LAUNCHER_INSTALLED}" "${LINK}"
else
  BIN_DIR="${HOME}/.local/bin"
  mkdir -p "${BIN_DIR}"
  LINK="${BIN_DIR}/tt"
  ln -sf "${LAUNCHER_INSTALLED}" "${LINK}"
fi

echo "install: Stint GUI installed at ${APPIMAGE_DEST} (.desktop: ${DESKTOP_FILE})."
echo "install: tt installed at ${LINK} -> ${LAUNCHER_INSTALLED}"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) : ;;
  *) echo "install: add ${BIN_DIR} to your PATH to use tt (e.g. in ~/.profile)." ;;
esac

exit 0
