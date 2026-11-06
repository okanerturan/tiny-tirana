"""CPU-only checks of sampler/joint.py's window grid and tent weights (no GPU, no model).
Run from tirana/:
  uv run -q --python 3.12 --with torch --with numpy --with pillow --with safetensors python -I .claude/skills/run-tirana/test_sampler_logic.py
"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../sampler'))
import torch
import joint as J

fails = 0
# 1. Every grid covers every latent cell (wsum >= 1), for full-map, pilot and odd sizes.
for Hl, Wl in [(1024, 1280), (256, 256), (70, 64), (64, 64)]:
    for name, off in (('A', 0), ('B', J.SHIFT)):
        ws = torch.zeros(Hl, Wl)
        g = [(y, x) for y in J.positions(Hl, J.WIN, J.STRIDE, off) for x in J.positions(Wl, J.WIN, J.STRIDE, off)]
        for y, x in g:
            ws[y:y + J.WIN, x:x + J.WIN] += J.tent(J.WIN, J.RAMP, y == 0, y + J.WIN == Hl, x == 0, x + J.WIN == Wl)
        ok = ws.min().item() > 0.99
        fails += not ok
        print(f'{"ok " if ok else "FAIL"} grid {name} {Hl}x{Wl}: {len(g)} windows, min weight sum {ws.min().item():.3f}')
# 2. Blending is unbiased: identical predictions everywhere come back unchanged.
Hl, Wl = 200, 300
vel, ws = torch.zeros(Hl, Wl), torch.zeros(Hl, Wl)
for y in J.positions(Hl, J.WIN, J.STRIDE):
    for x in J.positions(Wl, J.WIN, J.STRIDE):
        w = J.tent(J.WIN, J.RAMP, y == 0, y + J.WIN == Hl, x == 0, x + J.WIN == Wl)
        vel[y:y + J.WIN, x:x + J.WIN] += 3.0 * w; ws[y:y + J.WIN, x:x + J.WIN] += w
err = (vel / ws - 3).abs().max().item()
fails += err > 1e-6
print(f'{"ok " if err <= 1e-6 else "FAIL"} constant field reproduced, max error {err:.2e}')
# 3. Full-map window count matches the 20480x16384 canvas the G4 run uses (1157 unique windows).
Hl, Wl = 16384 // J.VAE, 20480 // J.VAE
u = {(y, x) for off in (0, J.SHIFT) for y in J.positions(Hl, J.WIN, J.STRIDE, off) for x in J.positions(Wl, J.WIN, J.STRIDE, off)}
fails += len(u) != 1157
print(f'{"ok " if len(u) == 1157 else "FAIL"} full map unique windows: {len(u)}')
sys.exit(1 if fails else 0)
