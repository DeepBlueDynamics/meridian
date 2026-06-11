# spec-chart-ingestion.md

_Revised: 2026-06-11 (UTC)_

**Component:** Chart ingestion pipeline — S-57 ENC → PMTiles
**Status:** Prototype verified end-to-end (`ingest_enc.sh`); this spec hardens it for production.
**License posture:** Apache-2.0 output. All tools permissive: GDAL (MIT/X11), tippecanoe (BSD-2), go-pmtiles (BSD-3). No GPL anywhere in this path.

---

## 1. Objective

Convert national-feed S-57 ENC cells into offline-first PMTiles archives that MapLibre renders, with every S-57 feature class preserved as an independently styleable vector source layer and depth attributes intact for S-52-style coloring. Offline-first is mandatory: a single range-requestable file per region, no tile server, servable from static storage or bundled on the boat.

## 2. Scope

**In:** cell acquisition, license-safe corpus scoping, per-layer extraction, depth-band encoding, multi-cell merge with usage-band zoom gating, AtoN attribute carry-through, OpenSeaMap overlay, update cadence, S-101 readiness.
**Out:** chart *rendering* (see `spec-chart-style.md`), encrypted/commercial charts (S-63 partnership tier).

## 3. Architecture

Three stages, matching the verified prototype:

1. **Extract** — `ogr2ogr` (GDAL S-57 driver) emits one GeoJSON per cell+layer. Options: `SPLIT_MULTIPOINT=ON`, `ADD_SOUNDG_DEPTH=ON`.
2. **Tile** — tippecanoe consumes all per-layer GeoJSON, each as a named source layer; density-aware dropping at low zoom, no drop for AtoN points.
3. **Pack** — `pmtiles convert` produces one `.pmtiles` per region; `pmtiles verify` gates release.

Stage 1 must be **format-agnostic** behind a reader interface so an S-101 GML reader slots in beside the S-57 reader without touching stages 2–3.

## 4. Production hardening (the delta from prototype)

- **Cell discovery & indexing by extent, not name.** `US5FL11M` is Tampa Bay, not Miami — index each cell off its actual `GetExtent()`, persist a cell→extent→usage-band catalog.
- **Depth-band encoding.** Bucket `DRVAL1`/`DRVAL2` into S-52 depth bands; emit a `depth_band` integer attribute on `DEPARE`/`DRGARE` so the style does fills without per-feature expressions.
- **Multi-cell merge.** Run per-cell tilesets through `tile-join`; gate each cell's min/max zoom by its usage band (the digit after `US` in the cell name) so overview cells don't fight harbour cells.
- **AtoN attribute carry-through.** Preserve `CATLAM`, `COLOUR`, `COLPAT`, `LITCHR`, `SIGGRP`, `SIGPER`, `VALNMR`, `TOPMAR` on point layers so the style can render IALA symbols and light characteristics.
- **OpenSeaMap overlay.** Optional ODbL seamark layer; attribution wired into tippecanoe `--attribution` (already present in prototype).
- **Update cadence.** NOAA reissues ENCs ~weekly; schedule a diff-and-rebuild per affected region; version each PMTiles with the source edition date.

## 5. Interface

```
ingest --enc-root <dir> --out <region>.pmtiles \
       --minzoom 2 --maxzoom 14 [--seamarks] [--region-bbox ...]
# Catalog output: cells.json  { cell, bbox, usage_band, edition_date }
```

Source layers emitted (extend as needed): `DEPARE DRGARE LNDARE SEAARE FAIRWY DEPCNT COALNE NAVLNE RECTRC BOYLAT BOYSPP BOYSAW BCNSPP DAYMAR LIGHTS OBSTRN UWTROC SOUNDG FOGSIG`.

## 6. Implementation phases

1. Wrap the verified bash prototype as a typed CLI (Node/TS host calling GDAL/tippecanoe/pmtiles), add the cell catalog.
2. Depth-band bucketing + AtoN attribute carry-through.
3. Multi-cell `tile-join` + usage-band zoom gating.
4. Update/diff scheduler; S-101 reader interface stub.

## 7. Acceptance criteria

- Round-trip fidelity: every input feature class present as a queryable source layer; `DRVAL1/2` survive (verified for US5FL11M).
- A multi-cell region renders seamlessly with no overview/harbour z-fighting.
- `pmtiles verify` passes; per-region file size within target (harbour region < ~50 MB typical).
- Re-running on an updated cell produces a new versioned archive without manual steps.

## 8. Open questions

- Sounding density policy at mid-zoom (drop vs. cluster).
- Whether to pre-bake day/dusk/night as separate attributes or leave entirely to the style layer (current plan: style layer).
