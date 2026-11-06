# Paint 8 scenes (heading 315) with every v3 checkpoint, one model load per checkpoint.
import os, subprocess
if subprocess.run("pgrep -f '[j]oint.py'", shell=True, capture_output=True, text=True).stdout.strip():
    print('ALREADY RUNNING')
else:
    O = '/content/output/tiranaiso_v3'
    ck = {'s0750': f'{O}/tiranaiso_v3_000000750.safetensors', 's1000': f'{O}/tiranaiso_v3_000001000.safetensors',
          's1250': f'{O}/tiranaiso_v3_000001250.safetensors', 's1500': f'{O}/tiranaiso_v3_000001500.safetensors',
          's1750': f'{O}/tiranaiso_v3_000001750.safetensors', 's2000': f'{O}/tiranaiso_v3.safetensors'}
    scenes = ['skanderbeg', 'mother_teresa', 'air_albania', 'residential', 'lake', 'castle_tanners', 'blloku', 'grand_park']
    cmds = []
    for tag, path in ck.items():
        assert os.path.exists(path), path
        jobs = ','.join(f'/content/scene_{s}.png=/content/sc_{tag}_{s}' for s in scenes)
        cmds.append(f'echo "=== {tag}"; python /content/joint.py --jobs {jobs} --lora {path} --batch 4')
    subprocess.Popen(['bash', '-c', ' ; '.join(cmds) + ' ; echo ALL_DONE'], stdout=open('/content/scenes.log', 'w'), stderr=subprocess.STDOUT, start_new_session=True)
    print('launched', list(ck))
