#!/bin/bash
# Shape + Deep Zoom build with a FIXED canvas (origin and size), so tile names stay stable between builds and an
# upload only sends what changed.   deploy/build_tiles.sh OUT_DIR   (e.g. viewer/tiles_shaped_v3)
set -e; cd "$(dirname "$0")/.."
OUT=$1; U0=-40960; V0=-69632; W=108544; H=100352
rm -rf data/stores/shaped_build "$OUT"
python3 -I post/shape.py data/stores/merged data/stores/shaped_build | tail -2
python3 -I - <<PY
import os, re
st='data/stores/shaped_build'; n=0
for f in os.listdir(st):
    m=re.match(r'[tm]_v(-?\d+)_u(-?\d+)\.png$', f)
    if m and not ($U0 <= int(m.group(2)) <= $U0 + $W - 2048 and $V0 <= int(m.group(1)) <= $V0 + $H - 2048): os.remove(os.path.join(st, f)); n+=1
print('outside the canvas, dropped', n // 2, 'tiles')
PY
python3 -I post/dzi_store.py data/stores/shaped_build "$OUT/map" --origin $U0,$V0 --size $W,$H --formats avif,webp > data/heal/dzi_build.log 2>&1
python3 -I post/tile_index.py "$OUT/map" > /dev/null
tail -1 data/heal/dzi_build.log; echo BUILD_DONE
