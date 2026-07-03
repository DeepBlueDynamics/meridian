//! Spherical helpers — verbatim transliteration of lib/router.js L11–40.
//! Expression shapes and evaluation order are preserved exactly (fidelity
//! doctrine): `x**2` becomes `x*x` (fdlibm pow special-cases y==2 to x*x, so
//! this is bit-identical), single-mod stays single-mod, double-mod stays
//! double-mod. All transcendentals go through jsmath.

use super::jsmath as jm;

pub const D2R: f64 = std::f64::consts::PI / 180.0;
pub const R2D: f64 = 180.0 / std::f64::consts::PI;
pub const EARTH_R_NM: f64 = 3440.065;

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct LL {
    pub lat: f64,
    pub lon: f64,
}

/// Haversine, nm. router.js L14–19.
pub fn gc_distance(p1: LL, p2: LL) -> f64 {
    let lat1 = p1.lat * D2R;
    let lat2 = p2.lat * D2R;
    let dlat = (p2.lat - p1.lat) * D2R;
    let dlon = (p2.lon - p1.lon) * D2R;
    let sh = jm::sin(dlat / 2.0);
    let sl = jm::sin(dlon / 2.0);
    let a = sh * sh + jm::cos(lat1) * jm::cos(lat2) * (sl * sl);
    2.0 * EARTH_R_NM * jm::asin(jm::js_min(1.0, jm::sqrt(a)))
}

/// Equirectangular approximation, nm. router.js L22–26.
pub fn fast_dist_nm(p1: LL, p2: LL) -> f64 {
    let dy = p2.lat - p1.lat;
    let dx = (p2.lon - p1.lon) * jm::cos((p1.lat + p2.lat) * 0.5 * D2R);
    60.0 * jm::sqrt(dx * dx + dy * dy)
}

/// Initial great-circle bearing, degrees [0,360). router.js L27–32.
/// NOTE: single mod (input is always >= 180 after +360) — not the double-mod.
pub fn bearing(p1: LL, p2: LL) -> f64 {
    let lat1 = p1.lat * D2R;
    let lat2 = p2.lat * D2R;
    let dlon = (p2.lon - p1.lon) * D2R;
    let y = jm::sin(dlon) * jm::cos(lat2);
    let x = jm::cos(lat1) * jm::sin(lat2) - jm::sin(lat1) * jm::cos(lat2) * jm::cos(dlon);
    (jm::atan2(y, x) * R2D + 360.0) % 360.0
}

/// Destination point. router.js L33–38.
pub fn sphere_walk(pos: LL, hdg_deg: f64, dist_nm: f64) -> LL {
    let lat1 = pos.lat * D2R;
    let lon1 = pos.lon * D2R;
    let hdg = hdg_deg * D2R;
    let d = dist_nm / EARTH_R_NM;
    let lat2 = jm::asin(jm::sin(lat1) * jm::cos(d) + jm::cos(lat1) * jm::sin(d) * jm::cos(hdg));
    let lon2 = lon1
        + jm::atan2(
            jm::sin(hdg) * jm::sin(d) * jm::cos(lat1),
            jm::cos(d) - jm::sin(lat1) * jm::sin(lat2),
        );
    LL { lat: lat2 * R2D, lon: lon2 * R2D }
}

/// Absolute angular difference [0,180]. router.js L39.
pub fn circ_diff(a: f64, b: f64) -> f64 {
    let d = ((a - b) % 360.0 + 360.0) % 360.0;
    if d > 180.0 { 360.0 - d } else { d }
}

/// Signed angular difference [-180,180]. router.js L40.
pub fn signed_diff(a: f64, b: f64) -> f64 {
    let d = ((a - b) % 360.0 + 360.0) % 360.0;
    if d > 180.0 { d - 360.0 } else { d }
}
