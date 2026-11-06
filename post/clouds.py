"""Tileable cloud-sea texture for the area around the shaped map (viewer/app/clouds.{avif,webp}).

    python3 -I post/clouds.py OUT_DIR [--preview OUT.jpg]

Periodic fBm from the FFT (so the tile wraps), thresholded into soft cumulus puffs with billowy edges, lit from the
north-west (top-left on screen) with soft cast shadows on a pale blue haze. Same seed -> same texture.
"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage

N, SEED = 2048, 11
K = N / 1024                                   # feature sizes are set for 1024 px; K scales them


def fbm(rng, beta, fmin, fmax):
    fy = np.fft.fftfreq(N)[:, None] * N; fx = np.fft.rfftfreq(N)[None, :] * N; f = np.hypot(fx, fy)
    amp = np.where((f >= fmin) & (f <= fmax), np.maximum(f, 1) ** -beta, 0)
    spec = (rng.standard_normal(f.shape) + 1j * rng.standard_normal(f.shape)) * amp
    n = np.fft.irfft2(spec, s=(N, N)); return (n - n.mean()) / n.std()


def blur(a, s): return ndimage.gaussian_filter(a, s, mode='wrap')


def main():
    out = sys.argv[1]; rng = np.random.default_rng(SEED)
    base = fbm(rng, 2.1, 1.5 * K, 28 * K); lobes = fbm(rng, 1.7, 6 * K, 48 * K)
    n = base + 0.30 * lobes
    c = np.clip((n - 0.05) / 0.75, 0, 1); c = c * c * (3 - 2 * c)                 # rounded puffs, ~50 % cover
    c = blur(c, 2.5 * K)
    h = blur(c, 10 * K) * 0.7 + blur(c, 4 * K) * 0.3                                    # dome height: smooth, cauliflower edges
    gy, gx = np.gradient(h)
    light = np.clip(0.64 + 14.0 * K * (-gx * 0.7 - gy * 0.7), 0, 1)
    shadow = np.roll(blur(c, 14 * K), (int(26 * K), int(18 * K)), axis=(0, 1))                       # cast shadow, down-right
    haze = np.array([0.80, 0.86, 0.93]); deep = np.array([0.74, 0.81, 0.90])
    tone = blur(base, 40 * K)[..., None]; tone = (tone - tone.min()) / (np.ptp(tone) + 1e-6)
    sea = haze[None, None] * (1 - tone) + deep[None, None] * tone
    sea = sea * (1 - 0.09 * shadow[..., None])
    lit, shade = np.array([1.0, 1.0, 1.0]), np.array([0.83, 0.87, 0.94])
    cloud = shade[None, None] + (lit - shade)[None, None] * light[..., None]
    a = np.clip(c * 1.25, 0, 1)[..., None]
    img = sea * (1 - a) + cloud * a
    img = (np.clip(img, 0, 1) * 255).round().astype(np.uint8)
    im = Image.fromarray(img)
    im.save(os.path.join(out, 'clouds.webp'), quality=84, method=6); im.save(os.path.join(out, 'clouds.avif'), quality=62)
    if '--preview' in sys.argv:
        p = sys.argv[sys.argv.index('--preview') + 1]; g = Image.new('RGB', (2 * N, 2 * N))
        for x in (0, N):
            for y in (0, N): g.paste(im, (x, y))
        g.resize((1024, 1024)).save(p, quality=88); print('preview', p)


if __name__ == '__main__':
    main()
