//! Forecast samplers — verbatim transliteration of router.js windAt (L76–92)
//! and currentAt (L94–112). IDW weight `1 / max(d,1)²` (x**2 → x*x, exact);
//! wind dir is FROM (meteorological), current dir is TOWARD (oceanographic);
//! km/h → kt via 0.539957. JS null / out-of-bounds reads = skip the sample.

use super::geo::{fast_dist_nm, D2R, R2D, LL};
use super::jsmath as jm;
use super::types::{MarineResult, MemberInfo, WindResult};

pub struct Wind {
    pub speed: f64,
    pub dir: f64,
}

pub struct Current {
    pub speed_kt: f64,
    pub dir_to_deg: f64,
}

#[inline]
fn at(series: Option<&Vec<Option<f64>>>, idx: usize) -> Option<f64> {
    series.and_then(|v| v.get(idx).copied().flatten())
}

pub fn wind_at(lat: f64, lon: f64, hour_idx: usize, member: &MemberInfo, wind_results: &[WindResult]) -> Wind {
    let p = LL { lat, lon };
    let mut u = 0.0;
    let mut v = 0.0;
    let mut total_weight = 0.0;
    for ws in wind_results {
        let d = fast_dist_nm(p, ws.sample);
        let m = jm::js_max(d, 1.0);
        let w = 1.0 / (m * m);
        let speed = at(ws.series.get(&member.speed_key), hour_idx);
        let dir = at(ws.series.get(&member.dir_key), hour_idx);
        let (Some(speed), Some(dir)) = (speed, dir) else { continue };
        total_weight += w;
        let dr = dir * D2R;
        u += -speed * jm::sin(dr) * w;
        v += -speed * jm::cos(dr) * w;
    }
    if total_weight == 0.0 {
        return Wind { speed: 0.0, dir: 0.0 };
    }
    u /= total_weight;
    v /= total_weight;
    Wind {
        speed: jm::sqrt(u * u + v * v),
        dir: (jm::atan2(-u, -v) * R2D + 360.0) % 360.0,
    }
}

pub fn current_at(lat: f64, lon: f64, hour_idx: usize, marine_results: Option<&[MarineResult]>) -> Current {
    let Some(marine) = marine_results else {
        return Current { speed_kt: 0.0, dir_to_deg: 0.0 };
    };
    if marine.is_empty() {
        return Current { speed_kt: 0.0, dir_to_deg: 0.0 };
    }
    let p = LL { lat, lon };
    let mut u = 0.0;
    let mut v = 0.0;
    let mut total_weight = 0.0;
    for cr in marine {
        // JS: `if (!cr.data) continue` — the client sends data-less entries
        // with no velocity series.
        let (Some(vel), Some(dir)) = (cr.ocean_current_velocity.as_ref(), cr.ocean_current_direction.as_ref()) else {
            continue;
        };
        let d = fast_dist_nm(p, cr.sample);
        let m = jm::js_max(d, 1.0);
        let w = 1.0 / (m * m);
        // JS clamps by h.time.length but indexes the value arrays.
        let idx = std::cmp::min(hour_idx, cr.time_len.saturating_sub(1));
        let sp = vel.get(idx).copied().flatten();
        let dt = dir.get(idx).copied().flatten();
        let (Some(sp), Some(dt)) = (sp, dt) else { continue };
        total_weight += w;
        let dr = dt * D2R;
        u += sp * jm::sin(dr) * w;
        v += sp * jm::cos(dr) * w;
    }
    if total_weight == 0.0 {
        return Current { speed_kt: 0.0, dir_to_deg: 0.0 };
    }
    u /= total_weight;
    v /= total_weight;
    let kmh = jm::sqrt(u * u + v * v);
    Current {
        speed_kt: kmh * 0.539957,
        dir_to_deg: (jm::atan2(u, v) * R2D + 360.0) % 360.0,
    }
}
