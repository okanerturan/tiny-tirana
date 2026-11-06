"""Bake Tirana's built-up area (OSM buildings + built landuse) in camera px for post/shape.py.

    <venv with osmium>/python -I post/urban_bake.py

Output data/urban_polys.npz: xy (float32 camera px, all vertices), start (int32 offset of each polygon), kind (0 building,
1 landuse). Heights for the projection: the DEM at each polygon's first vertex (polygons are small, so one height is
enough). post/shape.py rasterises them, merges nearby buildings into continuous fabric and adds it to the land.
"""
import os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
sys.path[:0] = [HERE, os.path.join(ROOT, 'render')]
import project as P, terrain as Tn        # noqa: E402

BBOX = (41.25, 41.46, 19.64, 19.97)
LANDUSE = {'residential', 'commercial', 'industrial', 'retail', 'construction', 'education', 'institutional', 'religious'}


def main():
    import osmium
    polys, kinds = [], []

    class H(osmium.SimpleHandler):
        def area(self, a):
            t = a.tags; b = t.get('building'); lu = t.get('landuse')
            if not ((b and b != 'no') or lu in LANDUSE): return
            try:
                for ring in a.outer_rings():
                    pts = [(n.lat, n.lon) for n in ring]
                    if len(pts) < 3: continue
                    la, lo = pts[0]
                    if not (BBOX[0] < la < BBOX[1] and BBOX[2] < lo < BBOX[3]): continue
                    polys.append(pts); kinds.append(0 if b and b != 'no' else 1)
            except Exception:
                pass
    H().apply_file(os.path.join(ROOT, 'data', 'osm', 'albania-latest.osm.pbf'), locations=True, idx='flex_mem')
    xy, start = [], []
    for pts in polys:
        h = Tn.elev(*pts[0]); start.append(len(xy))
        xy += [P.to_px(la, lo, h) for la, lo in pts]
    np.savez_compressed(os.path.join(ROOT, 'data', 'urban_polys.npz'), xy=np.array(xy, np.float32), start=np.array(start, np.int32),
                        kind=np.array(kinds, np.int8))
    print(f'{len(polys)} polygons ({kinds.count(0)} buildings, {kinds.count(1)} landuse), {len(xy)} vertices -> data/urban_polys.npz')


if __name__ == '__main__':
    main()
