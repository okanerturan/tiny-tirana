# Paint the 7 airport blocks with v3 step 1250 (block mode). Background; log /content/airport.log
import subprocess
if subprocess.run("pgrep -f '[b]locks.py'", shell=True, capture_output=True, text=True).stdout.strip():
    print('ALREADY RUNNING')
else:
    cmd = ("cd /content && tar xf airport_shots.tar && python /content/blocks.py --plan /content/airport_plan.json --shots /content/airport_shots "
           "--store /content/airport_store --lora /content/output/tiranaiso_v3/tiranaiso_v3_000001250.safetensors --work /content/blockwork")
    subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/airport.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
    print('launched airport blocks')
