# Full-map joint sampling with v3 step 1500 (runs alongside other jobs on the same G4).
import subprocess
if subprocess.run("pgrep -f '[f]ull2'", shell=True, capture_output=True, text=True).stdout.strip():
    print('ALREADY RUNNING')
else:
    cmd = ("cd /content && python /content/joint.py --control /content/main_canvas.png "
           "--lora /content/output/tiranaiso_v3/tiranaiso_v3_000001500.safetensors --out /content/full2 --batch 4")
    subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/full2.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
    print('launched full2 (v3 step 1500)')
