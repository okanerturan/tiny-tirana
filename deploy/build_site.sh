#!/bin/bash
# Build the public site into dist/ from the allowlist only (no Google-render material, no dev pages, no tiles: those go to R2).
set -e; cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist
cp viewer/index.html dist/
rsync -a --exclude '.DS_Store' viewer/app dist/
rsync -a --exclude '.DS_Store' viewer/world dist/
echo "dist: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
