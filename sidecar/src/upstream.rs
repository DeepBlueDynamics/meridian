//! Fail-soft HTTP helpers for the sibling services: Meridian Radio (:9080)
//! and the skiff boat simulator (:8081). Offline upstreams are NORMAL on a
//! boat — helpers return Err(guidance) and the tools surface that as
//! success-with-text, never a JSON-RPC error.

use std::time::Duration;

pub const RADIO_BASE: &str = "http://127.0.0.1:9080";
pub const SKIFF_BASE: &str = "http://127.0.0.1:8081";

pub const RADIO_OFFLINE: &str = "Meridian Radio is offline — the RTL-SDR dongle is not detected or the \
     radio sidecar is not running. The Radio view's setup pane walks through \
     drivers. Don't retry-loop; check app_status.reachable.radio later.";

pub const SKIFF_OFFLINE: &str = "The skiff simulator is not reachable on :8081 — it may simply not be \
     running. Don't retry-loop; check app_status.reachable.sim later.";

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(8))
        .build()
        .unwrap_or_default()
}

pub async fn get_text(client: &reqwest::Client, url: &str, offline: &str) -> Result<String, String> {
    match client.get(url).send().await {
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            if status.is_success() {
                Ok(body)
            } else {
                Err(format!("upstream HTTP {status}: {}", &body[..body.len().min(300)]))
            }
        }
        Err(e) if e.is_connect() || e.is_timeout() => Err(offline.to_string()),
        Err(e) => Err(format!("upstream error: {e}")),
    }
}

pub async fn post_json(
    client: &reqwest::Client,
    url: &str,
    body: &serde_json::Value,
    offline: &str,
) -> Result<String, String> {
    match client.post(url).json(body).send().await {
        Ok(r) => {
            let status = r.status();
            let text = r.text().await.unwrap_or_default();
            if status.is_success() {
                Ok(text)
            } else {
                Err(format!("upstream HTTP {status}: {}", &text[..text.len().min(300)]))
            }
        }
        Err(e) if e.is_connect() || e.is_timeout() => Err(offline.to_string()),
        Err(e) => Err(format!("upstream error: {e}")),
    }
}

/// Quick liveness probe for app_status — short timeout, any HTTP answer counts.
pub async fn reachable(url: &str) -> bool {
    let c = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(800))
        .timeout(Duration::from_secs(2))
        .build();
    match c {
        Ok(c) => c.get(url).send().await.is_ok(),
        Err(_) => false,
    }
}
