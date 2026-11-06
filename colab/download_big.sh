#!/bin/bash
# download_big.sh SESSION REMOTE LOCAL -- split on the VM into 20 MB parts, download each (retries), join, verify sha256.
set -e; S=$1; R=$2; L=$3; B=$(basename "$R"); T=$(mktemp -d)
cat > "$T/split.py" <<PY
import hashlib, os, subprocess
import shutil
d = '/content/dl_$B'; shutil.rmtree(d, ignore_errors=True); os.makedirs(d)   # stale parts from an earlier file with the same name would be joined too
subprocess.run(['split', '-b', '20m', '$R', d + '/$B.part.'], check=True)
h = hashlib.sha256()
with open('$R', 'rb') as f:
    for c in iter(lambda: f.read(1 << 24), b''): h.update(c)
print('SHA', h.hexdigest(), 'PARTS', ' '.join(sorted(os.listdir(d))))
PY
OUT=$(timeout 300 colab --auth=oauth2 exec -s "$S" --timeout 240 -f "$T/split.py" 2>&1 | grep '^SHA')
WANT=$(echo "$OUT" | awk '{print $2}'); PARTS=$(echo "$OUT" | cut -d' ' -f4-)
mkdir -p "$T/p"
for p in $PARTS; do
  for try in 1 2 3 4; do
    timeout 180 colab --auth=oauth2 download -s "$S" "/content/dl_$B/$p" "$T/p/$p" 2>&1 | grep -q Downloaded && break
    echo "retry $p ($try)"; sleep 3
  done
done
cat "$T"/p/$B.part.* > "$L.tmp"
GOT=$(shasum -a 256 "$L.tmp" | cut -d' ' -f1)
if [ "$GOT" = "$WANT" ]; then mv "$L.tmp" "$L"; echo "OK $L $(echo $PARTS | wc -w | tr -d ' ') parts sha256 $GOT"; else echo "SHA MISMATCH ($GOT vs $WANT)"; exit 1; fi
rm -rf "$T"
