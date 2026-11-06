# Full-map joint sampling with v3 step 1250 (runs alongside other jobs on the same G4).
import subprocess
if subprocess.run("pgrep -f '[f]ull3'", shell=True, capture_output=True, text=True).stdout.strip():
    print('ALREADY RUNNING')
else:
    cmd = ("cd /content && python /content/joint.py --control /content/main_canvas.png "
           "--lora /content/output/tiranaiso_v3/tiranaiso_v3_000001250.safetensors --out /content/full3 --batch 4")
    subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/full3.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
    print('launched full3 (v3 step 1250)')
