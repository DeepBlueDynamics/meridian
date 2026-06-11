// Isochrone weather router — the optimal-route engine behind the Routing view.
// Classic script (no ES module, same reason as lib/vessel.js). Exposes window.Router.
//
// Algorithm: expand a front of reachable positions every TIME_STEP hours across a
// fan of headings around the bearing-to-destination; prune the front to the
// furthest point per bearing-from-start sector (classic isochrone pruning). Each
// ensemble member gets its own optimal route, so the fleet genuinely diverges
// (e.g. members detour for Gulf Stream push or to dodge a blow) instead of all
// chasing instantaneous VMG like the old greedy router.
(function () {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, EARTH_R_NM = 3440.065;

  // ── spherical helpers ──────────────────────────────────────────────────
  function gcDistance(p1, p2) {
    const lat1 = p1.lat * D2R, lat2 = p2.lat * D2R;
    const dlat = (p2.lat - p1.lat) * D2R, dlon = (p2.lon - p1.lon) * D2R;
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
    return 2 * EARTH_R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  // Equirectangular approximation — plenty for IDW weights / pruning metrics and
  // ~10× cheaper than the haversine in the hot loop.
  function fastDistNm(p1, p2) {
    const dy = p2.lat - p1.lat;
    const dx = (p2.lon - p1.lon) * Math.cos((p1.lat + p2.lat) * 0.5 * D2R);
    return 60 * Math.sqrt(dx * dx + dy * dy);
  }
  function bearing(p1, p2) {
    const lat1 = p1.lat * D2R, lat2 = p2.lat * D2R, dlon = (p2.lon - p1.lon) * D2R;
    const y = Math.sin(dlon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlon);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }
  function sphereWalk(pos, hdgDeg, distNm) {
    const lat1 = pos.lat * D2R, lon1 = pos.lon * D2R, hdg = hdgDeg * D2R, d = distNm / EARTH_R_NM;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(hdg));
    const lon2 = lon1 + Math.atan2(Math.sin(hdg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 * R2D, lon: lon2 * R2D };
  }
  function circDiff(a, b) { let d = ((a - b) % 360 + 360) % 360; return d > 180 ? 360 - d : d; }
  function signedDiff(a, b) { let d = ((a - b) % 360 + 360) % 360; return d > 180 ? d - 360 : d; }

  // ── polar ──────────────────────────────────────────────────────────────
  // Bilinear interpolation over the vessel's TWA×TWS BSP grid.
  function makePolar(P) {
    const A = P.twa, T = P.tws, G = P.bsp;
    const aMin = A[0], aMax = A[A.length - 1], tMin = T[0], tMax = T[T.length - 1];
    return function (twaIn, twsIn) {
      let twa = Math.abs(twaIn); if (twa > 180) twa = 360 - twa;
      if (twa < aMin) return 0;
      if (twa > aMax) twa = aMax;
      let tws = twsIn < tMin ? tMin : twsIn > tMax ? tMax : twsIn;
      let i0 = 0; for (let i = 0; i < A.length - 1; i++) { if (twa >= A[i] && twa <= A[i + 1]) { i0 = i; break; } }
      let j0 = 0; for (let j = 0; j < T.length - 1; j++) { if (tws >= T[j] && tws <= T[j + 1]) { j0 = j; break; } }
      const i1 = i0 + 1, j1 = j0 + 1;
      const t = (twa - A[i0]) / (A[i1] - A[i0]), s = (tws - T[j0]) / (T[j1] - T[j0]);
      const v00 = G[i0][j0], v01 = G[i0][j1], v10 = G[i1][j0], v11 = G[i1][j1];
      return (v00 + (v01 - v00) * s) * (1 - t) + (v10 + (v11 - v10) * s) * t;
    };
  }

  // ── forecast samplers (IDW over the fixed sample points) ───────────────
  function parseMembers(windResults) {
    const fh = windResults[0].data.hourly;
    const speedKeys = Object.keys(fh).filter(k => k.startsWith("wind_speed_10m"));
    const dirKeys = Object.keys(fh).filter(k => k.startsWith("wind_direction_10m"));
    const members = [];
    for (const sk of speedKeys) {
      const suffix = sk.replace("wind_speed_10m", "");
      const dk = "wind_direction_10m" + suffix;
      if (!dirKeys.includes(dk)) continue;
      members.push({ id: suffix || "control", speedKey: sk, dirKey: dk });
    }
    return members;
  }

  function windAt(lat, lon, hourIdx, memberInfo, windResults) {
    const p = { lat, lon };
    let u = 0, v = 0, totalWeight = 0;
    for (let i = 0; i < windResults.length; i++) {
      const ws = windResults[i];
      const d = fastDistNm(p, ws.sample), w = 1 / Math.max(d, 1) ** 2;
      const h = ws.data.hourly;
      const speed = h[memberInfo.speedKey][hourIdx], dir = h[memberInfo.dirKey][hourIdx];
      if (speed == null || dir == null) continue;
      totalWeight += w;
      const dr = dir * D2R;
      u += -speed * Math.sin(dr) * w; v += -speed * Math.cos(dr) * w;
    }
    if (!totalWeight) return { speed: 0, dir: 0 };
    u /= totalWeight; v /= totalWeight;
    return { speed: Math.sqrt(u * u + v * v), dir: (Math.atan2(-u, -v) * R2D + 360) % 360 };
  }

  function currentAt(lat, lon, hourIdx, marineResults) {
    if (!marineResults || !marineResults.length) return { speed_kt: 0, dir_to_deg: 0 };
    const p = { lat, lon };
    let u = 0, v = 0, totalWeight = 0;
    for (const cr of marineResults) {
      if (!cr.data) continue;
      const d = fastDistNm(p, cr.sample), w = 1 / Math.max(d, 1) ** 2;
      const h = cr.data.hourly, idx = Math.min(hourIdx, h.time.length - 1);
      const sp = h.ocean_current_velocity[idx], dt = h.ocean_current_direction[idx];
      if (sp == null || dt == null) continue;
      totalWeight += w;
      const dr = dt * D2R;
      u += sp * Math.sin(dr) * w; v += sp * Math.cos(dr) * w;
    }
    if (!totalWeight) return { speed_kt: 0, dir_to_deg: 0 };
    u /= totalWeight; v /= totalWeight;
    const kmh = Math.sqrt(u * u + v * v);
    return { speed_kt: kmh * 0.539957, dir_to_deg: (Math.atan2(u, v) * R2D + 360) % 360 };
  }

  // ── land guard ─────────────────────────────────────────────────────────
  // No-go rectangles for the Newport→Bermuda corridor: the New England coast at
  // the departure end and the Bermuda island/reef platform at the arrival end
  // (St. George's itself stays outside every box so arrivals can finish).
  // Demo-grade — a real chart-based mask is a later layer.
  const LAND = [
    { s: 40.55, n: 41.30, w: -74.10, e: -71.90 },  // Long Island
    { s: 41.13, n: 41.24, w: -71.62, e: -71.51 },  // Block Island
    { s: 41.36, n: 41.55, w: -71.95, e: -71.42 },  // RI south shore / Point Judith
    // Newport sits at Aquidneck's southern tip — keep this box clear of the
    // harbor's SE exit water or it walls the start in (proved live: SW wind put
    // every non-blocked heading in the no-go cone and the whole fleet died).
    { s: 41.45, n: 41.60, w: -71.27, e: -70.95 },  // Middletown / Sakonnet shore
    { s: 41.18, n: 42.30, w: -70.95, e: -69.75 },  // Cape Cod, Vineyard, Nantucket
    { s: 41.52, n: 45.00, w: -75.00, e: -69.50 },  // New England mainland
    { s: 32.23, n: 32.42, w: -64.92, e: -64.71 },  // Bermuda main island + inshore
    { s: 32.32, n: 32.50, w: -65.05, e: -64.78 },  // Bermuda north/west reef platform
    { s: 32.30, n: 32.375, w: -64.72, e: -64.63 }, // St. David's / SE Bermuda
  ];
  function onLand(lat, lon) {
    if (lat > 32.6 && lat < 40.5) return false; // open Atlantic — no box in this band
    for (const b of LAND) { if (lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e) return true; }
    return false;
  }
  // Exact segment-vs-box test (Liang-Barsky clip in lat/lon space). Sampling
  // along the leg can still graze a box corner between samples; clipping can't.
  // Treating the ≤25 nm leg as a straight line in lat/lon is exact enough here.
  function segIntersectsBox(p1, p2, b) {
    const dlat = p2.lat - p1.lat, dlon = p2.lon - p1.lon;
    let t0 = 0, t1 = 1;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return clip(-dlat, p1.lat - b.s) && clip(dlat, b.n - p1.lat)
        && clip(-dlon, p1.lon - b.w) && clip(dlon, b.e - p1.lon) && t0 <= t1;
  }
  // True when the straight leg p1→p2 stays off every land box — an isochrone
  // step is 15–20 nm, so an endpoint-only test could jump clean over an island.
  function segmentClear(p1, p2) {
    // Open Atlantic fast path: no box lives in this band and a single leg is
    // far too short to reach one from inside it.
    if (p1.lat > 32.6 && p1.lat < 40.5 && p2.lat > 32.6 && p2.lat < 40.5) return true;
    for (const b of LAND) { if (segIntersectsBox(p1, p2, b)) return false; }
    return true;
  }

  // ── isochrone routing for one ensemble member ──────────────────────────
  // env: { windResults, currentResults, useCurrents, depOffsetHours, vessel,
  //        start, dest, timeStepH?, maxHours?, arrivalTolNm? }
  function routeMemberIso(memberInfo, env) {
    const { windResults, currentResults, useCurrents, depOffsetHours, vessel, start, dest } = env;
    const polar = makePolar(vessel);
    const DT = env.timeStepH || 2, MAX_H = env.maxHours || 240, TOL = env.arrivalTolNm || 5;
    const HEAD_FAN = 80, HEAD_STEP = 10;   // headings: ±80° around bearing-to-dest
    const SECT = 2.0, SECT_SPAN = 100;     // prune: 2° bearing-from-start sectors, ±100°
    const flen = windResults[0].data.hourly.time.length;
    const b0 = bearing(start, dest);

    // Motoring (PredictWind-style): when the best sailing VMG toward the
    // destination drops below thresholdKt, the engine goes on at motorKt.
    // VMG-based on purpose — it covers both flat calms and "sailable wind that
    // is useless for this leg" (e.g. trades dead on the nose).
    const motoring = env.motoring || {};
    const motorOn = !!motoring.enabled;
    const motorKt = motorOn ? (motoring.motorKt || 6.5) : 0;
    const motorThresh = motorOn ? (motoring.thresholdKt || 4) : 0;

    // Leg legality = exact hand boxes AND (when provided) the page's coastline
    // mask (Natural Earth polygons via env.landGuard).
    const legClear = (p1, p2) => segmentClear(p1, p2) && (!env.landGuard || env.landGuard(p1, p2));

    const mkNode = (lat, lon, time, parent, heading, bsp, tws, twa, currAlong, motor) =>
      ({ lat, lon, time, parent, heading, bsp, tws, twa, currAlong, motor: !!motor });
    let front = [mkNode(start.lat, start.lon, 0, null, b0, 0, 0, 0, 0)];
    let closest = front[0], closestD = gcDistance(start, dest);
    let arrival = null; // { eta, node } — node is the last pre-arrival position

    for (let t = 0; t < MAX_H && front.length && !arrival; t += DT) {
      const hourIdx = Math.floor(t + depOffsetHours);
      if (hourIdx >= flen) break;
      const buckets = new Map(); // sector key → best candidate {node, dist}

      const consider = (node) => {
        if (!legClear(node.parent || node, node)) return false;
        const dist = fastDistNm(start, node);
        // bearing-from-start is degenerate right at the start (becalmed park) —
        // bucket those into the centre sector instead of dropping them.
        const bs = dist < 1 ? 0 : signedDiff(bearing(start, node), b0);
        if (Math.abs(bs) > SECT_SPAN) return false;
        const key = Math.round(bs / SECT);
        // Rank by REMAINING distance to the destination (lower is better).
        // Far out this matches projection-along-course; in the endgame it is
        // the only correct choice — projection scoring rewarded OVERSHOOTING
        // the mark (Catalina→Cabo fleets sailed past the cape forever), and
        // raw dist-from-start rewarded riding currents sideways (Gulf Stream
        // around-the-houses tracks). Sector bucketing keeps lateral diversity.
        const dDest = fastDistNm(node, dest);
        const cur = buckets.get(key);
        if (!cur || dDest < cur.dDest) buckets.set(key, { node, dDest });
        if (dDest < closestD) { closestD = dDest; closest = node; }
        return true;
      };

      for (const pt of front) {
        const wind = windAt(pt.lat, pt.lon, hourIdx, memberInfo, windResults);
        const curr = useCurrents ? currentAt(pt.lat, pt.lon, hourIdx, currentResults) : { speed_kt: 0, dir_to_deg: 0 };
        const cx = curr.speed_kt * Math.sin(curr.dir_to_deg * D2R), cy = curr.speed_kt * Math.cos(curr.dir_to_deg * D2R);
        const bTo = bearing(pt, dest);
        const dPtDest = gcDistance(pt, dest);
        let expanded = 0, bestVmg = 0;

        // Engine candidates: rhumb-ish headings at motorKt (out to ±45° so the
        // engine can round headlands/islands). Also checks in-tolerance +
        // direct-shot finishes.
        const emitMotor = () => {
          for (const dh of [0, -25, 25, -45, 45]) {
            const h = (bTo + dh + 360) % 360;
            let np = sphereWalk(pt, h, motorKt * DT);
            let currAlong = 0;
            if (curr.speed_kt > 0.02) {
              np = sphereWalk(np, curr.dir_to_deg, curr.speed_kt * DT);
              currAlong = curr.speed_kt * Math.cos(circDiff(curr.dir_to_deg, h) * D2R);
            }
            const cand = mkNode(np.lat, np.lon, t + DT, pt, h, motorKt, wind.speed, 0, currAlong, true);
            if (consider(cand)) {
              expanded++;
              if (fastDistNm(np, dest) < TOL) {
                const eta = t + DT;
                if (!arrival || eta < arrival.eta) arrival = { eta, node: cand };
              }
            }
          }
          // Motor direct-shot: fetch the line under power within this step.
          const vx = motorKt * Math.sin(bTo * D2R) + cx, vy = motorKt * Math.cos(bTo * D2R) + cy;
          const ogToDest = vx * Math.sin(bTo * D2R) + vy * Math.cos(bTo * D2R);
          if (ogToDest > 0.3 && dPtDest <= ogToDest * DT + TOL && legClear(pt, dest)) {
            const eta = t + Math.min(DT, dPtDest / ogToDest);
            if (!arrival || eta < arrival.eta)
              arrival = { eta, node: mkNode(dest.lat, dest.lon, eta, pt, bTo, motorKt, wind.speed, 0, 0, true) };
          }
        };

        if (wind.speed < 0.1) {
          // Becalmed: motor if allowed, else park (drift with current).
          if (motorOn) { emitMotor(); }
          if (!expanded) {
            let np = { lat: pt.lat, lon: pt.lon };
            if (curr.speed_kt > 0.02) np = sphereWalk(np, curr.dir_to_deg, curr.speed_kt * DT);
            consider(mkNode(np.lat, np.lon, t + DT, pt, pt.heading, 0, wind.speed, 0, 0));
          }
          continue;
        }

        // Sail direct-shot arrival check: if the boat can fetch the destination
        // within this step on the straight bearing, record a sub-step ETA.
        {
          const twa = circDiff(bTo, wind.dir), bsp = polar(twa, wind.speed);
          if (bsp > 0.2) {
            const vx = bsp * Math.sin(bTo * D2R) + cx, vy = bsp * Math.cos(bTo * D2R) + cy;
            const ogToDest = vx * Math.sin(bTo * D2R) + vy * Math.cos(bTo * D2R); // closing speed
            if (ogToDest > 0.3 && dPtDest <= ogToDest * DT + TOL && legClear(pt, dest)) {
              const eta = t + Math.min(DT, dPtDest / ogToDest);
              if (!arrival || eta < arrival.eta)
                arrival = { eta, node: mkNode(dest.lat, dest.lon, eta, pt, bTo, bsp, wind.speed, twa, 0) };
            }
          }
        }

        for (let dh = -HEAD_FAN; dh <= HEAD_FAN; dh += HEAD_STEP) {
          const h = (bTo + dh + 360) % 360;
          const twa = circDiff(h, wind.dir);
          const bsp = polar(twa, wind.speed);
          if (bsp <= 0.2) continue;
          // Tack/gybe penalty: a big heading change costs boat lengths.
          let dist = bsp * DT;
          const hc = circDiff(h, pt.heading);
          if (hc > 60) dist = Math.max(0, dist - (twa < 90 ? 0.5 : 0.7));
          let np = sphereWalk(pt, h, dist);
          let currAlong = 0;
          if (curr.speed_kt > 0.02) {
            np = sphereWalk(np, curr.dir_to_deg, curr.speed_kt * DT);
            currAlong = curr.speed_kt * Math.cos(circDiff(curr.dir_to_deg, h) * D2R);
          }
          const cand = mkNode(np.lat, np.lon, t + DT, pt, h, bsp, wind.speed, twa, currAlong);
          if (consider(cand)) {
            expanded++;
            // Sailing VMG toward the destination — drives the motoring decision.
            const vx = bsp * Math.sin(h * D2R) + cx, vy = bsp * Math.cos(h * D2R) + cy;
            const vmg = vx * Math.sin(bTo * D2R) + vy * Math.cos(bTo * D2R);
            if (vmg > bestVmg) bestVmg = vmg;
            // A fan step that lands inside the arrival circle counts as a finish
            // too — beating boats can't fetch the line, so the direct-shot check
            // alone never flags them (live bug: 20 members parked 3 nm out).
            if (fastDistNm(np, dest) < TOL) {
              const eta = t + DT;
              if (!arrival || eta < arrival.eta) arrival = { eta, node: cand };
            }
          }
        }
        // Engine on when sailing can't make useful progress toward the mark.
        // Hysteresis: a branch already under power keeps the engine on until
        // sailing VMG is clearly better (+1 kt) — crews don't toggle hourly,
        // and threshold-hovering produced sail/motor sawtooth tracks.
        const engageAt = pt.motor ? motorThresh + 1.0 : motorThresh;
        if (motorOn && bestVmg < engageAt) emitMotor();
        if (!expanded) {
          // Everything stalled (no-go cone + land wall, engine off or blocked) —
          // park the branch and wait for the wind to shift instead of killing it.
          consider(mkNode(pt.lat, pt.lon, t + DT, pt, pt.heading, 0, wind.speed, 0, 0));
        }
      }
      front = [];
      for (const { node } of buckets.values()) front.push(node);
    }

    // Reconstruct the winning (or closest) path.
    const endNode = arrival ? arrival.node : closest;
    const path = [];
    let maxTws = 0, sumTws = 0, twsCount = 0, maxFav = 0, maxAdv = 0, engineHours = 0;
    for (let n = endNode; n; n = n.parent) {
      path.push({ lat: n.lat, lon: n.lon, time: n.time, bsp: n.bsp, tws: n.tws, twa: n.twa, heading: n.heading, curr_kt: Math.abs(n.currAlong), motor: !!n.motor });
      if (n.parent) {
        maxTws = Math.max(maxTws, n.tws); sumTws += n.tws; twsCount++;
        if (n.motor) engineHours += n.time - n.parent.time;
        if (n.currAlong > 0) maxFav = Math.max(maxFav, n.currAlong);
        else maxAdv = Math.max(maxAdv, -n.currAlong);
      }
    }
    path.reverse();
    const totalHours = endNode.time || 0;
    return {
      member: memberInfo.id, path,
      etaHours: arrival ? arrival.eta : null, arrived: !!arrival,
      maxTws, avgTws: twsCount > 0 ? sumTws / twsCount : 0,
      maxFavorableCurrent: maxFav, maxAdverseCurrent: maxAdv,
      engineHours, pctMotor: totalHours > 0 ? engineHours / totalHours : 0,
      finalDistance: arrival ? 0 : closestD,
    };
  }

  // Route the whole ensemble, yielding to the event loop between batches so the
  // UI (loader / recompute indicator) stays alive. ~50 members ≈ a few seconds.
  async function routeFleet(members, env, onProgress) {
    const routes = [];
    for (let i = 0; i < members.length; i++) {
      routes.push(routeMemberIso(members[i], env));
      if (onProgress) onProgress(i + 1, members.length);
      if (i % 3 === 2) await new Promise(r => setTimeout(r, 0));
    }
    return routes;
  }

  window.Router = {
    routeFleet, routeMemberIso, parseMembers, windAt, currentAt,
    gcDistance, bearing, sphereWalk, circDiff, makePolar, onLand,
  };
})();
