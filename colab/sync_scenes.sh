#!/bin/bash
# One pass: download finished scene paintings that we don't have yet, rebuild viewer/scenes. Exit 10 when all 48 are local.
cd "$(dirname "$0")/.."; new=0; have=0
for t in s0750 s1000 s1250 s1500 s1750 s2000; do for k in skanderbeg mother_teresa air_albania residential lake castle_tanners blloku grand_park; do
  f=data/scenes/out/${t}_$k.png; [ -f "$f" ] && { have=$((have+1)); continue; }
  timeout 120 colab --auth=oauth2 download -s tirana /content/sc_${t}_$k/map.png "$f" 2>&1 | grep -q Downloaded && { new=$((new+1)); have=$((have+1)); }
done; done
[ $new -gt 0 ] && python3 -I post/scenes_page.py >/dev/null && echo "$(date +%H:%M) +$new (have $have/48)"
[ $have -ge 48 ] && exit 10; exit 0
