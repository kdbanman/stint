#!/bin/sh
# build-pkg.sh — assemble the single-installer macOS .pkg (PRD §19 R02).
#
# Takes the already-built Stint.app (produced by §19 R01's electron-builder run)
# and emits Stint-<version>.pkg whose payload installs the app into /Applications
# AND whose postinstall (postinstall.sh) symlinks `tt` onto PATH. The resulting
# single .pkg double-click does both halves of R02.
#
# This script CONSUMES the build artifact (R01) and the version stamp (R06); it
# does not build the app or compute the version itself.
#
# Usage:
#   packaging/macos/build-pkg.sh <path-to-Stint.app> <version> [output-dir]
# Example:
#   packaging/macos/build-pkg.sh packages/gui/dist-pack/mac/Stint.app 2026.6.27 dist-pack
#
# Requires the macOS toolchain (pkgbuild, productbuild). macOS only.

set -eu

APP_PATH="${1:?usage: build-pkg.sh <Stint.app> <version> [out-dir]}"
VERSION="${2:?usage: build-pkg.sh <Stint.app> <version> [out-dir]}"
OUT_DIR="${3:-dist-pack}"

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

if [ ! -d "${APP_PATH}" ]; then
  echo "build-pkg: app bundle not found: ${APP_PATH}" >&2
  exit 1
fi

# The launcher shim must be inside the bundle's resources for postinstall to find
# it at /Applications/Stint.app/Contents/Resources/app/packaging/tt-launcher.sh.
LAUNCHER_IN_APP="${APP_PATH}/Contents/Resources/app/packaging/tt-launcher.sh"
if [ ! -f "${LAUNCHER_IN_APP}" ]; then
  echo "build-pkg: launcher missing from bundle: ${LAUNCHER_IN_APP}" >&2
  echo "build-pkg: ensure packaging/ is included in the electron-builder files glob." >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

# Staging dir for the postinstall script (pkgbuild --scripts).
SCRIPTS_DIR=$(mktemp -d)
trap 'rm -rf "${SCRIPTS_DIR}"' EXIT
cp "${SCRIPT_DIR}/postinstall.sh" "${SCRIPTS_DIR}/postinstall"
chmod +x "${SCRIPTS_DIR}/postinstall"

COMPONENT_PKG="${OUT_DIR}/stint-component.pkg"
FINAL_PKG="${OUT_DIR}/Stint-${VERSION}.pkg"

# 1. Component package: payload (Stint.app -> /Applications) + postinstall script.
pkgbuild \
  --install-location /Applications \
  --component "${APP_PATH}" \
  --scripts "${SCRIPTS_DIR}" \
  --identifier com.stint.app \
  --version "${VERSION}" \
  "${COMPONENT_PKG}"

# 2. Distribution package wrapping the component (the double-clickable installer).
productbuild \
  --distribution "${SCRIPT_DIR}/distribution.xml" \
  --package-path "${OUT_DIR}" \
  "${FINAL_PKG}"

rm -f "${COMPONENT_PKG}"

echo "build-pkg: wrote ${FINAL_PKG}"
