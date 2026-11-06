# Heal block-mode seams (env: TAR = strips tar on the VM, START = turbo start step, default 5). Background; log /content/heal.log
# Unpacks TAR into /content/heal_in/<round>/, runs joint.py --heal on every *_ctrl.jpg with ONE model load, then writes
# /content/heal_out_<round>.tar with each strip's map.jpg (q95) and prints HEAL_DONE.
import os, subprocess
tarf, start = os.environ['TAR'], os.environ.get('START', '5')
rnd = os.path.basename(tarf).replace('.tar', '')
lora = next(p for p in ['/content/output/tiranaiso_v3/tiranaiso_v3_000001250.safetensors', '/content/tiranaiso_v3_000001250.safetensors'] if os.path.exists(p))
cmd = f"""
set -e
cd /content && mkdir -p heal_in && tar xf {tarf} -C heal_in
JOBS=$(ls heal_in/{rnd}/*_ctrl.jpg | while read c; do n=$(basename $c _ctrl.jpg); echo -n "$c=/content/heal_out/{rnd}/$n,"; done | sed 's/,$//')
python /content/joint.py --jobs "$JOBS" --heal --start_step {start} --lora {lora} --batch 4
python - <<'EOF'
import os, tarfile
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
base = '/content/heal_out/{rnd}'
with tarfile.open('/content/heal_out_{rnd}.tar', 'w') as tf:
    for n in sorted(os.listdir(base)):
        p = os.path.join(base, n, 'map.png')
        if os.path.exists(p):
            Image.open(p).save(os.path.join(base, n, 'map.jpg'), quality=95)
            tf.add(os.path.join(base, n, 'map.jpg'), arcname=f'{rnd}/{{n}}.jpg')
EOF
echo HEAL_DONE
"""
subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/heal.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
print('heal launched', tarf, 'start', start)
