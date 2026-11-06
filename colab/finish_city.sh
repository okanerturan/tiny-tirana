#!/bin/bash
# After regions A (tirana), B (tirana2), C (tirana3) are painted: gather their stores, run the seam blocks on tirana
# pinned to both sides, fetch the final store and build the app's tile pyramid.  Steps are resumable: re-run to continue.
#   colab/finish_city.sh gather | seams | final
set -e
cd "$(dirname "$0")/.."
SP=${SP:-/tmp}
step=${1:-gather}

pack() {  # pack /content/big_store on SESSION into /content/store_SESSION.tar and download it to data/stores/SESSION/
  S=$1; mkdir -p data/stores/$S
  printf 'import subprocess\nprint(subprocess.run("cd /content && tar cf store_%s.tar big_store && ls -la store_%s.tar", shell=True, capture_output=True, text=True).stdout)\n' $S $S > $SP/pack_$S.py
  timeout 600 colab --auth=oauth2 exec -s $S --timeout 580 -f $SP/pack_$S.py 2>&1 | tail -1
  colab/download_big.sh $S /content/store_$S.tar data/stores/$S/store.tar | tail -1
  rm -rf data/stores/$S/big_store && tar xf data/stores/$S/store.tar -C data/stores/$S && echo "unpacked $S: $(ls data/stores/$S/big_store | grep -c '^t_') tiles"
}

if [ "$step" = gather ]; then
  pack tirana2 & pack tirana3 & wait
  python3 -I post/merge_stores.py data/stores/merged data/stores/tirana2/big_store data/stores/tirana3/big_store
  # the seam blocks need every painted tile they overlap; ship those from B and C to tirana's store
  python3 -I post/merge_stores.py --subset data/seam_plan.json --tar data/seam_tiles.tar data/stores/merged
  colab/upload_big.sh tirana data/seam_tiles.tar /content/seam_tiles.tar | tail -1
  echo GATHER_DONE
fi

if [ "$step" = seams ]; then
  printf 'import subprocess\ncmd = "while pgrep -f [b]locks.py >/dev/null; do sleep 20; done; cd /content && mkdir -p seam_in && tar xf seam_tiles.tar -C seam_in && cp -n seam_in/big_store/* big_store/ && python /content/blocks.py --plan /content/seam_plan_data.json --shots /content/big_in/shots --store /content/big_store --lora /content/output/tiranaiso_v3/tiranaiso_v3_000001250.safetensors --work /content/blockwork_seam && echo SEAMS_DONE"\nsubprocess.Popen(["bash", "-c", cmd], stdout=open("/content/seams.log", "a"), stderr=subprocess.STDOUT, start_new_session=True)\nprint("seams queued")\n' > $SP/seams.py
  timeout 90 colab --auth=oauth2 exec -s tirana --timeout 60 -f $SP/seams.py 2>&1 | tail -1
fi

if [ "$step" = final ]; then
  pack tirana
  python3 -I post/merge_stores.py data/stores/merged data/stores/tirana/big_store
  echo FINAL_GATHERED
fi
