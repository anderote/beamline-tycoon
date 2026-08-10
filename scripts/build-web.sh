#!/usr/bin/env bash
# Production build for the deep-tech-week.com deployment.
# Output: dist/ ready to copy into deep-tech-week/apps/web/static/beamline-tycoon-game
#
# Deployment is deliberately MANUAL — the site hosts a prebuilt copy of this
# repo and redeploys through Vercel when that copy is pushed, so pushing the
# built files there is what makes the live site update. The remaining steps are
# printed at the end of this script.
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

SITE="${DTW_PATH:-../deep-tech-week}"
cat <<EOF

Built. To publish (manual by design):

  rsync -a --delete dist/ $SITE/apps/web/static/beamline-tycoon-game/
  cd $SITE
  git add apps/web/static/beamline-tycoon-game
  git commit -m "chore(beamline-tycoon): sync game build from \$(git -C "$PWD" rev-parse --short HEAD)"
  git push origin main        # this is what goes live

Asset filenames are content-hashed, so an unchanged game leaves the tree
identical and there is nothing to commit. Worth booting dist/ from a plain
static server before pushing — vite's dev server hides missing-asset and
base-path mistakes that only show up in the built bundle.
EOF
