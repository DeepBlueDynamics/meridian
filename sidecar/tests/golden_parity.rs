//! R-6 gate: golden parity — the Rust engine must reproduce the JS engine's
//! results BIT-EXACTLY on captured fixtures.
//!
//! A fixture (sidecar/tests/fixtures/*.json, gitignored, ~3MB each) is the
//! atomic dump of a live routing run from the app:
//!   window.m.dumpRouteFixture() → { request, anchors, landmask_mode, js_routes }
//! Regenerate: route in the app, then
//!   curl -X POST :9123/eval -d "return window.m.dumpRouteFixture()"
//!
//! The test replays the FULL pipeline: landmask load (network/disk cache) →
//! corridor raster → anchor snap (compared to the JS anchors, bit-exact) →
//! fleet routing → per-member, per-point bit comparison.
//!
//! Requires network or a warm landmask-cache next to the test binary on
//! first run; skips loudly if a fixture is absent.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize};

use meridian_sidecar::route::engine::route_fleet;
use meridian_sidecar::route::geo::LL;
use meridian_sidecar::route::landmask::{prepare_corridor, LandGuard, LandMask};
use meridian_sidecar::route::types::RouteRequest;

fn fixture(name: &str) -> Option<serde_json::Value> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name);
    match std::fs::read_to_string(&p) {
        Ok(s) => Some(serde_json::from_str(&s).expect("fixture parses")),
        Err(_) => {
            eprintln!("SKIP: fixture {} missing — capture via window.m.dumpRouteFixture()", p.display());
            None
        }
    }
}

fn bits(v: &serde_json::Value) -> u64 {
    v.as_f64().expect("number").to_bits()
}

fn assert_f64(rust: f64, js: &serde_json::Value, what: &str) {
    let j = js.as_f64().unwrap_or(f64::NAN);
    assert_eq!(
        rust.to_bits(),
        j.to_bits(),
        "{what}: rust {rust:?} ({:#x}) vs js {j:?} ({:#x})",
        rust.to_bits(),
        j.to_bits()
    );
}

fn run_fixture(name: &str) {
    let Some(fx) = fixture(name) else { return };
    let req: RouteRequest = serde_json::from_value(fx["request"].clone()).expect("request deserializes");
    assert_eq!(fx["landmask_mode"].as_str(), Some("full"), "fixture must be full-landmask mode");

    let rt = tokio::runtime::Runtime::new().unwrap();
    let mask = rt.block_on(LandMask::load()).expect("landmask loads (network or cache)");

    let progress = AtomicUsize::new(0);
    let corridor = prepare_corridor(&mask, req.raw_start, req.raw_dest, &progress)
        .unwrap_or_else(|_| panic!("corridor prep failed (landlocked?)"));

    // Anchor snap must reproduce the JS anchors bit-exactly.
    assert_f64(corridor.dep_anchor.lat, &fx["anchors"]["dep"]["lat"], "depAnchor.lat");
    assert_f64(corridor.dep_anchor.lon, &fx["anchors"]["dep"]["lon"], "depAnchor.lon");
    assert_f64(corridor.arr_anchor.lat, &fx["anchors"]["arr"]["lat"], "arrAnchor.lat");
    assert_f64(corridor.arr_anchor.lon, &fx["anchors"]["arr"]["lon"], "arrAnchor.lon");

    let guard = LandGuard { a1: corridor.dep_anchor, a2: corridor.arr_anchor, raster: &corridor.raster };
    let cancel = AtomicBool::new(false);
    let done = AtomicUsize::new(0);
    let start = LL { lat: corridor.dep_anchor.lat, lon: corridor.dep_anchor.lon };
    let dest = LL { lat: corridor.arr_anchor.lat, lon: corridor.arr_anchor.lon };
    let t0 = std::time::Instant::now();
    let routes = route_fleet(&req, start, dest, Some(&guard), &done, &cancel).map_err(|e| e.0).expect("fleet routes");
    eprintln!("{name}: {} members routed in {:?}", routes.len(), t0.elapsed());

    let js_routes = fx["js_routes"].as_array().expect("js_routes");
    assert_eq!(routes.len(), js_routes.len(), "member count");
    let mut mismatched_members: Vec<String> = Vec::new();
    for (r, j) in routes.iter().zip(js_routes) {
        let member = &r.member;
        let ok = (|| -> Result<(), String> {
            if Some(r.member.as_str()) != j["member"].as_str() {
                return Err(format!("member id {} vs {:?}", r.member, j["member"]));
            }
            if r.arrived != j["arrived"].as_bool().unwrap_or(false) {
                return Err(format!("arrived {} vs {}", r.arrived, j["arrived"]));
            }
            match (r.eta_hours, j["etaHours"].as_f64()) {
                (None, None) => {}
                (Some(a), Some(b)) if a.to_bits() == b.to_bits() => {}
                (a, b) => return Err(format!("etaHours {a:?} vs {b:?}")),
            }
            let jp = j["path"].as_array().ok_or("js path missing")?;
            if r.path.len() != jp.len() {
                return Err(format!("path len {} vs {}", r.path.len(), jp.len()));
            }
            for (i, (p, q)) in r.path.iter().zip(jp).enumerate() {
                for (rv, jv, f) in [
                    (p.lat, &q["lat"], "lat"),
                    (p.lon, &q["lon"], "lon"),
                    (p.time, &q["time"], "time"),
                    (p.bsp, &q["bsp"], "bsp"),
                    (p.tws, &q["tws"], "tws"),
                    (p.twa, &q["twa"], "twa"),
                    (p.heading, &q["heading"], "heading"),
                    (p.curr_kt, &q["curr_kt"], "curr_kt"),
                ] {
                    if rv.to_bits() != bits(jv) {
                        return Err(format!("point[{i}].{f}: {rv:?} vs {:?}", jv.as_f64()));
                    }
                }
                if p.motor != q["motor"].as_bool().unwrap_or(false) {
                    return Err(format!("point[{i}].motor"));
                }
            }
            for (rv, jv, f) in [
                (r.max_tws, &j["maxTws"], "maxTws"),
                (r.avg_tws, &j["avgTws"], "avgTws"),
                (r.max_favorable_current, &j["maxFavorableCurrent"], "maxFavorableCurrent"),
                (r.max_adverse_current, &j["maxAdverseCurrent"], "maxAdverseCurrent"),
                (r.engine_hours, &j["engineHours"], "engineHours"),
                (r.pct_motor, &j["pctMotor"], "pctMotor"),
                (r.final_distance, &j["finalDistance"], "finalDistance"),
            ] {
                if rv.to_bits() != bits(jv) {
                    return Err(format!("{f}: {rv:?} vs {:?}", jv.as_f64()));
                }
            }
            Ok(())
        })();
        if let Err(e) = ok {
            eprintln!("MISMATCH member {member}: {e}");
            mismatched_members.push(member.clone());
        }
    }
    assert!(
        mismatched_members.is_empty(),
        "{name}: {}/{} members diverged: {:?}",
        mismatched_members.len(),
        routes.len(),
        mismatched_members
    );
}

#[test]
fn golden_hawaii_cabo() {
    run_fixture("hawaii-cabo.json");
}

#[test]
fn golden_newport_bermuda() {
    run_fixture("newport-bermuda.json");
}
