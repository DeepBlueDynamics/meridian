//! meridian-sidecar — Meridian's agent surface.
//!
//! One loopback HTTP server:
//!   /mcp     MCP over streamable HTTP (stateless) — the agent-facing surface
//!   /ws      WebSocket bus the Electron app dials into (electron/bridge.js)
//!   /health  liveness
//!
//! Split of responsibilities (see spec/plan): :9123 stays the app's own
//! plumbing (charts, auth-callback, telemetry ingest, curl-friendly dev
//! REST); :9124 (this) is the agent surface.

mod bridge;
mod mcp;
mod upstream;

use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "meridian-sidecar", version, about = "Meridian agent surface (MCP)")]
struct Args {
    /// HTTP port for /mcp, /ws, /health
    #[arg(long, default_value_t = 9124, env = "MERIDIAN_SIDECAR_PORT")]
    port: u16,
    /// Bind address. Loopback by default — the agent surface is local-only
    /// in v1 (no identity/consent yet); widening this widens who can drive
    /// the helm.
    #[arg(long, default_value = "127.0.0.1", env = "MERIDIAN_SIDECAR_BIND")]
    bind: std::net::IpAddr,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args = Args::parse();
    let b = bridge::Bridge::new();
    let state = bridge::AppState { bridge: b.clone() };

    let app = axum::Router::new()
        .route("/health", axum::routing::get(|| async { "ok" }))
        .route("/ws", axum::routing::get(bridge::ws_handler))
        .with_state(state)
        .nest_service("/mcp", mcp::streamable_http_service(b));

    let addr = std::net::SocketAddr::new(args.bind, args.port);
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            // Another sidecar owns the port — exit clean so any supervisor
            // (run.ps1 retry, future Electron spawn) never restart-spins.
            tracing::warn!("port {addr} in use — another meridian-sidecar is running; exiting");
            return Ok(());
        }
        Err(e) => return Err(e.into()),
    };
    tracing::info!("meridian-sidecar http://{addr}  (/mcp /ws /health)");
    axum::serve(listener, app).await?;
    Ok(())
}
