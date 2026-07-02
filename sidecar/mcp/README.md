# Meridian MCP — reference configuration for consuming agents

The `meridian-sidecar` serves Meridian's agent surface as MCP over
**streamable HTTP** at `http://127.0.0.1:9124/mcp` (loopback-only, no auth in
v1, **stateless** — sidecar restarts are invisible to clients). Start it with
`scripts/run.ps1` from the meridian repo, or run
`sidecar/target/release/meridian-sidecar.exe` directly.

## 1. Native HTTP clients (Claude Code, anything speaking streamable HTTP)

```json
{
  "mcpServers": {
    "meridian": {
      "type": "http",
      "url": "http://127.0.0.1:9124/mcp"
    }
  }
}
```

From inside a Docker container (nemesis8 agents), use the host gateway:

```json
{
  "mcpServers": {
    "meridian": {
      "type": "http",
      "url": "http://host.docker.internal:9124/mcp"
    }
  }
}
```

## 2. stdio-only clients — the dynamic shim

`meridian-mcp.py` (this directory) is a stdio→streamable-HTTP proxy in the
same pattern as nemesis8's `MCP/hyperia-mcp.py`: it forwards `tools/list` and
`tools/call` to the live sidecar, so the tool set never rots and the file
never needs editing. Degrade-don't-die: if the sidecar is down it serves an
empty tool list instead of failing the agent's MCP startup.

```json
{
  "mcpServers": {
    "meridian": {
      "command": "python3",
      "args": ["MCP/meridian-mcp.py"],
      "env": { "MERIDIAN_URL": "http://host.docker.internal:9124" }
    }
  }
}
```

Requires the `mcp` Python package (already in the nemesis8 image for the
hyperia shim).

## 3. Tool surface (v1 — 15 tools; authoritative list is always `tools/list`)

| tool | what it does |
|---|---|
| `app_status` | **Call first.** Current view, window bounds, bridge state, radio/sim reachability. |
| `app_screenshot` | PNG of the app as MCP image content (canvas-primary; works occluded). `view: main\|dep\|arr`. |
| `app_eval` | Run JS in the current view (async IIFE, `return` a JSON value). Drive pages via `window.m` hooks — see server instructions. |
| `app_navigate` | Switch view: `setup\|routing\|layers\|harbor\|radio`. Returns after page load. |
| `app_reload` | Reload the current view. |
| `window_resize` | Presets `720p/1080p/1440p/4k/square/vertical` or explicit size; content-area by default (exact recording dimensions). |
| `window_bounds` | Bounds + content size + display info. |
| `telemetry_tail` | Tail the app's telemetry.log (renderer errors etc.). |
| `radio_status` / `radio_tune` / `radio_listen` / `radio_recording` / `radio_squelch` / `radio_transcriptions` | Meridian Radio control (VHF monitor on :9080). |
| `sim_call` | Generic passthrough to the skiff boat simulator (`/healthz`, `/v1/sim/*`). Payload shapes follow skiff; the envelope is stable. |

## 4. Conventions consuming agents must know

- **App-level failures are TEXT results, not JSON-RPC errors.** Read them —
  they say what to do next.
- **Radio and simulator may legitimately be offline** (no RTL-SDR dongle,
  sim not started). Those tools say so; don't retry-loop. Check
  `app_status.reachable` instead.
- `app_navigate` waits for the page load — an immediate follow-up `app_eval`
  is safe.
- The sidecar is stateless: reconnect/retry logic is unnecessary beyond a
  normal HTTP retry.

## 5. Ports at a glance

| port | owner |
|---|---|
| 9124 | **meridian-sidecar — this MCP server** (`/mcp`, `/ws`, `/health`) |
| 9123 | Meridian app plumbing (charts, auth callback, telemetry, dev REST) |
| 9080/9081 | Meridian Radio control / audio stream |
| 8081 | skiff simulator REST |
