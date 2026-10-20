#!/bin/bash
# Double-click this file in Finder to start the Scavenger Royale server.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed - it is needed to run the game server."
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Node.js with Homebrew..."
    brew install node
  else
    echo "Opening nodejs.org - install the LTS version, then double-click this file again."
    open "https://nodejs.org/"
    read -r -p "Press Enter to close..."
    exit 1
  fi
fi
node server.js
read -r -p "Server stopped. Press Enter to close..."
