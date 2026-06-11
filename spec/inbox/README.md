# inbox/ — new spec drop zone

_Revised: 2026-06-11 (UTC)_

This is the hand-off queue for specs. **Producers drop here; the frontend agent drains and files.**

## What goes here
- A brand-new spec (`spec-<id>.md`) not yet in the set.
- A revision of an existing spec (`spec-<id>-v2.md`) awaiting filing.
- Dropped by: the human, the backend/dev agent, or any process that authored a spec the frontend needs to know about.

## What does NOT go here
- The canonical, filed specs (those live at the bundle root / current dated dir).
- The index (`specs-index.md` is generated, never dropped here).

## Lifecycle of an inbox file
1. Lands here with a filled header block (per `SPEC-CONVENTION.md`). If the header is incomplete, the frontend agent flags it and leaves it in inbox.
2. Frontend agent validates → files into the current set → updates cross-links → regenerates the index → clears it from inbox.
3. A processed spec never stays in inbox; inbox is transient by design. Empty inbox = nothing pending.
