#!/bin/bash
# Budget guard: stop Colab session $1 after $2 minutes, whatever happens. Run in background locally.
S=$1; M=$2; END=$(( $(date +%s) + M*60 ))
echo "guard: will stop $S at $(date -r $END)"
while [ $(date +%s) -lt $END ]; do sleep 30; colab --auth=oauth2 sessions 2>/dev/null | grep -q "$S" || { echo "guard: $S already gone"; exit 0; }; done
timeout 120 colab --auth=oauth2 stop -s "$S" 2>&1 | sed -E 's#https?://[^ ]+#[URL]#g'; echo "guard: stopped $S at $(date)"
