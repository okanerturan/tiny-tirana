# Deploying Tiny Tirana

Static site (Cloudflare Pages) + tiles (R2) + one Worker for `/api/planes` (live aircraft) and `/api/e` (anonymous events).

## What gets published (allowlist)

Only these leave the machine. Everything else under `viewer/` is development material, and several folders contain
Google 3D renders (compare/, pairs/, eval_v3/, tiles_check/, orbit*/, scenes/, style/, the render tiles): never deploy those.

    viewer/index.html            redirect to app/
    viewer/app/                  the map (no render tiles; the 3D comparison toggle is removed)
    viewer/world/                the atlas
    viewer/tiles_city/           city tiles (+ map_index.json)   -> R2
    viewer/tiles_airport/        airport tiles (+ map_index.json) -> R2

## Worker

`deploy/planes-worker.js`, routed on the site's domain for `/api/*`. `wrangler.toml`:

    name = "tiny-tirana-api"
    main = "planes-worker.js"
    compatibility_date = "2026-11-01"
    routes = [{ pattern = "tirana.fyi/api/*", zone_name = "tirana.fyi" }]
    [[analytics_engine_datasets]]
    binding = "EVENTS"
    dataset = "tiny_tirana_events"

## Analytics

* Visits: turn on **Web Analytics** for the Pages project (Cloudflare dashboard, one switch; cookieless beacon).
* Events: `viewer/app/analytics.js` -> `/api/e` -> Analytics Engine dataset `tiny_tirana_events`
  (index1 = event name; blob1 = per-tab random id, blob2 = language, blob3 = country, blob4.. = `key=value` properties).
  Nothing is sent with Do Not Track / Global Privacy Control, and no cookies are set. The disclaimer is in the app's
  About dialog and the guide's Privacy paragraph.

Example queries (SQL API, `https://api.cloudflare.com/client/v4/accounts/<id>/analytics_engine/sql`):

    -- most opened landmark cards, last 7 days
    SELECT blob4 AS landmark, SUM(_sample_interval) AS opens FROM tiny_tirana_events
    WHERE index1 = 'landmark' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY landmark ORDER BY opens DESC
    -- where people look (map centre rounded to ~1 km)
    SELECT blob4 AS lat, blob5 AS lon, SUM(_sample_interval) AS n FROM tiny_tirana_events
    WHERE index1 = 'look' GROUP BY lat, lon ORDER BY n DESC LIMIT 200
    -- visits per day and device
    SELECT toStartOfDay(timestamp) AS day, blob4 AS device, COUNT(DISTINCT blob1) AS visits FROM tiny_tirana_events
    WHERE index1 = 'view' GROUP BY day, device ORDER BY day

Local testing: `viewer/dev_server.py` accepts `/api/e` and appends to `data/analytics_dev.jsonl`; open the app with
`?analytics=dev` (analytics is off on localhost otherwise).
