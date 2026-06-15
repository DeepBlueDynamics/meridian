# 03 — Layered Build Roadmap

Principle: **strip it down, add one layer at a time, prove each before the next.**
No big-bang scaffold. We start with the leanest thing that renders a harbor and
grow. The heavy framework comes *late*, only once the hard rendering problems
(boundaries, bathy stitch) are solved.

## Layer 0 — Harbor view, minimal (foundation) ← build first
- Plain **Electron** + a single `index.html` loading **Cesium** (CDN to start —
  no bundler, no framework). The whole point is the smallest thing that shows a
  photoreal harbor with the **key hidden**.
- Electron `main.js`: the `app://3dtiles/*` proxy (key from `.env`, origin
  rewrite, no caching) — ported from v1, it's proven.
- Renders Google 3D Tiles for one harbor; attribution visible.
- **Done when:** a harbor renders, DevTools shows traffic only to `app://3dtiles`,
  no `AIzaSy` in the page.

## Layer 1 — Boundaries (the spike) ← the current priority
- Get land/water polygons for one harbor (S-57 `DEPARE`/`LNDARE` → GeoJSON; OSM
  water polygons as backstop). See doc 02.
- Draw them as a **debug overlay** on the harbor scene; confirm they line up with
  Google's coastline.
- **Done when:** our boundary polygons visibly match the real shoreline.

## Layer 2 — Bathy stitch
- Replace debug fill with **depth-shaded water** (T1: draped `DEPARE` polygons,
  shoal→deep ramp + danger band). Then try **T2** (clip Google to land) and pick.
- **Done when:** seafloor reads under/around the harbor and joins cleanly at the
  coast.

## Layer 3 — Chart furniture
- Seamarks (OpenSeaMap imagery layer), lat/lon grid, scale, soundings from
  `SOUNDG`. Toggles.

## Layer 4 — Ownship & AIS
- Ownship entity from the ship-data model (sim now; NMEA/GPS later).
- Live AIS via AISStream WebSocket (key in `.env`), targets as entities.

## Layer 5 — Instruments
- Heading/COG/SOG/depth/waypoint panel + AIS collision radar. (Still vanilla or a
  tiny reactive helper — keep it light.)

## Layer 6 — Framework & packaging (only now)
- If the UI has earned it, migrate the renderer to **Vite + TypeScript + Svelte 5**
  (see doc 01), keeping all Cesium behind a `lib/globe` façade and the proxy
  untouched. Bundle Cesium with `vite-plugin-cesium` for offline.
- `electron-builder` packaging; quota/budget alarms documented; offline smoke test.

## Later / parallel tracks
- Offline chart store: S-57 → PMTiles (`scripts/convert-s57-to-pmtiles.sh`).
- Web/Hyperia target: move the proxy to a host endpoint or session-token broker.
- Auth / per-user metering / BYO-key tier.

## Rules of the build
- Each layer compiles/runs before the next starts.
- Keep Cesium calls behind one module; keep the proxy isolated (future Tauri swap).
- ToS always on: attribution visible, no Google-tile caching, default-off where
  metered, auto-pause offline/idle.
- Never blanket-kill `electron.exe`; stop only our own process.
