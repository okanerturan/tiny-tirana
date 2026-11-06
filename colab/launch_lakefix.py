# Repaint only Tirana Lake (water + 64 px of shore) of the v3 central map. Background; log /content/lakefix.log
import subprocess
cmd = ("cd /content && mkdir -p lakefix_in && tar xf lakefix.tar -C lakefix_in && python /content/joint.py --control lakefix_in/control.png "
       "--known lakefix_in/known.png --mask lakefix_in/mask.png --lora /content/output/tiranaiso_v3/tiranaiso_v3_000001250.safetensors --out /content/lakefix")
subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/lakefix.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
print('launched lakefix')
