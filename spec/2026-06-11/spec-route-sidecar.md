# spec-route-sidecar.md

**Component:** Isochrone route engine — Rust sidecar executor (+ the wire contract the cloud `route.compute` executor must mirror)
**Spec-ID:** route-sidecar
**Version:** v1
**Status:** active (shipped in `sidecar/`; live behind routing.html's fallback chain)
**Revised:** 2026-07-03 (UTC)
**Depends-on:** spec-service-usage (§5 A2A, `-32005` semantics), spec-service-layer (§3.5 route.compute)
**Referenced-by:** spec-route-research
**Supersedes:** the in-renderer-only engine (lib/router.js stays as the last-resort fallback, deprecated)

## 1. Objective

`lib/router.js` ran the 51-member isochrone fleet on the renderer main thread
— the whole app froze for the duration. The engine now lives in
`meridian-sidecar` (Rust, `sidecar/src/route/`), computed off-process and
rayon-parallel across members, **bit-identical** to the JS engine (golden
fixtures prove every path point, ETA, and stat equal at the f64-bit level).
This document freezes the wire contract so the cloud `route.compute`
executor (spec-service-layer §3.5, phase 3) can be built against it: the
request payload here IS the A2A `message/send` data part.

Fallback chain (client, routing.html `routeFleetSmart`):
**cloud (later, `ApiService.call('route.compute', request)`) → sidecar
(`POST :9124/route/compute`) → local JS engine.** `-32005`/offline/HTTP-fail
falls through silently; typed landlocked errors are user errors and do NOT
fall through.

## 2. Determinism doctrine (why results are reproducible ANYWHERE)

- All route-affecting transcendentals are pinned to **fdlibm 5.3** in both
  engines: `lib/fdmath.js` (JS) ↔ `sidecar/src/route/fdlibm.rs` (Rust) —
  sin/cos/atan2 (V8 versions disagree with each other by 1 ulp on these;
  asin/sqrt are correctly-rounded everywhere and stay native). THESE TWO
  FILES MUST CHANGE TOGETHER. `node scripts/gen-math-corpus.mjs` +
  `cargo test --test math_parity` prove agreement (1e6 samples/function).
- `lib/landmask.js` `pointOnLand` evaluates at the 0.01°-quantized point
  (pure function; the old memo made answers depend on query history).
- serde_json is built with `float_roundtrip` (its default float parse is up
  to 1 ulp off correctly-rounded — silently corrupts every forecast value).
- The engine replicates JS Map insertion-order iteration, `Math.round`
  half-toward-+∞, NaN-propagating min/max, the literal `((x%360)+360)%360`
  double-mod, and JS null/out-of-bounds array semantics. See
  `sidecar/src/route/mod.rs` for the full doctrine; do not "clean up"
  expressions in either engine.
- Golden gate: `cargo test --test golden_parity` replays fixtures captured
  from the live app (`window.m.dumpRouteFixture()`) — anchor snap, every
  member, every path point compared as exact f64 bits.

## 3. HTTP surface (sidecar :9124; the cloud mirrors semantics, not paths)

### POST /route/compute  (body ≤ 32MB)
Request (exactly `buildRouteRequest()` in routing.html):
```jsonc
{
  "raw_start": {"lat": 41.4945, "lon": -71.3173},   // UNSNAPPED port coords
  "raw_dest":  {"lat": 32.3833, "lon": -64.675},
  "vessel": {"twa": [...], "tws": [...], "bsp": [[...]]},  // polar grid
  "motoring": {"enabled": true, "motorKt": 6.5, "thresholdKt": 4},
  "use_currents": true,
  "dep_offset_hours": 0,
  "max_hours": 360, "arrival_tol_nm": 5, "time_step_h": 2,
  "constraints": {"min_depth_m": null},   // RESERVED: shallows avoidance (config, later)
  "members": [{"id": "control", "speedKey": "wind_speed_10m", "dirKey": "wind_direction_10m"}, ...],
  "wind_results": [{"sample": {"lat":..,"lon":..}, "time_len": 360,
                    "series": {"wind_speed_10m": [..null-able..], ...}}],   // 6 samples
  "marine_results": [{"sample": {..}, "time_len": 192,
                      "ocean_current_velocity": [...], "ocean_current_direction": [...]} | data-less entry]
}
```
→ `{"job_id": "rt_N"}` · 409 `{"error":"job_active","job_id"}` (one job at a
time; cancel then retry) · 400 on shape errors.

Future (cloud): `forecast: {"mode": "fetch", ...}` variant lets the server
fetch weather itself instead of inline series — the field is reserved; the
rest of the request is unchanged.

### GET /route/status/{id}
`{"state": "queued|loading_landmask|building_raster|routing|done|error|cancelled",
  "raster_rows_done": n, "raster_rows_total": n,
  "member_done": n, "member_total": n,
  "error": null | {"code": "landlocked_start|landlocked_dest|cancelled|internal", "message": "user-facing text"}}`

### GET /route/result/{id}
```jsonc
{
  "routes": [ /* EXACTLY router.js routeMemberIso shapes: member, path
      [{lat,lon,time,bsp,tws,twa,heading,curr_kt,motor}], etaHours, arrived,
      maxTws, avgTws, maxFavorableCurrent, maxAdverseCurrent, engineHours,
      pctMotor, finalDistance */ ],
  "anchors": {"dep": {..}, "arr": {..}},   // water-snapped, box-clear
  "landmask_mode": "full" | "boxes_only",  // boxes_only = NE geojson unavailable (fail-soft)
  "timings_ms": {"landmask": n, "raster": n, "fleet": n}
}
```
404 `unknown_job` after a restart → client falls through the chain.
Derived analytics (envelope, P5/P50/P95, outliers) stay client-side in v1;
they move server-side with the cloud executor (spec-service-layer §3.5).

### POST /route/cancel/{id}
Sets the cancel flag; checked per time step per member. Job settles at
`cancelled`, partials discarded.

MCP mirrors: `route_compute {request}` / `route_status {job_id, include_result?}`
on the sidecar's `/mcp` (agents get routing for free).

## 4. Engine-behavior contracts worth knowing

- Anchors snap to water on the DILATED corridor raster (60 nm reach) AND
  must clear the router's hand LAND boxes — raster-water inside a box has
  zero legal legs (live bug: Newport snapped into the Sakonnet box and the
  whole fleet died at the dock; fixed in both engines 2026-07-03).
- Landmask data: 3 Natural Earth geojsons, fetched once and disk-cached next
  to the sidecar exe (`landmask-cache/`; delete to refresh). JS still
  fetches per boot (its path is fallback-only now).
- Fleet compute is rayon-parallel over members; members are independent
  (post memo-purity) so parallel == sequential results.
- Performance (measured, golden runs): full Newport→Bermuda pipeline
  (landmask load + corridor raster + 51 members) ≈ **0.5 s** in Rust vs
  minutes in the renderer.

## 5. Acceptance (all shipped/verified)

1. `cargo test` green: math corpus (4×1e6 bit-exact), geo/polar pins,
   golden fixtures (51/51 members bit-identical, both corridors).
2. Routing view uses the sidecar when up (console logs engine + timings);
   kill the sidecar → next route falls back to the JS engine silently.
3. Landlocked ports surface the same friendly errors as before (typed codes).
4. App stays interactive during routing (the point of all this).
