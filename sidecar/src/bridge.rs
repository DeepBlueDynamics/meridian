//! WebSocket bus between the sidecar and Electron main.
//!
//! Electron is the CLIENT: it dials ws://127.0.0.1:9124/ws and reconnects
//! forever, so sidecar restarts are invisible to the app. The sidecar assigns
//! a sequence number to each command and parks a oneshot until the matching
//! `{type:"ToolResult", seq, result}` comes back. `result` is a JSON document
//! in a string — byte-compatible with the Hyperia reference plumbing this is
//! transposed from (hyperia sidecar/src/bridge.rs), minus all the PTY/session
//! machinery Meridian doesn't have: one window, one connection, no queues.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use tokio::sync::{mpsc, oneshot, Mutex};

/// What the sidecar knows about the app without a round trip — seeded by
/// `Hello`, kept fresh by `Heartbeat` and `ViewChanged`.
#[derive(Default, Clone, Debug, serde::Serialize)]
pub struct AppInfo {
    pub connected: bool,
    pub view: Option<String>,
    pub app_version: Option<String>,
}

struct BridgeInner {
    cmd_tx: Mutex<Option<mpsc::UnboundedSender<String>>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<String>>>,
    seq: AtomicU64,
    app: Mutex<AppInfo>,
}

#[derive(Clone)]
pub struct Bridge {
    inner: Arc<BridgeInner>,
}

impl Bridge {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(BridgeInner {
                cmd_tx: Mutex::new(None),
                pending: Mutex::new(HashMap::new()),
                seq: AtomicU64::new(1),
                app: Mutex::new(AppInfo::default()),
            }),
        }
    }

    pub async fn app_info(&self) -> AppInfo {
        self.inner.app.lock().await.clone()
    }

    /// Send a command to Electron and wait for its ToolResult. Per-command
    /// timeout (Eval against a busy Cesium scene needs more than the default).
    pub async fn send_command(
        &self,
        mut msg: serde_json::Value,
        timeout: Duration,
    ) -> Result<String, String> {
        let seq = self.inner.seq.fetch_add(1, Ordering::Relaxed);
        msg["seq"] = serde_json::json!(seq);

        let (tx, rx) = oneshot::channel();
        self.inner.pending.lock().await.insert(seq, tx);

        {
            let guard = self.inner.cmd_tx.lock().await;
            match guard.as_ref() {
                Some(sender) => {
                    if sender.send(msg.to_string()).is_err() {
                        self.inner.pending.lock().await.remove(&seq);
                        return Err("Meridian app disconnected".into());
                    }
                }
                None => {
                    self.inner.pending.lock().await.remove(&seq);
                    return Err("Meridian app not connected".into());
                }
            }
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(_)) => Err("Response channel dropped".into()),
            Err(_) => {
                self.inner.pending.lock().await.remove(&seq);
                Err("Timeout waiting for the app".into())
            }
        }
    }

    async fn handle_message(&self, text: &str) {
        let Ok(msg) = serde_json::from_str::<serde_json::Value>(text) else {
            tracing::warn!("bad message from app: {}", &text[..text.len().min(200)]);
            return;
        };
        match msg["type"].as_str() {
            Some("ToolResult") => {
                let Some(seq) = msg["seq"].as_u64() else { return };
                let result = msg["result"].as_str().unwrap_or("").to_string();
                if let Some(tx) = self.inner.pending.lock().await.remove(&seq) {
                    let _ = tx.send(result);
                }
            }
            Some("Hello") => {
                let mut app = self.inner.app.lock().await;
                app.connected = true;
                app.view = msg["view"].as_str().map(String::from);
                app.app_version = msg["appVersion"].as_str().map(String::from);
                tracing::info!(view = ?app.view, version = ?app.app_version, "app connected");
            }
            Some("Heartbeat") | Some("ViewChanged") => {
                let mut app = self.inner.app.lock().await;
                app.connected = true;
                if let Some(v) = msg["view"].as_str() {
                    app.view = Some(v.to_string());
                }
            }
            other => tracing::debug!(?other, "unhandled message type"),
        }
    }

    async fn on_connect(&self, cmd_tx: mpsc::UnboundedSender<String>) {
        *self.inner.cmd_tx.lock().await = Some(cmd_tx);
        self.inner.app.lock().await.connected = true;
    }

    async fn on_disconnect(&self) {
        *self.inner.cmd_tx.lock().await = None;
        self.inner.app.lock().await.connected = false;
        // Dropping the senders wakes every in-flight call with
        // "Response channel dropped" instead of letting them ride out
        // their full timeout.
        self.inner.pending.lock().await.clear();
        tracing::info!("app disconnected");
    }
}

#[derive(Clone)]
pub struct AppState {
    pub bridge: Bridge,
}

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state.bridge))
}

async fn handle_socket(socket: WebSocket, bridge: Bridge) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<String>();
    bridge.on_connect(cmd_tx).await;

    // Writer task: forwards queued commands to the WebSocket
    let writer = tokio::spawn(async move {
        while let Some(msg) = cmd_rx.recv().await {
            if ws_tx.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Reader loop: process incoming messages from Electron
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => bridge.handle_message(&text).await,
            Message::Close(_) => break,
            _ => {}
        }
    }

    writer.abort();
    bridge.on_disconnect().await;
}
