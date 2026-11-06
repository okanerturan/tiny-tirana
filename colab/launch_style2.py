import subprocess
L = '/content/output/tiranaiso_v3/tiranaiso_v3_000001250.safetensors'
J = ','.join(f'/content/style_in/{s}_s{p}.png=/content/style/{s}_s{p}_l100' for s in ('apts', 'centre') for p in (60, 70, 80))
cmd = f"cd /content && tar xf style_in2.tar -C style_in && python /content/joint.py --jobs {J} --lora {L} --lora_scale 1.0 && echo STYLE2_DONE"
subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/style2.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
print('style2 launched')
