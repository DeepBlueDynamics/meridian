# Spec inbox — drain log

Newest entry first. One entry per drain pass; this is the "surface the diff"
step from `current/AGENT-INSTRUCTIONS.md` §3.7.

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
