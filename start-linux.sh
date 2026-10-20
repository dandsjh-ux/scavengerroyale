#!/bin/bash
# Run this file (double-click "Run in terminal", or ./start-linux.sh) to start the server.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it (e.g. 'sudo apt install nodejs' or from https://nodejs.org) and run this again."
  read -r -p "Press Enter to close..."
  exit 1
fi
node server.js
