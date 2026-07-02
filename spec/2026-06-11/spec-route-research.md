# spec-route-research.md

**Component:** Route research (backend) — GRUB-crawled passage intelligence → agent → waypoints/track/POIs/notices
**Spec-ID:** route-research
**Version:** v1
**Status:** draft
**Revised:** 2026-06-11 (UTC)
**Depends-on:** spec-backend-services, spec-service-layer, spec-signalk, spec-anchorage-layer, spec-userdata, spec-auth
**Referenced-by:** spec-route-research-frontend, spec-routing
**Supersedes:** —
**License-posture:** Apache-2.0. Uses **grub** (deployed for Meridian, `grub.nuts.services`, agent in the loop). **Crawl/cite discipline (spec-anchorage-layer): facts + cited summaries, never verbatim bulk, no redistribution of paywalled article text.**

---

## 0. Objective

When a sailor sets a destination, **research the passage from the web** and turn it into a usable route product: a **track of waypoints**, **points-of-interest / anchorages along the way**, **hazards and notices**, and (if found) **multiple route variants** — so Meridian can show "here's how people actually make this trip, what's along the way, and what to watch for," not just a great-circle line. Example shape: a San Diego→Cabo piece yields the stop sequence (Ensenada, Turtle Bay, Bahía Santa María, …), shelter/hazard notes, clearance info, and the fast-vs-slow route choice. This is a **backend** spec; the presentation is `spec-route-research-frontend`.

## 1. Trigger & inputs

- **From** = the boat's current position (already known from Signal K `navigation.position`, or last-known). **Default, overridable** by the user.
- **To** = the destination the user sets (chart tap / search / "take me to Cabo").
- Resolve both to **place names + coords** (reverse-geocode "where the hell are we" → "33.1°N 117.3°W · San Diego"; geocode the destination).
- Setting **To** is the **intent signal** (strategy: destination-tap = intent): kick the research job, pre-warm the free-tile corridor, cache the landfall (`spec-anchorage-layer`).

## 2. The flow (backend)

```
user sets To ──▶ resolve from(name,coords) + to(name,coords) + vessel context
   │
   ├─▶ grub.nuts.services  (research.report, agent in the loop)
   │     query: "<from> to <to> sailing passage" + cruising-route synonyms
   │     crawl: cruising guides, blogs, forums, port/clearance pages, notices-to-mariners
   │     returns: cited corpus (facts + summaries, no verbatim bulk)
   │
   ├─▶ back end receives the corpus
   │
   └─▶ AGENT fills out the route product from the corpus:
         • extract the ordered WAYPOINTS → a TRACK
         • attach POIs / anchorages / services per leg
         • attach HAZARDS + NOTICES (reefs, bars, crab pots, surf landings, clearance)
         • detect MULTIPLE ROUTE VARIANTS (e.g. fast 3-stop vs. slow exploratory)
         • cite every claim to its source
   ──▶ structured RouteResearch product, cached to the boat (spec-userdata)
```

## 3. Output: the `RouteResearch` product (the contract the front end reads)

```jsonc
{
  "from": {"name":"San Diego, CA","lat":32.71,"lon":-117.17,"source":"ownship"},
  "to":   {"name":"Cabo San Lucas","lat":22.89,"lon":-109.91},
  "generated_at":"...", "vessel":{"draft_m":2.1,"type":"sail"},
  "routes":[
    {
      "id":"slow-exploratory", "label":"Slow route · more anchorages",
      "summary":"<=2-3 sentence agent summary, paraphrased>",
      "distance_nm": 760, "legs": [
        {
          "from_wp":"ensenada","to_wp":"isla-cedros","distance_nm":180,
          "notes":"overnight; patchy NW wind","sources":["url#1"]
        }
      ]
    },
    {"id":"fast-direct","label":"Fast route · 3 stops","distance_nm":740,"legs":[...]}
  ],
  "waypoints":[
    {"id":"ensenada","name":"Ensenada","lat":31.86,"lon":-116.62,
     "kind":"port_of_entry",
     "services":["fuel","water","wifi","provisions"],
     "clearance":"one-stop port captain; TIP + fishing license required",
     "shelter":"marina; protected",
     "sources":["url#2"]},
    {"id":"abreojos","name":"Punta Abreojos","lat":26.71,"lon":-113.58,
     "kind":"anchorage","shelter":"rolly; anchor ~5nm E of village",
     "sources":["url#3"]}
  ],
  "pois":[
    {"wp":"santa-maria","name":"Bahía Santa María","note":"crescent bay, well protected, itinerant fish camp","tags":["anchorage","calm"],"sources":["url#4"]}
  ],
  "hazards":[
    {"near":"abreojos","type":"reef","text":"reefs off the point — 'open your eyes', give wide berth","severity":"high","sources":["url#3"]},
    {"leg":"sandiego-ensenada","type":"obstruction","text":"crab pots near shore; hard to spot at night","severity":"med","sources":["url#5"]},
    {"leg":"magdalena-cabo","type":"open_water","text":"no decent anchorages for ~170nm — plan an overnight","severity":"info","sources":["url#6"]}
  ],
  "notices":[ /* live NWS/marine warnings along corridor — spec-weather-overlays */ ],
  "citations":[{"id":"url#1","title":"...","publisher":"...","url":"..."}]
}
```

Rules: every `notes/shelter/hazard/clearance` field is **agent-paraphrased**, ≤2–3 sentences, **cited**. No article paragraphs reproduced. Coordinates the agent can't verify are flagged `"approx":true` (a synthesized waypoint is a *suggestion to confirm*, never an authoritative fix).

## 4. Relationship to the ensemble router (`spec-routing`)

Two route sources, complementary — **research gives the "via", the router gives the "how":**
- **RouteResearch waypoints** = human/local-knowledge constraints (stop here, pass outside that reef, clear in there).
- The **ensemble weather router** (`lib/router.js`) then optimizes the **legs between** those waypoints given wind/polars/current — seeded/constrained by the research track.
- Result: a route that follows where people actually go **and** is weather-optimal between stops. The front end can show research-only, router-only, or the fused route.

## 5. Safety / discipline

- Synthesized waypoints/hazards are **advisory** — labeled "from cruising reports, confirm against charts." Never presented as surveyed data. The chart (`spec-chart-style`) remains authoritative.
- Cite-or-omit: an un-sourced claim is dropped, not guessed.
- Copyright: facts + short paraphrase + link; never reproduce article bodies (the Sail piece is read, distilled, and **linked**, not copied).
- Auth/cost: one Nuts JWT; `research.report` quota per `sub`; async job + cache (`provider_chain` ends in last cached research — spec-backend-services §1).

## 6. Phases

1. Resolve from(ownship)/to(user) → place names + coords; emit the intent signal.
2. Call grub `research.report` with the passage query; receive cited corpus.
3. Agent fill: corpus → `RouteResearch` (waypoints→track, POIs, hazards, notices, variants), every claim cited.
4. Cache to boat (`spec-userdata`); pre-warm corridor tiles + landfall (`spec-anchorage-layer`).
5. Hand `RouteResearch` to the ensemble router as optional waypoint constraints (§4).

## 7. Acceptance criteria

- Given From (ownship-default, overridable) + To, the backend returns a `RouteResearch` with an ordered waypoint track, per-leg notes, POIs, hazards, notices, and ≥1 route variant (≥2 when the web supports it).
- Every textual field is paraphrased + cited; no verbatim article text; unverifiable coords flagged `approx`.
- Product caches to the boat and serves offline; grub outage falls back to last cached research.
- Research waypoints can seed the ensemble router as constraints.

## 8. Open questions

- Waypoint coordinate confidence: geocode/gazetteer vs. agent-proposed-from-text — how to mark and confirm.
- De-duping/merging multiple sources describing the same stop into one waypoint.
- How far off the rhumb line to crawl ("along the way" corridor width) and how many variants to surface.
- Refresh policy: re-run on weather change / time elapsed / user request.
