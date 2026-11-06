# Skanderbeg Square experiments: 2048 px region around the square, several variants, run one after another.
import subprocess
running = subprocess.run("pgrep -f '[j]oint.py'", shell=True, capture_output=True, text=True).stdout.strip()
if running:
    print('ALREADY RUNNING', running)
else:
    R = '13552,4800,15600,6848'   # canvas px: Skanderbeg Square at u=238,v=-320 -> x=14574,y=5824
    base = f'python /content/joint.py --control /content/main_canvas.png --region {R} --lora /content/s1000.safetensors'
    hint = ('tiranaiso, convert this Google 3D isometric render of Tirana into the tiranaiso illustrated isometric '
            'pixel-art map style, keep geometry exact, paved plazas keep their multicoloured stone paving pattern')
    V = {
        'sq_base': '',
        'sq_img2img_s5': '--start_step 5',
        'sq_img2img_s6': '--start_step 6',
        'sq_lora08': '--lora_scale 0.8',
        'sq_hint': f'--prompt "{hint}"',
        'sq_seed7': '--seed 7',
    }
    cmd = ' ; '.join(f'echo "=== {k}" ; {base} --out /content/{k} {a}' for k, a in V.items())
    # Public tiny.london LoRA, zero-shot, fed the way it was trained: 0.293 m/px, 2 px red border, its exact prompt.
    tl_prompt = ('Fill in the outlined section with the missing pixels corresponding to the <isometric london pixel art> '
                 'style, removing the border and exactly following the shape/style/structure of the surrounding image (if present).')
    dl = ("python -c \"from huggingface_hub import hf_hub_download as d; import shutil; "
          "shutil.copy(d('ktoyame/tiny-london-lora','tiny-london-v3.safetensors'),'/content/tiny-london-v3.safetensors')\"")
    for spot in ('square', 'lake'):
        cmd += (f' ; echo "=== tl_{spot}" ; {dl} ; python /content/joint.py --control /content/tl_{spot}.png '
                f'--lora /content/tiny-london-v3.safetensors --prompt "{tl_prompt}" --out /content/tl_{spot}')
    cmd += ' ; echo ALL_DONE'
    subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/square.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
    print('launched', len(V), 'variants')
