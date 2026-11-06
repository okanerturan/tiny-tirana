"""Map projection shared by every stage: WGS84 -> ECEF -> ENU at the anchor -> fixed orthographic camera.
Canvas pixel (u, v): u to the right, v down, (0, 0) = anchor. Same maths as render/app.js.

    python3 -I project.py 41.3275,19.8187 41.3130,19.8200      # print u, v for points
"""
import json, math, sys

A, F_ = 6378137.0, 1 / 298.257223563
E2 = F_ * (2 - F_)
import os


def _geo():
    """viewer/app/geo.js is the one source of the camera and ground constants (its object is plain JSON)."""
    s = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'viewer', 'app', 'geo.js')).read()
    return json.loads(s[s.index('{', s.index('GEO')):s.rindex('}') + 1])


GEO = _geo()
CAM = dict(GEO['camera'])


def ecef(lat, lon, h):
    la, lo = math.radians(lat), math.radians(lon)
    n = A / math.sqrt(1 - E2 * math.sin(la) ** 2)
    return ((n + h) * math.cos(la) * math.cos(lo), (n + h) * math.cos(la) * math.sin(lo), (n * (1 - E2) + h) * math.sin(la))


def enu(lat, lon, h, c=CAM):
    x0, y0, z0 = ecef(c['lat'], c['lon'], c['groundH'])
    x, y, z = ecef(lat, lon, h)
    dx, dy, dz = x - x0, y - y0, z - z0
    la, lo = math.radians(c['lat']), math.radians(c['lon'])
    e = -math.sin(lo) * dx + math.cos(lo) * dy
    n = -math.sin(la) * math.cos(lo) * dx - math.sin(la) * math.sin(lo) * dy + math.cos(la) * dz
    u = math.cos(la) * math.cos(lo) * dx + math.cos(la) * math.sin(lo) * dy + math.sin(la) * dz
    return e, n, u


def axes(c=CAM):
    h, t = math.radians(c['heading']), math.radians(c['tilt'])
    f = (math.sin(h) * math.cos(t), math.cos(h) * math.cos(t), -math.sin(t))   # view direction
    r = (math.cos(h), -math.sin(h), 0.0)                                        # screen right = f x up
    up = (r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0])  # screen up = r x f
    return r, up


def to_px(lat, lon, h=None, c=CAM):
    """Canvas pixel of a point; h = ellipsoidal height (defaults to the anchor's ground height)."""
    p = enu(lat, lon, c['groundH'] if h is None else h, c)
    r, up = axes(c)
    dot = lambda a, b: sum(x * y for x, y in zip(a, b))
    return dot(p, r) / c['mpp'], -dot(p, up) / c['mpp']


if __name__ == '__main__':
    for arg in sys.argv[1:]:
        lat, lon = map(float, arg.split(','))
        u, v = to_px(lat, lon)
        print(f'{lat},{lon} -> u={u:.0f} v={v:.0f}')
