//! Wire types — the request mirrors routing.html's buildRouteRequest() and
//! the result mirrors router.js routeMemberIso's return object FIELD FOR
//! FIELD (serde renames keep the exact JS names on the wire).

use std::collections::HashMap;

use super::geo::LL;
use super::polar::VesselPolar;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct RouteRequest {
    pub raw_start: LL,
    pub raw_dest: LL,
    pub vessel: VesselPolar,
    pub motoring: Motoring,
    pub use_currents: bool,
    pub dep_offset_hours: f64,
    pub max_hours: f64,
    pub arrival_tol_nm: f64,
    pub time_step_h: f64,
    /// Reserved: shallows avoidance (owner directive). Ignored until depth
    /// data lands in the sidecar; carried so the wire contract won't change.
    #[serde(default)]
    pub constraints: Option<Constraints>,
    pub members: Vec<MemberInfo>,
    pub wind_results: Vec<WindResult>,
    #[serde(default)]
    pub marine_results: Option<Vec<MarineResult>>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Constraints {
    #[serde(default)]
    pub min_depth_m: Option<f64>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Motoring {
    pub enabled: bool,
    #[serde(rename = "motorKt", default)]
    pub motor_kt: Option<f64>,
    #[serde(rename = "thresholdKt", default)]
    pub threshold_kt: Option<f64>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct MemberInfo {
    pub id: String,
    #[serde(rename = "speedKey")]
    pub speed_key: String,
    #[serde(rename = "dirKey")]
    pub dir_key: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct WindResult {
    pub sample: LL,
    pub time_len: usize,
    /// Hourly series keyed by the Open-Meteo member keys (wind_speed_10m*,
    /// wind_direction_10m*). JSON null → None; out-of-bounds index → None —
    /// both mean "skip this sample", exactly like JS `== null`.
    pub series: HashMap<String, Vec<Option<f64>>>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct MarineResult {
    pub sample: LL,
    pub time_len: usize,
    #[serde(default)]
    pub ocean_current_velocity: Option<Vec<Option<f64>>>,
    #[serde(default)]
    pub ocean_current_direction: Option<Vec<Option<f64>>>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PathPoint {
    pub lat: f64,
    pub lon: f64,
    pub time: f64,
    pub bsp: f64,
    pub tws: f64,
    pub twa: f64,
    pub heading: f64,
    pub curr_kt: f64,
    pub motor: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RouteResult {
    pub member: String,
    pub path: Vec<PathPoint>,
    #[serde(rename = "etaHours")]
    pub eta_hours: Option<f64>,
    pub arrived: bool,
    #[serde(rename = "maxTws")]
    pub max_tws: f64,
    #[serde(rename = "avgTws")]
    pub avg_tws: f64,
    #[serde(rename = "maxFavorableCurrent")]
    pub max_favorable_current: f64,
    #[serde(rename = "maxAdverseCurrent")]
    pub max_adverse_current: f64,
    #[serde(rename = "engineHours")]
    pub engine_hours: f64,
    #[serde(rename = "pctMotor")]
    pub pct_motor: f64,
    #[serde(rename = "finalDistance")]
    pub final_distance: f64,
}

/// JS falsy-default: `v || d` — 0, NaN (and absence) fall through to d.
pub fn js_or(v: Option<f64>, d: f64) -> f64 {
    match v {
        Some(x) if x != 0.0 && !x.is_nan() => x,
        _ => d,
    }
}
