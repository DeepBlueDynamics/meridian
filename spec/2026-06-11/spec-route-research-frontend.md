# spec-route-research-frontend.md

**Component:** Route research (frontend) — from/to picker, route views, along-the-way narrative
**Spec-ID:** route-research-frontend
**Version:** v1
**Status:** draft
**Revised:** 2026-06-11 (UTC)
**Depends-on:** spec-route-research, spec-signalk, spec-wind-current-layers, spec-chart-style, MERIDIAN-VIZ-PLAN
**Referenced-by:** —
**Supersedes:** —
**License-posture:** Apache-2.0. Renderer only — consumes the `RouteResearch` product (spec-route-research) via the main-process bridge; never crawls or fetches itself.

---

## 0. Objective

Present the backend `RouteResearch` product on the ROUTING view: let the user set **From/To**, show the **route(s)** on the chart/globe with **waypoints**, surface **what's along the way** (anchorages, services, hazards, notices) as an itinerary the sailor can read, and let them pick between **multiple route variants**. Renders the kind of passage narrative a cruising article carries — but live, on their chart, for their boat.

## 1. Set From / To

- **To** is the primary action: chart tap, search box, or voice ("take me to Cabo"). Setting it kicks the backend job (spec-route-research) and shows a **researching…** state (grub is crawling — show progress, not a dead spinner; stream partials if available).
- **From** defaults to **own-ship** (Signal K position; "where we are" resolved to a place name). Shown as an editable chip — tap to override (plan a future passage from elsewhere).
- Both render as the existing DEP/ARR boxes (the routing view's `.rbox.dep/.arr` pattern), so this reuses known chrome.

## 2. The route on the chart (primary view)

- Draw the **track** (ordered waypoints) as a route line over the chart/globe, waypoint markers tappable.
- **Color/role:** the route line uses route color (amber envelope family); own-ship + live data stay in their colors (cyan measured — never blended, per spec-wind-current-layers).
- **Fused with weather** (spec-route-research §4): toggle between **Research route** (the via-waypoints from the web) and **Optimized route** (ensemble router between them) — or show both, the research track faint and the weather-optimized line bright.
- Tapping a waypoint opens its **detail pane** (§4).

## 3. Multiple routes

- When the backend returns >1 variant (e.g. "fast 3-stop" vs. "slow exploratory"), show them as **selectable route cards** (label, distance, #stops, 1-line summary). Selecting one draws it; the others ghost.
- Each card: distance, est. duration (from polar+weather), stop count, and the agent's ≤2–3 sentence paraphrased summary. **Source-linked.**

## 4. Along-the-way itinerary (the "what's along the way" payoff)

A scrollable itinerary down the route — one entry per waypoint/leg, in order:

- **Waypoint card:** name, kind (port-of-entry / anchorage / fuel stop), **services** (fuel/water/wifi/provisions chips), **shelter** note, **clearance** info (e.g. "one-stop port captain; TIP + fishing license"), and a **"confirm against chart"** flag if `approx`.
- **Leg card** (between waypoints): distance, overnight?, expected conditions, and any **hazard** ("reefs off the point — give wide berth", "no anchorages for ~170 nm", "crab pots, hard to spot at night") with a severity dot.
- **Every card cites its source** — a small "via Sail Magazine / Cruisers Forum" link. Tapping opens the original (we link, never reproduce).
- Selecting a card flies the chart to that waypoint (ties the narrative to the map).

## 5. Notices along the corridor

- Overlay live marine **notices/warnings** (spec-weather-overlays NWS layer) that intersect the route corridor as flagged markers + itinerary entries ("Special Marine Warning active near leg 4 until 16:15").
- Feed the same into the agent/alarm hook so the copilot can volunteer them ("heads up — warning along your route").

## 6. States & offline

- **Researching / partial / complete / failed-(cached)** — always show *something*; a grub outage shows the **last cached research** with an "as of <time>" stamp.
- Fully offline: the cached `RouteResearch` + cached corridor tiles render; no live crawl, clearly marked stale.
- The whole product is cached to the boat (spec-userdata), so a route researched at the dock is fully readable mid-ocean.

## 7. Acceptance criteria

- Setting To (with From defaulting to own-ship, overridable) triggers research and renders the track + waypoints on the chart.
- Multiple variants show as selectable cards; selecting one draws it and ghosts the rest.
- The along-the-way itinerary lists waypoints + legs in order with services, shelter, clearance, hazards, and **per-entry source links** (no reproduced article text).
- Research vs. weather-optimized route is toggleable; live measured data never blends into the route/forecast.
- Corridor notices appear on map + itinerary and reach the agent/alarm hook.
- Everything renders offline from cache with a staleness stamp.

## 8. Open questions

- Itinerary as a side panel vs. a bottom sheet vs. a dedicated "Passage" sub-view of ROUTING.
- How prominently to surface the "advisory — confirm against chart" caveat without nagging.
- Voice surfacing: does the copilot read the passage brief on request ("brief me on the route")?
- Multi-display: push the itinerary to the salon screen while the helm shows the chart?
