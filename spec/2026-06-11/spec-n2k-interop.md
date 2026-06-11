# spec-n2k-interop.md

_Revised: 2026-06-11 (UTC)_

**Component:** NMEA 2000 / Garmin interoperability
**Status:** Designed in conversation. Not built.
**License posture:** Apache-2.0. Foundation uses canboat/canboatjs (Apache-2.0) and Signal K (Apache-2.0). Reverse engineering for interoperability with hardware the user owns is broadly legal (Sega v. Accolade; Sony v. Connectix; EU Software Directive Art. 6). **Hard line:** no DMCA §1201 circumvention — no DRM/encryption breaking, no firmware decompilation. Black-box wire observation only.

---

## 1. Objective

Let Meridian read the data a boat's existing instruments emit — including Garmin gear — without doing risky reverse engineering itself, by standing on the open NMEA 2000 decoding the community already maintains, and treating proprietary-PGN work as an opportunistic bonus tier, never a load-bearing dependency.

## 2. Foundation (no RE by us)

Path: **N2K bus → gateway → canboat/canboatjs → Signal K → Meridian.** Standard PGNs (position, heading, depth, wind, speed, AIS, engine, autopilot status) — including those from Garmin devices that emit standard PGNs — are decoded by canboat under Apache-2.0 and normalized by Signal K. Meridian consumes Signal K; it writes no decoder.

## 3. Interop capability map

Maintain a living matrix, three columns:

| Data type | Free via canboat→SK | RE-able by bus observation | Off-limits (DRM/§1201) |
|---|---|---|---|
| Position/COG/SOG | ✅ | — | — |
| Heading/attitude | ✅ | — | — |
| Depth/wind/speed | ✅ | — | — |
| AIS | ✅ | — | — |
| Engine/tank/battery | ✅ (mostly) | proprietary gaps | — |
| Autopilot cmd/status | partial | proprietary PGNs | — |
| Proprietary sensor PGNs | — | ✅ (observe, contribute to canboat) | — |
| Garmin Marine Network (radar/sonar/chart Ethernet) | — | hard; verify no crypto first | if authenticated/encrypted |
| Encrypted charts (Navionics/Garmin) | — | — | ❌ never |

## 4. Bonus tier — black-box PGN observation

For proprietary PGNs not yet in canboat: capture frames off the user's own bus, correlate values to device state, document the PGN, and **contribute it upstream to canboat** so the fix is permissive and shared. Workflow is observation only — never decompile firmware, never touch authenticated/encrypted streams. Keep an audit trail of what was observed.

## 5. Connection model

Supported gateways: NMEA 2000 → USB/Ethernet (e.g., Actisense NGT-1, YDEN-style). Meridian configures the gateway into Signal K; source multiplexing and priority handled by Signal K, mirrored in Meridian's connection UI.

## 6. Legal guardrails (in the build)

- Interop RE permitted only against hardware the user owns, by wire observation.
- Hard stop on any TPM circumvention (§1201): no DRM, no encryption breaking, no firmware decompilation.
- Anything touching encrypted charts → partnership/licensing track, not RE.
- Get IP/DMCA counsel before any work that even approaches a protected measure.

## 7. Acceptance criteria

- Standard Garmin/other N2K data flows to Meridian via Signal K with zero custom decoder.
- The capability map is current and cites which proprietary PGNs are gaps.
- Any RE work is wire-observation only, contributed to canboat, with an audit trail; no DRM/firmware touched (attested).

## 8. Open questions

- Whether to bundle a canboat/Signal K stack with Meridian or rely on the user's existing Signal K server.
- Autopilot *control* (vs. read) — security and liability model before enabling writes.
