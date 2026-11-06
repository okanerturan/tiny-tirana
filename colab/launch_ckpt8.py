# Paint the 8 Pyramid views with several v3 checkpoints (one model load per checkpoint) for the orbit preview.
import os, subprocess
if subprocess.run("pgrep -f '[j]oint.py'", shell=True, capture_output=True, text=True).stdout.strip():
    print('ALREADY RUNNING')
else:
    O = '/content/output/tiranaiso_v3'
    ck = {'s0750': f'{O}/tiranaiso_v3_000000750.safetensors', 's1000': f'{O}/tiranaiso_v3_000001000.safetensors',
          's1250': f'{O}/tiranaiso_v3_000001250.safetensors', 's1500': f'{O}/tiranaiso_v3_000001500.safetensors', 's2000': f'{O}/tiranaiso_v3.safetensors'}
    H = (315, 0, 45, 90, 135, 180, 225, 270)
    cmds = []
    for tag, path in ck.items():
        assert os.path.exists(path), path
        jobs = ','.join(f'/content/rot_ctrl_h{h}.png=/content/ck_{tag}_h{h}' for h in H)
        cmds.append(f'echo "=== {tag}"; python /content/joint.py --jobs {jobs} --lora {path} --batch 4')
    subprocess.Popen(['bash', '-c', ' ; '.join(cmds) + ' ; echo ALL_DONE'], stdout=open('/content/ck8.log', 'w'), stderr=subprocess.STDOUT, start_new_session=True)
    print('launched', list(ck))
