# Paint one region of the big city (env: PLAN, SHOTS_TAR, LORA_SCALE, PREP=none|blur). Background; log /content/region.log
import os, subprocess
plan, tarf = os.environ['PLAN'], os.environ.get('SHOTS_TAR', '')
scale, prep = os.environ.get('LORA_SCALE', '1.0'), os.environ.get('PREP', 'none')
lora = next(p for p in ['/content/output/tiranaiso_v3/tiranaiso_v3_000001250.safetensors', '/content/tiranaiso_v3_000001250.safetensors'] if os.path.exists(p))
cmd = f"""
cd /content && mkdir -p region_in && {'tar xf ' + tarf + ' -C region_in &&' if tarf else ''} \
python /content/blocks.py --plan {plan} --shots {os.environ.get('SHOTS', '/content/region_in/shots')} --store /content/big_store \
  --lora {lora} --lora_scale {scale} --prep {prep} --work /content/blockwork_big && echo REGION_DONE
"""
subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/region.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
print('region launched', plan, 'scale', scale, 'prep', prep)
