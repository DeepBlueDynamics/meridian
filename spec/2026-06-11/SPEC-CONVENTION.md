# Spec Convention & Authoring Guide

_Revised: 2026-06-11 (UTC)_

How every Meridian spec is structured, named, and added. Keep this file at the root of the spec bundle. New specs follow this format so the set stays self-organizing and the index can be regenerated from headers alone.

---

## 1. Every spec starts with this header block

```
# spec-<name>.md

**Component:** <one line>
**Spec-ID:** <name>            # stable slug, matches filename, never changes
**Version:** v1                # bump on substantive revision
**Status:** draft | active | superseded
**Revised:** YYYY-MM-DD (UTC)
**Depends-on:** spec-x, spec-y  # specs this one builds on (or "none")
**Referenced-by:** spec-z       # filled as others cite it (or "—")
**Supersedes:** spec-<name>-v1  # if replacing an older spec (or "—")
**License-posture:** <one line>
```

Rules:
- **Spec-ID is stable.** The filename is `spec-<id>.md`. Versions live in the `Version`/`Supersedes` fields, not new IDs — a reader always finds the current one by ID.
- **Revised date is UTC, ISO format.** It's the sort key.
- **Depends-on / Referenced-by are the dependency graph.** The index is built from these.

## 2. Body sections (in order; omit none without reason)

1. **Objective** — what and why, one paragraph.
2. **Scope** — in / out.
3. **Architecture** — structure + data flow (prose; reference, don't paste).
4. **Data model / API / contract** — the buildable meat (real field names, schemas).
5. **Dependencies & license posture** — what it leans on; permissive vs. boundary.
6. **Implementation phases** — ordered, shippable increments.
7. **Acceptance criteria** — testable "done."
8. **Open questions** — honest unknowns, with a lean where you have one.

## 3. How to add a spec

1. Filename: `spec-<id>.md`, lower-kebab, ID stable forever.
2. Fill the header block (§1). Set `Status: draft` until reviewed → `active`.
3. List `Depends-on`. Add yourself to the `Referenced-by` of any spec you cite.
4. Revising an existing spec substantively → new file `spec-<id>-v2.md`, set `Supersedes: spec-<id>`, set the old one's `Status: superseded`. (Small edits: bump `Version` + `Revised` in place.)
5. Regenerate the index (§4) so the new spec appears.

## 4. The index is generated, not hand-kept

`specs-index.md` is built from the header blocks: every active spec, its Status/Revised/Depends-on, and the build-order graph. When you add or supersede a spec, regenerate rather than hand-edit, so the index can never drift from the files.

## 5. Resolved-question log

When an open question is decided, don't delete it — move it to a "Resolved (was open)" list in the index with the resolution and where it's documented. Decisions stay auditable; the next agent sees what moved and why.
