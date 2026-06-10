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

- **`routing.html`** (default) — Newport→Bermuda **isochrone ensemble routing** on
  Google 3D Tiles. Each ensemble member gets a true optimal route from the isochrone
  engine (`lib/router.js`: heading fan + sector pruning, tack/gybe penalties, current
  vectors, land-avoidance boxes, sub-step arrival ETAs), so the fleet genuinely
  diverges. Member routes are colored by arrival percentile (teal fast → red slow),
  with the 5–95% envelope, median line + 24h ticks, and Newport / Bermuda harbor
  insets. A **passage playback bar** (play / scrub) animates the 51-boat fleet along
  their routes with a live median SOG / distance-to-go readout, synced to a **live
  wind-field arrow layer** (deterministic Open-Meteo grid over the corridor, colored
  by TWS) and a "now" marker on the ETA histogram. Panel: vessel polar, departure
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
electron/        main.js (tile proxy + control server), preload.js
lib/             router.js (isochrone engine), vessel.js (active-vessel store), orcdata.js (ORC fleet)
index.html       harbor / ocean-stitch view
routing.html     isochrone-routing view (default)
docs/            01 architecture · 02 boundaries & bathy stitch · 03 layered roadmap
scripts/         convert-s57-to-pmtiles.sh, test-3dtiles-proxy.mjs
enc_charts/      S-57 ENC source data (San Diego cell)
.env             GOOGLE_MAPS_API_KEY (gitignored)
```

## Dev control API

The main process runs a local control server on `127.0.0.1:9123` for headless
driving/observation (used during development):

- `GET /screenshot[?view=dep|arr]` — PNG of the rendered Cesium canvas
- `POST /eval` (body = JS) — run JS in the renderer (`window.m.*` exposes camera/viewers)
- `POST /reload` — reload the page

Set `MERIDIAN_DEVTOOLS=1` to open DevTools.

## ToS / cost notes

Google Photorealistic 3D Tiles are online-only and metered (one root request ≈ one
session). Attribution (Cesium credits) must stay visible; no tile caching. Set a daily
quota + budget alert in Google Cloud Console. See `docs/01`.
