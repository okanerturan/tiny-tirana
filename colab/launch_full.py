# Launch the full-map joint sampling job in the background (one job per session).
import subprocess
running = subprocess.run("pgrep -f '[j]oint.py'", shell=True, capture_output=True, text=True).stdout.strip()
if running:
    print('ALREADY RUNNING', running)
else:
    cmd = "cd /content && python /content/joint.py --control /content/main_canvas.png --lora /content/s1000.safetensors --out /content/full1 --batch 4"
    subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/full1.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
    print('launched')
