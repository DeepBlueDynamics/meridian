//! Natural Earth coastline mask — verbatim transliteration of
//! lib/landmask.js (post memo-purity patch) plus routing.html's corridor
//! logic (makeLandGuard, refreshLandAnchors).
//!
//! Fidelity notes:
//! - `pointOnLand` evaluates at the 0.01°-quantized point (pure — matches
//!   the patched JS exactly); Rust needs no memo at all.
//! - Inline `x * 0.5 * Math.PI / 180` stays LEFT-ASSOCIATIVE
//!   (((x*0.5)*PI)/180) — different rounding than premultiplied D2R; the JS
//!   module mixes both styles and we port each per-site.
//! - inRing keeps the exact even-odd expression INCLUDING the division.
//! - Raster pass 2's cell-skip (`c = Math.max(c, nextC); continue;` then the
//!   for-update `c++`) is ported with the same net advance.
//! - Geojson is walked with serde_json exactly like the JS loop; feature and
//!   ring order preserved (result-neutral for the OR-query, but kept anyway).

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::geo::{gc_distance, LL};
use super::jsmath as jm;

const NE: &str = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
const SRCS: [(&str, Option<f64>); 3] = [
    ("ne_50m_land.geojson", None),
    ("ne_10m_land.geojson", Some(2.5)),
    ("ne_10m_minor_islands.geojson", None),
];
const CELL: f64 = 0.5;

pub struct Poly {
    bbox: [f64; 4], // w, s, e, n
    ring: Vec<f64>, // lon,lat pairs
}

pub struct LandMask {
    polys: Vec<Poly>,
    cells: HashMap<(i64, i64), Vec<u32>>,
}

#[inline]
fn cell_of(lon: f64, lat: f64) -> (i64, i64) {
    ((lon / CELL).floor() as i64, (lat / CELL).floor() as i64)
}

impl LandMask {
    /// Fetch (or read from disk cache) the three NE layers and build the
    /// index. Cache dir: `<exe dir>/landmask-cache/` — delete files to
    /// force a refresh. NE data is effectively static.
    pub async fn load() -> Result<LandMask, String> {
        let cache_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("landmask-cache")))
            .ok_or("no exe dir")?;
        std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| e.to_string())?;

        let mut layers: Vec<(serde_json::Value, Option<f64>)> = Vec::new();
        for (name, max_span) in SRCS {
            let path = cache_dir.join(name);
            let text = if path.exists() {
                std::fs::read_to_string(&path).map_err(|e| format!("cache read {name}: {e}"))?
            } else {
                tracing::info!("landmask: fetching {name}");
                let r = client
                    .get(format!("{NE}{name}"))
                    .send()
                    .await
                    .map_err(|e| format!("landmask fetch {name}: {e}"))?;
                if !r.status().is_success() {
                    return Err(format!("landmask HTTP {} for {name}", r.status()));
                }
                let body = r.text().await.map_err(|e| e.to_string())?;
                let _ = std::fs::write(&path, &body);
                body
            };
            let gj: serde_json::Value =
                serde_json::from_str(&text).map_err(|e| format!("landmask parse {name}: {e}"))?;
            layers.push((gj, max_span));
        }

        let mut polys: Vec<Poly> = Vec::new();
        let mut cells: HashMap<(i64, i64), Vec<u32>> = HashMap::new();
        let mut ring_pts = 0usize;
        for (gj, max_span_deg) in &layers {
            let features = gj["features"].as_array().cloned().unwrap_or_default();
            for f in &features {
                let g = &f["geometry"];
                let multi: Vec<&serde_json::Value> = match g["type"].as_str() {
                    Some("Polygon") => vec![&g["coordinates"]],
                    Some("MultiPolygon") => g["coordinates"].as_array().map(|a| a.iter().collect()).unwrap_or_default(),
                    _ => vec![],
                };
                for poly in multi {
                    let Some(outer) = poly.get(0).and_then(|o| o.as_array()) else { continue };
                    if outer.len() < 4 {
                        continue;
                    }
                    let (mut w, mut s, mut e, mut n) = (180.0f64, 90.0f64, -180.0f64, -90.0f64);
                    let mut ring = Vec::with_capacity(outer.len() * 2);
                    for pt in outer {
                        let lon = pt[0].as_f64().unwrap_or(f64::NAN);
                        let lat = pt[1].as_f64().unwrap_or(f64::NAN);
                        if lon < w { w = lon; }
                        if lon > e { e = lon; }
                        if lat < s { s = lat; }
                        if lat > n { n = lat; }
                        ring.push(lon);
                        ring.push(lat);
                    }
                    if let Some(span) = max_span_deg {
                        if e - w > *span || n - s > *span {
                            continue;
                        }
                    }
                    let idx = polys.len() as u32;
                    ring_pts += outer.len();
                    polys.push(Poly { bbox: [w, s, e, n], ring });
                    let (cx0, cx1) = ((w / CELL).floor() as i64, (e / CELL).floor() as i64);
                    let (cy0, cy1) = ((s / CELL).floor() as i64, (n / CELL).floor() as i64);
                    for cx in cx0..=cx1 {
                        for cy in cy0..=cy1 {
                            cells.entry((cx, cy)).or_default().push(idx);
                        }
                    }
                }
            }
        }
        tracing::info!(
            "landmask ready: {} polygons, {} ring points, {} cells",
            polys.len(),
            ring_pts,
            cells.len()
        );
        Ok(LandMask { polys, cells })
    }

    /// Even-odd ray cast — exact JS expression, division included.
    fn in_ring(r: &[f64], x: f64, y: f64) -> bool {
        let mut inside = false;
        let n = r.len() / 2;
        let mut j = n - 1;
        for i in 0..n {
            let xi = r[2 * i];
            let yi = r[2 * i + 1];
            let xj = r[2 * j];
            let yj = r[2 * j + 1];
            if ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
                inside = !inside;
            }
            j = i;
        }
        inside
    }

    pub fn point_on_land_raw(&self, lat: f64, lon: f64) -> bool {
        let Some(list) = self.cells.get(&cell_of(lon, lat)) else { return false };
        for &i in list {
            let p = &self.polys[i as usize];
            let b = &p.bbox;
            if lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3] {
                continue;
            }
            if Self::in_ring(&p.ring, lon, lat) {
                return true;
            }
        }
        false
    }

    /// Quantized-pure pointOnLand (matches the patched JS memo semantics:
    /// evaluate AT trunc(x*100)/100). No cache needed — the raw query on a
    /// quantized point is already the canonical answer.
    pub fn point_on_land(&self, lat: f64, lon: f64) -> bool {
        let qlat = jm::js_trunc_i64(lat * 100.0);
        let qlon = jm::js_trunc_i64(lon * 100.0);
        self.point_on_land_raw(qlat as f64 / 100.0, qlon as f64 / 100.0)
    }

    /// Module-level segmentClear — occupancy scan at ≤6 nm, then ≤1 nm.
    pub fn segment_clear(&self, p1: LL, p2: LL) -> bool {
        let d_lat_nm = (p2.lat - p1.lat) * 60.0;
        let d_lon_nm = (p2.lon - p1.lon) * 60.0 * jm::cos((p1.lat + p2.lat) * 0.5 * std::f64::consts::PI / 180.0);
        let d = jm::sqrt(d_lat_nm * d_lat_nm + d_lon_nm * d_lon_nm);
        let nc = jm::js_max(1.0, (d / 6.0).ceil()) as i64;
        let mut occupied = false;
        for i in 0..=nc {
            let f = i as f64 / nc as f64;
            if self
                .cells
                .contains_key(&cell_of(p1.lon + (p2.lon - p1.lon) * f, p1.lat + (p2.lat - p1.lat) * f))
            {
                occupied = true;
                break;
            }
        }
        if !occupied {
            return true;
        }
        let n = jm::js_max(1.0, (d / 1.0).ceil()) as i64;
        for i in 0..=n {
            let f = i as f64 / n as f64;
            if self.point_on_land(p1.lat + (p2.lat - p1.lat) * f, p1.lon + (p2.lon - p1.lon) * f) {
                return false;
            }
        }
        true
    }

    /// Module-level nearestWater — 30° bearings, default reach 12 nm.
    #[allow(dead_code)]
    pub fn nearest_water(&self, lat: f64, lon: f64, max_nm: i64) -> Option<LL> {
        if !self.point_on_land(lat, lon) {
            return Some(LL { lat, lon });
        }
        for r in 1..=max_nm {
            let mut b = 0.0f64;
            while b < 360.0 {
                let p = LL {
                    lat: lat + (r as f64 / 60.0) * jm::cos(b * std::f64::consts::PI / 180.0),
                    lon: lon + (r as f64 / (60.0 * jm::cos(lat * std::f64::consts::PI / 180.0))) * jm::sin(b * std::f64::consts::PI / 180.0),
                };
                if !self.point_on_land(p.lat, p.lon) {
                    return Some(p);
                }
                b += 30.0;
            }
        }
        None
    }

    /// buildRaster — 3-pass corridor raster. Pass 2 is row-parallel (rayon):
    /// each row's bits depend only on the immutable index, so output is
    /// order-independent and bit-identical to the sequential JS.
    pub fn build_raster(&self, w: f64, s: f64, e: f64, n: f64, res: f64, progress: &AtomicUsize) -> Raster<'_> {
        use rayon::prelude::*;
        let cols = jm::js_max(1.0, ((e - w) / res).ceil()) as usize;
        let rows = jm::js_max(1.0, ((n - s) / res).ceil()) as usize;
        let mut bits = vec![0u8; cols * rows];

        // Pass 1 — stamp coastline vertex cells
        for p in &self.polys {
            let b = &p.bbox;
            if b[2] < w || b[0] > e || b[3] < s || b[1] > n {
                continue;
            }
            let ring = &p.ring;
            let mut i = 0;
            while i < ring.len() {
                let lon = ring[i];
                let lat = ring[i + 1];
                i += 2;
                if lat < s || lat >= n || lon < w || lon >= e {
                    continue;
                }
                let r = jm::js_trunc_i64((lat - s) / res) as usize;
                let c = jm::js_trunc_i64((lon - w) / res) as usize;
                bits[r * cols + c] = 1;
            }
        }

        // Pass 2 — center-sample interiors, skipping open-ocean buckets
        bits.par_chunks_mut(cols).enumerate().for_each(|(r, row)| {
            let lat = s + (r as f64 + 0.5) * res;
            let mut c: i64 = 0;
            while c < cols as i64 {
                let lon = w + (c as f64 + 0.5) * res;
                if !self.cells.contains_key(&cell_of(lon, lat)) {
                    // c = Math.max(c, nextC); continue;  (then for-update c++)
                    let next_c = jm::js_min(
                        (cols - 1) as f64,
                        ((((lon / CELL).floor() + 1.0) * CELL - w) / res).floor(),
                    ) as i64;
                    c = c.max(next_c);
                    c += 1;
                    continue;
                }
                if row[c as usize] == 0 && self.point_on_land_raw(lat, lon) {
                    row[c as usize] = 1;
                }
                c += 1;
            }
            progress.fetch_add(1, Ordering::Relaxed);
        });

        // Pass 3 — dilate by one cell (3×3)
        let mut dil = bits.clone();
        for r in 0..rows {
            for c in 0..cols {
                if bits[r * cols + c] == 0 {
                    continue;
                }
                for dr in -1i64..=1 {
                    for dc in -1i64..=1 {
                        let rr = r as i64 + dr;
                        let cc = c as i64 + dc;
                        if rr >= 0 && rr < rows as i64 && cc >= 0 && cc < cols as i64 {
                            dil[rr as usize * cols + cc as usize] = 1;
                        }
                    }
                }
            }
        }

        Raster { w, s, e, n, res, cols, rows, dil, mask: self }
    }
}

pub struct Raster<'a> {
    pub w: f64,
    pub s: f64,
    pub e: f64,
    pub n: f64,
    pub res: f64,
    pub cols: usize,
    pub rows: usize,
    dil: Vec<u8>,
    mask: &'a LandMask,
}

impl<'a> Raster<'a> {
    #[inline]
    fn in_bounds(&self, lat: f64, lon: f64) -> bool {
        lat >= self.s && lat < self.n && lon >= self.w && lon < self.e
    }
    #[inline]
    fn hit(&self, lat: f64, lon: f64) -> bool {
        let r = jm::js_trunc_i64((lat - self.s) / self.res) as usize;
        let c = jm::js_trunc_i64((lon - self.w) / self.res) as usize;
        self.dil[r * self.cols + c] == 1
    }
    pub fn point_on_land(&self, lat: f64, lon: f64) -> bool {
        if self.in_bounds(lat, lon) {
            self.hit(lat, lon)
        } else {
            self.mask.point_on_land(lat, lon)
        }
    }
    /// Anchor snapping on the DILATED raster — 20° bearings. `acceptable`
    /// adds caller constraints (the engine's hand LAND boxes: raster-water
    /// inside a box has zero legal legs — the Newport→Sakonnet strand).
    /// Mirrors lib/landmask.js raster nearestWater exactly.
    pub fn nearest_water(&self, lat: f64, lon: f64, max_nm: i64, acceptable: Option<&dyn Fn(f64, f64) -> bool>) -> Option<LL> {
        let ok = |la: f64, lo: f64| -> bool {
            !self.point_on_land(la, lo) && acceptable.map_or(true, |a| a(la, lo))
        };
        if ok(lat, lon) {
            return Some(LL { lat, lon });
        }
        for r in 1..=max_nm {
            let mut b = 0.0f64;
            while b < 360.0 {
                let p = LL {
                    lat: lat + (r as f64 / 60.0) * jm::cos(b * std::f64::consts::PI / 180.0),
                    lon: lon + (r as f64 / (60.0 * jm::cos(lat * std::f64::consts::PI / 180.0))) * jm::sin(b * std::f64::consts::PI / 180.0),
                };
                if ok(p.lat, p.lon) {
                    return Some(p);
                }
                b += 20.0;
            }
        }
        None
    }
    pub fn segment_clear(&self, p1: LL, p2: LL) -> bool {
        let d_lat_nm = (p2.lat - p1.lat) * 60.0;
        let d_lon_nm = (p2.lon - p1.lon) * 60.0 * jm::cos((p1.lat + p2.lat) * 0.5 * std::f64::consts::PI / 180.0);
        let d = jm::sqrt(d_lat_nm * d_lat_nm + d_lon_nm * d_lon_nm);
        let np = jm::js_max(1.0, (d / 1.0).ceil()) as i64;
        for i in 0..=np {
            let f = i as f64 / np as f64;
            let lat = p1.lat + (p2.lat - p1.lat) * f;
            let lon = p1.lon + (p2.lon - p1.lon) * f;
            if if self.in_bounds(lat, lon) { self.hit(lat, lon) } else { self.mask.point_on_land(lat, lon) } {
                return false;
            }
        }
        true
    }
}

/// Corridor prep — transliteration of routing.html refreshLandAnchors:
/// bbox = route extent + 3.5°/4° margins (clamped ±85 lat), raster at
/// 0.02°, anchors snapped to water in the DILATED raster with 60 nm reach.
pub enum CorridorError {
    LandlockedStart,
    LandlockedDest,
}

pub struct Corridor<'a> {
    pub raster: Raster<'a>,
    pub dep_anchor: LL,
    pub arr_anchor: LL,
}

pub fn prepare_corridor<'a>(
    mask: &'a LandMask,
    raw_start: LL,
    raw_dest: LL,
    progress: &AtomicUsize,
) -> Result<Corridor<'a>, CorridorError> {
    let s = jm::js_max(-85.0, jm::js_min(raw_start.lat, raw_dest.lat) - 3.5);
    let n = jm::js_min(85.0, jm::js_max(raw_start.lat, raw_dest.lat) + 3.5);
    let w = jm::js_min(raw_start.lon, raw_dest.lon) - 4.0;
    let e = jm::js_max(raw_start.lon, raw_dest.lon) + 4.0;
    let raster = mask.build_raster(w, s, e, n, 0.02, progress);
    // Anchors must clear the engine's hand LAND boxes too (routing.html
    // passes the same predicate to the JS raster nearestWater).
    let box_clear = |la: f64, lo: f64| !super::engine::on_land_boxes(la, lo);
    let dep_anchor = raster
        .nearest_water(raw_start.lat, raw_start.lon, 60, Some(&box_clear))
        .ok_or(CorridorError::LandlockedStart)?;
    let arr_anchor = raster
        .nearest_water(raw_dest.lat, raw_dest.lon, 60, Some(&box_clear))
        .ok_or(CorridorError::LandlockedDest)?;
    Ok(Corridor { raster, dep_anchor, arr_anchor })
}

/// routing.html makeLandGuard — the env.landGuard closure: raster segClear
/// with a 2 nm harbor exemption near the snapped anchors (trim a 2.5 nm stub
/// and retest).
pub struct LandGuard<'a> {
    pub a1: LL,
    pub a2: LL,
    pub raster: &'a Raster<'a>,
}

impl<'a> LandGuard<'a> {
    pub fn clear(&self, p1: LL, p2: LL) -> bool {
        if self.raster.segment_clear(p1, p2) {
            return true;
        }
        for a in [self.a1, self.a2] {
            let d1 = gc_distance(p1, a);
            let d2 = gc_distance(p2, a);
            if d1 < 2.0 || d2 < 2.0 {
                let d = gc_distance(p1, p2);
                if d <= 2.6 {
                    return true;
                }
                let mut q1 = p1;
                let mut q2 = p2;
                if d2 < 2.0 {
                    let f = jm::js_max(0.0, 1.0 - 2.5 / d);
                    q2 = LL { lat: p1.lat + (p2.lat - p1.lat) * f, lon: p1.lon + (p2.lon - p1.lon) * f };
                }
                if d1 < 2.0 {
                    let f = jm::js_min(1.0, 2.5 / d);
                    q1 = LL { lat: p1.lat + (p2.lat - p1.lat) * f, lon: p1.lon + (p2.lon - p1.lon) * f };
                }
                return self.raster.segment_clear(q1, q2);
            }
        }
        false
    }
}
