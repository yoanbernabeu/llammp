#!/bin/bash
#
# Llammp installer.
#
#   curl -fsSL https://raw.githubusercontent.com/yoanbernabeu/llammp/main/install.sh | bash
#
# Downloads the latest release, installs it into /Applications and clears the macOS
# quarantine flag. Llammp is distributed only through GitHub and is not notarized by
# Apple, so without that last step macOS refuses to open it ("app is damaged").

set -euo pipefail

REPO="${LLAMMP_REPO:-yoanbernabeu/llammp}"
APP_NAME="Llammp.app"
INSTALL_DIR="${LLAMMP_INSTALL_DIR:-/Applications}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
info()  { printf '  %s\n' "$1"; }
warn()  { printf '\033[33m  %s\033[0m\n' "$1"; }
die()   { printf '\033[31mError: %s\033[0m\n' "$1" >&2; exit 1; }

bold "Installing Llammp"

[[ "$(uname -s)" == "Darwin" ]] || die "Llammp only runs on macOS."

MACOS_MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
MACOS_MINOR="$(sw_vers -productVersion | cut -d. -f2)"
if (( MACOS_MAJOR < 14 )) || { (( MACOS_MAJOR == 14 )) && (( MACOS_MINOR < 2 )); }; then
    warn "macOS 14.2 or later is recommended; system audio capture may not work here."
fi

for tool in curl unzip; do
    command -v "$tool" >/dev/null || die "$tool is required but not installed."
done

info "Looking up the latest release…"
API="https://api.github.com/repos/${REPO}/releases/latest"
ASSET_URL="$(curl -fsSL "$API" \
    | grep -o '"browser_download_url": *"[^"]*Llammp[^"]*\.zip"' \
    | head -1 | cut -d'"' -f4 || true)"

[[ -n "$ASSET_URL" ]] || die "No release asset found. Check https://github.com/${REPO}/releases"

VERSION="$(basename "$(dirname "$ASSET_URL")")"
info "Found ${VERSION}"

info "Downloading…"
curl -fsSL --progress-bar -o "$TMP_DIR/llammp.zip" "$ASSET_URL"

info "Extracting…"
unzip -q "$TMP_DIR/llammp.zip" -d "$TMP_DIR"

SRC="$(find "$TMP_DIR" -maxdepth 2 -name "$APP_NAME" -type d | head -1)"
[[ -n "$SRC" ]] || die "$APP_NAME not found inside the archive."

DEST="$INSTALL_DIR/$APP_NAME"
if [[ -d "$DEST" ]]; then
    info "Removing the previous version…"
    rm -rf "$DEST" 2>/dev/null || sudo rm -rf "$DEST"
fi

info "Installing to $INSTALL_DIR…"
cp -R "$SRC" "$DEST" 2>/dev/null || sudo cp -R "$SRC" "$DEST"

# Gatekeeper marks anything downloaded from the internet. Llammp is signed ad-hoc, not
# notarized, so the flag has to go or the app will not open at all.
info "Clearing the quarantine flag…"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || sudo xattr -dr com.apple.quarantine "$DEST"

bold "Done — Llammp is installed."
echo
echo "  Two macOS permissions are required on first launch:"
echo
echo "    1. Automation → Music     a dialog appears; click OK."
echo "                              Until then Llammp shows \"MUSIC.APP CLOSED\"."
echo "    2. Screen & System Audio Recording  →  enable Llammp by hand in"
echo "       System Settings › Privacy & Security. Needed for the visualizer only."
echo
echo "  Llammp ships with no skin. Drop a .wsz from https://skins.webamp.org"
echo "  onto the window, or right-click → Add a skin…"
echo
echo "  Open it with:  open -a Llammp"
