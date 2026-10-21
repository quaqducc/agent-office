#!/bin/sh
# Agent Company installer (macOS / Linux):
#   curl -fsSL https://raw.githubusercontent.com/quaqducc/agent-company/main/install.sh | sh
# Installs the npm package globally. Needs Node.js 22.19+ (with npm) already installed.
set -eu

PKG="@quaqducc/agent-company"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Agent Company needs Node.js 22.19 or newer (with npm)."
  echo "Install it from https://nodejs.org, or with a version manager, e.g.:"
  echo "  curl -fsSL https://fnm.vercel.app/install | bash && fnm install 24"
  exit 1
fi

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)'; then
  echo "Agent Company needs Node.js 22.19 or newer; this machine has $(node --version)."
  echo "Update Node.js (https://nodejs.org) and run this installer again."
  exit 1
fi

echo "Installing $PKG ..."
if ! npm install -g "$PKG"; then
  echo
  echo "Global install failed. If it was a permission error, either use a Node version manager"
  echo "(fnm, nvm) or point npm at a folder you own:"
  echo "  npm config set prefix \"\$HOME/.npm-global\" && export PATH=\"\$HOME/.npm-global/bin:\$PATH\""
  exit 1
fi

echo
echo "Done. Start it with:  agent-company"
echo "The office opens at http://127.0.0.1:4317 — enter your API endpoint and key there."
