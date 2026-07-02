//! Meridian MCP server — the agent surface (spec-radio/spec-service lineage;
//! architecture transposed from the Hyperia sidecar).
//!
//! Conventions (Hyperia's, kept deliberately):
//! - App-level failures return `CallToolResult::success` with actionable
//!   guidance TEXT — the agent reads what happened and adapts. JSON-RPC
//!   errors (`ErrorData`) are reserved for infrastructure failures.
//! - Radio/skiff offline is ALWAYS success-with-guidance: offline upstreams
//!   are normal on a boat.
//! - Identity hook: the caller's Authorization header is reachable via
//!   RequestContext extensions (see hyperia mcp.rs `forwarded_auth`) —
//!   unused in v1 (loopback-only), preserved by design for later gating.

use std::time::Duration;

use rmcp::{
    ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::*,
    schemars, tool, tool_handler, tool_router,
};

use crate::bridge::Bridge;
use crate::upstream;

// -- Tool request schemas --

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ScreenshotRequest {
    /// Which canvas: "main" (default), or "dep"/"arr" (the routing view's port miniviews).
    pub view: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct EvalRequest {
    /// JavaScript to run in the current view. It is wrapped in an async IIFE — use `return` for the value (must be JSON-serializable). Page top-level consts are NOT visible; use the window.m hooks (see server instructions).
    pub code: String,
    /// Max wait in ms (default 30000). A navigation mid-eval can hang the call — on timeout, check app_status and retry.
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ViewName {
    Setup,
    Routing,
    Layers,
    Harbor,
    Radio,
}

impl ViewName {
    fn as_str(&self) -> &'static str {
        match self {
            ViewName::Setup => "setup",
            ViewName::Routing => "routing",
            ViewName::Layers => "layers",
            ViewName::Harbor => "harbor",
            ViewName::Radio => "radio",
        }
    }
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct NavigateRequest {
    /// Target view.
    pub view: ViewName,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct WindowResizeRequest {
    /// Named content size — overrides width/height. One of: 720p, 1080p, 1440p, 4k, square, vertical.
    pub preset: Option<String>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    /// Window position (pass both x and y).
    pub x: Option<f64>,
    pub y: Option<f64>,
    /// Center on the current display after resizing.
    pub center: Option<bool>,
    /// Size the whole window incl. titlebar instead of the content area.
    pub outer: Option<bool>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TelemetryTailRequest {
    /// Number of trailing lines (default 20, max 200).
    pub lines: Option<usize>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RadioTuneRequest {
    /// Marine VHF channel number (e.g. 16, 72). Pass exactly one of channel | frequency_hz.
    pub channel: Option<u32>,
    /// Raw frequency in Hz (e.g. 156625000).
    pub frequency_hz: Option<u64>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RadioListenRequest {
    /// true = monitor audio on, false = mute.
    pub listen: bool,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RadioRecordingRequest {
    /// true = record transmissions (and transcribe them), false = off.
    pub recording: bool,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RadioSquelchRequest {
    /// Squelch margin in dB above the noise floor (typical 8-15).
    pub squelch: f64,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RadioTranscriptionsRequest {
    /// Max entries, newest last (default 20).
    pub limit: Option<usize>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SimCallRequest {
    /// skiff API path: "/healthz" or "/v1/sim/{state|control|environment|position|reset}".
    pub path: String,
    /// "GET" (default for /healthz and /v1/sim/state) or "POST".
    pub method: Option<String>,
    /// JSON body for POSTs — passed through verbatim.
    pub body: Option<serde_json::Value>,
}

// -- helpers --

fn text_ok(s: impl Into<String>) -> CallToolResult {
    CallToolResult::success(vec![Content::text(s.into())])
}

/// Bridge errors → guidance text (never a JSON-RPC error).
fn bridge_guidance(err: &str) -> String {
    format!(
        "{err}. The Meridian app bridges into this sidecar over ws://127.0.0.1:{{port}}/ws \
         and reconnects automatically — if it's running, retry in a couple of seconds; \
         if not, start it (scripts/run.ps1)."
    )
}

/// Locate telemetry.log: cwd, repo root above cwd, or above the exe
/// (sidecar/target/release/). First hit wins.
fn telemetry_path() -> Option<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = vec![
        "telemetry.log".into(),
        "../telemetry.log".into(),
        "../../telemetry.log".into(),
    ];
    if let Ok(exe) = std::env::current_exe() {
        candidates.push(exe.join("../../../../telemetry.log"));
    }
    candidates.into_iter().find(|p| p.exists())
}

// -- MCP server --

#[derive(Clone)]
pub struct MeridianMcp {
    tool_router: ToolRouter<Self>,
    bridge: Bridge,
    client: reqwest::Client,
}

#[tool_router]
impl MeridianMcp {
    pub fn new(bridge: Bridge) -> Self {
        Self {
            tool_router: Self::tool_router(),
            bridge,
            client: upstream::client(),
        }
    }

    async fn bridge_call(&self, msg: serde_json::Value, timeout: Duration) -> Result<serde_json::Value, String> {
        let raw = self.bridge.send_command(msg, timeout).await?;
        serde_json::from_str(&raw).map_err(|e| format!("bad app reply: {e}"))
    }

    // ── app control ──────────────────────────────────────────────────────

    #[tool(description = "Orientation tool — call this first. Current view, window bounds, app connection state, and whether the radio (:9080) and skiff simulator (:8081) are reachable.")]
    async fn app_status(&self, _p: Parameters<serde_json::Map<String, serde_json::Value>>) -> Result<CallToolResult, ErrorData> {
        let info = self.bridge.app_info().await;
        let detail = if info.connected {
            self.bridge_call(serde_json::json!({"type": "AppStatus"}), Duration::from_secs(10))
                .await
                .unwrap_or_else(|e| serde_json::json!({"ok": false, "error": e}))
        } else {
            serde_json::json!({"ok": false, "error": "app not connected to the sidecar bridge"})
        };
        let radio_url = format!("{}/api/status", upstream::RADIO_BASE);
        let sim_url = format!("{}/healthz", upstream::SKIFF_BASE);
        let (radio, sim) = tokio::join!(upstream::reachable(&radio_url), upstream::reachable(&sim_url));
        let out = serde_json::json!({
            "sidecar": env!("CARGO_PKG_VERSION"),
            "app": { "connected": info.connected, "view": info.view, "version": info.app_version, "detail": detail },
            "reachable": { "radio": radio, "sim": sim },
        });
        Ok(text_ok(out.to_string()))
    }

    #[tool(description = "Screenshot the Meridian app (PNG). Canvas-primary capture works even when the window is occluded. view: main (default) | dep | arr.")]
    async fn app_screenshot(&self, Parameters(req): Parameters<ScreenshotRequest>) -> Result<CallToolResult, ErrorData> {
        let view = req.view.unwrap_or_else(|| "main".into());
        let msg = serde_json::json!({"type": "Screenshot", "view": view});
        match self.bridge_call(msg, Duration::from_secs(15)).await {
            Ok(v) if v["ok"].as_bool() == Some(true) => {
                let data_url = v["dataUrl"].as_str().unwrap_or("");
                match data_url.split_once("base64,") {
                    Some((_, b64)) if !b64.is_empty() => Ok(CallToolResult::success(vec![
                        Content::image(b64.to_string(), "image/png"),
                        Content::text(format!("view: {view}")),
                    ])),
                    _ => Ok(text_ok("capture produced no image data — the window may be mid-boot; retry after app_status shows a view")),
                }
            }
            Ok(v) => Ok(text_ok(format!("capture failed: {}", v["error"].as_str().unwrap_or("unknown")))),
            Err(e) => Ok(text_ok(bridge_guidance(&e))),
        }
    }

    #[tool(description = "Run JavaScript in the current Meridian view (the dev power tool). Wrapped in an async IIFE — use `return` for a JSON-serializable value. Page top-level consts are invisible; drive the app through the per-view window.m hooks listed in the server instructions.")]
    async fn app_eval(&self, Parameters(req): Parameters<EvalRequest>) -> Result<CallToolResult, ErrorData> {
        let timeout = Duration::from_millis(req.timeout_ms.unwrap_or(30_000).min(60_000));
        let msg = serde_json::json!({"type": "Eval", "code": req.code});
        match self.bridge_call(msg, timeout).await {
            Ok(v) if v["ok"].as_bool() == Some(true) => Ok(text_ok(v["result"].to_string())),
            Ok(v) => Ok(text_ok(format!("eval error: {}", v["error"].as_str().unwrap_or("unknown")))),
            Err(e) if e.starts_with("Timeout") => Ok(text_ok(
                "eval timed out — the page may have been navigating (executeJavaScript never rejects on navigation). Check app_status, then retry.",
            )),
            Err(e) => Ok(text_ok(bridge_guidance(&e))),
        }
    }

    #[tool(description = "Switch the app to a view: setup | routing | layers | harbor | radio. Returns after the page finishes loading, so a follow-up app_eval is safe immediately.")]
    async fn app_navigate(&self, Parameters(req): Parameters<NavigateRequest>) -> Result<CallToolResult, ErrorData> {
        let msg = serde_json::json!({"type": "Navigate", "view": req.view.as_str()});
        match self.bridge_call(msg, Duration::from_secs(30)).await {
            Ok(v) if v["ok"].as_bool() == Some(true) => Ok(text_ok(format!("now on {}", req.view.as_str()))),
            Ok(v) => Ok(text_ok(format!("navigate failed: {}", v["error"].as_str().unwrap_or("unknown")))),
            Err(e) => Ok(text_ok(bridge_guidance(&e))),
        }
    }

    #[tool(description = "Reload the current view (picks up edited HTML/JS from disk).")]
    async fn app_reload(&self, _p: Parameters<serde_json::Map<String, serde_json::Value>>) -> Result<CallToolResult, ErrorData> {
        match self.bridge_call(serde_json::json!({"type": "Reload"}), Duration::from_secs(10)).await {
            Ok(_) => Ok(text_ok("reloading")),
            Err(e) => Ok(text_ok(bridge_guidance(&e))),
        }
    }

    #[tool(description = "Resize (and optionally move) the Meridian app window. Sizes the CONTENT area by default so screen recordings capture exact pixel dimensions. Pass a preset or explicit width/height. Returns the resulting bounds.")]
    async fn window_resize(&self, Parameters(req): Parameters<WindowResizeRequest>) -> Result<CallToolResult, ErrorData> {
        let msg = serde_json::json!({
            "type": "WindowResize",
            "preset": req.preset, "width": req.width, "height": req.height,
            "x": req.x, "y": req.y, "center": req.center, "outer": req.outer,
        });
        match self.bridge_call(msg, Duration::from_secs(10)).await {
            Ok(v) => Ok(text_ok(v.to_string())),
            Err(e) => Ok(text_ok(bridge_guidance(&e))),
        }
    }

    #[tool(description = "Current Meridian window bounds, content size, and display info (work area, scale factor) — check before/after a recording resize.")]
    async fn window_bounds(&self, _p: Parameters<serde_json::Map<String, serde_json::Value>>) -> Result<CallToolResult, ErrorData> {
        match self.bridge_call(serde_json::json!({"type": "WindowBounds"}), Duration::from_secs(10)).await {
            Ok(v) => Ok(text_ok(v.to_string())),
            Err(e) => Ok(text_ok(bridge_guidance(&e))),
        }
    }

    #[tool(description = "Tail meridian/telemetry.log (JSON-lines: renderer errors, unhandled rejections, custom events). The first place to look when a view misbehaves.")]
    async fn telemetry_tail(&self, Parameters(req): Parameters<TelemetryTailRequest>) -> Result<CallToolResult, ErrorData> {
        let n = req.lines.unwrap_or(20).min(200);
        let Some(path) = telemetry_path() else {
            return Ok(text_ok("telemetry.log not found — no telemetry has been written yet, or the sidecar isn't running near the repo root"));
        };
        match std::fs::read_to_string(&path) {
            Ok(s) => {
                let lines: Vec<&str> = s.lines().collect();
                let tail = lines[lines.len().saturating_sub(n)..].join("\n");
                Ok(text_ok(if tail.is_empty() { "telemetry.log is empty".into() } else { tail }))
            }
            Err(e) => Ok(text_ok(format!("could not read {}: {e}", path.display()))),
        }
    }

    // ── Meridian Radio proxies (:9080 — wire contract frozen) ────────────

    #[tool(description = "Meridian Radio status: tuned channel/frequency, signal dB, noise floor, squelch state, listen/recording flags.")]
    async fn radio_status(&self, _p: Parameters<serde_json::Map<String, serde_json::Value>>) -> Result<CallToolResult, ErrorData> {
        let url = format!("{}/api/status", upstream::RADIO_BASE);
        match upstream::get_text(&self.client, &url, upstream::RADIO_OFFLINE).await {
            Ok(body) => Ok(text_ok(body)),
            Err(e) => Ok(text_ok(e)),
        }
    }

    #[tool(description = "Tune the radio monitor. Pass exactly one of: channel (marine VHF number, e.g. 72) or frequency_hz.")]
    async fn radio_tune(&self, Parameters(req): Parameters<RadioTuneRequest>) -> Result<CallToolResult, ErrorData> {
        let body = match (req.channel, req.frequency_hz) {
            (Some(ch), None) => serde_json::json!({"channel": ch}),
            (None, Some(hz)) => serde_json::json!({"frequency_hz": hz}),
            _ => return Ok(text_ok("pass exactly one of channel | frequency_hz")),
        };
        let url = format!("{}/channel", upstream::RADIO_BASE);
        match upstream::post_json(&self.client, &url, &body, upstream::RADIO_OFFLINE).await {
            Ok(b) => Ok(text_ok(b)),
            Err(e) => Ok(text_ok(e)),
        }
    }

    #[tool(description = "Toggle radio audio monitoring (listen) on/off.")]
    async fn radio_listen(&self, Parameters(req): Parameters<RadioListenRequest>) -> Result<CallToolResult, ErrorData> {
        let url = format!("{}/listen", upstream::RADIO_BASE);
        match upstream::post_json(&self.client, &url, &serde_json::json!({"listen": req.listen}), upstream::RADIO_OFFLINE).await {
            Ok(b) => Ok(text_ok(b)),
            Err(e) => Ok(text_ok(e)),
        }
    }

    #[tool(description = "Toggle recording (+transcription) of transmissions on/off.")]
    async fn radio_recording(&self, Parameters(req): Parameters<RadioRecordingRequest>) -> Result<CallToolResult, ErrorData> {
        let url = format!("{}/recording", upstream::RADIO_BASE);
        match upstream::post_json(&self.client, &url, &serde_json::json!({"recording": req.recording}), upstream::RADIO_OFFLINE).await {
            Ok(b) => Ok(text_ok(b)),
            Err(e) => Ok(text_ok(e)),
        }
    }

    #[tool(description = "Set the squelch margin in dB above the noise floor (typical 8-15; lower = more sensitive, more false opens).")]
    async fn radio_squelch(&self, Parameters(req): Parameters<RadioSquelchRequest>) -> Result<CallToolResult, ErrorData> {
        let url = format!("{}/squelch", upstream::RADIO_BASE);
        match upstream::post_json(&self.client, &url, &serde_json::json!({"squelch": req.squelch}), upstream::RADIO_OFFLINE).await {
            Ok(b) => Ok(text_ok(b)),
            Err(e) => Ok(text_ok(e)),
        }
    }

    #[tool(description = "Recent VHF transcriptions (whisper output per recorded transmission), newest last.")]
    async fn radio_transcriptions(&self, Parameters(req): Parameters<RadioTranscriptionsRequest>) -> Result<CallToolResult, ErrorData> {
        let url = format!("{}/api/transcriptions", upstream::RADIO_BASE);
        match upstream::get_text(&self.client, &url, upstream::RADIO_OFFLINE).await {
            Ok(body) => {
                let limit = req.limit.unwrap_or(20);
                // Server returns a JSON array (last ~50); trim client-side.
                match serde_json::from_str::<serde_json::Value>(&body) {
                    Ok(serde_json::Value::Array(mut items)) => {
                        let skip = items.len().saturating_sub(limit);
                        items.drain(..skip);
                        Ok(text_ok(serde_json::Value::Array(items).to_string()))
                    }
                    _ => Ok(text_ok(body)),
                }
            }
            Err(e) => Ok(text_ok(e)),
        }
    }

    // ── skiff simulator passthrough (:8081 — young contract) ─────────────

    #[tool(description = "Call the skiff boat-simulator API (GET /healthz, GET /v1/sim/state, POST /v1/sim/control|environment|position|reset). Payload shapes follow skiff and may change; this tool envelope will not. The sim feeds Signal K — Meridian sees the boat through its Signal K connection, not through this tool.")]
    async fn sim_call(&self, Parameters(req): Parameters<SimCallRequest>) -> Result<CallToolResult, ErrorData> {
        let path = req.path.trim();
        if path != "/healthz" && !path.starts_with("/v1/sim/") {
            return Ok(text_ok("path must be /healthz or /v1/sim/* — this tool only speaks to the simulator"));
        }
        let url = format!("{}{}", upstream::SKIFF_BASE, path);
        let method = req.method.as_deref().unwrap_or(if req.body.is_some() { "POST" } else { "GET" });
        let out = match method.to_ascii_uppercase().as_str() {
            "GET" => upstream::get_text(&self.client, &url, upstream::SKIFF_OFFLINE).await,
            "POST" => {
                let body = req.body.unwrap_or(serde_json::json!({}));
                upstream::post_json(&self.client, &url, &body, upstream::SKIFF_OFFLINE).await
            }
            m => Err(format!("unsupported method {m} — GET or POST")),
        };
        match out {
            Ok(b) => Ok(text_ok(if b.is_empty() { "ok".into() } else { b })),
            Err(e) => Ok(text_ok(e)),
        }
    }
}

// -- ServerHandler impl --

#[tool_handler]
impl ServerHandler for MeridianMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some(
                "Meridian MCP server — controls a running Meridian marine navigation app \
                 (Electron; views are separate file:// pages: setup, routing, layers, harbor, radio). \
                 \n\nSTART WITH app_status — it tells you the current view, whether the app bridge is \
                 up, and whether the radio and simulator are reachable. \
                 \n\napp_eval is the power tool. Page top-level consts are NOT visible to eval; every \
                 view exposes control hooks on window.m instead: \
                 routing → m.setPort(kind,q), m.routes, m.env, m.scrubTo(h), m.play(), m.pause(), \
                 m.state(), m.flyMain(lon,lat,h) · layers → m.map, m.flyTo(lon,lat,zoom), m.state() \
                 · radio → m.state(). Use `return` for values; results must be JSON-serializable. \
                 \n\nApp-level failures come back as TEXT results — read them, they say what to do \
                 next. The radio (:9080) and skiff simulator (:8081) may legitimately be offline (no \
                 dongle at the helm, sim not started): those tools tell you so — don't retry-loop. \
                 \n\napp_navigate waits for the page load, so an immediate follow-up app_eval is safe. \
                 Screenshots capture the WebGL canvas directly and work while occluded."
                    .to_string(),
            ),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

/// Stateless streamable-HTTP MCP service. `stateful_mode: false` is load-
/// bearing: the default (true) keeps a per-client session table, so every
/// sidecar restart 404s connected agents until they manually reconnect.
/// All tools here are one-shot request/response — stateless is correct.
/// (Hyperia learned this live; see its mcp.rs for the war story.)
pub fn streamable_http_service(
    bridge: Bridge,
) -> rmcp::transport::streamable_http_server::StreamableHttpService<MeridianMcp> {
    use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
    StreamableHttpService::new(
        move || Ok(MeridianMcp::new(bridge.clone())),
        Default::default(),
        StreamableHttpServerConfig {
            stateful_mode: false,
            ..Default::default()
        },
    )
}
