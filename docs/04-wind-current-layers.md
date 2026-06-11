# 04 — Wind & Current Layers (spec)

**Component:** Wind & current visualization layers
**Status:** Implemented — `lib/field.js` + `lib/fieldlayer.js` + `layers.html` (see Implementation notes at bottom).
**License posture:** Apache-2.0. Data sources are open/permissive: ECMWF Open Data (CC-BY-4.0), GFS/NOMADS (public), MeteoFrance SMOC via Copernicus Marine (open w/ attribution), Open-Meteo aggregator JSON for dev convenience. Render stack deck.gl (MIT) over MapLibre (BSD-3).

## 1. Objective
Two GPU-rendered, time-animated layers — **Wind** and **Current** — that draw over the chart/3D globe, scrub through a forecast timeline, support cursor interrogation, and degrade gracefully offline from cached fields. They must look correct to a mariner, follow the project's committed indicator convention, and be fast enough to animate smoothly on a Pi-class GPU and on the helm display.

These are *presentation* layers over a shared wind/current data model; the same fields already feed the routing engine, so layer and router read one source.

## 2. Scope
**In:** the wind-field and current-field data model, fetch/cache/offline strategy, deck.gl render (the committed line convention), the timeline/animation control, cursor interrogation, palette/scale, and the Signal K "live at boat" overlay point.
**Out:** routing (consumes the same fields, separate engine), GRIB *ingestion service* (separate spec; this spec consumes decoded fields or the Open-Meteo JSON), waves/rain/storms layers (later, same pattern).

## 3. Shared data model (one source for layer + router)
Both layers are sampled scalar+vector fields on a lat/lon grid over forecast time:
```
Field {
  kind: "wind" | "current"
  grid: { lat0, lon0, dLat, dLon, nLat, nLon }   // regular grid
  times: ISO8601[]                                // forecast steps
  // per cell, per time:
  speed:     Float32Array   // knots (convert at ingest)
  direction: Float32Array   // degrees, see convention below
  // ensemble (wind only, optional): members[] of speed/direction + p5/p50/p95
  source: { model, run, fetched_at }
}
```
**Direction conventions are OPPOSITE between the two — this is the bug that produces wrong-looking layers:**
- **Wind = direction it comes FROM** (0°=from N). To draw the vector (direction moving toward), add 180°.
- **Current = direction it flows TOWARD** (0°=toward N). Do **not** apply the +180° flip.
Both stored in their native convention; the render layer applies the flip only to wind.

**Units:** convert everything to knots at ingest (wind via `wind_speed_unit=kn`; current km/h × 0.539957).

## 4. Indicator convention (committed — do not re-litigate)
- **Wind = white line** from the sample point, length ∝ wind speed, **no arrowhead**; line points the direction wind is moving toward (SW wind → line points NE).
- **Current = blue line** (`#4fa3ff`) from the **same sample point**, length ∝ current speed **× ~7** (currents are slower; scale up for visibility), **no arrowhead**.
- Speed labels in matching color at the line's end.
- **No offset between anchors** — wind and current share the dot. No arrowheads on either.
Sampling: draw lines on a screen-space grid (e.g., every ~48 px) re-sampled from the field at the current zoom, not one-per-cell, so density stays readable across zooms.

## 5. Render (deck.gl over MapLibre / Cesium)
- A `LineLayer` (or custom layer) for each of wind/current, fed the screen-grid samples; GPU-instanced so thousands of lines animate cheaply.
- Optional **particle/flow** mode for current and wind (animated advected particles) as a later toggle — keep v1 to the line convention.
- Color: wind lines white at fixed alpha; current lines `#4fa3ff`. A speed→palette ramp is available for an optional filled heat layer beneath (off by default to avoid clutter).
- Runs as a layer in both the 2D MapLibre view and the Cesium 3D globe; same sample data, different projection.
- Keep decode/sample on a worker or in the layer; never block the React render loop.

## 6. Timeline & animation
- A scrubber bound to `Field.times`: play/pause, step, and a departure-offset-style slider.
- Interpolate between forecast steps for smooth motion (linear in u/v components, not in speed/direction, to avoid direction-wrap artifacts — convert to u/v, interpolate, convert back).
- Current time + value readout (e.g., "T+18h · 14 kt").

## 7. Cursor interrogation
On hover/tap, sample both fields at the cursor and show wind dir/speed and current dir/speed (e.g., "Wind 223°M 20.4 kt · Current 84°M 1.1 kt"). Bilinear-interpolate from the four surrounding grid cells.

## 8. Fetch / cache / offline
- **Online:** fetch from Open-Meteo subdomains (dev) or decoded GRIB (prod). Correct endpoints: ensemble wind `https://ensemble-api.open-meteo.com/v1/ensemble` (model `ecmwf_ifs025`, fallback `gfs025`); currents `https://marine-api.open-meteo.com/v1/marine` (`ocean_current_velocity`, `ocean_current_direction`). These are **distinct subdomains** — not interchangeable.
- **Coastal failure mode:** Marine API returns 4xx/null near coastlines/inland — drop the failed sample and interpolate from neighbors; never blank the layer on a single bad point.
- **Cache:** persist the fetched field (the destination-intent pre-fetch warms this for the route corridor) so the layer animates offline from the last good field, with a clear "forecast age" indicator.
- **Live-at-boat overlay:** where Signal K provides measured apparent/true wind and (if available) current/set-drift, draw the *measured* value at own-ship distinctly (e.g., a brighter/own-ship-anchored marker) so forecast vs. observed are both visible and never silently merged.

## 9. Implementation phases
1. Shared `Field` model + Open-Meteo fetch + unit/convention normalization (reuse demo code). ✅
2. deck.gl line layers with the committed convention; screen-grid resampling. ✅
3. Timeline scrubber + u/v interpolation + cursor interrogation. ✅
4. Cache/offline + forecast-age indicator; Signal K live-at-boat overlay. ✅
5. (Later) optional particle/flow mode; optional filled heat ramp.

## 10. Acceptance criteria
- Wind lines point the direction wind moves toward; current lines point the direction current flows toward (convention verified against a known case — e.g., a SW wind draws NE). ✅ verified numerically (from 192° → drawn bearing 012°; toward 062° → drawn 062°)
- Both layers animate smoothly across the forecast timeline on a Pi-class GPU at the helm resolution. ✅ on dev hardware (instanced deck.gl LineLayer, ~250 segments/frame); Pi-class run pending hardware
- Cursor readout matches the field within interpolation tolerance. ✅
- With the network off, the layer still animates from cache and shows forecast age. ✅ verified with all weather endpoints blocked
- Single coastal null sample does not blank the field. ✅ verified on a half-on-land Florida grid (432 cells, 0 NaN after hole fill)
- Wind and current share the anchor point; no arrowheads; current scaled ~×7. ✅ (measured 2.20 vs 15.40 px/kt)

## 11. Open questions
- Particle/flow mode in v1 or deferred → **deferred**; lines shipped first.
- Ensemble spread on the wind layer: currently exposed in the **cursor readout** (p5–p95 kt) rather than visually as a fan; revisit if a fan is wanted.
- Grid resolution vs. performance budget on the lowest-end supported helm device → field grid is 7×6 per fetch (configurable); screen grid 48 px; needs a measurement pass on real helm hardware.

## Implementation notes (what was built, June 2026)
- `lib/field.js` — `window.WxField`: shared Field model. Ensemble wind (ECMWF→GFS fallback, reduced at ingest to median-u/v direction + median/p5/p95 speed) or deterministic mode; SMOC currents (km/h→kn, `cell_selection=sea`). Batch multi-point fetch with per-point fallback; ≥5 consecutive all-null failures bail fast to cache. Iterative 8-neighbour u/v hole fill. `sample()` = bilinear space + linear-u/v time. IndexedDB cache (`meridian-wx`), `ageHours()`.
- `lib/fieldlayer.js` — `window.FieldLayer`: screen-grid resampling (`unproject` injected, so MapLibre or Cesium), `lineData()` applying the committed convention (+180° wind only, ×7 current, length ∝ speed in px converted to ground distance at zoom), `makeDeckLayers()` = anchor dots + LineLayer + TextLayer labels, no arrowheads.
- `layers.html` — standalone view (nav: 🌬 Layers; `MERIDIAN_VIEW=layers`): MapLibre (Carto dark, key-free) + deck.gl `MapboxOverlay`; timeline play/step/scrub at 3 h/s with u/v interpolation; cursor NavData readout incl. ensemble p5–p95; LIVE/CACHED/OFFLINE stamp + forecast-age (ok<6 h, warn<24 h); ENS/DET source toggle; refetch-for-view; current layer land-masked via `lib/landmask.js` (fails soft); Signal K live-at-boat WebSocket overlay (cyan ring + MEAS line, never merged with forecast).
- The Cesium routing view (`routing.html`) still carries its legacy arrow layer; migrating it onto `WxField`/`FieldLayer` is the natural next step so layer + router truly read one source.
