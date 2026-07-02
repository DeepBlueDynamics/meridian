# spec-wind-current-layers.md

_Revised: 2026-06-11 (UTC)_

**Component:** Wind & current visualization layers
**Status:** superseded — by `spec-wind-current-layers-v2.md` (implemented). Original status: Data already proven in the live routing demo (ECMWF/GFS ensemble wind + MeteoFrance SMOC currents via Open-Meteo). This spec formalizes them as reusable, standalone chart layers — the first two of the Savvy-Navvy layer set, and the visual foundation everything else stacks on.
**License posture:** Apache-2.0. Data sources are open/permissive: ECMWF Open Data (CC-BY-4.0), GFS/NOMADS (public), MeteoFrance SMOC via Copernicus Marine (open w/ attribution), Open-Meteo aggregator JSON for dev convenience. Render stack deck.gl (MIT) over MapLibre (BSD-3).

---

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

Per the project's locked convention:
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

- A scrubber bound to `Field.times` (the demo already does this): play/pause, step, and a departure-offset-style slider.
- Interpolate between forecast steps for smooth motion (linear in u/v components, not in speed/direction, to avoid direction-wrap artifacts — convert to u/v, interpolate, convert back).
- Current time + value readout (e.g., "T+18h · 14 kt").

## 7. Cursor interrogation

On hover/tap, sample both fields at the cursor and show wind dir/speed and current dir/speed (matching the demo's NavData panel: e.g., "Wind 223°M 20.4 kt · Current 84°M 1.1 kt"). Bilinear-interpolate from the four surrounding grid cells.

## 8. Fetch / cache / offline

- **Online:** fetch from Open-Meteo subdomains (dev) or decoded GRIB (prod). Correct endpoints: ensemble wind `https://ensemble-api.open-meteo.com/v1/ensemble` (model `ecmwf_ifs025`, fallback `gfs025`); currents `https://marine-api.open-meteo.com/v1/marine` (`ocean_current_velocity`, `ocean_current_direction`). These are **distinct subdomains** — not interchangeable.
- **Coastal failure mode:** Marine API returns 4xx/null near coastlines/inland — drop the failed sample and interpolate from neighbors; never blank the layer on a single bad point.
- **Cache:** persist the fetched field (the destination-intent pre-fetch warms this for the route corridor) so the layer animates offline from the last good field, with a clear "forecast age" indicator.
- **Live-at-boat overlay:** where Signal K provides measured apparent/true wind and (if available) current/set-drift, draw the *measured* value at own-ship distinctly (e.g., a brighter/own-ship-anchored marker) so forecast vs. observed are both visible and never silently merged.

## 9. Implementation phases

1. Shared `Field` model + Open-Meteo fetch + unit/convention normalization (reuse demo code).
2. deck.gl line layers with the committed convention; screen-grid resampling.
3. Timeline scrubber + u/v interpolation + cursor interrogation.
4. Cache/offline + forecast-age indicator; Signal K live-at-boat overlay.
5. (Later) optional particle/flow mode; optional filled heat ramp.

## 10. Acceptance criteria

- Wind lines point the direction wind moves toward; current lines point the direction current flows toward (convention verified against a known case — e.g., a SW wind draws NE).
- Both layers animate smoothly across the forecast timeline on a Pi-class GPU at the helm resolution.
- Cursor readout matches the field within interpolation tolerance.
- With the network off, the layer still animates from cache and shows forecast age.
- Single coastal null sample does not blank the field.
- Wind and current share the anchor point; no arrowheads; current scaled ~×7.

## 11. Open questions

- Particle/flow mode in v1 or deferred (recommend deferred; lines first).
- Whether to expose ensemble spread on the wind layer visually (e.g., faint min/max fan) or keep spread to the routing view only.
- Grid resolution vs. performance budget on the lowest-end supported helm device.
