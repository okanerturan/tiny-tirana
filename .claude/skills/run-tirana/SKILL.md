---
name: run-tirana
description: Build, run, test and screenshot Tiny Tirana, the isometric AI map of Tirana. Use when asked to start or serve the map viewer, take a screenshot of the map, render Google 3D tiles, check renderer registration, run the joint sampler on Colab G4, tile a map into Deep Zoom, or test sampler/renderer changes.
---

Tiny Tirana is a pipeline, not one app: `render/` (headless Chrome + Google 3D Tiles, one fixed orthographic camera) → `sampler/joint.py` (seamless joint sampling on a Colab G4) → `post/` (mosaic, DZI tiles) → `viewer/` (static OpenSeadragon page). **Drive it with `.claude/skills/run-tirana/driver.mjs`**: it serves the viewer, clicks through it with puppeteer-core and the system Chrome, takes screenshots, and checks the renderer's pixel-registration invariant.

All paths below are relative to `tirana/`. This was verified on macOS (Apple M5, Node 26, Chrome 156) on 2026-11-05. No Linux run has been tried.

## Prerequisites

- Google Chrome at `/Applications/Google Chrome.app` (or set `CHROME_PATH`). puppeteer-core never downloads a browser.
- Node (26 used), plus `python3` with Pillow and numpy (Pillow 13, numpy 2.5 used). Also `uv`, which supplies torch for the CPU sampler test.
- The Colab CLI, only for the sampler:
  ```bash
  uv tool install google-colab-cli==0.7.5
  ```
  The one-time login needs a human: run `colab --auth=oauth2 sessions` in a terminal, open the link, and paste the code back.
- Maps key, only for rendering. It's read from `~/.config/tirana-map/google_maps_api_key` (or `GOOGLE_MAPS_API_KEY`). This is how it was created, restricted to the Map Tiles API:
  ```bash
  gcloud services api-keys create --project gen-lang-client-0185681234 --display-name="tirana-map-tiles" --api-target=service=tile.googleapis.com --format='value(response.uid)'
  ```

## Setup / build

```bash
cd render && npm ci --silent && npx esbuild app.js --bundle --format=esm --outfile=web/bundle.js && cd ..
```
Rebuild `web/bundle.js` after every edit to `render/app.js`. `render.js` serves the bundle, not `app.js`.

## Run (agent path): the driver

```bash
node .claude/skills/run-tirana/driver.mjs serve                       # python http.server for viewer/ on :8765 (idempotent)
node .claude/skills/run-tirana/driver.mjs shot --tiles tiles_pilot --out data/shots/pilot.png
node .claude/skills/run-tirana/driver.mjs shot --tiles tiles_pilot --mix 60 --out data/shots/pilot_mix60.png
node .claude/skills/run-tirana/driver.mjs shot --tiles tiles_check --place "Pyramid of Tirana" --out data/shots/check_pyramid.png
node .claude/skills/run-tirana/driver.mjs render-check                # ~95 s, 2 Google root requests
node .claude/skills/run-tirana/driver.mjs stop
```

| command | what it does |
|---|---|
| `serve [--port N]` | Starts the static server for `viewer/` in the background. The pid goes to `data/viewer-N.pid`. |
| `shot --tiles DIR [--place NAME] [--mix 0-100] [--out F] [--size WxH]` | Opens `viewer/index.html?tiles=DIR` and waits until every visible layer is fully loaded. Then it optionally clicks a place button and/or sets the painted↔render slider, and screenshots. It prints `{"imageZoom","mapOpacity","renderOpacity","size","errors"}` and exits 1 on any page error, failed request or HTTP ≥ 400. |
| `render-check [--out DIR]` | Renders the area around Skanderbeg as 1×2048 px and as 4×1024 px shots, then compares them. The expected output is `identical 99.72%  within8 100.00%  holes 0.000%`. Exits 1 below 99%. Run it after **any** change to `render/`. |

Screenshots go to `data/shots/` and render checks to `data/render/check/`. **Look at the PNG**: a dark page with only the UI panels means the tiles didn't load.

Tile sets the viewer expects: `viewer/<DIR>/map.dzi` + `map_files/` and `render.dzi` + `render_files/`. Make them with:
```bash
python3 -I post/dzi.py data/pilot1/map.png viewer/tiles_pilot/map
python3 -I post/dzi.py data/render/main_canvas.png viewer/tiles/render --quality 80
# tiles_check = the full render tiles reused as both layers (for testing place buttons before a full map exists)
mkdir -p viewer/tiles_check && for l in map render; do ln -sfn ../tiles/render.dzi viewer/tiles_check/$l.dzi; ln -sfn ../tiles/render_files viewer/tiles_check/${l}_files; done
```

### Direct invocation (for changes to internals)

- Sampler window and weight logic, on CPU with no GPU or model (10 checks, including the 1,157-window full-map count):
  ```bash
  uv run -q --python 3.12 --with torch --with numpy --with pillow --with safetensors python -I .claude/skills/run-tirana/test_sampler_logic.py
  ```
- Projection (lat,lon → canvas pixel u,v relative to the anchor; the full canvas origin is u=-14336, v=-6144):
  ```bash
  python3 -I render/project.py 41.323019,19.8215893      # -> u=-1235 v=2525 (Pyramid)
  ```

## Whole-app QA (run after every change to viewer/app)

```bash
node .claude/skills/run-tirana/driver.mjs serve            # viewer/dev_server.py on :8765 (static + /api/planes)
node .claude/skills/run-tirana/qa_app.mjs                  # 47 checks, exits 1 on any failure; screenshots in data/shots/qa/
# painting acceptance (after any repaint / merge): seams on block lines vs control lines, and Google-blurred patches
python3 -I post/qa_paint.py data/stores/merged --allow '-28800,-18304,-28160,-17792;-17152,-5632,-16768,-4992'
python3 -I post/qa_paint.py data/airport/airport_store --allow '-128,-57088,384,-56576;9600,-65024,10240,-64512;1536,-63616,2176,-63104'
```
The `--allow` boxes are inspected false positives (a treatment pond, a sports pitch, airport asphalt and dirt lots).
Covers: no page errors / failed requests (desktop, phone, Albanian), every side toggle flips and back, landmark card
opens with a REAL mouse click (markers use OpenSeadragon's MouseTracker, so a DOM `.click()` does nothing), card tabs,
card fits without scrolling, search, zoom cap 0.8, buses demo + lines menu, airport island + demo planes, guide/atlas/root pages.
Live layers (section 7): 300+ cars / 150+ birds; over 20 s no two cars in one spot, none inside a bus, <= 70 km/h, most
move; 100+ demo buses; no bus / car / duck pixel drawn off the painting (centre + 4 edges); 4 tilt-shift bands; no cloud
layer; every atlas thumbnail loads.

## Pipeline (full run)

1. **Render** (local GPU via Metal, 80 shots in ~14 min, **1** root request):
   ```bash
   cd render && node render.js --out ../data/render/main --area -14336,-6144,6144,10240 --shot 2048 && cd ..
   python3 -I post/mosaic.py data/render/main data/render/main_canvas.png
   ```
   This is resumable: existing `shot_v*_u*.png` files are skipped.
2. **Sample on Colab G4** (about 10 CU/hr; the full map takes ~45 min, the 4096 px pilot ~2.5 min). Follow `colab/OPERATING.md`.
   ```bash
   colab --auth=oauth2 usage
   colab --auth=oauth2 new -s tirana --gpu G4
   colab --auth=oauth2 exec -s tirana --timeout 120 -f colab/setup_cell.py        # background: ai-toolkit@e9c72b7 + weights, ~10 min
   (nohup colab/guard.sh tirana 240 > data/guard_tirana.log 2>&1 &)              # hard stop after 240 min
   colab/upload_big.sh tirana ../TiranaMap/workspace/tirana_v2_run/ckpt/tiranaiso_v2_000001000.safetensors /content/s1000.safetensors
   colab --auth=oauth2 upload -s tirana sampler/joint.py /content/joint.py
   colab/upload_big.sh tirana data/render/main_canvas.png /content/main_canvas.png   # 700 MB, ~2 min
   colab --auth=oauth2 exec -s tirana --timeout 60 -f colab/launch_full.py
   cd colab && colab --auth=oauth2 exec -s tirana --timeout 60 --env LOG=/content/full1.log --env N=4 -f peek.py; cd ..
   colab --auth=oauth2 download -s tirana /content/pilot1/map.png data/pilot1/map.png
   colab/download_big.sh tirana /content/full1/map.png data/full1/map.png          # 500 MB: 26 parts + sha256, ~1 min
   timeout 120 colab --auth=oauth2 stop -s tirana                                   # ALWAYS; then:
   colab --auth=oauth2 usage                                                        # "Usage rate: 0.00/hr", "Active assignments: 0"
   ```
   Measured cost on 2026-11-05: 4096 px pilot + full 335 MP map + setup = 11.9 CU.
   `setup_cell.py` is done when `peek.py` (default `LOG=/content/setup.log`) shows `SETUP_EXIT=0`. A healthy job log reads `cond 1151/1157` → `step 1/8 ... windows 567 292s` → … → `saved map.png`.
3. **Tile and view:** `post/dzi.py` as above, then `driver.mjs shot --tiles tiles`.

### Finishing the whole city (block mode, verified 2026-11-06)

Regions A/B/C and the seam blocks are painted by `sampler/blocks.py` into tile stores (`t_`/`m_` 2048 px PNGs, camera px). After download (`download_big.sh` checks sha256):
```bash
python3 -I post/merge_stores.py data/stores/merged data/stores/tirana/big_store     # first painter wins, mask-aware
python3 -I post/fill_blur.py data/stores/merged U0 V0 U1 V1 SU0 SV0 SU1 SV1 --poly 'u,v;...' [--tone|--kerb] --dry out.jpg   # Google-blurred sites
# heal block seams (see Gotchas): scan, cut strips per axis, run on a G4, blend back; V round first, then H from the healed store
python3 -I post/heal_prep.py data/stores/merged data/heal/v1 --lines LINES.json --bad BAD.json --axis V --shots data/region_A/shots,...,data/big_jpg/shots
#   on the G4: TAR=/content/r1.tar START=5 colab/launch_heal.py  -> /content/heal_out_r1.tar (joint.py --heal)
python3 -I post/heal_apply.py data/stores/merged data/heal/v1 data/heal/out/r1 --backup data/stores/backup_heal_city
python3 -I post/water_tone.py data/stores/merged V|H LINE A0 A1 [--dry out.jpg]       # calm water only: tone step left by healing
python3 -I post/dzi_store.py data/stores/merged viewer/tiles_city/map --formats avif,webp   # prints origin + size for CONFIG
python3 -I post/tile_index.py viewer/tiles_city/map                                  # map_index.json: which tiles exist
python3 -I post/lm_crops.py data/stores/merged viewer/app/lm                         # card "on this map" views
node .claude/skills/run-tirana/qa_app.mjs                                            # 34 checks
```
Then put the printed origin and size in `CONFIG.map` / `CONFIG.canvasOrigin` (app.js) and the `.minimap` aspect-ratio (index.html).

## Run (human path)

```bash
node .claude/skills/run-tirana/driver.mjs serve    # then open http://127.0.0.1:8765/index.html?tiles=tiles_pilot
```

## Gotchas

- **OpenSeadragon 4.1 rejects `Format="webp"` in `.dzi` files** ("Sorry, we don't support WEBP-based Deep Zoom Images"). `viewer/index.html` parses the `.dzi` XML itself and builds a `getTileUrl` tile source. Don't "simplify" it back to `tileSources: 'x.dzi'`.
- **OSD never loads tiles for a layer at opacity 0.** The render layer only loads when the slider moves, so any "wait until loaded" check has to skip hidden layers (the driver does).
- **`viewer/places.json` is in full-canvas pixels.** With `tiles_pilot` (a 4096 px crop) the place buttons pan off the image. Test places with `tiles_check`, which symlinks the full render tiles as both layers, or with the full map.
- **The camera is frozen:** heading 315, tilt 45, 0.1465 m/px, anchor 41.3275,19.8187, groundH 155. The s1000 LoRA, `places.json` and every saved canvas depend on it. Shot size doesn't matter (registration is exact), but camera parameters do.
- **Never run two `colab exec` at once on one session.** They queue on the same kernel, and the second dies with a `jupyter_kernel_client ... execute_interactive` traceback. Use one poller.
- **`colab exec --timeout 60` does not bound the client.** A frozen stream hung for 15+ min. Always wrap it in `timeout 90 colab ...` in poll loops. Killing the client is safe; the job is a separate process.
- **`colab upload` of large files fails with a 500,** and an upload into a folder that doesn't exist fails silently. Use `colab/upload_big.sh`: it creates the folder, sends 20 MB parts with retries, joins them and checks the sha256.
- **`colab new --gpu G4 --high-mem` is rejected** ("Backend rejected accelerator 'G4'"). Plain `--gpu G4` works and still gives 176 GB RAM and 236 GB disk.
- **The VM clock is UTC.** Log timestamps are 1 h behind CET.
- **Long jobs must be background processes on the VM** (`launch_*.py` uses `Popen`, logs to `/content/*.log`, and checks `pgrep -f '[j]oint.py'` first). The exec stream can freeze, and the job must survive that.
- **The full canvas (20480 px) is too big for WebP** (limit 16383), so upload it as PNG. Crops ≤ 16383 px can use lossless WebP (the pilot does).
- **`render.js` prints "DownloadPriorityQueue: maxJobs is no longer valid"** on every run. It's harmless.
- **Google blurs some sites in its 3D model** (sharp polygon, smeared inside), and the painter copies the smear. Scan new paintings for areas with no fine detail and fill them with `post/fill_blur.py`. Two were found in the city (41.3433,19.8371 and 41.3566,19.8536); the airport has none.
- **`dzi_store.py` skips empty tiles**, so the app must load `{base}_index.json` (`tile_index.py`) or OSD asks for them and gets 404s at the map's irregular edges. The same index clips buses, cars and ducks to the painting (`vehicles.js` `setPainted`).
- **Block mode leaves hard seams.** With 8 turbo steps the layout is decided at sigma >= 0.85, while the pinned strip is still mostly noise, so a block can ignore its pinned neighbour: buildings cut in half, straight lines through forests. Look at 1:1, not at an overview. Measure the step across every 1024-lattice line against the steps beside it, and compare with off-lattice control lines (healthy: <= 3% of 256 px segments above 1.6). Heal flagged lines with `joint.py --heal --start_step 5` (SDEdit from the painting, soft-pinned 1536 px strips). It cost 20 CU for the whole city plus the airport, and seam scores came back to the control level. Calm water keeps its low-frequency tone step after healing; fix that with `post/water_tone.py`.
- **A peek with `N=4` often has no `block` line,** so a watcher grepping for it looks stuck. Read 30+ lines before deciding a run is hung.
- **The Overpass API is often "at capacity" (502)** and the mirror can hang. Use Nominatim (`nominatim.openstreetmap.org/search`, 1 req/s, with a User-Agent) for point lookups.

## Troubleshooting

- **`RuntimeError: Input type (c10::BFloat16) and bias type (c10::Half) should be the same`** in `vae.encode`: ai-toolkit's `ModelConfig` defaults to fp16. `joint.py` must pass `dtype='bf16', vae_dtype='bf16'`.
- **`driver.mjs shot` → `TimeoutError: Waiting failed: 60000ms exceeded`:** the tiles dir is missing or wrong. Check that `viewer/<DIR>/map.dzi` exists and the server root is `viewer/`.
- **`ValueError: encoding error 5: Image size exceeds WebP limit of 16383 pixels`:** see the WebP gotcha above.
- **`[colab] Upload failed: 500 Server Error`:** use `colab/upload_big.sh`.
