# 02 — Finding Boundaries & Stitching in Bathy

The core problem. We have **harbor views** (Google Photorealistic 3D Tiles —
global, photoreal land/structures). We need to **stitch in bathy**: show the
seafloor where there's water, the photoreal harbor where there's land/docks, and
join them cleanly at the coast.

To do that we must answer one question first: **where is the land/water boundary?**

## Step 1 — Where do boundaries come from?

Ranked by usefulness for a marine app. We can mix sources by zoom/coverage.

### A. S-57 ENC vector layers  ← best for charted harbors (and we already have the pipeline)
Electronic Navigational Charts already encode this exactly:
- `LNDARE` — **land area** polygons
- `DEPARE` — **depth area** polygons, each tagged `DRVAL1`/`DRVAL2` (min/max depth)
- `COALNE` — coastline lines
- `SEAARE`, `DEPCNT` (contours), `SOUNDG` (soundings)

`DEPARE` is gold: it's both the water boundary **and** the bathy (depth-shaded
areas), the same data ECDIS draws. `scripts/convert-s57-to-pmtiles.sh` already
extracts these to a PMTiles archive. Coverage is per ENC cell (download per
region from NOAA/IHO) — not global, but authoritative where it exists. We have a
San Diego cell to spike on.

### B. OSM coastline-derived polygons  ← best global boundary, offline-capable
`https://osmdata.openstreetmap.de/data/` publishes prebuilt, validated global
**`land-polygons-split-3857`** and **`water-polygons-split-3857`** (derived from
OSM `natural=coastline`). Convert once to PMTiles → a single offline file of every
coastline on Earth. This is the global fallback where there's no ENC.

### C. Protomaps / OpenMapTiles basemap `water` layer  ← simplest global, one file
A planet PMTiles basemap (Protomaps) includes a `water` polygon layer. One file,
offline, queryable as vector tiles. Lower marine fidelity than ENC but trivial to
host and global.

### D. DEM elevation threshold  ← fallback only
Terrarium DEM tiles, classify `elevation ≤ 0` as water. Coarse at the coast, no
tide/datum awareness, no harbor detail. Use only to gap-fill.

**Decision:** spike on **S-57 `DEPARE`/`LNDARE`** for the harbor (real depth +
real boundary, already in our pipeline), with **OSM water polygons** as the global
backstop. Both load as vector polygons (GeoJSON now, PMTiles later).

## Step 2 — How to stitch (use the boundary in Cesium)

Three techniques, simplest/most-robust first.

### T1. Drape depth-shaded water polygons (no clipping) ← start here
Render the water/`DEPARE` polygons as **ground primitives** clamped to the globe,
colored by depth (shoal→deep ramp, plus a red "danger < safety contour" band).
Google 3D land sits *above* sea level and naturally occludes the draped polygons
on land; over water there's no Google geometry above the surface, so the
depth-shaded water shows. **No clipping needed → no GL crash risk.** This is the
robust first stitch and gives a real depth chart, not just blue.

```
GroundPrimitive / Entity polygon, classificationType: TERRAIN/ BOTH,
material = depthColor(DRVAL1)   // per DEPARE band
```

### T2. Clip Google to land with ClippingPolygonCollection  ← true hard cut
`Cesium.ClippingPolygonCollection` (1.111+) clips a tileset to inside/outside a
set of polygons. Feed it the **land** polygons (keep Google only on land) or the
**water** polygons with inverse (cut Google out of water). This is a *polygon*
shader path — **different from the `ClippingPlane` path that crashed v1's GL
context** (`UniformSampler._target`), so it's worth testing on its own. If it's
stable here, it's the cleanest true "eliminate Google in water."

```
tileset.clippingPolygons = new Cesium.ClippingPolygonCollection({
  polygons: [ new Cesium.ClippingPolygon({ positions: landRingCartesians }) ],
  // inverse: true  // if feeding water polygons instead of land
});
```

### T3. Translucency blend  ← fallback, no boundary
Make the tileset semi-transparent so bathy mixes through everywhere. No boundary
needed; it's a wash, not a stitch. This is what v1 shipped. Keep as the safety net.

**Plan:** T1 first (robust, real depth, no crash). Then attempt T2 for a true cut
and compare. T3 stays as fallback.

## Step 3 — The boundary-first spike (do this before anything else)

1. Take the San Diego ENC cell → extract `DEPARE`/`LNDARE` to GeoJSON
   (`ogr2ogr`, already in the pipeline) for one harbor.
2. Load that GeoJSON in the Cesium harbor scene and **draw it as a debug overlay**
   (flat colored polygons) — confirm the boundary lines up with Google's coastline.
   This is "track down the boundaries": verify visually that our polygons match
   reality before we rely on them.
3. Once aligned, switch the debug fill to **depth shading (T1)** → bathy is stitched.
4. Then try **T2** (clip Google to land) and decide cut-vs-blend per look.

Open questions to resolve during the spike:
- **Datum/tide:** ENC depths are to chart datum (LAT); Google land is to its own
  model. Expect a small vertical offset at the waterline — tune a sea-level offset.
- **Coverage seams:** where ENC ends, fall back to OSM water polygons; need a
  merge/priority rule.
- **Performance:** how many polygons per view before draping/clipping stutters →
  load by bbox, simplify, or pre-bake to PMTiles.
