# Meridian

Marine navigation built on **Electron + CesiumJS**, rendering **Google Photorealistic
3D Tiles** with the API key hidden behind a main-process proxy. Built one layer at a
time — see `docs/`.

## Run

```bash
npm install
cp .env.example .env     # then put your Google Maps API key in .env
npm start
```

The Google key lives **only** in the Electron main process. The renderer loads tiles
from a custom `app://3dtiles/*` protocol; the main process attaches the key, rewrites
Google origins back to the proxy, and streams tiles through — so the key never reaches
the page and the browser only ever talks to the proxy. See `docs/01-vision-and-architecture.md`.

## Views

`electron/main.js` starts on the **Vessel Setup** page (`setup.html` — pick a boat
from the live ORC fleet; its certificate polar drives the router) unless
`MERIDIAN_VIEW=routing|harbor` selects another view; the header nav switches at runtime:

- **`routing.html`** (default) — **isochrone ensemble routing** on Google 3D
  Tiles. Each ensemble member gets a true optimal route from the isochrone engine
  (`lib/router.js`: heading fan + course-axis sector pruning, tack/gybe penalties,
  current vectors, sub-step arrival ETAs). **Motoring** is modeled
  PredictWind-style — engine at X kt whenever sailing VMG toward the mark drops
  below Y kt (with hysteresis), editable in the panel and persisted; engine
  hours / % motoring reported. **Land avoidance** uses Natural Earth coastline
  polygons (`lib/landmask.js`: 50m land + 10m small islands, corridor rasterized
  to ~1.2 nm cells with a one-cell safety dilation; ports snap to water anchors),
  verified to 0 land intersections at 0.1 nm on a Ft. Lauderdale→St John run.
  The display shows the **P5 / P50 / P95 representative member routes** (solid =
  sailing, dashed = motoring, 24h ticks on P50) over a dashed 5–95% envelope —
  raw 51-member spaghetti sits behind a FLEET toggle. A **passage playback bar**
  (play / scrub) animates the fleet with a live median SOG / ⚙-motor /
  distance-to-go readout, synced to a **live wind-field arrow layer** and a "now"
  marker on the ETA histogram. Panel: vessel polar, departure
  offset, currents toggle, ETA distribution, risk metrics. The DEP/ARR header
  boxes are clickable — search any port (Nominatim geocoding) and the whole
  pipeline refetches + re-routes for the new leg; route persists in localStorage.
  Header also shows live WIND / GUST at the fleet-median boat, and each harbor
  inset shows its local wind. Pathological tracks are pruned from the display
  ("N✂" in the Arrived stat). Live data: Open-Meteo ensemble wind + marine
  currents + forecast grid, Nominatim ports (no keys).
- **Vessel fleet** (`setup.html`) — live ORC certificate polars plus built-in
  estimated cruising-catamaran polars (Lagoon 380/42/450F, badged "est polar";
  ORC doesn't certify multihulls).
- **Telemetry** — renderer errors (window.onerror, unhandled rejections, Cesium
  renderError) POST to the control server's `/telemetry` and append to
  `telemetry.log` (gitignored) — a local stub for a future remote sink.
- **`index.html`** (`MERIDIAN_VIEW=harbor`) — the harbor/ocean spike: Google 3D Tiles
  with bathy + seamarks + grid overlays and a translucent ocean stitched at the real
  (geoid-corrected) sea level.

## Project layout

```
electron/        main.js (tile proxy + control server), preload.js, bridge.js (sidecar WS client)
sidecar/         meridian-sidecar (Rust): MCP agent surface on :9124 + the isochrone
                 route engine (route/, bit-parity with lib/router.js — see
                 spec/2026-06-11/spec-route-sidecar.md). cargo test runs the
                 math-corpus + golden-fixture parity gates.
lib/             router.js (JS isochrone engine — fallback), fdmath.js (fdlibm-pinned
                 trig BOTH engines share), landmask.js, vessel.js, orcdata.js
index.html       harbor / ocean-stitch view
routing.html     isochrone-routing view (default; routes via the sidecar, falls back to JS)
docs/            01 architecture · 02 boundaries & bathy stitch · 03 layered roadmap
scripts/         run.ps1 (full-stack dev runner), gen-math-corpus.mjs +
                 gen-route-fixture.mjs (parity harness), make-review-zip.mjs, …
enc_charts/      S-57 ENC source data
.env             GOOGLE_MAPS_API_KEY (gitignored)
```

## Dev control API

The main process runs a local control server on `127.0.0.1:9123` for headless
driving/observation (used during development):

- `GET /screenshot[?view=dep|arr]` — PNG of the rendered Cesium canvas
- `POST /eval` (body = JS) — run JS in the renderer (`window.m.*` exposes camera/viewers)
- `POST /reload` — reload the page
- `GET/POST /window` — window bounds / resize (recording presets)

The **agent surface** is the Rust sidecar on `127.0.0.1:9124`: MCP over
streamable HTTP at `/mcp` (15+ tools — app control, radio, sim, route engine;
see `sidecar/mcp/README.md`) and the route job API
(`POST /route/compute`, `GET /route/status/{id}`, `GET /route/result/{id}`,
`POST /route/cancel/{id}` — contract in `spec/2026-06-11/spec-route-sidecar.md`).

Set `MERIDIAN_DEVTOOLS=1` to open DevTools.

## ToS / cost notes

Google Photorealistic 3D Tiles are online-only and metered (one root request ≈ one
session). Attribution (Cesium credits) must stay visible; no tile caching. Set a daily
quota + budget alert in Google Cloud Console. See `docs/01`.
