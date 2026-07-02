# spec-acp-and-search.md (v2)

_Revised: 2026-06-11 (UTC)_

**Components:** (1) ACP — the local-agent ⇄ service capability contract; (2) the combined search substrate (Shivvr embeddings + Lume, over Grub or docs).
**Language:** Rust. Builds directly on the existing Hyperia Ghost runtime (`agent.rs`, `provider.rs`, `types.rs`, `widget.rs`, `compressor.rs`).
**Auth:** Nuts Auth JWTs (`spec-auth.md`) — one token across service layer, ACP, Shivvr, grubcrawler.
**Status:** Runtime exists; this spec formalizes ACP over it and adds the unified search layer.
**License posture:** Apache-2.0. Lume + Shivvr + Grub are first-party.

**v2 change:** the MCP-vs-ACP fork is **resolved** (§A6). ACP is a distinct envelope; the MCP `ToolDef` is a generated projection of it. One source of truth, no parallel definitions. Only one sub-question remains open (fields-as-agent-context vs. enforcement-only).

---

## 0. What already exists (inherit, don't reinvent)

From the uploaded Ghost code, these primitives are already the ACP runtime — formalize them, don't build parallels:

- **Capability sandboxing = the `tool_mount` model** (`widget.rs`): `exposes` allowlists data keys (403 `KeyNotExposed`), `permits` allowlists actions (403 `ActionNotPermitted`), actions are **queued, not invoked**, and the agent **drains and decides** at the top of each loop. This *is* ACP's read/advise/act gating and the single-tap-confirm seam.
- **Tier = `AnyProvider`** (`provider.rs`): explicit `provider: anthropic|openai|gemini|ollama`, endpoint fallbacks, `ollama → localhost:11434`. Coastal-proxy vs. sovereign-local is already a `GhostConfig` axis, not a rewrite.
- **Small-model floor = Maximus** (`compressor.rs`, `gemma2:2b`): the always-available local model path — substrate for the deterministic offline floor.
- **Memory = Ferricula**; **dynamic capability = `tool_search`/`tool_create`**; **wire vocabulary = `ProviderEvent` (in) / `GhostEvent` (out)** with `tool_mount {exposes, permits, srcdoc}` and `show_widget`.

ACP = these primitives + a **capability manifest**, **entitlement/tier metadata**, and **declared offline fallbacks**, so the same agent loop runs on the boat and calls the cloud service uniformly.

---

# Part A — ACP (Agent Capability Protocol)

## A1. Goal

A transport-simple, capability-typed, entitlement-aware, **offline-degrading** contract that lets the Ghost agent loop run locally (Spark or proxied) and call Meridian cloud capabilities (`spec-service-layer.md`) as tools — with read/advise/act safety and graceful offline fallback declared per capability, and Nuts Auth scopes enforcing access.

## A2. Capability descriptor (canonical — single source of truth)

The `AcpCapability` is the one definition. The MCP `ToolDef` is generated from it (§A6); they never drift.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpCapability {
    pub id: String,                 // "route.compute" — ALSO the Nuts Auth scope
    pub description: String,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
    pub mode: AcpMode,              // Read | Advise | Act
    pub cost_class: CostClass,      // Free | Metered | Inference | Tiles
    pub offline_fallback: OfflineFallback,
    pub min_tier: Tier,             // Coastal | Sovereign
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AcpMode { Read, Advise, Act }   // Act REQUIRES boat-side single-tap confirm + scoped token

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CostClass { Free, Metered, Inference, Tiles }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Tier { Coastal, Sovereign }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum OfflineFallback {
    LocalEngine,        // route.compute → on-board isochrone engine
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

- **Call:** `POST /acp/call` — `{ capability, input, boat_token, idempotency_key }`. `boat_token` is a Nuts Auth JWT.
- **Stream:** SSE/WebSocket reusing the existing `GhostEvent` vocabulary (`text_delta`, `tool_start`, `tool_result`, `thinking_*`, `stats`, `done`, `error`) so routing progress and research tokens stream in the format the renderer already speaks.
- **Local execution is identical:** offline (or sovereign), the same `AcpCapability` resolves to its fallback executor; the agent loop is unchanged — only the resolver differs.

```rust
pub enum AcpResolver { Remote(RemoteService), Local(LocalCapabilities) }

impl AcpResolver {
    pub async fn call(&self, cap: &AcpCapability, input: Value, online: bool)
        -> anyhow::Result<AcpOutput>
    {
        match (online, self) {
            (true, AcpResolver::Remote(s)) => s.call(cap, input).await,
            _ => LocalCapabilities::fallback(cap, input).await, // honors offline_fallback
        }
    }
}
```

## A5. Safety + auth in the protocol

- Every call carries a **Nuts Auth JWT**; the gateway validates locally against cached JWKS (no per-call auth round-trip), then enforces `min_tier`, scope, and quota (protects tile + inference spend). See `spec-auth.md`.
- **`mode = Act` is double-gated:** (1) boat-side **single-tap confirm** (the `widget.rs` queue-and-drain seam — return a *proposed* action, never auto-execute) AND (2) the token carries the capability's **scope**. Tap = presence; scope = authorization; both required. A guest at the wake word can't trigger control because the session token isn't scoped for `Act`.
- ACLs are the capability's `mode` + the mount `permits` list — already enforced at the 403 layer in code.

## A6. ACP ⇄ MCP — RESOLVED

**Decision: ACP is a distinct capability envelope. The MCP `ToolDef` is a generated, one-directional projection of it. Not pure MCP tools; not two hand-maintained definitions.**

Rationale: ACP carries three fields MCP's `{name, description, input_schema}` shape has nowhere to put, and all three are load-bearing rather than cosmetic:
1. **Entitlement** (`min_tier`, `cost_class`, scope) — billable enforcement; in pure MCP this rots into description-string convention and isn't enforceable at the protocol layer.
2. **`offline_fallback`** — the sovereignty guarantee as a protocol property; the agent must know offline behavior *before* it calls, not discover it by failing.
3. **`mode` (Read/Advise/Act)** — the safety gating; MCP has no notion of "this changes something and needs confirm."

Ergonomics stay pure MCP. The agent (Ghost loop, `tool_search`/`tool_create`) calls normal MCP tools; it never learns a second convention. The adapter is mechanical and one-way:

```rust
// AcpCapability is canonical; ToolDef is a projection. No parallel maintenance.
impl From<&AcpCapability> for ToolDef {
    fn from(cap: &AcpCapability) -> ToolDef {
        ToolDef {
            name: cap.id.clone(),
            description: cap.description.clone(),
            input_schema: cap.input_schema.clone(),
        }
    }
}
```

The ACP-only fields (`mode`, `cost_class`, `min_tier`, `offline_fallback`, scope) live in the **resolver and gateway** — the runtime *enforces* them; the agent doesn't *call* them. One source of truth (`AcpCapability`); the `ToolDef` is emitted, never hand-kept; no drift.

Ecosystem consequence: the `AcpCapability` envelope is the **publishable third-party contract** (capability id = Nuts Auth scope, per `spec-auth.md`), so "write a Meridian-compatible agent" has a real spec to target — including entitlement and offline semantics — while MCP remains the local-agent calling convention.

**Remaining sub-question (intentionally open):** whether the ACP-only fields are *also* surfaced to the agent as **read-only context** (so it can reason "this is `Inference`/`Act`, be careful / it has an offline fallback") or kept **purely at the enforcement layer** (agent stays naive, runtime gates). Lean: surface as read-only context — better agent decisions — at a token-budget cost per tool. Decide during phase 2.

---

# Part B — Combined search (Shivvr + Lume, over Grub or docs)

## B1. Goal

One search interface fusing **Shivvr dense embeddings** with **Lume hybrid retrieval** (BM25 lexical + SKG graph boost) over **Grub-crawled content**, **local docs**, or **boat logs**; runs **locally on a Pi** (vectors included); authorized by the same Nuts Auth JWT. Backs three consumers: `research.report` (grubcrawler), the boat-OS log/maintenance search, and the offline floor's entity→command mapping.

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

```
score = (1-alpha)·bm25_norm + alpha·shivvr_cosine + graph_boost·skg_neighbor_mass
```

- **Shivvr** = the dense vectors (`shivvr_cosine`); local, Pi-capable.
- **Lume** = BM25 + SKG entity graph (`bm25_norm`, `skg_neighbor_mass`) + the entity extraction feeding `entities()`.
- Normalize each signal to [0,1] before blending; expose `alpha`/`graph_boost` (defaults ~0.5 / ~0.3, matching Lume).

## B4. Sources

- **Grub:** `grubcrawler` output (online research → `research.report`). Crawl→index→query→summarize-and-**cite** (facts + cited summaries, never verbatim bulk).
- **Docs:** local corpus (manuals, cruising guides, cached landfall reports).
- **Logs:** boat-OS stream — voice notes, VHF transcriptions, maintenance entries, passage logs — indexed continuously so "when did I last service the watermaker" resolves **offline**.

## B5. Offline-first & the floor

- Vectors + BM25 + SKG run **on the boat** (Pi-capable). `search.query` over `Logs|Docs` needs no network; `Grub` is online-only and degrades to cached corpora.
- **Entity→command:** `entities()` over a transcribed utterance extracts known terms; a deterministic map ("water tank" → open tank pane) runs with **no inference** — the coastal offline floor, reusing Maximus only when a tiny local model genuinely helps. The search engine is what makes the floor smart without a GPU.

## B6. Consumers

1. `research.report` (grubcrawler) — online crawl + combined search + cite, cached to boat.
2. **Boat-OS retention layer** — maintenance/logbook/sticky-note/log search; the compounding, offline, lock-in surface.
3. **Offline floor** — entity extraction → deterministic pane/command dispatch.

---

## Implementation phases

1. `CombinedSearch` trait + Shivvr-vector + Lume-BM25/SKG fusion over **Logs/Docs** (offline, Pi). Wire `entities()` to the floor.
2. `AcpCapability` + `/acp/manifest` + `AcpResolver` (Remote/Local) honoring `offline_fallback`; `From<&AcpCapability> for ToolDef` adapter. **Decide the §A6 sub-question here.**
3. Nuts Auth JWT gating (local JWKS) + tier/scope/quota; `Act` double-gate (tap + scope) over the `tool_mount` queue-and-drain.
4. `search.query` over **Grub** (online) → `research.report`; cache-to-boat.
5. Boat-OS log indexing pipeline feeding `SearchSource::Logs`.

## Acceptance criteria

- One agent loop runs unchanged against Remote (coastal/online) and Local (sovereign/offline) resolvers; every capability degrades to its declared `offline_fallback` with the network cut.
- The agent sees only MCP `ToolDef`s (projected from `AcpCapability`); the ACP fields are enforced at the resolver/gateway, never hand-duplicated.
- No `Act` executes without **both** a single-tap confirm and a scoped Nuts Auth JWT (verified by test, mirroring `queue_action_rejects_outside_permits`).
- Combined search returns fused hits (lexical+semantic+graph each visible in `SearchHit`) over Logs/Docs **offline on a Pi**, and over Grub when online, with citations and never verbatim bulk.
- "When did I last service the watermaker" resolves from `Logs` offline; "water tank" routes to the tank pane via `entities()` with no inference.
- `/acp/manifest` lets a third-party agent (scoped JWT) discover capabilities, tiers, costs, and fallbacks against a published contract.

## Open questions

- **(A6 sub-question)** ACP fields surfaced to the agent as read-only context vs. enforcement-only. Lean: read-only context. Decide phase 2.
- Shivvr embedding dimension / model vs. Pi memory budget; quantization for the lowest-end helm device.
- Whether `entities()` uses Lume's SKG entity set directly or a separate command vocabulary (lean: SKG set + a command-alias table).
