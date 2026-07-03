# Spec inbox — drain log

Newest entry first. One entry per drain pass; this is the "surface the diff"
step from `current/AGENT-INSTRUCTIONS.md` §3.7.

---

## 2026-07-02 — wind/current viz audit drop (pre-release sprint)

**Filed:** `spec-wind-current-audit.md` → `2026-06-11/` (its revision cohort;
draft). Findings B-01 routing-view legacy wind styling (medium), B-02
prepFlowField main-thread cost (low), B-03 wx cache overwrites by kind —
single region only (medium), B-04 router hardcoded LAND boxes vs landmask
(high — but partially stale: router already takes `env.landGuard` wired to
LandMask; boxes are the pre-mask fallback. Verify before acting). Index
updated. Also removed `spec-route-research-frontend.md` from inbox — it was
an identical leftover of the copy already filed in `2026-06-11/`.

---

## 2026-06-11 (late night) — VHF radio stack audit drop

**Filed:** `spec-radio-audit.md` (draft — VHF radio stack security boundaries, DSP spectrogram rendering, playback jitter, and Electron supervisor analysis). Index updated.

---

## 2026-06-11 (night) — refactor guidance + route-research pair

**Filed:** `spec-refactor-guidance.md` (draft — css/theme extraction, page
controllers under js/controllers/, lib/api-service.js consolidation, header
templating, JSDoc passes; acceptance = pixel-perfect). Its ES-modules open
question RESOLVED in place from field experience: file:// blocks ES module
imports (flow-field.js had to be converted) — controllers stay classic
scripts until pages move to an app:// origin. `spec-route-research.md` +
`spec-route-research-frontend.md` (drafts — backend crawl/summarize product +
the ROUTING-view From/To, route variants, along-the-way itinerary that
consumes it via the main-process bridge). Index updated; zip archived.

**Sequencing note:** api-service consolidation overlaps Workstream B
(lib/service.js) — fold together. route-research-frontend blocks on the
backend skill (other agent). Full refactor pass timing = owner decision.

---

## 2026-06-11 (evening) — service-usage + signalk + hyperia + viz/charts drops

**Filed:** `spec-service-usage.md` (active — the deployed service contract:
nuts-auth login, Agent Card, `/a2a` JSON-RPC skills with error semantics,
google/free tile caching split, **`/transcribe` contract** that the radio's
remote toggle stubs await; frontend checklist in §10), `spec-signalk.md`
(draft — Electron-main Signal K client bridge + a first-class **boat
simulator**, "build early"), `spec-hyperia-integration.md` (draft — Hyperia
sidecar on :9800 as the standalone agent; sticky notes as panes; ACP Act →
consent grants). Index updated.

**Artifacts:** `windcurrentviz.zip` → `archive/` (Windy-style GPU particle
flow-field engine — flow-field.js, zero-dep, with demo + README — the LAYERS
view upgrade); `meridian-charts.pmtiles` → repo `charts/` (S-57 ENC PMTiles,
San Diego cell — chart-style underlay data; *.pmtiles is gitignored).
`spec-google-3d-tiles.md` was byte-identical to the filed copy — dropped.

---

## 2026-06-11 (later still) — authored `spec-radio-embedded.md` (draft)

Owner direction: gnosis-radio was a REFERENCE; all radio code moves into this
repo, zero user setup. Draft spec filed with the confirmed decisions
(in-repo Rust sidecar + Electron supervisor, driver onboarding in the radio
view's center pane, whisper.cpp SMALL model on Pi-class hardware, remote
transcription + remote logs as stub toggles pending the owner's service spec,
standardized top bar + cross-view radio unread badge) and the **build-agent
decomposition** (§4: radio-core, sidecar-supervisor, driver-onboarding,
transcribe-local, radio-view) for the owner to author agent specs from.
Index updated. Frontend pieces shipped same day: lib/topbar.js mounted in all
five views, guided-setup center pane, transcription toggles.

---

## 2026-06-11 (later) — radio UI prototype drop

**Filed:** `radio.html` (design prototype, simulated data) → consumed as the
layout reference for the real `radio.html` built against gnosis-radio's live
contract (WS :9081 binary PCM + JSON events, control :9080). The real view
ports the engine from gnosis-radio `src/web.rs` (2048-pt STFT, voice-confidence
masking, inferno LUT, per-bin noise-floor EMA); sockets live in the preload
bridge (`window.meridian.radio.*`), page opens none. As-dropped prototype kept
at `archive/radio-prototype-AS-DROPPED.html`. `scripts/mock-radio.mjs` provides
a synthetic feed for dev without the dongle.

**⚠ Hardware:** RTL-SDR dongle enumerates (VID 0BDA PID 2838) but both bulk
interfaces show driver **Error** — needs the WinUSB driver via Zadig before
`gnosis-radio.exe scan` can open it (`usb_open error -5`). Crate builds clean.

---

## 2026-06-11 — initial drain (bundle + 2 loose drops)

**Filed:**
- `meridian-specs-2026-06-11.zip` → extracted to `2026-06-11/` (15 specs +
  SPEC-CONVENTION + AGENT-INSTRUCTIONS + specs-index). `current` junction
  points at it.
- `spec-wind-current-layers.md` (loose, 13:21, newer than the bundle's 12:50
  copy) → filed as **`spec-wind-current-layers-v2.md`** with a full convention
  header (`Supersedes: spec-wind-current-layers`); v1 marked `superseded`.
  v2 = v1 + the shipped implementation notes (`lib/field.js`,
  `lib/fieldlayer.js`, `layers.html`). As-dropped original kept in `archive/`.
- `compass_artifact_…markdown.md` → filed as
  `2026-06-11/marine-data-licensing-catalog.md` (research artifact: which free
  marine data sources permit commercial proxy/cache; Open-Meteo hosted API is
  **non-commercial only** — flagged below).
- `specs-index.md` regenerated: wind-current row → v2; v1 + artifact listed.

**RESOLVED 2026-06-11 (commit 0be6c78):** the code drop below has been
hand-merged. Its base turned out to be 7d59622 and its routing.html delta was
the same fix as 369de01, so the merge reduced to additions (field.js,
fieldlayer.js, layers.html, nav links, MERIDIAN_VIEW=layers). Verified live.

**~~⚠ Pending decision~~ — implementation code drop (NOT a spec):**
`archive/meridian-wind-current-layers (1).zip` is a full app snapshot from
another agent implementing the wind/current layers (new `lib/field.js`,
`lib/fieldlayer.js`, `layers.html`; modified `routing.html`, `index.html`,
`setup.html`, `electron/main.js`). **Its base is the 09:17 snapshot — BEFORE
commits `7d59622` (destination-overshoot fix), `369de01` (horizon occlusion),
and the .gitignore masking.** Copying its files in verbatim would revert those
fixes. Needs a deliberate merge (port `field.js`/`fieldlayer.js`/`layers.html`
in, hand-merge the modified shared files). Do not bulk-extract over the repo.

**⚠ Licensing flag surfaced by the artifact:** the app currently calls the
hosted Open-Meteo API directly (ensemble + marine + forecast grid). That free
endpoint is non-commercial; fine for dev, but a paid Meridian service must
self-host Open-Meteo (AGPLv3) or fetch ECMWF/GFS/SMOC sources directly
(CC-BY/public). Tracked in the catalog + `spec-service-layer.md` territory.

**Inbox after drain:** `README.md` only (empty = nothing pending).

## 2026-07-03 — meridian-terminal drop (the Helm view)

**Filed:** `meridian-terminal.jsx` → `2026-06-11/` (reference React
implementation, ~130KB). Adapted copy lives at `lib/meridian-terminal.jsx`
and IS the Helm view: an agentic widget builder — describe a widget at the
prompt, the LLM writes the component, it compiles into the tool registry
live and renders as a draggable window over the ship-data context.
Adaptations: React UMD + Babel standalone (no build step), LLM calls through
the :9123 loopback relay (ANTHROPIC_API_KEY in main-process .env; swap to
service infer.complete when its executor lands), Signal K bridge overlays
the sim data, window.m.command() lets the MCP agent type like the human.
