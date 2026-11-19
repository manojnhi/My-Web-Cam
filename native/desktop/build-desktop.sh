#!/usr/bin/env bash
set -euo pipefail

echo "Installing Desktop dependencies and building My Web Cam..."
npm install
npm run build

OS_NAME="$(uname -s)"
case "$OS_NAME" in
  Linux*)  npm run dist:linux ;;
  Darwin*) npm run dist:mac ;;
  MINGW*|MSYS*|CYGWIN*) npm run dist:win ;;
  *) echo "Unknown OS: $OS_NAME. Run npm run dist:win, dist:mac, or dist:linux manually." ;;
esac
