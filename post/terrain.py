"""Ground height for anything we draw on the painting (cars, buses, ducks, planes).

Source: AWS Terrain Tiles (Mapzen "terrarium", public, no key), zoom 14 (~7 m px) over Tirana + the airport.
elev(lat, lon) -> ellipsoidal metres (the height system of Google 3D Tiles and of project.to_px(lat, lon, h)).
Terrarium is orthometric (EGM96); the geoid is ~ +45 m here. Calibrated so Skanderbeg Square = the camera's groundH.

    python3 -I post/terrain.py        # download tiles once and print a sanity check
"""
import io, math, os, urllib.request
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); DIR = os.path.join(HERE, '..', 'data', 'terrain')
Z, BBOX = 14, (41.26, 19.64, 41.46, 19.94)     # lat0, lon0, lat1, lon1
URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
GEOID = 44.9                                   # EGM96 undulation at Tirana; refined by calibrate()
_grid = None


def tile_xy(lat, lon, z=Z):
    n = 2 ** z; x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def build():
    x0, y0 = map(int, tile_xy(BBOX[2], BBOX[1])); x1, y1 = map(int, tile_xy(BBOX[0], BBOX[3]))
    grid = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), np.float32)
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            f = os.path.join(DIR, f'{Z}_{tx}_{ty}.png')
            if not os.path.exists(f):
                req = urllib.request.Request(URL.format(z=Z, x=tx, y=ty), headers={'User-Agent': 'tiny-tirana/1.0'})
                open(f, 'wb').write(urllib.request.urlopen(req, timeout=30).read())
            a = np.asarray(Image.open(f).convert('RGB'), np.float32)
            grid[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    np.savez_compressed(os.path.join(DIR, 'grid.npz'), grid=grid, x0=x0, y0=y0)
    return grid, x0, y0


def _load():
    global _grid
    if _grid is None:
        f = os.path.join(DIR, 'grid.npz')
        if not os.path.exists(f):
            g, x0, y0 = build()
        else:
            d = np.load(f); g, x0, y0 = d['grid'], int(d['x0']), int(d['y0'])
        _grid = (g, x0, y0)
    return _grid


def elev_msl(lat, lon):
    g, x0, y0 = _load(); x, y = tile_xy(lat, lon)
    px, py = (x - x0) * 256 - 0.5, (y - y0) * 256 - 0.5
    i, j = int(math.floor(px)), int(math.floor(py)); fx, fy = px - i, py - j
    i = min(max(i, 0), g.shape[1] - 2); j = min(max(j, 0), g.shape[0] - 2)
    return float(g[j, i] * (1 - fx) * (1 - fy) + g[j, i + 1] * fx * (1 - fy) + g[j + 1, i] * (1 - fx) * fy + g[j + 1, i + 1] * fx * fy)


def elev(lat, lon):
    """Ellipsoidal ground height in metres (use with render/project.py to_px(lat, lon, h))."""
    return elev_msl(lat, lon) + GEOID


if __name__ == '__main__':
    os.makedirs(DIR, exist_ok=True); build()
    for name, la, lo in [('Skanderbeg Sq', 41.32788, 19.81818), ('Tirana Lake', 41.3125, 19.8170), ('Airport TIA', 41.4147, 19.7206),
                         ('Mother Teresa Sq', 41.31788, 19.82129), ('Dajti foot (Linzë)', 41.35, 19.87)]:
        print(f'{name:20s} MSL {elev_msl(la, lo):7.1f} m   ellipsoidal {elev(la, lo):7.1f} m')
