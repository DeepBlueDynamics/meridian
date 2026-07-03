//! Route compute job API — async jobs over the Rust isochrone engine.
//!
//!   POST /route/compute        full RouteRequest (≤32MB) → {job_id} (409 if a job is active)
//!   GET  /route/status/{id}    {state, raster_rows_done/total, member_done/total}
//!   GET  /route/result/{id}    {routes, anchors, landmask_mode, timings_ms} | 404
//!   POST /route/cancel/{id}    flips the cancel flag (checked per time step)
//!
//! Job states mirror the client's progress pill phases. Typed errors
//! (landlocked_start/landlocked_dest) match routing.html's user-facing
//! messages. If the Natural Earth load fails, the job still routes in
//! boxes-only mode (anchors = raw endpoints, no polygon guard) — the same
//! fail-soft the JS engine has — and reports landmask_mode accordingly.
//! An unknown job id (e.g. after a sidecar restart) is a clean 404: the
//! client's fallback chain (cloud → sidecar → local JS) handles it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use meridian_sidecar::route::engine::route_fleet;
use meridian_sidecar::route::landmask::{prepare_corridor, CorridorError, LandGuard, LandMask};
use meridian_sidecar::route::types::RouteRequest;
pub type RouteRequestWire = RouteRequest;

#[derive(Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    LoadingLandmask,
    BuildingRaster,
    Routing,
    Done,
    Error,
    Cancelled,
}

pub struct Job {
    pub state: Mutex<JobState>,
    pub raster_rows_done: AtomicUsize,
    pub raster_rows_total: AtomicUsize,
    pub member_done: AtomicUsize,
    pub member_total: AtomicUsize,
    pub cancel: AtomicBool,
    pub result: Mutex<Option<serde_json::Value>>,
    pub error: Mutex<Option<(String, String)>>, // (code, message)
    pub created: Instant,
}

impl Job {
    fn new() -> Self {
        Self {
            state: Mutex::new(JobState::Queued),
            raster_rows_done: AtomicUsize::new(0),
            raster_rows_total: AtomicUsize::new(0),
            member_done: AtomicUsize::new(0),
            member_total: AtomicUsize::new(0),
            cancel: AtomicBool::new(false),
            result: Mutex::new(None),
            error: Mutex::new(None),
            created: Instant::now(),
        }
    }
    fn set_state(&self, s: JobState) {
        *self.state.lock().unwrap() = s;
    }
    fn is_live(&self) -> bool {
        matches!(*self.state.lock().unwrap(), JobState::Queued | JobState::LoadingLandmask | JobState::BuildingRaster | JobState::Routing)
    }
}

#[derive(Clone, Default)]
pub struct RouteJobs {
    inner: Arc<Mutex<HashMap<String, Arc<Job>>>>,
    seq: Arc<AtomicUsize>,
    // request-hash → finished result. Toggling motoring/currents flips one
    // request field; keeping recent variants makes the flip instant.
    cache: Arc<Mutex<Vec<(u64, serde_json::Value)>>>,
}

pub fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h = 0xcbf29ce484222325u64;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// The Natural Earth mask loads once and lives for the process.
static MASK: tokio::sync::OnceCell<Result<Arc<LandMask>, String>> = tokio::sync::OnceCell::const_new();

async fn mask() -> Result<Arc<LandMask>, String> {
    MASK.get_or_init(|| async { LandMask::load().await.map(Arc::new) })
        .await
        .clone()
}

impl RouteJobs {
    pub fn cached(&self, key: u64) -> Option<serde_json::Value> {
        self.cache.lock().unwrap().iter().rev().find(|(k, _)| *k == key).map(|(_, v)| v.clone())
    }
    fn store_cache(&self, key: u64, v: serde_json::Value) {
        let mut c = self.cache.lock().unwrap();
        c.retain(|(k, _)| *k != key);
        c.push((key, v));
        while c.len() > 8 {
            c.remove(0);
        }
    }
    fn new_id(&self) -> String {
        format!("rt_{}", self.seq.fetch_add(1, Ordering::Relaxed) + 1)
    }
    /// Register a job that is already Done (cache hit) — the client's normal
    /// poll loop resolves on its first status check.
    pub fn start_done(&self, result: serde_json::Value) -> String {
        let id = self.new_id();
        let job = Arc::new(Job::new());
        *job.result.lock().unwrap() = Some(result);
        job.set_state(JobState::Done);
        self.inner.lock().unwrap().insert(id.clone(), job);
        id
    }
    /// Start a job unless one is live. Err = the active job's id.
    pub fn try_start(&self, req: RouteRequest, cache_key: Option<u64>) -> Result<String, String> {
        {
            let map = self.inner.lock().unwrap();
            if let Some((id, _)) = map.iter().find(|(_, j)| j.is_live()) {
                return Err(id.clone());
            }
        }
        let id = self.new_id();
        let job = Arc::new(Job::new());
        {
            let mut map = self.inner.lock().unwrap();
            map.retain(|_, j| j.is_live() || j.created.elapsed().as_secs() < 1800); // GC old jobs
            map.insert(id.clone(), job.clone());
        }
        job.member_total.store(req.members.len(), Ordering::Relaxed);
        tokio::spawn(run_job(job, req, self.clone(), cache_key));
        Ok(id)
    }

    pub fn get(&self, id: &str) -> Option<Arc<Job>> {
        self.inner.lock().unwrap().get(id).cloned()
    }

    pub fn status_value(&self, id: &str) -> Option<serde_json::Value> {
        let job = self.get(id)?;
        let state = *job.state.lock().unwrap();
        let err = job.error.lock().unwrap().clone();
        Some(serde_json::json!({
            "state": state,
            "raster_rows_done": job.raster_rows_done.load(Ordering::Relaxed),
            "raster_rows_total": job.raster_rows_total.load(Ordering::Relaxed),
            "member_done": job.member_done.load(Ordering::Relaxed),
            "member_total": job.member_total.load(Ordering::Relaxed),
            "error": err.map(|(code, message)| serde_json::json!({"code": code, "message": message})),
        }))
    }

    pub fn result_value(&self, id: &str) -> Option<Option<serde_json::Value>> {
        let job = self.get(id)?;
        let v = {
            let guard = job.result.lock().unwrap();
            guard.clone()
        };
        Some(v)
    }
}

pub async fn post_compute(
    State(jobs): State<RouteJobs>,
    axum::extract::Query(q): axum::extract::Query<std::collections::HashMap<String, String>>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let req: RouteRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "bad_request", "message": e.to_string()})))
                .into_response()
        }
    };
    let key = fnv1a(&body);
    let force = q.get("force").map(|v| v == "1" || v == "true").unwrap_or(false);
    if !force {
        if let Some(hit) = jobs.cached(key) {
            let id = jobs.start_done(hit);
            return Json(serde_json::json!({"job_id": id, "cached": true})).into_response();
        }
    }
    match jobs.try_start(req, Some(key)) {
        Ok(id) => Json(serde_json::json!({"job_id": id})).into_response(),
        Err(active) => (StatusCode::CONFLICT, Json(serde_json::json!({"error": "job_active", "job_id": active})))
            .into_response(),
    }
}

async fn run_job(job: Arc<Job>, req: RouteRequest, jobs: RouteJobs, cache_key: Option<u64>) {
    let t0 = Instant::now();
    job.set_state(JobState::LoadingLandmask);
    let mask = match mask().await {
        Ok(m) => Some(m),
        Err(e) => {
            tracing::warn!("landmask unavailable — routing boxes-only: {e}");
            None
        }
    };
    let t_mask = t0.elapsed().as_millis() as u64;

    let job_in = job.clone();
    let out = tokio::task::spawn_blocking(move || compute(job_in, req, mask)).await;

    match out {
        Ok(Ok(mut v)) => {
            v["timings_ms"]["landmask"] = serde_json::json!(t_mask);
            if let Some(key) = cache_key {
                jobs.store_cache(key, v.clone());
            }
            *job.result.lock().unwrap() = Some(v);
            job.set_state(JobState::Done);
        }
        Ok(Err((code, message))) => {
            let cancelled = code == "cancelled";
            *job.error.lock().unwrap() = Some((code, message));
            job.set_state(if cancelled { JobState::Cancelled } else { JobState::Error });
        }
        Err(e) => {
            *job.error.lock().unwrap() = Some(("internal".into(), format!("compute task failed: {e}")));
            job.set_state(JobState::Error);
        }
    }
}

fn compute(job: Arc<Job>, req: RouteRequest, mask: Option<Arc<LandMask>>) -> Result<serde_json::Value, (String, String)> {
    let t1 = Instant::now();
    let mut landmask_mode = "boxes_only";
    let start;
    let dest;
    let corridor;
    match &mask {
        Some(m) => {
            job.set_state(JobState::BuildingRaster);
            // mirror of build_raster's row count so the progress % is honest
            let s = jsmax(-85.0, jsmin(req.raw_start.lat, req.raw_dest.lat) - 3.5);
            let n = jsmin(85.0, jsmax(req.raw_start.lat, req.raw_dest.lat) + 3.5);
            job.raster_rows_total.store(((n - s) / 0.02).ceil().max(1.0) as usize, Ordering::Relaxed);
            match prepare_corridor(m, req.raw_start, req.raw_dest, &job.raster_rows_done) {
                Ok(c) => {
                    landmask_mode = "full";
                    start = c.dep_anchor;
                    dest = c.arr_anchor;
                    corridor = Some(c);
                }
                Err(CorridorError::LandlockedStart) => {
                    return Err(("landlocked_start".to_string(),
                        "No sailable water within 60 nm of the departure — pick a coastal departure port.".to_string()));
                }
                Err(CorridorError::LandlockedDest) => {
                    return Err(("landlocked_dest".to_string(),
                        "No sailable water within 60 nm of the arrival — pick a coastal arrival port.".to_string()));
                }
            }
        }
        None => {
            start = req.raw_start;
            dest = req.raw_dest;
            corridor = None;
        }
    }
    let t_raster = t1.elapsed().as_millis() as u64;

    job.set_state(JobState::Routing);
    let t2 = Instant::now();
    let guard_holder = corridor.as_ref().map(|c| LandGuard { a1: c.dep_anchor, a2: c.arr_anchor, raster: &c.raster });
    let routes = route_fleet(&req, start, dest, guard_holder.as_ref(), &job.member_done, &job.cancel)
        .map_err(|e| ("cancelled".to_string(), e.0))?;
    let t_route = t2.elapsed().as_millis() as u64;

    Ok(serde_json::json!({
        "routes": routes,
        "anchors": { "dep": start, "arr": dest },
        "landmask_mode": landmask_mode,
        "timings_ms": { "landmask": 0, "raster": t_raster, "fleet": t_route },
    }))
}

pub async fn get_status(State(jobs): State<RouteJobs>, Path(id): Path<String>) -> impl IntoResponse {
    match jobs.status_value(&id) {
        Some(v) => Json(v).into_response(),
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "unknown_job"}))).into_response(),
    }
}

pub async fn get_result(State(jobs): State<RouteJobs>, Path(id): Path<String>) -> impl IntoResponse {
    match jobs.result_value(&id) {
        Some(Some(v)) => Json(v).into_response(),
        Some(None) => {
            let status = jobs.status_value(&id);
            (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no_result", "status": status}))).into_response()
        }
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "unknown_job"}))).into_response(),
    }
}

pub async fn post_cancel(State(jobs): State<RouteJobs>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(job) = jobs.get(&id) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "unknown_job"}))).into_response();
    };
    job.cancel.store(true, Ordering::Relaxed);
    Json(serde_json::json!({"ok": true})).into_response()
}

fn jsmin(a: f64, b: f64) -> f64 {
    if a < b { a } else { b }
}
fn jsmax(a: f64, b: f64) -> f64 {
    if a > b { a } else { b }
}
