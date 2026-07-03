#!/usr/bin/env node
// Headless golden-fixture generator — runs the REAL JS route engine
// (lib/fdmath.js + lib/router.js + lib/landmask.js) under node, fetches live
// forecasts, and dumps {request, anchors, landmask_mode, js_routes} for the
// sidecar's golden_parity test. Because all route-affecting math is pinned
// to FdMath (fdlibm), node results are bit-identical to the app's — no need
// to drive (and lock) the Electron app to capture fixtures.
//
//   node scripts/gen-route-fixture.mjs <name> <depLat> <depLon> <arrLat> <arrLon>
//   node scripts/gen-route-fixture.mjs bahamas 25.0781 -77.3386 25.7251 -79.2988

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
global.window = {};
eval(fs.readFileSync(path.join(root, "lib/fdmath.js"), "utf8"));
const FdMath = global.window.FdMath;
eval(fs.readFileSync(path.join(root, "lib/vessel.js"), "utf8"));
eval(fs.readFileSync(path.join(root, "lib/router.js"), "utf8"));
eval(fs.readFileSync(path.join(root, "lib/landmask.js"), "utf8"));
const { Router, LandMask, Vessel } = global.window;

const [name, depLat, depLon, arrLat, arrLon] = process.argv.slice(2);
if (!name || !arrLon) {
  console.error("usage: gen-route-fixture.mjs <name> <depLat> <depLon> <arrLat> <arrLon>");
  process.exit(1);
}
const START = { lat: +depLat, lon: +depLon };
const DEST = { lat: +arrLat, lon: +arrLon };
const VESSEL = Vessel.DEFAULT;
const MOTORING = { enabled: true, motorKt: 6.5, thresholdKt: 4 };
const MAX_HOURS = 360, ARRIVAL_TOL_NM = 5;

// ── mirrors of routing.html (computeSamples, fetches, guard, request) ──
function computeSamples() {
  const n = 6, out = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    out.push({ lat: +(START.lat + (DEST.lat - START.lat) * f).toFixed(2), lon: +(START.lon + (DEST.lon - START.lon) * f).toFixed(2) });
  }
  return out;
}
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const d = await r.json();
  if (d.error) throw new Error(d.reason || "API error");
  return d;
}
const SAMPLES = computeSamples();
console.error(`[fixture] ${name}: fetching ensemble for ${SAMPLES.length} samples…`);
const windResults = [];
for (const sample of SAMPLES) {
  const d = await fetchJson(`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${sample.lat}&longitude=${sample.lon}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&models=ecmwf_ifs025&forecast_days=15`);
  windResults.push({ sample, data: d });
}
console.error("[fixture] fetching currents…");
const marineResults = [];
for (const sample of SAMPLES) {
  try {
    const d = await fetchJson(`https://marine-api.open-meteo.com/v1/marine?latitude=${sample.lat}&longitude=${sample.lon}&hourly=ocean_current_velocity,ocean_current_direction&forecast_days=8&cell_selection=sea`);
    marineResults.push({ sample, data: d });
  } catch (e) {
    marineResults.push({ sample, data: null, error: e.message });
  }
}

console.error("[fixture] loading landmask…");
if (!(await LandMask.load())) throw new Error("landmask load failed");
const s = Math.max(-85, Math.min(START.lat, DEST.lat) - 3.5), n2 = Math.min(85, Math.max(START.lat, DEST.lat) + 3.5);
const w = Math.min(START.lon, DEST.lon) - 4, e = Math.max(START.lon, DEST.lon) + 4;
const raster = await LandMask.buildRaster(w, s, e, n2, 0.02, (f) => process.stderr.write(`\r[fixture] raster ${Math.round(f * 100)}%`));
console.error("");
const boxClear = (la, lo) => !Router.onLand(la, lo);
const depAnchor = raster.nearestWater(START.lat, START.lon, 60, boxClear);
const arrAnchor = raster.nearestWater(DEST.lat, DEST.lon, 60, boxClear);
if (!depAnchor || !arrAnchor) throw new Error("landlocked endpoint");

// makeLandGuard (routing.html L434-453, verbatim)
const gcDistance = Router.gcDistance;
function makeLandGuard(a1, a2, raster2) {
  const segClear = raster2.segmentClear;
  return (p1, p2) => {
    if (segClear(p1, p2)) return true;
    for (const a of [a1, a2]) {
      const d1 = gcDistance(p1, a), d2 = gcDistance(p2, a);
      if (d1 < 2 || d2 < 2) {
        const d = gcDistance(p1, p2); if (d <= 2.6) return true;
        let q1 = p1, q2 = p2;
        if (d2 < 2) { const f = Math.max(0, 1 - 2.5 / d); q2 = { lat: p1.lat + (p2.lat - p1.lat) * f, lon: p1.lon + (p2.lon - p1.lon) * f }; }
        if (d1 < 2) { const f = Math.min(1, 2.5 / d); q1 = { lat: p1.lat + (p2.lat - p1.lat) * f, lon: p1.lon + (p2.lon - p1.lon) * f }; }
        return segClear(q1, q2);
      }
    }
    return false;
  };
}
const landGuard = makeLandGuard(depAnchor, arrAnchor, raster);
const members = Router.parseMembers(windResults);
const env = { windResults, currentResults: marineResults, useCurrents: marineResults.some(c => c.data), depOffsetHours: 0,
  vessel: VESSEL, start: depAnchor, dest: arrAnchor, maxHours: MAX_HOURS, arrivalTolNm: ARRIVAL_TOL_NM,
  motoring: MOTORING, landGuard };

console.error(`[fixture] routing ${members.length} members (JS engine)…`);
const t0 = Date.now();
const routes = await Router.routeFleet(members, env, (i, nn) => { if (i % 10 === 0) process.stderr.write(`\r[fixture] member ${i}/${nn}`); });
console.error(`\n[fixture] JS fleet: ${((Date.now() - t0) / 1000).toFixed(1)}s · arrived ${routes.filter(r => r.arrived).length}/${routes.length}`);

// request (mirrors buildRouteRequest)
const windSeries = (h) => { const out = {}; for (const k of Object.keys(h)) if (k.startsWith("wind_speed_10m") || k.startsWith("wind_direction_10m")) out[k] = h[k]; return out; };
const request = {
  raw_start: { lat: START.lat, lon: START.lon }, raw_dest: { lat: DEST.lat, lon: DEST.lon },
  vessel: { twa: VESSEL.twa, tws: VESSEL.tws, bsp: VESSEL.bsp },
  motoring: MOTORING, use_currents: env.useCurrents, dep_offset_hours: 0,
  max_hours: MAX_HOURS, arrival_tol_nm: ARRIVAL_TOL_NM, time_step_h: 2,
  constraints: { min_depth_m: null },
  members,
  wind_results: windResults.map(x => ({ sample: x.sample, time_len: x.data.hourly.time.length, series: windSeries(x.data.hourly) })),
  marine_results: marineResults.map(c => c.data
    ? { sample: c.sample, time_len: c.data.hourly.time.length, ocean_current_velocity: c.data.hourly.ocean_current_velocity, ocean_current_direction: c.data.hourly.ocean_current_direction }
    : { sample: c.sample, time_len: 0, ocean_current_velocity: null, ocean_current_direction: null }),
};
const fixture = { request, anchors: { dep: depAnchor, arr: arrAnchor }, landmask_mode: "full", js_routes: routes };
const out = path.join(root, "sidecar/tests/fixtures", name + ".json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(fixture));
console.error(`[fixture] wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)}MB)`);
