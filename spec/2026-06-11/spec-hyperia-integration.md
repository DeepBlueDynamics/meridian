# spec-hyperia-integration.md

**Component:** Hyperia integration — standalone agent/sidecar + sticky notes + tool surface
**Spec-ID:** hyperia-integration
**Version:** v1
**Status:** draft
**Revised:** 2026-06-11 (UTC)
**Depends-on:** spec-acp-and-search-v2, spec-auth, spec-userdata, spec-radio
**Referenced-by:** —
**Supersedes:** —
**License-posture:** Apache-2.0. Integrates the existing **hyperia-integration-core** (Rust sidecar v0.10.34 + Electron app bridge). Sidecar on **port 9800**; MCP streamable-HTTP at `/mcp`, REST at `/api/...`.

---

## 1. Objective

Wire Meridian to **Hyperia as the standalone agent + tool host** it already is — confirming the "no agent in the app" decision in real code. Hyperia's sidecar already exposes the agent loop, the sticky-note surface, local BM25 search (lume), per-shell log search, screenshots, and a 56-tool MCP surface, all behind an identity+consent permission model. Meridian consumes this rather than re-implementing it; the work is mapping Hyperia's surface onto Meridian's ACP/auth/userdata specs and onto the display.

## 2. What already exists (inherit verbatim — do not rebuild)

From `hyperia-integration-core`:

- **Sidecar = the standalone agent with ports.** Rust axum server on **9800**: MCP (streamable-HTTP, `rmcp` 0.15) at `/mcp`, REST at `/api/...`. This is exactly the "tool with ports exposed for control" pattern (cf. gnosis-radio 9080/9081). On a Spark it runs locally.
- **56 MCP tools** (`sidecar/src/mcp.rs`, source of truth) — terminal, web panes, **sticky notes**, snapshots/observability, settings, styles, telemetry, editing, discovery (`skills` to orient).
- **Sticky notes** — the retention/annotation surface: `sticky_note_create` / `_create_code` (file-linked, syntax-highlighted, live-updates on disk change) / `_list` / `_read` / `_search` (BM25) / `_update` / `_open` / `_close` / `_delete` / `_schedule` (timer-fire).
- **Local search = lume** (`Cargo.toml` path dep): backs `sticky_note_search` and `shell_log_search` — the same lume the combined-search spec builds on, already wired, offline, Pi-capable.
- **Identity + permission model** (`identity.rs`, `perms.rs`) — **the safety model Meridian specced, already built**:
  - **Tokens = identity:** `hyp_agent_` (persistent), `hyp_pane_` (ephemeral), `hyp_sys_` (bypass), or anonymous; resolved system→agent→pane→anon.
  - **Grants = permission:** human approves per identity via a **consent prompt raised in the target pane**, with scope ("just this pane"/"any pane") and duration. **Reads open; mutations gated. Enforcement default-ON, resets on restart.**
  - `AuthDecision` { Allow, RefuseHome (can't drive your own pane), SoftWall (anon needs identity), … } + a rolling **JSONL audit log** (`audit.rs`).
- **Connection contract** (`app/session.ts`): a spawned pane gets `HYPERIA_MCP_URL`, `HYPERIA_AGENT_TOKEN` (`hyp_pane_…`, sent as `Authorization: Bearer`), `HYPERIA_PANE`. External/container agents connect to `host.docker.internal:9800` and must present a token.
- **Maximus output filtering** — `focus="<topic>"` on `terminal_run`/`terminal_screen`/`tab_snapshot` returns only the relevant slice via local Ollama; `raw=true` bypasses. The small-model floor, already in the tool layer.
- **Ferricula memory** over HTTP; **dashboard** at `/dashboard`.

## 3. How this maps to Meridian's specs (the actual work)

| Meridian spec | Hyperia reality | Integration action |
|---|---|---|
| "App has no agent" | Sidecar is the standalone agent on 9800 | Meridian app talks to 9800, same as gnosis-radio 9080/9081 |
| ACP `mode: Act` + single-tap | `perms.rs` consent prompt + grants, default-ON | **Map ACP Act → Hyperia consent grant**; don't build a second gate |
| ACP identity / Nuts JWT | `hyp_*` token identity, Bearer | Reconcile: Nuts JWT for *service* auth; `hyp_*` for *local pane* identity. Bridge at the sidecar (see §5) |
| Combined search (Shivvr+Lume) | lume already backing sticky/log search | Extend the same lume index; add Shivvr vectors per spec-acp-and-search-v2 |
| Boat-OS retention layer | sticky notes (create/search/schedule/code) | **Sticky notes = the maintenance/logbook annotation panes** — already built |
| userdata logs | `shell_log_search`, sticky BM25 | Index radio transcripts + logs into the same lume; local-first, opt-in upload |
| Audit/safety | `audit.rs` JSONL | Use as the Act/consent audit trail |

## 4. Sticky notes = the boat-OS annotation surface

The sticky-note tools ARE the manual/maintenance/logbook pane type from the boat-OS thesis (the churn-killer). `sticky_note_create_code` (file-linked, live-updating) and `sticky_note_schedule` (timer-fire) cover maintenance reminders and service-interval notes directly. Meridian's job: render these notes as **panes on the display canvas** (helm/salon/galley routing per the multi-display model), and let the agent author them via the existing MCP tools — the pane-authoring primitive, already toolized.

## 5. Auth reconciliation (the one real design question)

Two token systems meet here: **Nuts JWT** (Meridian service identity, tier/scope/quota — `spec-auth`) and **Hyperia `hyp_*`** (local pane/agent identity + consent grants). They are not in conflict — they're different layers:
- **Nuts JWT** authorizes *service/cloud* capabilities (route, weather, infer, research).
- **`hyp_*` tokens** authorize *local* pane driving + tool mutations on the boat.
- **Bridge:** the sidecar (or a thin adapter) maps an authenticated Meridian identity → a Hyperia agent token, so one human consent + one Nuts session covers both. ACP `Act` resolves to a Hyperia consent grant locally; the Nuts scope gates whether the capability is offered at all.

## 6. Implementation phases

1. Meridian app connects to the Hyperia sidecar (9800): read `skills` → orient, subscribe to the tool surface; renderer reaches it through main (like 9123 / window.meridian), never raw.
2. Map ACP capabilities → Hyperia MCP tools + `/api` (generated, per the From<&AcpCapability> projection); ACP `Act` → `perms.rs` consent grant.
3. Render sticky notes as display panes (multi-display routing); agent authors via `sticky_note_*`.
4. Auth bridge: Meridian identity ↔ `hyp_agent_` token; reconcile with Nuts JWT (§5).
5. Unify search: radio transcripts + userdata logs into the lume index already backing sticky/log search; add Shivvr vectors.

## 7. Acceptance criteria

- Meridian app drives Hyperia tools over 9800 with the renderer never holding a raw socket or token (main-process brokered).
- An ACP `Act` triggers a Hyperia consent prompt (default-ON enforcement) and is recorded in `audit.rs` — no second gate built.
- Sticky notes render as panes and route to displays; agent creates/updates/schedules them via MCP.
- One human consent + Nuts session spans local (hyp) and service (JWT) without double-prompting.
- Sticky + log + transcript search resolve offline through the shared lume index.

## 8. Open questions

- Exact Nuts-JWT ↔ `hyp_*` bridge point (sidecar middleware vs. app adapter).
- Whether Meridian uses Hyperia's terminal/web-pane tools at all, or only sticky/search/agent (lean: sticky + search + agent + screenshots; skip terminal-driving on the boat).
- rmcp 0.15 streamable-HTTP client on the Electron main side vs. a thin REST shim over `/api`.
- Ferricula memory: ship on the boat or coastal-only.
