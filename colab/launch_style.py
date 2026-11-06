# Style test: after the airport finishes, paint 2 spots x variants. Background; log /content/style.log; outputs /content/style/<job>/map.png
import subprocess
L = '/content/output/tiranaiso_v3/tiranaiso_v3_000001250.safetensors'
J1 = ','.join(f'/content/style_in/{s}_{v}.png=/content/style/{s}_{v}_l100' for s in ('apts', 'centre') for v in ('orig', 'blur', 'half'))
J2 = ','.join(f'/content/style_in/{s}_{v}.png=/content/style/{s}_{v}_l135' for s in ('apts', 'centre') for v in ('orig', 'blur'))
cmd = f"""
while pgrep -f '[b]locks.py --plan /content/airport_plan.json' >/dev/null; do sleep 20; done
cd /content && python /content/joint.py --jobs {J1} --lora {L} --lora_scale 1.0 && \
python /content/joint.py --jobs {J2} --lora {L} --lora_scale 1.35 && echo STYLE_DONE
"""
subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/style.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
print('style test queued after the airport')
