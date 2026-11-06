# Launch the pilot joint-sampling job in the background (one job per session).
import subprocess
running = subprocess.run("pgrep -f '[j]oint.py'", shell=True, capture_output=True, text=True).stdout.strip()
if running:
    print('ALREADY RUNNING', running)
else:
    cmd = ("cd /content && python -c \"from PIL import Image; Image.open('/content/pilot_control.webp').save('/content/pilot_control.png')\" && "
           "python /content/joint.py --control /content/pilot_control.png --lora /content/s1000.safetensors --out /content/pilot1 --batch 4")
    subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/pilot1.log', 'w'), stderr=subprocess.STDOUT, start_new_session=True)
    print('launched')
