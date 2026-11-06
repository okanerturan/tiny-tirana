#!/bin/bash
# upload_big.sh SESSION LOCAL REMOTE  -- 20 MB parts, retries, join on VM, verify sha256.
set -e; S=$1; L=$2; R=$3; B=$(basename "$R"); T=$(mktemp -d)
split -b 20m "$L" "$T/$B.part."
WANT=$(shasum -a 256 "$L" | cut -d' ' -f1)
printf 'import os; os.makedirs("/content/parts_%s", exist_ok=True); print("ok")\n' "$B" > "$T/mk.py"
colab --auth=oauth2 exec -s "$S" --timeout 60 -f "$T/mk.py" >/dev/null 2>&1
for f in "$T/$B".part.*; do
  for try in 1 2 3 4; do
    colab --auth=oauth2 upload -s "$S" "$f" "/content/parts_$B/$(basename $f)" 2>&1 | grep -q Uploaded && break
    echo "retry $(basename $f) ($try)"; sleep 3
  done
done
cat > "$T/join.py" <<PY
import glob, hashlib, os, shutil
fs = sorted(glob.glob('/content/parts_$B/$B.part.*'))
h = hashlib.sha256()
with open('$R.tmp', 'wb') as o:
    for f in fs:
        d = open(f, 'rb').read(); o.write(d); h.update(d)
ok = h.hexdigest() == '$WANT'
if ok: os.replace('$R.tmp', '$R'); shutil.rmtree('/content/parts_$B')
print('JOIN', len(fs), 'parts', 'OK' if ok else 'SHA MISMATCH')
PY
colab --auth=oauth2 exec -s "$S" --timeout 120 -f "$T/join.py" 2>&1 | grep JOIN; rm -rf "$T"
