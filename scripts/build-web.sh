#!/usr/bin/env bash
# Production build for the deep-tech-week.com deployment.
# Output: dist/ ready to copy into deep-tech-week/apps/web/static/beamline-tycoon-game
set -euo pipefail
cd "$(dirname "$0")/.."

npx vite build --base=./

# The local music library is personal/unlicensed and enormous — never ship it.
# The dev-only remote-drive command file must not ship either.
rm -rf dist/music dist/music-web dist/demo-commands.json

# Runtime-fetched sprite assets (not bundled by vite).
mkdir -p dist/assets
cp -R assets/backgrounds assets/components assets/decorations assets/textures assets/tiles dist/assets/

# Web soundtrack: licensed (CC0/CC-BY) tracks curated for public deployment.
if [ -f public/music-web/tracks.json ]; then
  mkdir -p dist/music
  cp -R public/music-web/ dist/music/
fi

du -sh dist
