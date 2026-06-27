#!/bin/sh
# uninstall.sh — reverse the Stint Linux single install (PRD §19 R02).
#
# Removes BOTH halves that install.sh created: the `tt` symlink on PATH and the
# GUI artifact (AppImage + .desktop entry + launcher shim), from whichever
# location install.sh used (system /opt or per-user ~/.local). The shared
# database is NOT touched — uninstall removes the app, never the user's data.
#
# Usage: packaging/linux/uninstall.sh

set -eu

SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

removed_any=0

# --- (b) Remove the tt symlink from both possible PATH locations -----------
for link in "/usr/local/bin/tt" "${HOME}/.local/bin/tt"; do
  if [ -L "${link}" ] || [ -e "${link}" ]; then
    case "${link}" in
      /usr/local/bin/tt) ${SUDO} rm -f "${link}" ;;
      *)                 rm -f "${link}" ;;
    esac
    echo "uninstall: removed tt symlink ${link}"
    removed_any=1
  fi
done

# --- (a) Remove the GUI artifact, .desktop entry, and launcher shim --------
for base in "/opt/stint:/usr/share/applications:${SUDO}" \
            "${HOME}/.local/opt/stint:${HOME}/.local/share/applications:"; do
  OPT_DIR=$(printf '%s' "${base}" | cut -d: -f1)
  DESKTOP_DIR=$(printf '%s' "${base}" | cut -d: -f2)
  RUN=$(printf '%s' "${base}" | cut -d: -f3)

  if [ -d "${OPT_DIR}" ]; then
    ${RUN} rm -rf "${OPT_DIR}"
    echo "uninstall: removed ${OPT_DIR}"
    removed_any=1
  fi
  DESKTOP_FILE="${DESKTOP_DIR}/stint.desktop"
  if [ -f "${DESKTOP_FILE}" ]; then
    ${RUN} rm -f "${DESKTOP_FILE}"
    echo "uninstall: removed ${DESKTOP_FILE}"
    if command -v update-desktop-database >/dev/null 2>&1; then
      ${RUN} update-desktop-database "${DESKTOP_DIR}" 2>/dev/null || true
    fi
    removed_any=1
  fi
done

if [ "${removed_any}" -eq 0 ]; then
  echo "uninstall: nothing to remove — Stint does not appear to be installed."
else
  echo "uninstall: Stint removed. Your time-tracking database was left untouched."
fi

exit 0
