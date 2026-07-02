# Bundle Instructions — Frontend Agent (reference & maintain)

_Revised: 2026-06-11 (UTC)_

You (the **frontend agent**) both **reference** these specs to build the Meridian frontend and **maintain** the spec set: drain the inbox, file new/revised specs, keep the index current. Read this first on every bundle.

---

## 1. Bundle layout

```
specs/
  current  ->  pointer to the newest dated dir
  inbox/                     # NEW specs land here, unfiled (drain these)
    README.md
  YYYY-MM-DD/                # dated snapshots (newest = current)
    SPEC-CONVENTION.md
    AGENT-INSTRUCTIONS.md    (this file)
    specs-index.md           (generated)
    spec-*.md
```

Bundles arrive as `meridian-specs-YYYY-MM-DD.zip`. Extract into a new dated dir; never overwrite a prior date; repoint `current`.

## 2. What's current
- **Newest dated dir wins**; `current` points to it.
- **`specs-index.md` is the manifest** — read it before any individual spec.
- A spec's header is truth: `Status: active|superseded|draft`, `Revised:` date. A `superseded` file is never the source of truth — follow its successor.

## 3. The inbox — your maintenance loop

`inbox/` is the producer→consumer queue. Humans and other agents **drop** new or revised specs there; **you drain it.** On each bundle (or on a maintenance pass):

1. **Scan `inbox/`.** For each `spec-*.md`:
2. **Validate** the header block against `SPEC-CONVENTION.md`. Incomplete header → leave in inbox, flag it, move on.
3. **File it:**
   - New `Spec-ID` → add to the current set as `active`.
   - Revision (`Supersedes:` set) → mark the old one `superseded`, add the new one.
4. **Cross-link:** add this spec to the `Referenced-by` of every spec it lists in `Depends-on`.
5. **Regenerate `specs-index.md`** from all header blocks (never hand-edit; headers win).
6. **Clear** the processed file from inbox (it now lives in the dated set).
7. **Surface the diff** — what was added / superseded / resolved — so the human sees what moved without re-reading.

Empty inbox = nothing pending. Inbox is transient by design.

## 4. When YOU author or revise a spec
Same as draining: write per `SPEC-CONVENTION.md`, drop into `inbox/` (or file directly if you're mid-maintenance), then run steps 3–7. Stable `Spec-ID` = filename; versions via `Version`/`Supersedes`, not new IDs. Re-stamp `Revised:` (UTC) on anything you touch.

## 5. Referencing specs to build the frontend
- The specs describe the **client/display app** (Electron, commit 369de01 baseline) plus the services it talks to. **No agent lives in the app** — it's client/display; the standalone agent and tool services are separate processes reached over localhost ports / contextBridge.
- Honor the localhost **port registry** (radio 9080/9081, transcription 8765, app control 9123, app proxy `app://3dtiles`); don't collide.
- Renderer never opens raw sockets or sees keys — main process owns proxies/subscribers and exposes a narrow `contextBridge` (the `window.meridian.*` pattern).

## 6. Organizing principle
By date at the top (snapshots), by Spec-ID within (stable identity), inbox for in-flight. History preserved; current one pointer away; index + headers are truth, prose bodies are reference.
