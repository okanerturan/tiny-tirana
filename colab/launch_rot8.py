# Rotation demo: paint the Pyramid area from 4 headings with v1 (s1000) and the latest v3 checkpoint.
# Runs alongside training on the same G4 (separate process; ~22 GB VRAM).
import glob, subprocess
if subprocess.run("pgrep -f '[j]oint.py'", shell=True, capture_output=True, text=True).stdout.strip():
    print('ALREADY RUNNING')
else:
    v3 = sorted(glob.glob('/content/output/tiranaiso_v3/tiranaiso_v3_*.safetensors'))[-1]
    subprocess.run(['cp', v3, '/content/v3_latest.safetensors'])
    cmds = []
    for lora, tag in (('/content/v3_latest.safetensors', 'v3b'),):
        for h in (315, 0, 45, 90, 135, 180, 225, 270):
            cmds.append(f'echo "=== {tag} h{h}"; python /content/joint.py --control /content/rot_ctrl_h{h}.png --lora {lora} --out /content/rot_{tag}_h{h} --batch 4')
    subprocess.Popen(['bash', '-c', ' ; '.join(cmds) + ' ; echo ALL_DONE'], stdout=open('/content/rot8.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
    print('launched with', v3.split('/')[-1])
