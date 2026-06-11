# spec.md — Google Photorealistic 3D Tiles (ToS & proxy)

_Revised: 2026-06-11 (UTC)_

**Component:** Google Photorealistic 3D Tiles integration + proxy
**Status:** Demo confirmed working with a real key (`google-3d-tiles-marine-demo.html`). This spec covers the production proxy + ToS compliance.
**Referenced by:** `spec-service-layer.md` (`/tiles`), `spec-auth.md` (quota by `sub`).
**License posture:** Google Maps Tile API ToS-bound — key never ships to the client; attribution mandatory; caching/redistribution only as ToS permits.

---

## 1. Objective

Serve Google Photorealistic 3D Tiles to the boat **through the Cloud Run proxy** with the API key hidden server-side, ToS honored, and quota accounted per boat — with a free-data fallback so coverage exists everywhere Google doesn't (the global-coverage wedge).

## 2. ToS-driven requirements (the load-bearing constraints)

- **Key hiding:** the Google Maps API key lives only in the service; the client receives proxied tiles, never the key.
- **Attribution:** Google attribution (Cesium credits + data attributions) must remain visible wherever tiles render. Do not strip credits.
- **Caching/redistribution:** cache only within ToS limits; do not build a redistributable Google-tile archive. Pre-warming the route corridor for offline is bounded by ToS — beyond that bound, fall back to free maps (do not over-cache Google tiles for indefinite offline use).
- **Sessions/quota:** Google 3D Tiles use a session/root-request model. Account requests per boat (`sub`) so a heavy user can't blow the shared quota; surface cost per `sub` (tiles is one of the two spend risks alongside inference).
- **BYO-key tier:** for heavy/commercial users, support a bring-your-own-Google-key tier so their usage bills to them, per ToS, instead of the shared key.

## 3. Proxy behavior (`/tiles`)

- Authenticated (Nuts Auth JWT) tile requests → service injects key → Google → streamed back with attribution intact.
- **Free-map fallback:** where Google is thin/absent or ToS-bounded caching is exhausted, serve PMTiles/raster from free SOTA data (OSM/OpenSeaMap basemap, NOAA ENC-derived vector). Client selects source by connectivity + entitlement; the boat caches the corridor (free data has no redistribution ceiling; Google does).
- Pricing reality (verify current): Google 3D Tiles bill per session/root request with a monthly free allotment; the prior universal credit has lapsed — model real per-`sub` cost.

## 4. Acceptance criteria

- Client renders Google 3D tiles without ever receiving the key; attribution always visible.
- Per-`sub` quota enforced; over-quota degrades to free maps, not an error.
- Offline corridor uses free-data cache where Google ToS forbids caching.
- BYO-key tier routes a user's usage to their own key.

## 5. Open items

- Confirm current Google 3D Tiles pricing/session model and free allotment.
- Exact ToS caching bound vs. the destination-intent pre-warm — where Google cache ends and free-map cache begins.

---

## 6. Multifunctional tile proxy — two classes, opposite caching rules (load-bearing)

`/tiles` is **one endpoint serving two tile classes with opposite caching postures**. This is the offline story; get the split wrong and either the boat goes blank offline or you violate Google ToS.

| | **Google 3D Tiles** | **Free-data tiles** (OSM/OpenSeaMap, NOAA ENC→PMTiles, GEBCO, seamarks) |
|---|---|---|
| Proxy role | thin pass-through, key hidden, quota by `sub` | cache-and-serve CDN |
| Caching | **online-use only; NOT durably cached** (ToS) | **cached aggressively; corridor pre-warmed** (no license ceiling) |
| Availability | online + entitled + within ToS cache bound | online (proxied) **and** offline (from cache) |
| Role | premium online experience | **offline-first foundation + coverage where Google is thin** |

### 6.1 Source selection (automatic, client-side, with style continuity)

```
source = if online && entitled_to_google && within_google_tos_cache_bound
            → Google 3D   (proxied, not durably cached)
         else
            → free tiles  (proxied if online & uncached; served from cache if offline)
```

- The client **always has the free corridor cached underneath** the Google view, so signal loss swaps to free tiles **instantly, same viewport, no blank globe** — with a quiet "offline maps · free data" indicator, not an error.
- The boat **never holds a Google key** and **never assumes Google is available offline**.

### 6.2 Pre-warm warms the FREE layer

The destination-intent pre-warm caches **free** corridor tiles (and bathy/seamarks), regardless of whether the user is currently viewing Google. Google may be the on-screen layer while online, but the durable offline cache is always free-data. This is both the ToS-safe path and the safety net under every Google view.

### 6.3 Three failure modes (must be handled, not discovered at sea)

1. **Mid-passage signal loss** → swap Google→free instantly from the pre-warmed cache; same viewport.
2. **Google ToS cache boundary (even online)** → past the bound, the corridor is already covered by cached free tiles.
3. **Coverage gaps** (remote waters, thin Google + thin official charts) → synthesize from free data (OSM/OpenSeaMap + bathy + crawled local knowledge). The global-coverage wedge lives here.

### 6.4 ACP declaration

`tiles.fetch` is a **two-source capability**: Google is online-only (effectively `OfflineFallback::None` for the Google source specifically), but the *capability* falls back to `OfflineFallback::Cache` on the free layer — so the capability never goes dark, it changes source. Declare it honestly as "Google online-only; free-tiles cached," not as a single source with a bolted-on fallback.
