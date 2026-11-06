#!/bin/bash
# Build dist/ and deploy the Worker. A running R2 tile upload is paused first (Cloudflare's API rate limit is shared:
# 1200 requests / 5 min) and restarted after the deploy (it resumes: --skip-existing).
cd "$(dirname "$0")/.."
up=$(pgrep -f "deploy/r2_upload.py" >/dev/null && echo 1); pkill -f "deploy/r2_upload.py"
bash deploy/build_site.sh
for i in 1 2 3 4 5 6 7 8 9 10; do
  o=$(env -u CLOUDFLARE_API_TOKEN wrangler deploy 2>&1)
  if echo "$o" | grep -q "Current Version ID"; then echo "$o" | grep -E "Uploaded [0-9]+ files|Current Version"; ok=1; break; fi
  echo "deploy try $i: $(echo "$o" | grep -oE 'code: [0-9]+' | head -1), waiting"; sleep 45
done
if [ -n "$up" ]; then nohup python3 -I deploy/r2_upload.py viewer/tiles_shaped tiny-tirana-tiles v1 --skip-existing --threads 10 > data/r2_upload.log 2>&1 & echo "tile upload resumed (data/r2_upload.log)"; fi
[ -n "$ok" ] && echo SHIPPED
