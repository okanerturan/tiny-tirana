# Paint the city-airport corridor (env: PLAN, SHOTS_TAR, STORE_TAR). Lattice noise (joint.lattice_noise) so the corridor's
# own blocks share noise where they overlap. Background; log /content/corridor.log
import os, subprocess
plan, shots, store = os.environ['PLAN'], os.environ['SHOTS_TAR'], os.environ['STORE_TAR']
lora = next(p for p in ['/content/output/tiranaiso_v3/tiranaiso_v3_000001250.safetensors', '/content/tiranaiso_v3_000001250.safetensors'] if os.path.exists(p))
cmd = f"""
cd /content && mkdir -p corridor_in && tar xf {shots} -C corridor_in && {{ [ -d /content/big_store ] || tar xf {store} -C /content; }} && \\
python /content/blocks.py --plan {plan} --shots /content/corridor_in/shots --store /content/big_store \\
  --lora {lora} --lattice --work /content/blockwork_corridor && echo CORRIDOR_DONE
"""
subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/corridor.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
print('corridor launched', plan)
