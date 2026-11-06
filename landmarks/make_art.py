"""Landmark art via GPT Image 2.6 on fal: an isometric map icon (from our painted crop + real photo) and a travel-poster
card front (from the user's poster prompts + the real photo as reference). Key: ~/.config/tirana-map/fal_key.

    python3 -I landmarks/make_art.py KIND LANDMARK_ID [LANDMARK_ID ...] [--style stationery|shapes] [--cap 2.0]
KIND: icon | picture (text-free illustration for the card) | poster.  Outputs land in data/landmarks/gen/<id>__<kind>[_<style>].png ; log in data/landmarks/gen/log.jsonl
"""
import base64, io, json, os, sys, time, urllib.request

KEY = open(os.path.expanduser('~/.config/tirana-map/fal_key')).read().strip()
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, '..', 'data', 'landmarks')
EDIT = 'openai/gpt-image-2.6/flare/edit'
WD = json.load(open(os.path.join(DATA, 'wikidata.json')))
NAMES = {  # display names used in prompts (English, as on Wikidata, plus a hint where it helps the model)
    'villa31': "Enver Hoxha's former villa in Tirana's Blloku district",
    'sacredheart': 'the Sacred Heart Catholic Church on Rruga e Kavajës in Tirana',
    'mosaic': 'the Tirana Mosaic, an excavated Roman-era floor mosaic under a modern roof',
    'procopius': 'St Procopius Church, a small Orthodox church in the Grand Park of Tirana',
    'intlhotel': 'the Tirana International Hotel on Skanderbeg Square',
    'olympic': 'the Olympic Park sports complex in Tirana',
    'stermasi': 'Selman Stërmasi football stadium in Tirana',
    'dajtitop': 'the upper station of the Dajti Ekspres cable car and the round Dajti Tower Belvedere hotel on Mount Dajti',
    'teg': 'TEG, Tirana East Gate shopping centre',
    'bunkart1': "Bunk'Art 1, the Cold War bunker museum at the foot of Mount Dajti",
    'downtown1': 'Downtown One, the tall glass residential tower in Tirana with balconies forming a map of Albania',
    'congress': 'the Palace of Congresses in Tirana',
    'botanical': 'the Botanical Garden of Tirana',
    'zoo': 'the Tirana Zoo park',
    'paskuqan': 'Lake Paskuqan on the north-west edge of Tirana',
    'thate': 'Liqeni i Thatë, a small lake in a park in Tirana',
    'histmuseum': 'the National History Museum of Albania (with its huge facade mosaic)',
    'parliament': 'the Parliament of Albania building',
    'pmoffice': "the Prime Minister's Office of Albania (Kryeministria)",
    'brigades': 'the Palace of the Brigades (Pallati i Brigadave)',
    'bunkart2': "Bunk'Art 2 (the bunker museum entrance)",
    'resurrection': 'the Resurrection Cathedral of Tirana (Orthodox)',
    'stpaul': "St Paul's Catholic Cathedral of Tirana",
    'teresasq': 'Mother Teresa Square in Tirana',
    'university': 'the main building of the Polytechnic University of Tirana',
    'archaeology': 'the National Archaeological Museum of Tirana',
    'gallery': 'the National Gallery of Arts of Albania',
    'leaves': 'the House of Leaves museum (an ivy-covered house)',
    'blloku': 'the Blloku neighbourhood of Tirana',
    'skytower': 'the Sky Tower of Tirana (with a revolving bar on top)',
    'rinia': 'Rinia Park in Tirana',
    'grandpark': 'the Grand Park and Artificial Lake of Tirana',
    'farka': 'Farka Lake on the edge of Tirana',
    'bazaar': 'the New Bazaar (Pazari i Ri) of Tirana',
    'dajti': 'the Dajti Ekspres cable car rising from Tirana to Mount Dajti',
    'airport': 'Tirana International Airport Nënë Tereza',
    'statue': 'the Skanderbeg Monument (equestrian bronze statue on a stone plinth)', 'mosque': "the Et'hem Bey Mosque",
    'clock': 'the Clock Tower of Tirana', 'opera': 'the Palace of Culture (National Opera)', 'bunker': "Bunk'Art 2 (a Cold War bunker museum entrance)",
    'pyramid': 'the Pyramid of Tirana', 'castle': 'the walls of Tirana Castle (Justinian Fortress)',
    'bigmosque': 'the Great Mosque of Tirana (Namazgah Mosque)', 'bridge': "the Tanners' Bridge (Ottoman stone footbridge)",
    'postbllok': 'the Postbllok memorial (bunker, concrete pillars and Berlin Wall segment)', 
    'stadium': 'the Air Albania Stadium (with its tower)', 'lake': 'Tirana Artificial Lake', 'park': 'the Grand Park of Tirana'}
FEATURES = {
    'villa31': 'a modernist 1970s villa with flat roofs, pale walls and big windows, behind a wall in a leafy garden.',
    'sacredheart': 'a pale neo-romanesque church with a tall bell tower and a rose window, on a city street.',
    'mosaic': 'an open archaeological site with a colourful ancient floor mosaic of geometric patterns and fish, under a light modern canopy, with paths around it.',
    'procopius': 'a small stone Orthodox church with a red tiled roof, a small dome and a bell tower among pine trees in a park.',
    'intlhotel': 'a tall plain 1970s hotel tower block on the edge of a big square, flags in front.',
    'olympic': 'a modern sports hall and outdoor courts and a running track among trees.',
    'stermasi': 'a compact football stadium with stands on two sides, a green pitch and floodlights, in a city block.',
    'dajtitop': 'a round multi-storey glass-topped hotel tower and a small cable-car station with red gondolas arriving, on a green forested mountain plateau, mountain slopes behind.',
    'teg': 'a large modern shopping mall with a tall glass entrance canopy on slanted steel legs, a wide plaza and parking in front.',
    'bunkart1': 'a concrete bunker entrance tunnelled into a forested hillside, a heavy steel door and a small colourful sign, a few old army trucks nearby.',
    'downtown1': 'a very tall slim glass skyscraper whose protruding balconies form a pattern shaped like the map of Albania on its facade, over a city of low roofs.',
    'congress': 'a modernist 1980s building with a long curved facade of pale stone and blue glass bands, raised on concrete pillars, lawn in front.',
    'botanical': 'a garden of lawns, round clipped shrubs, palm trees and gravel paths around a red-roofed villa and greenhouses.',
    'zoo': 'a modern zoo park with winding wooden boardwalks, a pond with islands, animal enclosures and timber pavilions among trees.',
    'paskuqan': 'a wide calm blue lake with grassy shores, small houses on the far side and mountains behind.',
    'thate': 'a small calm lake in a green park with a footpath around it, trees and benches, city blocks beyond.',
    'histmuseum': 'a long low modernist building with a huge colourful mosaic of figures from Albanian history above a row of square columns at the entrance.',
    'parliament': 'a symmetrical pale building with a classical portico of columns and a red Albanian flag over the entrance, among palm trees.',
    'pmoffice': 'a long Italian-era government building with pale ochre walls and many windows, on a wide boulevard.',
    'brigades': 'a grand 1930s palace with a symmetrical facade, arched windows and gardens, on a green hill.',
    'bunkart2': 'a small concrete mushroom-shaped bunker entrance on a square, with a little bunker dome beside it.',
    'resurrection': 'a modern Orthodox cathedral with a large ribbed dome, golden accents and a separate tall slim bell tower.',
    'stpaul': 'a modern Catholic cathedral with curved white walls, a tall narrow window and a simple cross.',
    'teresasq': 'a wide paved square with long Italian-era arcaded buildings around it and the boulevard leading away.',
    'university': 'a symmetrical Italian-era building with a tall central block, arched entrance and long wings, closing a big square.',
    'archaeology': 'a low pale building with a long row of square columns along its front, on a square.',
    'gallery': 'a low modernist gallery building on the boulevard, with a small garden of old communist-era statues behind it.',
    'leaves': 'a two-storey 1930s house completely covered in green ivy leaves, with a small garden.',
    'blloku': 'a lively neighbourhood of colourful mid-rise apartment blocks, café terraces and trees along narrow streets.',
    'skytower': 'a tall slender glass tower with a round revolving bar at the very top, over a city of low roofs.',
    'rinia': 'a small green park with trees, paths and a fountain in front of a café pavilion, beside a boulevard.',
    'grandpark': 'a big green park of pine woods around a blue artificial lake with a lakeside promenade.',
    'farka': 'a calm blue lake among green hills, with new houses along its shore.',
    'bazaar': 'a covered market with zigzag roofs over stalls of fruit and vegetables, around a square with cafés.',
    'dajti': 'small red cable cars on a long cable line climbing from the city over green hills to a forested mountain top.',
    'airport': 'a modern airport terminal with a glass facade and a few airliners on the apron, a runway beyond.',
    'statue': 'a dark bronze equestrian statue of Skanderbeg in a goat-horned helmet and cloak, on a walking horse with ONE front leg raised (not rearing), on a rough pale rock-like stone plinth, in the wide paved square; behind it the yellow facade of a low hotel and a pale apartment block.',
    'mosque': 'a small stone mosque with a grey-blue dome, a front portico with arches, and one slender white minaret beside it.',
    'clock': 'a tall slim stone clock tower, square in plan, with clock faces near the top and a small pointed roof.',
    'opera': 'a long, low modernist building with a colonnade of tall slim columns across its facade, on the edge of a big square.',
    'pyramid': 'a mostly plain white concrete pyramid with sloping ribbed sides and glass skylights along its ridges; ONLY A FEW (about six to eight) small coloured cubic boxes, mainly around the base and on the lowest slopes, and many people walking up the sloping sides. Most of the structure is bare white concrete, not covered in boxes.',
    'castle': 'old stone fortress walls with small towers, and a pedestrian lane of low houses and cafés running along them.',
    'bigmosque': 'a very large modern Ottoman-style mosque with a broad central dome, smaller cascading domes and four tall slender minarets.',
    'bridge': 'a small humpbacked Ottoman stone footbridge with one arch, made of irregular grey stones, among trees.',
    'postbllok': 'a small domed concrete bunker, a few tall concrete mine-shaft pillars and a painted segment of the Berlin Wall, in a green corner.',
    'stadium': 'a modern football stadium with a red, white and grey facade and a tall slim hotel tower rising from one corner.'}
COMPOSE = {  # varied compositions for the graphic prints, so the set isn't ten sun discs
    'villa31': 'The villa half-hidden behind its garden wall, evening light.',
    'sacredheart': 'The bell tower soaring up, rose window glowing.',
    'mosaic': 'The mosaic pattern seen from above as bold tiles.',
    'procopius': 'The little church framed by tall pines.',
    'intlhotel': 'The tower rising over the square, long shadows.',
    'olympic': 'Running track curves as bold stripes. No Olympic rings, logos, flags or text anywhere.',
    'stermasi': 'Floodlights fanning over the pitch.',
    'dajtitop': 'Gondola gliding up to the station, the round tower against the sky.',
    'teg': 'The glass canopy as a bold angular shape, evening lights.',
    'bunkart1': 'A dark tunnel mouth in the hillside, strong shadow, a single bulb.',
    'downtown1': 'Very tall narrow crop, the tower soaring up, its balconies as a bold pattern.',
    'congress': 'The curved facade as sweeping horizontal bands.',
    'botanical': 'Palm fronds framing the villa, layered greens.',
    'zoo': 'Boardwalk curving over the pond, a heron in the water.',
    'paskuqan': 'Calm lake in wide bands, mountains in layered silhouettes.',
    'thate': 'Small lake framed by trees, ripples and a bench.',
    'histmuseum': 'The mosaic facade as a bold frieze filling the frame.',
    'parliament': 'Front view, columns and flag, strict symmetry.',
    'pmoffice': 'Long facade receding along the boulevard, dusk.',
    'brigades': 'Palace on its hill framed by cypress trees, golden hour.',
    'bunkart2': 'The concrete mushroom as a single bold shape on an empty square, long shadow.',
    'resurrection': 'Dome and bell tower side by side against a big sky.',
    'stpaul': 'Curved white walls in strong light and shadow, minimal.',
    'teresasq': 'Wide square seen from above, arcades as rhythm.',
    'university': 'Central tower at the end of the boulevard, perspective lines.',
    'archaeology': 'Row of columns as repeating vertical bars.',
    'gallery': 'Old statues in the garden in front of the gallery.',
    'leaves': 'House framed by ivy leaves at the edges.',
    'blloku': 'Café terraces and balconies, warm evening lights.',
    'skytower': 'Very tall narrow crop, tower soaring up, moon beside the bar.',
    'rinia': 'Fountain and trees, morning light.',
    'grandpark': 'Lake and pines with the city skyline far behind.',
    'farka': 'Wide calm lake, hills in layered bands.',
    'bazaar': 'Zigzag roofs as bold repeating triangles.',
    'dajti': 'Cable car crossing the frame diagonally toward the mountain.',
    'airport': 'An airliner taking off over the terminal.',
    'statue': 'Big flat sun disc behind the rider.', 'pyramid': 'Strict central symmetry looking straight up the slope.',
    'mosque': 'Dome and minaret framed through an arch, night palette with a crescent moon and stars.', 'clock': 'Very tall narrow crop, clock tower soaring up the full height, swifts in the sky.',
    'opera': 'Wide low frieze of the colonnade, repeating column rhythm, sunset stripes.', 'castle': 'Close crop of stones and a tower against bold diagonal bands of evening light.',
    'bigmosque': 'Domes and four minarets as a stepped silhouette against a huge pale moon.', 'bridge': 'The single arch reflected in water, perfect mirror symmetry, willow leaves.',
    'postbllok': 'Bunker dome, concrete pillars and wall segment as stark blocks, overhead view with long shadows.', 'stadium': 'Low angle, the façade as bold vertical stripes, floodlight beams fanning out.'}
EST = {'icon': 0.10, 'poster': 0.25, 'picture': 0.25, 'art': 0.25}


def uri(path):
    mime = 'image/jpeg' if path.endswith('.jpg') else 'image/png'
    return f'data:{mime};base64,' + base64.b64encode(open(path, 'rb').read()).decode()


def req(method, url, body=None):
    r = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                               headers={'Authorization': f'Key {KEY}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=300) as f:
        return json.loads(f.read())


def run(body):
    sub = req('POST', f'https://queue.fal.run/{EDIT}', body)
    while True:
        st = req('GET', sub['status_url'])
        if st.get('status') == 'COMPLETED': break
        if st.get('status') not in ('IN_QUEUE', 'IN_PROGRESS'): raise RuntimeError(st)
        time.sleep(3)
    res = req('GET', sub['response_url'])
    return urllib.request.urlopen(res['images'][0]['url'], timeout=120).read()


def main():
    kind, ids = sys.argv[1], [a for a in sys.argv[2:] if not a.startswith('--') and a not in ('stationery', 'shapes', 'graphic', 'diorama', 'high', 'medium') and not a.replace('.', '').isdigit()]
    style = sys.argv[sys.argv.index('--style') + 1] if '--style' in sys.argv else 'stationery'
    cap = float(sys.argv[sys.argv.index('--cap') + 1]) if '--cap' in sys.argv else 2.0
    out = os.path.join(DATA, 'gen'); os.makedirs(out, exist_ok=True)
    est = EST[kind] * len(ids)
    print(f'{len(ids)} x {kind} ({style if kind in ('poster', 'art') else "-"}), est ${est:.2f}, cap ${cap:.2f}', flush=True)
    if est > cap: sys.exit('over cap; nothing sent')
    def one(i):
        photo, painted = os.path.join(DATA, 'photos', f'{i}.jpg'), os.path.join(DATA, 'painted', f'{i}.png')
        if kind == 'icon':
            prompt = open(os.path.join(ROOT, 'prompts', 'icon_isometric.txt')).read().replace('[LANDMARK]', NAMES[i]).replace('[FEATURES]', FEATURES.get(i, ''))
            body = {'prompt': prompt, 'image_urls': [uri(painted), uri(photo)], 'background': 'transparent', 'quality': 'medium',
                    'image_size': {'width': 1024, 'height': 1024}, 'output_format': 'png'}
            dst = os.path.join(out, f'{i}__icon.png')
        elif kind == 'picture':
            prompt = open(os.path.join(ROOT, 'prompts', 'picture_stationery.txt')).read().replace('[CITY_NAME]', 'Tirana') \
                .replace('[LANDMARK]', NAMES[i]).replace('[FEATURES]', FEATURES.get(i, '')) + \
                '\n\nThe attached photo is a reference for the landmark\'s real shape, proportions and colours only; redraw it in the style above.'
            body = {'prompt': prompt, 'image_urls': [uri(photo)], 'quality': 'high', 'image_size': {'width': 1024, 'height': 1536}, 'output_format': 'png'}
            dst = os.path.join(out, f'{i}__picture.png')
        elif kind == 'art':   # stylized, standalone card illustration (style: graphic | diorama); --quality medium|high
            q = sys.argv[sys.argv.index('--quality') + 1] if '--quality' in sys.argv else 'high'
            prompt = open(os.path.join(ROOT, 'prompts', f'art_{style}.txt')).read().replace('[LANDMARK]', NAMES[i]).replace('[FEATURES]', FEATURES.get(i, ''))
            if style == 'graphic': prompt += f'\n\nCOMPOSITION FOR THIS ONE: {COMPOSE.get(i, "")}'
            body = {'prompt': prompt, 'image_urls': [uri(photo)], 'quality': q, 'image_size': {'width': 1024, 'height': 1536}, 'output_format': 'png'}
            dst = os.path.join(out, f'{i}__art_{style}{"" if q == "high" else "_" + q}.png')
        else:
            tpl = open(os.path.join(ROOT, 'prompts', f'poster_{style}.txt')).read()
            if style == 'stationery':
                prompt = tpl.replace('[CITY_NAME]', 'Tirana') + (
                    f"\n\nFOCAL LANDMARK FOR THIS POSTER: {NAMES[i]}. The attached photo is a reference for its real shape, "
                    "proportions and colours only; redraw it in the poster style above, accurately and recognisably.")
            else:
                prompt = tpl.replace('[COUNTRY / CITY / LANDMARK]', f'{NAMES[i]}, Tirana, Albania') + (
                    "\n\nThe attached photo is a reference for the landmark's real shape and proportions only; redraw it in the style above.")
            body = {'prompt': prompt, 'image_urls': [uri(photo)], 'quality': 'high', 'image_size': {'width': 1024, 'height': 1536}, 'output_format': 'png'}
            dst = os.path.join(out, f'{i}__poster_{style}.png')
        t0 = time.time()
        try:
            data = run(body); open(dst, 'wb').write(data)
            rec = {'id': i, 'kind': kind, 'style': style, 'file': dst, 'secs': round(time.time() - t0)}
            print('ok  ', i, kind, style if kind in ('poster', 'art') else '', f'{rec["secs"]}s', flush=True)
        except Exception as e:
            rec = {'id': i, 'kind': kind, 'style': style, 'error': str(e)[:300]}; print('FAIL', i, kind, str(e)[:200], flush=True)
        with open(os.path.join(out, 'log.jsonl'), 'a') as f: f.write(json.dumps(rec) + '\n')
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(5) as ex: list(ex.map(one, ids))


if __name__ == '__main__':
    main()
