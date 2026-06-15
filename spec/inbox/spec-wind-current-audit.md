# spec-wind-current-audit.md

**Component:** Wind & Current Visualization (WxField, FieldLayer, FlowField)
**Spec-ID:** wind-current-audit
**Version:** v1
**Status:** draft
**Revised:** 2026-06-11 (UTC)
**Depends-on:** spec-wind-current-layers, spec-service-layer
**Referenced-by:** —
**Supersedes:** —
**License-posture:** MIT / Proprietary

---

## 1. Objective

This specification provides a thorough code and architecture audit of the Meridian Wind & Current visualization stack. It examines the shared data model ([field.js](file:///workspace/meridian/lib/field.js)), the static segment layer ([fieldlayer.js](file:///workspace/meridian/lib/fieldlayer.js)), the WebGL particle advection engine ([flow-field.js](file:///workspace/meridian/lib/flow-field.js)), and their integration in the layers viewer ([layers.html](file:///workspace/meridian/layers.html)) and routing page ([routing.html](file:///workspace/meridian/routing.html)). The goal is to verify math correctness, evaluate GPU/CPU performance footprints, highlight cache architecture flaws, and ensure strict compliance with visual display conventions.

## 2. Scope

**In-Scope:**
- **Mathematical & Conversions Audit:** Verifying coordinate projections, spatial/temporal interpolation logic, and wind/current direction conventions (+180° offset).
- **Performance Footprint:** Assessing CPU loading during timeline scrub interpolation and WebGL overlay synchronizations.
- **Cache Architecture:** Reviewing the IndexedDB database structure (`meridian-wx`).
- **Landmask Consistency:** Auditing coastal/inland masking models between display layers and the weather router.

**Out-of-Scope:**
- Modifying underlying GIS maps, Open-Meteo REST service subdomains, or Deck.gl library internals.

---

## 3. Key Audit Findings & Risks

### 3.1. Routing vs. Layers Visual Discrepancy (Visual Risk)
- **Problem:** As documented in the implementation notes of `spec-wind-current-layers-v2.md` §12, [routing.html](file:///workspace/meridian/routing.html) still employs a legacy wind arrow drawing layer. It does not use [fieldlayer.js](file:///workspace/meridian/lib/fieldlayer.js) or the committed indicator conventions (no arrowheads, white wind lines, blue current lines scaled $\times7$ or sqrt, and shared anchor points).
- **Impact:** The application presents conflicting visual styles when navigating between views. The routing view may render wind vectors with arrowheads or varying colors, violating the project-wide committed visual specifications.
- **Mitigation:** Refactor the Cesium-based [routing.html](file:///workspace/meridian/routing.html) to consume `FieldLayer.lineData()` and map the output to Cesium primitives, ensuring complete styling parity.

### 3.2. Main-Thread CPU Sampling Spikes (Performance Risk)
- **Problem:** In [layers.html:417-470](file:///workspace/meridian/layers.html#L417-L470), `prepFlowField()` is executed synchronously on the main thread during timeline scrubbing or playback loops. For each frame, it samples a 64x40 grid ($2,560$ coordinates) against two fields (for time step mix) using bilinear spatial interpolation and linear temporal interpolation.
- **Impact:** Running $5,120$ interpolation calculations in raw JavaScript on the main thread will cause dropouts in frame rates on Raspberry Pi-class devices, especially when concurrent WebGL/MapLibre draws are demanding GPU cycles.
- **Mitigation:**
  - Offload `prepFlowField()` to a Web Worker.
  - Or, downsample the GPU flow grid resolution from 64x40 to 48x30 dynamically if high CPU load or frame drops are detected on helm hardware.

### 3.3. Cache Overwrite Limitation (Functional Risk)
- **Problem:** In [field.js:303-323](file:///workspace/meridian/lib/field.js#L303-L323), the IndexedDB cache uses `field.kind` ("wind" or "current") as the primary key. 
- **Impact:** The cache can only store **one** wind field and **one** current field at a time. If a user pans to a new region and fetches new data, the cache for the previous region is completely overwritten. If they lose internet access and pan back, the first region is blank.
- **Mitigation:** Change the IndexedDB key structure to a composite key combining `kind` + a generalized bounding box hash (e.g. rounded coordinates of the corridor). This allows multi-region forecast caching.

### 3.4. Landmask Discrepancy (Router vs. Layer)
- **Problem:**
  - [layers.html](file:///workspace/meridian/layers.html) uses `lib/landmask.js` (loaded from Natural Earth polygons) to dynamically filter out current lines on land (`waterSamples` at [L331](file:///workspace/meridian/layers.html#L331)) and zero out currents in particle flow mode.
  - [router.js](file:///workspace/meridian/lib/router.js) uses a hardcoded static list of geographic rectangles (`LAND` array at [L119](file:///workspace/meridian/lib/router.js#L119)) to block path legs.
- **Impact:** A path might appear clearly in open water on the chart view but be rejected by the router's hardcoded bounding boxes, or vice versa, causing confusion for the mariner.
- **Mitigation:** Unify land masking: expose `window.LandMask.pointOnLand(lat, lon)` via the `contextBridge` or direct imports to both the display layer and `lib/router.js`, replacing the hardcoded coordinate rectangles in the routing engine.

---

## 4. Vector Conventions & Math Audit

### 4.1. Directional Alignment
- **Wind (Meteorological -> Oceanographic):** Wind direction specifies where the wind comes *from*. The physical movement vector (where it goes *toward*) requires a +180° offset.
  - [field.js:28](file:///workspace/meridian/lib/field.js#L28): `flowDir("wind", dir) => (dir + 180) % 360` (Correct).
  - [field.js:31-34](file:///workspace/meridian/lib/field.js#L31-L34): converts to $u/v$ components correctly using travel direction.
- **Current (Oceanographic):** Currents specify where the flow goes *toward*. No offset is applied.
  - [field.js:28](file:///workspace/meridian/lib/field.js#L28): `flowDir("current", dir) => dir` (Correct).

### 4.2. Temporal Interpolation
- **Math check:** Interpolation is linear in $u/v$ components, rather than speed/direction:
  $$\vec{u}_{interp} = (1 - w_t)\vec{u}_0 + w_t\vec{u}_1$$
  $$\vec{v}_{interp} = (1 - w_t)\vec{v}_0 + w_t\vec{v}_1$$
- This correctly prevents direction-wrap glitches (e.g., interpolating between 350° and 10° does not pass through 180° calm). (Correct).

---

## 5. Audit Recommendations Summary

| Ref | Target File | Issue | Severity | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **B-01** | `routing.html` | Legacy wind visual styling | **Medium** | Rebuild routing view wind layer using `FieldLayer.lineData()`. |
| **B-02** | `layers.html` | Synchronous grid resampling | **Low** | Move `prepFlowField()` to Web Worker or reduce grid resolution. |
| **B-03** | `field.js` | Cache overwrite by kind | **Medium** | Transition IndexedDB keys to composite `kind + bbox_hash`. |
| **B-04** | `router.js` | Hardcoded LAND rectangles vs. GIS landmask | **High** | Replace hardcoded boundaries in router with `window.LandMask.pointOnLand` check. |
