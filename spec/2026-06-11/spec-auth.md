# spec-auth.md

_Revised: 2026-06-11 (UTC)_

**Component:** Nuts Auth — identity & entitlement for the Meridian service layer, ACP, Shivvr, and grubcrawler
**Status:** Auth service exists (`auth.nuts.services`); this spec defines how Meridian consumes it.
**Deploy:** GCP-native, alongside the Cloud Run service layer. Same `nuts.services` identity domain across the stack.
**License posture:** Apache-2.0 integration. JWT-based.

---

## 1. Objective

One identity domain — **Nuts Auth** — issues JWTs that authenticate and authorize every Meridian surface: the Cloud Run service-layer endpoints, ACP capability calls, **Shivvr** search, and **grubcrawler** research. The same token works across all of them, so there is one source of truth for *who* and one place that owns *how much*. Critically, auth must not break the sovereignty guarantee: a boat with no signal still runs its paid software.

## 2. Token model

- **JWT, signed.** The gateway validates tokens **locally** against the Nuts Auth public key (JWKS) — no per-call round-trip to the auth service. This keeps ACP fast and keeps validation working through a brief auth-service blip (validate from cached JWKS).
- **One token, whole stack.** The same JWT authorizes the service layer, ACP, Shivvr, and grubcrawler. A boat authenticates once; its agent carries the token everywhere.
- **Claims carry entitlement** (not a parallel bookkeeping system):
  ```
  sub:    account/boat id
  tier:   "coastal" | "sovereign"
  scopes: ["route.compute","weather.field","infer.complete","fleet.observe", ...]
  exp:    expiry (see §5 for the sovereign long-grant rule)
  quota:  optional embedded hints; authoritative usage counted service-side by sub
  ```

## 3. The ACP `boat_token` is a Nuts Auth JWT

- Every `/acp/call` and every `/tiles|/weather|/ocean|/bathy|/route|/research|/infer|/fleet|/panes` request carries the JWT.
- Gateway flow: verify signature (local JWKS) → check `exp` → resolve `sub` → read `tier` + `scopes` → enforce.
- **Tier gating:** `AcpCapability.min_tier` checks the `tier` claim.
- **Scope gating:** each ACP capability id **is** an OAuth-style scope (`route.compute`, `infer.complete`, …). A capability call requires its scope in the token. This is how third parties write Meridian-compatible agents without god-tokens — they get scoped JWTs.
- **Quota:** the two spend risks (Google tiles, inference) are counted service-side keyed to `sub`; the gateway rejects over-quota with a clean, retryable error. Identity = Nuts; usage accounting = Meridian service.

## 4. Double-gated `Act` (the safety upgrade)

A control-class capability (`mode = Act`) now requires **both**:
1. **Boat-side single-tap confirm** — human presence/intent (the `tool_mount` queue-and-drain seam).
2. **Token scoped for that action** — authorization.

A guest who reaches the screen and hits the wake word cannot trigger control: the active session's JWT isn't scoped for `Act`. Tap = presence; scope = authorization; both required. That's the ACL model with real teeth.

## 5. Sovereignty rule (auth must not lock the boat out mid-ocean)

This is the one place auth and sovereignty pull against each other, resolved explicitly:

- A bluewater boat can't reach `auth.nuts.services` to refresh a token. The sovereign tier's promise is it works **alone**.
- **Rule:** the sovereign client carries a **long-lived, locally-verifiable signed grant** (generous `exp`), refreshed **opportunistically when online**. The boat verifies it against cached JWKS locally — no live auth call needed to keep functioning.
- **Core function never depends on a live auth call.** Authenticate online; carry an offline-valid signed grant; the boat's local agent, routing, search, and floor keep working with the network down until the grant's (long) expiry.
- Coastal tier can use shorter-lived tokens (it's online by definition) refreshed normally.

## 6. Shivvr & grubcrawler share the token

- **Shivvr** (embeddings/search) and **grubcrawler** (agentic crawl/research) accept the same Nuts Auth JWT. `search.query` (Shivvr/Lume) and `research.report` (grubcrawler) authorize off the same `sub`/`scopes`/`tier`.
- This is what makes the combined-search and research capabilities first-class ACP citizens: no separate credential, one entitlement check, consistent quota accounting across search, crawl, routing, and inference.

## 7. Implementation phases

1. Gateway JWT middleware: local JWKS verification + `sub`/`tier`/`scopes` extraction; reject/expire handling.
2. Scope ↔ ACP-capability mapping; tier gating; service-side quota counters keyed to `sub` (tiles + inference first).
3. Double-gated `Act` (tap + scope) over the existing queue-and-drain.
4. Sovereign long-grant issuance + offline local verification + opportunistic refresh.
5. Shivvr + grubcrawler accept the same JWT; unified quota accounting.

## 8. Acceptance criteria

- One JWT authorizes the service layer, ACP, Shivvr, and grubcrawler; validated locally with no per-call auth round-trip.
- Tier and scope are enforced from claims; over-quota (tiles/inference) returns a clean retryable error counted by `sub`.
- No `Act` executes without **both** a single-tap confirm and a scoped token (verified by test).
- A sovereign boat with the network cut keeps running on its signed grant past a simulated auth-service outage; it does not lock out mid-passage.
- A scoped third-party JWT can call only its granted ACP capabilities.

## 9. Open items

- Grant lifetime for the sovereign tier (long enough to cross an ocean + margin; balance against revocation latency).
- Revocation strategy for locally-validated JWTs (short JWKS/blocklist cache TTL vs. offline tolerance — direct tension with §5; pick a TTL that protects spend without locking out bluewater boats).
- Whether quota hints ride in the token or are fetched/cached at session start (lean: authoritative service-side, optional in-token hint).
