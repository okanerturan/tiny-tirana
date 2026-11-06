# Paint a block plan (env: NAME, PLAN, SHOTS_TAR, STORE_TAR, optional ONLY "i,j;i,j"). Background; log /content/NAME.log
# The store tar holds big_store/ (neighbour tiles to pin to); it is unpacked once, so a later group reuses it.
import os, subprocess
name, plan, shots, store = os.environ['NAME'], os.environ['PLAN'], os.environ['SHOTS_TAR'], os.environ['STORE_TAR']
only = os.environ.get('ONLY', '')
lora = next(p for p in ['/content/output/tiranaiso_v3/tiranaiso_v3_000001250.safetensors', '/content/tiranaiso_v3_000001250.safetensors'] if os.path.exists(p))
wait = os.environ.get('WAIT_FOR', '')   # "LOG:TOKEN": start only after another run printed TOKEN
wcmd = f"until grep -q {wait.split(':')[1]} {wait.split(':')[0]} 2>/dev/null; do sleep 30; done && " if wait else ""
cmd = f"""
{wcmd}cd /content && mkdir -p {name}_in && tar xf {shots} -C {name}_in && {{ [ -d /content/big_store ] || tar xf {store} -C /content; }} && \\
python /content/blocks.py --plan {plan} --shots /content/{name}_in/shots --store /content/big_store \\
  --lora {lora} --lattice --work /content/blockwork_{name} {f'--only "{only}"' if only else ''} && echo {name.upper()}_DONE
"""
subprocess.Popen(['bash', '-c', cmd], stdout=open(f'/content/{name}.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
print('launched', name, plan, only or 'all')
