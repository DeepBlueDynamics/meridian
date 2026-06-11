// Shared wind/current Field model — one source for the chart layers *and* the
// router (spec: docs/04-wind-current-layers.md). Classic script (no ES module,
// same reason as vessel.js); exposes window.WxField (or globalThis in node tests).
//
// Field {
//   kind: "wind" | "current"
//   grid: { lat0, lon0, dLat, dLon, nLat, nLon }     // regular grid, row-major lat-major
//   times: ISO8601[]                                  // forecast steps (uniform spacing)
//   speed: Float32Array(nT*nLat*nLon)                 // knots (converted at ingest)
//   direction: Float32Array(...)                      // degrees, NATIVE convention (below)
//   p5/p95: Float32Array (wind ensemble only)         // speed spread, knots
//   source: { model, run, fetched_at, offlineSafe }
// }
//
// DIRECTION CONVENTIONS — the classic wrong-looking-layer bug, so it lives here once:
//   wind    = direction it comes FROM  (0° = from N).  Render flips +180°.
//   current = direction it flows TOWARD (0° = toward N). Render does NOT flip.
// Both are stored native. All interpolation happens in FLOW u/v components
// (never in speed/direction — direction wrap produces garbage), converting back
// to the native convention at the very end.
(function () {
  const KT_PER_KMH = 0.539957;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const NaNf = NaN;

  // ── conventions ────────────────────────────────────────────────────────────
  // native dir → direction of FLOW (the way the air/water is moving)
  function flowDir(kind, dir) { return kind === "wind" ? (dir + 180) % 360 : dir; }
  function nativeDir(kind, flow) { return kind === "wind" ? (flow + 180) % 360 : ((flow % 360) + 360) % 360; }
  // flow u/v (u = east, v = north components of motion)
  function toUV(kind, speed, dir) {
    const f = flowDir(kind, dir) * D2R;
    return [speed * Math.sin(f), speed * Math.cos(f)];
  }
  function fromUV(kind, u, v) {
    const speed = Math.hypot(u, v);
    const flow = (Math.atan2(u, v) * R2D + 360) % 360;
    return { speed, dir: nativeDir(kind, flow) };
  }

  // ── grid ───────────────────────────────────────────────────────────────────
  function makeGrid(latMin, latMax, lonMin, lonMax, nLat, nLon) {
    return { lat0: latMin, lon0: lonMin,
             dLat: nLat > 1 ? (latMax - latMin) / (nLat - 1) : 0,
             dLon: nLon > 1 ? (lonMax - lonMin) / (nLon - 1) : 0,
             nLat, nLon };
  }
  function gridPoints(grid) {
    const lats = [], lons = [];
    for (let i = 0; i < grid.nLat; i++) for (let j = 0; j < grid.nLon; j++) {
      lats.push(+(grid.lat0 + i * grid.dLat).toFixed(3));
      lons.push(+(grid.lon0 + j * grid.dLon).toFixed(3));
    }
    return { lats, lons };
  }
  const cellIdx = (g, t, i, j) => (t * g.nLat + i) * g.nLon + j;

  // ── fetch helpers ──────────────────────────────────────────────────────────
  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 180)}`);
    const data = await r.json();
    if (data.error) throw new Error(data.reason || "API error");
    return data;
  }
  // Batched multi-location call; on batch failure fall back to per-point calls
  // so one inland/coastal reject can't sink the whole field (spec §8). Failed
  // points come back as null and are hole-filled later.
  async function fetchPerLocation(buildUrl, lats, lons, onProgress) {
    let results = null;
    try {
      const data = await fetchJson(buildUrl(lats.join(","), lons.join(",")));
      results = Array.isArray(data) ? data : [data];
      if (results.length !== lats.length) throw new Error("batch shape mismatch");
    } catch (e) {
      // Daily quota exhausted: every per-point retry is doomed too — bail
      // straight to the cached-field path instead of burning 80 more calls.
      if (/HTTP 429/.test(String(e.message))) throw e;
      results = [];
      let consecFail = 0;
      for (let k = 0; k < lats.length; k++) {
        if (onProgress) onProgress(k + 1, lats.length);
        try { results.push(await fetchJson(buildUrl(lats[k], lons[k]))); consecFail = 0; }
        catch (err) {
          results.push(null);                                // tolerate the point
          if (++consecFail >= 5 && results.every(r => !r))   // network down, not coastal —
            throw new Error("network unavailable: " + err.message);  // bail to cache fast
        }
      }
    }
    return results;
  }

  // ── wind: ensemble (default per spec) + deterministic (light) ──────────────
  const ENSEMBLE_MODELS = [
    { slug: "ecmwf_ifs025", name: "ECMWF IFS 0.25° ens", days: 15 },
    { slug: "gfs025",       name: "GFS 0.25° ens",       days: 10 },
  ];

  function quantileSorted(a, q) {
    if (!a.length) return NaNf;
    const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }

  // Reduce raw member arrays at one (cell,time) → median u/v centre + p5/p95 speed.
  function reduceMembers(speeds, dirs) {
    const us = [], vs = [], sp = [];
    for (let m = 0; m < speeds.length; m++) {
      const s = speeds[m], d = dirs[m];
      if (s == null || d == null) continue;
      const [u, v] = toUV("wind", s, d);
      us.push(u); vs.push(v); sp.push(s);
    }
    if (!sp.length) return null;
    us.sort((a, b) => a - b); vs.sort((a, b) => a - b); sp.sort((a, b) => a - b);
    const u = quantileSorted(us, 0.5), v = quantileSorted(vs, 0.5);
    const { dir } = fromUV("wind", u, v);
    return { speed: quantileSorted(sp, 0.5), dir,
             p5: quantileSorted(sp, 0.05), p95: quantileSorted(sp, 0.95) };
  }

  async function fetchWind(grid, opts = {}) {
    const { mode = "ensemble", forecastDays, onProgress } = opts;
    const { lats, lons } = gridPoints(grid);

    if (mode === "deterministic") {
      const days = forecastDays || 10;
      const build = (la, lo) =>
        `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}` +
        `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&forecast_days=${days}`;
      const res = await fetchPerLocation(build, lats, lons, onProgress);
      return assembleField("wind", grid, res, {
        model: "best_match (deterministic)",
        per: (h, t) => {
          const s = h.wind_speed_10m[t], d = h.wind_direction_10m[t];
          return s == null || d == null ? null : { speed: s, dir: d };
        },
      });
    }

    // ensemble — try ECMWF, fall back to GFS, fall back to deterministic
    let lastErr = null;
    for (const m of ENSEMBLE_MODELS) {
      const days = Math.min(forecastDays || 7, m.days);   // 7d default keeps the grid payload sane
      const build = (la, lo) =>
        `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${la}&longitude=${lo}` +
        `&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&models=${m.slug}&forecast_days=${days}`;
      try {
        const res = await fetchPerLocation(build, lats, lons, onProgress);
        if (!res.some(Boolean)) throw new Error("no ensemble points returned");
        return assembleField("wind", grid, res, {
          model: m.name, ensemble: true,
          per: (h, t) => {
            // member keys: wind_speed_10m (control) + wind_speed_10m_member01..N
            const sp = [], dr = [];
            for (const k of Object.keys(h)) {
              if (k.startsWith("wind_speed_10m")) {
                const dk = "wind_direction_10m" + k.slice("wind_speed_10m".length);
                sp.push(h[k][t]); dr.push(h[dk] ? h[dk][t] : null);
              }
            }
            return reduceMembers(sp, dr);
          },
        });
      } catch (e) { lastErr = e; }
    }
    // last resort: deterministic
    try { return await fetchWind(grid, { ...opts, mode: "deterministic" }); }
    catch (e) { throw lastErr || e; }
  }

  // ── current: marine API (distinct subdomain — not interchangeable, spec §8) ─
  async function fetchCurrent(grid, opts = {}) {
    const { forecastDays = 8, onProgress } = opts;
    const build = (la, lo) =>
      `https://marine-api.open-meteo.com/v1/marine?latitude=${la}&longitude=${lo}` +
      `&hourly=ocean_current_velocity,ocean_current_direction&forecast_days=${forecastDays}&cell_selection=sea`;
    const { lats, lons } = gridPoints(grid);
    const res = await fetchPerLocation(build, lats, lons, onProgress);
    return assembleField("current", grid, res, {
      model: "MeteoFrance SMOC",
      per: (h, t) => {
        const v = h.ocean_current_velocity[t], d = h.ocean_current_direction[t];
        return v == null || d == null ? null : { speed: v * KT_PER_KMH, dir: d };  // km/h → kn
      },
    });
  }

  // ── assemble + hole fill ───────────────────────────────────────────────────
  function assembleField(kind, grid, locResults, { model, per, ensemble }) {
    const first = locResults.find(r => r && r.hourly && r.hourly.time);
    if (!first) throw new Error(`${kind}: every grid point failed`);
    const times = first.hourly.time.map(t => t + (t.endsWith("Z") ? "" : "Z"));
    const nT = times.length, N = nT * grid.nLat * grid.nLon;
    const speed = new Float32Array(N).fill(NaNf);
    const direction = new Float32Array(N).fill(NaNf);
    const p5  = ensemble ? new Float32Array(N).fill(NaNf) : null;
    const p95 = ensemble ? new Float32Array(N).fill(NaNf) : null;

    for (let i = 0; i < grid.nLat; i++) for (let j = 0; j < grid.nLon; j++) {
      const r = locResults[i * grid.nLon + j];
      if (!r || !r.hourly) continue;                       // coastal/inland reject → hole
      for (let t = 0; t < nT; t++) {
        const cell = per(r.hourly, t);
        if (!cell) continue;                               // null sample → hole
        const idx = cellIdx(grid, t, i, j);
        speed[idx] = cell.speed; direction[idx] = cell.dir;
        if (p5)  p5[idx]  = cell.p5  != null ? cell.p5  : cell.speed;
        if (p95) p95[idx] = cell.p95 != null ? cell.p95 : cell.speed;
      }
    }
    const field = { kind, grid, times, speed, direction, p5, p95,
      source: { model, run: times[0], fetched_at: new Date().toISOString() } };
    fillHoles(field);
    return field;
  }

  // Coastal failure mode: drop the bad sample, interpolate from neighbors —
  // never blank the layer on a single bad point (spec §8 / acceptance §10).
  // Iterative 8-neighbour averaging in flow u/v, up to `passes` rings inland.
  function fillHoles(field, passes = 3) {
    const g = field.grid, nT = field.times.length;
    for (let t = 0; t < nT; t++) {
      for (let p = 0; p < passes; p++) {
        const fixes = [];
        for (let i = 0; i < g.nLat; i++) for (let j = 0; j < g.nLon; j++) {
          const idx = cellIdx(g, t, i, j);
          if (!Number.isNaN(field.speed[idx])) continue;
          let su = 0, sv = 0, n = 0;
          for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
            if (!di && !dj) continue;
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= g.nLat || jj >= g.nLon) continue;
            const nb = cellIdx(g, t, ii, jj);
            if (Number.isNaN(field.speed[nb])) continue;
            const [u, v] = toUV(field.kind, field.speed[nb], field.direction[nb]);
            su += u; sv += v; n++;
          }
          if (n >= 2) fixes.push([idx, su / n, sv / n]);   // need 2 good neighbours
        }
        if (!fixes.length) break;
        for (const [idx, u, v] of fixes) {
          const { speed, dir } = fromUV(field.kind, u, v);
          field.speed[idx] = speed; field.direction[idx] = dir;
          if (field.p5)  field.p5[idx]  = speed;
          if (field.p95) field.p95[idx] = speed;
        }
      }
    }
  }

  // ── sampling: bilinear in space, linear-in-u/v in time (spec §6/§7) ────────
  function timeStepHours(field) {
    if (field.times.length < 2) return 1;
    return (new Date(field.times[1]) - new Date(field.times[0])) / 3600000;
  }
  // tHours = hours after field.times[0]
  function sample(field, lat, lon, tHours) {
    const g = field.grid;
    const fi = (lat - g.lat0) / g.dLat, fj = (lon - g.lon0) / g.dLon;
    if (fi < 0 || fj < 0 || fi > g.nLat - 1 || fj > g.nLon - 1) return null;
    const step = timeStepHours(field);
    let ft = tHours / step;
    ft = Math.max(0, Math.min(field.times.length - 1, ft));
    const t0 = Math.floor(ft), t1 = Math.min(field.times.length - 1, t0 + 1), wt = ft - t0;

    const uvAt = (t) => {
      const i0 = Math.floor(fi), j0 = Math.floor(fj);
      const i1 = Math.min(g.nLat - 1, i0 + 1), j1 = Math.min(g.nLon - 1, j0 + 1);
      const wi = fi - i0, wj = fj - j0;
      let su = 0, sv = 0, sw = 0, sp5 = 0, sp95 = 0;
      const corners = [[i0, j0, (1 - wi) * (1 - wj)], [i0, j1, (1 - wi) * wj],
                       [i1, j0, wi * (1 - wj)],       [i1, j1, wi * wj]];
      for (const [i, j, w] of corners) {
        if (w === 0) continue;
        const idx = cellIdx(g, t, i, j);
        if (Number.isNaN(field.speed[idx])) continue;     // unfilled hole: renormalise
        const [u, v] = toUV(field.kind, field.speed[idx], field.direction[idx]);
        su += u * w; sv += v * w; sw += w;
        if (field.p5)  sp5  += field.p5[idx]  * w;
        if (field.p95) sp95 += field.p95[idx] * w;
      }
      if (sw <= 0) return null;
      return { u: su / sw, v: sv / sw, p5: sp5 / sw, p95: sp95 / sw };
    };
    const a = uvAt(t0), b = wt > 0 ? uvAt(t1) : a;
    if (!a && !b) return null;
    const A = a || b, B = b || a;
    const u = A.u + (B.u - A.u) * wt, v = A.v + (B.v - A.v) * wt;
    const out = fromUV(field.kind, u, v);
    if (field.p5)  { out.p5 = A.p5 + (B.p5 - A.p5) * wt; out.p95 = A.p95 + (B.p95 - A.p95) * wt; }
    return out;     // { speed kn, dir native°, [p5,p95] }
  }

  // ── cache (IndexedDB — Float32Arrays structured-clone natively) ────────────
  const DB = "meridian-wx", STORE = "fields";
  function idb() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === "undefined") return rej(new Error("no idb"));
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
  }
  async function saveCache(field) {
    try {
      const db = await idb();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(field, field.kind);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      db.close();
    } catch (e) { /* cache is best-effort */ }
  }
  async function loadCache(kind) {
    try {
      const db = await idb();
      const field = await new Promise((res, rej) => {
        const rq = db.transaction(STORE).objectStore(STORE).get(kind);
        rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error);
      });
      db.close(); return field;
    } catch (e) { return null; }
  }
  const ageHours = (field) => (Date.now() - new Date(field.source.fetched_at)) / 3600000;

  globalThis.WxField = {
    makeGrid, gridPoints, fetchWind, fetchCurrent, sample, timeStepHours,
    saveCache, loadCache, ageHours,
    flowDir, nativeDir, toUV, fromUV,            // exposed for layer + tests
  };
})();
