# Tiny Tirana viewer: spec (v1 launch)

Built from what the other 66 maps did (see `../../research/guides/*.md`, "Viewer & hosting" and "Extras" sections). The source is cited in brackets after each item.

## Core
- **Deep zoom:** OpenSeadragon on a DZI pyramid of 512 px WebP tiles. Nearest-neighbour above 100 %, smooth below [London, João Pessoa]. The parent tile shows as a backstop while children load, so there are never blank areas [Seoul, London]. First-view tiles are prefetched [London].
- **Hosting:** Cloudflare R2 behind a custom domain. Every version lives in its own immutable folder, with one small uncached pointer file naming the current version [London, Toronto-Nadar, João Pessoa].
- **State in the URL:** `#lat,lon,zoom,heading`. Any view can be shared and reopened exactly [Isopolis].

## Rotation (ours; nobody else ships it)
- 4 painted directions: 315 (default, NW), 45, 135, 225. Rotation is **only by buttons or keys**: a fixed-speed 0.9 s orbit that always lands on a painted direction. No free mouse orbit (see `../PLAN.md`).
- During normal browsing OSD shows the current direction. On ⟳/⟲ the area around the screen centre is handed to the WebGL orbit (paint plus height tiles; depth-mesh blending of the 2–3 nearest directions, round mask as in `orbit8/`). After the turn, the new direction's DZI takes over, centred on the same ground point at the same zoom. The projection maths is shared (`render/project.py`, ported to JS).
- A compass shows the current direction.

## Find and explore
- **In-browser search**, Albanian and English, diacritic-insensitive (ë→e, ç→c). It covers OSM places, streets, landmarks and neighbourhoods (lagje / njësi bashkiake) [Berlin, Istanbul, London]. Results fly to the place.
- **"Go to" menu** of landmarks plus a few short **tours** (Centre: Skanderbeg → Et'hem Bey → Pyramid → Blloku; Lake & Grand Park) [Toronto, Isopolis, Mexico City].
- Optional paste of a Google Maps link or lat/lon [Isopolis, Istanbul].

## Share
- A **share** button copies a link to the current view. **Postcard**: download the current view as an image with a small "Tiny Tirana" caption [Isopolis, Istanbul, Toronto].

## Pages
- **How we made it**: the pipeline, honest costs, lessons, and credits to the projects we learned from [London, Toronto, Istanbul].
- **Credits & licences**: Google 3D Tiles attribution, OSM ODbL, Qwen licence (non-commercial), "personal, non-commercial project".
- `llms.txt` with a short machine-readable description [London, Istanbul].

## UI
- Albanian/English toggle [Istanbul, Mexico City]. A small top bar: title, search, Go to, rotate, share, menu. Keyboard: ← → rotate, / search, +/- zoom.
- Works on phones: big touch targets, the search sheet slides up.
- **Painted ↔ 3D render** slider (ours). Before publishing, check Google's terms on showing raw renders [Bengaluru handoff warning].

## Later (not v1)
Day/night on Tirana time with a lights layer [Seoul, Prague, Toronto-Nadar]; clouds band at the map edge [London]; live buses if Tirana publishes GTFS [Stockholm, Toronto]; clickable buildings via an id-tile layer [Toronto-Nadar]; deep-zoom pixel-art layer [Toronto].
