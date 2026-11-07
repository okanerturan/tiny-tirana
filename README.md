# Tiny Tirana

An isometric pixel-art map of Tirana, Albania, painted block by block by a diffusion model that was trained on the
city's own 3D view. Live planes, buses on the real timetable, cars, ducks on the lake, a cable car up Mount Dajti, and
46 landmarks with their own cards.

**Map:** [tirana.fyi](https://tirana.fyi) · **How it was made:** [tirana.fyi/app/how.html](https://tirana.fyi/app/how.html) ·
**Atlas of isometric cities:** [tirana.fyi/world/](https://tirana.fyi/world/)

## Who made it

Made by [@okanerturan](https://github.com/okanerturan) with **Claude**, working in Claude Code. Claude wrote
almost all of the code in this repository, ran the renders, the training and the GPU paintings, and wrote the notes
the how-it-works page is built from. The human chose the city, the look and the landmarks, and kept sending things
back until they were right.

It follows the method of [tiny.london](https://tiny.london) (Boris Starkov) and [isometric.nyc](https://isometric.nyc)
(Andy Coenen); every map we know of is in [our atlas](https://tirana.fyi/world/) and in
[tiny.london/world](https://tiny.london/world/).

## How it works, in one paragraph

A headless browser renders Google Photorealistic 3D Tiles through one fixed orthographic camera (`render/`). An image
model drew ~120 of those renders as pixel art; after a numeric check against ground truth they became training pairs
(`teacher/`). A LoRA on Qwen-Image 2.1 learned the style (`train/`). The sampler paints the city in overlapping 8192 px
blocks that pin their neighbours' pixels, then heals the leftover seams with soft SDEdit strips (`sampler/`,
`post/heal_*`). The result is cut to the shape of the city (`post/shape.py`), tiled to Deep Zoom (`post/dzi_store.py`)
and shown with OpenSeadragon plus a few canvas layers (`viewer/app/`). Details, costs and lessons:
[how it was made](https://tirana.fyi/app/how.html).

## Layout

| Folder | What is in it |
| --- | --- |
| `render/` | 3D-tiles renderer (Puppeteer + three.js), the shared camera projection (`project.py`) |
| `teacher/`, `train/` | training-pair generation and QA, ai-toolkit LoRA config |
| `sampler/` | block painter (`blocks.py`) and the joint / heal sampler (`joint.py`) |
| `post/` | everything after painting: seam healing, water tone, shape and clouds, Deep Zoom tiles, bakes for roads, buses, lake life and the cable car |
| `colab/` | launchers and helpers for Google Colab G4 sessions |
| `landmarks/` | landmark art prompts and generator |
| `viewer/app/` | the map itself (static ES modules, no build step); `geo.js` holds the camera and ground constants for JS and Python |
| `viewer/world/` | the atlas of isometric cities |
| `deploy/` | Cloudflare Worker (static site, live-plane proxy, anonymous analytics) and the R2 tile uploader |

Generated data, model weights and tiles are not in the repository (tens of GB). The painted tiles are served from
Cloudflare R2.

## Running it locally

```sh
python3 viewer/dev_server.py          # serves viewer/ on http://127.0.0.1:8765/ (plus /api/planes)
open http://127.0.0.1:8765/app/       # needs a tile set in viewer/tiles_shaped/, or ?tiles=<url of a Deep Zoom set>
```

## Licences and credits

- **Code:** written for this project; ask before reusing it commercially.
- **The painting and the model** are derived from Google Photorealistic 3D Tiles (© Google), Qwen-Image (Qwen Research
  Licence, non-commercial) and tiny.london's published LoRA (non-commercial). The map is a personal, non-commercial
  project, and so is anything made from it.
- **Names and roads:** © OpenStreetMap contributors (ODbL). **Buses:** Tirana GTFS. **Planes:** adsb.lol and adsb.fi.
- **Landmark photos:** Wikimedia Commons, each credited on its card (`viewer/app/lm/credits.json`). **Landmark art:**
  GPT Image via fal.ai, made for this map.
