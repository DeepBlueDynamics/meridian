# 01 — Vision & Architecture

## What we're building

A marine navigation terminal (TimeZero / ECDIS-class) for cruising, recreational,
and fishing use. One unified, tiltable 3D view that fuses:

- A **marine chart** that works offline: bathymetry (read the seafloor), seamarks
  (buoys/lights/channels), a lat/lon grid, and S-57-derived vector charts.
- A **photoreal "harbor" overlay**: Google Photorealistic 3D Tiles for the last
  mile into an unfamiliar harbor — every dock, breakwater, and channel marker in
  3D. Online-only, metered, opt-in.
- **Live ownship + AIS traffic**, a heading/nav instrument panel, and an AIS
  collision-avoidance radar.

The product thesis: the offline chart is the workhorse; the photoreal layer is the
wow-factor you switch on with signal near port. The two must **mix**, not fight.

## The hard constraints (these drive every decision)

1. **Offline-first.** Boats go offshore. The default stack must render with no
   connection. Google tiles are a bonus layer, never the base.
2. **The Google key never reaches the client.** It lives in a backend/host
   process; the renderer talks to a same-origin/app-scheme proxy. (Map Tiles API
   ToS + single point of revocation.)
3. **ToS compliance is code, not a promise.** Attribution always visible; no
   persistent caching of Google tiles (HTTP cache only); no derivative works; no
   non-display use; gated access only.
4. **Metered cost.** One "root tile request" = one session (~3 h of free child
   fetches) ≈ $0.006 after 1,000/month free. So: default-off, auto-pause on idle
   and offline, hard daily quota + budget alerts in Cloud Console.

## Stack speculation (what we'd pick building from scratch)

### Desktop shell — Electron vs Tauri

| | Electron | Tauri |
|---|---|---|
| Language | JS/TS everywhere | Rust core + JS UI |
| Bundle | ~150 MB | ~10 MB |
| Tile proxy | trivial in main process | clean as a Rust command/sidecar |
| WebGL/Cesium | Chromium, predictable | system WebView (WebView2/WKWebView) — Cesium works but more variance |
| Team velocity | high (all JS) | slower (Rust) but safer core |

**Verdict:** Tauri is the lighter, arguably "best" long-term answer — a Rust tile
proxy is tidy and the binary is tiny, good for ruggedized helm hardware. **But we
pick Electron** for v2: the renderer's WebGL behavior is predictable (the system
WebView variance matters when you're pushing Cesium + 3D Tiles hard — see the
clipping-plane crash in doc 02), the key-proxy is a 60-line `protocol.handle`, and
shipping velocity wins for now. Keep the proxy logic isolated so a future Tauri
port is a swap, not a rewrite.

### Rendering engine — Cesium vs three.js+3d-tiles-renderer vs deck.gl vs MapLibre

- **MapLibre GL** — *rejected.* No OGC 3D Tiles renderer; can't show Google
  Photorealistic Tiles. (This is the wall the v1 prototype hit.)
- **deck.gl `Tile3DLayer`** — renders Google tiles over a MapLibre basemap. Good,
  but you inherit two engines and deck/MapLibre interop quirks.
- **CesiumJS** — batteries-included globe, terrain, 3D Tiles, imagery layers,
  entities, bathymetry. The pragmatic choice and what v2 uses.
- **three.js + `3d-tiles-renderer` (NASA-AMMOS)** — the *from-scratch* power
  option. You own the render loop, so you can do things Cesium fights you on —
  e.g. **per-tile/elevation water culling** (the feature Cesium's clipping planes
  crashed on). Heavier lift; document as the escape hatch if the water-mix needs
  to become a hard cut rather than a blend.

**Verdict:** CesiumJS now; keep all Cesium calls behind a thin `lib/globe` façade
so a future three.js swap (for custom water culling) touches one module.

### UI framework — React vs Svelte vs Vanilla

v1 was React. Building fresh, the instrument panels (heading, radar, AIS list) are
small reactive widgets over one shared ship-data store — **Svelte 5 (runes)** fits
perfectly: compiles away, tiny runtime, no re-render churn next to a 60 fps WebGL
canvas, and a clean `$state`/`$derived` store for NMEA/AIS data. **v2 uses Svelte +
TypeScript.** (React/Preact remain fine; this is preference + bundle.)

### Language & build

- **TypeScript** throughout — a nav app deserves types on lat/lon/heading/AIS.
- **Vite** for the renderer (+ `vite-plugin-cesium` to stage Cesium's static
  Assets/Workers/Widgets with relative `base` for Electron `file://` and a future
  web/Hyperia sub-path mount).
- Electron `main`/`preload` stay plain ESM JS (small, no build step, proven).

## System architecture

```
┌───────────────────────────────────────────────────────────────┐
│ Renderer  (Vite + TS + Svelte 5)                              │
│   App.svelte                                                   │
│   ├─ ChartView  ── lib/globe (Cesium façade)                  │
│   │     • base: bathy + seamarks + grid imagery layers        │
│   │     • overlay: Google 3D Tiles  (src = app://3dtiles/…)   │
│   │     • mix: tileset translucency / future hard cut         │
│   │     • entities: ownship + AIS                             │
│   ├─ Sidebar: NavPanel (heading/COG/SOG/depth/WPT) + AisRadar │
│   └─ store: shipData ($state)  ← sim or live AIS / NMEA       │
└───────────────────────────┬───────────────────────────────────┘
            app://3dtiles/*  │  (same renderer, custom scheme)
                             ▼
┌───────────────────────────────────────────────────────────────┐
│ Electron main  (key lives ONLY here)                          │
│   • protocol.handle('app') → tile.googleapis.com + KEY        │
│       rewrite Google origins → app://3dtiles, strip key,      │
│       pass Cache-Control, NO caching                          │
│   • loads .env (GOOGLE_MAPS_API_KEY, VITE_AISSTREAM_KEY)      │
└───────────────────────────┬───────────────────────────────────┘
                             ▼  HTTPS + key
                     tile.googleapis.com
```

Live data (AIS via AISStream WebSocket, geocoding via Nominatim) goes
renderer-direct — no key, no proxy needed. Only Google traffic is proxied.

## Lessons baked in from v1 (don't relearn these)

- **Google 3D Tiles are global** — as a base they hide every raster overlay. They
  must be a *toggleable overlay on top of* the chart, not the base.
- **Cesium `ClippingPlaneCollection` crashed this GL context** (`UniformSampler`
  `_target` undefined). Hard sea-level water-clipping via clip planes is not
  reliable here → use translucency blend now, coastline **clipping polygons** or a
  three.js renderer later. See doc 02.
- **`Cesium.Color.fromCssColorString` rejects 4-/8-digit hex** → use `.withAlpha()`.
  A throw mid-init aborts the scene before `camera.setView` (symptoms: blue
  `baseColor` flooding + stuck home view). Set `globe.baseColor` dark anyway.
- **React StrictMode double-mounted the viewer** and the async tileset load landed
  after teardown — wasting a billed root request. Guard every async-after-await
  with "is my viewer still current?". (Svelte avoids the double-mount, but keep
  the guard for offline/tab-leave.)
- **Never blanket-kill `electron.exe`** in a multi-Electron environment — you'll
  take down other apps. Track and stop only your own process.

See `02-data-sources-and-integration.md` for how each layer is sourced and wired,
and `03-implementation-roadmap.md` for the build order.
