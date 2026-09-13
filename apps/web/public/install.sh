#!/bin/sh
# OpenRemote host CLI installer.
#   curl -fsSL https://open-remote-sigma.vercel.app/install.sh | sh
#
# Detects your OS/arch, downloads the matching `openremote` binary from the
# latest GitHub Release, and installs it to a directory on your PATH. No
# dependencies required.
set -e

# Binaries are published as GitHub Release assets (not committed to the repo).
# Override RELEASE_BASE to pin a specific tag, e.g.
#   RELEASE_BASE=https://github.com/phyra-research/open-remote/releases/download/v0.2.0
REPO="${OPENREMOTE_REPO:-phyra-research/open-remote}"
RELEASE_BASE="${OPENREMOTE_RELEASE_BASE:-https://github.com/${REPO}/releases/latest/download}"
INSTALL_DIR="${OPENREMOTE_INSTALL_DIR:-$HOME/.openremote/bin}"

# ── detect platform ──────────────────────────────────────────────────────────
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *) echo "Unsupported OS: $os (macOS and Linux only for now)"; exit 1 ;;
esac
case "$arch" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64)  arch="x64" ;;
  *) echo "Unsupported architecture: $arch"; exit 1 ;;
esac

asset="openremote-${os}-${arch}"
url="${RELEASE_BASE}/${asset}"

echo "OpenRemote installer"
echo "  platform: ${os}-${arch}"
echo "  download: ${url}"
echo ""

# ── download ─────────────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
tmp="$(mktemp)"
if ! curl -fSL "$url" -o "$tmp"; then
  echo "Failed to download $url"
  echo "This platform's binary may not be in the latest release yet."
  echo "See https://github.com/${REPO}/releases"
  exit 1
fi
chmod +x "$tmp"
mv "$tmp" "$INSTALL_DIR/openremote"

echo "✓ Installed to $INSTALL_DIR/openremote"

# ── PATH hint ────────────────────────────────────────────────────────────────
case ":$PATH:" in
  *":$INSTALL_DIR:"*) : ;; # already on PATH
  *)
    echo ""
    echo "Add it to your PATH by adding this line to your shell profile:"
    echo "    export PATH=\"$INSTALL_DIR:\$PATH\""
    echo "Then restart your shell (or run that line now)."
    ;;
esac

echo ""
echo "Next steps:"
echo "    openremote login       # link this machine to your account"
echo "    cd ~/your/project"
echo "    openremote host        # start controlling it from the web app"
