# Colab setup (runs in background on the VM; poll /content/setup.log). Pinned to the commit the LoRA was trained with.
import subprocess
cmd = r"""
set -x
nvidia-smi --query-gpu=name,memory.total --format=csv
free -g | head -2; df -h /content | tail -1
cd /content && [ -d ai-toolkit ] || git clone -q https://github.com/ostris/ai-toolkit
cd /content/ai-toolkit && git checkout -q e9c72b7 && git log -1 --format=%h
sed -i 's/^scipy==.*/scipy/' requirements.txt
pip install -q -r requirements.txt hf_transfer 2>&1 | tail -3
export HF_HUB_ENABLE_HF_TRANSFER=1
python -c "
from huggingface_hub import hf_hub_download, snapshot_download
print(hf_hub_download('Comfy-Org/Qwen-Image-2.1','diffusion_models/qwen_image_2.1_turbo_bf16.safetensors'))
print(snapshot_download('Qwen/Qwen-Image-2.1', allow_patterns=['*.json','*.txt','text_encoder/*','vae/*','tokenizer/*','processor/*']))
"
echo SETUP_EXIT=$?
"""
subprocess.Popen(['bash', '-c', cmd], stdout=open('/content/setup.log', 'w'), stderr=subprocess.STDOUT)
print('setup started')
