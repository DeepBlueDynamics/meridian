# spec-build-signalk-sim.md

**Component:** Build agent — Signal K boat-data simulator (the boatless dev interconnect)
**Spec-ID:** build-signalk-sim
**Version:** v1
**Status:** draft
**Revised:** 2026-06-11 (UTC)
**Depends-on:** spec-signalk
**Referenced-by:** —
**Supersedes:** —
**License-posture:** Apache-2.0. First-party dev tooling; speaks the open Signal K wire format.

## 1. Objective

Build the simulator from spec-signalk §6 as a standalone Node service in this
repo (`scripts/signalk-sim.mjs` + `scenarios/*.json`). It must be
**wire-faithful**: Meridian's preload bridge (`electron/preload.js`,
`window.meridian.signalk`) connects to it with **zero code difference** from a
real `signalk-server`. It is the permanent dev interconnect, the CI harness
for boat-data features, and the demo rig.

## 2. What Meridian's client already expects (frozen, implemented)

The bridge (implemented 2026-06-11) does, in order:
1. `ws://host:port/signalk/v1/stream?subscribe=none` — and on open expects a
   **hello** message containing `self` (urn) before anything else.
2. Sends one subscription: `{ context:"vessels.self", subscribe:[{path,period:1000}…] }`
   for the path set in `SK_PATHS` (preload.js): position, headingTrue,
   courseOverGroundTrue, SOG, STW, wind speed/direction true + apparent,
   current drift/setTrue, depth.belowTransducer, water.temperature.
3. `GET http://host:port/signalk/v1/api/vessels/self` for snapshot late-join —
   nested `{ navigation:{ position:{ value, timestamp } } … }` shape.
4. Parses deltas `{ context, updates:[{ timestamp, values:[{path,value}] }] }`.
5. All values **SI** (m/s, radians, Kelvin, meters); position in degrees.
6. `GET /signalk` discovery document should exist (the bridge tolerates its
   absence today but conformance matters — see acceptance).

## 3. Build requirements

- **Scenario-driven (JSON)**, `scenarios/hawaii-passage.json` first: start
  position, a track or a **Meridian-computed route** (accept the routing
  view's exported path array verbatim: `[{lat,lon,time,…}]`), vessel polar
  (reuse `lib/vessel.js` shapes — J/120 default, Lagoon 42 optional), true-wind
  source (synthetic field or **the same Open-Meteo fetch lib/field.js uses**),
  depth profile, tank levels + drain rates, battery profile, engine schedule,
  AIS targets each with its own track.
- **Physics-lite tick (1 Hz):** advance own-ship along the track at polar boat
  speed given local true wind → SOG/COG; **apparent wind = true wind vector +
  boat velocity vector** (get the vector math right — this is the classic
  bug); update depth; drain tanks; cycle battery; advance AIS targets; emit
  per-path deltas at realistic rates (position ~1 Hz, wind 1–2 Hz, tanks
  ~0.1 Hz).
- **Time control:** real-time, accelerated (`--rate 10`), pause, scrub via a
  tiny control endpoint (`POST /sim/time {rate|seek}`); design so it can later
  be slaved to the app's forecast timeline (killer demo: the sim boat sails
  through the exact field shown in the LAYERS view).
- **AIS:** other vessels under `vessels.<urn>` with `navigation.*`, `name`,
  `mmsi` — Meridian's AIS consumers arrive later; emit them now.
- **No deps beyond Node stdlib** if possible (mock-radio.mjs shows the
  hand-rolled WS server pattern — reuse it; server→client frames need no
  masking).

## 4. Acceptance criteria

1. `node scripts/signalk-sim.mjs scenarios/hawaii-passage.json` →
   Meridian LAYERS view: enter `localhost:3000`, Connect → cyan measured-wind
   arrow appears at the moving own-ship within 5 s, **through the existing
   bridge with zero client changes**.
2. The same client code connects to a real `signalk-server` demo instance
   without modification (conformance check — run it at least once).
3. Apparent vs true wind verified: at boat speed 6 kn into a 10 kn headwind,
   apparent ≈ 16 kn at 0°; downwind apparent ≈ 4 kn (the signs trip people).
4. Units audit: every emitted value SI (a `speedTrue` of "12" is wrong by
   definition — that's knots leaking).
5. Time acceleration ×10 keeps deltas coherent (no position teleporting).

## 5. Out of scope

Log replay (spec-signalk §6 optional), anchor-watch logic (consumer-side),
graph-any-path panes (VIZ W2 — consumer-side).
