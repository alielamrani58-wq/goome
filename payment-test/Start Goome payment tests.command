#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v npm >/dev/null 2>&1; then
  print 'Node.js is required to open the local Goöme test sites.'
  read -r '?Press Return to close.'
  exit 1
fi
print 'Goöme TEST ONLY · Keep this window open. Control-C stops the local sites.'
print 'Passenger: http://127.0.0.1:4180/'
print 'Driver: http://127.0.0.1:4181/'
print 'Admin: http://127.0.0.1:4182/'
npm start
