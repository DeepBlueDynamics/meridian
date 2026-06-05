# Running Meridian as a Hyperia App

This file tells an automation agent (Antigravity, Claude Code, etc.) how to build
Meridian and install it as a **Hyperia app** — a web app that Hyperia serves and
opens in a web pane, surfaced as a button in Hyperia's pane Chooser.

The machine-readable manifest is **`hyperia.app.json`** (this repo root). This
document is the build/install playbook behind it.

## What Meridian is

A Vite + React web app (maritime charts: Leaflet 2D + MapLibre 3D, OpenSeaMap,
terrain). The UI in `src/` has **no Electron/host coupling** — no `ipcRenderer`,
no `window.electron` — so it runs unchanged in a browser or a Hyperia web pane.

The only host coupling is **two endpoints provided by the Vite dev server**, which
do **not** exist in a static `vite build`:

1. `GET /mosaic.json?lat&lon&padding` — generates a MosaicJSON of Copernicus DEM
   COG URLs for 3D terrain (`vite.config.js` → `mosaic-json-server` plugin). Pure
   computation; no real backend.
2. `/anthropic/*` — proxies api.anthropic.com and injects an API key, for the
   Claude-powered search (`vite.config.js` → `server.proxy`). Needs a real backend
   (key + CORS).

## Required refactor for Hyperia

1. **Relative asset base.** Set `base: './'` in `vite.config.js` so the static
   build works under a sub-path (Hyperia serves it at `/apps/meridian/`).
2. **`/mosaic.json` → client-side.** Move `copernicusCogUrl` + the mosaic builder
   out of the dev-server plugin into the app (compute the MosaicJSON in JS where the
   3D terrain layer is configured). No server endpoint needed afterward.
3. **`/anthropic` search → host proxy or optional.** A static build has no proxy.
   Either (a) point the search client at the host proxy Hyperia provides at
   `/apps/meridian/anthropic` (declared in `hyperia.app.json` → `endpoints`,
   key from `ANTHROPIC_API_KEY`), or (b) feature-gate search off when no proxy is
   reachable. Never ship the key in the bundle.
4. **Drop the Electron path.** Hyperia is the host. Ignore `electron/`,
   `dev:electron`, `build:electron`; don't ship an Electron build.

After steps 1–2, `npm run build` produces a fully static `dist/` that runs in any
web pane (search degrades gracefully without the proxy).

## Build

```bash
npm ci
npm run build      # → dist/  (static, relative base)
```

Output: `dist/` — static assets Hyperia serves at
`http://localhost:9800/apps/meridian/`.

## How Hyperia installs it

`hyperia install deepbluedynamics/meridian` performs:

1. `git clone https://github.com/deepbluedynamics/meridian` → `~/.hyperia/apps/meridian/`
2. read `hyperia.app.json`
3. run `build.install` then `build.command` in a visible Hyperia pane
4. register the app (`id`, `name`, `icon`, local path) in `~/.hyperia/apps/registry.json`
5. the sidecar serves `serve.dir` at `serve.mountPath` (`/apps/meridian/`) and stands
   up any declared `endpoints` (e.g. the Anthropic proxy with `ANTHROPIC_API_KEY`)
6. a **Meridian** button appears in the Chooser → clicking opens a web pane at
   `http://localhost:9800/apps/meridian/`

## Acceptance

- `npm run build` produces `dist/` with relative asset URLs (works under `/apps/meridian/`).
- The 3D terrain renders with no `/mosaic.json` server endpoint (client-side mosaic).
- Search either works through the host proxy or is cleanly disabled — never crashes,
  never leaks a key.
