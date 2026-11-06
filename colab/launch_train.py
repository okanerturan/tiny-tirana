# Launch v3 LoRA training in the background (one trainer per session; check duplicates first).
import subprocess
running = subprocess.run("pgrep -f '[r]un.py /content/v3.yaml'", shell=True, capture_output=True, text=True).stdout.strip()
if running:
    print('ALREADY RUNNING', running)
else:
    cmd = "cd /content/ai-toolkit && HF_HUB_ENABLE_HF_TRANSFER=1 python run.py /content/v3.yaml"
    subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/train_v3.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
    print('launched')
