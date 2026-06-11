# spec-extension-model.md

_Revised: 2026-06-11 (UTC)_

**Component:** Extension model — emulating the OpenCPN plugin ecosystem
**Status:** Designed in conversation. Not built.
**License posture:** Apache-2.0. Functionality of OpenCPN plugins is reproduced from observed behavior/docs (clean — see `opencpn-functional-analysis-prompt.md`); no plugin source is read or hosted. Meridian never loads OpenCPN's GPL `.so`/`.dll` binaries.

---

## 1. Objective

Reproduce the *capabilities* of the OpenCPN plugin catalog while inverting the integration model: OpenCPN makes the sailor wire plugins together; Meridian makes the copilot do it. High-value capabilities ship native; the long tail uses a modern extension surface (MCP servers + web-component panels), not a C++ ABI.

## 2. Three tiers

- **Native modules** (no install, unified UX): GRIB/weather, instruments/dashboard, AIS + CPA/TCPA + alarms, tides & currents, anchor/guard watchdog, logbook/VDR, polars/tactics, chart downloader (= ingestion pipeline). These are React/deck.gl/Signal K features, not plugins.
- **MCP extensions** (the long tail): a Meridian "plugin" is an MCP server exposing tools + data resources; the copilot discovers and wires it in.
- **Partnership/hardware tier**: radar (see `spec-radar.md`), encrypted charts (S-63), some proprietary sensors.

## 3. Plugin → module map

| OpenCPN plugin | Function | Meridian tier | Stack target | Effort |
|---|---|---|---|---|
| grib_pi | GRIB weather | Native | deck.gl over MapLibre | Low |
| dashboard_pi / engine | Instruments | Native | React ← Signal K | Low |
| AIS / radar overlay | Targets | Native (AIS) / Partnership (radar) | deck.gl ← Signal K / Mayara | Med / Hard |
| weather_routing_pi | Routing | Native (clean-room) | Rust→WASM (spec-routing) | Hard |
| wmm_pi | Magnetic variation | Native | WASM (public NOAA WMM) | Trivial |
| watchdog_pi | Alarms/anchor watch | Native | rules engine ← Signal K | Low–Med |
| tides | Tides/currents | Native | harmonic calc (public constituents) | Med |
| chartdldr_pi | Chart download | Native | = ingestion pipeline | Done-ish |
| vdr_pi / logbook | Recording | Native | Signal K log → Lume index | Low |
| tactics_pi / polar | Performance | Native | existing polar sandbox | Low |
| weatherfax / celestial | Niche | MCP extension | long tail | — |
| (3rd-party sensors) | Various | MCP extension | MCP server | — |
| radar_pi | Radar | Partnership | Mayara (spec-radar) | Hard |
| oesenc/o-charts | Encrypted charts | Partnership | S-63 licensing | Hard |

## 4. Extension contract (the MCP "plugin")

A Meridian extension is:

1. **An MCP server** exposing:
   - *Tools* the copilot may call (named `<vendor>.<capability>`), with JSON schemas.
   - *Resources* (read-only data) and optional Signal K namespace contributions under `<vendor>.*`.
2. **Optional UI** — a sandboxed web component (custom element) that receives props from Signal K deltas and renders a panel/overlay. No native compilation; cross-platform by default.
3. **Manifest** — `{ id, name, mcp_endpoint, signalk_paths[], ui_component?, permissions[] }`.

Discovery/install is copilot-driven: a registry (Lume-indexed) the copilot searches; "I have a Victron monitor" → copilot finds the connector, requests permission, wires it in.

## 5. Native module requirements

Each native module: reads/writes Signal K, renders in the unified React/deck.gl shell, exposes its state to the copilot via the Signal K MCP, and needs no user install/config beyond connection.

## 6. Acceptance criteria

- A reference MCP extension (e.g., a battery-monitor server) is discovered, permissioned, wired, and its panel renders — with zero native compilation.
- The native module set covers every "Low/Trivial" row above against live Signal K data.
- No OpenCPN plugin binary is loaded; no plugin source is read (attested).

## 7. Open questions

- Permission model granularity for MCP extensions (what a third party may read/control).
- Whether UI panels are web components vs. sandboxed iframes for v1.
