# Meridian — Specification Manifest

_Revised: 2026-06-11 (UTC)_

Single source of truth for the spec suite. Every spec carries a `_Revised:` date. Dependency order and status below.

---

## Active specs

| Spec | Component | Depends on / blocks |
|---|---|---|
| `spec-service-layer.md` | Cloud Run backbone: proxy + compute + ACP exposure | core hub; auth, acp, fleet, tiles, layers all plug in |
| `spec-acp-and-search-v2.md` | ACP contract + combined Shivvr/Lume search (**current**) | supersedes `spec-acp-and-search.md`; MCP/ACP fork RESOLVED §A6 |
| `spec-service-usage.md` | Deployed-service contract: nuts-auth, Agent Card, /a2a skills, tiles split, /transcribe (**the integrator's contract**) | consumes service-layer; frontend checklist §10 |
| `spec-signalk.md` | Signal K client bridge + boat-data simulator (**draft**) | live-at-boat overlay, instruments, graph-any-path |
| `spec-hyperia-integration.md` | Hyperia sidecar = standalone agent + sticky notes (**draft**) | ACP Act → consent grants; port 9800 |
| `spec-route-research.md` | Route research product: crawl + summarize what's along a passage (**draft**, backend) | grub/Lume; feeds route-research-frontend |
| `spec-route-research-frontend.md` | From/To picker, route variants, along-the-way itinerary on ROUTING view (**draft**) | consumes route-research via bridge |
| `spec-refactor-guidance.md` | Codebase modularization: css/theme, page controllers, api-service consolidation (**draft**) | guides all frontend work |
| `spec-build-signalk-sim.md` | BUILD AGENT: wire-faithful Signal K boat simulator (**draft**) | implements spec-signalk §6; client bridge frozen |
| `spec-auth.md` | Nuts Auth JWTs — one token across service/ACP/Shivvr/grubcrawler | underpins every endpoint |
| `spec-google-3d-tiles.md` | Google 3D Tiles ToS + proxy (the referenced `spec.md`) | `/tiles`; quota by `sub` |
| `spec-wind-current-layers-v2.md` | Wind + current layers + the **shared `Field` model** (**current**, implemented) | supersedes `spec-wind-current-layers.md`; load-bearing: `/weather`,`/ocean`,`/bathy` all return `Field` |
| `spec-fleet-network.md` | Opt-in anonymized reciprocal fleet network | **blocks service-layer phase 6** (`/fleet`) |
| `spec-anchorage-layer.md` | Tiered anchorage / local-knowledge layer | uses Lume, grubcrawler, OSM |
| `spec-chart-ingestion.md` | S-57 ENC → PMTiles pipeline (prototype verified) | feeds chart-style |
| `spec-chart-style.md` | MapLibre S-52-style rendering | consumes ingestion output |
| `spec-extension-model.md` | Plugin-emulation / MCP extension model | uses ACP, functional-analysis |
| `spec-n2k-interop.md` | NMEA 2000 / Garmin interop (canboat→Signal K) | foundation |
| `spec-radar.md` | Radar via Mayara (network-boundary sidecar) | Signal K |
| `spec-radio.md` | VHF radio monitor, transcription & voice control (**active**) | core hub; acp, userdata |
| `spec-radio-embedded.md` | Embedded radio stack sidecar + Electron supervisor (**draft**) | consumes radio, service-layer |
| `spec-radio-audit.md` | VHF radio stack security, DSP, and process supervisor audit (**draft**) | depends on radio, radio-embedded |
| `spec-wind-current-audit.md` | Wind/current viz math, perf, cache & landmask audit — B-01..B-04 (**draft**) | depends on wind-current-layers, service-layer |
| `spec-route-sidecar.md` | Rust isochrone executor + the route.compute wire contract (**active**) | service-usage §5, service-layer §3.5 |

## Superseded / prompts / artifacts

- `spec-wind-current-layers.md` — **superseded by v2** (v2 adds the shipped implementation: `lib/field.js`, `lib/fieldlayer.js`, `layers.html`).
- `marine-data-licensing-catalog.md` — research artifact: commercial licensing/access catalog for free marine data sources (filed 2026-06-11 from inbox).
- `spec-acp-and-search.md` — **superseded by v2** (kept for diff; v2 closes the MCP/ACP fork).
- `opencpn-functional-analysis-prompt.md` — agent task (current); `opencpn-deconstruction-prompt.md`, `opencpn-review-agent-prompt.md` — earlier versions.
- `ingest_enc.sh`, `meridian-charts.pmtiles` — verified chart-ingestion prototype + output.
- `meridian-strategy-v3.md` — **current strategy** (v2 superseded).
- `meridian-research-findings.md` — landscape research + pipeline verification.

## Resolved (was open)

- **MCP vs ACP fork** → distinct `AcpCapability` envelope; `ToolDef` is a generated projection. Resolved in `spec-acp-and-search-v2.md` §A6 and `spec-service-layer.md` §4.4/§8.
- **Auth overlap** → service-layer §5 states the requirement; `spec-auth.md` fills the JWT mechanics. Same model, no contradiction.
- **Referenced-but-missing specs** → `spec.md` (→ `spec-google-3d-tiles.md`) and `spec-fleet-network.md` now written. `spec-wind-current-layers.md` and `spec-anchorage-layer.md` already present.

## Still open (highest-value first)

1. ACP §A6 sub-question: ACP fields as agent-readable context vs. enforcement-only (lean: context; decide ACP phase 2).
2. Open/paid line — recommend open the plumbing, keep the routing engine paid.
3. Spark marine power/thermal viability.
4. Nuts Auth: signed-grant lifetime vs. revocation TTL for offline sovereign boats.
5. Not-yet-written: `spec-boat-os.md` (maintenance/logbook/search retention layer), `spec-control-safety.md` (wake-word + ACL + single-tap), `spec-tides.md`.

## Build-order hint

```
auth ─┬─▶ service-layer ─┬─▶ google-3d-tiles
      │                  ├─▶ wind-current-layers (Field model) ─▶ chart-style
      │                  ├─▶ acp-and-search-v2 ─▶ extension-model
      │                  └─▶ fleet-network (phase 6)
n2k-interop ─▶ (instruments)      radar (Mayara sidecar)
chart-ingestion ─▶ chart-style    anchorage-layer (Lume + grubcrawler)
```
