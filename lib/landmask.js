// Coastline land mask — Natural Earth 1:50m land polygons, fetched once and
// spatially indexed so the router can ask "does this leg cross land?" anywhere
// on the planet (the hand boxes in lib/router.js only cover NE-US + Bermuda).
// Classic script; exposes window.LandMask. Fails soft: until/unless load()
// succeeds, every query answers "clear" and the router falls back to its boxes.
(function () {
  // Three layers, one index:
  // - 50m land: whole world, small continent rings → fast ray casts everywhere.
  // - 10m land, SMALL POLYGONS ONLY (bbox span < 2.5°): restores the islands 50m
  //   drops (Bimini, Anegada, Culebra, Grand Turk…) without importing the huge
  //   10m continent rings that would make near-coast queries 50× slower.
  // - 10m minor islands: the really tiny rocks excluded from 10m land itself.
  const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
  const SRCS = [
    { url: NE + "ne_50m_land.geojson" },
    { url: NE + "ne_10m_land.geojson", maxSpanDeg: 2.5 },
    { url: NE + "ne_10m_minor_islands.geojson" },
  ];
  const CELL = 0.5;          // degrees — spatial bucket size (~30 nm)
  let polys = null;          // [{bbox:[w,s,e,n], ring:Float64Array [lon,lat,...]}]
  let cells = null;          // Map "cx,cy" → [poly index]
  let ready = false, failed = false, loadPromise = null;

  // Memo for point queries quantized to ~0.01° (~0.6 nm) — the router asks
  // about tightly clustered points, so this absorbs most of the ray-cast cost.
  const memo = new Map();
  const MEMO_CAP = 400000;

  const cellOf = (lon, lat) => Math.floor(lon / CELL) + "," + Math.floor(lat / CELL);

  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const layers = await Promise.all(SRCS.map(async (src) => {
        const r = await fetch(src.url);
        if (!r.ok) throw new Error("landmask HTTP " + r.status + " for " + src.url.split("/").pop());
        return { gj: await r.json(), maxSpanDeg: src.maxSpanDeg };
      }));
      polys = []; cells = new Map();
      let ringPts = 0;
      for (const { gj, maxSpanDeg } of layers) {
        for (const f of gj.features || []) {
          const g = f.geometry || {};
          const multi = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
          for (const poly of multi) {
            const outer = poly && poly[0];        // outer ring only; lake holes don't matter for routing
            if (!outer || outer.length < 4) continue;
            let w = 180, s = 90, e = -180, n = -90;
            for (let i = 0; i < outer.length; i++) {
              const lon = outer[i][0], lat = outer[i][1];
              if (lon < w) w = lon; if (lon > e) e = lon;
              if (lat < s) s = lat; if (lat > n) n = lat;
            }
            if (maxSpanDeg && (e - w > maxSpanDeg || n - s > maxSpanDeg)) continue;
            const ring = new Float64Array(outer.length * 2);
            for (let i = 0; i < outer.length; i++) { ring[2 * i] = outer[i][0]; ring[2 * i + 1] = outer[i][1]; }
            const idx = polys.length;
            polys.push({ bbox: [w, s, e, n], ring });
            ringPts += outer.length;
            for (let cx = Math.floor(w / CELL); cx <= Math.floor(e / CELL); cx++)
              for (let cy = Math.floor(s / CELL); cy <= Math.floor(n / CELL); cy++) {
                const k = cx + "," + cy;
                let a = cells.get(k); if (!a) { a = []; cells.set(k, a); }
                a.push(idx);
              }
          }
        }
      }
      ready = true;
      console.log(`[landmask] ready: ${polys.length} polygons, ${ringPts} ring points, ${cells.size} cells`);
      return true;
    })().catch((e) => {
      failed = true;
      console.warn("[landmask] load failed — router falls back to hand boxes:", e.message);
      if (window.Telemetry) window.Telemetry.send("landmask-load-failed", { message: e.message });
      return false;
    });
    return loadPromise;
  }

  function inRing(r, x, y) {
    let inside = false;
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function pointOnLandRaw(lat, lon) {
    const list = cells.get(cellOf(lon, lat));
    if (!list) return false;
    for (const i of list) {
      const b = polys[i].bbox;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      if (inRing(polys[i].ring, lon, lat)) return true;
    }
    return false;
  }

  function pointOnLand(lat, lon) {
    if (!ready) return false;
    const k = ((lat * 100) | 0) * 100000 + ((lon * 100) | 0);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const v = pointOnLandRaw(lat, lon);
    if (memo.size > MEMO_CAP) memo.clear();
    memo.set(k, v);
    return v;
  }

  // True when the leg p1→p2 stays off land. Fast path: if no grid cell along
  // the leg contains any land polygon (open ocean), answer immediately;
  // otherwise sample the leg every ~1 nm.
  function segmentClear(p1, p2) {
    if (!ready) return true;
    const dLatNm = (p2.lat - p1.lat) * 60;
    const dLonNm = (p2.lon - p1.lon) * 60 * Math.cos((p1.lat + p2.lat) * 0.5 * Math.PI / 180);
    const d = Math.sqrt(dLatNm * dLatNm + dLonNm * dLonNm);
    // occupancy scan at ≤6 nm spacing — cells are ~30 nm, can't slip through
    const nc = Math.max(1, Math.ceil(d / 6));
    let occupied = false;
    for (let i = 0; i <= nc; i++) {
      const f = i / nc;
      if (cells.has(cellOf(p1.lon + (p2.lon - p1.lon) * f, p1.lat + (p2.lat - p1.lat) * f))) { occupied = true; break; }
    }
    if (!occupied) return true;
    const n = Math.max(1, Math.ceil(d / 1));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      if (pointOnLand(p1.lat + (p2.lat - p1.lat) * f, p1.lon + (p2.lon - p1.lon) * f)) return false;
    }
    return true;
  }

  // Pre-rasterized corridor mask — polygon ray-casts are too slow for the
  // router's hot loop (~3 s/member through the Bahamas). Rasterize the route's
  // bounding box once into a Uint8Array (~0.02° ≈ 1.2 nm cells); leg tests
  // become array lookups and the whole fleet routes in a couple of seconds.
  async function buildRaster(w, s, e, n, res = 0.02, onProgress) {
    if (!ready) return null;
    const cols = Math.max(1, Math.ceil((e - w) / res));
    const rows = Math.max(1, Math.ceil((n - s) / res));
    const bits = new Uint8Array(cols * rows);
    // Pass 1 — stamp every coastline VERTEX cell. Center-sampling alone slips
    // past sub-cell islets (Bimini is ~0.5 nm wide) and grazes headlands;
    // vertices are dense exactly where land is skinny.
    for (const p of polys) {
      const b = p.bbox;
      if (b[2] < w || b[0] > e || b[3] < s || b[1] > n) continue;
      const ring = p.ring;
      for (let i = 0; i < ring.length; i += 2) {
        const lon = ring[i], lat = ring[i + 1];
        if (lat < s || lat >= n || lon < w || lon >= e) continue;
        bits[(((lat - s) / res) | 0) * cols + (((lon - w) / res) | 0)] = 1;
      }
    }
    // Pass 2 — center-sample interiors (a leg crossing a wide island must hit
    // its inside cells too). Open-ocean buckets are skipped wholesale.
    for (let r = 0; r < rows; r++) {
      const lat = s + (r + 0.5) * res;
      for (let c = 0; c < cols; c++) {
        const lon = w + (c + 0.5) * res;
        if (!cells.has(cellOf(lon, lat))) {
          const nextC = Math.min(cols - 1, Math.floor(((Math.floor(lon / CELL) + 1) * CELL - w) / res));
          c = Math.max(c, nextC);
          continue;
        }
        if (!bits[r * cols + c] && pointOnLandRaw(lat, lon)) bits[r * cols + c] = 1;
      }
      if (onProgress && r % 64 === 0) { onProgress(r / rows); await new Promise((res2) => setTimeout(res2, 0)); }
    }
    // Pass 3 — dilate by one cell: a ~1.2 nm safety buffer that also absorbs
    // center-sampling quantization. Real passages are far wider than 2 cells.
    const dil = new Uint8Array(bits);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!bits[r * cols + c]) continue;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) dil[rr * cols + cc] = 1;
      }
    }
    const inBounds = (lat, lon) => lat >= s && lat < n && lon >= w && lon < e;
    const hit = (lat, lon) => dil[(((lat - s) / res) | 0) * cols + (((lon - w) / res) | 0)] === 1;
    const rasterPoint = (lat, lon) => inBounds(lat, lon) ? hit(lat, lon) : pointOnLand(lat, lon);
    return {
      w, s, e, n, res, cols, rows,
      pointOnLand: rasterPoint,
      // Anchor snapping must use THIS (dilated) mask — an anchor inside the
      // dilation belt can never be legally approached.
      nearestWater(lat, lon, maxNm = 15) {
        if (!rasterPoint(lat, lon)) return { lat, lon };
        for (let r = 1; r <= maxNm; r++) {
          for (let b = 0; b < 360; b += 20) {
            const p = {
              lat: lat + (r / 60) * Math.cos(b * Math.PI / 180),
              lon: lon + (r / (60 * Math.cos(lat * Math.PI / 180))) * Math.sin(b * Math.PI / 180),
            };
            if (!rasterPoint(p.lat, p.lon)) return p;
          }
        }
        return null;
      },
      segmentClear(p1, p2) {
        const dLatNm = (p2.lat - p1.lat) * 60;
        const dLonNm = (p2.lon - p1.lon) * 60 * Math.cos((p1.lat + p2.lat) * 0.5 * Math.PI / 180);
        const d = Math.sqrt(dLatNm * dLatNm + dLonNm * dLonNm);
        const np = Math.max(1, Math.ceil(d / 1));
        for (let i = 0; i <= np; i++) {
          const f = i / np, lat = p1.lat + (p2.lat - p1.lat) * f, lon = p1.lon + (p2.lon - p1.lon) * f;
          if (inBounds(lat, lon) ? hit(lat, lon) : pointOnLand(lat, lon)) return false;
        }
        return true;
      },
    };
  }

  // Nearest water point to a (possibly on-land) port coordinate — spiral of
  // 1 nm rings out to maxNm. Returns {lat,lon} or null.
  function nearestWater(lat, lon, maxNm = 12) {
    if (!ready || !pointOnLand(lat, lon)) return { lat, lon };
    for (let r = 1; r <= maxNm; r++) {
      for (let b = 0; b < 360; b += 30) {
        const p = {
          lat: lat + (r / 60) * Math.cos(b * Math.PI / 180),
          lon: lon + (r / (60 * Math.cos(lat * Math.PI / 180))) * Math.sin(b * Math.PI / 180),
        };
        if (!pointOnLand(p.lat, p.lon)) return p;
      }
    }
    return null;
  }

  window.LandMask = {
    load, pointOnLand, segmentClear, nearestWater, buildRaster,
    isReady: () => ready, hasFailed: () => failed,
  };
})();
