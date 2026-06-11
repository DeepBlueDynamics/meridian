# spec-service-usage.md

**Component:** Using the deployed Meridian service — auth, discovery, A2A calls, tiles, transcription (the integrator's contract)
**Spec-ID:** service-usage
**Version:** v1
**Status:** active — documents the service as deployed 2026-06-11; updated as endpoints land.
**Revised:** 2026-06-11 (UTC)
**Depends-on:** spec-service-layer, spec-a2a-and-search, spec-auth, spec-backend-services
**Referenced-by:** — (written for the frontend/app agent and third-party A2A clients)
**Supersedes:** —
**License-posture:** Apache-2.0. This is the consumer-facing contract; design rationale lives in the specs above.

---

## 1. Objective

Everything a client — the Electron app, the boat's standalone agent, or a third-party A2A agent — needs to *use* the running Meridian service: where it is, how to authenticate, how to discover and call skills, how to fetch tiles, and how to transcribe audio. Copy-pasteable shapes, exact error semantics, and an honest table of what's live versus declared.

## 2. Base URLs

| Surface | URL |
|---|---|
| **Canonical** (once DNS propagates) | `https://meridian.deepbluedynamics.com` |
| Direct Cloud Run (works today) | `https://meridian-service-ugcdy6vw7a-uc.a.run.app` |
| Login (hosted by Nuts Auth) | `https://auth.nuts.services/login?return_url=<your-page>` |

The backends (`meridian-grub`, `meridian-shivvr`, `meridian-transcribe`) have **no public domains and must never be addressed directly** — everything goes through the gateway, which enforces auth, tier, scope, and quota uniformly.

## 3. Authentication

1. **Humans:** send the browser to `https://auth.nuts.services/login?return_url=<page>`. Nuts Auth (magic-link email, Google, or GitHub) redirects back with `?token=<jwt>`. Store it (the dashboard uses `localStorage.meridian_jwt`), scrub the URL.
2. **Agents/machines:** exchange a long-lived API token at Nuts Auth's `POST /auth` for a JWT.
3. **Every API call** carries `Authorization: Bearer <jwt>`. The gateway validates RS256 signatures locally against cached JWKS — no per-call auth round-trip, and a brief auth-service outage does not break validation.
4. **Claims that matter:** `sub` (account/boat id — quota is counted against it), `scopes` (**each A2A skill id is a scope**: a call to `route.compute` requires `"route.compute"` in the token), `tier` (`coastal`|`sovereign`; absent = coastal), `exp` (note: a ~60s validation leeway applies past expiry).
5. **Auth failures:** `401` missing/invalid/expired token · `403` valid token but missing the skill's scope or tier · `503` auth keys unavailable (retry).

## 4. Discovery — the Agent Card

`GET /.well-known/agent.json` (public). Lists every skill with the standard A2A fields plus the `x-meridian` extension:

```json
{
  "id": "transcribe.audio",
  "x-meridian": {
    "mode": "read",                      // read | advise | act (act ⇒ single-tap confirm + scope)
    "cost_class": "inference",           // free | metered | inference | tiles
    "min_tier": "coastal",
    "offline_fallback": {"kind": "local_model"},
    "provider_chain": ["whisper-local", "whisper-cloud", "openai"]
  }
}
```

Read it once per session and cache it: it tells you what you can call, what it costs, and what to do offline **before** you call. `provider_chain` is the ordered fallback the service runs server-side; the first/last local-or-cached entry is the floor the boat always keeps.

## 5. Calling skills — `POST /a2a` (JSON-RPC 2.0)

```json
{
  "jsonrpc": "2.0", "id": 1, "method": "message/send",
  "params": { "message": { "metadata": { "skill": "weather.field" },
                           "parts": [{ "kind": "data", "data": { /* skill input */ } }] } }
}
```

The target skill id goes in `params.message.metadata.skill`. Error codes a client must distinguish:

| Code | Meaning | Client action |
|---|---|---|
| `-32601` | method not supported | only `message/send` today |
| `-32600` | malformed params / missing skill id | fix the request |
| `-32004` | **unknown skill** | wrong id — check the Agent Card |
| `-32005` | skill declared, **executor not yet implemented** | use your offline fallback; retry in a later release |
| `-32006` | authenticated but **not scoped / wrong tier** | request a properly scoped token |

`Act`-mode skills will park as A2A `input-required` tasks pending boat-side single-tap confirm (phase 7; none executes today).

## 6. Tiles — two classes, opposite caching rules

- `GET /tiles/google/{path}?session=...` — Google 3D pass-through, key injected server-side. Response is **`Cache-Control: no-store` and clients MUST honor it** (Google ToS; never durably cache these). `503` until the key is configured.
- `GET /tiles/free/{path}` — free-data tiles; upstream cache headers pass through — **cache these aggressively**, pre-warm the route corridor; this layer is the offline foundation under every Google view.
- Client source-selection: `online && entitled && within-ToS-bound → google, else → free` — signal loss swaps source on the same viewport, never a blank globe.

## 7. Transcription — drop-in for the boat-local contract

Identical to the local Whisper server, so a resolver only swaps the base URL:

```
POST /transcribe          multipart: file (audio/wav), job_id, model      → {"status":"queued","job_id":...}
GET  /status/{job_id}     → {"status":"queued|running|completed|failed", "backend":"whisper-cloud|openai"}
GET  /download/{job_id}   → transcript text
```

Rules: the boat's local Whisper is **always the floor** and runs regardless; upload only with the user's per-class **opt-in toggle ON and online**; offline-with-no-local queues WAVs locally. `backend` reports which provider answered. Audio is processed transiently server-side — nothing retained past the job, results expire after 1 h. `503` = backend unreachable: keep the local transcript / keep the WAV queued.

## 8. Web surface (humans)

`/` splash with login · `/dashboard` post-login capabilities view (renders the Agent Card, lights skills in the token's scope) · `/health` liveness.

## 9. Live today vs declared

| Live now | Declared, executor pending (`-32005`) |
|---|---|
| Agent Card, `/a2a` dispatch + auth/scope/tier gating | `weather.field`, `ocean.field`, `bathy.field` (phase 2) |
| `/tiles/free` proxy (google pending key) | `route.compute` (phase 3), `research.report` → meridian-grub, `search.query` → meridian-shivvr (phase 5 wiring) |
| `/transcribe` + `/status` + `/download` → meridian-transcribe (CPU/base; GPU large-v3 = issue #10) | `infer.complete`, `fleet.*`, `panes.*`, `/userdata` (issue #8) |
| Splash, dashboard, nuts-auth login | per-`sub` quota counters (issue #1) |

## 10. Integration checklist (frontend)

1. Link login to `auth.nuts.services/login?return_url=<origin>/dashboard`; catch `?token=`, store, scrub URL.
2. Fetch + cache the Agent Card once per session; drive capability UI from it (including dimming unscoped skills — decode the JWT payload client-side for `scopes`).
3. Call skills via `/a2a` with the bearer; treat `-32005` as "use offline fallback," never as an error dialog.
4. Honor the tile caching split (§6) exactly.
5. Wire the radio resolver to `/transcribe` as the cloud leg (local → service → queue), gated by the opt-in toggle.

## 11. Open questions

- Streaming (`message/stream` SSE) lands with the long-running task work (phase 4) — until then poll.
- BYO-key tier for heavy Google-tiles users (per spec-google-3d-tiles).
- Whether the dashboard gains usage/quota visibility per `sub` once counters exist (issue #1).
