# spec-fleet-network.md

_Revised: 2026-06-11 (UTC)_

**Component:** Fleet data network — opt-in, anonymized, reciprocal
**Status:** Designed in the strategy doc; not built. **Blocks `spec-service-layer.md` phase 6** (`/fleet`).
**Referenced by:** `spec-service-layer.md` (`/fleet`), `meridian-strategy-v3.md` (the compounding moat).
**License posture:** Apache-2.0. Contributed data is the user's, shared by explicit opt-in; aggregates are Meridian's to serve back.

---

## 1. Objective

A cruiser-owned observation network: boats **contribute** conditions and anonymized passage outcomes and **receive** the aggregate back. Meridian keeps the *observation* (wind/current at a grid cell, anonymized passage times → routing truth) and **never** holds a boat's identity or live track. This *strengthens* the sovereignty story instead of betraying it — it's mutual aid, not surveillance.

## 2. Non-negotiable privacy model

- **Opt-in, explicit.** Default off. Framed as a co-op: "contribute your conditions, get everyone's back."
- **Anonymized at ingest.** Strip vessel identity before storage. You want *the wind at this grid cell*, not *that identified boat's track*.
- **Spatially fuzzed.** Position contributions snap to a grid cell, not a precise breadcrumb. No reconstructable track.
- **Reciprocity is the incentive.** The reason to opt in is the aggregate you get back (anchorage truth, routing validation, "boats like yours").
- **Never released:** boat identity, continuous position, anything that re-identifies. "A node near here reports 18 kt" — never "SV Whatever is at this lat/long."

## 3. Endpoints (`/fleet`)

- `fleet.contribute` (ACP, `mode: Read`-class write to the co-op): submit `{ grid_cell, time, wind?, current?, baro?, sea_state? }` and/or a **completed-passage record** `{ from_cell, to_cell, vessel_class, elapsed, conditions_summary }` — all identity-stripped client-side before send.
- `fleet.observe` (ACP): query the aggregate for a grid cell / corridor → fused live-ish conditions + anonymized passage stats.

## 4. Uses of the aggregate

- **Routing truth:** validate/tune the isochrone engine against *real* boat performance at fleet scale (log-refined polars, fleet-wide).
- **"Boats like yours":** show a new customer anonymized passages by vessel class for a planned route.
- **Anchorage/conditions enrichment:** live observed conditions layered onto the anchorage layer.

## 5. Anonymization pipeline

1. Client strips identity + fuzzes position to grid cell **before** transmission (privacy at the edge, not just server-side).
2. Service aggregates per cell/time; no per-vessel row is retained.
3. K-anonymity threshold per cell (suppress a cell until ≥N contributors) so a lone boat in an empty sea can't be re-identified by its own contribution.

## 6. Acceptance criteria

- Opt-in default off; opting out stops contribution immediately and purges nothing-identifying-was-stored (because nothing identifying is stored).
- No stored record contains vessel identity or a reconstructable track (audited).
- A single contributor in an otherwise-empty cell is suppressed (k-anonymity) — no re-identification.
- `fleet.observe` returns useful aggregate conditions + anonymized passage stats; contributors and non-contributors get a clearly different value (reciprocity).

## 7. Open items

- K-anonymity threshold N and grid-cell size (privacy vs. usefulness).
- Whether passage records carry vessel *class* granularity fine enough to be useful without being identifying.
- Retention window for raw contributions before they collapse into pure aggregates.
