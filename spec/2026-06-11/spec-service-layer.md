# spec-service-layer.md

_Revised: 2026-06-11 (UTC)_

**Component:** Meridian cloud service layer (Cloud Run)
**Status:** Not built. The backbone the coastal tier rides on and the sovereign tier optionally calls when online.
**Deploy target:** Google Cloud Run (containerized, autoscaling, scale-to-zero capable).
**License posture:** Apache-2.0 service code. Upstreams: Google Photorealistic 3D Tiles (ToS-bound — key hidden behind proxy, see `spec.md`), ECMWF Open Data (CC-BY-4.0), GFS/NOMADS (public), SMOC/Copernicus (open + attribution), GEBCO bathymetry (public), OpenSeaMap seamarks (ODbL + attribution), NOAA ENCs (public domain), OSM (ODbL). Inference proxied to a model provider per tier.

---

## 1. Objective

A single horizontally-scalable service that does five jobs:

1. **Proxy & cache** the data Meridian serves to boats — Google 3D tiles, ensemble weather, currents, tides, storms, bathymetry/depth, seamarks, and free-data fallback maps — hiding keys, normalizing formats, and pre-warming caches by destination intent.
2. **Compute** the heavy things a boat shouldn't (or can't) — **isochrone ensemble routing** and the **ensemble agent framework**.
3. **Research** on demand via **grubcrawler** — agentic crawl→summarize→cite reports (anchorages, landfall intel, "boats like this") that cache to the boat.
4. **Proxy inference** for the coastal tier (boats with no local model), and serve as optional cloud brain for the sovereign tier when online.
5. **Expose ACP** — the Agent Control/Client Protocol contract that lets a **local agent on the boat** call these capabilities as tools, run locally, and degrade gracefully offline to the on-board floor.

The guiding rule from the strategy doc holds in the architecture: **the service is the convenience and the heavy-lift path; the boat must still work without it.** Every capability the service offers has an offline degradation, never a hard dependency.

## 2. Topology

```
                         ┌────────────────────────── Cloud Run (Meridian Service) ───────────────────────────┐
 Boat (local agent) ──ACP──▶  API gateway / auth / per-boat entitlement & rate limit                          │
   • Spark or proxied        ├─ /tiles    Google 3D proxy (key hidden) + free-map fallback                    │
   • ACP client              ├─ /weather  ensemble (ECMWF/GFS), normalized fields                              │
   • offline floor           ├─ /ocean    currents (SMOC), tides, storms, waves                                │
                             ├─ /bathy    GEBCO depth + seamarks (OpenSeaMap) + ENC-derived                    │
                             ├─ /route    isochrone ensemble routing (compute)                                 │
                             ├─ /research grubcrawler agentic reports (crawl→summarize→cite)                   │
                             ├─ /infer    model proxy (tiered)                                                 │
                             ├─ /fleet    anonymized contribute/consume (see spec-fleet-network)               │
                             └─ /panes    shared pane spec store/push                                          │
                             Shared: cache (CDN + object store), job queue, field store                        │
                         └───────────────────────────────────────────────────────────────────────────────────┘
```

Cloud Run notes: stateless containers; long jobs (routing, grubcrawler) run async via a queue + worker service (Cloud Run jobs / Tasks), not in the request path; tiles/weather/ocean served from a CDN-fronted object cache so most reads never hit a worker; scale-to-zero for cost when no boats are online.

## 3. Capability endpoints (proxy + compute)

### 3.1 Tiles — `/tiles` (multifunctional proxy: two classes, opposite caching rules)
One endpoint, **two tile classes with opposite caching postures** (full rule in `spec-google-3d-tiles.md` §6):
- **Google Photorealistic 3D Tiles** — thin pass-through, key hidden server-side (never shipped to the boat), session/quota by `sub`, attribution preserved. **Online-use only; NOT durably cached** (ToS). When offline, Google is unavailable — by license, not by bug.
- **Free-data tiles** (OSM/OpenSeaMap basemap, NOAA ENC→PMTiles vector, GEBCO bathy, seamarks) — cache-and-serve CDN. **Cached aggressively and corridor-pre-warmed** (no license ceiling). This is the **offline-first foundation** and the global-coverage wedge (covers where Google is thin).
- **Selection:** client auto-picks by `online && entitled && within-ToS-bound` → Google, else free tiles (proxied if online/uncached, from cache if offline). The free corridor is **always cached underneath** the Google view, so signal loss swaps Google→free **instantly, same viewport, no blank globe** (quiet "offline · free data" indicator). The boat never holds a Google key and never assumes Google offline.
- **Pre-warm warms the FREE layer** (destination-intent), regardless of the on-screen source — durable offline cache is always free-data.
- ACP `tiles.fetch` is a two-source capability: Google online-only; capability falls back to free-tile `Cache` — never goes dark, changes source.

### 3.2 Weather — `/weather`
- Ensemble wind/pressure/gust/waves. Primary `ecmwf_ifs025`, fallback `gfs025` (correct ensemble subdomain). Returns the normalized `Field` model (see `spec-wind-current-layers.md`) — knots, native direction convention, optional members + p5/p50/p95.
- Storms surfaced as a derived product (low-pressure tracks, gale probability) from the same ensemble.

### 3.3 Ocean — `/ocean`
- **Currents** (SMOC via Copernicus, km/h→kn), **tides** (harmonic prediction), **waves/swell**, SST. Same `Field`/series model. Honor the current-direction convention (toward, no flip) distinct from wind.
- Coastal-null degradation: drop+interpolate, never blank.

### 3.4 Bathymetry & seamarks — `/bathy`
- **GEBCO** depth grid (public), **ENC-derived** depth areas/contours/soundings (from the ingestion pipeline), **OpenSeaMap seamarks** (ODbL, attribution). Served as tiles/fields the chart-style and routing layers consume.

### 3.5 Routing — `/route` (compute)
- **Isochrone ensemble routing** server-side (faster, bigger ensemble than a boat could run). Input: vessel polar ref, departure window/offset, start/end, toggles (currents on/off, motoring min-VMG). Output: P5/P50/P95 envelope, median route, ETA distribution, risk metrics — the exact products the live demo already computes, run as an async job, result cached and pushed to the boat (and cached for offline).
- Sovereign tier can run the same engine locally; `/route` is the online-accelerated path, not the only path.

### 3.6 Research — `/research` (compute, grubcrawler)
- Agentic crawl→index→summarize→**cite** reports keyed to destination intent: anchorage write-ups, landfall/check-in intel, "boats like yours that made this passage." Returns summaries with citations only (copyright discipline: facts extracted, sentiment summarized-and-cited, no verbatim, no redistribution — see `spec-anchorage-layer.md`). Caches to the boat for offline serve.

### 3.7 Inference — `/infer`
- Model proxy for the **coastal tier** (no local model): the boat's local agent emits a function/tool call over ACP; the service runs inference and returns the result. Tiered routing to model size by entitlement/connectivity. (Internal infra — own GPUs in a data center — is invisible to the customer; externally "we proxy inference when you're online.")

### 3.8 Fleet & panes — `/fleet`, `/panes`
- `/fleet`: anonymized contribute/consume per `spec-fleet-network.md` (grid-cell observations + anonymized passage logs; never identity/track).
- `/panes`: store agent-authored pane specs and push them to subscribers so offline boats get fleet/agent-authored panes.

## 4. ACP — Agent Control/Client Protocol (the local-agent contract)

ACP is the contract that lets a **local agent on the boat** treat the service as a set of callable capabilities, run its own loop locally, and fall back to the on-board floor when offline. Design goals: transport-simple, capability-typed, entitlement-aware, offline-degrading, and **agent-runtime-agnostic** (works whether the agent runs on a Spark locally or is itself proxied).

### 4.1 Shape
- **Transport:** HTTPS + JSON (request/response) for capability calls; server-sent events / WebSocket for streaming (routing progress, research tokens, tile-prefetch status). JSON-RPC-style envelope so it composes with the existing MCP integrations (Signal K MCP, Lume MCP) rather than competing with them.
- **A capability** = `{ id, input_schema, output_schema, cost_class, offline_fallback }`. The service publishes a **capability manifest** (`GET /acp/manifest`) the local agent reads to know what it can call, what it costs, and what to do when offline.
- **Capabilities map 1:1 to §3 endpoints:** `tiles.fetch`, `weather.field`, `ocean.field`, `bathy.field`, `route.compute`, `research.report`, `infer.complete`, `fleet.contribute`, `fleet.observe`, `panes.publish`, `panes.subscribe`.

### 4.2 Offline degradation (declared per capability)
Each capability declares its `offline_fallback` so the local agent knows the floor without round-tripping:
- `route.compute` → local isochrone engine (sovereign) or cached route (coastal).
- `weather/ocean/bathy.field` → last cached field + forecast-age.
- `research.report` → cached landfall report (destination pre-fetch).
- `infer.complete` → local model (sovereign) **or** the deterministic floor (transcription + local search + entity→command) for coastal.
- `tiles.fetch` → cached corridor tiles / free-map fallback.
This is what makes "the boat still works alone" a protocol guarantee, not a hope.

### 4.3 Entitlement & safety in the protocol
- Every ACP call carries a **per-boat token**; the gateway enforces tier (coastal/sovereign), rate limits, and quota (esp. Google tiles + inference cost).
- **ACLs ride in ACP**: a capability call that would *change* something on the boat is gated — the protocol distinguishes `read`/`advise`/`act`, and `act` requires the boat-side **single-tap confirm** (the service never closes a control loop; it returns a proposed action the local UI must confirm). This is the strategy doc's safety model expressed at the protocol layer.

### 4.4 Why ACP and not "just MCP" — RESOLVED
MCP is how the agent reaches tools/data (Signal K, Lume) — Meridian keeps using it. **ACP is a distinct capability envelope** layered on top: it carries the tier/quota/cost accounting, the declared offline fallbacks, and the read/advise/act safety gating that a billable, safety-relevant marine service needs and that raw MCP's `{name, description, input_schema}` shape has nowhere to put. **Resolution (see `spec-acp-and-search.md` §A6): the `AcpCapability` is canonical; the MCP `ToolDef` is a generated one-directional projection of it** (`impl From<&AcpCapability> for ToolDef`). The agent calls pure MCP tools (uniform ergonomics, never learns a second convention); the ACP-only fields (`mode`, `cost_class`, `min_tier`, `offline_fallback`, scope) are enforced at the resolver/gateway, never hand-duplicated. One source of truth, no drift. The envelope is the publishable third-party contract (capability id = Nuts Auth scope); MCP is the local-agent calling convention.

## 5. Cross-cutting

- **Auth/entitlement:** Nuts Auth JWTs (`spec-auth.md`) — per-boat identity, `tier`, scope, quota in the claims; validated locally against cached JWKS (no per-call auth round-trip); abuse/rate limiting protects Google tile quota + inference spend. This line and `spec-auth.md` are the same model: this spec states the requirement, `spec-auth.md` fills in the JWT mechanics. No contradiction.
- **Caching & cost:** CDN-fronted object cache for tiles/weather/ocean/bathy; destination-intent pre-warm; scale-to-zero workers; cost dashboards per capability (tiles and inference are the two spend risks).
- **Observability:** per-capability latency/cost/error; the founder's own tooling (Lume search over logs) as the ops surface.
- **Data discipline:** Google ToS (no over-caching, attribution), ODbL attribution (OSM/OpenSeaMap), CC-BY (ECMWF) — attribution propagated to the client; fleet data anonymized at ingest.

## 6. Implementation phases

1. **Gateway + entitlement + tiles proxy** (Google key-hiding + free-map fallback) — unblocks the client and protects quota.
2. **Weather/ocean/bathy proxy + cache** on the shared `Field` model — the layer data path.
3. **`/route` async isochrone compute** (port the demo engine into a worker) + result cache/push.
4. **ACP manifest + capability envelope + offline_fallback declarations** — formalize the boat↔cloud contract; expose capabilities as MCP tools.
5. **`/research` grubcrawler** + cache-to-boat; **`/infer` proxy** with tiered routing.
6. **`/fleet` + `/panes`** (depends on `spec-fleet-network.md`).
7. **ACL read/advise/act gating + single-tap-confirm semantics** in ACP.

## 7. Acceptance criteria

- A boat with a valid token fetches Google 3D tiles without ever seeing the key; an unentitled/over-quota boat is cleanly rate-limited; coverage falls back to free maps with attribution intact, everywhere on Earth.
- `/route` returns the demo's P5/P50/P95 + risk products as an async job, cached and pushed; the sovereign client can run the same locally.
- `/research` returns cited summaries (no verbatim source text) and caches to the boat.
- The ACP manifest lets a local agent discover capabilities, costs, and **offline fallbacks**; with the network cut, every capability degrades to its declared floor and the boat stays useful.
- No `act` capability executes without a boat-side single-tap confirm (verified).
- Scale-to-zero verified (no idle cost with no boats online); tile + inference spend visible per boat.

## 8. Open questions

- **RESOLVED** — ACP framing relative to MCP: distinct `AcpCapability` envelope with a generated `ToolDef` projection (see §4.4 and `spec-acp-and-search.md` §A6). Only surviving sub-question: ACP fields surfaced to the agent as read-only context vs. enforcement-only (lean: read-only context; decide in ACP phase 2).
- Inference provider + the data-center-GPU economics crossover point (when own-GPU beats per-call API).
- Google tiles ToS ceiling at scale — confirm session/quota model and whether a BYO-key tier is needed for heavy users (per `spec.md`).
- Where tide harmonic computation lives (service vs. on-boat) — likely both, service authoritative.
