//! meridian-sidecar library surface — the route engine lives here so
//! integration tests (math parity, golden fixtures) can exercise the exact
//! code the binary ships. The server plumbing (bridge/mcp/upstream) stays in
//! main.rs; the bin depends on this lib for `route`.

pub mod route;
