# Short status cell: tail a log (env LOG) and show GPU use. Doubles as a keep-alive.
import os, subprocess
log = os.environ.get('LOG', '/content/setup.log')
print(subprocess.run(f"tail -n {os.environ.get('N','8')} {log}; nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader", shell=True, capture_output=True, text=True).stdout)
