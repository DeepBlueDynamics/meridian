# spec-userdata.md

**Component:** Local user data — logs, recordings, transcripts, notes — with opt-in upload
**Spec-ID:** userdata
**Version:** v1
**Status:** active
**Revised:** 2026-06-11 (UTC)
**Depends-on:** spec-auth, spec-acp-and-search-v2
**Referenced-by:** spec-radio, spec-service-layer, spec-anchorage-layer
**Supersedes:** —
**License-posture:** Apache-2.0. User data is the user's. **Local-first; nothing leaves the boat without explicit opt-in.** Sovereign-architecture default.

---

## 1. Objective

Store the user's data — logbook entries, radio transcripts/recordings, maintenance notes, sticky notes, passage logs — **locally on the boat by default**, indexed for offline search, and uploaded to the service **only if the user chooses to**. This is the boat-OS retention layer's storage substrate and the privacy spine of the sovereignty pitch.

## 2. Principle: local-first, opt-in sync

- **Default: everything stays on the boat.** The app/agent works fully against local storage with no account-cloud dependency.
- **Opt-in upload:** the user can choose to back up / sync specific data classes to the service (for cross-device, fleet contribution, or durability). Off by default, per-class, revocable.
- **Never silent.** No data class uploads without an explicit, per-class opt-in. Matches the fleet-network privacy model (`spec-fleet-network`): the user decides what leaves.

## 3. Data classes

| Class | Source | Local store | Opt-in upload? |
|---|---|---|---|
| `logbook` | manual + agent + passage auto-log | yes | yes |
| `radio_transcripts` | gnosis-radio (`spec-radio`) | yes | yes |
| `radio_recordings` | gnosis-radio WAVs | yes (bulky) | yes (opt-in, usually kept local) |
| `notes` | sticky notes / maintenance (Hyperia) | yes | yes |
| `maintenance` | service intervals, parts, reminders | yes | yes |
| `passages` | completed-passage records | yes | yes → feeds anonymized fleet (`spec-fleet-network`) |

## 4. Local store + index

- **Store:** local embedded store on the boat (logs as structured records; recordings as files). Pi-capable.
- **Index:** everything text indexes into Shivvr/Lume (`SearchSource::Logs`, `spec-acp-and-search-v2`) so it's searchable **offline** ("when did I last service the watermaker", "what did the marina say on 16").
- **Retention:** user-controlled; recordings can age out on a size budget; transcripts/logs are small, keep long.

## 5. Endpoints (ACP capabilities)

Local + service mirror the same shapes; the resolver picks per connectivity + opt-in.

- `userdata.append` (Act-lite — writes local; single-tap not required for the user's own log, but scoped to the boat token): append a record to a class.
- `userdata.query` (Read): search/list a class (routes through Shivvr/Lume for text).
- `userdata.sync` (Act): push a class to the service — **requires the per-class opt-in flag set** + scoped JWT. No opt-in → capability refuses.
- `userdata.export` (Read): dump the user's data (GPX for tracks, JSON for logs) — the user owns and can take their data.

## 6. Sync model (when opted-in + online)

- Per-class opt-in flag gates `userdata.sync`.
- Service stores under the user's `sub` (`spec-auth`); used for cross-device restore, durability, and (for `passages`, separately opted-in) anonymized fleet contribution.
- **Sovereignty rule:** sync is additive convenience; the boat never depends on the uploaded copy to function. Offline = full local function.

## 7. Acceptance criteria

- All data classes store and index locally; offline search resolves over `Logs` with no network.
- No class uploads without its explicit opt-in flag; `userdata.sync` refuses an un-opted class (verified).
- `userdata.export` returns the user's full data in open formats (GPX/JSON).
- Disabling an opt-in stops further upload immediately; revocation honored.
- Radio transcripts (`spec-radio`) and notes (Hyperia) land in the local store and index automatically.

## 8. Open questions

- Local store engine (embedded KV/SQLite-class) vs. flat files + index — pick for Pi footprint.
- Recording retention defaults (size budget) vs. keep-all on larger boxes.
- Conflict resolution for a class synced across two devices (last-write-wins vs. merge) — likely LWW per record.
