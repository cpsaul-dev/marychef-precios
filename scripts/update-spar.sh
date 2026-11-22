#!/bin/sh
# Weekly on the Mac: refresh SPAR and publish it. Safe to run again; it never publishes bad data.
set -e
cd "$(dirname "$0")/.."
git pull --ff-only -q origin main
node scripts/update-spar.js
if [ -n "$(git status --porcelain data)" ]; then
  git add data
  git commit -q -m "chore(prices): update SPAR snapshot"
  git push -q origin main
fi
