"""Build the viewer's in-browser search index from an OSM extract (Geofabrik albania-latest.osm.pbf).

    uv run -q --python 3.12 --with osmium python -I post/build_search.py data/osm/albania-latest.osm.pbf viewer/app/search.json

Output: {"v":1, "items": [[name, alt_name_or_"", kind, lat, lon], ...]} for named features inside the painted area.
Kinds: landmark, square, park, water, neighbourhood, place, street, building (offices, hotels, embassies...). One point per street name (the segment midpoint
nearest that street's overall centre, so it lands on the street even when the street curves).
"""
import json, math, sys
from collections import defaultdict
import osmium

sys.path.insert(0, 'render')
import project as P

SRC, OUT = sys.argv[1], sys.argv[2]
U0, V0, U1, V1 = -14336, -6144, 6144, 10240      # painted canvas, heading 315 (main map)
BBOX = (41.29, 19.77, 41.36, 19.87)                # coarse prefilter


def inside(lat, lon, margin=64):
    if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
        return False
    u, v = P.to_px(lat, lon)
    return U0 + margin <= u < U1 - margin and V0 + margin <= v < V1 - margin


def kind_of(t):
    if t.get('place') in ('square',) or t.get('highway') == 'pedestrian' and t.get('area') == 'yes':
        return 'square'
    if t.get('place') in ('neighbourhood', 'quarter', 'suburb', 'city_block'):
        return 'neighbourhood'
    if t.get('place'):
        return 'place'
    if t.get('natural') == 'water' or t.get('water') or t.get('waterway') in ('river', 'canal'):
        return 'water'
    if t.get('leisure') in ('park', 'garden', 'stadium', 'sports_centre') or t.get('landuse') == 'recreation_ground':
        return 'park' if t.get('leisure') != 'stadium' else 'landmark'
    if t.get('tourism') in ('attraction', 'museum', 'gallery', 'viewpoint', 'artwork') or t.get('historic') \
            or t.get('amenity') in ('place_of_worship', 'theatre', 'arts_centre', 'townhall', 'marketplace') \
            or t.get('building') in ('mosque', 'church', 'cathedral') or t.get('man_made') == 'tower':
        return 'landmark'
    if t.get('tourism') or t.get('amenity') in ('university', 'college', 'museum', 'library', 'hospital', 'embassy', 'cinema') \
            or t.get('office') or t.get('building') in ('government', 'university', 'train_station', 'hotel'):
        return 'building'
    if t.get('highway') and t.get('highway') not in ('bus_stop', 'traffic_signals', 'crossing', 'street_lamp'):
        return 'street'
    return None


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.items = []; self.streets = defaultdict(list)

    def add(self, t, lat, lon):
        name = t.get('name')
        k = kind_of(t)
        if not name or not k or not inside(lat, lon):
            return
        alt = t.get('name:en') or t.get('name:sq') or ''
        if alt == name: alt = ''
        if k == 'street':
            self.streets[name].append((lat, lon, alt))
        else:
            self.items.append([name, alt, k, round(lat, 6), round(lon, 6)])

    def node(self, n):
        if n.tags and 'name' in n.tags:
            self.add(dict(n.tags), n.location.lat, n.location.lon)

    def way(self, w):
        if 'name' not in w.tags:
            return
        try:
            pts = [(nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
        except osmium.InvalidLocationError:
            return
        if not pts:
            return
        t = dict(w.tags)
        if t.get('highway'):
            lat, lon = pts[len(pts) // 2]               # a point on the street
        else:
            lat = sum(p[0] for p in pts) / len(pts); lon = sum(p[1] for p in pts) / len(pts)
        self.add(t, lat, lon)


h = H()
h.apply_file(SRC, locations=True)
for name, segs in h.streets.items():
    clat = sum(s[0] for s in segs) / len(segs); clon = sum(s[1] for s in segs) / len(segs)
    lat, lon, alt = min(segs, key=lambda s: (s[0] - clat) ** 2 + ((s[1] - clon) * math.cos(math.radians(clat))) ** 2)
    h.items.append([name, alt, 'street', round(lat, 6), round(lon, 6)])
# dedupe same name+kind within ~60 m
seen, items = [], []
for it in sorted(h.items, key=lambda x: ('landmark square park water neighbourhood place street building'.split().index(x[2]), x[0])):
    if any(s[0] == it[0] and abs(s[3] - it[3]) < 0.0006 and abs(s[4] - it[4]) < 0.0008 for s in seen):
        continue
    seen.append(it); items.append(it)
json.dump({'v': 1, 'items': items}, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print(len(items), 'items', dict(Counter(i[2] for i in items)))
