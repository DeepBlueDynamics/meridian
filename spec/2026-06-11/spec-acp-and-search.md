# spec-acp-and-search.md

_Revised: 2026-06-11 (UTC)_

**Components:** (1) ACP — the local-agent ⇄ service capability contract; (2) the combined search substrate (Shivvr embeddings + Lume, over Grub or docs).
**Language:** Rust. Builds directly on the existing Hyperia Ghost runtime (`agent.rs`, `provider.rs`, `types.rs`, `widget.rs`, `compressor.rs`).
**Status:** The runtime exists; this spec names and scopes ACP over it and adds the unified search layer every capability leans on.
**License posture:** Apache-2.0. Reuses Ghost's permissive stack; Lume + Shivvr + Grub are first-party.

---

## 0. What already exists (inherit, don't reinvent)

From the uploaded Ghost code, these primitives are already the ACP runtime — the spec formalizes them rather than introducing parallels:

- **Capability sandboxing = the `tool_mount` model** (`widget.rs`): `exposes` allowlists data keys (403 `KeyNotExposed`), `permits` allowlists actions (403 `ActionNotPermitted`), actions are **queued, not invoked**, and the agent **drains and decides** at the top of each loop. This *is* ACP's read/advise/act gating and the single-tap-confirm seam.
- **Tier = `AnyProvider`** (`provider.rs`): explicit `provider: anthropic|openai|gemini|ollama`, endpoint fallbacks, `ollama → localhost:11434`. Coastal-proxy vs. sovereign-local is already a config axis (`GhostConfig`), not a rewrite.
- **Small-model floor = Maximus** (`compressor.rs`, `gemma2:2b`): the always-available local model path for compression/extraction — the substrate for the deterministic offline floor.
- **Memory = Ferricula**; **dynamic capability = `tool_search`/`tool_create`**; **wire vocabulary = `ProviderEvent` (in) / `GhostEvent` (out)** with `tool_mount {exposes, permits, srcdoc}` and `show_widget`.

ACP = these primitives, given a **capability manifest**, **entitlement/tier metadata**, and **declared offline fallbacks**, so the same agent loop runs on the boat and calls the cloud service uniformly.

---

# Part A — ACP (Agent Capability Protocol)

## A1. Goal

A transport-simple, capability-typed, entitlement-aware, **offline-degrading** contract that lets the Ghost agent loop run locally (Spark or proxied) and call Meridian cloud capabilities (`spec-service-layer.md`) as tools — with read/advise/act safety and graceful offline fallback declared per capability.

## A2. Capability descriptor

Mirrors `ToolDef` (`types.rs`) plus the ACP-specific fields:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpCapability {
    pub id: String,                 // "route.compute", "weather.field", "infer.complete"
    pub description: String,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
    pub mode: AcpMode,              // Read | Advise | Act
    pub cost_class: CostClass,      // Free | Metered | Inference | Tiles
    pub offline_fallback: OfflineFallback,
    pub min_tier: Tier,             // Coastal | Sovereign
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AcpMode { Read, Advise, Act }   // Act REQUIRES boat-side single-tap confirm

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CostClass { Free, Metered, Inference, Tiles }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Tier { Coastal, Sovereign }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum OfflineFallback {
    LocalEngine,        // e.g. route.compute → on-board isochrone engine
    LocalModel,         // infer.complete → local Ollama (sovereign)
    DeterministicFloor, // infer.complete → transcription + search + entity→command (coastal)
    Cache { max_age_secs: u64 },  // *.field, research.report → last good, with age
    None,               // hard online-only (rare; must be justified)
}
```

`GET /acp/manifest` returns `Vec<AcpCapability>`. The local agent reads it once per session (cached) so it knows what it can call, what it costs, and what to do offline **without a round-trip**.

## A3. Capability set (1:1 with the service layer)

`tiles.fetch` · `weather.field` · `ocean.field` · `bathy.field` · `route.compute` · `research.report` · `infer.complete` · `fleet.contribute` · `fleet.observe` · `panes.publish` · `panes.subscribe` · `search.query` (Part B).

Each ships an `offline_fallback`: routing→`LocalEngine`/`Cache`; fields→`Cache{age}`; research→`Cache`; infer→`LocalModel` (sovereign) or `DeterministicFloor` (coastal); tiles→`Cache` + free-map fallback.

## A4. Transport & envelope

- **Call:** `POST /acp/call` — `{ capability, input, boat_token, idempotency_key }`.
- **Stream:** SSE/WebSocket reusing the existing `GhostEvent` vocabulary (`text_delta`, `tool_start`, `tool_result`, `thinking_*`, `stats`, `done`, `error`) so routing progress and research tokens stream in the format the renderer already speaks.
- **Local execution is identical:** when offline (or sovereign), the same `AcpCapability` resolves to its fallback executor; the agent loop is unchanged — only the resolver differs (`AcpResolver::Local` vs `AcpResolver::Remote`).

```rust
pub enum AcpResolver { Remote(RemoteService), Local(LocalCapabilities) }

impl AcpResolver {
    pub async fn call(&self, cap: &AcpCapability, input: Value, online: bool)
        -> anyhow::Result<AcpOutput>
    {
        match (online, self) {
            (true,  AcpResolver::Remote(s)) => s.call(cap, input).await,
            _ => LocalCapabilities::fallback(cap, input).await, // honors offline_fallback
        }
    }
}
```

## A5. Safety in the protocol (the `tool_mount` pattern, generalized)

- Every call carries a **per-boat token**; the gateway enforces `min_tier`, quota, and rate limits (protects tile + inference spend).
- **`mode = Act` never auto-executes.** Exactly like `widget.rs` queues actions for the agent to drain and decide, an `Act` capability returns a **proposed action**; the boat-side UI must **single-tap confirm** before it runs. The service never closes a control loop. `permits`/`exposes` allowlists carry through to any mounted control pane.
- ACLs are the capability's `mode` + the mount `permits` list — already enforced in code at the 403 layer.

## A6. ACP vs MCP (positioning)

MCP stays the agent↔tool reach (Signal K, Lume, Ghost tools). **ACP adds what a billable, safety-relevant marine service needs and MCP doesn't specify: tier/quota/cost accounting, declared offline fallbacks, and read/advise/act gating.** ACP capabilities are *also* surfaced as MCP tools (an adapter wraps `AcpCapability` → `ToolDef`) so the agent's mental model stays uniform and third parties can write Meridian-compatible agents against a published contract.

---

# Part B — Combined search (Shivvr + Lume, over Grub or docs)

## B1. Goal

One search interface that fuses **Shivvr dense embeddings** with **Lume hybrid retrieval** (BM25 lexical + SKG graph boost) over either **Grub-crawled content** or **local docs**, runs **locally on a Pi** (vectors included), and backs three consumers: `research.report` (grubcrawler), the boat-OS log/maintenance search, and the offline floor's entity→command mapping.

## B2. Interface

```rust
pub struct SearchQuery {
    pub text: String,
    pub source: SearchSource,     // Grub | Docs | Logs | All
    pub alpha: f32,               // lexical↔semantic blend (Lume -a)
    pub graph_boost: f32,         // SKG neighbor boost (Lume -g)
    pub k: usize,
    pub filters: Vec<KeyTerm>,    // entity/keyterm constraints
}

pub enum SearchSource { Grub, Docs, Logs, All }

pub struct SearchHit {
    pub doc_id: String,
    pub score: f32,
    pub lexical: f32,
    pub semantic: f32,            // Shivvr cosine
    pub graph: f32,               // SKG contribution
    pub snippet: String,
    pub citations: Vec<Citation>, // url/title/fetched_at — never verbatim bulk
    pub entities: Vec<String>,    // extracted (drives entity→command)
}

#[async_trait::async_trait]
pub trait CombinedSearch {
    async fn index(&self, source: SearchSource, items: Vec<DocInput>) -> anyhow::Result<()>;
    async fn query(&self, q: SearchQuery) -> anyhow::Result<Vec<SearchHit>>;
    async fn entities(&self, text: &str) -> anyhow::Result<Vec<KeyTerm>>; // for floor commands
}
```

## B3. Fusion

Final score = weighted blend of three normalized signals, with `alpha` sliding lexical↔semantic and `graph_boost` weighting SKG:

```
score = (1-alpha)·bm25_norm + alpha·shivvr_cosine + graph_boost·skg_neighbor_mass
```

- **Shivvr** provides the embedding/dense vectors (the `shivvr_cosine` term); runs locally, Pi-capable.
- **Lume** provides BM25 + the SKG entity graph (`bm25_norm`, `skg_neighbor_mass`) and the entity extraction feeding `entities()`.
- Normalize each signal to [0,1] before blending so weights are meaningful; expose `alpha`/`graph_boost` as tunables (defaults ~0.5 / ~0.3, matching Lume).

## B4. Sources

- **Grub:** `grubcrawler` output (online research → `research.report`). Crawl→index→query→summarize-and-**cite** (copyright discipline: facts + cited summaries, never verbatim bulk).
- **Docs:** local document corpus (manuals, cruising guides, cached landfall reports).
- **Logs:** the boat-OS stream — voice notes, VHF transcriptions, maintenance entries, passage logs — indexed continuously so "when did I last service the watermaker" resolves **offline**.

## B5. Offline-first & the floor

- Vectors + BM25 + SKG all run **on the boat** (Pi-capable). `search.query` with `SearchSource::Logs|Docs` needs no network; `Grub` is online-only and degrades to cached corpora.
- **Entity→command:** `entities()` over a transcribed utterance extracts known terms; a deterministic map ("water tank" → open tank pane) runs with **no inference** — this is the coastal-offline floor, and it reuses Maximus only when a tiny local model genuinely helps. The search engine is what makes the floor smart without a GPU.

## B6. Consumers

1. `research.report` (grubcrawler) — online crawl + combined search + cite, cached to boat.
2. **Boat-OS retention layer** — maintenance/logbook/sticky-note/log search; the compounding, offline, lock-in surface.
3. **Offline floor** — entity extraction → deterministic pane/command dispatch.

---

## Implementation phases

1. `CombinedSearch` trait + Shivvr-vector + Lume-BM25/SKG fusion over **Logs/Docs** (offline, Pi). Wire `entities()` to the floor.
2. `AcpCapability` + `/acp/manifest` + `AcpResolver` (Remote/Local) with `offline_fallback` honored; expose as MCP tools via adapter.
3. `Act` single-tap-confirm semantics over the `tool_mount` queue-and-drain pattern; token/tier/quota at the gateway.
4. `search.query` over **Grub** (online) → `research.report`; cache-to-boat.
5. Boat-OS log indexing pipeline feeding `SearchSource::Logs`.

## Acceptance criteria

- One agent loop runs unchanged against Remote (coastal/online) and Local (sovereign/offline) resolvers; every capability degrades to its declared `offline_fallback` with the network cut.
- No `Act` capability executes without a boat-side single-tap confirm (mirrors `widget.rs` queue-and-drain; verified by test as in `queue_action_rejects_outside_permits`).
- Combined search returns fused hits (lexical+semantic+graph each visible in `SearchHit`) over Logs/Docs **offline on a Pi**, and over Grub when online, with citations and never verbatim bulk.
- "When did I last service the watermaker" resolves from `Logs` offline; "water tank" routes to the tank pane via `entities()` with no inference.
- `/acp/manifest` lets a third-party agent discover capabilities, tiers, costs, and fallbacks against a published contract.

## Open questions

- Shivvr embedding dimension / model vs. Pi memory budget; quantization for the lowest-end helm device.
- Whether `entities()` uses Lume's SKG entity set directly or a separate command vocabulary (lean: SKG set + a command-alias table).
- ACP envelope: pure MCP tools vs. distinct envelope + MCP adapter (lean: distinct envelope for entitlement/offline/safety; adapter for ergonomics) — same fork flagged in `spec-service-layer.md`.
