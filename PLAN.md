# Tiny Tirana: build plan

Personal, non-commercial isometric map of central Tirana. Method follows tiny.london and Isometric Toronto, the two most complete write-ups (see `../research/guides/london.md`, `toronto.md`). Earlier work and checkpoints are in `../TiranaMap/`.

## Decisions (5 Nov 2026)
- **Style:** the s1000 look. Checkpoint: `../TiranaMap/workspace/tirana_v2_run/ckpt/tiranaiso_v2_000001000.safetensors`. Base model Qwen-Image-2.1-Turbo, trigger `tiranaiso`, 8 steps, guidance 1.0.
- **Camera:** the old one, kept because the LoRA was trained on it. Orthographic, heading 315 (looking NW), tilt 45, 0.1465 m/px (1024 px = 150 m).
- **Area:** the old 11×11 core (Skanderbeg, Pyramid, Blloku, Lana), extended south-west to include Grand Park and its lake.
- **Licence:** personal use only. That fits the Qwen Research licence and the tiny.london LoRA licence. Never train on Istanbul's or any other map's tiles.
- **Keys:** the Maps key (Map Tiles API only) is in `~/.config/tirana-map/google_maps_api_key`. Colab CLI is logged in with oauth2, balance 1020 CU.

## What every successful map did, and what we were missing
1. **One camera for the whole map.** Use frustum offsets in whole pixels so every shot lines up to the pixel ("Get the camera right first", Toronto). The old pipeline re-centred the camera for every tile, so shots were not registered.
2. **Draw the whole map as one latent.** Use joint sampling (MultiDiffusion): 1024 windows on a 768 stride, a second grid shifted by 384 on odd steps, tent weights. Finished blocks are held fixed with RePaint "pinning". This makes seams go away. The old pipeline feather-blended separate tiles, which caused the ghosted trees.
3. **A teacher model makes training data, the LoRA draws the map.** The teacher is Gemini 3 Pro Image through the Batch API (about $0.07 per call). The prompt puts fidelity first and says how to draw, never what. It adds a water sentence per frame taken from OSM. Each output is checked automatically against ground truth: the render for structure, a flat-pixel share test for photo copies, OSM for water, OCR for invented text. Up to 3 tries, then the frame is dropped.
4. **Pick checkpoints by eye on held-out frames.** Earlier checkpoints often win (s1000 here, s2500 in Toronto, s3000 in Toronto v1).
5. **Post-processing:** a global tone match (joint canvases drift darker), water repair from OSM water plus a Poisson patch, and a deep-zoom pixel-art layer (one 256-colour palette, light ordered dither, nearest-neighbour).
6. **Viewer:** OpenSeadragon with a Deep Zoom pyramid of 512 px WebP tiles on Cloudflare R2. Every version is immutable, in its own folder.

## Phases
- **P1 Render (local, M5 GPU, ~free):** renderer v3 with one camera and frustum offsets in one persistent page (one root request per session). Render the whole area as a registered mosaic and check the overlaps match.
- **P2 First map with the existing s1000 LoRA (Colab G4):** a joint sampler around Qwen-Image-2.1-Turbo plus the LoRA. Run a pilot block first, then the full area, and check seams and weak spots.
- **P3 Better LoRA (only where P2 shows gaps, e.g. Skanderbeg Square, the lake, the Lana, landmarks):** teacher pairs with automatic QA, then train v3 on G4 (rank 32, checkpoints every 500, held-out eval). Gemini spend needs the user's OK first.
- **P4 Post-processing and viewer:** tone match, water repair, pixel-art layer, DZI on R2, and an OpenSeadragon page with search.

## Budget guardrails
- Colab: `colab stop` after every run. Record the CU balance before and after.
- Google tiles: about 1,000 free root requests a month, $6 per 1k after that. Reusing sessions keeps us well under.
- Gemini: hard dollar cap in the scripts. Use Batch API pricing.

## Rotation (decided 5 Nov 2026)
- Four painted maps (headings 315/45/135/225) plus height maps from the renderer (`render.js --height 1`). The viewer orbits by depth-mesh view blending, as in the `viewer/orbit/` demo.
- **Final product:** rotation only via buttons/keys, as a fixed-speed animated 90° orbit (~0.9 s). **No free mouse/drag orbiting.** In-between angles show messy textures and are only acceptable in motion. The 2D turntable warp and the pixel dissolve were rejected (the warp caused motion sickness).
- **Directions (decided 6 Nov 2026): 4** (headings 315/45/135/225) for the citywide map, ~180 CU for central Tirana. 8 directions were tested (cleaner mid-turn) but judged not worth 2× the cost.
