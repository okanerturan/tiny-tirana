# Repaint only the scene/checkpoint pairs that have no map.png yet (after the OOM), one model load per checkpoint.
import os, subprocess
O = '/content/output/tiranaiso_v3'
ck = {'s0750': f'{O}/tiranaiso_v3_000000750.safetensors', 's1000': f'{O}/tiranaiso_v3_000001000.safetensors',
      's1250': f'{O}/tiranaiso_v3_000001250.safetensors', 's1500': f'{O}/tiranaiso_v3_000001500.safetensors',
      's1750': f'{O}/tiranaiso_v3_000001750.safetensors', 's2000': f'{O}/tiranaiso_v3.safetensors'}
scenes = ['skanderbeg', 'mother_teresa', 'air_albania', 'residential', 'lake', 'castle_tanners', 'blloku', 'grand_park']
cmds = []
for tag, path in ck.items():
    todo = [s for s in scenes if not os.path.exists(f'/content/sc_{tag}_{s}/map.png')]
    if todo:
        jobs = ','.join(f'/content/scene_{s}.png=/content/sc_{tag}_{s}' for s in todo)
        cmds.append(f'echo "=== {tag} ({len(todo)})"; python /content/joint.py --jobs {jobs} --lora {path} --batch 4')
if not cmds:
    print('nothing to do')
else:
    subprocess.Popen(['bash', '-c', ' ; '.join(cmds) + ' ; echo REST_DONE'], stdout=open('/content/scenes_rest.log', 'w'), stderr=subprocess.STDOUT, start_new_session=True)
    print('launched', len(cmds), 'checkpoint group(s)')
