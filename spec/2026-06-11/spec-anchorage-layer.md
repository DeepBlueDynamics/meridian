# spec-anchorage-layer.md

_Revised: 2026-06-11 (UTC)_

**Component:** Anchorage & local-knowledge layer
**Status:** Designed in conversation; sample crawl validated (St. Thomas/St. John). Not yet built.
**License posture:** Apache-2.0 code. OSM/OpenSeaMap data is ODbL (attribution + share-alike) — kept architecturally **separate** from Meridian-owned UGC so share-alike never entangles owned data. Enrichment is summarize-and-cite only; no third-party review text is stored or redistributed.

---

## 1. Objective

Collapse the "anchorage notes" app (ActiveCaptain / NoForeignLand / Navily) into Meridian as a tiered layer the copilot can read: an owned, offline-first foundation plus opportunistic online enrichment, all on infrastructure the boat controls.

## 2. Three tiers

1. **Foundation (owned + OSM, cached, offline-first).** Anchorage *locations and facilities* from OSM/OpenSeaMap (`seamark:type=anchorage`, marinas, services) under ODbL, plus Meridian's own first-party reviews/notes. Always available offline.
2. **Enrichment (online, opportunistic).** On-the-fly crawl + summarize of genuinely public, individually-authored content (cruising blogs, forums) with citation. Never the foundation; degrades gracefully offline.
3. **Cache-warming (bridge).** Pre-departure pass: for a chosen region, run enrichment while online and persist summaries so they're available later with no signal.

## 3. Data model

Three stores, deliberately separate:

```
osm_locations        (ODbL)   { id, geom, seamark_type, name, facilities[], attribution, osm_version }
meridian_notes       (owned)  { id, location_ref, author, body, rating, conditions{wind,holding,depth}, created_at }
enrichment_cache     (derived){ location_ref, summary, citations[{title,url,fetched_at}], ttl, region_tag }
```

`location_ref` joins owned/derived data to OSM locations *by coordinate proximity*, not by name (the sample crawl surfaced two "Honeymoon Beach"es — disambiguate by geom). Owned and OSM stores never merge into one table.

## 4. Enrichment pipeline

`discover → crawl → index → summarize+cite → cache`

- **Discover:** Lume/Grub crawl of public pages; optional SerpAPI for breadth (online-only, paid, third-party — not load-bearing; prefer local Grub).
- **Crawl:** `lume crawl` into the local store.
- **Index:** `lume index -s -o` (semantic + entity graph), local Ollama preferred.
- **Summarize+cite:** copilot extracts *facts* (location, depth, holding, mooring counts, fees, hazards — freely usable) and *summarizes sentiment in original words with source attached*. Verbatim review text is never stored.
- **Recency:** dedup with recency weighting (the sample surfaced a stale $15 vs current $26 NPS mooring fee — recent must win).
- **Safety preservation:** never smooth away safety-relevant distinctions (e.g., "moorings not maintained" vs NPS-maintained).

## 5. Copyright & ToS rules (enforced in code)

- Facts extractable; expression summarized-and-cited, never reproduced.
- No bulk ingestion or redistribution of walled-platform UGC (NoForeignLand, ActiveCaptain, Navily). Prefer open/public sources.
- ActiveCaptain, if used, goes through Garmin's official SDK under its ToS — separate adapter, not crawled.

## 6. Hooks

- **Signal K:** own-ship position drives "anchorages near me"; anchor-watch state can attach a note prompt.
- **Lume MCP:** copilot queries the indexed corpus to answer "what's the anchorage at X like?" with citations.
- **MCP exposure:** the layer is itself an MCP resource the copilot reads.

## 7. Acceptance criteria

- With no connection, foundation + warmed cache answer anchorage queries from local data only.
- Every enrichment answer carries citations; no stored verbatim review text (audited).
- Owned UGC store is provably independent of the ODbL store (no share-alike entanglement).
- Coordinate-based disambiguation resolves duplicate-name anchorages correctly.

## 8. Open questions

- Cold-start seeding strategy for owned reviews (the foundation's empty-at-launch problem).
- Whether to offer opt-in contribution back to OSM for location corrections.
