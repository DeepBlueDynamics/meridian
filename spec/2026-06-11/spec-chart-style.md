# spec-chart-style.md

_Revised: 2026-06-11 (UTC)_

**Component:** MapLibre GL chart style — S-52-style cartography over PMTiles
**Status:** Not started. Consumes the output of `spec-chart-ingestion.md`.
**License posture:** Apache-2.0. MapLibre GL JS (BSD-3). S-52 *conventions* are followed from the public INT-1 symbol legend and the IHO portrayal register; the official S-52 Presentation Library code is **not** read or copied — symbology is rebuilt from the published conventions.

---

## 1. Objective

A MapLibre GL style (plus a sprite sheet) that renders the ingested ENC vector layers as a recognizable nautical chart: depth-band shading keyed to a user safety contour, depth contours, soundings, land, and IALA-correct aids-to-navigation, with day/dusk/night palettes and zoom-based decluttering. The output must read as a chart to a mariner without reproducing S-52 PresLib source.

## 2. Scope

**In:** style layers for all ingested source layers, the safety-contour model, AtoN sprite system, light rendering, palette switching, declutter/SCAMIN.
**Out:** ingestion (separate spec), 3D/Cesium harbor view (existing `spec.md`), radar/AIS overlays (separate specs).

## 3. Depth model (the core)

- User sets a **safety depth** (default 2 m, configurable). Areas shallower than it shade as "unsafe"; deeper as "safe."
- Two-shade (safe/unsafe) and four-shade (deep/medium/shallow/intertidal) modes, driven by the `depth_band` attribute baked in ingestion.
- The **safety contour** is highlighted as a bold line on `DEPCNT` where the contour value crosses the user safety depth — recomputed client-side when the user changes safety depth (no re-tile).
- Palette ramps defined per mode in a single JSON tokens file so day/dusk/night swap by replacing the ramp, not the layers.

## 4. Layer plan (MapLibre style layers, bottom → top)

1. `LNDARE` fill (land buff) + `COALNE` casing.
2. `DEPARE`/`DRGARE` fills via `depth_band` → palette ramp.
3. `DEPCNT` lines; safety contour expression bolds the crossing contour.
4. `FAIRWY` dashed magenta; `RECTRC` recommended-track lines.
5. `SOUNDG` as text (value labels), SCAMIN/zoom-gated.
6. `OBSTRN`/`UWTROC` hazard symbols.
7. AtoN points (`BOYLAT BOYSPP BOYSAW BCNSPP DAYMAR`) → sprite keyed by `CATLAM`+`COLOUR`+`TOPMAR`.
8. `LIGHTS` → light flare symbol; optional sector arcs from `SECTR1/2`+`VALNMR`; label from `LITCHR/SIGGRP/SIGPER`.

## 5. AtoN sprite system

A generated sprite sheet of IALA Region B (US) symbols. Sprite id resolves from feature attributes via a lookup table (e.g., `CATLAM=2,COLOUR=4` → `buoy_lateral_red`). Region A vs B selectable for non-US waters. Symbols drawn from the public INT-1 legend conventions, authored as original SVG — not extracted from any existing PresLib.

## 6. Declutter

Zoom-gate label and minor-symbol layers; honor `SCAMIN` where present; a global "base/standard/full" detail toggle mirroring ECDIS display categories, implemented as MapLibre layer-visibility groups.

## 7. Implementation phases

1. Depth fills + contours + land + safety-contour expression (the chart "shape").
2. Soundings + hazards + fairways.
3. AtoN sprite sheet + symbol lookup.
4. Lights + sectors; day/dusk/night palettes; declutter toggle.

## 8. Acceptance criteria

- Side-by-side with a reference NOAA chart of the same cell, depth shading, safety contour, and major AtoN match in meaning (parity checklist, not pixel match).
- Changing safety depth re-shades live with no re-tiling.
- Day/dusk/night switch by palette swap only.
- No S-52 PresLib source consulted; sprite SVGs are original (attested in build notes).

## 9. Open questions

- Sector-light arc rendering as a runtime layer vs. baked geometry.
- Whether to ship IALA Region A symbols in v1 or US-only (Region B) first.
