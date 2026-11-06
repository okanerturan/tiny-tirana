#!/bin/bash
# Pull new ai-toolkit sample images for run $1 into data/eval_v3/samples and rebuild the checkpoint page. One pass.
set -u; RUN=${1:-tiranaiso_v3}; D=data/eval_v3/samples; mkdir -p $D; new=0
files=$(timeout 90 colab --auth=oauth2 ls -s tirana /content/output/$RUN/samples 2>/dev/null | grep -E '__[0-9]{9}_[0-9]\.jpg$')
for f in $files; do
  [ -f "$D/$f" ] && continue
  timeout 90 colab --auth=oauth2 download -s tirana "/content/output/$RUN/samples/$f" "$D/$f" 2>&1 | grep -q Downloaded && new=$((new+1))
done
[ $new -gt 0 ] && python3 -I post/eval_page.py $D | sed "s/^/$(date +%H:%M) +$new new: /"
echo "$files" | grep -q '__000002000_3\.jpg' && [ -f "$D/$(echo "$files" | grep '__000002000_3\.jpg')" ] && exit 10
exit 0
