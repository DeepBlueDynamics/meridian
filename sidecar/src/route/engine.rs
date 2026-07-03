//! The isochrone engine — verbatim transliteration of router.js
//! routeMemberIso (L167–356) + the LAND boxes / Liang-Barsky segment tests
//! (L119–162) + routeFleet (rayon instead of the JS yield loop; members are
//! independent post memo-purity-patch, so parallel == sequential bit-exact).
//!
//! Structural notes for the parity reader:
//! - Nodes live in an arena (Vec); parent links are indices. A node is
//!   arena-pushed once it passes legClear + sector-span (JS allocates the
//!   object regardless; only accepted nodes can become parents/closest, so
//!   this is behavior-identical).
//! - `buckets` is a Vec<(key, entry)> — JS Map first-insertion iteration
//!   order IS the next front's expansion order; linear scan over ≤101 keys.
//! - `consider` returns true whenever the candidate passed legClear + span
//!   (even if it lost its bucket) — `expanded` counts exactly like JS.
//! - Arrival ties: strict `<` — first-seen wins, order fixed by front order
//!   then fan order [0,-25,25,-45,45] / -80..=80 step 10.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use super::forecast::{current_at, wind_at, Current};
use super::geo::*;
use super::jsmath as jm;
use super::landmask::LandGuard;
use super::polar::Polar;
use super::types::*;

// ── LAND boxes (router.js L119–132) ─────────────────────────────────────────
struct LandBox {
    s: f64,
    n: f64,
    w: f64,
    e: f64,
}
const LAND: [LandBox; 9] = [
    LandBox { s: 40.55, n: 41.30, w: -74.10, e: -71.90 }, // Long Island
    LandBox { s: 41.13, n: 41.24, w: -71.62, e: -71.51 }, // Block Island
    LandBox { s: 41.36, n: 41.55, w: -71.95, e: -71.42 }, // RI south shore / Point Judith
    LandBox { s: 41.45, n: 41.60, w: -71.27, e: -70.95 }, // Middletown / Sakonnet shore
    LandBox { s: 41.18, n: 42.30, w: -70.95, e: -69.75 }, // Cape Cod, Vineyard, Nantucket
    LandBox { s: 41.52, n: 45.00, w: -75.00, e: -69.50 }, // New England mainland
    LandBox { s: 32.23, n: 32.42, w: -64.92, e: -64.71 }, // Bermuda main island + inshore
    LandBox { s: 32.32, n: 32.50, w: -65.05, e: -64.78 }, // Bermuda north/west reef platform
    LandBox { s: 32.30, n: 32.375, w: -64.72, e: -64.63 }, // St. David's / SE Bermuda
];

/// Liang-Barsky clip (router.js L141–153).
fn seg_intersects_box(p1: LL, p2: LL, b: &LandBox) -> bool {
    let dlat = p2.lat - p1.lat;
    let dlon = p2.lon - p1.lon;
    let mut t0 = 0.0f64;
    let mut t1 = 1.0f64;
    let mut clip = |p: f64, q: f64| -> bool {
        if p == 0.0 {
            return q >= 0.0;
        }
        let r = q / p;
        if p < 0.0 {
            if r > t1 {
                return false;
            }
            if r > t0 {
                t0 = r;
            }
        } else {
            if r < t0 {
                return false;
            }
            if r < t1 {
                t1 = r;
            }
        }
        true
    };
    clip(-dlat, p1.lat - b.s)
        && clip(dlat, b.n - p1.lat)
        && clip(-dlon, p1.lon - b.w)
        && clip(dlon, b.e - p1.lon)
        && t0 <= t1
}

/// router.js segmentClear (L156–162) — boxes + open-Atlantic fast path.
fn segment_clear_boxes(p1: LL, p2: LL) -> bool {
    if p1.lat > 32.6 && p1.lat < 40.5 && p2.lat > 32.6 && p2.lat < 40.5 {
        return true;
    }
    for b in &LAND {
        if seg_intersects_box(p1, p2, b) {
            return false;
        }
    }
    true
}

// ── node arena ──────────────────────────────────────────────────────────────
#[derive(Clone, Copy)]
struct Node {
    lat: f64,
    lon: f64,
    time: f64,
    parent: Option<u32>,
    heading: f64,
    bsp: f64,
    tws: f64,
    twa: f64,
    curr_along: f64,
    motor: bool,
}

impl Node {
    #[inline]
    fn ll(&self) -> LL {
        LL { lat: self.lat, lon: self.lon }
    }
}

struct BucketEntry {
    node: u32,
    d_dest: f64,
}

pub struct EngineError(pub String);

/// routeMemberIso — one member. `cancel` is checked once per time step.
pub fn route_member_iso(
    member: &MemberInfo,
    req: &RouteRequest,
    start: LL,
    dest: LL,
    guard: Option<&LandGuard>,
    cancel: &AtomicBool,
) -> Result<RouteResult, EngineError> {
    let polar = Polar::new(&req.vessel);
    let dt = if req.time_step_h != 0.0 && !req.time_step_h.is_nan() { req.time_step_h } else { 2.0 };
    let max_h = if req.max_hours != 0.0 && !req.max_hours.is_nan() { req.max_hours } else { 240.0 };
    let tol = if req.arrival_tol_nm != 0.0 && !req.arrival_tol_nm.is_nan() { req.arrival_tol_nm } else { 5.0 };
    const HEAD_FAN: i64 = 80;
    const HEAD_STEP: i64 = 10;
    const SECT: f64 = 2.0;
    const SECT_SPAN: f64 = 100.0;
    let flen = req.wind_results[0].time_len;
    let b0 = bearing(start, dest);

    let motor_on = req.motoring.enabled;
    let motor_kt = if motor_on { js_or(req.motoring.motor_kt, 6.5) } else { 0.0 };
    let motor_thresh = if motor_on { js_or(req.motoring.threshold_kt, 4.0) } else { 0.0 };

    let leg_clear = |p1: LL, p2: LL| -> bool {
        segment_clear_boxes(p1, p2) && guard.map_or(true, |g| g.clear(p1, p2))
    };

    let mut arena: Vec<Node> = Vec::with_capacity(4096);
    let mk = |lat: f64, lon: f64, time: f64, parent: Option<u32>, heading: f64, bsp: f64, tws: f64, twa: f64, curr_along: f64, motor: bool| Node {
        lat, lon, time, parent, heading, bsp, tws, twa, curr_along, motor,
    };

    arena.push(mk(start.lat, start.lon, 0.0, None, b0, 0.0, 0.0, 0.0, 0.0, false));
    let mut front: Vec<u32> = vec![0];
    let mut closest: u32 = 0;
    let mut closest_d = gc_distance(start, dest);
    let mut arrival: Option<(f64, u32)> = None; // (eta, node idx)

    let mut t = 0.0f64;
    while t < max_h && !front.is_empty() && arrival.is_none() {
        if cancel.load(Ordering::Relaxed) {
            return Err(EngineError("cancelled".into()));
        }
        let hour_f = (t + req.dep_offset_hours).floor();
        if hour_f >= flen as f64 {
            break;
        }
        let hour_idx = hour_f as usize;
        let mut buckets: Vec<(i32, BucketEntry)> = Vec::with_capacity(101);

        // consider(): returns Some(idx) when the candidate passed
        // legClear + span (== JS `true`), None otherwise.
        macro_rules! consider {
            ($cand:expr) => {{
                let cand: Node = $cand;
                let parent_ll = match cand.parent {
                    Some(p) => arena[p as usize].ll(),
                    None => cand.ll(),
                };
                if !leg_clear(parent_ll, cand.ll()) {
                    None
                } else {
                    let dist = fast_dist_nm(start, cand.ll());
                    let bs = if dist < 1.0 { 0.0 } else { signed_diff(bearing(start, cand.ll()), b0) };
                    if bs.abs() > SECT_SPAN {
                        None
                    } else {
                        let key = jm::js_round(bs / SECT) as i32;
                        let d_dest = fast_dist_nm(cand.ll(), dest);
                        let idx = arena.len() as u32;
                        arena.push(cand);
                        match buckets.iter_mut().find(|(k, _)| *k == key) {
                            Some((_, e)) => {
                                if d_dest < e.d_dest {
                                    e.node = idx;
                                    e.d_dest = d_dest;
                                }
                            }
                            None => buckets.push((key, BucketEntry { node: idx, d_dest })),
                        }
                        if d_dest < closest_d {
                            closest_d = d_dest;
                            closest = idx;
                        }
                        Some(idx)
                    }
                }
            }};
        }

        let front_now = std::mem::take(&mut front);
        for &pt_idx in &front_now {
            let pt = arena[pt_idx as usize];
            let wind = wind_at(pt.lat, pt.lon, hour_idx, member, &req.wind_results);
            let curr: Current = if req.use_currents {
                current_at(pt.lat, pt.lon, hour_idx, req.marine_results.as_deref())
            } else {
                Current { speed_kt: 0.0, dir_to_deg: 0.0 }
            };
            let cx = curr.speed_kt * jm::sin(curr.dir_to_deg * D2R);
            let cy = curr.speed_kt * jm::cos(curr.dir_to_deg * D2R);
            let b_to = bearing(pt.ll(), dest);
            let d_pt_dest = gc_distance(pt.ll(), dest);
            let mut expanded = 0i32;
            let mut best_vmg = 0.0f64;

            macro_rules! emit_motor {
                () => {{
                    for dh in [0.0f64, -25.0, 25.0, -45.0, 45.0] {
                        let h = (b_to + dh + 360.0) % 360.0;
                        let mut np = sphere_walk(pt.ll(), h, motor_kt * dt);
                        let mut curr_along = 0.0;
                        if curr.speed_kt > 0.02 {
                            np = sphere_walk(np, curr.dir_to_deg, curr.speed_kt * dt);
                            curr_along = curr.speed_kt * jm::cos(circ_diff(curr.dir_to_deg, h) * D2R);
                        }
                        let cand = mk(np.lat, np.lon, t + dt, Some(pt_idx), h, motor_kt, wind.speed, 0.0, curr_along, true);
                        if let Some(idx) = consider!(cand) {
                            expanded += 1;
                            if fast_dist_nm(np, dest) < tol {
                                let eta = t + dt;
                                if arrival.map_or(true, |(a, _)| eta < a) {
                                    arrival = Some((eta, idx));
                                }
                            }
                        }
                    }
                    // Motor direct-shot: fetch the line under power within this step.
                    let vx = motor_kt * jm::sin(b_to * D2R) + cx;
                    let vy = motor_kt * jm::cos(b_to * D2R) + cy;
                    let og_to_dest = vx * jm::sin(b_to * D2R) + vy * jm::cos(b_to * D2R);
                    if og_to_dest > 0.3 && d_pt_dest <= og_to_dest * dt + tol && leg_clear(pt.ll(), dest) {
                        let eta = t + jm::js_min(dt, d_pt_dest / og_to_dest);
                        if arrival.map_or(true, |(a, _)| eta < a) {
                            let idx = arena.len() as u32;
                            arena.push(mk(dest.lat, dest.lon, eta, Some(pt_idx), b_to, motor_kt, wind.speed, 0.0, 0.0, true));
                            arrival = Some((eta, idx));
                        }
                    }
                }};
            }

            if wind.speed < 0.1 {
                // Becalmed: motor if allowed, else park (drift with current).
                if motor_on {
                    emit_motor!();
                }
                if expanded == 0 {
                    let mut np = pt.ll();
                    if curr.speed_kt > 0.02 {
                        np = sphere_walk(np, curr.dir_to_deg, curr.speed_kt * dt);
                    }
                    let _ = consider!(mk(np.lat, np.lon, t + dt, Some(pt_idx), pt.heading, 0.0, wind.speed, 0.0, 0.0, false));
                }
                continue;
            }

            // Sail direct-shot arrival check.
            {
                let twa = circ_diff(b_to, wind.dir);
                let bsp = polar.bsp(twa, wind.speed);
                if bsp > 0.2 {
                    let vx = bsp * jm::sin(b_to * D2R) + cx;
                    let vy = bsp * jm::cos(b_to * D2R) + cy;
                    let og_to_dest = vx * jm::sin(b_to * D2R) + vy * jm::cos(b_to * D2R);
                    if og_to_dest > 0.3 && d_pt_dest <= og_to_dest * dt + tol && leg_clear(pt.ll(), dest) {
                        let eta = t + jm::js_min(dt, d_pt_dest / og_to_dest);
                        if arrival.map_or(true, |(a, _)| eta < a) {
                            let idx = arena.len() as u32;
                            arena.push(mk(dest.lat, dest.lon, eta, Some(pt_idx), b_to, bsp, wind.speed, twa, 0.0, false));
                            arrival = Some((eta, idx));
                        }
                    }
                }
            }

            // Sail heading fan.
            let mut dh = -HEAD_FAN;
            while dh <= HEAD_FAN {
                let h = (b_to + dh as f64 + 360.0) % 360.0;
                let twa = circ_diff(h, wind.dir);
                let bsp = polar.bsp(twa, wind.speed);
                if bsp <= 0.2 {
                    dh += HEAD_STEP;
                    continue;
                }
                let mut dist = bsp * dt;
                let hc = circ_diff(h, pt.heading);
                if hc > 60.0 {
                    dist = jm::js_max(0.0, dist - (if twa < 90.0 { 0.5 } else { 0.7 }));
                }
                let mut np = sphere_walk(pt.ll(), h, dist);
                let mut curr_along = 0.0;
                if curr.speed_kt > 0.02 {
                    np = sphere_walk(np, curr.dir_to_deg, curr.speed_kt * dt);
                    curr_along = curr.speed_kt * jm::cos(circ_diff(curr.dir_to_deg, h) * D2R);
                }
                let cand = mk(np.lat, np.lon, t + dt, Some(pt_idx), h, bsp, wind.speed, twa, curr_along, false);
                if let Some(idx) = consider!(cand) {
                    expanded += 1;
                    let vx = bsp * jm::sin(h * D2R) + cx;
                    let vy = bsp * jm::cos(h * D2R) + cy;
                    let vmg = vx * jm::sin(b_to * D2R) + vy * jm::cos(b_to * D2R);
                    if vmg > best_vmg {
                        best_vmg = vmg;
                    }
                    if fast_dist_nm(np, dest) < tol {
                        let eta = t + dt;
                        if arrival.map_or(true, |(a, _)| eta < a) {
                            arrival = Some((eta, idx));
                        }
                    }
                }
                dh += HEAD_STEP;
            }

            // Motoring engage + hysteresis.
            let engage_at = if pt.motor { motor_thresh + 1.0 } else { motor_thresh };
            if motor_on && best_vmg < engage_at {
                emit_motor!();
            }
            if expanded == 0 {
                let _ = consider!(mk(pt.lat, pt.lon, t + dt, Some(pt_idx), pt.heading, 0.0, wind.speed, 0.0, 0.0, false));
            }
        }
        front = buckets.into_iter().map(|(_, e)| e.node).collect();
        t += dt;
    }

    // Reconstruct the winning (or closest) path.
    let end_idx = arrival.map(|(_, n)| n).unwrap_or(closest);
    let mut path: Vec<PathPoint> = Vec::new();
    let (mut max_tws, mut sum_tws, mut tws_count) = (0.0f64, 0.0f64, 0i64);
    let (mut max_fav, mut max_adv, mut engine_hours) = (0.0f64, 0.0f64, 0.0f64);
    let mut cur = Some(end_idx);
    while let Some(i) = cur {
        let n = arena[i as usize];
        path.push(PathPoint {
            lat: n.lat,
            lon: n.lon,
            time: n.time,
            bsp: n.bsp,
            tws: n.tws,
            twa: n.twa,
            heading: n.heading,
            curr_kt: n.curr_along.abs(),
            motor: n.motor,
        });
        if let Some(p) = n.parent {
            max_tws = jm::js_max(max_tws, n.tws);
            sum_tws += n.tws;
            tws_count += 1;
            if n.motor {
                engine_hours += n.time - arena[p as usize].time;
            }
            if n.curr_along > 0.0 {
                max_fav = jm::js_max(max_fav, n.curr_along);
            } else {
                max_adv = jm::js_max(max_adv, -n.curr_along);
            }
        }
        cur = n.parent;
    }
    path.reverse();
    let end_time = arena[end_idx as usize].time;
    // `endNode.time || 0` — JS falsy fold (0 stays 0; NaN → 0).
    let total_hours = if end_time != 0.0 && !end_time.is_nan() { end_time } else { 0.0 };
    Ok(RouteResult {
        member: member.id.clone(),
        path,
        eta_hours: arrival.map(|(eta, _)| eta),
        arrived: arrival.is_some(),
        max_tws,
        avg_tws: if tws_count > 0 { sum_tws / tws_count as f64 } else { 0.0 },
        max_favorable_current: max_fav,
        max_adverse_current: max_adv,
        engine_hours,
        pct_motor: if total_hours > 0.0 { engine_hours / total_hours } else { 0.0 },
        final_distance: if arrival.is_some() { 0.0 } else { closest_d },
    })
}

/// routeFleet — rayon over members (independent; bit-identical to the JS
/// sequential loop post memo-purity patch). Progress via atomic counter.
pub fn route_fleet(
    req: &RouteRequest,
    start: LL,
    dest: LL,
    guard: Option<&LandGuard>,
    progress: &AtomicUsize,
    cancel: &AtomicBool,
) -> Result<Vec<RouteResult>, EngineError> {
    use rayon::prelude::*;
    let results: Vec<Result<RouteResult, EngineError>> = req
        .members
        .par_iter()
        .map(|m| {
            let r = route_member_iso(m, req, start, dest, guard, cancel);
            progress.fetch_add(1, Ordering::Relaxed);
            r
        })
        .collect();
    results.into_iter().collect()
}
