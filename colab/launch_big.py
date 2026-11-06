# Queue the 75 km2 city paint (shots + water patch: lakes cleaned on both shot grids, piers kept) (48 blocks) to start as soon as the airport blocks finish. Background; log /content/big.log
import subprocess
cmd = r"""
while pgrep -f '[b]locks.py --plan /content/airport_plan.json' >/dev/null; do sleep 30; done
cd /content && mkdir -p big_in && tar xf big_shots.tar -C big_in && tar xf big_patch.tar -C big_in && \
python /content/blocks.py --plan big_in/big_plan.json --shots big_in/shots --store /content/big_store \
  --lora /content/output/tiranaiso_v3/tiranaiso_v3_000001250.safetensors --work /content/blockwork_big
"""
subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/big.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
print('big paint queued after the airport')
